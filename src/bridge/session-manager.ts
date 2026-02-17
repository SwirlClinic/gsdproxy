import crypto from "node:crypto";
import { ClaudeSession } from "../claude/session.js";
import type { ManagedSession, SessionOptions, ResultEvent } from "../claude/types.js";
import { logger } from "../logger.js";

/**
 * SessionManager is the multi-session registry that maps Discord thread IDs
 * to independent ManagedSession instances. Each ManagedSession wraps a
 * ClaudeSession (persistent CLI process) along with per-session metadata
 * (cost, tokens, timing, processing state).
 *
 * BridgeRouter delegates all session lifecycle operations to SessionManager.
 */
export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly sessionOptions: SessionOptions;

  constructor(sessionOptions: SessionOptions) {
    this.sessionOptions = sessionOptions;
  }

  // ── Lifecycle methods ────────────────────────────────────────────────────

  /**
   * Create a new session for a Discord thread.
   * Spawns a fresh ClaudeSession process and registers the session in the map.
   * If cwdOverride is provided, the session runs in that directory instead of the default.
   */
  createSession(threadId: string, threadUrl: string, cwdOverride?: string): ManagedSession {
    // Destroy existing session for this thread if one exists
    if (this.sessions.has(threadId)) {
      logger.warn({ threadId }, "Session already exists for thread, destroying old one");
      this.destroySession(threadId);
    }

    const options = cwdOverride
      ? { ...this.sessionOptions, cwd: cwdOverride }
      : this.sessionOptions;
    const claudeSession = new ClaudeSession(options);
    claudeSession.spawn();

    const now = new Date();
    const session: ManagedSession = {
      id: crypto.randomUUID(),
      claudeSession,
      threadId,
      threadUrl,
      startedAt: now,
      messageCount: 0,
      lastActivityAt: now,
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      isProcessing: false,
    };

    this.sessions.set(threadId, session);
    logger.info({ sessionId: session.id, threadId }, "Session created");

    return session;
  }

  /**
   * Destroy a session by thread ID. Kills the Claude process and removes
   * the session from the registry.
   * Returns the destroyed session, or undefined if not found.
   */
  destroySession(threadId: string): ManagedSession | undefined {
    const session = this.sessions.get(threadId);
    if (!session) return undefined;

    session.claudeSession.destroy();
    this.sessions.delete(threadId);
    logger.info(
      { sessionId: session.id, threadId, messageCount: session.messageCount },
      "Session destroyed"
    );

    return session;
  }

  /**
   * Destroy all sessions. Returns the number of sessions destroyed.
   */
  destroyAllSessions(): number {
    const count = this.sessions.size;
    for (const [threadId, session] of this.sessions) {
      session.claudeSession.destroy();
      logger.info({ sessionId: session.id, threadId }, "Session destroyed (bulk)");
    }
    this.sessions.clear();
    return count;
  }

  // ── Lookup methods ───────────────────────────────────────────────────────

  /**
   * Get a session by Discord thread ID.
   */
  getSession(threadId: string): ManagedSession | undefined {
    return this.sessions.get(threadId);
  }

  /**
   * Get all active sessions.
   */
  getAllSessions(): ManagedSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get the number of active sessions.
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get the most recently active session (highest lastActivityAt).
   * Returns undefined if no sessions exist.
   */
  getMostRecentSession(): ManagedSession | undefined {
    if (this.sessions.size === 0) return undefined;

    return Array.from(this.sessions.values())
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())[0];
  }

  /**
   * Check if any sessions exist.
   */
  hasAnySessions(): boolean {
    return this.sessions.size > 0;
  }

  // ── Cost tracking ────────────────────────────────────────────────────────

  /**
   * Update a session's cost and token fields from a ResultEvent.
   *
   * - totalCostUsd: assigned (not added) -- it's cumulative per CLI process
   * - totalInputTokens / totalOutputTokens: accumulated per turn
   */
  updateSessionCosts(threadId: string, result: ResultEvent): void {
    const session = this.sessions.get(threadId);
    if (!session) return;

    if (result.total_cost_usd !== undefined) {
      session.totalCostUsd = result.total_cost_usd;
    }

    if (result.usage) {
      session.totalInputTokens += result.usage.input_tokens;
      session.totalOutputTokens += result.usage.output_tokens;
    }
  }
}

export type { ManagedSession } from "../claude/types.js";
