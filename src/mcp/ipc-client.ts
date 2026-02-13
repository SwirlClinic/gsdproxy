// ── IPC Client: MCP server -> Bot process communication ──────────────────────
//
// Used by the MCP permission server (separate process) to forward permission
// requests to the Discord bot via HTTP POST.

export interface PermissionRequest {
  tool_use_id: string;
  tool_name: string;
  input: unknown;
}

export interface PermissionDecision {
  behavior: "allow" | "deny";
  updatedInput?: unknown;
  message?: string;
}

/**
 * Forward a permission request to the bot's IPC server via HTTP POST.
 *
 * Timeout is set to 6 minutes (360s) -- longer than the 5-minute Discord
 * button timeout so the bot can handle the timeout and return a deny decision
 * rather than having the fetch abort first.
 *
 * On fetch error or timeout, returns a deny decision so Claude does not hang.
 */
export async function forwardPermissionRequest(
  port: number,
  request: PermissionRequest
): Promise<PermissionDecision> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 360_000); // 6 minutes

  try {
    const response = await fetch(`http://127.0.0.1:${port}/permission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    const decision = (await response.json()) as PermissionDecision;
    return decision;
  } catch {
    return { behavior: "deny", message: "IPC communication failed" };
  } finally {
    clearTimeout(timeout);
  }
}
