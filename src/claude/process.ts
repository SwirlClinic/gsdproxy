import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SpawnOptions } from "./types.js";

/**
 * Spawn a Claude CLI subprocess with the correct flags for stream-json output.
 *
 * Uses: --output-format stream-json, --verbose, --include-partial-messages,
 *       --allowedTools for read-only auto-approval (Read, Glob, Grep),
 *       --mcp-config for the permission server, and
 *       --permission-prompt-tool to route tool approvals through MCP.
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

  // Build MCP config for permission server
  const mcpConfig = JSON.stringify({
    mcpServers: {
      permsrv: {
        command: process.execPath,
        args: [path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../mcp/permission-server.js"
        )],
        env: {
          GSD_IPC_PORT: String(options.ipcPort),
        },
      },
    },
  });

  // MCP permission routing flags
  args.push(
    "--mcp-config", mcpConfig,
    "--permission-prompt-tool", "mcp__permsrv__permission_prompt",
  );

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
