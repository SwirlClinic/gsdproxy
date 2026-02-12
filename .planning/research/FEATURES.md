# Feature Research

**Domain:** Discord-to-CLI proxy bot (Claude Code bridge)
**Researched:** 2026-02-12
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete. Derived from analysis of 8+ existing projects in this space: claude-code-discord (zebbern), Disclaude, claude-discord-bridge (thcapp), Claude-Code-Remote, claude-discord-bridge (yamkz), ccdiscord (mizchi), claude-code-discord-bot (timoconnellaus), and general Discord shell bots (BashBot, remoteDiscordShell, discord-ssh).

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Send messages to Claude Code** | Core purpose of the bot -- user types in Discord, message goes to Claude Code CLI | MEDIUM | Every competitor has this. Use the TypeScript Agent SDK `query()` with streaming input mode for bidirectional communication. Do NOT shell out to `claude -p` for each message -- use persistent sessions. |
| **Receive and display Claude responses** | Users need to see what Claude said back | MEDIUM | All competitors stream responses. Must handle Discord's 2000-char message limit (4096 for embed descriptions). Split long responses intelligently at code block or paragraph boundaries, not mid-word. |
| **Permission/tool approval forwarding** | Claude Code asks "allow Bash command X?" -- user must see this in Discord and respond | HIGH | This is the defining feature of a "proxy" vs a "wrapper." The Agent SDK's `canUseTool` callback is purpose-built for this. Present tool name + input (e.g., command text, file path) with approve/deny buttons. timoconnellaus's bot uses Discord reactions for this; Disclaude uses clickable numbered buttons. Use Discord buttons (ButtonBuilder) -- they are more reliable than reactions. |
| **Session persistence** | Sessions must survive bot restarts, network blips | MEDIUM | Every serious competitor uses either tmux (Disclaude, yamkz) or SQLite (thcapp, timoconnellaus). The Agent SDK supports `--resume` with session IDs -- store session_id per channel and resume on reconnect. No tmux needed if using the SDK properly. |
| **Start/stop control** | User must be able to start a new session and end the current one | LOW | Every competitor has this. Slash commands: `/start`, `/stop`, `/new`. Map to SDK's `query()` creation and `AbortController.abort()`. |
| **Single-user access control** | Only the authorized user should be able to interact with the bot | LOW | Every competitor implements this. Use `ALLOWED_USER_ID` environment variable. Check `interaction.user.id` on every command and message. Reject all others silently or with a brief denial. |
| **Slash command interface** | Discord standard for bot interaction since 2021 | LOW | All modern competitors use slash commands. Register with Discord's application commands API via discord.js. Required for discoverability and parameter validation. |
| **Code block formatting** | Claude output contains code -- must render as Discord code blocks | LOW | All competitors handle this. Parse Claude's markdown output and wrap code in Discord code blocks with language hints. discord.js handles this natively. |
| **Error handling and recovery** | Bot must not crash silently on Claude Code errors, timeouts, or disconnects | MEDIUM | Common failure in simpler bots. Handle: SDK process crash, API rate limits, network disconnects, Discord API errors. Report errors clearly in-channel rather than going silent. |

### Differentiators (Competitive Advantage)

Features that set GSD Proxy apart. These are where the product competes against the 8+ existing solutions.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Bidirectional interactive prompt forwarding** | Full forwarding of ALL Claude Code interactive prompts to Discord -- not just tool approvals but also `AskUserQuestion` clarifying questions with multiple-choice options rendered as Discord select menus or buttons | HIGH | This is THE key differentiator. Most competitors either run `--dangerouslySkipPermissions` (unsafe) or use basic approve/deny. The Agent SDK's `canUseTool` callback handles both tool approvals AND `AskUserQuestion` with structured question/option/multiSelect data. Render questions as Discord embeds with button rows for options. This makes the bot a true interactive proxy rather than a fire-and-forget executor. |
| **Thread-based output organization** | Main channel gets a concise summary; full conversation lives in a Discord thread. Each task/session gets its own thread. | MEDIUM | Disclaude creates channels per session (heavy). thcapp's bridge uses threads. Threads are lighter weight -- one thread per task, summaries in main channel. Prevents channel spam from verbose Claude output. Discord threads auto-archive after inactivity, which is a feature here not a bug. |
| **Real-time streaming display** | Show Claude's response tokens as they arrive, not after completion | HIGH | The Agent SDK supports `includePartialMessages: true` with `stream_event` messages containing `text_delta` events. Edit Discord messages in-place as tokens arrive. Rate-limit edits to avoid Discord API rate limits (~5 edits/5 seconds per message). Disclaude does this with ANSI colors; thcapp does JSON streaming. Most simpler bots wait for full response. |
| **Smart output summarization** | Summarize long outputs (file diffs, grep results, test runs) in the main channel while preserving full output in threads | MEDIUM | No existing competitor does this well. When Claude's response exceeds ~1500 chars, post a summary in the main channel and full output in a thread reply. Summaries can be the first N lines + "... (continued in thread)" or an AI-generated summary. |
| **Tool activity indicators** | Show what Claude is doing in real-time: "Reading auth.py...", "Running npm test...", "Editing server.ts..." | LOW | The Agent SDK emits `content_block_start` events for tool_use with tool name and input. Display as ephemeral status messages or embed footers. thcapp's bot does this with `[Using Read...]` indicators. Makes the bot feel responsive during long operations. |
| **On-demand start/stop of the bot process** | Bot is not always running -- user starts it when needed from Discord or a simple launcher, stops when done to save resources | MEDIUM | Unique to single-user, local-machine context. Most competitors assume always-on. Could use a lightweight "launcher" process that is always connected to Discord but only spawns Claude Code when `/start` is invoked. Saves CPU/memory when not in use. |
| **Cost and token tracking** | Show token usage and estimated cost after each interaction or session | LOW | The SDK's `ResultMessage` includes `total_cost_usd`, `usage` (input/output tokens), and per-model breakdown via `modelUsage`. Display in thread footer or via a `/stats` command. Claude-discord-bridge (thcapp) does this with budget limits. |
| **Session continuation** | Continue a previous conversation with `/continue` rather than starting fresh each time | LOW | The Agent SDK natively supports `--continue` and `--resume` with session IDs. Store last session_id and offer a `/continue` command. Avoids losing context when you step away and come back. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems for this specific use case (single-user, local macOS, Claude Code proxy).

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Multi-user access** | "Let my team use it too" | Massive security risk -- Claude Code runs with YOUR filesystem permissions on YOUR machine. Multi-user means any team member can read/write/delete your files, run arbitrary commands. Also creates session contention (who is Claude talking to?). Every competitor that supports multi-user does it on isolated Docker containers, not shared local machines. | Keep single-user. If team access is needed later, each person runs their own instance on their own machine. |
| **Always-on daemon mode** | "I want it running 24/7" | Wastes resources (Claude Code idle = memory leak risk from long-running Node processes), security exposure (bot is a remote shell into your machine), and unnecessary for a single-user tool. | On-demand start/stop. Lightweight heartbeat process if needed for presence, but no active Claude Code session when idle. |
| **Auto-accept all permissions** | "Just let Claude do whatever it wants, I trust it" | Running with `--dangerouslySkipPermissions` eliminates the core safety mechanism. One hallucinated `rm -rf` or accidental credential leak and you lose data. ccdiscord (mizchi) requires this flag. | Forward every permission request to Discord. Make it fast (one button tap) so it doesn't feel burdensome. Default-deny on timeout. |
| **Web dashboard / GUI** | "I want a web interface to manage sessions" | Adds an entire web stack (HTTP server, auth, frontend framework) for a single-user tool. Discord IS the interface. Adding another interface doubles maintenance for no user benefit. | Use Discord as the sole interface. Slash commands for management, embeds for status, threads for history. |
| **File upload/download through Discord** | "Let me send files to Claude through Discord" | Discord file handling is limited (25MB for free, complex attachment API), and Claude Code already has filesystem access. Downloading from Discord to local FS introduces unnecessary complexity and potential path traversal issues. | Claude Code already reads your local filesystem. Just tell it which file to look at. For sharing output files, post file contents in thread messages or use code blocks. |
| **Multiple concurrent Claude sessions** | "Run Claude on 3 projects at once" | Each Claude Code session consumes significant memory and API tokens. Multiple sessions multiply cost and resource usage. Also creates UX complexity (which channel maps to which session?). thcapp and yamkz support this but it adds significant complexity. | One session at a time. Use `/stop` and `/start` to switch between projects by specifying the working directory. Session history persists via resume. |
| **Voice channel integration** | "Talk to Claude with voice" | Speech-to-text adds latency, errors, and complexity. Code-oriented conversations have too many symbols, variable names, and technical terms for reliable voice recognition. | Text only. Discord messages are the right medium for code conversations. |
| **Custom slash commands per project** | "Register project-specific commands" | Dynamic command registration is slow (Discord caches commands for up to an hour), brittle, and adds complexity. Claude Code already understands natural language -- you don't need `/run-tests` when you can type "run the tests." | A small set of fixed structural commands (`/start`, `/stop`, `/continue`, `/status`, `/clear`). Everything else is natural language to Claude. |
| **Plugin/extension system** | "Let me add custom tools and integrations" | The Agent SDK already has MCP server support and hooks. Building a separate plugin layer on top creates a maintenance burden and abstraction confusion. | Use the Agent SDK's built-in MCP server configuration (`mcpServers` option) and hooks system directly. Document how users can add MCP servers via config. |

## Feature Dependencies

```
[Discord Bot Core (connect, auth, slash commands)]
    |
    +--requires--> [Message Sending to Claude Code (Agent SDK query)]
    |                   |
    |                   +--requires--> [Session Management (create, store, resume)]
    |                   |
    |                   +--requires--> [Response Display (formatting, splitting)]
    |                   |                   |
    |                   |                   +--enhances--> [Thread-based Organization]
    |                   |                   |
    |                   |                   +--enhances--> [Smart Output Summarization]
    |                   |
    |                   +--requires--> [Permission Forwarding (canUseTool callback)]
    |                   |                   |
    |                   |                   +--enhances--> [Interactive Prompt Forwarding (AskUserQuestion)]
    |                   |                   |
    |                   |                   +--requires--> [Discord Buttons/Components]
    |                   |
    |                   +--enhances--> [Real-time Streaming (includePartialMessages)]
    |                   |                   |
    |                   |                   +--enhances--> [Tool Activity Indicators]
    |                   |
    |                   +--enhances--> [Session Continuation (resume)]
    |                   |
    |                   +--enhances--> [Cost/Token Tracking]
    |
    +--enhances--> [On-demand Start/Stop]
```

### Dependency Notes

- **Discord Bot Core is the foundation:** Nothing works without a connected Discord bot with registered slash commands and message handling.
- **Agent SDK `query()` requires Session Management:** Every query needs a session context. Session IDs must be stored to enable resume. Without persistence, you lose conversation history on every restart.
- **Permission Forwarding requires Discord Buttons:** Approve/deny with text responses is fragile and slow. Buttons provide reliable, one-tap interaction. `canUseTool` callback must be async and wait for Discord user interaction.
- **Interactive Prompt Forwarding requires Permission Forwarding:** `AskUserQuestion` is handled by the same `canUseTool` callback. Build the permission forwarding first, then extend it to handle structured questions.
- **Real-time Streaming requires Response Display:** You must first solve message splitting and formatting before you can do incremental updates via message edits.
- **Thread Organization enhances Response Display:** Threads are optional but transform the UX from "wall of text in channel" to "clean summary with details on demand."
- **Tool Activity Indicators require Real-time Streaming:** You detect tool_use events from the stream. Without streaming enabled, you only see completed messages.

## MVP Definition

### Launch With (v1)

Minimum viable product -- what's needed to validate the core concept of "Discord as a remote interface to Claude Code."

- [x] **Discord Bot Core** -- Connect to Discord, register 4-5 slash commands, handle messages in a designated channel
- [x] **Message Sending** -- Forward Discord messages to Claude Code via Agent SDK `query()` with streaming input
- [x] **Response Display** -- Show Claude's responses in Discord with proper code block formatting and message splitting at 2000-char boundaries
- [x] **Permission Forwarding** -- Forward tool approval requests to Discord as embeds with approve/deny buttons, wait for user response, return decision to SDK
- [x] **Session Management** -- Create sessions on `/start`, store session IDs, end sessions on `/stop`
- [x] **Single-user Access Control** -- Reject interactions from unauthorized users

**Rationale:** This set proves the core value proposition: you can control Claude Code from your phone/another device via Discord, including handling permissions interactively. Everything else is polish.

### Add After Validation (v1.x)

Features to add once core proxy loop is working and stable.

- [ ] **Real-time Streaming** -- Edit messages in-place as tokens arrive, with rate limiting to avoid Discord API throttling
- [ ] **Thread-based Organization** -- Move detailed output to threads, keep channel clean with summaries
- [ ] **Interactive Prompt Forwarding (AskUserQuestion)** -- Render Claude's clarifying questions as Discord select menus or multi-button layouts
- [ ] **Tool Activity Indicators** -- Show "Reading file...", "Running command..." status during tool execution
- [ ] **Session Continuation** -- `/continue` command to resume the last session
- [ ] **On-demand Process Management** -- Lightweight launcher that stays connected to Discord but only spawns Claude Code when requested

### Future Consideration (v2+)

Features to defer until the core experience is polished.

- [ ] **Smart Output Summarization** -- AI-generated summaries for long outputs; needs experimentation to get right
- [ ] **Cost/Token Tracking** -- Per-session and cumulative usage stats
- [ ] **File Checkpointing** -- Leverage SDK's `enableFileCheckpointing` for undo/rewind via Discord commands
- [ ] **Image Attachment Support** -- Pass Discord image attachments to Claude Code for analysis (the SDK supports image content blocks)
- [ ] **Multiple Working Directories** -- Switch between project directories with `/project` without restarting

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Message send/receive | HIGH | MEDIUM | P1 |
| Permission forwarding (approve/deny) | HIGH | HIGH | P1 |
| Response formatting (code blocks, splitting) | HIGH | LOW | P1 |
| Session create/stop | HIGH | LOW | P1 |
| Single-user auth | HIGH | LOW | P1 |
| Slash command registration | MEDIUM | LOW | P1 |
| Real-time streaming | HIGH | MEDIUM | P2 |
| Thread-based organization | HIGH | MEDIUM | P2 |
| AskUserQuestion forwarding | MEDIUM | MEDIUM | P2 |
| Tool activity indicators | MEDIUM | LOW | P2 |
| Session continuation/resume | MEDIUM | LOW | P2 |
| On-demand start/stop | MEDIUM | MEDIUM | P2 |
| Smart output summarization | MEDIUM | HIGH | P3 |
| Cost/token tracking | LOW | LOW | P3 |
| File checkpointing/rewind | LOW | MEDIUM | P3 |
| Image attachment support | LOW | MEDIUM | P3 |
| Multiple working directories | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for launch (core proxy loop)
- P2: Should have, add once core is stable (polish and UX)
- P3: Nice to have, future consideration (advanced features)

## Competitor Feature Analysis

| Feature | zebbern/claude-code-discord | Disclaude | thcapp/claude-discord-bridge | timoconnellaus/claude-code-discord-bot | Our Approach |
|---------|---------------------------|-----------|------------------------------|---------------------------------------|--------------|
| **Session management** | Channel-per-branch, persistent | tmux sessions, channel-per-session | SQLite + tmux, multi-session | SQLite, channel-per-project | Agent SDK session IDs stored locally, one active session, resume support |
| **Permission handling** | Operation modes (normal, auto-accept, danger) | Clickable buttons for numbered options | Not documented | Discord reactions (approve/deny emoji) | `canUseTool` callback with Discord button components for approve/deny |
| **Output handling** | Embedded formatting | Real-time streaming with ANSI colors | JSON streaming, syntax highlighting | JSON-parsed SDK messages, real-time streaming | Streaming with in-place message edits, threads for overflow |
| **Interactive prompts** | Not specifically documented | Buttons for numbered choices | Modal-based code input, select menus | Not documented | Full `AskUserQuestion` rendering with Discord buttons/select menus |
| **Access control** | Role-based (multiple users) | User whitelist | Multi-user with session handoff | Single allowed user ID | Single allowed user ID |
| **Architecture** | CLI subprocess | tmux bridge | CLI + tmux + PTY fallback | Agent SDK (TypeScript) | Agent SDK (TypeScript) -- cleanest approach |
| **Scope** | 45+ commands, 7 AI agents, system monitoring | Minimal, focused on sessions | 50+ commands, file ops, web, git, analytics | Focused on proxy with permission handling | Focused on proxy. Small command surface. Natural language for everything else. |

**Key insight from competitor analysis:** The market is split between "kitchen sink" bots (zebbern, thcapp) with 45-50+ commands and focused proxy bots (Disclaude, timoconnellaus, mizchi). The focused bots are easier to use and maintain. GSD Proxy should be in the focused camp -- Claude Code itself is the "kitchen sink." The bot just needs to be a clean pipe between Discord and the SDK.

**Strongest competitor:** timoconnellaus/claude-code-discord-bot. Same architecture choice (Agent SDK TypeScript), same single-user focus, same permission-forwarding approach. However, it uses emoji reactions for approvals (slower, less reliable than buttons) and lacks thread organization and streaming output display. These are the gaps to fill.

## Sources

- [zebbern/claude-code-discord](https://github.com/zebbern/claude-code-discord) -- 45+ command Discord bot for Claude Code (MEDIUM confidence)
- [Disclaude](https://disclaude.com/) -- tmux-based Claude Code Discord bridge (MEDIUM confidence)
- [thcapp/claude-discord-bridge](https://github.com/thcapp/claude-discord-bridge) -- Feature-rich bridge with 50+ commands (MEDIUM confidence)
- [JessyTsui/Claude-Code-Remote](https://github.com/JessyTsui/Claude-Code-Remote) -- Multi-platform remote control for Claude Code (MEDIUM confidence)
- [yamkz/claude-discord-bridge](https://github.com/yamkz/claude-discord-bridge) -- Portable multi-session bridge (LOW confidence, limited English docs)
- [mizchi/ccdiscord](https://jsr.io/@mizchi/ccdiscord) -- Minimal Deno-based Discord bot (LOW confidence, sparse docs)
- [timoconnellaus/claude-code-discord-bot](https://deepwiki.com/timoconnellaus/claude-code-discord-bot) -- SDK-based bot with permission reactions (MEDIUM confidence, via DeepWiki)
- [Adikso/BashBot](https://github.com/Adikso/BashBot) -- General Discord terminal bot with interactive support (MEDIUM confidence)
- [EnriqueMoran/remoteDiscordShell](https://github.com/EnriqueMoran/remoteDiscordShell) -- Remote Linux shell via Discord (MEDIUM confidence)
- [Claude Code Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- Official SDK documentation (HIGH confidence)
- [Claude Code Headless/Programmatic Mode](https://code.claude.com/docs/en/headless) -- Official CLI documentation (HIGH confidence)
- [Agent SDK Streaming Output](https://platform.claude.com/docs/en/agent-sdk/streaming-output) -- Official streaming docs (HIGH confidence)
- [Agent SDK User Input/Approvals](https://platform.claude.com/docs/en/agent-sdk/user-input) -- Official permission and question handling docs (HIGH confidence)
- [Discord Character Limits 2026](https://lettercounter.org/blog/discord-character-limit/) -- Message/embed limits reference (MEDIUM confidence)

---
*Feature research for: Discord-to-CLI proxy bot (Claude Code bridge)*
*Researched: 2026-02-12*
