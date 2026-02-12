import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";
import type { ClaudeStreamEvent } from "./types.js";
import { logger } from "../logger.js";

/**
 * Parse the NDJSON stream from a Claude CLI subprocess as an async generator.
 *
 * Uses readline.createInterface to handle partial lines correctly.
 * Malformed lines are logged as warnings but never crash the generator.
 * The generator naturally completes when the readline interface closes
 * (i.e., when the Claude process exits).
 */
export async function* parseStream(
  proc: ChildProcess
): AsyncGenerator<ClaudeStreamEvent> {
  const rl = createInterface({
    input: proc.stdout!,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      yield JSON.parse(trimmed) as ClaudeStreamEvent;
    } catch {
      logger.warn({ line: trimmed }, "Failed to parse stream-json line");
    }
  }
}

/**
 * Capture all stderr output from a Claude CLI subprocess.
 * Useful for error reporting if the process exits with a non-zero code.
 */
export function captureStderr(proc: ChildProcess): Promise<string> {
  return new Promise<string>((resolve) => {
    let output = "";

    if (!proc.stderr) {
      resolve("");
      return;
    }

    proc.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.stderr.on("end", () => {
      resolve(output);
    });

    proc.stderr.on("error", () => {
      resolve(output);
    });
  });
}
