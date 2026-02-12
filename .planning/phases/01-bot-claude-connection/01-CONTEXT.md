# Phase 1: Bot + Claude Connection - Context

**Gathered:** 2026-02-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Discord bot that connects to Claude Code CLI and provides a bidirectional message bridge. User starts the bot, sends messages in a dedicated Discord channel, and sees Claude's formatted responses. This phase establishes the core connection — permission forwarding, threading, and session persistence come in later phases.

</domain>

<decisions>
## Implementation Decisions

### Core Architecture: CLI Spawning (NOT Agent SDK)
- **Use the `claude` CLI directly** — spawn it as a subprocess, not the Agent SDK
- User wants to leverage their existing Claude subscription (Pro/Max), not pay separately via API key
- Use `claude -p --output-format stream-json` for structured JSON streaming output
- The bot is a proxy to the terminal, not a separate SDK integration
- Claude Code auth and settings "just work" — no API key configuration needed
- This is a **reversal of the research recommendation** — research suggested Agent SDK, user chose CLI for subscription billing and terminal-native feel

### Discord Interaction Model
- **Dedicated channel** — bot listens in one specific Discord channel
- Everything typed in that channel goes to Claude
- **Always respond** — any message in the channel triggers Claude, auto-starts a session if none exists
- **Continuous conversation** — follow-up messages continue the same Claude session, like typing in a terminal
- Slash commands only work in the dedicated channel
- Working directory is fixed at startup (wherever you ran `gsdproxy` from)

### Response Presentation
- **Typing indicator + status message** — show Discord's "Bot is typing..." while processing, plus a status message like "Working on it..." for longer waits
- **Show basic tool activity in Phase 1** — when Claude reads a file or runs a command, show what it's doing (e.g., "Reading file.ts...") even in this first phase
- Long output and formatting approach: Claude's discretion on message format (plain markdown, embeds, etc.) and splitting strategy

### Bot Startup & Config
- **Custom CLI command**: `gsdproxy` — run from the terminal to start the bot
- **Working directory**: wherever you run `gsdproxy` — same as running `claude` directly
- **Auth**: Claude Code auth inherited from the shell (existing subscription). No ANTHROPIC_API_KEY needed.
- **Discord bot token**: stored in `.env` file in the project
- **Dedicated channel ID**: configured in `.env` or passed as argument

### Slash Command Design
- Phase 1 command set: Claude's discretion (at minimum /status and /stop)
- `/stop` behavior: **abort immediately** — kill the claude process, post "stopped" message
- Commands restricted to the dedicated channel only
- No /cd or working directory changes — fixed at startup

### Claude's Discretion
- Response formatting approach (plain messages, embeds, or hybrid)
- Long message splitting strategy (multiple messages, truncation, file attachment)
- Exact Phase 1 slash command set (beyond /status and /stop)
- Handling of concurrent messages (queue, reject, or interrupt)

</decisions>

<specifics>
## Specific Ideas

- The bot should feel like you're using a terminal — you type, Claude responds, conversation continues
- "Shouldn't it just be accessing the terminal and already have access to everything?" — the user expects this to be a thin proxy, not a new integration layer
- Tool activity should be visible from the start — the user wants to see what Claude is doing even in Phase 1

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-bot-claude-connection*
*Context gathered: 2026-02-12*
