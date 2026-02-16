import {
  type Message,
  type TextChannel,
  type ThreadChannel,
  ThreadAutoArchiveDuration,
} from "discord.js";
import {
  splitMessage,
  formatToolActivity,
  formatSummary,
} from "../discord/formatter.js";
import { logger } from "../logger.js";
import { StreamingMessage } from "./streaming-message.js";
import type { SessionManager } from "./session-manager.js";
import type { IpcServer } from "./ipc-server.js";
import type { PermissionHandler } from "./permission-handler.js";
import type {
  PermissionRequest,
  PermissionDecision,
} from "../mcp/ipc-client.js";
import type {
  ClaudeStreamEvent,
  ContentBlockStart,
  ContentBlockDelta,
  ManagedSession,
  ResultEvent,
  TextBlock,
  ToolUseBlock,
} from "../claude/types.js";

/**
 * BridgeRouter is the central orchestration class that bridges Discord messages
 * to Claude CLI subprocesses via SessionManager. It delegates session lifecycle
 * to SessionManager and handles thread creation, streaming output, permission
 * handling, and per-session message routing.
 *
 * Multi-session: Each Discord thread maps to an independent ManagedSession.
 * Messages in the main channel create new threads + sessions. Messages in
 * existing session threads route to the corresponding session.
 */
export class BridgeRouter {
  private readonly sessionManager: SessionManager;
  private readonly ipcServer: IpcServer;
  private readonly permissionHandler: PermissionHandler;

  /**
   * Maps thread IDs to ThreadChannel objects for sessions that are currently
   * processing. Used by permission routing to find the correct thread.
   * Entries are set at the start of handleSessionMessage and removed in finally.
   */
  private readonly activeThreads = new Map<string, ThreadChannel>();

  constructor(
    sessionManager: SessionManager,
    ipcServer: IpcServer,
    permissionHandler: PermissionHandler
  ) {
    this.sessionManager = sessionManager;
    this.ipcServer = ipcServer;
    this.permissionHandler = permissionHandler;

    // Wire IPC permission-request events to the permission handler
    this.ipcServer.on(
      "permission-request",
      (request: PermissionRequest, resolve: (d: PermissionDecision) => void) => {
        this.handlePermissionEvent(request, resolve);
      }
    );
  }

  /**
   * Handle a new message from the main channel.
   * Creates a Discord thread and a new session, then delegates to handleSessionMessage.
   *
   * NOTE: The message is guaranteed to come from the dedicated guild text channel
   * (enforced by the channelId guard in the message handler), so casting to
   * TextChannel is safe.
   */
  async handleNewMessage(message: Message): Promise<void> {
    const channel = message.channel as TextChannel;

    // Create a thread for this session
    const threadName =
      message.content.slice(0, 95) +
      (message.content.length > 95 ? "..." : "");
    let thread: ThreadChannel;
    try {
      thread = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        reason: "Claude session output",
      });
    } catch (err) {
      logger.error({ err }, "Failed to create thread");
      await channel.send("**Error:** Failed to create thread for this session.");
      return;
    }

    // Create a new session for this thread
    const session = this.sessionManager.createSession(thread.id, thread.url);

    await this.handleSessionMessage(message, thread, session);
  }

  /**
   * Handle a message in an existing session thread.
   * Routes the message to the session's ClaudeSession and streams the response.
   *
   * Per-session concurrency: if the session is already processing, rejects
   * with a notice rather than queuing (each session handles one message at a time;
   * the user can send messages to other sessions while one is processing).
   */
  async handleSessionMessage(
    message: Message,
    thread: ThreadChannel,
    session: ManagedSession
  ): Promise<void> {
    const channel = (
      thread.parent ?? message.channel
    ) as TextChannel;

    // Per-session concurrency check
    if (session.isProcessing) {
      await thread.send(
        "*Still working on your previous request in this session. Please wait.*"
      );
      return;
    }

    session.isProcessing = true;
    session.messageCount++;
    session.lastActivityAt = new Date();

    // Track this thread as active for permission routing
    this.activeThreads.set(session.threadId, thread);

    // Post initial status in thread and create StreamingMessage
    let streamingMessage: StreamingMessage;
    try {
      const statusMsg = await thread.send("*Working on it...*");
      streamingMessage = new StreamingMessage(statusMsg);
    } catch (err) {
      logger.error({ err }, "Failed to send initial status in thread");
      session.isProcessing = false;
      this.activeThreads.delete(session.threadId);
      return;
    }

    // Start typing indicator on the main channel
    const stopTyping = this.startTypingLoop(channel);

    try {
      // Track tool state for status messages
      let currentToolName: string | null = null;
      let currentToolJson = "";

      // Stream events from this session's ClaudeSession
      for await (const event of session.claudeSession.sendMessage(message.content)) {
        await this.handleStreamEvent(event, {
          streamingMessage,
          channel,
          thread,
          session,
          onText: (text: string) => {
            streamingMessage.appendText(text);
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

      // Stop typing indicator
      stopTyping();

      // Flush the streaming message (final edit)
      await streamingMessage.flush();

      const accumulatedText = streamingMessage.getAccumulatedText();

      if (accumulatedText) {
        // Post full output to thread via splitMessage
        const chunks = splitMessage(accumulatedText);
        for (const chunk of chunks) {
          await thread.send(chunk);
        }

        // Post summary to main channel with thread link
        const summary = formatSummary(accumulatedText, thread.url);
        await channel.send(summary);
      }
    } catch (error) {
      // Stop typing on any error
      stopTyping();

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
      session.isProcessing = false;
      this.activeThreads.delete(session.threadId);
    }
  }

  /**
   * Handle a single stream event from the Claude process.
   * Text deltas go to StreamingMessage.appendText for debounced display.
   * Tool activity goes to StreamingMessage.setStatus for immediate display.
   * Assistant events use replaceText for complete message snapshots.
   */
  private async handleStreamEvent(
    event: ClaudeStreamEvent,
    ctx: {
      streamingMessage: StreamingMessage;
      channel: TextChannel;
      thread: ThreadChannel;
      session: ManagedSession;
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
          logger.info(
            { sessionId: event.session_id, model: event.model },
            "Claude session initialized"
          );
        }
        break;
      }

      case "assistant": {
        // Complete message snapshot -- use replaceText as a fallback/confirmation
        // of what streaming deltas already accumulated.
        const textContent = event.message.content
          .filter((block): block is TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("");
        if (textContent) {
          ctx.streamingMessage.replaceText(textContent);
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

              // Show initial tool activity via StreamingMessage
              const activity = formatToolActivity(
                toolBlock.name,
                toolBlock.input
              );
              await ctx.streamingMessage.setStatus(activity);
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
                  await ctx.streamingMessage.setStatus(activity);
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

        // Update session cost/token data
        this.sessionManager.updateSessionCosts(ctx.session.threadId, result);

        // If result contains text and nothing was streamed, use it as output.
        // This handles CLI slash commands (/compact, /cost, etc.) whose output
        // only appears in the result event, not as streamed text deltas.
        if (result.result && !ctx.streamingMessage.getAccumulatedText()) {
          ctx.streamingMessage.replaceText(result.result);
        }

        if (result.is_error) {
          const errorText = result.result || "Unknown error";
          await ctx.thread.send(`**Error from Claude:** ${errorText}`);
        } else if (
          result.num_turns !== undefined &&
          result.total_cost_usd !== undefined
        ) {
          const info = `*Completed in ${result.num_turns} turn(s) ($${result.total_cost_usd.toFixed(4)})*`;
          await ctx.thread.send(info);
        }
        break;
      }
    }
  }

  /**
   * Handle a permission request event from the IPC server.
   * Routes the prompt to the correct session's thread using getPermissionThread().
   */
  private handlePermissionEvent(
    request: PermissionRequest,
    resolve: (decision: PermissionDecision) => void
  ): void {
    const targetChannel = this.getPermissionThread();
    if (!targetChannel) {
      logger.warn(
        { toolName: request.tool_name },
        "Permission request received but no active thread or channel"
      );
      resolve({ behavior: "deny", message: "No active session" });
      return;
    }

    // Handle the permission request asynchronously
    this.permissionHandler
      .handlePermissionRequest(request, targetChannel)
      .then((decision) => {
        resolve(decision);
      })
      .catch((err) => {
        logger.error({ err }, "Permission handler error");
        resolve({ behavior: "deny", message: "Permission handler error" });
      });
  }

  /**
   * Find the thread for routing permission requests.
   * Looks at currently processing sessions and returns the thread of the
   * most recently active one. With single-session processing this is
   * deterministic; with concurrent sessions, uses lastActivityAt as tiebreaker.
   */
  private getPermissionThread(): ThreadChannel | null {
    // Find sessions that are currently processing
    const processingSessions = this.sessionManager
      .getAllSessions()
      .filter((s) => s.isProcessing);

    if (processingSessions.length === 0) return null;

    // Sort by lastActivityAt descending (most recent first)
    processingSessions.sort(
      (a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime()
    );

    // Return the cached ThreadChannel for the most recently active processing session
    const targetSession = processingSessions[0];
    return this.activeThreads.get(targetSession.threadId) ?? null;
  }

  /**
   * Abort a session's current turn.
   * If threadId is provided, aborts that specific session.
   * If not provided, aborts all processing sessions.
   * Returns true if any session was aborted.
   */
  abort(threadId?: string): boolean {
    if (threadId) {
      const session = this.sessionManager.getSession(threadId);
      if (session?.isProcessing) {
        session.claudeSession.abortTurn();
        return true;
      }
      return false;
    }

    // Abort all processing sessions
    let aborted = false;
    for (const session of this.sessionManager.getAllSessions()) {
      if (session.isProcessing) {
        session.claudeSession.abortTurn();
        aborted = true;
      }
    }
    return aborted;
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
}
