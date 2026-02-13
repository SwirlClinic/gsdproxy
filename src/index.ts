#!/usr/bin/env node

import { Events } from "discord.js";
import { config, cwd } from "./config.js";
import { client } from "./discord/client.js";
import { registerCommands } from "./discord/commands/index.js";
import { setSessionStatusGetter } from "./discord/commands/status.js";
import { setOnStop } from "./discord/commands/stop.js";
import { setOnNew } from "./discord/commands/new.js";
import { handleMessage, setRouter } from "./discord/handlers/message.js";
import { handleInteraction } from "./discord/handlers/interaction.js";
import { ClaudeSession } from "./claude/session.js";
import { BridgeRouter } from "./bridge/router.js";
import { IpcServer } from "./bridge/ipc-server.js";
import { PermissionHandler } from "./bridge/permission-handler.js";
import { logger } from "./logger.js";

// Create IPC server and permission handler
const ipcServer = new IpcServer(config.ipcPort);
const permissionHandler = new PermissionHandler();

// Create persistent Claude session and spawn the process
const session = new ClaudeSession({
  cwd,
  ipcPort: config.ipcPort,
  dangerouslySkipPermissions: config.dangerouslySkipPermissions,
});
session.spawn();

// Create BridgeRouter instance with session, IPC server, and permission handler
const router = new BridgeRouter(session, cwd, ipcServer, permissionHandler);

// Wire the router to the message handler
setRouter(router);

// Wire slash command callbacks to the router
setSessionStatusGetter(() => {
  const status = router.getStatus();
  const lines: string[] = [];

  lines.push(status.isProcessing ? "**Status:** Processing" : "**Status:** Idle");
  lines.push(`**Session state:** ${status.sessionState}`);
  lines.push(`**Session:** ${status.sessionId ?? "none"}`);
  lines.push(`**Cost:** $${status.totalCostUsd.toFixed(4)}`);
  lines.push(`**Working directory:** ${status.cwd}`);

  if (status.queueLength > 0) {
    lines.push(`**Queued messages:** ${status.queueLength}`);
  }

  if (status.threadId) {
    lines.push(`**Active thread:** <#${status.threadId}>`);
  }

  return lines.join("\n");
});

setOnStop(() => router.abort());

setOnNew(() => router.resetSession());

// Discord event handlers
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

  // Destroy the Claude session (kills the persistent process)
  session.destroy();

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

// Safety net: ensure Claude process is killed if node exits unexpectedly
process.on("exit", () => {
  session.destroy();
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
