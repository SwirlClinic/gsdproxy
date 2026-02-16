import {
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
} from "discord.js";
import type { ManagedSession } from "../../claude/types.js";
import { formatDuration } from "./status-embed.js";

/**
 * Create a select menu for choosing which session to stop.
 * Each option shows the session index, message count, cost, and age.
 */
export function createSessionPicker(
  sessions: ManagedSession[]
): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId("stop_session_picker")
    .setPlaceholder("Select a session to stop");

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const age = formatDuration(Date.now() - session.startedAt.getTime());
    const description = `${session.messageCount} msgs, $${session.totalCostUsd.toFixed(4)}, age: ${age}`;

    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`Session ${i + 1}`)
        .setDescription(description)
        .setValue(session.threadId),
    );
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}
