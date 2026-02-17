import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { projectsDir } from "../../config.js";

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
      .setAutocomplete(true)
  );

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await onNew(interaction);
}

export async function autocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const dir = projectsDir;
  if (!dir) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused().toLowerCase();
  const entries = readdirSync(dir, { withFileTypes: true });
  const choices = entries
    .filter((e) => e.isDirectory() && e.name.toLowerCase().startsWith(focused))
    .slice(0, 25)
    .map((e) => ({ name: e.name, value: join(dir, e.name) }));
  await interaction.respond(choices);
}
