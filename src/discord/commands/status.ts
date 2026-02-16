import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export type GetStatus = (interaction: ChatInputCommandInteraction) => Promise<void>;

let getStatus: GetStatus = async (interaction) => {
  await interaction.editReply("Not initialized.");
};

export function setStatusHandler(fn: GetStatus): void {
  getStatus = fn;
}

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Show current Claude session status");

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await getStatus(interaction);
}
