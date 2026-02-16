# Phase 1: Bot + Claude Connection - Research

**Researched:** 2026-02-12
**Domain:** Discord bot with Claude Code CLI subprocess integration (stream-json parsing)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Core Architecture: CLI Spawning (NOT Agent SDK)
- **Use the `claude` CLI directly** -- spawn it as a subprocess, not the Agent SDK
- User wants to leverage their existing Claude subscription (Pro/Max), not pay separately via API key
- Use `claude -p --output-format stream-json` for structured JSON streaming output
- The bot is a proxy to the terminal, not a separate SDK integration
- Claude Code auth and settings "just work" -- no API key configuration needed
- This is a **reversal of the research recommendation** -- research suggested Agent SDK, user chose CLI for subscription billing and terminal-native feel

#### Discord Interaction Model
- **Dedicated channel** -- bot listens in one specific Discord channel
- Everything typed in that channel goes to Claude
- **Always respond** -- any message in the channel triggers Claude, auto-starts a session if none exists
- **Continuous conversation** -- follow-up messages continue the same Claude session, like typing in a terminal
- Slash commands only work in the dedicated channel
- Working directory is fixed at startup (wherever you ran `gsdproxy` from)

#### Response Presentation
- **Typing indicator + status message** -- show Discord's "Bot is typing..." while processing, plus a status message like "Working on it..." for longer waits
- **Show basic tool activity in Phase 1** -- when Claude reads a file or runs a command, show what it's doing (e.g., "Reading file.ts...") even in this first phase
- Long output and formatting approach: Claude's discretion on message format (plain markdown, embeds, etc.) and splitting strategy

#### Bot Startup & Config
- **Custom CLI command**: `gsdproxy` -- run from the terminal to start the bot
- **Working directory**: wherever you run `gsdproxy` -- same as running `claude` directly
- **Auth**: Claude Code auth inherited from the shell (existing subscription). No ANTHROPIC_API_KEY needed.
- **Discord bot token**: stored in `.env` file in the project
- **Dedicated channel ID**: configured in `.env` or passed as argument

#### Slash Command Design
- Phase 1 command set: Claude's discretion (at minimum /status and /stop)
- `/stop` behavior: **abort immediately** -- kill the claude process, post "stopped" message
- Commands restricted to the dedicated channel only
- No /cd or working directory changes -- fixed at startup

### Claude's Discretion
- Response formatting approach (plain messages, embeds, or hybrid)
- Long message splitting strategy (multiple messages, truncation, file attachment)
- Exact Phase 1 slash command set (beyond /status and /stop)
- Handling of concurrent messages (queue, reject, or interrupt)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

## Summary

This phase builds a Discord bot that spawns `claude -p --output-format stream-json` as a child process and bridges bidirectional communication between a dedicated Discord channel and Claude Code. The user explicitly chose CLI spawning over the Agent SDK to leverage their existing Claude Pro/Max subscription billing, making this a subprocess management problem rather than an SDK integration.

The core technical challenge is parsing the NDJSON (newline-delimited JSON) stream from the Claude CLI's `stream-json` output format, which emits the same typed message events as the Agent SDK (system init, assistant messages, stream events with text deltas and tool use, result messages). Each line is a self-contained JSON object that maps directly to the SDK's `SDKMessage` union type. The bot must parse these events in real-time, extract text content and tool activity, and format them for Discord while respecting the 2000-character message limit.

Session continuity is achieved through `claude -c -p` (continue most recent conversation) or `claude -r <session-id> -p` (resume specific session). The session ID appears in the first `system/init` message of the stream. For Phase 1, the bot maintains a single active session and uses `--continue` for follow-up messages, giving the "continuous terminal conversation" feel the user wants.

**Primary recommendation:** Use `child_process.spawn()` with `claude -p --output-format stream-json --verbose --include-partial-messages` and parse stdout line-by-line as NDJSON. Use `--allowedTools` to auto-approve read-only tools. Use `--continue` for follow-up messages. Kill the child process on `/stop`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| discord.js | 14.25.x | Discord bot framework | Standard Node.js Discord library. Handles WebSocket, rate limiting, slash commands, typing indicators. Requires Node.js >=22.12.0. |
| Node.js | 22.x LTS | Runtime | Required by discord.js 14.25.x. Active LTS through 2027. Native TypeScript type stripping available. |
| TypeScript | 5.9.x | Type safety | Latest stable. Excellent discord.js type support. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| dotenv | 16.x | Environment variables | Load DISCORD_TOKEN and CHANNEL_ID from `.env` file. |
| pino | 10.x | Structured logging | JSON logging for debugging async subprocess + Discord interactions. Use pino-pretty in dev. |

### Development Tools
| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| tsx | 4.x | TypeScript runner | Zero-config TS execution. Use for `npm run dev` with watch mode (`tsx watch`). |
| vitest | 4.x | Testing | Native TypeScript/ESM support. Fast. |

### Not Needed in Phase 1
| Library | Why Not |
|---------|---------|
| @anthropic-ai/claude-agent-sdk | User chose CLI spawning. No API key needed. |
| node-pty | Not needed. `child_process.spawn()` is sufficient since we use `stream-json` structured output, not raw terminal emulation. |
| strip-ansi | Not needed. `stream-json` output is clean JSON, no ANSI codes. |
| better-sqlite3 | Session persistence is Phase 3. In-memory session tracking is sufficient for Phase 1. |
| zod | No Agent SDK dependency. Validate config with simple checks. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| child_process.spawn | child_process.exec | exec buffers all output. spawn streams stdout. We MUST stream. Use spawn. |
| child_process.spawn | node-pty | node-pty gives full PTY emulation (needed for interactive mode). We use `-p` mode which outputs to stdout, so spawn is sufficient and avoids native compilation. |
| readline for NDJSON | manual buffer splitting | readline handles partial lines and backpressure correctly. Manual splitting has edge cases with partial JSON lines. Use readline. |

**Installation:**
```bash
# Core dependencies
npm install discord.js@^14.25.0 dotenv@^16.4.0 pino@^10.1.0

# Dev dependencies
npm install -D typescript@^5.9.0 tsx@^4.21.0 vitest@^4.0.0 @types/node@^22.0.0 pino-pretty@^13.0.0
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  discord/
    client.ts          # Discord.js client setup, login, event wiring
    commands/
      index.ts         # Command registry and registration
      status.ts        # /status - show current session info
      stop.ts          # /stop - kill active claude process
    handlers/
      message.ts       # messageCreate handler - forward to Claude
      interaction.ts   # interactionCreate handler - slash commands
    formatter.ts       # Format Claude output for Discord (splitting, code blocks)
  claude/
    process.ts         # Spawn and manage claude CLI subprocess
    parser.ts          # Parse NDJSON stream-json output into typed events
    types.ts           # TypeScript types for stream-json message events
  bridge/
    router.ts          # Routes Discord messages to Claude process, manages session state
  config.ts            # Load and validate environment configuration
  index.ts             # Entry point - wire everything together
```

### Pattern 1: NDJSON Stream Parser
**What:** Parse the `claude -p --output-format stream-json` stdout as newline-delimited JSON. Each line is a self-contained JSON object representing one event from the Claude Code engine.
**When to use:** Always -- this is the core data flow.

**Example:**
```typescript
// Source: Claude Code CLI docs + Claude API streaming docs
import { spawn, ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

interface ClaudeStreamEvent {
  type: "system" | "assistant" | "user" | "result" | "stream_event";
  // Additional fields vary by type
  [key: string]: unknown;
}

function spawnClaude(prompt: string, options: {
  cwd: string;
  continueSession?: boolean;
  resumeSessionId?: string;
}): ChildProcess {
  const args = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--allowedTools", "Read", "Glob", "Grep",  // auto-approve read-only
  ];

  if (options.continueSession) {
    args.unshift("--continue");
  } else if (options.resumeSessionId) {
    args.unshift("--resume", options.resumeSessionId);
  }

  return spawn("claude", args, {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,  // Inherit Claude Code auth from shell
  });
}

async function* parseStream(
  proc: ChildProcess
): AsyncGenerator<ClaudeStreamEvent> {
  const rl = createInterface({
    input: proc.stdout!,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as ClaudeStreamEvent;
    } catch {
      // Log but don't crash on malformed lines
      console.warn("Failed to parse stream line:", line);
    }
  }
}
```

### Pattern 2: Session Continuity via --continue
**What:** After the first message creates a session, follow-up messages use `claude -c -p "follow-up"` to continue the most recent conversation in the working directory. The session ID from the init message can also be used with `--resume`.
**When to use:** Every follow-up message in the same channel.

**Example:**
```typescript
// First message: starts a new session
// claude -p "explain this project" --output-format stream-json ...

// Second message: continues the session
// claude -c -p "now fix the bug" --output-format stream-json ...

// Or resume a specific session:
// claude -r <session-id> -p "continue" --output-format stream-json ...

class SessionManager {
  private activeProcess: ChildProcess | null = null;
  private sessionId: string | null = null;
  private isProcessing = false;
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async sendMessage(prompt: string): Promise<AsyncGenerator<ClaudeStreamEvent>> {
    if (this.isProcessing) {
      throw new Error("Already processing a message");
    }

    this.isProcessing = true;

    const proc = spawnClaude(prompt, {
      cwd: this.cwd,
      continueSession: this.sessionId !== null,
    });

    this.activeProcess = proc;

    proc.on("exit", () => {
      this.activeProcess = null;
      this.isProcessing = false;
    });

    return parseStream(proc);
  }

  abort(): void {
    if (this.activeProcess) {
      this.activeProcess.kill("SIGTERM");
      this.activeProcess = null;
      this.isProcessing = false;
    }
  }
}
```

### Pattern 3: Typing Indicator Loop
**What:** Discord's typing indicator lasts only 10 seconds. For long-running Claude operations, call `channel.sendTyping()` on an interval to keep the indicator active.
**When to use:** Whenever Claude is processing (between receiving a message and posting the final response).

**Example:**
```typescript
// Source: discord.js docs + community patterns
function startTypingLoop(channel: TextChannel): () => void {
  channel.sendTyping(); // Start immediately
  const interval = setInterval(() => {
    channel.sendTyping().catch(() => {}); // Ignore errors
  }, 9000); // Refresh before 10s expiry

  return () => clearInterval(interval); // Return cleanup function
}

// Usage:
const stopTyping = startTypingLoop(channel);
try {
  // ... process Claude response ...
} finally {
  stopTyping();
}
```

### Pattern 4: Message Splitting at Natural Boundaries
**What:** Discord's message limit is 2000 characters. When Claude's response exceeds this, split at paragraph or code block boundaries, never mid-word or mid-code-fence.
**When to use:** Every response that might exceed 2000 characters.

**Example:**
```typescript
function splitMessage(content: string, maxLength = 1900): string[] {
  if (content.length <= maxLength) return [content];

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at paragraph boundary
    let splitIndex = remaining.lastIndexOf("\n\n", maxLength);

    // Fall back to line boundary
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf("\n", maxLength);
    }

    // Fall back to space
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }

    // Last resort: hard split
    if (splitIndex === -1) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}
```

### Pattern 5: Stream Event Dispatch
**What:** The stream-json output emits different message types. A dispatcher routes each type to the appropriate handler for Discord rendering.
**When to use:** In the main event loop consuming the stream.

**Example:**
```typescript
// Source: Agent SDK TypeScript reference (message types match CLI stream-json output)

// The CLI stream-json format emits these top-level message types:
// - type: "system", subtype: "init"  -> Session started, contains session_id
// - type: "assistant"                -> Complete assistant message with content blocks
// - type: "stream_event"            -> Partial streaming events (text deltas, tool use)
// - type: "result"                  -> Session complete, contains cost/usage

async function handleStream(
  events: AsyncGenerator<ClaudeStreamEvent>,
  channel: TextChannel
) {
  let currentText = "";
  let currentTool: string | null = null;

  for await (const event of events) {
    switch (event.type) {
      case "system": {
        if (event.subtype === "init") {
          // Capture session_id for future --resume
          const sessionId = event.session_id as string;
          // Store sessionId for continuity
        }
        break;
      }

      case "stream_event": {
        const streamEvent = event.event as Record<string, unknown>;

        if (streamEvent.type === "content_block_start") {
          const block = streamEvent.content_block as Record<string, unknown>;
          if (block.type === "tool_use") {
            currentTool = block.name as string;
            // Show tool activity: "Reading file.ts..."
            await channel.send(`*Using ${currentTool}...*`);
          }
        }

        if (streamEvent.type === "content_block_delta") {
          const delta = streamEvent.delta as Record<string, unknown>;
          if (delta.type === "text_delta") {
            currentText += delta.text as string;
          }
        }

        if (streamEvent.type === "content_block_stop") {
          if (currentTool) {
            currentTool = null;
          }
        }
        break;
      }

      case "result": {
        // Post final accumulated text
        if (currentText) {
          const chunks = splitMessage(currentText);
          for (const chunk of chunks) {
            await channel.send(chunk);
          }
        }

        // Show completion info
        const cost = event.total_cost_usd as number;
        const turns = event.num_turns as number;
        if (cost !== undefined) {
          await channel.send(`*Completed in ${turns} turns ($${cost.toFixed(4)})*`);
        }
        break;
      }
    }
  }
}
```

### Anti-Patterns to Avoid

- **Spawning a new `claude` process for every message without --continue:** Loses all conversation context. Every message becomes a fresh session with no memory of previous interactions. Always use `--continue` or `--resume` for follow-up messages.

- **Using `child_process.exec()` instead of `spawn()`:** exec buffers ALL output into memory before returning. With streaming output, this defeats the purpose and can OOM on large responses. Always use spawn for streaming.

- **Parsing stdout as a whole string after process exits:** Misses real-time events. The value of stream-json is that you see text deltas and tool use AS THEY HAPPEN. Always parse line-by-line as the process runs.

- **Not killing the child process on /stop:** If you only track state but leave the process running, it continues consuming API calls and the user's subscription quota. Always `process.kill("SIGTERM")` on abort.

- **Sending a Discord message for every stream_event:** With `--include-partial-messages`, events arrive many times per second. Discord rate limits message sends. Accumulate text and post periodically or on completion.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NDJSON line parsing | Custom buffer + split("\n") | `readline.createInterface()` on stdout | readline handles partial lines, backpressure, and cleanup correctly. Manual splitting fails on partial JSON lines at buffer boundaries. |
| Discord rate limiting | Custom rate limiter | discord.js built-in rate limit handling | discord.js already queues and retries on 429s. Don't bypass with raw REST calls. |
| Process signal handling | Custom signal routing | Node.js `child_process` kill() + exit events | spawn provides kill(), exit/close/error events. Don't reinvent process lifecycle management. |
| Environment loading | Custom .env parser | dotenv | dotenv handles edge cases (quotes, multiline, comments) that simple parsers miss. |
| Typing indicator timing | Custom debounce | setInterval + sendTyping | Discord's typing indicator lasts 10s. A simple interval at 9s is the standard pattern. |

**Key insight:** The CLI + stream-json approach means we are parsing NDJSON output, not building an SDK integration. The complexity is in stream parsing and process lifecycle, not in API client design. Node.js has excellent built-in tools for both.

## Common Pitfalls

### Pitfall 1: Not Handling Partial JSON Lines at Buffer Boundaries
**What goes wrong:** `stdout` emits data in chunks that may split a JSON line across two chunks. If you split on "\n" manually, you get incomplete JSON that fails to parse.
**Why it happens:** Node.js streams emit data based on OS buffer sizes, not line boundaries.
**How to avoid:** Use `readline.createInterface({ input: proc.stdout })` which handles line buffering internally. The `for await (const line of rl)` pattern yields complete lines.
**Warning signs:** Sporadic JSON parse errors in logs. Events randomly missing.

### Pitfall 2: Discord's 3-Second Interaction Timeout for Slash Commands
**What goes wrong:** Discord requires acknowledgement within 3 seconds of receiving a slash command. Claude operations take seconds to minutes. Without immediate deferral, the user sees "The application did not respond."
**Why it happens:** Developers test with fast operations, then real tasks exceed 3 seconds.
**How to avoid:** Call `interaction.deferReply()` immediately in every slash command handler before any async work. Use `interaction.editReply()` or `interaction.followUp()` for the actual response.
**Warning signs:** "The application did not respond" in Discord. Commands work locally but fail in production.

### Pitfall 3: Orphaned Claude Processes After Bot Shutdown
**What goes wrong:** If the bot process exits (crash, SIGTERM, Ctrl+C) without killing active Claude child processes, those processes continue running, consuming API calls and the user's subscription quota.
**Why it happens:** Child processes are independent OS processes. They don't die when the parent dies unless explicitly killed.
**How to avoid:** Register `process.on("exit")`, `process.on("SIGINT")`, and `process.on("SIGTERM")` handlers that kill any active Claude child process. Also handle `proc.on("error")` for spawn failures.
**Warning signs:** Running `ps aux | grep claude` after bot exit shows orphaned processes. Unexpected subscription usage.

### Pitfall 4: Concurrent Message Race Conditions
**What goes wrong:** User sends a second message while Claude is still processing the first. Two Claude processes spawn simultaneously. The `--continue` flag on the second one may conflict with the first's active session. Results arrive interleaved.
**Why it happens:** Discord messages arrive asynchronously. Without a lock/queue, each message handler runs independently.
**How to avoid:** Track `isProcessing` state. When a new message arrives during processing, either queue it (recommended) or reject it with a "still working on your previous request" message. Never spawn two concurrent Claude processes.
**Warning signs:** Interleaved or garbled responses. "Session in use" errors from Claude CLI. Duplicate responses to a single prompt.

### Pitfall 5: Not Using --verbose with --include-partial-messages
**What goes wrong:** Without `--verbose`, the stream-json output does not include tool use events. You only see the final assistant message, not what tools Claude is using. The user requirement to "show basic tool activity in Phase 1" cannot be met.
**Why it happens:** The default output is minimal. `--verbose` enables full turn-by-turn output. `--include-partial-messages` enables streaming text deltas.
**How to avoid:** Always include both flags: `claude -p --output-format stream-json --verbose --include-partial-messages "prompt"`.
**Warning signs:** No tool activity visible. Only seeing final responses, no streaming.

### Pitfall 6: Permission Prompts Blocking in -p Mode
**What goes wrong:** In `-p` (print/non-interactive) mode, if Claude needs permission for a tool that is not pre-approved via `--allowedTools`, the behavior depends on the permission configuration. Without `--dangerouslySkipPermissions` or a `--permission-prompt-tool`, tools that need approval may be auto-denied, causing Claude to fail or work around the restriction inefficiently.
**Why it happens:** Headless mode has no interactive terminal for the user to approve permissions. The permission system still applies.
**How to avoid:** Use `--allowedTools` to pre-approve the tools Claude will need. For Phase 1, auto-approve read-only tools: `--allowedTools "Read" "Glob" "Grep" "Bash(git log *)" "Bash(git diff *)" "Bash(git status *)"`. For write operations, rely on the user's existing Claude Code permission settings or explore `--permission-prompt-tool` (an MCP tool that handles approval via a custom protocol -- complex, likely Phase 2+).
**Warning signs:** Claude repeatedly says it can't perform actions. Tool calls being silently denied. Claude using workarounds instead of direct tool calls.

## Code Examples

### Complete Bot Startup
```typescript
// Source: discord.js docs + Claude Code CLI reference
import { Client, GatewayIntentBits, Events, TextChannel } from "discord.js";
import { config } from "dotenv";

config(); // Load .env

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID!;
const CWD = process.cwd(); // Fixed at startup

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  console.log(`Listening in channel: ${CHANNEL_ID}`);
  console.log(`Working directory: ${CWD}`);
});

client.on(Events.MessageCreate, async (message) => {
  // Ignore bots and messages outside dedicated channel
  if (message.author.bot) return;
  if (message.channel.id !== CHANNEL_ID) return;

  // Forward to Claude session manager...
});

client.login(process.env.DISCORD_TOKEN);
```

### Slash Command Registration
```typescript
// Source: discord.js guide
import { SlashCommandBuilder, REST, Routes } from "discord.js";

const commands = [
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show current Claude session status"),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop the active Claude session immediately"),
].map((cmd) => cmd.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

// Register commands (call once on startup or via deploy script)
await rest.put(
  Routes.applicationGuildCommands(
    process.env.DISCORD_APP_ID!,
    process.env.DISCORD_GUILD_ID!
  ),
  { body: commands }
);
```

### Full Claude CLI Invocation for Phase 1
```bash
# First message in a session:
claude -p "explain this project" \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --allowedTools "Read" "Glob" "Grep"

# Follow-up message (continue most recent conversation):
claude -c -p "now fix the bug in auth.ts" \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --allowedTools "Read" "Glob" "Grep"

# Abort: kill the child process with SIGTERM
```

### Package.json bin Entry for `gsdproxy` Command
```json
{
  "name": "gsdproxy",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "gsdproxy": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

The user runs `npm link` (or `npm install -g .`) to get the `gsdproxy` command available globally.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Spawn claude in PTY, parse ANSI output | Use `claude -p --output-format stream-json` | 2025 (headless mode) | Eliminates ALL terminal parsing. Structured JSON events. |
| One-shot `claude -p` per message | `claude -c -p` for conversation continuity | 2025 (session management) | Follow-up messages keep full context without re-reading files. |
| No streaming in headless mode | `--include-partial-messages` flag | 2025 | Real-time text deltas and tool activity in stream-json output. |
| Agent SDK required API key | CLI uses existing subscription | N/A (always been the case) | CLI spawning works with Pro/Max subscription. SDK requires separate API billing. |

**Key evolution:** The Claude Code CLI's `stream-json` output format provides the same typed events as the Agent SDK (SDKMessage types), making CLI spawning a viable architecture for structured integration. This was not possible when the CLI only had text output.

## Stream-JSON Message Types Reference

The CLI `stream-json` output emits these message types as NDJSON (one JSON object per line). These map directly to the Agent SDK's `SDKMessage` union type:

### System Init Message
```json
{
  "type": "system",
  "subtype": "init",
  "uuid": "...",
  "session_id": "abc-123-def",
  "cwd": "/path/to/project",
  "tools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  "model": "claude-sonnet-4-5-20250929",
  "permissionMode": "default"
}
```

### Stream Event (Text Delta)
```json
{
  "type": "stream_event",
  "uuid": "...",
  "session_id": "abc-123-def",
  "event": {
    "type": "content_block_delta",
    "index": 0,
    "delta": { "type": "text_delta", "text": "Hello" }
  }
}
```

### Stream Event (Tool Use Start)
```json
{
  "type": "stream_event",
  "uuid": "...",
  "session_id": "abc-123-def",
  "event": {
    "type": "content_block_start",
    "index": 1,
    "content_block": { "type": "tool_use", "id": "toolu_...", "name": "Read", "input": {} }
  }
}
```

### Stream Event (Tool Input Delta)
```json
{
  "type": "stream_event",
  "uuid": "...",
  "session_id": "abc-123-def",
  "event": {
    "type": "content_block_delta",
    "index": 1,
    "delta": { "type": "input_json_delta", "partial_json": "{\"file_path\": \"/src/auth.ts\"}" }
  }
}
```

### Complete Assistant Message
```json
{
  "type": "assistant",
  "uuid": "...",
  "session_id": "abc-123-def",
  "message": {
    "role": "assistant",
    "content": [
      { "type": "text", "text": "Here is the explanation..." },
      { "type": "tool_use", "id": "toolu_...", "name": "Read", "input": { "file_path": "/src/auth.ts" } }
    ]
  }
}
```

### Result Message (Success)
```json
{
  "type": "result",
  "subtype": "success",
  "uuid": "...",
  "session_id": "abc-123-def",
  "duration_ms": 12345,
  "is_error": false,
  "num_turns": 3,
  "result": "Final text response...",
  "total_cost_usd": 0.0234,
  "usage": { "input_tokens": 1500, "output_tokens": 800 }
}
```

### Result Message (Error)
```json
{
  "type": "result",
  "subtype": "error_max_turns",
  "uuid": "...",
  "session_id": "abc-123-def",
  "is_error": true,
  "errors": ["Maximum turns (25) reached"]
}
```

## Discretion Recommendations

### Response Formatting: Hybrid Approach (RECOMMENDED)
Use plain Discord messages for regular text responses. Use code blocks (triple backticks) for code. Use italic text for status/tool activity messages. Avoid embeds in Phase 1 -- they add visual complexity for minimal benefit when the interaction model is "chat in a channel."

**Rationale:** The user wants a terminal-like feel. Plain messages with markdown formatting are closest to terminal output. Embeds feel more "bot-like" and less "terminal-like."

### Long Message Splitting: Multiple Messages (RECOMMENDED)
Split at paragraph boundaries (double newline), then single newline, then space. Send as multiple sequential messages. Do NOT truncate -- the user expects full output. File attachments are overkill for Phase 1.

**Rationale:** The user said "the bot should feel like you're using a terminal." Terminals show full output. Truncation loses information.

### Phase 1 Slash Commands: /status, /stop, /new (RECOMMENDED)
- `/status` -- Show if Claude is processing, session ID, working directory
- `/stop` -- Kill active Claude process immediately, post confirmation
- `/new` -- Force a new session (don't use --continue for the next message)

**Rationale:** /status and /stop are required. /new is useful when the user wants to start a fresh conversation without restarting the bot.

### Concurrent Message Handling: Queue with Notification (RECOMMENDED)
When a message arrives while Claude is processing, queue it and notify: "Still working on your previous request. Your message has been queued." Process the queued message after the current one completes.

**Rationale:** Rejecting feels hostile. Interrupting is complex and loses the current response. Queuing is the simplest correct behavior that maintains conversation flow.

## Open Questions

1. **Permission handling for write operations in Phase 1**
   - What we know: `--allowedTools` auto-approves specified tools. Read-only tools are safe to auto-approve. Write operations (Edit, Write, Bash) need permission in default mode.
   - What's unclear: In `-p` mode without `--dangerouslySkipPermissions`, what happens when Claude wants to write a file? Does it auto-deny? Does the process hang?
   - Recommendation: For Phase 1, auto-approve read-only tools via `--allowedTools`. For write operations, rely on the user's existing Claude Code permission settings (which may allow common patterns). If writes fail, the user can adjust their Claude Code permission settings directly. Full permission forwarding via `--permission-prompt-tool` is a Phase 2 concern.

2. **`--continue` behavior across rapid messages**
   - What we know: `claude -c -p "prompt"` continues the most recent conversation in the cwd.
   - What's unclear: If the first process hasn't fully exited and a second `claude -c -p` is invoked, does the second pick up the right session? Or does it race?
   - Recommendation: Enforce strict sequential processing. Wait for the current process to fully exit before spawning the next. This avoids any session file locking or race conditions.

3. **Max output size before Discord becomes unusable**
   - What we know: Discord messages are 2000 chars max. We split at natural boundaries.
   - What's unclear: For very large outputs (e.g., full file contents, large diffs), sending 20+ messages in rapid succession may flood the channel.
   - Recommendation: For Phase 1, cap at ~10 split messages. If output exceeds this, truncate with "... (output truncated, X chars total)". Revisit in Phase 2 with thread-based output.

## Sources

### Primary (HIGH confidence)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) -- All CLI flags including -p, --output-format, --continue, --resume, --allowedTools, --include-partial-messages, --verbose
- [Claude Code Headless Mode](https://code.claude.com/docs/en/headless) -- Programmatic usage with -p flag, stream-json examples, session management
- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- SDKMessage type definitions (stream-json output matches these types exactly)
- [Claude Agent SDK Streaming Output](https://platform.claude.com/docs/en/agent-sdk/streaming-output) -- StreamEvent format, content_block_start/delta/stop, tool_use events
- [Claude API Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming) -- Raw event types: message_start, content_block_delta (text_delta, input_json_delta), message_stop
- [Claude Agent SDK Sessions](https://platform.claude.com/docs/en/agent-sdk/sessions) -- Session ID capture from init message, resume, fork
- [Claude Code Permissions](https://code.claude.com/docs/en/permissions) -- Permission modes, allowedTools syntax, headless mode behavior
- [discord.js Guide](https://discordjs.guide/) -- Slash commands, message handling, components, typing indicators
- [Node.js child_process docs](https://nodejs.org/api/child_process.html) -- spawn(), stdio pipes, signal handling
- [Node.js readline docs](https://nodejs.org/api/readline.html) -- createInterface for line-by-line stream parsing

### Secondary (MEDIUM confidence)
- [discord.js sendTyping issue #10061](https://github.com/discordjs/discord.js/issues/10061) -- 10-second typing indicator limit, setInterval workaround
- [claude-flow Stream Chaining wiki](https://github.com/ruvnet/claude-flow/wiki/Stream-Chaining) -- Stream-JSON message type structure (init, message, tool_use, result)
- [claude-code-discord-bot (timoconnellaus)](https://github.com/timoconnellaus/claude-code-discord-bot) -- Reference architecture: CLI spawning with channel-per-folder mapping, permission reactions
- [Claude Code Permission Prompt Tool issue #1175](https://github.com/anthropics/claude-code/issues/1175) -- Lack of documentation for --permission-prompt-tool MCP integration

### Tertiary (LOW confidence)
- [ytyng.com stream-json extraction](https://www.ytyng.com/en/blog/claude-stream-json-jq/) -- Practical jq patterns for stream-json parsing (confirms format)
- Stream-JSON message interface from claude-flow wiki -- The exact JSON shape (init/message/tool_use/tool_result/result) needs validation against actual CLI output. The SDK TypeScript types are authoritative.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- discord.js and Node.js child_process are well-documented, mature technologies
- Architecture: HIGH -- CLI flags verified from official Claude Code docs. Stream-json format confirmed via SDK type definitions and official streaming docs.
- Pitfalls: HIGH -- Process management pitfalls are well-known in Node.js. Discord timing constraints documented in official Discord API docs.
- Stream-JSON format: MEDIUM-HIGH -- Types match SDK definitions. Exact CLI output shape should be validated by running `claude -p --output-format stream-json` locally during implementation.

**Research date:** 2026-02-12
**Valid until:** 30 days (stable technologies, Claude Code CLI format unlikely to change in minor versions)
