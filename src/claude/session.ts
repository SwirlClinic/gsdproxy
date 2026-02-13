import { spawn, ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClaudeStreamEvent, SessionOptions, SessionState } from "./types.js";
import { logger } from "../logger.js";

/**
 * ClaudeSession manages a single persistent Claude CLI process using
 * `claude -p --input-format stream-json --output-format stream-json`.
 *
 * The process stays alive across multiple messages. Each call to sendMessage()
 * writes a user message to stdin and yields parsed NDJSON events from stdout
 * until a `result` event marks end of turn.
 *
 * A generation counter ensures that when the process is destroyed and respawned,
 * any active generators from the old process cleanly terminate.
 */
export class ClaudeSession {
  private proc: ChildProcess | null = null;
  private _state: SessionState = "dead";
  private _sessionId: string | null = null;
  private _totalCostUsd = 0;
  private readonly cwd: string;
  private readonly ipcPort: number;
  private readonly dangerouslySkipPermissions: boolean;

  // Event pump internals
  private eventQueue: ClaudeStreamEvent[] = [];
  private eventWaiter: (() => void) | null = null;
  private generation = 0;

  constructor(options: SessionOptions) {
    this.cwd = options.cwd;
    this.ipcPort = options.ipcPort;
    this.dangerouslySkipPermissions = options.dangerouslySkipPermissions ?? false;
  }

  /**
   * Spawn the persistent Claude process.
   * Reuses the same MCP config logic that process.ts used for the permission server.
   */
  spawn(): void {
    // Kill any existing process
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }

    this.generation++;
    this.eventQueue = [];
    this._sessionId = null;
    this._totalCostUsd = 0;

    // Base args (always present)
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];

    if (this.dangerouslySkipPermissions) {
      // Skip all permission-related flags -- Claude auto-approves everything
      args.push("--dangerously-skip-permissions");
    } else {
      // Build MCP config for permission server
      const thisDir = path.dirname(fileURLToPath(import.meta.url));
      const projectRoot = path.resolve(thisDir, "../..");
      const tsxBin = path.resolve(projectRoot, "node_modules/.bin/tsx");
      const permissionServerPath = path.resolve(
        thisDir,
        "../mcp/permission-server.ts"
      );

      const mcpConfig = JSON.stringify({
        mcpServers: {
          permsrv: {
            command: tsxBin,
            args: [permissionServerPath],
            env: { GSD_IPC_PORT: String(this.ipcPort) },
          },
        },
      });

      args.push(
        "--allowedTools",
        "Read",
        "Glob",
        "Grep",
        "--mcp-config",
        mcpConfig,
        "--permission-prompt-tool",
        "mcp__permsrv__permission_prompt"
      );
    }

    // Strip CLAUDECODE env var to prevent nested-session detection
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    this.proc = spawn("claude", args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanEnv,
    });

    this._state = "idle";
    const gen = this.generation;

    // Suppress stdin errors (e.g. writing after process exits)
    this.proc.stdin!.on("error", (err) => {
      if (this.generation !== gen) return;
      logger.warn({ err: err.message }, "Claude stdin error");
    });

    // Background event pump: readline on stdout
    this.startEventPump(gen);

    // Handle process exit
    this.proc.on("exit", (code, signal) => {
      if (this.generation !== gen) return;
      logger.info({ code, signal }, "Claude process exited");
      this._state = "dead";
      this.wakeWaiter();
    });

    // Log stderr
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      if (this.generation !== gen) return;
      const text = chunk.toString().trim();
      if (text) {
        logger.debug({ stderr: text }, "Claude stderr");
      }
    });

    logger.info({ dangerouslySkipPermissions: this.dangerouslySkipPermissions }, "Claude persistent session spawned");
  }

  /**
   * Start the background NDJSON event pump on stdout.
   * Parses each line as JSON and pushes into the event queue.
   * Guarded by generation to ignore events from stale processes.
   */
  private startEventPump(gen: number): void {
    if (!this.proc?.stdout) return;

    const rl = createInterface({
      input: this.proc.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      if (this.generation !== gen) return;

      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const event = JSON.parse(trimmed) as ClaudeStreamEvent;
        this.eventQueue.push(event);
        this.wakeWaiter();
      } catch {
        logger.warn({ line: trimmed }, "Failed to parse stream-json line");
      }
    });
  }

  /**
   * Wake up any consumer waiting for events.
   */
  private wakeWaiter(): void {
    if (this.eventWaiter) {
      const resolve = this.eventWaiter;
      this.eventWaiter = null;
      resolve();
    }
  }

  /**
   * Send a message to the persistent Claude process.
   * Async generator that yields stream events until a `result` event marks
   * end of turn. Auto-respawns if the session is dead.
   */
  async *sendMessage(text: string): AsyncGenerator<ClaudeStreamEvent> {
    if (this._state === "dead") {
      this.spawn();
    }

    if (!this.proc?.stdin?.writable) {
      throw new Error("Claude process stdin not available");
    }

    this._state = "processing";
    const gen = this.generation;

    // Write the user message to stdin in stream-json format
    const input = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text }],
      },
    });
    this.proc.stdin.write(input + "\n");

    // Drain events until we see a result event or the generation changes
    while (gen === this.generation) {
      // Wait for events if queue is empty and process is alive
      while (
        this.eventQueue.length === 0 &&
        this.isAlive() &&
        gen === this.generation
      ) {
        await new Promise<void>((resolve) => {
          this.eventWaiter = resolve;
        });
      }

      // Bail if generation changed (destroy + respawn)
      if (gen !== this.generation) break;

      // Bail if dead with empty queue
      if (!this.isAlive() && this.eventQueue.length === 0) break;

      // Safety: no events available
      if (this.eventQueue.length === 0) break;

      const event = this.eventQueue.shift()!;

      // Track session metadata
      if (event.type === "system" && event.subtype === "init") {
        this._sessionId = event.session_id;
      }

      if (event.type === "result") {
        if (event.total_cost_usd !== undefined) {
          this._totalCostUsd = event.total_cost_usd;
        }
        if (this.isAlive()) {
          this._state = "idle";
        }
        yield event;
        break;
      }

      yield event;
    }
  }

  /**
   * Abort the current turn by sending SIGINT.
   * Claude CLI treats SIGINT as a turn abort — it emits a result event
   * and the process stays alive for the next message.
   */
  abortTurn(): boolean {
    if (this.proc && this._state === "processing") {
      this.proc.kill("SIGINT");
      return true;
    }
    return false;
  }

  /**
   * Destroy the session entirely. Kills the process.
   * Used for /new (fresh session) and shutdown.
   */
  destroy(): void {
    const hadProcess = !!this.proc;

    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }

    this._state = "dead";
    this._sessionId = null;
    this._totalCostUsd = 0;
    this.eventQueue = [];
    this.generation++; // Invalidate any active generators
    this.wakeWaiter();

    if (hadProcess) {
      logger.info("Claude session destroyed");
    }
  }

  /**
   * Check if the session process is alive.
   */
  isAlive(): boolean {
    return this._state !== "dead";
  }

  /**
   * Get session info for status display.
   */
  getInfo(): {
    state: SessionState;
    sessionId: string | null;
    totalCostUsd: number;
  } {
    return {
      state: this._state,
      sessionId: this._sessionId,
      totalCostUsd: this._totalCostUsd,
    };
  }
}
