import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

/** Override this callback from Plan 02 to wire actual stop logic. Returns true if a session was stopped. */
export let onStop: () => boolean = () => false;

export function setOnStop(fn: () => boolean): void {
  onStop = fn;
}

export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Stop the active Claude session immediately");

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const stopped = onStop();
  if (stopped) {
    await interaction.editReply("Session stopped.");
  } else {
    await interaction.editReply("No active session to stop.");
  }
}
