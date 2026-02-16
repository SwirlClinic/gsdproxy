import { type Message, type TextChannel, type ThreadChannel } from "discord.js";
import { config } from "../../config.js";
import { logger } from "../../logger.js";
import type { BridgeRouter } from "../../bridge/router.js";
import type { SessionManager } from "../../bridge/session-manager.js";

let router: BridgeRouter | null = null;
let sessionManager: SessionManager | null = null;

/**
 * Set the BridgeRouter instance used by the message handler.
 * Called from index.ts during startup wiring.
 */
export function setRouter(r: BridgeRouter): void {
  router = r;
}

/**
 * Set the SessionManager instance used for thread-based session lookup.
 * Called from index.ts during startup wiring.
 */
export function setSessionManager(sm: SessionManager): void {
  sessionManager = sm;
}

export async function handleMessage(message: Message): Promise<void> {
  // Guard: ignore bot messages (prevent self-reply loops)
  if (message.author.bot) return;

  // Guard: ignore non-owner messages (log the attempt silently)
  if (message.author.id !== config.ownerId) {
    logger.warn(
      { userId: message.author.id, username: message.author.username },
      "Unauthorized message attempt"
    );
    return;
  }

  // Thread-based routing: check if the message is in a session thread
  if (message.channel.isThread()) {
    // For threads, check if the parent channel is the configured channel
    if (message.channel.parentId !== config.channelId) return;

    // Look up the session by thread ID
    const session = sessionManager?.getSession(message.channel.id);
    if (session && router) {
      await router.handleSessionMessage(
        message,
        message.channel as ThreadChannel,
        session
      );
    }
    // else: not a session thread, ignore
    return;
  }

  // Main channel messages: check channel guard
  if (message.channel.id !== config.channelId) return;

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

  await router.handleNewMessage(message);
}
