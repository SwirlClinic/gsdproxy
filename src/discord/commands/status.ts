import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { cwd } from "../../config.js";

/** Override this getter from Plan 02 to provide real session status. */
export let getSessionStatus: () => string = () =>
  `No active session. Working directory: ${cwd}`;

export function setSessionStatusGetter(fn: () => string): void {
  getSessionStatus = fn;
}

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Show current Claude session status");

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.editReply(getSessionStatus());
}
