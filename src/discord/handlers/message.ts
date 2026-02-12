import { type Message, type TextChannel } from "discord.js";
import { config } from "../../config.js";
import { logger } from "../../logger.js";
import type { BridgeRouter } from "../../bridge/router.js";

let router: BridgeRouter | null = null;

/**
 * Set the BridgeRouter instance used by the message handler.
 * Called from index.ts during startup wiring.
 */
export function setRouter(r: BridgeRouter): void {
  router = r;
}

export async function handleMessage(message: Message): Promise<void> {
  // Guard: ignore bot messages (prevent self-reply loops)
  if (message.author.bot) return;

  // Guard: ignore messages outside the dedicated channel
  if (message.channel.id !== config.channelId) return;

  // Guard: ignore non-owner messages (log the attempt silently)
  if (message.author.id !== config.ownerId) {
    logger.warn(
      { userId: message.author.id, username: message.author.username },
      "Unauthorized message attempt"
    );
    return;
  }

  // All guards passed -- forward to Claude via BridgeRouter
  const truncated =
    message.content.length > 100
      ? message.content.slice(0, 100) + "..."
      : message.content;

  logger.info(
    { messageId: message.id, content: truncated },
    "Received owner message"
  );

  if (!router) {
    logger.error("BridgeRouter not initialized");
    await (message.channel as TextChannel).send(
      "**Error:** Bot is not fully initialized. Please restart."
    );
    return;
  }

  await router.handleMessage(message);
}
