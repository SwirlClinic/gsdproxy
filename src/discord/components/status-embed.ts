import { EmbedBuilder } from "discord.js";
import type { ManagedSession } from "../../claude/types.js";

/**
 * Format a duration in milliseconds to a human-readable string.
 * - Under 60s: "Xs"
 * - Under 3600s: "Xm Ys"
 * - Otherwise: "Xh Ym"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (totalSeconds < 60) return `${s}s`;
  if (totalSeconds < 3600) return `${m}m ${s}s`;
  return `${h}h ${m}m`;
}

/**
 * Create a rich embed showing all active sessions with their status,
 * age, message count, token usage, and cost.
 */
export function createStatusEmbed(sessions: ManagedSession[]): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle("Session Status");

  if (sessions.length === 0) {
    embed
      .setDescription("No active sessions. Use `/new` to start one.")
      .setColor(0x95a5a6);
    return embed;
  }

  embed.setColor(0x57f287);

  for (const session of sessions) {
    const age = formatDuration(Date.now() - session.startedAt.getTime());
    const value = [
      `**Status:** ${session.isProcessing ? "Processing" : "Idle"}`,
      `**Age:** ${age}`,
      `**Messages:** ${session.messageCount}`,
      `**Tokens:** ${session.totalInputTokens.toLocaleString()} in / ${session.totalOutputTokens.toLocaleString()} out`,
      `**Cost:** $${session.totalCostUsd.toFixed(4)}`,
    ].join("\n");

    embed.addFields({
      name: `Session in <#${session.threadId}>`,
      value,
    });
  }

  const totalCost = sessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
  embed.setFooter({ text: `Total cost: $${totalCost.toFixed(4)}` });

  return embed;
}

/**
 * Create a resume embed for the /continue command.
 * Shows session info when resuming an existing session.
 */
export function createResumeEmbed(session: ManagedSession): EmbedBuilder {
  const age = formatDuration(Date.now() - session.startedAt.getTime());

  return new EmbedBuilder()
    .setTitle("Session Resumed")
    .setColor(0x5865f2) // Discord blurple
    .setDescription("Continuing session in this thread.")
    .addFields(
      { name: "Started", value: age + " ago", inline: true },
      { name: "Messages", value: String(session.messageCount), inline: true },
      { name: "Cost", value: `$${session.totalCostUsd.toFixed(4)}`, inline: true },
    );
}
