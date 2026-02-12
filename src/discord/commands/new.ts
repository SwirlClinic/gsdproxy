import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

/** Override this callback from Plan 02 to wire actual session reset. */
export let onNew: () => void = () => {};

export function setOnNew(fn: () => void): void {
  onNew = fn;
}

export const data = new SlashCommandBuilder()
  .setName("new")
  .setDescription("Start a fresh Claude session");

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  onNew();
  await interaction.editReply(
    "Session reset. Next message starts a new conversation."
  );
}
