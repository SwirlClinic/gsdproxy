# Pitfalls Research

**Domain:** Discord-to-CLI proxy bot (Discord <-> Claude Code Agent SDK bridge)
**Researched:** 2026-02-12
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Wrapping the CLI via PTY Instead of Using the Agent SDK

**What goes wrong:**
Developers attempt to spawn `claude` as an interactive CLI process using `node-pty`, then scrape and parse its terminal output (ANSI escape codes, progress bars, prompts) to detect when Claude is waiting for input. This approach is brittle, unreliable, and fundamentally the wrong abstraction layer. Claude Code's terminal output includes ANSI escape sequences, spinner animations, progress indicators, and other visual elements that are designed for human eyes, not programmatic parsing. Output formats change between versions with no stability guarantees.

**Why it happens:**
The CLI is the most visible entry point to Claude Code. Developers default to "just wrap the existing tool" before discovering the Agent SDK exists. The PTY approach seems simpler upfront -- spawn a process, read its output, send input -- but the complexity explodes when handling real terminal output.

**How to avoid:**
Use the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) TypeScript package instead. It provides:
- `query()` function that returns an `AsyncGenerator<SDKMessage>` with typed messages
- `canUseTool` callback for intercepting permission prompts programmatically
- `AskUserQuestion` tool handling for forwarding clarifying questions
- `--output-format stream-json` for structured streaming if using CLI mode
- Session management via `resume` and `session_id`
- Proper `AbortController` support for cancellation

The SDK gives you the same tools, agent loop, and context management that power Claude Code, but with a programmatic interface designed for exactly this use case.

**Warning signs:**
- Writing regex to parse terminal output
- Using `strip-ansi` or similar libraries to clean ANSI codes
- Building state machines to detect "waiting for input" from text patterns
- node-pty appears in your dependency tree
- `ptyProcess.onData()` handlers that try to determine what state the CLI is in

**Phase to address:**
Phase 1 (Foundation) -- this is the most fundamental architectural decision. Getting this wrong means a rewrite of the entire core.

---

### Pitfall 2: Discord's 3-Second Interaction Timeout Killing Slash Commands

**What goes wrong:**
Discord requires an acknowledgement within 3 seconds of receiving a slash command interaction, or the interaction token becomes permanently invalid. Claude Code operations take seconds to minutes. If you naively await the Claude response before replying, every slash command silently fails from the user's perspective -- they see "The application did not respond."

**Why it happens:**
Developers test with fast operations that happen to complete in under 3 seconds, then deploy and discover that real tasks fail. The 3-second deadline is absolute and non-negotiable on Discord's side.

**How to avoid:**
Always call `interaction.deferReply()` immediately upon receiving any slash command interaction. This sends the "Bot is thinking..." indicator to Discord and extends your response window to 15 minutes. Then use `interaction.editReply()` or `interaction.followUp()` to send the actual response when ready.

```typescript
// WRONG - will timeout on any non-trivial operation
async execute(interaction) {
  const result = await runClaudeQuery(interaction.options.getString('prompt'));
  await interaction.reply(result);
}

// RIGHT - defer immediately, respond later
async execute(interaction) {
  await interaction.deferReply();
  const result = await runClaudeQuery(interaction.options.getString('prompt'));
  await interaction.editReply(result);
}
```

**Warning signs:**
- "The application did not respond" errors in Discord
- Commands work locally but fail in production
- Commands work for simple queries but fail for complex ones
- No `deferReply()` call visible in command handlers

**Phase to address:**
Phase 1 (Foundation) -- this must be baked into every command handler from day one.

---

### Pitfall 3: The 15-Minute Interaction Token Expiry for Long-Running Tasks

**What goes wrong:**
After deferring, the interaction token is valid for only 15 minutes. Claude Code tasks that involve large codebases, complex refactors, or multi-step operations can easily exceed this. Once the token expires, you can no longer edit the original reply or send follow-ups through that interaction -- all updates silently fail.

**Why it happens:**
Discord's 15-minute limit is a hard API constraint. Developers build their progress-update system around `interaction.editReply()` and never plan for what happens at minute 16.

**How to avoid:**
Design a dual-channel response system from the start:
1. Use the interaction for the initial acknowledgement and early status updates
2. Within the first 15 minutes, post an anchor message to the channel (or create a thread) using the channel's message API directly -- this is not bound by the interaction token
3. All subsequent updates go to the channel/thread message, not the interaction
4. Set up a timer that, before the 15-minute mark, sends a final interaction update pointing users to the thread/channel for ongoing updates

Alternatively, use the `maxTurns` or `maxBudgetUsd` options on the Agent SDK to cap execution time, so tasks are bounded.

**Warning signs:**
- "Unknown Interaction" errors in logs after ~15 minutes
- Status updates that worked early stop working later
- Users reporting that long tasks show no final result

**Phase to address:**
Phase 2 (Core Bridge) -- must be designed into the response architecture, not bolted on.

---

### Pitfall 4: Permission Prompt Deadlocks -- Claude Waits, User Never Sees the Prompt

**What goes wrong:**
Claude Code frequently requests permission before executing tools (running bash commands, writing files, etc.). When using the Agent SDK's `canUseTool` callback, execution blocks until you return allow/deny. If the callback fires but the Discord-side notification to the user fails, gets lost, or the user doesn't realize they need to respond, the entire session hangs indefinitely. There is no automatic timeout.

**Why it happens:**
The `canUseTool` callback is a blocking async function. The SDK will not proceed until it resolves. Unlike the interactive CLI where the permission prompt is immediately visible in the terminal, in a Discord bot the prompt must be forwarded to the user, they must see it, react to it, and their response must be routed back. Any break in this chain creates a silent deadlock.

**How to avoid:**
1. Implement a timeout on the `canUseTool` callback -- if the user hasn't responded in N minutes, auto-deny with a message explaining the timeout
2. Use Discord components (buttons with "Allow" / "Deny") that create a clear, clickable call-to-action
3. Send the permission prompt to both the channel and the thread to maximize visibility
4. Log all pending permission requests with timestamps
5. Consider auto-approving read-only operations (`Read`, `Glob`, `Grep`) via `allowedTools` to reduce prompt fatigue
6. Use the Agent SDK's `AbortController` to cancel the query if the user doesn't respond

```typescript
canUseTool: async (toolName, input, { signal }) => {
  const userResponse = await promptUserWithTimeout(toolName, input, {
    timeoutMs: 5 * 60 * 1000, // 5 minute timeout
    signal,
  });
  if (!userResponse) {
    return { behavior: "deny", message: "User did not respond within 5 minutes" };
  }
  return userResponse.approved
    ? { behavior: "allow", updatedInput: input }
    : { behavior: "deny", message: "User denied this action" };
}
```

**Warning signs:**
- Bot appears to "stop responding" mid-task
- No error messages -- just silence
- Session accumulates cost while waiting for input nobody sees
- `total_cost_usd` in result messages is unexpectedly high

**Phase to address:**
Phase 2 (Core Bridge) -- the permission forwarding system is a core architectural component.

---

### Pitfall 5: Uncontrolled Claude Code Execution -- Runaway Cost and Time

**What goes wrong:**
Claude Code is an autonomous agent that can make many API calls, spawn subagents, read hundreds of files, and run multiple commands in a single session. Without explicit limits, a single user prompt like "refactor this entire codebase" can consume significant API budget and run for tens of minutes, blocking other operations and generating a large bill.

**Why it happens:**
The default Agent SDK configuration has no turn limits or budget caps. The agent will keep working until it considers the task complete or hits an error. This is fine for interactive CLI use where the user is watching, but dangerous for a bot where the user fires and forgets.

**How to avoid:**
Always set explicit limits on every query:
```typescript
const result = query({
  prompt: userMessage,
  options: {
    maxTurns: 25,        // Cap the number of agentic turns
    maxBudgetUsd: 2.00,  // Cap dollar spend per query
    allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep", "Write"],
    // Don't include WebSearch, WebFetch unless needed
  }
});
```

The SDK returns typed result messages with `subtype: "error_max_turns"` or `subtype: "error_max_budget_usd"` when limits are hit, so you can inform the user gracefully.

**Warning signs:**
- Unexpectedly high API bills
- Single tasks that run for 30+ minutes
- Sessions where `num_turns` in the result is very high (50+)
- Users complaining the bot is "stuck" (it's actually still working)

**Phase to address:**
Phase 1 (Foundation) -- limits must be configured from the very first integration.

---

### Pitfall 6: Command Injection via Unsanitized Discord Input

**What goes wrong:**
Discord messages from users get passed to Claude Code, which then executes bash commands and file operations on the host machine. A malicious or careless user could craft a message that manipulates Claude into executing destructive commands. Even without intent, Claude might interpret ambiguous instructions in dangerous ways. Claude Code runs with the same permissions as the parent process.

**Why it happens:**
The bot is designed to give Claude full agentic capabilities. The user's Discord message becomes the agent's prompt. While Claude has built-in safety, it's an LLM and can be prompt-injected or misled. The Agent SDK's permission system is the primary defense, but it requires correct configuration.

**How to avoid:**
1. **Never use `dangerouslySkipPermissions`** -- always keep the permission system active
2. **Use `canUseTool` for all destructive operations** -- require explicit user approval for Bash commands, Write, and Edit
3. **Restrict `allowedTools`** to only what's needed for each command type
4. **Use sandbox mode** when available to constrain filesystem and network access:
   ```typescript
   sandbox: {
     enabled: true,
     autoAllowBashIfSandboxed: true,
     network: { allowLocalBinding: false }
   }
   ```
5. **Set the `cwd` explicitly** to scope operations to the target project directory
6. **Consider the `canUseTool` callback as a firewall** -- inspect `input.command` for dangerous patterns (rm -rf, sudo, curl|bash, etc.) before forwarding to the user for approval
7. **Validate that the Discord user is authorized** -- check user ID against an allowlist before processing any command

**Warning signs:**
- `permissionMode: "bypassPermissions"` in your configuration
- No `canUseTool` callback configured
- Claude executing commands outside the intended project directory
- No user authorization check before processing commands

**Phase to address:**
Phase 1 (Foundation) -- security boundaries must be established from the start, not bolted on later.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skipping permissions (`dangerouslySkipPermissions`) | Faster testing, no approval interrupts | No security boundary, any prompt can run any command | Never in production, only in isolated local testing |
| Hardcoding message splitting at 2000 chars | Quick fix for long messages | Breaks mid-word, mid-codeblock, mid-markdown; looks terrible | Never -- always split on line boundaries respecting code fences |
| Storing session state in memory only | Simpler architecture, no persistence layer | Bot restart loses all active sessions, no recovery | MVP only, add persistence before "done" |
| Using `interaction.reply()` everywhere | Simple response pattern | Breaks when operation exceeds 3 seconds | Never for operations that involve Claude Code |
| Polling for permission responses | Simpler than event-driven approach | Wasted CPU, delayed responses, scaling issues | Never -- use Discord component interactions (buttons) |
| Not setting `maxTurns` or `maxBudgetUsd` | Claude has full freedom to work | Runaway costs, stuck sessions, resource exhaustion | Never in production |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Discord API | Not handling `DiscordAPIError[50027]` (Invalid Webhook Token) when interaction expires after 15 min | Transition to channel-based messaging before token expiry; catch and handle this specific error |
| Discord API | Editing messages faster than 5 edits per 5 seconds rate limit | Batch updates, debounce message edits to 1-2 second intervals, queue updates |
| Discord API | Sending messages over 2000 characters | Pre-split all content; use embeds (6000 char total, 25 fields max) for structured data; use file attachments for very long output |
| Discord Threads | Not handling thread auto-archive (1hr/24hr/3d/1wk) | Send keepalive messages or use `thread.setArchived(false)` before archiving; pin critical threads |
| Claude Agent SDK | Not capturing `session_id` from init message | Always extract session_id from `SDKSystemMessage` (type: "system", subtype: "init") for session continuity |
| Claude Agent SDK | Ignoring `SDKResultMessage` error subtypes | Handle `error_max_turns`, `error_max_budget_usd`, `error_during_execution` distinctly with user-friendly messages |
| Claude Agent SDK | Not passing `AbortController` for cancellation | Always provide an AbortController so users can cancel long-running operations |
| Environment | Bot token or API key in source code | Use environment variables with `.env` file (in `.gitignore`); never commit secrets |
| Environment | Running bot and Claude Code with same user permissions | Use minimal process permissions; consider containerization for production |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Streaming every token to Discord via message edits | Rate limit errors (429), delayed responses, Discord API ban | Debounce edits: buffer output, update message every 2-3 seconds at most | Immediately -- Discord rate limits message edits to 5/5s |
| No message queuing for Discord API calls | Sporadic 429 errors, lost messages | Use discord.js built-in rate limit handling; never bypass it with raw REST calls | At ~10+ concurrent message operations |
| Accumulating full conversation in memory without compaction | Memory growth over long sessions, eventual OOM | Use Agent SDK session management; leverage `SDKCompactBoundaryMessage` for compaction awareness; set `maxTurns` | Sessions exceeding ~100 turns or 30+ minutes |
| Creating a new thread per message instead of per session | Channel clutter, thread limit (1000 active per channel) | One thread per Claude session; reuse threads for continued conversations | At ~50+ requests per day |
| Not cleaning up finished Claude sessions | Memory leak from retained AsyncGenerators and callbacks | Explicitly handle `SDKResultMessage`, release references, clear timeout timers | After ~100 sessions without restart |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| No Discord user allowlist | Any user in the server can run commands on your machine | Implement user ID allowlist checked before any command processing |
| Passing raw Discord message content as Claude prompt without sanitization | Prompt injection that could manipulate Claude into dangerous actions | While full sanitization is impractical for natural language, log all prompts, restrict tools per command type, and rely on the permission system |
| Bot token in `.env` committed to repo | Full compromise of the Discord bot | Add `.env` to `.gitignore` before first commit; use `git-secrets` or pre-commit hooks to prevent secret commits |
| Anthropic API key accessible via Claude's own Bash tool | Claude could read its own API key from environment variables | Use `env` option in SDK to pass a filtered environment; never expose `ANTHROPIC_API_KEY` to the spawned agent's environment |
| Not validating that Claude is operating in the correct working directory | File operations outside intended project scope | Set `cwd` explicitly in SDK options; use `additionalDirectories` sparingly; validate paths in `canUseTool` |
| Running without the permission system | Claude can execute any command without approval | Always use `canUseTool` callback; never use `bypassPermissions` in production |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing raw Claude SDK output without formatting | Wall of JSON, unreadable in Discord | Parse `SDKMessage` types and format for Discord: summaries in embeds, code in code blocks, errors with clear indicators |
| No progress indication during long operations | User thinks bot is broken, sends duplicate commands | Show "thinking" indicator, periodic status updates (e.g., "Reading files...", "Running tests..."), debounced message edits |
| Permission prompts as plain text messages | User doesn't realize action is needed, misses the prompt | Use Discord buttons/components for allow/deny; make the call-to-action visually distinct |
| Dumping full file contents in channel | Channel becomes unreadable, hits message limits | Use threads for detailed output; post summaries in channel with "see thread for details"; use file attachments for large content |
| No way to cancel a running operation | User waits helplessly for a task they no longer want | Implement cancel button (tied to `AbortController`); show cancel option in every status update |
| Not differentiating between errors and normal completion | User confused about whether task succeeded | Use distinct formatting: green checkmark for success, red X for errors, yellow warning for partial completion |
| Forwarding every `AskUserQuestion` without context | User gets a question about "which approach" with no context on what Claude is doing | Include a brief summary of Claude's current task when forwarding questions |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Slash command handler:** Often missing `deferReply()` call -- verify every command handler defers immediately
- [ ] **Message splitting:** Often splits mid-code-block or mid-markdown -- verify split points respect code fences and markdown structure
- [ ] **Permission forwarding:** Often missing timeout -- verify `canUseTool` has a timeout so sessions don't hang forever
- [ ] **Session cleanup:** Often missing cleanup of old sessions -- verify completed sessions release resources (AbortController, callbacks, timers)
- [ ] **Error handling:** Often missing Agent SDK error subtypes -- verify `error_max_turns`, `error_max_budget_usd`, and `error_during_execution` are all handled
- [ ] **Thread management:** Often missing auto-archive handling -- verify threads don't silently archive during active sessions
- [ ] **Graceful shutdown:** Often missing child process cleanup -- verify bot shutdown properly aborts active Claude sessions and cleans up
- [ ] **Reconnection:** Often missing Discord gateway reconnection handling -- verify bot recovers from WebSocket disconnects without losing active sessions
- [ ] **Cost tracking:** Often missing per-session cost reporting -- verify `total_cost_usd` from result messages is tracked and exposed to the user
- [ ] **Rate limiting:** Often missing Discord edit rate limiting -- verify message edits are debounced/queued to stay under 5/5s limit

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Used PTY wrapper instead of Agent SDK | HIGH | Complete rewrite of core bridge layer; no code is salvageable from the PTY approach |
| Interaction token expired mid-task | LOW | Catch the `DiscordAPIError[50027]`, fall back to channel messaging for remaining updates |
| Permission prompt deadlock | LOW | Implement timeout that auto-denies after N minutes; notify user that the session timed out; user can retry |
| Runaway Claude session (cost) | MEDIUM | Add `maxBudgetUsd` retroactively; audit past sessions for cost patterns; set up alerts |
| Message over 2000 chars sent | LOW | Add message-splitting middleware; catch Discord API errors for content length and retry with splitting |
| Security: command injection | HIGH | Audit all past sessions; enable `canUseTool` callback; restrict `allowedTools`; add user allowlist; rotate any potentially exposed credentials |
| Bot token leaked | MEDIUM | Regenerate token immediately in Discord Developer Portal; redeploy; audit git history for other secrets |
| Memory leak from session accumulation | MEDIUM | Add session cleanup on completion; implement periodic garbage collection of stale sessions; restart bot with monitoring |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| PTY wrapper instead of Agent SDK | Phase 1: Foundation | Code review confirms `@anthropic-ai/claude-agent-sdk` is the core dependency, no `node-pty` in package.json |
| 3-second interaction timeout | Phase 1: Foundation | Every slash command handler calls `deferReply()` before any async work; test with simulated slow responses |
| 15-minute token expiry | Phase 2: Core Bridge | Long-running test task (>15 min) completes with all status updates visible; no "Unknown Interaction" errors in logs |
| Permission prompt deadlocks | Phase 2: Core Bridge | Simulate user not responding; verify timeout fires and session resolves within configured time; no zombie sessions |
| Uncontrolled execution costs | Phase 1: Foundation | `maxTurns` and `maxBudgetUsd` set on every `query()` call; test that limits are respected |
| Command injection | Phase 1: Foundation | User allowlist enforced; `canUseTool` callback configured; no `bypassPermissions`; pen-test with adversarial prompts |
| Discord rate limiting on edits | Phase 2: Core Bridge | Stream 100+ lines of Claude output; verify no 429 errors; message updates are debounced |
| Message content overflow (2000 chars) | Phase 2: Core Bridge | Claude generates 10,000+ character response; verify clean splitting across multiple messages |
| Thread auto-archive | Phase 3: UX Polish | Session lasting >1 hour; verify thread stays active and accessible |
| Graceful shutdown / reconnection | Phase 3: UX Polish | Kill and restart bot during active session; verify session state is recoverable or cleanly terminated |
| Cost tracking and visibility | Phase 3: UX Polish | Run 10 queries; verify per-session and cumulative cost is visible to user |

## Sources

- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) -- Official documentation (HIGH confidence)
- [Claude Code Headless/Programmatic Mode](https://code.claude.com/docs/en/headless) -- Official Agent SDK CLI docs (HIGH confidence)
- [Claude Agent SDK - TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- Official SDK API docs (HIGH confidence)
- [Claude Agent SDK - Overview](https://platform.claude.com/docs/en/agent-sdk/overview) -- Official SDK overview (HIGH confidence)
- [Claude Agent SDK - Handle Approvals and User Input](https://platform.claude.com/docs/en/agent-sdk/user-input) -- Official permission handling docs (HIGH confidence)
- [Claude Agent SDK - Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions) -- Official permission configuration (HIGH confidence)
- [Discord API Rate Limits](https://discord.com/developers/docs/topics/rate-limits) -- Official Discord docs (HIGH confidence)
- [Discord Interactions](https://discord.com/developers/docs/interactions/receiving-and-responding) -- 3-second timeout, 15-minute token (HIGH confidence)
- [discord.js Guide - Command Response Methods](https://discordjs.guide/slash-commands/response-methods) -- deferReply patterns (HIGH confidence)
- [discord.js Guide - Threads](https://discordjs.guide/popular-topics/threads.html) -- Thread management (HIGH confidence)
- [Discord Threads API](https://discord.com/developers/docs/topics/threads) -- Auto-archive behavior (HIGH confidence)
- [microsoft/node-pty GitHub](https://github.com/microsoft/node-pty) -- PTY limitations and issues (MEDIUM confidence)
- [node-pty Issue #831](https://github.com/microsoft/node-pty/pull/831) -- PTY hang issues on macOS (MEDIUM confidence)
- [Discord.Net Discussion #2732](https://github.com/discord-net/Discord.Net/discussions/2732) -- 3-second timeout workarounds (MEDIUM confidence)
- [Discord Bot Security Best Practices](https://friendify.net/blog/discord-bot-security-best-practices-2025.html) -- Security patterns (LOW confidence)
- [Claude Agent SDK Issue #1175](https://github.com/anthropics/claude-code/issues/1175) -- Permission prompt tool documentation gap (MEDIUM confidence)

---
*Pitfalls research for: Discord-to-Claude Code CLI proxy bot (GSD Proxy)*
*Researched: 2026-02-12*
