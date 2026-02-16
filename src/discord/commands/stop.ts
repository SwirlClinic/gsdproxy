import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export type OnStop = (interaction: ChatInputCommandInteraction) => Promise<void>;

let onStop: OnStop = async (interaction) => {
  await interaction.editReply("Not initialized.");
};

export function setOnStop(fn: OnStop): void {
  onStop = fn;
}

export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Stop an active Claude session");

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await onStop(interaction);
}
