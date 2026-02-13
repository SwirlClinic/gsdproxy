import type { TextChannel, ThreadChannel, Message } from "discord.js";
import {
  createPermissionEmbed,
  createPermissionButtons,
} from "../discord/components/permission-prompt.js";
import {
  createQuestionEmbed,
  createQuestionSelect,
} from "../discord/components/question-prompt.js";
import type { AskUserQuestionInput } from "../discord/components/question-prompt.js";
import type {
  PermissionRequest,
  PermissionDecision,
} from "../mcp/ipc-client.js";
import { logger } from "../logger.js";

export type { PermissionRequest, PermissionDecision };

/**
 * PermissionHandler renders Discord prompts for tool permission requests
 * and AskUserQuestion prompts, collects user responses via button clicks
 * or select menu interactions, and handles 5-minute auto-deny timeouts.
 */
export class PermissionHandler {
  private readonly TIMEOUT_MS = 300_000; // 5 minutes

  /**
   * Handle a permission request by rendering the appropriate Discord UI
   * and awaiting user interaction.
   *
   * For AskUserQuestion, renders select menus for each question.
   * For all other tools, renders an embed with Allow/Deny buttons.
   */
  async handlePermissionRequest(
    request: PermissionRequest,
    channel: TextChannel | ThreadChannel
  ): Promise<PermissionDecision> {
    if (request.tool_name === "AskUserQuestion") {
      return this.handleAskUserQuestion(request, channel);
    }

    // Build permission embed and buttons
    const input = request.input as Record<string, unknown>;
    const embed = createPermissionEmbed(request.tool_name, input);
    const buttons = createPermissionButtons(request.tool_use_id);

    // Send prompt to Discord
    let promptMsg: Message;
    try {
      promptMsg = await channel.send({
        embeds: [embed],
        components: [buttons],
      });
    } catch (err) {
      logger.error({ err }, "Failed to send permission prompt");
      return { behavior: "deny", message: "Failed to send permission prompt" };
    }

    try {
      // Wait for button click (5-minute timeout)
      const interaction = await promptMsg.awaitMessageComponent({
        time: this.TIMEOUT_MS,
      });

      // Acknowledge immediately -- must happen within 3 seconds
      // Update the embed to reflect the decision and remove buttons
      const isAllow = interaction.customId.startsWith("perm_allow");

      embed
        .setColor(isAllow ? 0x57f287 : 0xed4245)
        .setFooter({ text: isAllow ? "Allowed by user" : "Denied by user" });

      await interaction.update({
        embeds: [embed],
        components: [],
      });

      if (isAllow) {
        return { behavior: "allow", updatedInput: request.input };
      } else {
        return { behavior: "deny", message: "User denied this action" };
      }
    } catch {
      // Timeout -- awaitMessageComponent rejects on timeout
      logger.warn(
        { toolName: request.tool_name, toolUseId: request.tool_use_id },
        "Permission request timed out after 5 minutes"
      );

      embed
        .setColor(0xed4245)
        .setFooter({ text: "Timed out - auto-denied" });

      try {
        await promptMsg.edit({
          embeds: [embed],
          components: [],
        });
      } catch {
        // Message may have been deleted
      }

      return {
        behavior: "deny",
        message: "Permission request timed out (5 minutes)",
      };
    }
  }

  /**
   * Handle AskUserQuestion by rendering each question as a select menu
   * and collecting answers sequentially.
   */
  private async handleAskUserQuestion(
    request: PermissionRequest,
    channel: TextChannel | ThreadChannel
  ): Promise<PermissionDecision> {
    const questionInput = request.input as unknown as AskUserQuestionInput;
    const questions = questionInput.questions;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      logger.warn({ input: request.input }, "AskUserQuestion with no questions");
      return { behavior: "deny", message: "No questions provided" };
    }

    const answers: Record<string, string> = {};

    for (const question of questions) {
      // Build question embed and select menu
      const embed = createQuestionEmbed(question.header, question.question);
      const selectRow = createQuestionSelect(question);

      let promptMsg: Message;
      try {
        promptMsg = await channel.send({
          embeds: [embed],
          components: [selectRow],
        });
      } catch (err) {
        logger.error({ err }, "Failed to send question prompt");
        return { behavior: "deny", message: "Failed to send question prompt" };
      }

      try {
        // Wait for selection (5-minute timeout)
        const interaction = await promptMsg.awaitMessageComponent({
          time: this.TIMEOUT_MS,
        });

        // Acknowledge immediately -- remove select menu
        embed
          .setColor(0x57f287)
          .setFooter({ text: "Answered" });

        await interaction.update({
          embeds: [embed],
          components: [],
        });

        // Store the answer
        if (interaction.isStringSelectMenu()) {
          answers[question.question] = interaction.values.join(", ");
        }
      } catch {
        // Timeout on any question -- auto-deny the entire request
        logger.warn(
          { header: question.header },
          "AskUserQuestion timed out after 5 minutes"
        );

        embed
          .setColor(0xed4245)
          .setFooter({ text: "Timed out - auto-denied" });

        try {
          await promptMsg.edit({
            embeds: [embed],
            components: [],
          });
        } catch {
          // Message may have been deleted
        }

        return {
          behavior: "deny",
          message: "Question timed out (5 minutes)",
        };
      }
    }

    return {
      behavior: "allow",
      updatedInput: { questions: questionInput.questions, answers },
    };
  }
}
