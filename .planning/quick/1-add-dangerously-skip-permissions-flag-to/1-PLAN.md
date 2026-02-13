---
phase: quick-1
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/claude/types.ts
  - src/claude/session.ts
  - src/config.ts
  - src/index.ts
  - .env.example
autonomous: true
must_haves:
  truths:
    - "When DANGEROUSLY_SKIP_PERMISSIONS=true, Claude spawns without --mcp-config, --permission-prompt-tool, or --allowedTools flags"
    - "When DANGEROUSLY_SKIP_PERMISSIONS is unset or false, Claude spawns with the full permission server setup (existing behavior)"
    - "The --dangerously-skip-permissions flag is passed to the Claude CLI when the option is enabled"
  artifacts:
    - path: "src/config.ts"
      provides: "dangerouslySkipPermissions boolean config value"
      contains: "dangerouslySkipPermissions"
    - path: "src/claude/types.ts"
      provides: "SessionOptions with optional dangerouslySkipPermissions field"
      contains: "dangerouslySkipPermissions"
    - path: "src/claude/session.ts"
      provides: "Conditional arg building based on skipPermissions flag"
      contains: "dangerously-skip-permissions"
  key_links:
    - from: "src/config.ts"
      to: "src/index.ts"
      via: "config.dangerouslySkipPermissions passed to SessionOptions"
      pattern: "dangerouslySkipPermissions"
    - from: "src/index.ts"
      to: "src/claude/session.ts"
      via: "SessionOptions constructor parameter"
      pattern: "dangerouslySkipPermissions"
---

<objective>
Add a `--dangerously-skip-permissions` flag to ClaudeSession spawn, controlled by a `DANGEROUSLY_SKIP_PERMISSIONS` environment variable.

Purpose: Allow the bot operator to bypass the MCP permission server entirely, so all Claude tool use is auto-approved without Discord permission buttons. Useful for trusted/local environments where interactive approval is unnecessary overhead.

Output: Modified config, types, session, and index files; updated .env.example.
</objective>

<context>
@src/claude/session.ts
@src/claude/types.ts
@src/config.ts
@src/index.ts
@.env.example
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add config option and update SessionOptions type</name>
  <files>src/config.ts, src/claude/types.ts, .env.example</files>
  <action>
1. In `src/config.ts`, add `dangerouslySkipPermissions` to the config object:
   ```
   dangerouslySkipPermissions: process.env.DANGEROUSLY_SKIP_PERMISSIONS === "true",
   ```
   Place it after the `ipcPort` line. This is a boolean -- only the literal string "true" enables it.

2. In `src/claude/types.ts`, add an optional field to `SessionOptions`:
   ```
   dangerouslySkipPermissions?: boolean;
   ```

3. In `.env.example`, add a commented-out entry after the IPC section:
   ```
   # Skip Permissions (optional)
   # When true, passes --dangerously-skip-permissions to Claude CLI.
   # All tool use is auto-approved without Discord permission buttons.
   # DANGEROUSLY_SKIP_PERMISSIONS=true
   ```
  </action>
  <verify>Run `npx tsc --noEmit` -- no type errors.</verify>
  <done>Config exports dangerouslySkipPermissions boolean, SessionOptions accepts the field, .env.example documents the variable.</done>
</task>

<task type="auto">
  <name>Task 2: Conditionally build CLI args in spawn() and wire config through index.ts</name>
  <files>src/claude/session.ts, src/index.ts</files>
  <action>
1. In `src/claude/session.ts`:
   - Add a private readonly field `dangerouslySkipPermissions: boolean` initialized from `options.dangerouslySkipPermissions ?? false` in the constructor.
   - In `spawn()`, restructure the args-building logic:
     - The base args are always: `["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]`
     - If `this.dangerouslySkipPermissions` is TRUE:
       - Push `"--dangerously-skip-permissions"` onto args.
       - Do NOT add `--allowedTools`, `--mcp-config`, or `--permission-prompt-tool` flags.
       - Skip the entire MCP config construction (tsxBin, permissionServerPath, mcpConfig variables). Guard the MCP config block with `if (!this.dangerouslySkipPermissions)`.
     - If `this.dangerouslySkipPermissions` is FALSE (default):
       - Keep existing behavior: build MCP config, push `--allowedTools`, `--mcp-config`, `--permission-prompt-tool`.
   - Add a log line after spawn indicating the mode: `logger.info({ dangerouslySkipPermissions: this.dangerouslySkipPermissions }, "Claude persistent session spawned");` (replace the existing log line at end of spawn).

2. In `src/index.ts`:
   - Update the ClaudeSession constructor call to pass the new option:
     ```
     const session = new ClaudeSession({
       cwd,
       ipcPort: config.ipcPort,
       dangerouslySkipPermissions: config.dangerouslySkipPermissions,
     });
     ```
   - When `config.dangerouslySkipPermissions` is true, the IPC server and permission handler are still created and started (they just won't receive any requests). This keeps shutdown logic simple and avoids conditional wiring complexity. No changes needed to IPC/permission handler code.
  </action>
  <verify>
1. `npx tsc --noEmit` -- no type errors.
2. With `DANGEROUSLY_SKIP_PERMISSIONS=true` in env, start the bot and confirm logs show `dangerouslySkipPermissions: true` and Claude spawns successfully (check for absence of `--mcp-config` in debug logs).
3. Without the env var set, confirm existing behavior is preserved (permission server args present).
  </verify>
  <done>
- When DANGEROUSLY_SKIP_PERMISSIONS=true: Claude CLI receives `--dangerously-skip-permissions` and no permission-related flags.
- When unset/false: Claude CLI receives the full MCP permission server config (identical to current behavior).
- Logger output includes the flag state for observability.
  </done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` passes with zero errors
- Bot starts successfully with `DANGEROUSLY_SKIP_PERMISSIONS=true` -- Claude process spawns, log shows skip-permissions mode
- Bot starts successfully without the env var -- existing permission flow works unchanged
</verification>

<success_criteria>
The `--dangerously-skip-permissions` flag is passed to the Claude CLI when `DANGEROUSLY_SKIP_PERMISSIONS=true` is set in the environment. Permission-related flags (--allowedTools, --mcp-config, --permission-prompt-tool) are omitted in this mode. Default behavior (no env var) is unchanged.
</success_criteria>

<output>
After completion, create `.planning/quick/1-add-dangerously-skip-permissions-flag-to/1-SUMMARY.md`
</output>
