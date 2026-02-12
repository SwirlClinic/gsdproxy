# GSD Proxy

## What This Is

A Discord bot that acts as a full bidirectional bridge to Claude Code running on a local MacBook. Users interact with Claude through Discord messages and slash commands, getting summaries in-channel with full logs in threads. Interactive prompts (permissions, confirmations, option selections) are forwarded to Discord for real-time response. Built for a single user who wants full terminal-equivalent access to Claude Code and the GSD framework from anywhere.

## Core Value

Full bidirectional Claude Code access from Discord — anything you can do in the terminal, you can do from a Discord channel.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Bidirectional message bridge between Discord and Claude Code CLI
- [ ] Freeform chat with Claude through Discord messages
- [ ] Discord slash commands mapped to all GSD framework commands
- [ ] Interactive prompt forwarding (permissions, yes/no, option selections) to Discord
- [ ] Summary output in Discord channel with full logs in threads
- [ ] On-demand start/stop of the bot
- [ ] Single-user authentication (only the bot owner can interact)
- [ ] Terminal process management (spawn, manage, terminate Claude Code sessions)

### Out of Scope

- Multi-user access — this is a personal tool, not a shared service
- Web dashboard — Discord is the only interface
- Mobile app — Discord handles mobile access
- Scheduled/automated runs — on-demand only
- Voice channel integration — text-only

## Context

- Claude Code is an interactive CLI tool that reads/writes files, runs commands, and responds to prompts
- The GSD framework adds slash commands (/gsd:progress, /gsd:plan-phase, etc.) on top of Claude Code
- Claude Code has interactive moments: permission prompts for tool use, option selections via AskUserQuestion, confirmation dialogs
- Discord has a 2000-character message limit, so long Claude output needs chunking or summarization
- Discord.js is the standard Node.js library for Discord bots
- The bot runs locally on the same machine as Claude Code — no remote server needed
- Claude Code uses a PTY (pseudo-terminal) for interactive I/O

## Constraints

- **Platform**: macOS only — runs on the user's MacBook
- **Tech stack**: TypeScript/Node.js with discord.js
- **Network**: Requires internet for Discord API, Claude Code handles its own API calls
- **Security**: Must ensure only the authorized Discord user can send commands
- **Discord limits**: 2000-char message limit, rate limiting on API calls
- **Process model**: Must handle Claude Code's interactive PTY I/O, not just stdin/stdout pipes

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript/Node.js | User preference, discord.js ecosystem is mature | — Pending |
| Discord as sole interface | User wants mobile/remote access, Discord already on all devices | — Pending |
| Single-user only | Personal tool, simplifies auth to Discord user ID check | — Pending |
| On-demand operation | User starts/stops bot manually, no daemon needed | — Pending |
| Summary + thread logs | Discord message limits make full output impractical in-channel | — Pending |

---
*Last updated: 2026-02-12 after initialization*
