import { Message } from "discord.js";
import { config } from "../../config.js";
import { logger } from "../../logger.js";

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

  // All guards passed -- forward to Claude (Plan 02 will wire this)
  const truncated =
    message.content.length > 100
      ? message.content.slice(0, 100) + "..."
      : message.content;

  logger.info(
    { messageId: message.id, content: truncated },
    "Received owner message"
  );

  await message.reply(
    `Received: ${truncated}\nClaude integration coming in next plan.`
  );
}
