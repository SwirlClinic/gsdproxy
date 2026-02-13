import type { Message } from "discord.js";
import { logger } from "../logger.js";

/**
 * StreamingMessage provides debounced message editing for real-time streaming
 * display in Discord. Wraps a Discord Message and accumulates text, editing
 * the message at most once every DEBOUNCE_MS to stay within Discord rate limits.
 *
 * After the stream completes, call flush() to do one final edit with the
 * accumulated text.
 */
export class StreamingMessage {
  private message: Message;
  private accumulatedText = "";
  private editTimer: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_MS = 1500;
  private readonly MAX_DISPLAY_LENGTH = 1800;
  private isFinished = false;

  constructor(message: Message) {
    this.message = message;
  }

  /**
   * Append text to the accumulated response and schedule a debounced edit.
   */
  appendText(text: string): void {
    this.accumulatedText += text;
    this.scheduleEdit();
  }

  /**
   * Returns the full accumulated text (for use after completion).
   */
  getAccumulatedText(): string {
    return this.accumulatedText;
  }

  /**
   * Schedule a debounced message edit. If an edit is already scheduled or the
   * stream is finished, does nothing.
   */
  private scheduleEdit(): void {
    if (this.editTimer || this.isFinished) return;
    this.editTimer = setTimeout(() => {
      this.doEdit().catch((err) => {
        logger.warn({ err }, "StreamingMessage edit failed");
      });
    }, this.DEBOUNCE_MS);
  }

  /**
   * Perform the actual message edit with the current accumulated text.
   * Truncates to MAX_DISPLAY_LENGTH if necessary.
   */
  private async doEdit(): Promise<void> {
    this.editTimer = null;

    let displayText = this.accumulatedText;
    if (displayText.length > this.MAX_DISPLAY_LENGTH) {
      displayText =
        displayText.slice(0, this.MAX_DISPLAY_LENGTH) +
        "\n\n*... streaming (full output in thread)*";
    }

    try {
      await this.message.edit(displayText || "*Working on it...*");
    } catch (err) {
      logger.warn({ err }, "Failed to edit streaming message");
    }
  }

  /**
   * Flush the final accumulated text to the message. Clears any pending timer
   * and marks the stream as finished to prevent further edits.
   */
  async flush(): Promise<void> {
    this.isFinished = true;

    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }

    let displayText = this.accumulatedText;
    if (displayText.length > this.MAX_DISPLAY_LENGTH) {
      displayText =
        displayText.slice(0, this.MAX_DISPLAY_LENGTH) +
        "\n\n*... full output posted above in thread*";
    }

    try {
      await this.message.edit(displayText || "*No output*");
    } catch (err) {
      logger.warn({ err }, "Failed to flush streaming message");
    }
  }

  /**
   * Directly edit the message with a status text (not debounced).
   * Status updates are infrequent so they bypass the debounce.
   */
  async setStatus(status: string): Promise<void> {
    if (this.isFinished) return;

    try {
      await this.message.edit(status);
    } catch {
      // Message may be deleted -- ignore
    }
  }
}
