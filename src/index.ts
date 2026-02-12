#!/usr/bin/env node

import { Events } from "discord.js";
import { config, cwd } from "./config.js";
import { client } from "./discord/client.js";
import { registerCommands } from "./discord/commands/index.js";
import { handleMessage } from "./discord/handlers/message.js";
import { handleInteraction } from "./discord/handlers/interaction.js";
import { logger } from "./logger.js";

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
