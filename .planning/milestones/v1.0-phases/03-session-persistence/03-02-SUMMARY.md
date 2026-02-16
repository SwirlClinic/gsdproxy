---
phase: 03-session-persistence
plan: 02
subsystem: discord
tags: [session-lifecycle, slash-commands, discord-embeds, bot-presence, thread-routing, multi-session]

# Dependency graph
requires:
  - phase: 03-session-persistence
    plan: 01
    provides: "SessionManager with lifecycle API, ManagedSession interface, multi-session BridgeRouter"
provides:
  - "/new command with thread creation and active-session warning"
  - "/stop command with single-stop and session picker for multiple"
  - "/continue command with resume embed and dead-session handling"
  - "/status command with rich embed showing per-session stats and total cost"
  - "Bot presence indicator: green=ready, yellow=active, red=working"
  - "Thread-based message routing to correct session"
  - "Backward-compatible main channel message handling"
  - "Status embed and session picker Discord components"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [async-setter-callback-wiring, embed-based-command-responses, select-menu-session-picker, bot-presence-state-machine, thread-vs-channel-routing]

key-files:
  created:
    - src/discord/components/status-embed.ts
    - src/discord/components/session-picker.ts
    - src/discord/commands/continue.ts
  modified:
    - src/discord/commands/new.ts
    - src/discord/commands/stop.ts
    - src/discord/commands/status.ts
    - src/discord/commands/help.ts
    - src/discord/commands/index.ts
    - src/index.ts
    - src/discord/handlers/message.ts

key-decisions:
  - "Async setter callback pattern (OnNew, OnStop, OnContinue, GetStatus) for command-to-index wiring"
  - "Bot presence state machine: Online/Ready (0 sessions), Idle/N sessions active (idle sessions), DND/Working (any processing)"
  - "Thread-based routing: threads check parentId for channel guard, main channel checks channel.id"
  - "/continue with dead session creates new session inline rather than re-invoking onNew callback"
  - "Dynamic imports for Discord components in command callbacks to keep top-level imports clean"
  - "Thread auto-archive duration: OneDay for all session threads (consistent with Plan 01)"

patterns-established:
  - "Async setter callback: commands export setOnX(fn) for index.ts to wire SessionManager logic without circular deps"
  - "Embed-based responses: rich EmbedBuilder for status/resume/warning instead of plain text"
  - "Component interaction flow: editReply with components, awaitMessageComponent with timeout, update on selection"
  - "Presence lifecycle: updatePresence() called after every session create/destroy/resume"

# Metrics
duration: 6min
completed: 2026-02-16
---

# Phase 3 Plan 2: Session Lifecycle Commands & Discord Integration Summary

**All 5 slash commands (/new, /stop, /continue, /status, /help) with rich embeds, session picker, bot presence state machine, and thread-based message routing**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-16T05:20:47Z
- **Completed:** 2026-02-16T07:26:45Z
- **Tasks:** 3 (2 auto + 1 checkpoint verified)
- **Files modified:** 10

## Accomplishments
- All 4 session lifecycle commands implemented: /new creates thread+session with active-session warning, /stop with single-stop and multi-session picker, /continue with resume embed and dead-session recovery, /status with rich embed showing per-session stats
- Bot presence reflects session state: green/Online when ready, yellow/Idle when sessions exist, red/DND when processing
- Thread-based message routing: messages in session threads route to the correct session via handleSessionMessage, main channel messages create new sessions via handleNewMessage
- Status embed and session picker Discord components for rich UI
- 5 slash commands registered (help, status, stop, new, continue)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Discord components and refactor all session commands** - `75c2946` (feat)
2. **Task 2: Wire SessionManager, update message handler, add bot presence** - `2d61caa` (feat)
3. **Task 3: Verify end-to-end multi-session system** - checkpoint:human-verify (approved)

## Files Created/Modified
- `src/discord/components/status-embed.ts` - Rich embed builders: createStatusEmbed, createResumeEmbed, formatDuration helper
- `src/discord/components/session-picker.ts` - Select menu component for choosing which session to stop
- `src/discord/commands/continue.ts` - /continue command with OnContinue setter callback
- `src/discord/commands/new.ts` - Refactored /new with async OnNew setter callback
- `src/discord/commands/stop.ts` - Refactored /stop with async OnStop setter callback
- `src/discord/commands/status.ts` - Refactored /status with async GetStatus setter callback
- `src/discord/commands/help.ts` - Updated help text with multi-session command descriptions
- `src/discord/commands/index.ts` - Added /continue to commands array (5 total)
- `src/index.ts` - SessionManager wiring, all command callbacks, updatePresence helper, graceful shutdown
- `src/discord/handlers/message.ts` - Thread-based routing with setSessionManager, parentId channel guard

## Decisions Made
- Async setter callback pattern (OnNew, OnStop, OnContinue, GetStatus) keeps command files simple while index.ts holds the SessionManager logic -- avoids circular dependencies
- Bot presence uses three states: Online/Ready (no sessions), Idle/N sessions active (sessions exist but none processing), DND/Working (any session processing)
- Thread-based routing checks parentId for thread channel guard (threads have their own ID, not parent's)
- /continue with dead session creates new session inline (thread creation + sessionManager.createSession) rather than re-invoking the onNew callback, avoiding the active-session warning
- Dynamic imports for Discord components in command callbacks keep top-level imports clean

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 3 is complete: full multi-session system with all lifecycle commands
- All 3 project phases (01-bot-claude-connection, 02-interactive-proxy, 03-session-persistence) are done
- Project is feature-complete for v1.0 milestone

## Self-Check: PASSED

All 10 files verified present. Both commits (75c2946, 2d61caa) confirmed in git history.

---
*Phase: 03-session-persistence*
*Completed: 2026-02-16*
