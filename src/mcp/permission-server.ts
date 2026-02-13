#!/usr/bin/env node
// ── MCP Permission Server ────────────────────────────────────────────────────
//
// STANDALONE entry point -- spawned by Claude CLI as a subprocess via
// --mcp-config. Communicates with Claude Code over stdio (JSON-RPC) and
// with the Discord bot over HTTP (via ipc-client).
//
// CRITICAL: Never use console.log -- stdout is the MCP transport channel.
// All logging MUST go through console.error.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { forwardPermissionRequest } from "./ipc-client.js";

const IPC_PORT = parseInt(process.env.GSD_IPC_PORT || "9824", 10);

const server = new McpServer({
  name: "gsdproxy-permissions",
  version: "1.0.0",
});

// Register the permission_prompt tool that Claude CLI will call for every
// tool that is not auto-approved via --allowedTools.
server.tool(
  "permission_prompt",
  "Handle permission requests from Claude CLI",
  {
    tool_use_id: z.string(),
    tool_name: z.string(),
    input: z.any(),
  },
  async ({ tool_use_id, tool_name, input }) => {
    console.error(
      `[gsdproxy-mcp] Permission request: ${tool_name} (${tool_use_id})`
    );

    const decision = await forwardPermissionRequest(IPC_PORT, {
      tool_use_id,
      tool_name,
      input,
    });

    console.error(
      `[gsdproxy-mcp] Decision for ${tool_use_id}: ${decision.behavior}`
    );

    return {
      content: [{ type: "text" as const, text: JSON.stringify(decision) }],
    };
  }
);

// Connect via stdio transport (JSON-RPC over stdin/stdout)
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("[gsdproxy-mcp] Permission server started, connected via stdio");

// Graceful shutdown on SIGTERM (sent when Claude CLI exits)
process.on("SIGTERM", async () => {
  console.error("[gsdproxy-mcp] Received SIGTERM, shutting down");
  await server.close();
  process.exit(0);
});
