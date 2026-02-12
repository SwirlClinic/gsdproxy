import { spawn, ChildProcess } from "node:child_process";
import type { SpawnOptions } from "./types.js";

/**
 * Spawn a Claude CLI subprocess with the correct flags for stream-json output.
 *
 * Uses: --output-format stream-json, --verbose, --include-partial-messages,
 *       --allowedTools for read-only auto-approval (Read, Glob, Grep).
 *
 * If continueSession is true, prepends --continue for follow-up messages.
 * If sessionId is provided, prepends --resume <sessionId>.
 */
export function spawnClaude(
  prompt: string,
  options: SpawnOptions
): ChildProcess {
  const args: string[] = [];

  // Session continuity flags (must come before -p)
  if (options.continueSession) {
    args.push("--continue");
  } else if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }

  // Core flags
  args.push(
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--allowedTools",
    "Read",
    "Glob",
    "Grep"
  );

  return spawn("claude", args, {
    cwd: options.cwd,
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  });
}
