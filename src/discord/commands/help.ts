import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show available commands and how the bot works");

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.editReply(
    [
      "**GSD Proxy -- Claude Code from Discord**",
      "",
      "Send a message in the main channel to auto-create a session, or use `/new` to start one explicitly.",
      "",
      "**Commands:**",
      "`/new` -- Start a new Claude session (auto-creates a thread)",
      "`/stop` -- Stop an active session (pick from list if multiple)",
      "`/continue` -- Resume the most recent session",
      "`/status` -- Show all active sessions with costs and token usage",
      "`/help` -- Show this message",
      "",
      "**How it works:**",
      "- Each session lives in its own **thread**. Send messages in the thread to continue the conversation.",
      "- The main channel gets a **summary** with a thread link",
      "- Read-only tools (Read, Glob, Grep) are auto-approved",
      "- Other tools (Bash, Write, Edit) show **Allow/Deny** buttons",
      "- Unanswered permission prompts auto-deny after 5 minutes",
    ].join("\n")
  );
}
