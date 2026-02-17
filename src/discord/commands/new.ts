import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export type OnNew = (interaction: ChatInputCommandInteraction) => Promise<void>;

let onNew: OnNew = async (interaction) => {
  await interaction.editReply("Not initialized.");
};

export function setOnNew(fn: OnNew): void {
  onNew = fn;
}

export const data = new SlashCommandBuilder()
  .setName("new")
  .setDescription("Start a fresh Claude session")
  .addStringOption((opt) =>
    opt
      .setName("cwd")
      .setDescription("Working directory for this session")
      .setRequired(false)
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await onNew(interaction);
}
