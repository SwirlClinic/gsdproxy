---
phase: quick-1
plan: 01
subsystem: cli
tags: [claude-cli, permissions, spawn, env-config]

# Dependency graph
requires:
  - phase: 02-interactive-proxy
    provides: "ClaudeSession spawn with MCP permission server config"
provides:
  - "DANGEROUSLY_SKIP_PERMISSIONS env var for bypassing permission flow"
  - "Conditional CLI arg building in ClaudeSession.spawn()"
affects: [session, permissions, deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional CLI arg construction based on config boolean"

key-files:
  created: []
  modified:
    - src/config.ts
    - src/claude/types.ts
    - src/claude/session.ts
    - src/index.ts
    - .env.example

key-decisions:
  - "Only string 'true' enables skip-permissions (strict equality, not truthy)"
  - "IPC server and permission handler still created when skipping -- keeps shutdown logic simple"
  - "MCP config construction fully guarded inside else branch -- no dead code when skipping"

patterns-established:
  - "Environment-driven feature flags with strict string comparison"

# Metrics
duration: 1min
completed: 2026-02-13
---

# Quick 1: Add --dangerously-skip-permissions Flag Summary

**DANGEROUSLY_SKIP_PERMISSIONS env var conditionally bypasses MCP permission server, passing --dangerously-skip-permissions to Claude CLI for auto-approved tool use**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-13T22:36:48Z
- **Completed:** 2026-02-13T22:38:10Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Config boolean `dangerouslySkipPermissions` sourced from `DANGEROUSLY_SKIP_PERMISSIONS` env var with strict "true" comparison
- SessionOptions type extended with optional `dangerouslySkipPermissions` field
- Conditional arg building in `spawn()`: skip-permissions mode omits --allowedTools, --mcp-config, --permission-prompt-tool and adds --dangerously-skip-permissions
- Default behavior (no env var) is completely unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Add config option and update SessionOptions type** - `53d7f76` (feat)
2. **Task 2: Conditionally build CLI args in spawn() and wire config through index.ts** - `2fb854e` (feat)

## Files Created/Modified
- `src/config.ts` - Added `dangerouslySkipPermissions` boolean from env var
- `src/claude/types.ts` - Added optional `dangerouslySkipPermissions` to `SessionOptions`
- `src/claude/session.ts` - Conditional arg building in `spawn()`, flag logged on spawn
- `src/index.ts` - Passes `config.dangerouslySkipPermissions` to ClaudeSession constructor
- `.env.example` - Documents DANGEROUSLY_SKIP_PERMISSIONS with usage note

## Decisions Made
- Only the literal string "true" enables skip-permissions (strict equality, not truthy) -- prevents accidental activation
- IPC server and permission handler are still created even when skipping permissions -- avoids conditional wiring complexity and keeps shutdown logic simple
- MCP config construction (thisDir, tsxBin, permissionServerPath, mcpConfig) fully guarded inside else branch to avoid dead code execution

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. To use the feature, set `DANGEROUSLY_SKIP_PERMISSIONS=true` in your `.env` file.

## Next Phase Readiness
- Feature is self-contained and ready for use
- No blockers

## Self-Check: PASSED

- All 5 files exist on disk
- Both task commits (53d7f76, 2fb854e) verified in git log
- `npx tsc --noEmit` passes with zero errors

---
*Quick Task: 1-add-dangerously-skip-permissions-flag-to*
*Completed: 2026-02-13*
