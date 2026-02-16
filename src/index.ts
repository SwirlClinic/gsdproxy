#!/usr/bin/env node

import {
  Events,
  PresenceUpdateStatus,
  ActivityType,
  type TextChannel,
  ThreadAutoArchiveDuration,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} from "discord.js";
import { config, cwd } from "./config.js";
import { client } from "./discord/client.js";
import { registerCommands } from "./discord/commands/index.js";
import { setStatusHandler } from "./discord/commands/status.js";
import { setOnStop } from "./discord/commands/stop.js";
import { setOnNew } from "./discord/commands/new.js";
import { setOnContinue } from "./discord/commands/continue.js";
import { handleMessage, setRouter, setSessionManager } from "./discord/handlers/message.js";
import { handleInteraction } from "./discord/handlers/interaction.js";
import { SessionManager } from "./bridge/session-manager.js";
import { BridgeRouter } from "./bridge/router.js";
import { IpcServer } from "./bridge/ipc-server.js";
import { PermissionHandler } from "./bridge/permission-handler.js";
import { logger } from "./logger.js";

// Create IPC server and permission handler
const ipcServer = new IpcServer(config.ipcPort);
const permissionHandler = new PermissionHandler();

// Create SessionManager instead of a single ClaudeSession
const sessionManager = new SessionManager({
  cwd,
  ipcPort: config.ipcPort,
  dangerouslySkipPermissions: config.dangerouslySkipPermissions,
});

// Create BridgeRouter instance with SessionManager, IPC server, and permission handler
const router = new BridgeRouter(sessionManager, ipcServer, permissionHandler);

// Wire the router and session manager to the message handler
setRouter(router);
setSessionManager(sessionManager);

// ── Bot Presence Helper ──────────────────────────────────────────────────────

function updatePresence(): void {
  const sessions = sessionManager.getAllSessions();
  const active = sessions.length;
  const processing = sessions.some((s) => s.isProcessing);

  if (active === 0) {
    client.user?.setPresence({
      status: PresenceUpdateStatus.Online,
      activities: [{ name: "Ready", type: ActivityType.Watching }],
    });
  } else if (processing) {
    client.user?.setPresence({
      status: PresenceUpdateStatus.DoNotDisturb,
      activities: [{ name: "Working...", type: ActivityType.Playing }],
    });
  } else {
    client.user?.setPresence({
      status: PresenceUpdateStatus.Idle,
      activities: [
        {
          name: `${active} session${active > 1 ? "s" : ""} active`,
          type: ActivityType.Watching,
        },
      ],
    });
  }
}

// ── Wire slash command callbacks ─────────────────────────────────────────────

setOnNew(async (interaction) => {
  const channel = interaction.channel as TextChannel;

  // Warn if sessions are active
  if (sessionManager.hasAnySessions()) {
    const warnEmbed = new EmbedBuilder()
      .setTitle("Active Session Warning")
      .setDescription(
        `You have ${sessionManager.getActiveSessionCount()} active session(s). Start a new one anyway?`
      )
      .setColor(0xffa500);

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("new_confirm")
        .setLabel("Start New Session")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("new_cancel")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    );

    const reply = await interaction.editReply({
      embeds: [warnEmbed],
      components: [buttons],
    });
    try {
      const btnInteraction = await reply.awaitMessageComponent({
        time: 60_000,
      });
      if (btnInteraction.customId === "new_cancel") {
        warnEmbed.setColor(0x95a5a6).setFooter({ text: "Cancelled" });
        await btnInteraction.update({ embeds: [warnEmbed], components: [] });
        return;
      }
      await btnInteraction.update({ embeds: [warnEmbed], components: [] });
    } catch {
      // Timeout
      warnEmbed.setColor(0x95a5a6).setFooter({ text: "Timed out" });
      await interaction.editReply({ embeds: [warnEmbed], components: [] });
      return;
    }
  }

  // Create thread
  const timestamp = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const thread = await channel.threads.create({
    name: `Claude Session - ${timestamp}`,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    reason: "Claude session",
  });

  sessionManager.createSession(thread.id, thread.url);
  await interaction.editReply(`New session started in <#${thread.id}>`);
  updatePresence();
});

setOnStop(async (interaction) => {
  const sessions = sessionManager.getAllSessions();
  if (sessions.length === 0) {
    await interaction.editReply("No active sessions to stop.");
    return;
  }

  if (sessions.length === 1) {
    const session = sessions[0];
    sessionManager.destroySession(session.threadId);
    await interaction.editReply(
      `Session stopped. ${session.messageCount} messages, cost: $${session.totalCostUsd.toFixed(4)}`
    );
    updatePresence();
    return;
  }

  // Multiple sessions -- show picker
  const { createSessionPicker } = await import(
    "./discord/components/session-picker.js"
  );
  const picker = createSessionPicker(sessions);
  const reply = await interaction.editReply({
    content: "Select a session to stop:",
    components: [picker],
  });

  try {
    const selectInteraction = await reply.awaitMessageComponent({
      time: 60_000,
    });
    if (selectInteraction.isStringSelectMenu()) {
      const threadId = selectInteraction.values[0];
      const session = sessionManager.getSession(threadId);
      if (session) {
        sessionManager.destroySession(threadId);
        await selectInteraction.update({
          content: `Session stopped. ${session.messageCount} messages, cost: $${session.totalCostUsd.toFixed(4)}`,
          components: [],
        });
      } else {
        await selectInteraction.update({
          content: "Session not found.",
          components: [],
        });
      }
    }
  } catch {
    await interaction.editReply({
      content: "Timed out -- no session stopped.",
      components: [],
    });
  }
  updatePresence();
});

setOnContinue(async (interaction) => {
  const session = sessionManager.getMostRecentSession();
  if (!session) {
    await interaction.editReply(
      "No previous session found. Use `/new` to start one."
    );
    return;
  }

  if (session.claudeSession.isAlive()) {
    // Post resume embed in the session's thread
    const { createResumeEmbed } = await import(
      "./discord/components/status-embed.js"
    );
    const embed = createResumeEmbed(session);
    try {
      const thread = await client.channels.fetch(session.threadId);
      if (thread?.isThread()) {
        // Unarchive if needed
        if (thread.archived) await thread.setArchived(false);
        await thread.send({ embeds: [embed] });
      }
    } catch (err) {
      logger.warn({ err }, "Failed to post resume embed in thread");
    }
    await interaction.editReply(
      `Session resumed in <#${session.threadId}>`
    );
  } else {
    // Session died -- ask user what to do
    const warnEmbed = new EmbedBuilder()
      .setTitle("Session Expired")
      .setDescription(
        "The Claude process for this session has died. Start a fresh session or clean up?"
      )
      .setColor(0xed4245);

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("continue_fresh")
        .setLabel("Start Fresh")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("continue_abort")
        .setLabel("Clean Up")
        .setStyle(ButtonStyle.Secondary)
    );

    const reply = await interaction.editReply({
      embeds: [warnEmbed],
      components: [buttons],
    });
    try {
      const btnInteraction = await reply.awaitMessageComponent({
        time: 60_000,
      });
      sessionManager.destroySession(session.threadId);
      if (btnInteraction.customId === "continue_fresh") {
        // Create a new session inline (same logic as /new without the warning)
        const channel = interaction.channel as TextChannel;
        const timestamp = new Date().toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        const thread = await channel.threads.create({
          name: `Claude Session - ${timestamp}`,
          autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
          reason: "Claude session (fresh start)",
        });
        sessionManager.createSession(thread.id, thread.url);
        await btnInteraction.update({
          content: `New session started in <#${thread.id}>`,
          embeds: [],
          components: [],
        });
      } else {
        await btnInteraction.update({
          content: "Session cleaned up.",
          embeds: [],
          components: [],
        });
      }
    } catch {
      sessionManager.destroySession(session.threadId);
      await interaction.editReply({
        content: "Timed out -- session cleaned up.",
        embeds: [],
        components: [],
      });
    }
    updatePresence();
  }
});

setStatusHandler(async (interaction) => {
  const { createStatusEmbed } = await import(
    "./discord/components/status-embed.js"
  );
  const sessions = sessionManager.getAllSessions();
  const embed = createStatusEmbed(sessions);
  await interaction.editReply({ embeds: [embed] });
});

// ── Discord event handlers ───────────────────────────────────────────────────

client.once(Events.ClientReady, (c) => {
  logger.info(
    {
      tag: c.user.tag,
      channelId: config.channelId,
      guildId: config.guildId,
      cwd,
    },
    `Logged in as ${c.user.tag}`
  );
  updatePresence();
});

client.on(Events.MessageCreate, (message) => {
  handleMessage(message).catch((error) => {
    logger.error({ error, messageId: message.id }, "Message handler error");
  });
});

client.on(Events.InteractionCreate, (interaction) => {
  handleInteraction(interaction).catch((error) => {
    logger.error({ error }, "Interaction handler error");
  });
});

// ── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down gracefully");

  // Destroy all sessions (kills all Claude processes)
  const destroyed = sessionManager.destroyAllSessions();
  logger.info({ count: destroyed }, "Destroyed sessions");

  // Stop the IPC server (auto-denies pending permission requests)
  try {
    await ipcServer.stop();
    logger.info("IPC server stopped");
  } catch (err) {
    logger.warn({ err }, "Error stopping IPC server");
  }

  // Disconnect from Discord
  client.destroy();

  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Safety net: ensure Claude processes are killed if node exits unexpectedly
process.on("exit", () => {
  sessionManager.destroyAllSessions();
});

// Register slash commands, start IPC server, and login
async function start(): Promise<void> {
  try {
    // Start IPC server before Discord login
    await ipcServer.start();
    logger.info({ port: config.ipcPort }, "IPC server started");

    await registerCommands(config.token, config.appId, config.guildId);
    await client.login(config.token);
  } catch (error) {
    logger.fatal({ error }, "Failed to start bot");
    process.exit(1);
  }
}

start();
