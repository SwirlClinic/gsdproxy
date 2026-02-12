import type { ChildProcess } from "node:child_process";
import { type Message, type TextChannel } from "discord.js";
import { spawnClaude } from "../claude/process.js";
import { parseStream, captureStderr } from "../claude/parser.js";
import { splitMessage, formatToolActivity } from "../discord/formatter.js";
import { logger } from "../logger.js";
import type {
  ClaudeStreamEvent,
  ContentBlockStart,
  ContentBlockDelta,
  ResultEvent,
  ToolUseBlock,
} from "../claude/types.js";

interface QueuedMessage {
  message: Message;
  resolve: () => void;
}

/**
 * BridgeRouter is the central orchestration class that bridges Discord messages
 * to the Claude CLI subprocess. It manages session state, typing indicators,
 * message queuing, and response formatting.
 */
export class BridgeRouter {
  private activeProcess: ChildProcess | null = null;
  private sessionId: string | null = null;
  private isProcessing = false;
  private messageQueue: QueuedMessage[] = [];
  private hasSession = false;
  private readonly cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * Handle an incoming Discord message by forwarding it to Claude.
   * If already processing, queues the message with a notification.
   *
   * NOTE: The message is guaranteed to come from the dedicated guild text channel
   * (enforced by the channelId guard in the message handler), so casting to
   * TextChannel is safe.
   */
  async handleMessage(message: Message): Promise<void> {
    const channel = message.channel as TextChannel;

    // If already processing, queue the message
    if (this.isProcessing) {
      await channel.send(
        "*Still working on your previous request. Your message has been queued.*"
      );
      return new Promise<void>((resolve) => {
        this.messageQueue.push({ message, resolve });
      });
    }

    this.isProcessing = true;

    // Start typing indicator loop
    const stopTyping = this.startTypingLoop(channel);

    // Send status message
    let statusMessage: Message | null = null;
    try {
      statusMessage = await channel.send("*Working on it...*");
    } catch (err) {
      logger.warn({ err }, "Failed to send status message");
    }

    try {
      // Spawn Claude subprocess
      const proc = spawnClaude(message.content, {
        cwd: this.cwd,
        continueSession: this.hasSession,
      });
      this.activeProcess = proc;

      // Capture stderr for error reporting
      const stderrPromise = captureStderr(proc);

      // Track text accumulation and tool input JSON for parsing
      let accumulatedText = "";
      let currentToolName: string | null = null;
      let currentToolJson = "";

      // Parse the NDJSON stream
      for await (const event of parseStream(proc)) {
        await this.handleStreamEvent(event, {
          statusMessage,
          channel,
          onText: (text: string) => {
            accumulatedText += text;
          },
          onToolStart: (name: string) => {
            currentToolName = name;
            currentToolJson = "";
          },
          onToolInputDelta: (json: string) => {
            currentToolJson += json;
          },
          onToolStop: () => {
            currentToolName = null;
            currentToolJson = "";
          },
          getCurrentToolName: () => currentToolName,
          getCurrentToolJson: () => currentToolJson,
        });
      }

      // Wait for process to fully exit
      const exitCode = await new Promise<number | null>((resolve) => {
        if (proc.exitCode !== null) {
          resolve(proc.exitCode);
          return;
        }
        proc.on("exit", (code) => resolve(code));
      });

      // Stop typing indicator
      stopTyping();

      // Delete the status message
      if (statusMessage) {
        try {
          await statusMessage.delete();
        } catch {
          // Message may already be deleted
        }
      }

      // Check for non-zero exit with no accumulated text
      if (exitCode !== 0 && !accumulatedText) {
        const stderr = await stderrPromise;
        const errorMsg =
          stderr.trim() || `Claude process exited with code ${exitCode}`;
        await channel.send(`**Error:** ${errorMsg}`);
      } else if (accumulatedText) {
        // Send accumulated text as formatted response
        const chunks = splitMessage(accumulatedText);
        for (const chunk of chunks) {
          await channel.send(chunk);
        }
      }
    } catch (error) {
      // Stop typing on any error
      stopTyping();

      // Delete status message on error
      if (statusMessage) {
        try {
          await statusMessage.delete();
        } catch {
          // Ignore
        }
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check for spawn failure (claude not found)
      if (
        errorMessage.includes("ENOENT") ||
        errorMessage.includes("spawn claude")
      ) {
        await channel.send(
          "**Error:** Failed to start Claude. Is the `claude` CLI installed and in your PATH?"
        );
      } else {
        await channel.send(`**Error:** ${errorMessage}`);
      }

      logger.error({ error }, "Error handling message");
    } finally {
      this.activeProcess = null;
      this.isProcessing = false;

      // Process queued messages
      this.processQueue();
    }
  }

  /**
   * Handle a single stream event from the Claude process.
   */
  private async handleStreamEvent(
    event: ClaudeStreamEvent,
    ctx: {
      statusMessage: Message | null;
      channel: TextChannel;
      onText: (text: string) => void;
      onToolStart: (name: string) => void;
      onToolInputDelta: (json: string) => void;
      onToolStop: () => void;
      getCurrentToolName: () => string | null;
      getCurrentToolJson: () => string;
    }
  ): Promise<void> {
    switch (event.type) {
      case "system": {
        if (event.subtype === "init") {
          this.sessionId = event.session_id;
          this.hasSession = true;
          logger.info(
            { sessionId: event.session_id, model: event.model },
            "Claude session initialized"
          );
        }
        break;
      }

      case "stream_event": {
        const streamEvent = event.event;

        switch (streamEvent.type) {
          case "content_block_start": {
            const block = (streamEvent as ContentBlockStart).content_block;
            if (block.type === "tool_use") {
              const toolBlock = block as ToolUseBlock;
              ctx.onToolStart(toolBlock.name);

              // Show initial tool activity
              const activity = formatToolActivity(
                toolBlock.name,
                toolBlock.input
              );
              if (ctx.statusMessage) {
                try {
                  await ctx.statusMessage.edit(activity);
                } catch {
                  // Status message may be deleted
                }
              }
            }
            break;
          }

          case "content_block_delta": {
            const delta = (streamEvent as ContentBlockDelta).delta;
            if (delta.type === "text_delta") {
              ctx.onText(delta.text);
            } else if (delta.type === "input_json_delta") {
              ctx.onToolInputDelta(delta.partial_json);

              // Try to parse accumulated tool JSON for better status messages
              const toolName = ctx.getCurrentToolName();
              const toolJson =
                ctx.getCurrentToolJson() + delta.partial_json;
              if (toolName) {
                try {
                  const parsed = JSON.parse(toolJson) as Record<
                    string,
                    unknown
                  >;
                  const activity = formatToolActivity(toolName, parsed);
                  if (ctx.statusMessage) {
                    try {
                      await ctx.statusMessage.edit(activity);
                    } catch {
                      // Status message may be deleted
                    }
                  }
                } catch {
                  // JSON not complete yet, ignore
                }
              }
            }
            break;
          }

          case "content_block_stop": {
            ctx.onToolStop();
            break;
          }
        }
        break;
      }

      case "result": {
        const result = event as ResultEvent;

        if (result.is_error) {
          const errorText = result.result || "Unknown error";
          await ctx.channel.send(`**Error from Claude:** ${errorText}`);
        } else if (
          result.num_turns !== undefined &&
          result.total_cost_usd !== undefined
        ) {
          await ctx.channel.send(
            `*Completed in ${result.num_turns} turn(s) ($${result.total_cost_usd.toFixed(4)})*`
          );
        }
        break;
      }
    }
  }

  /**
   * Abort the active Claude process.
   * Returns true if a process was killed, false if none was active.
   */
  abort(): boolean {
    if (this.activeProcess) {
      this.activeProcess.kill("SIGTERM");
      this.activeProcess = null;
      this.isProcessing = false;
      // Clear the message queue
      for (const queued of this.messageQueue) {
        queued.resolve();
      }
      this.messageQueue = [];
      return true;
    }
    return false;
  }

  /**
   * Get the current session status.
   */
  getStatus(): {
    isProcessing: boolean;
    sessionId: string | null;
    cwd: string;
    queueLength: number;
  } {
    return {
      isProcessing: this.isProcessing,
      sessionId: this.sessionId,
      cwd: this.cwd,
      queueLength: this.messageQueue.length,
    };
  }

  /**
   * Reset the session so the next message starts a fresh conversation.
   * If currently processing, aborts first.
   */
  resetSession(): void {
    if (this.isProcessing) {
      this.abort();
    }
    this.hasSession = false;
    this.sessionId = null;
  }

  /**
   * Start a typing indicator loop that refreshes every 9 seconds.
   * Returns a cleanup function to stop the loop.
   */
  private startTypingLoop(channel: TextChannel): () => void {
    channel.sendTyping().catch(() => {});
    const interval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 9000);

    return () => clearInterval(interval);
  }

  /**
   * Process the next queued message, if any.
   */
  private processQueue(): void {
    if (this.messageQueue.length === 0) return;

    const next = this.messageQueue.shift()!;
    next.resolve(); // Resolve the original promise

    // Handle the queued message (fire and forget -- errors handled internally)
    this.handleMessage(next.message).catch((error) => {
      logger.error({ error }, "Error handling queued message");
    });
  }
}
