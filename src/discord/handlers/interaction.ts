import { Interaction } from "discord.js";
import { config } from "../../config.js";
import { commands } from "../commands/index.js";
import { logger } from "../../logger.js";

export async function handleInteraction(
  interaction: Interaction
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  // Guard: ignore interactions outside the dedicated channel
  if (interaction.channelId !== config.channelId) {
    await interaction.reply({
      content: "This command can only be used in the dedicated channel.",
      ephemeral: true,
    });
    return;
  }

  // Guard: ignore non-owner interactions
  if (interaction.user.id !== config.ownerId) {
    await interaction.reply({
      content: "You are not authorized.",
      ephemeral: true,
    });
    return;
  }

  // Defer immediately (3-second timeout compliance)
  await interaction.deferReply();

  const command = commands.find(
    (cmd) => cmd.data.name === interaction.commandName
  );

  if (!command) {
    logger.warn(
      { commandName: interaction.commandName },
      "Unknown command received"
    );
    await interaction.editReply("Unknown command.");
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error({ error, commandName: interaction.commandName }, "Command execution failed");
    await interaction.editReply(
      `Error executing /${interaction.commandName}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
