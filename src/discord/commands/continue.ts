import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export type OnContinue = (interaction: ChatInputCommandInteraction) => Promise<void>;

let onContinue: OnContinue = async (interaction) => {
  await interaction.editReply("Not initialized.");
};

export function setOnContinue(fn: OnContinue): void {
  onContinue = fn;
}

export const data = new SlashCommandBuilder()
  .setName("continue")
  .setDescription("Resume the most recent Claude session");

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await onContinue(interaction);
}
