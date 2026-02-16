# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-16)

**Core value:** Full bidirectional Claude Code access from Discord -- anything you can do in the terminal, you can do from a Discord channel.
**Current focus:** v1.0 milestone shipped -- planning next milestone

## Current Position

Phase: 3 of 3 (Session Persistence) -- COMPLETE
Plan: 2 of 2 in current phase (03-02 complete)
Status: All Phases Complete
Last activity: 2026-02-16 - Completed 03-02: Session lifecycle commands, Discord integration, bot presence

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 9
- Average duration: 4min
- Total execution time: 0.65 hours

**By Phase:**

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 01 | P01 | 3min | 2 | 14 |
| 01 | P02 | 3min | 3 | 2 |
| 01 | P03 | 15min | 3 | 6 |
| 02 | P01 | 2min | 2 | 4 |
| 02 | P02 | 2min | 2 | 3 |
| 02 | P03 | 2min | 2 | 5 |
| 02 | P04 | 3min | 3 | 6 |
| 03 | P01 | 3min | 2 | 3 |
| 03 | P02 | 6min | 3 | 10 |

**Recent Trend:**
- Last 5 plans: 2min, 2min, 3min, 3min, 6min
- Trend: All phases complete -- P02 largest plan (10 files, 3 tasks) delivered session lifecycle commands

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Agent SDK (not PTY/CLI spawning) is the integration approach -- shapes all phases
- [Roadmap]: 3-phase quick-depth structure: foundation, interactive proxy, session persistence
- [Phase 01-01]: Pino logger in separate logger.ts module for shared import across all files
- [Phase 01-01]: Pluggable callback pattern (setSessionStatusGetter, setOnStop, setOnNew) for Plan 02 wiring
- [Phase 01-01]: deferReply in interaction handler before command dispatch for 3-second timeout compliance
- [Phase 01-02]: Default maxLength 1900 (100-char buffer below Discord's 2000 limit)
- [Phase 01-02]: 10-chunk cap with truncation notice to prevent channel flooding
- [Phase 01-02]: Data-driven tool format map for formatToolActivity extensibility
- [Phase 01-03]: Claude CLI requires inherited stdin (not pipe) for stream-json output -- critical for subprocess spawning
- [Phase 01-03]: Typing indicator at 9s intervals keeps Discord indicator active during long processing
- [Phase 01-03]: Status message edit-in-place pattern for tool activity display (avoids message spam)
- [Phase 01-03]: Sequential queue processing for concurrent messages (one Claude process at a time)
- [Phase 02-01]: Fixed IPC port 9824 (GSD_IPC_PORT env var) -- simpler than dynamic port for MCP subprocess env passing
- [Phase 02-01]: 6-min fetch timeout in IPC client > 5-min Discord button timeout -- bot controls deny-on-timeout
- [Phase 02-01]: console.error only in MCP server -- stdout is MCP stdio transport channel
- [Phase 02-01]: Typed EventEmitter via declaration merging for compile-time safety on permission-request events
- [Phase 02-02]: EmbedBuilder mutated in-place for post-interaction state updates (color + footer) rather than new instances
- [Phase 02-02]: Sequential question processing for AskUserQuestion -- timeout on any question auto-denies entire request
- [Phase 02-02]: Component factory pattern: createPermissionEmbed/Buttons/QuestionSelect return discord.js builders
- [Phase 02-03]: import.meta.url for resolving permission-server.js path -- works in both tsx dev and compiled dist/
- [Phase 02-03]: process.execPath for MCP server command -- same Node.js binary (node or tsx) runs the permission server
- [Phase 02-03]: MCP config passed as inline JSON string to --mcp-config (not a file path)
- [Phase 02-03]: config.ipcPort imported directly in router.ts rather than threading through BridgeRouter constructor
- [Phase 02-04]: 1.5s debounce for streaming message edits -- safe margin below Discord rate limits
- [Phase 02-04]: 1800 char max display (100-char buffer below Discord 2000 limit) for streaming messages
- [Phase 02-04]: 1500 char threshold for main channel summary truncation with thread link
- [Phase 02-04]: tsx binary path for MCP server in dev (not node + .js) -- tsx handles TypeScript directly
- [Phase 02-04]: Strip CLAUDECODE env var from subprocess to prevent nested session detection
- [Phase 03-01]: SessionManager keyed by Discord thread ID (1:1 thread-to-session mapping)
- [Phase 03-01]: ManagedSession.claudeSession typed via import() to avoid circular dependency
- [Phase 03-01]: totalCostUsd assigned (not accumulated) from ResultEvent -- cumulative per CLI process
- [Phase 03-01]: activeThreads Map caches ThreadChannel objects during processing for permission routing
- [Phase 03-01]: Per-session isProcessing flag replaces global flag -- concurrent sessions possible
- [Phase 03-01]: ThreadAutoArchiveDuration.OneDay instead of OneHour per research recommendation
- [Phase 03-02]: Async setter callback pattern (OnNew, OnStop, OnContinue, GetStatus) for command-to-index wiring
- [Phase 03-02]: Bot presence state machine: Online/Ready (0 sessions), Idle/N active (idle), DND/Working (processing)
- [Phase 03-02]: Thread-based routing: threads check parentId for channel guard, main channel checks channel.id
- [Phase 03-02]: /continue with dead session creates new session inline rather than re-invoking onNew
- [Phase 03-02]: Dynamic imports for Discord components in command callbacks to keep top-level imports clean

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | Add --dangerously-skip-permissions flag to ClaudeSession spawn | 2026-02-13 | 2fb854e | [1-add-dangerously-skip-permissions-flag-to](./quick/1-add-dangerously-skip-permissions-flag-to/) |

## Session Continuity

Last session: 2026-02-16
Stopped at: Completed 03-02-PLAN.md (Session lifecycle commands & Discord integration) -- ALL PHASES COMPLETE
Resume file: None
