# GSD Proxy

A Discord bot that provides full bidirectional access to [Claude Code](https://claude.ai/code) from any device. Send messages, approve tool permissions with buttons, watch responses stream in real-time, and manage multiple concurrent sessions — all from Discord.

## Features

- **Bidirectional messaging** — Send prompts to Claude Code and receive formatted responses with markdown and code blocks
- **Permission forwarding** — Claude's tool permission requests appear as Discord button prompts (Allow/Deny) with 5-minute auto-deny timeout
- **Real-time streaming** — Watch Claude's response build in real-time via debounced message edits with tool activity indicators
- **Thread-based output** — Each session gets its own thread for detailed output; main channel gets a concise summary
- **Multi-session support** — Run multiple concurrent Claude sessions in separate threads
- **Session lifecycle** — `/new`, `/stop`, `/continue`, `/status` slash commands
- **Cost tracking** — Token counts and estimated cost displayed via `/status`
- **Bot presence** — Status indicator reflects session state (green=ready, yellow=active, red=working)
- **Owner-only access** — Only the configured Discord user can interact with the bot

## Architecture

```
Discord                          Local Machine
───────                          ─────────────
                                 ┌─────────────────────────┐
User message ──────────────────► │ BridgeRouter             │
                                 │  ├─ SessionManager       │
                                 │  │   └─ ManagedSession[] │
                                 │  │       └─ ClaudeSession│──► Claude CLI
                                 │  ├─ StreamingMessage     │    (stream-json)
                                 │  └─ PermissionHandler    │
                                 └──────────┬──────────────┘
                                            │
Permission prompt ◄─────── IpcServer ◄──────┘
  [Allow] [Deny]              ▲
       │                      │
       └──────────────────────┘
                          MCP Permission Server
                          (stdio subprocess)
```

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| **BridgeRouter** | `src/bridge/router.ts` | Orchestrates message flow between Discord and Claude sessions |
| **SessionManager** | `src/bridge/session-manager.ts` | Multi-session registry keyed by Discord thread ID |
| **ClaudeSession** | `src/claude/session.ts` | Persistent Claude CLI subprocess wrapper (stream-json mode) |
| **StreamingMessage** | `src/bridge/streaming-message.ts` | Debounced Discord message edits (1.5s) for real-time streaming |
| **IpcServer** | `src/bridge/ipc-server.ts` | HTTP server bridging MCP permission requests to Discord |
| **PermissionHandler** | `src/bridge/permission-handler.ts` | Renders permission/question prompts as Discord embeds and buttons |
| **MCP Permission Server** | `src/mcp/permission-server.ts` | MCP stdio server spawned by Claude CLI for permission forwarding |

### Data Flow

1. User sends a message in Discord (main channel or session thread)
2. Message handler routes to `BridgeRouter` — creates a new session or uses existing
3. `ClaudeSession` sends the prompt to the persistent Claude CLI process via stdin
4. Claude's stream-json events flow back: text deltas update `StreamingMessage`, tool events show activity indicators
5. If Claude needs permission, the MCP server forwards the request through IPC to Discord buttons
6. User clicks Allow/Deny, decision flows back through IPC to Claude
7. Final response is split and posted to the thread; a summary goes to the main channel

## Setup

### Prerequisites

- Node.js 20+
- [Claude Code CLI](https://claude.ai/code) installed and authenticated
- A Discord bot with the following:
  - Bot token
  - `MESSAGE_CONTENT` intent enabled
  - `Send Messages`, `Create Public Threads`, `Read Message History`, `Use Slash Commands` permissions

### Installation

```bash
git clone https://github.com/SwirlClinic/gsdproxy.git
cd gsdproxy
npm install
```

### Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```env
DISCORD_TOKEN=your-bot-token
DISCORD_APP_ID=your-app-id
DISCORD_GUILD_ID=your-guild-id
DISCORD_CHANNEL_ID=your-channel-id
DISCORD_OWNER_ID=your-discord-user-id
```

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal |
| `DISCORD_APP_ID` | Application ID from Discord Developer Portal |
| `DISCORD_GUILD_ID` | Server ID where the bot operates |
| `DISCORD_CHANNEL_ID` | Channel ID the bot listens in |
| `DISCORD_OWNER_ID` | Your Discord user ID (only this user can interact) |
| `GSD_IPC_PORT` | Optional. IPC port for permission forwarding (default: 9824) |
| `DANGEROUSLY_SKIP_PERMISSIONS` | Optional. Set `true` to auto-approve all tool use |

### Running

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build
npm start
```

### Skipping Permission Prompts

By default, every tool use by Claude (file edits, shell commands, etc.) is forwarded to Discord as a permission prompt that you must approve or deny. To auto-approve all tool use and skip these prompts:

```env
DANGEROUSLY_SKIP_PERMISSIONS=true
```

This passes `--dangerously-skip-permissions` to the Claude CLI subprocess. Use with caution — Claude will be able to execute any tool without confirmation.

## Commands

| Command | Description |
|---------|-------------|
| `/new` | Start a new Claude session (creates a thread). Warns if sessions already active. |
| `/stop` | Stop an active session. Shows a picker if multiple sessions exist. |
| `/continue` | Resume the most recent session. Handles dead sessions gracefully. |
| `/status` | Show all active sessions with age, message count, tokens, and cost. |
| `/help` | Show available commands. |

You can also just send a message in the configured channel — it will automatically create a session.

## Project Structure

```
src/
├── index.ts                          # Entry point, wiring, command callbacks
├── config.ts                         # Environment variable validation
├── logger.ts                         # Pino logger
├── bridge/
│   ├── router.ts                     # Message orchestration
│   ├── session-manager.ts            # Multi-session registry
│   ├── streaming-message.ts          # Debounced Discord message edits
│   ├── ipc-server.ts                 # HTTP server for permission IPC
│   └── permission-handler.ts         # Discord embed/button permission prompts
├── claude/
│   ├── session.ts                    # Persistent Claude CLI process wrapper
│   └── types.ts                      # TypeScript types for stream events
├── discord/
│   ├── client.ts                     # Discord.js client setup
│   ├── formatter.ts                  # Message splitting and tool activity formatting
│   ├── commands/                     # Slash command definitions
│   │   ├── index.ts                  # Command registry
│   │   ├── new.ts, stop.ts, continue.ts, status.ts, help.ts
│   ├── components/                   # Discord UI builders
│   │   ├── permission-prompt.ts      # Permission embed + buttons
│   │   ├── question-prompt.ts        # AskUserQuestion select menu
│   │   ├── status-embed.ts           # Rich status/resume embeds
│   │   └── session-picker.ts         # Session select menu for /stop
│   └── handlers/
│       ├── message.ts                # Message routing (thread vs channel)
│       └── interaction.ts            # Slash command dispatch
└── mcp/
    ├── permission-server.ts          # MCP stdio server for Claude CLI
    └── ipc-client.ts                 # HTTP client for IPC forwarding
```

## Design Decisions

- **Stream-json mode** over PTY — Claude CLI's `--input-format stream-json` provides structured event output that's easy to parse. The persistent process maintains conversation context across messages without needing `--continue` flags.
- **MCP permission forwarding** — Claude CLI's `--permission-prompt-tool` delegates permission decisions to an MCP server. The MCP server forwards requests over HTTP IPC to the bot, which renders Discord buttons and returns the user's decision.
- **In-memory sessions** — Sessions live only in the bot's process memory. Restarting the bot clears all sessions. This was a deliberate simplicity choice over file/database persistence.
- **Setter callback pattern** — Commands use setter functions (`setOnNew`, `setOnStop`, etc.) to receive their implementation from `index.ts`, avoiding circular dependency issues between command modules and the session manager.
- **Thread-keyed session map** — Each Discord thread maps 1:1 to a `ManagedSession`. The thread ID is the session key, making message routing a simple map lookup.

## License

MIT
