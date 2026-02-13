import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";

export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserQuestionInput {
  questions: Question[];
}

/**
 * Create an embed for displaying a clarifying question to the user.
 */
export function createQuestionEmbed(
  header: string,
  question: string
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(header)
    .setDescription(question)
    .setColor(0x5865f2); // Discord blurple
}

/**
 * Create a select menu action row for a single question.
 * Supports both single-select and multi-select based on question.multiSelect.
 */
export function createQuestionSelect(
  question: Question
): ActionRowBuilder<StringSelectMenuBuilder> {
  const placeholder =
    question.question.length > 100
      ? question.question.slice(0, 97) + "..."
      : question.question;

  const select = new StringSelectMenuBuilder()
    .setCustomId(`question_${question.header}`)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(question.multiSelect ? question.options.length : 1)
    .addOptions(
      question.options.map((opt) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(opt.label)
          .setDescription(opt.description)
          .setValue(opt.label)
      )
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}
