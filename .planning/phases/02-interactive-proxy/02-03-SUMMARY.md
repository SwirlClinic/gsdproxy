---
phase: 02-interactive-proxy
plan: 03
subsystem: bridge
tags: [claude-cli, mcp-config, permission-prompt-tool, ipc, subprocess-spawning]

# Dependency graph
requires:
  - phase: 01-bot-claude-connection
    provides: "Claude CLI subprocess spawning (process.ts), config.ts, SpawnOptions type"
  - phase: 02-interactive-proxy
    plan: 01
    provides: "MCP permission server (permission-server.ts), IPC client/server"
provides:
  - "Claude CLI spawning with --mcp-config and --permission-prompt-tool flags"
  - "IPC port configuration via GSD_IPC_PORT env var with default 9824"
  - "End-to-end wiring: config -> SpawnOptions -> MCP config env -> permission server process"
affects: [02-04, router, integration-testing]

# Tech tracking
tech-stack:
  added: []
  patterns: ["import.meta.url path resolution for sibling module references", "process.execPath for consistent Node.js binary across dev/prod"]

key-files:
  created: []
  modified:
    - src/config.ts
    - src/claude/types.ts
    - src/claude/process.ts
    - src/bridge/router.ts
    - .env.example

key-decisions:
  - "import.meta.url for resolving permission-server.js path -- works in both tsx dev and compiled dist/"
  - "process.execPath for MCP server command -- ensures same Node.js binary (node or tsx) runs the permission server"
  - "MCP config passed as JSON string directly to --mcp-config (not a file path)"
  - "config.ipcPort imported directly in router.ts rather than threading through constructor"

patterns-established:
  - "MCP config inline JSON pattern: build JSON.stringify config object and pass to --mcp-config flag"
  - "Relative module resolution via import.meta.url + path.dirname for sibling directory references"

# Metrics
duration: 2min
completed: 2026-02-12
---

# Phase 2 Plan 3: Claude CLI MCP Wiring Summary

**Claude CLI subprocess wired with --mcp-config and --permission-prompt-tool flags to route tool approvals through MCP permission server via IPC**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-13T00:23:36Z
- **Completed:** 2026-02-13T00:25:21Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- IPC port configuration (GSD_IPC_PORT) with default 9824, exported from config.ts and threaded through SpawnOptions
- Claude CLI process now spawns with --mcp-config pointing to the compiled permission-server.js, passing GSD_IPC_PORT to the MCP server subprocess
- --permission-prompt-tool mcp__permsrv__permission_prompt flag routes all tool approval requests through the MCP permission server

## Task Commits

Each task was committed atomically:

1. **Task 1: Add IPC port config and update SpawnOptions type** - `1472e8c` (feat)
2. **Task 2: Add MCP config and permission-prompt-tool flags to Claude CLI spawning** - `a45d452` (feat)

## Files Created/Modified
- `src/config.ts` - Added ipcPort with default 9824 from GSD_IPC_PORT env var
- `src/claude/types.ts` - Added required ipcPort: number to SpawnOptions interface
- `src/claude/process.ts` - Added MCP config JSON construction, --mcp-config and --permission-prompt-tool flags
- `src/bridge/router.ts` - Pass config.ipcPort to spawnClaude call (Rule 3 fix)
- `.env.example` - Documented optional GSD_IPC_PORT variable

## Decisions Made
- Used import.meta.url + path.dirname for resolving permission-server.js path, which works correctly in both tsx dev mode and compiled dist/ directory
- Used process.execPath for the MCP server command to ensure the same Node.js binary runs the permission server (handles tsx vs node cases)
- MCP config is passed as inline JSON string to --mcp-config (Claude CLI accepts both file paths and JSON strings)
- Imported config directly in router.ts rather than propagating ipcPort through the BridgeRouter constructor -- simpler and the port is a global config value

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated router.ts spawnClaude call with ipcPort**
- **Found during:** Task 1 (SpawnOptions type update)
- **Issue:** Adding required ipcPort to SpawnOptions caused TypeScript error in router.ts where spawnClaude was called without ipcPort
- **Fix:** Imported config in router.ts and passed config.ipcPort to the spawnClaude options
- **Files modified:** src/bridge/router.ts
- **Verification:** npx tsc --noEmit passes
- **Committed in:** 1472e8c (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix for type correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - GSD_IPC_PORT is optional with a sensible default of 9824.

## Next Phase Readiness
- Claude CLI now routes permission requests through MCP permission server
- IPC port flows end-to-end: config.ts -> SpawnOptions -> MCP config env -> permission server subprocess
- Ready for Plan 04: integration wiring (IPC server startup, permission handler connection, full pipeline test)

## Self-Check: PASSED

All artifacts verified:
- [x] src/config.ts exists
- [x] src/claude/types.ts exists
- [x] src/claude/process.ts exists
- [x] src/bridge/router.ts exists
- [x] .env.example exists
- [x] Commit 1472e8c exists
- [x] Commit a45d452 exists
- [x] SUMMARY.md exists

---
*Phase: 02-interactive-proxy*
*Completed: 2026-02-12*
