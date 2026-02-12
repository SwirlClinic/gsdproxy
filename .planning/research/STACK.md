# Stack Research

**Domain:** Discord-to-CLI proxy bot (Claude Code bridge)
**Researched:** 2026-02-12
**Confidence:** HIGH

## Critical Architecture Decision: Agent SDK vs. PTY/CLI Spawning

Before listing technologies, this decision shapes the entire stack.

**Recommendation: Use the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) instead of spawning the `claude` CLI via node-pty or child_process.**

**Why this matters:**
- The Agent SDK provides the same tools, agent loop, and context management that power Claude Code, but as a proper TypeScript library with typed async generators
- It eliminates the entire PTY layer -- no native module compilation, no ANSI escape parsing, no terminal emulation headaches
- It provides structured streaming output (text deltas, tool use events, result messages) instead of raw terminal bytes
- It supports session management (resume, continue) natively via session IDs
- It has built-in hooks (PreToolUse, PostToolUse, Stop, Notification) that map perfectly to Discord notifications
- It supports permission control, budget limits, and abort controllers programmatically

**The tradeoff:** The Agent SDK requires an Anthropic API key (direct API billing) rather than using a Claude Pro/Max subscription through the CLI. For a single-user tool this is a cost consideration but not a blocker -- API pricing is transparent and the SDK is vastly cleaner than process management.

**If CLI spawning is required** (e.g., to use a Claude subscription instead of API key): Fall back to `node-pty` for PTY management. This is documented in the "Alternatives Considered" section below.

**Confidence:** HIGH -- verified directly from official Anthropic documentation at https://platform.claude.com/docs/en/agent-sdk/overview and https://platform.claude.com/docs/en/agent-sdk/typescript

## Existing Projects in This Space

Several open-source projects already bridge Claude Code to Discord. Their stack choices inform our recommendations:

| Project | Stack | CLI Integration | Notes |
|---------|-------|----------------|-------|
| [claude-discord-bridge](https://github.com/thcapp/claude-discord-bridge) (thcapp) | TypeScript, discord.js v14, SQLite | PTY with tmux fallback | 50+ slash commands, session persistence |
| [discord-agent-bridge](https://github.com/DoBuDevel/discord-agent-bridge) (DoBuDevel) | TypeScript, discord.js, tmux | Polling tmux panes every 30s | Supports multiple AI agents |
| [claude-code-discord](https://github.com/zebbern/claude-code-discord) | TypeScript (Deno), Discord API | child_process | Git/shell integration |
| [claude-code-discord-bot](https://github.com/timoconnellaus/claude-code-discord-bot) | TypeScript, discord.js | CLI spawning | Channel-to-folder mapping |

**Key takeaway:** Every existing project uses CLI spawning because the Agent SDK is relatively new (renamed from "Claude Code SDK" in late 2025). The SDK approach is strictly better for new projects.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22.x LTS (>=22.12.0) | Runtime | Required by discord.js 14.25.x. Supports native TypeScript stripping. Active LTS with long support window. Node 24 is current LTS but 22 is the safer bet for native module compatibility. |
| TypeScript | 5.9.x | Type safety | Latest stable. Do not use 6.0 beta. Provides excellent discord.js and Agent SDK type support. |
| discord.js | 14.25.x | Discord API client | The standard Discord library for Node.js. Mature, typed, actively maintained. Handles WebSocket connections, rate limiting, slash command builders, message components (buttons, selects), collectors. |
| @anthropic-ai/claude-agent-sdk | 0.2.x | Claude Code interface | Official TypeScript SDK providing the same capabilities as Claude Code CLI but programmatically. Async generator streaming, session management, hooks, permissions, MCP support. Eliminates PTY layer entirely. |
| zod | 3.x (>=3.24.1) | Schema validation | Peer dependency of the Agent SDK. Use `zod@^3.25` to get both v3 API (for SDK compatibility) and optional v4 subpath access. Do NOT install zod@4 as the root -- the Agent SDK requires `^3.24.1`. |

**Confidence:** HIGH for all. discord.js 14.25.1 verified via official docs. Agent SDK verified via official Anthropic documentation. Node.js 22 LTS confirmed as active LTS.

### Persistence

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| better-sqlite3 | 12.x | Session/state persistence | Synchronous API is simpler for a single-user bot. No server process needed. File-based -- trivial backup. Used by claude-discord-bridge (thcapp) for exactly this use case. 3300+ dependents on npm. |

**Confidence:** HIGH -- verified version 12.6.2 on npm, actively maintained.

**Why not a JSON file?** Session data, message logs, and command history benefit from queryable storage. SQLite provides this with zero infrastructure overhead.

**Why not PostgreSQL/Redis?** Massive overkill for a single-user, single-machine bot. Adds deployment complexity with zero benefit.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| strip-ansi | 7.x | Remove ANSI escape codes | Only needed if falling back to CLI spawning. The Agent SDK returns clean structured data. |
| pino | 10.x | Structured logging | JSON logging with minimal overhead. Use pino-pretty in dev for readability. Essential for debugging async Discord + Agent SDK interactions. |
| dotenv | 16.x | Environment variables | Load Discord bot token, Anthropic API key, and config from .env files. Node 22 has native `--env-file` but dotenv is more portable and well-understood. |

**Confidence:** HIGH for pino (verified 10.1.0). MEDIUM for strip-ansi (7.1.2 verified, but may not be needed with Agent SDK). HIGH for dotenv.

### Development Tools

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| tsx | 4.x | TypeScript runner for dev | Zero-config TypeScript execution via esbuild. Use for `npm run dev` with watch mode (`tsx watch`). Faster than ts-node, simpler than native Node.js type stripping for development. |
| vitest | 4.x | Testing framework | Native TypeScript/ESM support. 10-20x faster than Jest. No config needed for TypeScript. |
| eslint | 10.x | Linting | v10 uses flat config exclusively. Pair with typescript-eslint ^8.25. |
| typescript-eslint | 8.x | TypeScript lint rules | Flat config integration with ESLint 10. |
| prettier | 3.x | Code formatting | Standard formatting. Configure in eslint.config.mjs via eslint-plugin-prettier or run standalone. |
| @types/better-sqlite3 | latest | SQLite type definitions | Type support for better-sqlite3 since it ships without its own. |

**Confidence:** HIGH for tsx (4.21.0 verified), vitest (4.0.18 verified), eslint (10.0.0 verified).

## Installation

```bash
# Core dependencies
npm install discord.js@^14.25.0 @anthropic-ai/claude-agent-sdk@^0.2.0 zod@^3.25.0 better-sqlite3@^12.6.0 pino@^10.1.0 dotenv@^16.4.0

# Dev dependencies
npm install -D typescript@^5.9.0 tsx@^4.21.0 vitest@^4.0.0 eslint@^10.0.0 typescript-eslint@^8.25.0 prettier@^3.4.0 @types/better-sqlite3@latest @types/node@^22.0.0 pino-pretty@^13.0.0
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| @anthropic-ai/claude-agent-sdk | node-pty + CLI spawning | If you MUST use a Claude subscription (not API key) for billing. Requires Xcode on macOS for native compilation. Adds ANSI parsing complexity. Use node-pty@1.1.0. |
| @anthropic-ai/claude-agent-sdk | `claude -p` via child_process.exec | For simple one-shot queries only. No streaming, no session management. Works for slash commands that need a single response. Could be a simpler fallback for specific commands. |
| discord.js | discordx (decorator-based) | If you prefer decorator/class-based patterns. Adds a layer of abstraction. discord.js is more widely used and better documented. |
| discord.js | Eris | If you need lower-level control or lower memory usage. Much smaller community. Missing built-in slash command builders. Not worth it for this project. |
| better-sqlite3 | Drizzle ORM + SQLite | If the schema becomes complex (10+ tables). For a simple bot with 2-4 tables, raw better-sqlite3 queries are clearer and faster to develop. |
| pino | winston | If you need more transport flexibility out of the box. Pino is faster and its worker-thread transport model is cleaner. |
| tsx | Node.js --experimental-strip-types | When Node.js 22.18+ is stable and you want zero external deps. Currently still "experimental" for transform-types. tsx is battle-tested and supports all TS features. |
| vitest | jest | Only if the team already knows Jest well. Vitest is faster, simpler, and has better TypeScript support. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| node-pty (as primary approach) | Native module requiring Xcode, Python setuptools, node-gyp. Produces raw terminal bytes requiring ANSI parsing. Complex error handling for PTY lifecycle. The Agent SDK eliminates all of this. | @anthropic-ai/claude-agent-sdk |
| tmux-based polling | Polling tmux panes every 30s is crude -- you miss output, have latency, and add a system dependency. discord-agent-bridge uses this and it is the weakest part of their architecture. | Agent SDK streaming (real-time async generator) |
| @anthropic-ai/claude-code (old package name) | Renamed to @anthropic-ai/claude-agent-sdk. The old name may still exist on npm but is the legacy package. | @anthropic-ai/claude-agent-sdk |
| Deno runtime | While zebbern/claude-code-discord uses Deno, the discord.js ecosystem and Agent SDK are Node.js-first. Using Deno adds friction with native modules and npm compatibility. | Node.js 22 LTS |
| ts-node | Slow startup, complex configuration, frequent ESM issues. tsx is a drop-in replacement that just works. | tsx |
| Jest | Slower than vitest, requires configuration for TypeScript, ESM support is still experimental. | vitest |
| eslintrc config format | Removed in ESLint 10. Only flat config is supported. | eslint.config.mjs (flat config) |

## Stack Patterns by Variant

**If using Agent SDK (recommended):**
- Use `query()` async generator for streaming Claude responses to Discord
- Use `includePartialMessages: true` for real-time text streaming
- Use hooks (PreToolUse, PostToolUse, Notification) for Discord status updates
- Use `resume` with session IDs for conversation continuity across Discord messages
- Use `canUseTool` callback to surface permission requests as Discord button prompts
- Use `abortController` to implement cancel/stop buttons in Discord

**If falling back to CLI spawning:**
- Use node-pty@1.1.0 for full PTY emulation (required for interactive prompts)
- Use strip-ansi@7.x to clean terminal output before sending to Discord
- Implement your own session tracking (no built-in session resume)
- Parse `claude -p --output-format stream-json` for structured streaming
- Handle SIGTERM/SIGKILL for process cleanup on bot shutdown

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| discord.js@14.25.x | Node.js >=22.12.0 | Official docs state 22.12.0 minimum. npm package page says 18+ but official docs are authoritative. |
| @anthropic-ai/claude-agent-sdk@0.2.x | Node.js >=18, zod >=3.24.1 | Verified from npm package metadata. |
| better-sqlite3@12.x | Node.js >=14.21.1 | Prebuilt binaries for LTS versions. May need node-gyp rebuild on Apple Silicon if prebuilt unavailable. |
| eslint@10.x | Node.js >=22.13.0 (for TS config) | Can load TypeScript config files natively on Node 22.13+. Otherwise needs jiti >= 2.2.0. |
| tsx@4.x | Node.js >=18 | Uses esbuild under the hood. |
| vitest@4.x | Node.js >=18 | Uses Vite/Rollup for module resolution. |

## Node.js Version Note

Node.js 22 is the sweet spot:
- Required by discord.js (>=22.12.0)
- Active LTS status (maintained through 2027)
- Native TypeScript type stripping (--experimental-strip-types) for production if needed
- better-sqlite3 prebuilt binaries available
- Node.js 24 is current LTS but newer -- 22 has better ecosystem compatibility as of Feb 2026

## TypeScript Configuration

```jsonc
// tsconfig.json - recommended settings
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Use `"module": "Node16"` (not `"ESNext"`) because discord.js and the Agent SDK ship as CJS with ESM wrappers, and Node16 resolution handles this correctly.

## Sources

- [discord.js official docs (v14.25.1)](https://discord.js.org/docs) -- Version, Node.js requirement, API reference (HIGH confidence)
- [discord.js guide](https://discordjs.guide/) -- Slash commands, collectors, components patterns (HIGH confidence)
- [Claude Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview) -- Capabilities, installation, comparison to CLI (HIGH confidence)
- [Claude Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- Full API, types, options (HIGH confidence)
- [Claude Agent SDK streaming](https://platform.claude.com/docs/en/agent-sdk/streaming-output) -- Stream events, partial messages, UI patterns (HIGH confidence)
- [Claude Code headless mode](https://code.claude.com/docs/en/headless) -- CLI `-p` flag, output formats, streaming (HIGH confidence)
- [@anthropic-ai/claude-agent-sdk on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) -- Version 0.2.39, peer deps (HIGH confidence)
- [node-pty on GitHub](https://github.com/microsoft/node-pty) -- v1.1.0, platform support, build deps (HIGH confidence)
- [better-sqlite3 on npm](https://www.npmjs.com/package/better-sqlite3) -- v12.6.2 (HIGH confidence)
- [pino on npm](https://www.npmjs.com/package/pino) -- v10.1.0 (HIGH confidence)
- [tsx on npm](https://www.npmjs.com/package/tsx) -- v4.21.0 (HIGH confidence)
- [vitest on npm](https://www.npmjs.com/package/vitest) -- v4.0.18 (HIGH confidence)
- [ESLint v10 release](https://eslint.org/blog/2026/02/eslint-v10.0.0-released/) -- Flat config only (HIGH confidence)
- [Zod v4 versioning](https://zod.dev/v4/versioning) -- v3/v4 coexistence, subpath imports (HIGH confidence)
- [Node.js releases](https://nodejs.org/en/about/previous-releases) -- LTS schedule, v22/v24 status (HIGH confidence)
- [TypeScript releases](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html) -- v5.9 stable, v6.0 beta (HIGH confidence)
- [claude-discord-bridge (thcapp)](https://github.com/thcapp/claude-discord-bridge) -- Existing project reference (MEDIUM confidence)
- [discord-agent-bridge (DoBuDevel)](https://github.com/DoBuDevel/discord-agent-bridge) -- Existing project reference (MEDIUM confidence)

---
*Stack research for: Discord-to-CLI proxy bot (Claude Code bridge)*
*Researched: 2026-02-12*
