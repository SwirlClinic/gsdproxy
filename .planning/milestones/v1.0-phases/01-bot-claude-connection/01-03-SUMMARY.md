---
phase: 01-bot-claude-connection
plan: 03
subsystem: bridge
tags: [claude-cli, child-process, ndjson, async-generator, readline, discord-bridge, session-management]

# Dependency graph
requires:
  - phase: 01-01
    provides: "Discord bot scaffold with pluggable callbacks for /status, /stop, /new commands"
  - phase: 01-02
    provides: "splitMessage and formatToolActivity for response formatting and tool status display"
provides:
  - "Full Discord-to-Claude CLI bidirectional bridge via subprocess spawning with stream-json output"
  - "NDJSON stream parser as async generator consuming Claude CLI stdout"
  - "Session continuity via --continue flag for follow-up messages"
  - "Message queuing for concurrent requests with notification"
  - "Graceful shutdown with child process cleanup (no orphaned claude processes)"
  - "TypeScript types for Claude CLI stream-json event format"
affects: [02-interactive-proxy]

# Tech tracking
tech-stack:
  added: [child_process.spawn, readline, async-generators]
  patterns: [NDJSON-stream-parsing-via-readline, discriminated-union-types-for-stream-events, typing-indicator-loop, message-queue-with-sequential-processing, inherited-stdin-for-cli-subprocess]

key-files:
  created:
    - src/claude/types.ts
    - src/claude/process.ts
    - src/claude/parser.ts
    - src/bridge/router.ts
  modified:
    - src/discord/handlers/message.ts
    - src/index.ts

key-decisions:
  - "Inherited stdin (stdio inherit) required for Claude CLI to produce stream-json output -- pipe mode causes silent failure"
  - "Typing indicator loop at 9-second intervals keeps Discord indicator active during long processing"
  - "Status message edited in-place to show tool activity rather than sending multiple messages"
  - "Queue-then-process pattern for concurrent messages with user notification"
  - "Session state tracked via hasSession boolean and sessionId for --continue flag"

patterns-established:
  - "NDJSON parsing: readline.createInterface on proc.stdout with JSON.parse per line, yielded as async generator"
  - "Bridge router as central orchestrator: owns session state, process lifecycle, and message flow"
  - "Graceful shutdown: SIGINT/SIGTERM handlers abort router then destroy Discord client"
  - "Error boundary in handleMessage: catch-all sends error to Discord channel, resets processing state"

# Metrics
duration: ~15min
completed: 2026-02-12
---

# Phase 1 Plan 3: Claude CLI Bridge Summary

**Bidirectional Discord-to-Claude bridge via CLI subprocess spawning with NDJSON stream parsing, session continuity (--continue), tool activity display, message queuing, and graceful shutdown**

## Performance

- **Duration:** ~15 min (across multiple sessions including human verification)
- **Started:** 2026-02-12
- **Completed:** 2026-02-12
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 6

## Accomplishments
- Complete bidirectional bridge: Discord messages forwarded to Claude CLI, streaming responses parsed and sent back formatted
- NDJSON stream parser as async generator consumes Claude CLI stream-json output in real time
- Session continuity: follow-up messages use --continue to maintain Claude conversation context
- Tool activity displayed as italic status messages (e.g., "*Reading /src/auth.ts...*") while Claude works
- Typing indicator active throughout Claude processing
- /stop kills active Claude process, /new resets session, /status shows processing state and session info
- Concurrent messages queued with "*Still working...*" notification, processed sequentially
- Graceful shutdown via SIGINT/SIGTERM kills child processes, no orphaned claude processes
- TypeScript discriminated union types for all Claude CLI stream-json event types

## Task Commits

Each task was committed atomically:

1. **Task 1: Claude CLI types, process spawner, and NDJSON parser** - `3e62209` (feat)
2. **Task 2: Bridge router, handler wiring, and graceful shutdown** - `9704143` (feat)
3. **Task 2 follow-up: Fix inherited stdin for Claude subprocess** - `b72d10a` (fix)

Task 3 was a human-verify checkpoint (no commit needed).

## Files Created/Modified
- `src/claude/types.ts` - TypeScript discriminated union types for stream-json events (SystemInit, StreamEvent, AssistantEvent, ResultEvent, content blocks, deltas)
- `src/claude/process.ts` - spawnClaude function: spawns claude CLI with -p, --output-format stream-json, --verbose, --include-partial-messages, --allowedTools, and optional --continue
- `src/claude/parser.ts` - parseStream async generator: readline-based NDJSON parser yielding typed ClaudeStreamEvents; captureStderr helper for error reporting
- `src/bridge/router.ts` - BridgeRouter class: central orchestrator managing session state, process lifecycle, message queue, typing indicators, tool activity display, and response splitting
- `src/discord/handlers/message.ts` - Updated to call router.handleMessage() instead of placeholder reply, with router passed via setter
- `src/index.ts` - Creates BridgeRouter, wires pluggable callbacks (status/stop/new), registers SIGINT/SIGTERM handlers for graceful shutdown

## Decisions Made
- **Inherited stdin for Claude CLI:** The original plan specified `stdio: ["pipe","pipe","pipe"]` but Claude CLI requires stdin connected to a TTY to produce stream-json output. Changed to `["inherit","pipe","pipe"]`. This is an important finding for any future Claude CLI subprocess work.
- **Typing indicator at 9-second intervals:** Discord typing indicator expires after 10 seconds; 9-second interval with safety margin keeps it continuously active.
- **Status message edit pattern:** A single "*Working on it...*" message is sent at the start and edited in-place as tool activity occurs, avoiding message spam in the channel.
- **Sequential queue processing:** Concurrent messages queued and processed one-at-a-time rather than spawning multiple Claude processes, preventing resource contention.
- **Session state via hasSession boolean:** Simple boolean tracks whether a session exists; first successful message sets it, /new resets it. sessionId captured from system init event.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Claude CLI requires inherited stdin for stream-json output**
- **Found during:** Task 2 (end-to-end verification)
- **Issue:** With `stdio: ["pipe","pipe","pipe"]`, the Claude CLI subprocess produced no output on stdout. The CLI checks whether stdin is a TTY and only produces stream-json formatted output when it detects a proper terminal/inherited stdin.
- **Fix:** Changed stdio configuration from `["pipe","pipe","pipe"]` to `["inherit","pipe","pipe"]` in spawnClaude
- **Files modified:** src/claude/process.ts
- **Verification:** After fix, Claude CLI produces expected NDJSON stream-json output on stdout
- **Committed in:** b72d10a

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix -- without it the bridge produces no output. Important architectural finding for future Claude CLI integration work.

## Issues Encountered
- Claude CLI stdin requirement was not documented in Claude's official docs and was discovered empirically during testing. This finding is captured as a key decision for future reference.

## User Setup Required
None beyond Plan 01 setup -- the same .env configuration and Discord bot credentials are used.

## Phase 1 Completion

This plan completes Phase 1 (Bot + Claude Connection). All Phase 1 success criteria from ROADMAP.md are met:

1. User can start the bot from the command line and see it come online in Discord
2. User can type a message in Discord and receive Claude's response with proper markdown and code block formatting
3. A non-owner Discord user who tries to interact with the bot gets rejected
4. Long responses are split at natural boundaries (paragraph, code block) without breaking formatting
5. Bot stops gracefully when terminated, without orphaned processes

**Requirements covered:** BOTF-01 through BOTF-06, CLDI-01 through CLDI-03, OUTD-01

## Next Phase Readiness
- Phase 1 foundation complete: working Discord-to-Claude bridge ready for Phase 2 enhancements
- Phase 2 can add interactive features (tool approval, file attachments, etc.) on top of this bridge
- Key finding for Phase 2: Claude CLI requires inherited stdin -- any future subprocess changes must preserve this
- The pluggable callback and BridgeRouter patterns are extensible for new commands and features

## Self-Check: PASSED

- All 4 created files verified present on disk (types.ts, process.ts, parser.ts, router.ts)
- All 2 modified files verified present on disk (message.ts, index.ts)
- Commit 3e62209 (Task 1) verified in git log
- Commit 9704143 (Task 2) verified in git log
- Commit b72d10a (Task 2 fix) verified in git log

---
*Phase: 01-bot-claude-connection*
*Completed: 2026-02-12*
