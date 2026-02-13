---
phase: 02-interactive-proxy
plan: 04
subsystem: bridge
tags: [discord-threads, streaming, debounce, ipc-integration, permission-handling, summary-formatting]

# Dependency graph
requires:
  - phase: 01-bot-claude-connection
    provides: "Discord bot framework, Claude CLI subprocess spawning, formatter, bridge router"
  - phase: 02-interactive-proxy
    plan: 01
    provides: "IPC server, MCP permission server, IPC client"
  - phase: 02-interactive-proxy
    plan: 02
    provides: "PermissionHandler, permission prompt components, question prompt components"
  - phase: 02-interactive-proxy
    plan: 03
    provides: "Claude CLI --mcp-config and --permission-prompt-tool wiring"
provides:
  - "StreamingMessage utility for debounced Discord message editing with truncation"
  - "Thread-per-session model: each Claude interaction gets a Discord thread"
  - "Main channel summary with thread link (truncated at 1500 chars)"
  - "Full IPC permission pipeline: Claude -> MCP -> IPC -> Discord buttons -> response -> Claude"
  - "IPC server lifecycle wired into bot startup/shutdown"
affects: [03-session-persistence, future-enhancements]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Debounced message editing for Discord rate limit compliance", "Thread-per-session for organized output", "Summary-in-channel + detail-in-thread split", "IPC event-driven permission flow integrated into router"]

key-files:
  created:
    - src/bridge/streaming-message.ts
  modified:
    - src/bridge/router.ts
    - src/index.ts
    - src/discord/formatter.ts
    - src/bridge/permission-handler.ts
    - src/claude/process.ts

key-decisions:
  - "1.5s debounce interval for streaming edits -- safe margin below Discord rate limits"
  - "1800 char max display length (100-char buffer below Discord 2000 limit) for streaming messages"
  - "1500 char threshold for main channel summary truncation with thread link"
  - "tsx binary path for MCP server (not node + .js) -- tsx handles TypeScript directly in dev"
  - "Strip CLAUDECODE env var from subprocess to prevent nested session detection"

patterns-established:
  - "StreamingMessage pattern: appendText + debounced edit + flush for real-time display"
  - "Thread-per-session: each handleMessage creates a Discord thread, posts streaming there, summary in main channel"
  - "Permission flow integration: IPC server permission-request event -> router -> PermissionHandler -> resolve callback"

# Metrics
duration: 3min (execution) + checkpoint verification
completed: 2026-02-13
---

# Phase 2 Plan 4: Thread Integration, Streaming, and IPC Wiring Summary

**Discord thread-per-session with debounced streaming output, IPC permission button flow, and main channel summary formatting -- completing the full interactive proxy pipeline**

## Performance

- **Duration:** 3 min (code execution), plus overnight human verification checkpoint
- **Started:** 2026-02-13T00:28:30Z
- **Completed:** 2026-02-13T17:16:13Z (including checkpoint wait)
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify)
- **Files modified:** 6

## Accomplishments
- StreamingMessage utility class with 1.5s debounced edits, 1800-char truncation, and flush for real-time Discord output
- BridgeRouter rewritten: thread creation per session, streaming display in thread, concise summary in main channel with thread link
- Full IPC permission pipeline integrated: permission requests from Claude route through MCP server -> IPC -> Discord buttons -> user decision flows back to Claude
- IPC server lifecycle wired into bot startup (start before Discord login) and shutdown (stop before client destroy)
- formatSummary utility for main channel messages with smart truncation at paragraph/line/space boundaries

## Task Commits

Each task was committed atomically:

1. **Task 1: Create StreamingMessage utility class** - `ba18321` (feat)
2. **Task 2: Rewrite router with threads, streaming, IPC, and update index.ts wiring** - `57a29d7` (feat)
3. **Task 3: End-to-end verification** - checkpoint:human-verify (approved)

**Bug fix during verification:** `efaab63` (fix)

## Files Created/Modified
- `src/bridge/streaming-message.ts` - StreamingMessage class with appendText, flush, setStatus, debounced doEdit at 1.5s intervals
- `src/bridge/router.ts` - Rewritten with thread creation, StreamingMessage integration, IPC permission event handling, summary posting
- `src/index.ts` - IPC server creation, startup, shutdown wiring; PermissionHandler instantiation
- `src/discord/formatter.ts` - Added formatSummary function for main channel messages with 1500-char smart truncation
- `src/bridge/permission-handler.ts` - Updated to accept TextBasedChannel type for thread targeting
- `src/claude/process.ts` - Fixed MCP server path to use tsx binary + .ts extension; stripped CLAUDECODE env var

## Decisions Made
- 1.5-second debounce for streaming message edits provides safe margin below Discord's rate limits while still feeling responsive
- 1800-char max display in streaming messages leaves 100-char buffer below Discord's 2000-char limit for safety
- 1500-char threshold for main channel summary truncation -- shorter messages show inline, longer ones get truncated with thread link
- MCP server must be invoked with tsx binary (not node) and .ts extension in dev mode, since the permission server is TypeScript
- CLAUDECODE environment variable must be stripped from subprocess env to prevent Claude CLI from detecting a "nested session" and refusing to run

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] MCP server path used wrong binary and extension**
- **Found during:** Task 3 (human verification checkpoint)
- **Issue:** process.execPath resolved to node binary, and path resolved to .js extension, but tsx is needed for TypeScript source files in dev mode
- **Fix:** Hardcoded tsx binary path resolution and used .ts extension for permission-server
- **Files modified:** src/claude/process.ts
- **Verification:** Bot starts, MCP server spawns successfully, permission prompts appear
- **Committed in:** efaab63

**2. [Rule 1 - Bug] CLAUDECODE env var caused nested session detection**
- **Found during:** Task 3 (human verification checkpoint)
- **Issue:** Claude CLI detected CLAUDECODE environment variable inherited from parent process and refused to start (nested session guard)
- **Fix:** Stripped CLAUDECODE from the subprocess environment variables
- **Files modified:** src/claude/process.ts
- **Verification:** Claude CLI spawns successfully without nested session error
- **Committed in:** efaab63

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both were runtime bugs discovered during live testing. Essential fixes for the proxy to function at all. No scope creep.

## Issues Encountered
- MCP server path resolution was the primary integration hurdle -- the plan assumed process.execPath and .js extension would work, but tsx dev mode requires explicit tsx binary and .ts source files
- Nested session detection was an undocumented Claude CLI behavior where inheriting the CLAUDECODE env var triggers a guard preventing subprocess spawning

## User Setup Required
None - no additional configuration beyond existing .env setup.

## Next Phase Readiness
- Phase 2 is fully complete: all four plans delivered
- Full interactive proxy working end-to-end: Discord message -> thread creation -> streaming output -> permission buttons -> user decision -> Claude continues -> summary in main channel
- Ready for Phase 3: Session Persistence (if planned) -- session IDs are already tracked, thread model provides natural session boundaries

## Verification Results (Checkpoint Approved)
All verification points passed during human testing:
- [x] Thread creation on message
- [x] Permission buttons (Allow/Deny) appear in thread
- [x] Permission decisions flow back to Claude
- [x] Main channel summary with thread link
- [x] Write tool permission prompt displayed correctly
- [x] Session continuity (same session ID on follow-up messages)

## Self-Check: PASSED

All artifacts verified:
- [x] src/bridge/streaming-message.ts exists
- [x] src/bridge/router.ts exists
- [x] src/index.ts exists
- [x] src/discord/formatter.ts exists
- [x] src/bridge/permission-handler.ts exists
- [x] src/claude/process.ts exists
- [x] Commit ba18321 exists
- [x] Commit 57a29d7 exists
- [x] Commit efaab63 exists
- [x] 02-04-SUMMARY.md exists

---
*Phase: 02-interactive-proxy*
*Completed: 2026-02-13*
