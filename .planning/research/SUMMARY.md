# Project Research Summary

**Project:** GSD Proxy (Discord-to-Claude Code bridge)
**Domain:** Discord bot providing remote interface to Claude Code agent
**Researched:** 2026-02-12
**Confidence:** HIGH

## Executive Summary

GSD Proxy bridges Discord to Claude Code, enabling remote control of the Claude Code agent from any device running Discord. Research reveals that the critical architectural decision is **using the official Claude Agent SDK rather than wrapping the CLI via PTY spawning**. The Agent SDK provides structured message streaming, programmatic permission handling, and session management without terminal parsing complexity. This architectural choice shapes the entire stack and determines success or failure.

The recommended approach uses Node.js 22 LTS with TypeScript, discord.js 14.25 for Discord integration, and the Claude Agent SDK 0.2.x for Claude Code interaction. The core challenge is forwarding permission prompts from Claude to Discord as interactive button components with timeout handling to prevent session deadlocks. Output must be debounced to avoid Discord's 5-edits-per-5-seconds rate limit, and thread-based organization keeps channels clean while preserving detailed output.

Key risks center on Discord's interaction constraints (3-second acknowledgement timeout, 15-minute token expiry), permission prompt deadlocks when users don't respond, and runaway execution costs without turn/budget limits. All are mitigated through explicit design patterns: immediate interaction deferral, channel-based messaging after token expiry, permission callback timeouts with auto-deny, and explicit maxTurns/maxBudgetUsd limits on every query.

## Key Findings

### Recommended Stack

The stack research establishes that the Claude Agent SDK eliminates the entire PTY layer. Eight open-source projects in this space currently use CLI spawning, but the SDK approach is strictly superior for new projects. It provides typed async generators, structured streaming output, native session management, and hooks that map directly to Discord notifications.

**Core technologies:**
- **Node.js 22.x LTS**: Required by discord.js 14.25.x, provides native TypeScript stripping, active LTS through 2027
- **TypeScript 5.9.x**: Latest stable with excellent discord.js and Agent SDK type support
- **discord.js 14.25.x**: Standard Discord library with slash commands, message components, collectors, rate limiting
- **@anthropic-ai/claude-agent-sdk 0.2.x**: Official SDK providing Claude Code capabilities programmatically, eliminates PTY complexity entirely
- **better-sqlite3 12.x**: Synchronous API for session persistence, file-based with zero infrastructure overhead
- **pino 10.x**: Structured logging essential for debugging async Discord + Agent SDK interactions

**Critical dependency note:** The Agent SDK requires direct API billing (Anthropic API key) rather than Claude Pro/Max subscription. For single-user local use, this is acceptable with transparent pricing. zod 3.25+ is a peer dependency of the Agent SDK.

### Expected Features

Feature research analyzed 8+ existing Discord-Claude Code bridges and identified clear table stakes versus differentiators. The MVP must prove the core proxy loop works before adding polish.

**Must have (table stakes):**
- Send messages to Claude Code via persistent sessions
- Receive and display Claude responses with code block formatting and 2000-char message splitting
- Permission/tool approval forwarding with approve/deny buttons
- Session persistence across bot restarts
- Start/stop session control
- Single-user access control

**Should have (competitive advantages):**
- Bidirectional interactive prompt forwarding (AskUserQuestion with Discord select menus)
- Thread-based output organization (summary in channel, details in thread)
- Real-time streaming display with in-place message edits
- Tool activity indicators ("Reading auth.py...", "Running npm test...")
- Session continuation/resume support
- Cost and token tracking

**Defer (v2+):**
- Smart output summarization with AI-generated summaries
- File checkpointing/rewind commands
- Image attachment support
- Multiple working directories

**Anti-features to avoid:** Multi-user access (security risk on shared machine), always-on daemon mode (resource waste), auto-accept all permissions (eliminates safety), web dashboard (interface duplication), voice integration (poor accuracy for code).

### Architecture Approach

Architecture research confirms the Agent SDK decision and establishes clear component boundaries. The system separates Discord, Bridge, and Claude layers so each can be tested independently.

**Major components:**
1. **Command Handler** (discord/commands/): Receives slash commands, validates input, dispatches to Session Manager. Every handler must call deferReply() immediately to avoid 3-second timeout.
2. **Session Manager** (claude/session.ts): Orchestrates Agent SDK query() lifecycle, consumes AsyncGenerator<SDKMessage> in for-await-of loop, dispatches messages to handlers.
3. **Permission Forwarder** (claude/permissions.ts): Implements canUseTool callback, surfaces permission requests as Discord messages with buttons, awaits user response with timeout (5min auto-deny).
4. **Output Buffer** (bridge/buffer.ts): Debounces SDK streaming events into batched Discord message edits to avoid rate limits, flushes every 1-2 seconds.
5. **Output Renderer** (discord/renderer.ts): Transforms SDKMessage events into Discord-friendly format (code blocks, embeds, threads), respects 2000-char limit.
6. **Message Router** (bridge/router.ts): Maps Discord channels to Claude sessions, handles follow-up messages versus new sessions.

**Key architectural pattern:** The Agent SDK's query() returns an async generator that blocks on canUseTool until the callback resolves. This creates a natural synchronization point where Discord interaction collectors pause Claude execution until the user responds.

**Build dependency order:** Foundation (config, types, Discord client) → Claude Integration (session manager, SDK wrapping) → Permission System (canUseTool callback, button handling) → Output Quality (streaming buffer, formatting) → Session Management (persistence, resume).

### Critical Pitfalls

Pitfalls research identified six critical issues and their prevention strategies:

1. **Using PTY/CLI spawning instead of Agent SDK** — Leads to brittle ANSI parsing, no structured output, fragile permission detection. Prevention: Use @anthropic-ai/claude-agent-sdk from day one. Recovery cost: HIGH (complete rewrite).

2. **Discord's 3-second interaction timeout** — Slash commands that await Claude response fail silently with "The application did not respond." Prevention: Call interaction.deferReply() immediately in every command handler before any async work. Affects: Phase 1.

3. **15-minute interaction token expiry** — Long-running tasks (>15min) lose ability to edit reply or send follow-ups. Prevention: Transition to channel-based messaging before expiry, post anchor message in channel/thread within first 15 minutes. Affects: Phase 2.

4. **Permission prompt deadlocks** — canUseTool callback blocks forever if user never sees or responds to prompt. Prevention: Implement 5-minute timeout with auto-deny, use Discord buttons for clear call-to-action, send prompts to both channel and thread. Affects: Phase 2.

5. **Uncontrolled execution costs** — Single prompt can trigger dozens of API calls and run for tens of minutes. Prevention: Always set maxTurns (25) and maxBudgetUsd (2.00) on every query() call. Affects: Phase 1.

6. **Command injection via unsanitized input** — Discord messages become agent prompts, Claude runs with host machine permissions. Prevention: Never use dangerouslySkipPermissions, always enable canUseTool callback, restrict allowedTools, implement user allowlist, consider sandbox mode. Affects: Phase 1.

**Technical debt traps:** Never skip permissions in production, never hardcode message splitting at 2000 chars (breaks mid-codeblock), never store sessions only in memory (loses state on restart), never poll for permission responses (use Discord component interactions).

**Performance traps:** Debounce message edits to avoid Discord's 5-edits-per-5-seconds rate limit, queue Discord API calls through discord.js built-in handling, set maxTurns to prevent memory growth in long sessions, create one thread per session not per message.

## Implications for Roadmap

Based on research, the roadmap should have 3 core phases followed by polish/enhancement phases:

### Phase 1: Foundation & Security
**Rationale:** Must establish architectural foundation (Agent SDK integration) and security boundaries before any features work. The Agent SDK versus PTY decision shapes everything. Security (user allowlist, permission system, execution limits) cannot be bolted on later.

**Delivers:**
- Discord bot that connects and handles slash commands
- Basic Agent SDK integration with query() consumption
- User authorization and access control
- Execution limits (maxTurns, maxBudgetUsd) configured
- Permission system framework (canUseTool callback skeleton)

**Addresses:**
- Table stakes: Discord bot core, single-user access control, start/stop commands
- Pitfall #1 (Agent SDK architecture decision)
- Pitfall #5 (execution limits)
- Pitfall #6 (security boundaries)

**Avoids:** PTY spawning approach, security vulnerabilities from unrestricted execution, runaway costs

**Research flag:** Standard patterns. Discord.js and Agent SDK are both well-documented with official references. No phase research needed.

### Phase 2: Core Proxy Loop
**Rationale:** Implements the minimum viable proxy — user sends message to Discord, Claude processes it, response appears in Discord. Includes permission forwarding (the defining feature of a "proxy" vs "wrapper") and output handling. Cannot be split further as these capabilities are interdependent.

**Delivers:**
- Message send/receive between Discord and Claude
- Permission forwarding with Discord button prompts and timeout
- Response formatting (code blocks, message splitting)
- Basic streaming output with debounced edits
- Thread-based organization (summary in channel, details in thread)
- Session persistence (store session_id, resume support)

**Uses:** All stack elements (discord.js for buttons/threads, Agent SDK for streaming, better-sqlite3 for session storage, pino for debugging async flows)

**Implements:** All 6 major architecture components (Command Handler, Session Manager, Permission Forwarder, Output Buffer, Output Renderer, Message Router)

**Addresses:**
- Table stakes: Message send/receive, permission forwarding, response display, session management
- Pitfall #2 (3-second timeout via deferReply)
- Pitfall #3 (15-minute token expiry via channel fallback)
- Pitfall #4 (permission deadlocks via timeout)
- Performance trap: Discord rate limiting on message edits

**Avoids:** Interaction timeouts, permission deadlocks, rate limit errors

**Research flag:** Phase research needed. While individual components are documented, the integration patterns (especially permission forwarding with Discord components + Agent SDK canUseTool callback) may require experimentation to get right. The 15-minute token expiry mitigation strategy needs validation.

### Phase 3: Enhanced UX
**Rationale:** Core proxy works. Now polish the user experience with real-time feedback, interactive prompts, and visibility features. These enhance but don't fundamentally change the proxy loop.

**Delivers:**
- Real-time streaming with includePartialMessages (edit messages as tokens arrive)
- Tool activity indicators (show what Claude is doing: "Reading...", "Running...")
- AskUserQuestion forwarding (render clarifying questions as Discord select menus)
- Session continuation (/continue command to resume last session)
- Cost/token tracking display (show per-session and cumulative usage)

**Addresses:**
- Competitive features: Real-time streaming, tool indicators, interactive prompts, cost tracking
- UX pitfalls: No progress indication, unclear permission prompts, no cost visibility

**Avoids:** User confusion about what's happening, surprise API bills

**Research flag:** Standard patterns. Agent SDK hooks and streaming events are documented. Discord select menus are standard discord.js patterns. Skip phase research.

### Phase 4: Production Readiness (Future)
**Rationale:** Deployed system needs reliability, observability, and graceful degradation. Deferred until core experience is proven.

**Delivers:**
- Graceful shutdown (abort active sessions, cleanup resources)
- Reconnection handling (recover from Discord gateway disconnects)
- Thread auto-archive management (keep threads active during long sessions)
- Error handling for all SDK error subtypes (error_max_turns, error_max_budget_usd, error_during_execution)
- Structured logging with pino throughout

**Addresses:**
- "Looks done but isn't" checklist items
- Operational pitfalls

### Phase Ordering Rationale

- **Phase 1 before all others:** Architecture decision (Agent SDK) and security boundaries cannot be changed later. Getting this wrong forces a rewrite.
- **Phase 2 cannot be split:** Permission forwarding requires working sessions, output rendering requires streaming data, session persistence requires session IDs from completed queries. These form a minimal complete loop.
- **Phase 3 after Phase 2:** Real-time streaming, tool indicators, and AskUserQuestion are enhancements to the output and permission systems built in Phase 2. They depend on those systems being stable.
- **Phase 4 deferred:** Production concerns don't block MVP validation. Users tolerate missing graceful shutdown in a personal tool; they don't tolerate broken core functionality.

**Grouping logic:** Each phase delivers a coherent capability increment that can be validated independently. Phase 1 is "it connects and doesn't compromise security." Phase 2 is "I can use it for basic tasks." Phase 3 is "it feels responsive and informative." Phase 4 is "it's reliable for daily use."

### Research Flags

**Needs phase research during planning:**
- **Phase 2 (Core Proxy Loop):** Complex integration between Discord components (buttons, threads, collectors) and Agent SDK callbacks (canUseTool, streaming events). The 15-minute token expiry mitigation strategy (transition to channel messaging) needs validation. Permission timeout handling with multiple concurrent pending approvals may have edge cases.

**Standard patterns (skip phase research):**
- **Phase 1 (Foundation):** discord.js client setup, slash command registration, environment variable loading are all documented patterns. Agent SDK basic usage is documented in official Anthropic docs.
- **Phase 3 (Enhanced UX):** Real-time streaming, hooks, and Discord select menus are well-documented in both Agent SDK and discord.js references.
- **Phase 4 (Production):** Error handling and graceful shutdown are standard Node.js patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified via official documentation. Version numbers confirmed on npm/official release pages. Agent SDK vs PTY decision supported by direct API comparison. |
| Features | HIGH | Analyzed 8+ existing projects with confirmed GitHub repositories. Table stakes derived from convergent evolution across competitors. Differentiators based on gaps in existing solutions. |
| Architecture | HIGH | Based on official Agent SDK documentation and TypeScript reference. Component boundaries derived from established patterns (Discord bots, async generator consumers, permission callbacks). Build order follows dependency analysis. |
| Pitfalls | HIGH | All 6 critical pitfalls sourced from official documentation (Discord interaction timeouts, Agent SDK permission handling) or confirmed by GitHub issues in related projects. Recovery costs estimated from codebase scope. |

**Overall confidence:** HIGH

Research is grounded in official documentation (discord.js docs, Claude Agent SDK docs, Discord API docs) and verified open-source implementations. The Agent SDK approach is based on official Anthropic documentation dated late 2025/early 2026. Version numbers are current as of February 2026.

### Gaps to Address

**Cost modeling:** While research confirms the Agent SDK requires API billing (not Claude Pro subscription), exact cost implications for typical use cases are unknown. This needs monitoring during Phase 2 implementation and user testing. The SDK provides `total_cost_usd` in result messages for tracking.

**Session state size:** Research doesn't establish typical session state size or SQLite schema design for persistence. Needs design during Phase 2 requirements. better-sqlite3 is confirmed capable, but table structure (session_id, channel_id, user_id, resume_data, created_at) needs definition.

**Discord API edge cases:** The 15-minute interaction token expiry mitigation (transition to channel messaging) is a novel pattern not found in existing bridges. Needs validation during Phase 2 implementation. Failure mode: long tasks (>15min) may lose ability to update the deferred reply; fallback to channel messages should handle this gracefully.

**AskUserQuestion rendering:** Agent SDK documentation describes the AskUserQuestion tool structure (questions array, options array, multiSelect flag) but doesn't provide UI rendering guidance. Discord select menus support 25 options maximum; questions with >25 options need alternative rendering (button grids, text input). Design during Phase 3 requirements.

**Permission prompt de-duplication:** If Claude requests the same permission multiple times in a session (e.g., "run npm test" five times), should the bot remember "always allow npm test in this session"? Not addressed in research. Consider during Phase 3 design.

## Sources

### Primary (HIGH confidence)

**Official Documentation:**
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview) — Architecture decision, capabilities, SDK vs CLI comparison
- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) — Full API, types, options, message structures
- [Claude Agent SDK Streaming Output](https://platform.claude.com/docs/en/agent-sdk/streaming-output) — Stream events, partial messages, includePartialMessages option
- [Claude Agent SDK User Input/Approvals](https://platform.claude.com/docs/en/agent-sdk/user-input) — canUseTool callback, AskUserQuestion tool handling
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) — CLI flags, output formats, headless mode
- [discord.js v14.25.1 Documentation](https://discord.js.org/docs) — Version, Node.js requirements, API reference
- [discord.js Guide](https://discordjs.guide/) — Slash commands, message components, collectors, threads
- [Discord API Rate Limits](https://discord.com/developers/docs/topics/rate-limits) — 5 edits/5 seconds limit, global limits
- [Discord Interactions](https://discord.com/developers/docs/interactions/receiving-and-responding) — 3-second timeout, 15-minute token expiry

**Package Verification:**
- [@anthropic-ai/claude-agent-sdk on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — v0.2.39, peer dependencies
- [better-sqlite3 on npm](https://www.npmjs.com/package/better-sqlite3) — v12.6.2
- [pino on npm](https://www.npmjs.com/package/pino) — v10.1.0
- [tsx on npm](https://www.npmjs.com/package/tsx) — v4.21.0
- [vitest on npm](https://www.npmjs.com/package/vitest) — v4.0.18
- [Node.js releases](https://nodejs.org/en/about/previous-releases) — LTS schedule, v22 status

### Secondary (MEDIUM confidence)

**Existing Implementations:**
- [claude-discord-bridge (thcapp)](https://github.com/thcapp/claude-discord-bridge) — 50+ commands, SQLite persistence, PTY/tmux architecture
- [discord-agent-bridge (DoBuDevel)](https://github.com/DoBuDevel/discord-agent-bridge) — tmux polling approach, multi-agent support
- [claude-code-discord (zebbern)](https://github.com/zebbern/claude-code-discord) — Deno-based, 45+ commands, channel-per-branch
- [claude-code-discord-bot (timoconnellaus)](https://deepwiki.com/timoconnellaus/claude-code-discord-bot) — Agent SDK approach, emoji reactions for permissions
- [Disclaude](https://disclaude.com/) — Minimal focused proxy, tmux sessions, real-time streaming
- [node-pty on GitHub](https://github.com/microsoft/node-pty) — v1.1.0, native compilation requirements

### Tertiary (LOW confidence)

- [Discord Character Limits](https://lettercounter.org/blog/discord-character-limit/) — 2000-char message limit reference
- [Zod v4 versioning](https://zod.dev/v4/versioning) — v3/v4 coexistence patterns
- [Discord Bot Security Best Practices](https://friendify.net/blog/discord-bot-security-best-practices-2025.html) — General security patterns

---
*Research completed: 2026-02-12*
*Ready for roadmap: yes*
