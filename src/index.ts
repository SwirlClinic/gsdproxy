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
import { BridgeRouter } from "./bridge/router.js";
import { logger } from "./logger.js";

// Create BridgeRouter instance with the current working directory
const router = new BridgeRouter(cwd);

// Wire the router to the message handler
setRouter(router);

// Wire slash command callbacks to the router
setSessionStatusGetter(() => {
  const status = router.getStatus();
  const lines: string[] = [];

  lines.push(status.isProcessing ? "**Status:** Processing" : "**Status:** Idle");
  lines.push(`**Session:** ${status.sessionId ?? "none"}`);
  lines.push(`**Working directory:** ${status.cwd}`);

  if (status.queueLength > 0) {
    lines.push(`**Queued messages:** ${status.queueLength}`);
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

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutting down gracefully");

  // Kill any active Claude process
  router.abort();

  // Disconnect from Discord
  client.destroy();

  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Safety net: ensure child process is killed if node exits unexpectedly
process.on("exit", () => {
  router.abort();
});

// Register slash commands and login
async function start(): Promise<void> {
  try {
    await registerCommands(config.token, config.appId, config.guildId);
    await client.login(config.token);
  } catch (error) {
    logger.fatal({ error }, "Failed to start bot");
    process.exit(1);
  }
}

start();
