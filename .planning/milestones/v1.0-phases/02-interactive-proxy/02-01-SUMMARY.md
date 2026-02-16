---
phase: 02-interactive-proxy
plan: 01
subsystem: ipc
tags: [mcp, modelcontextprotocol, zod, http-ipc, permission-prompt, stdio-transport]

# Dependency graph
requires:
  - phase: 01-bot-claude-connection
    provides: "Claude CLI subprocess spawning (process.ts), project structure"
provides:
  - "MCP permission server entry point (permission-server.ts) with permission_prompt tool"
  - "HTTP IPC client (ipc-client.ts) for MCP-to-bot communication"
  - "HTTP IPC server (ipc-server.ts) for bot-side permission request handling"
  - "PermissionRequest and PermissionDecision shared types"
affects: [02-02, 02-03, 02-04]

# Tech tracking
tech-stack:
  added: ["@modelcontextprotocol/sdk@1.26.0", "zod@4.3.6"]
  patterns: ["MCP stdio transport for Claude CLI subprocess", "HTTP IPC bridge between separate processes", "EventEmitter with typed events for permission request/response", "Pending request tracking with Map for cleanup"]

key-files:
  created:
    - src/mcp/permission-server.ts
    - src/mcp/ipc-client.ts
    - src/bridge/ipc-server.ts
  modified:
    - package.json

key-decisions:
  - "Fixed IPC port 9824 (configurable via GSD_IPC_PORT env var) rather than dynamic port 0 -- simpler for MCP subprocess env passing"
  - "6-minute fetch timeout in IPC client (longer than 5-min Discord button timeout) so bot controls deny-on-timeout"
  - "console.error only in MCP server -- stdout reserved for MCP JSON-RPC stdio transport"
  - "Typed EventEmitter via declaration merging for type-safe permission-request event handling"

patterns-established:
  - "MCP permission server as standalone entry point: process.ts will spawn it via --mcp-config"
  - "IPC bridge pattern: MCP -> HTTP POST -> EventEmitter -> resolve callback -> HTTP response -> MCP"
  - "Pending request Map<tool_use_id, {res, resolve}> for cleanup on server shutdown"

# Metrics
duration: 2min
completed: 2026-02-12
---

# Phase 2 Plan 1: MCP Permission Server + IPC Bridge Summary

**MCP permission server with stdio transport and HTTP IPC bridge for Claude CLI tool approval forwarding to Discord bot process**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-13T00:19:09Z
- **Completed:** 2026-02-13T00:21:04Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- MCP permission server entry point that Claude CLI spawns via --mcp-config, registers permission_prompt tool with Zod schema, and connects via StdioServerTransport
- HTTP IPC client with 6-minute timeout and automatic deny-on-failure for reliable MCP-to-bot communication
- HTTP IPC server in bot process with typed EventEmitter, pending request tracking, and clean shutdown behavior

## Task Commits

Each task was committed atomically:

1. **Task 1: Install MCP deps and create MCP permission server with IPC client** - `2ec4db5` (feat)
2. **Task 2: Create IPC server for bot process** - `19bcedd` (feat)

## Files Created/Modified
- `src/mcp/permission-server.ts` - Standalone MCP server entry point with permission_prompt tool, stdio transport, SIGTERM handling
- `src/mcp/ipc-client.ts` - HTTP POST client with AbortController timeout, exports PermissionRequest/PermissionDecision types
- `src/bridge/ipc-server.ts` - HTTP server on 127.0.0.1, typed EventEmitter, pending request Map, auto-deny on shutdown
- `package.json` - Added @modelcontextprotocol/sdk and zod dependencies

## Decisions Made
- Fixed IPC port 9824 (via GSD_IPC_PORT env var) rather than dynamic port 0 -- the MCP server needs the port via env var at spawn time, and dynamic discovery would add complexity
- 6-minute fetch timeout in IPC client is intentionally longer than the 5-minute Discord button timeout, ensuring the bot (not the HTTP client) controls the deny-on-timeout behavior
- All MCP server logging uses console.error to protect the stdout MCP transport channel
- Typed EventEmitter via TypeScript declaration merging for compile-time safety on permission-request event handlers

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- MCP permission server ready for wiring into process.ts (Plan 02: --mcp-config and --permission-prompt-tool flags)
- IPC server ready for integration in bot startup (Plan 02: start IPC server before Claude spawn)
- Permission-request event ready for Discord button handler (Plan 03: permission-handler.ts)

## Self-Check: PASSED

All artifacts verified:
- [x] src/mcp/permission-server.ts exists
- [x] src/mcp/ipc-client.ts exists
- [x] src/bridge/ipc-server.ts exists
- [x] Commit 2ec4db5 exists
- [x] Commit 19bcedd exists
- [x] SUMMARY.md exists

---
*Phase: 02-interactive-proxy*
*Completed: 2026-02-12*
