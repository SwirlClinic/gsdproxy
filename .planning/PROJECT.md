# GSD Proxy

## What This Is

A Discord bot that acts as a full bidirectional bridge to Claude Code running on a local MacBook. Users interact with Claude through Discord messages and slash commands, getting real-time streaming responses with tool activity indicators. Interactive prompts (permissions, confirmations, option selections) are forwarded to Discord as buttons and select menus. Multiple concurrent sessions run in separate threads with cost tracking and bot presence indicators. Built for a single user who wants full terminal-equivalent access to Claude Code from anywhere.

## Core Value

Full bidirectional Claude Code access from Discord -- anything you can do in the terminal, you can do from a Discord channel.

## Requirements

### Validated

- ✓ Bidirectional message bridge between Discord and Claude Code CLI -- v1.0
- ✓ Freeform chat with Claude through Discord messages -- v1.0
- ✓ Interactive prompt forwarding (permissions, yes/no, option selections) to Discord -- v1.0
- ✓ Summary output in Discord channel with full logs in threads -- v1.0
- ✓ Real-time streaming with debounced message edits -- v1.0
- ✓ On-demand start/stop of the bot -- v1.0
- ✓ Single-user authentication (only the bot owner can interact) -- v1.0
- ✓ Session management (new/stop/continue/status) with concurrent sessions -- v1.0
- ✓ Token usage and cost tracking via /status -- v1.0

### Active

(None -- planning next milestone)

### Out of Scope

- Multi-user access -- this is a personal tool, not a shared service
- Web dashboard -- Discord is the only interface
- Mobile app -- Discord handles mobile access
- Scheduled/automated runs -- on-demand only
- Voice channel integration -- text-only
- Cross-restart session persistence -- sessions are in-memory only (v1.0 decision)
- Auto-accept all permissions -- eliminates core safety mechanism
- File upload/download through Discord -- Claude already has filesystem access

## Context

Shipped v1.0 with 3,101 LOC TypeScript across 3 phases (9 plans) in 4 days.
Tech stack: TypeScript, Node.js, discord.js 14.x, pino, Claude CLI (stream-json mode).
Architecture: BridgeRouter orchestrates SessionManager (multi-session), StreamingMessage (debounced edits), IpcServer + PermissionHandler (MCP permission forwarding).
5 slash commands: /help, /new, /stop, /continue, /status.

## Constraints

- **Platform**: macOS only -- runs on the user's MacBook
- **Tech stack**: TypeScript/Node.js with discord.js
- **Network**: Requires internet for Discord API, Claude Code handles its own API calls
- **Security**: Must ensure only the authorized Discord user can send commands
- **Discord limits**: 2000-char message limit, rate limiting on API calls
- **Process model**: Claude CLI spawned as persistent stream-json subprocess (not PTY)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript/Node.js | User preference, discord.js ecosystem is mature | ✓ Good |
| Discord as sole interface | User wants mobile/remote access, Discord already on all devices | ✓ Good |
| Single-user only | Personal tool, simplifies auth to Discord user ID check | ✓ Good |
| On-demand operation | User starts/stops bot manually, no daemon needed | ✓ Good |
| Summary + thread logs | Discord message limits make full output impractical in-channel | ✓ Good |
| Stream-json (not PTY) | CLI requires inherited stdin for stream-json; persistent process maintains context | ✓ Good |
| MCP permission server via IPC | Decouples Claude CLI from Discord; single IPC port for all sessions | ✓ Good |
| In-memory sessions only | Simpler than persistence; user decided restart = fresh start | ✓ Good |
| SessionManager with thread-keyed Map | 1:1 thread-to-session mapping enables concurrent sessions | ✓ Good |
| Setter callback pattern for commands | Avoids circular dependencies; clean separation of registration vs logic | ✓ Good |

---
*Last updated: 2026-02-16 after v1.0 milestone*
