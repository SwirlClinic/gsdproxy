// ── IPC Server: Bot-side HTTP server for MCP permission requests ─────────────
//
// Runs inside the Discord bot process. Listens on 127.0.0.1:<port> for HTTP
// POST requests from the MCP permission server. On each request, emits a
// "permission-request" event that downstream handlers (permission-handler.ts)
// can listen to. The handler resolves the request by calling the provided
// callback, which writes the HTTP response back to the MCP server.

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { Server } from "node:http";
import { EventEmitter } from "node:events";
import type {
  PermissionRequest,
  PermissionDecision,
} from "../mcp/ipc-client.js";

// ── Typed EventEmitter ──────────────────────────────────────────────────────

export interface IpcServerEvents {
  "permission-request": (
    request: PermissionRequest,
    resolve: (decision: PermissionDecision) => void
  ) => void;
}

export declare interface IpcServer {
  on<K extends keyof IpcServerEvents>(
    event: K,
    listener: IpcServerEvents[K]
  ): this;
  emit<K extends keyof IpcServerEvents>(
    event: K,
    ...args: Parameters<IpcServerEvents[K]>
  ): boolean;
  removeAllListeners<K extends keyof IpcServerEvents>(event?: K): this;
}

// ── IpcServer class ─────────────────────────────────────────────────────────

export class IpcServer extends EventEmitter {
  private server: Server;
  private port: number;
  private pendingRequests = new Map<
    string,
    { res: ServerResponse; resolve: (decision: PermissionDecision) => void }
  >();

  constructor(port: number) {
    super();
    this.port = port;
    this.server = createServer(this.handleRequest.bind(this));
  }

  /**
   * Start the HTTP server, listening on 127.0.0.1 (loopback only).
   * Resolves when the server is actively listening.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, "127.0.0.1", () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server. Any pending permission requests are automatically
   * denied so the MCP server does not hang indefinitely.
   */
  async stop(): Promise<void> {
    // Reject all pending requests with deny
    for (const [id, pending] of this.pendingRequests) {
      try {
        const deny: PermissionDecision = {
          behavior: "deny",
          message: "IPC server shutting down",
        };
        pending.res.writeHead(200, { "Content-Type": "application/json" });
        pending.res.end(JSON.stringify(deny));
        pending.resolve(deny);
      } catch {
        // Response may already be closed
      }
      this.pendingRequests.delete(id);
    }

    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Handle an incoming HTTP request. Only POST /permission is accepted.
   */
  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    if (req.method !== "POST" || req.url !== "/permission") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    try {
      const body = await readBody(req);
      const request = JSON.parse(body) as PermissionRequest;

      // Check if anyone is listening for permission-request events
      if (this.listenerCount("permission-request") === 0) {
        const deny: PermissionDecision = {
          behavior: "deny",
          message: "No permission handler registered",
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(deny));
        return;
      }

      // Create a resolve callback that writes the HTTP response
      const resolveCallback = (decision: PermissionDecision): void => {
        this.pendingRequests.delete(request.tool_use_id);
        try {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(decision));
        } catch {
          // Response may already be closed
        }
      };

      // Track the pending request for cleanup on stop()
      this.pendingRequests.set(request.tool_use_id, {
        res,
        resolve: resolveCallback,
      });

      // Emit the event -- the downstream handler will call resolveCallback
      this.emit("permission-request", request, resolveCallback);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid request body" }));
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read the full request body as a string.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
