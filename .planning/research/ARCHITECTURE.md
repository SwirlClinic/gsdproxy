# Architecture Research

**Domain:** Discord-to-CLI proxy bot (PTY bridge to Claude Code)
**Researched:** 2026-02-12
**Confidence:** HIGH

## Critical Architecture Decision: Agent SDK vs PTY Spawning

The single most important architectural choice is **how** the bot communicates with Claude Code. Research uncovered two fundamentally different approaches, and a clear winner.

### Option A: PTY Spawning (node-pty)

Spawn Claude Code as an interactive terminal process, parse raw terminal output, and write keystrokes to stdin. This is what the `discord-agent-bridge` project does (via tmux capture-pane polling).

**Problems:**
- Must parse ANSI escape codes, cursor movements, and terminal control sequences
- Claude Code's interactive TUI (permission prompts, option selections) is designed for human eyes, not machines
- Fragile: any change to Claude Code's terminal rendering breaks the parser
- No structured data -- everything is raw text
- Permission prompts require simulating keystrokes (arrow keys, enter)

### Option B: Claude Agent SDK (RECOMMENDED)

Use `@anthropic-ai/claude-agent-sdk` -- the official TypeScript SDK that gives programmatic access to the same engine powering Claude Code. This was formerly called "Claude Code SDK" and provides:

- **Structured streaming messages** (typed `SDKMessage` union: assistant, user, result, system, stream_event)
- **`canUseTool` callback** that intercepts permission requests programmatically
- **`AskUserQuestion` tool** that surfaces clarifying questions as structured data with options
- **Session management** (resume, continue, fork)
- **All built-in tools** (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch)
- **Hooks** for lifecycle events (PreToolUse, PostToolUse, Stop, Notification, etc.)

**Why this wins decisively:** No terminal parsing. No ANSI stripping. No keystroke simulation. Structured JSON events with typed interfaces. Permission prompts become function calls you handle in code.

**Confidence: HIGH** -- Verified via official Anthropic documentation at platform.claude.com/docs/en/agent-sdk/overview and the full TypeScript API reference.

## Standard Architecture

### System Overview

```
+------------------------------------------------------------------+
|                       Discord Layer                               |
|  +------------------+  +------------------+  +-----------------+  |
|  | Command Handler  |  | Message Router   |  | Output Renderer |  |
|  | (slash commands, |  | (maps Discord    |  | (formats SDK    |  |
|  |  message input)  |  |  msgs to SDK)    |  |  output for     |  |
|  +--------+---------+  +--------+---------+  |  Discord)        |  |
|           |                     |             +--------+--------+  |
+-----------+---------------------+----------------------+----------+
            |                     |                      |
+-----------v---------------------v----------------------v----------+
|                     Session Manager                               |
|  +------------------+  +------------------+  +-----------------+  |
|  | Session Store    |  | Permission       |  | Output Buffer   |  |
|  | (active session, |  | Forwarder        |  | (batches edits, |  |
|  |  session ID,     |  | (canUseTool ->   |  |  chunks long    |  |
|  |  conversation)   |  |  Discord prompt) |  |  output)        |  |
|  +------------------+  +------------------+  +-----------------+  |
+-----------+---------------------+----------------------+----------+
            |                     |                      |
+-----------v---------------------v----------------------v----------+
|                   Claude Agent SDK                                |
|  +--------------------------------------------------------------+ |
|  | query({ prompt, options: { canUseTool, hooks, ... } })       | |
|  | Returns: AsyncGenerator<SDKMessage>                          | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Command Handler** | Receives Discord slash commands and messages, validates input, dispatches to Session Manager | discord.js `SlashCommandBuilder`, `messageCreate` listener |
| **Message Router** | Converts Discord user input into prompts for the Agent SDK, handles follow-up messages vs new sessions | Stateful mapper that tracks active session per channel |
| **Output Renderer** | Transforms structured `SDKMessage` events into Discord-friendly output (code blocks, embeds, thread messages) | Formatter that strips/converts content, respects 2000-char limit |
| **Session Manager** | Orchestrates the lifecycle of a single Claude Agent SDK `query()` call, owns the async generator | Core state machine: idle -> running -> awaiting-permission -> running -> complete |
| **Session Store** | Persists session IDs for resume/continue, tracks which Discord channel maps to which session | In-memory for single-user; could be SQLite for persistence |
| **Permission Forwarder** | Implements `canUseTool` callback -- when Claude needs permission, surfaces it as a Discord message with buttons, waits for user response, returns allow/deny to SDK | Discord buttons + `awaitMessageComponent` collector |
| **Output Buffer** | Debounces rapid SDK streaming events into batched Discord message edits to avoid rate limits | Timer-based flush (every 1-2 seconds), coalesces partial messages |

## Recommended Project Structure

```
src/
├── discord/                # Discord-specific code
│   ├── client.ts           # Discord.js client setup, login, event wiring
│   ├── commands/           # Slash command definitions
│   │   ├── index.ts        # Command registry
│   │   ├── prompt.ts       # /prompt - send a prompt to Claude
│   │   ├── session.ts      # /session - resume, list, stop
│   │   └── status.ts       # /status - current session info
│   ├── handlers/           # Event handlers
│   │   ├── message.ts      # messageCreate handler (for conversational input)
│   │   └── interaction.ts  # interactionCreate handler (slash commands, buttons)
│   └── renderer.ts         # Formats SDK output -> Discord messages
├── claude/                 # Claude Agent SDK wrapper
│   ├── session.ts          # Session manager (query lifecycle, state machine)
│   ├── permissions.ts      # canUseTool implementation (-> Discord buttons)
│   └── hooks.ts            # SDK hook callbacks (Notification, Stop, etc.)
├── bridge/                 # Glue between Discord and Claude layers
│   ├── router.ts           # Routes Discord input to Claude sessions
│   └── buffer.ts           # Output buffer with debounced Discord edits
├── types/                  # Shared TypeScript types
│   └── index.ts            # App-specific type definitions
├── config.ts               # Configuration (env vars, constants)
└── index.ts                # Entry point
```

### Structure Rationale

- **discord/** and **claude/** are kept separate so neither depends on the other directly. The bridge layer connects them. This means the Claude session logic can be tested without Discord, and Discord rendering can be tested without a live SDK session.
- **commands/** follows discord.js convention of one file per command for easy registration.
- **bridge/** is thin glue -- it should contain minimal logic, mostly wiring callbacks and routing.

## Architectural Patterns

### Pattern 1: Async Generator Consumer

**What:** The Agent SDK's `query()` returns an `AsyncGenerator<SDKMessage>`. The Session Manager consumes this generator in a `for await...of` loop, dispatching each message to the appropriate handler.

**When to use:** Always. This is the core consumption pattern for the SDK.

**Trade-offs:** Simple and readable. The loop naturally handles backpressure. However, you must handle the case where the generator is paused waiting for a `canUseTool` response -- the loop blocks until the permission callback resolves.

**Example:**

```typescript
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

async function runSession(prompt: string, onMessage: (msg: SDKMessage) => void) {
  const q = query({
    prompt,
    options: {
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      canUseTool: async (toolName, input) => {
        // This blocks the generator until the user responds
        return await forwardPermissionToDiscord(toolName, input);
      },
    },
  });

  for await (const message of q) {
    onMessage(message);

    if (message.type === "system" && message.subtype === "init") {
      // Capture session_id for later resume
      saveSessionId(message.session_id);
    }

    if (message.type === "result") {
      // Session complete -- message.subtype is "success" or error variant
      return message;
    }
  }
}
```

### Pattern 2: Permission Bridge via Discord Buttons

**What:** When Claude calls a tool that needs approval, the `canUseTool` callback creates a Discord message with action buttons (Allow / Deny), then returns a Promise that resolves when the user clicks a button.

**When to use:** Every time `canUseTool` fires for a non-AskUserQuestion tool.

**Trade-offs:** Clean UX. The user sees exactly what Claude wants to do and can approve/deny with one click. However, you need a timeout -- if the user never responds, the SDK hangs forever. Implement a reasonable timeout (e.g., 5 minutes) that auto-denies.

**Example:**

```typescript
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  type MessageComponentInteraction
} from "discord.js";

async function forwardPermissionToDiscord(
  toolName: string,
  input: Record<string, unknown>,
  channel: TextChannel
): Promise<{ behavior: "allow" | "deny"; updatedInput?: unknown; message?: string }> {
  // Format the permission request
  const description = toolName === "Bash"
    ? `\`${input.command}\``
    : `${toolName}: ${JSON.stringify(input).slice(0, 200)}`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("allow")
      .setLabel("Allow")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("deny")
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger),
  );

  const msg = await channel.send({
    content: `**Permission Request:** ${toolName}\n${description}`,
    components: [row],
  });

  try {
    const interaction = await msg.awaitMessageComponent({
      time: 300_000, // 5 minute timeout
    });

    await interaction.update({ components: [] }); // Remove buttons

    if (interaction.customId === "allow") {
      return { behavior: "allow", updatedInput: input };
    }
    return { behavior: "deny", message: "User denied this action" };
  } catch {
    // Timeout -- auto-deny
    await msg.edit({ content: `${msg.content}\n*(timed out -- denied)*`, components: [] });
    return { behavior: "deny", message: "Permission request timed out" };
  }
}
```

### Pattern 3: Debounced Output Streaming

**What:** The SDK emits many rapid `SDKMessage` events (especially with `includePartialMessages: true`). Rather than editing a Discord message on every event, buffer the output and flush to Discord on a timer.

**When to use:** Always for assistant text output. Discord's rate limit is ~5 edits per 5 seconds per message (varies). Flushing every 1-2 seconds avoids rate limits.

**Trade-offs:** Slight visual lag (1-2 seconds) but dramatically reduces API calls and avoids rate limit errors. Without this, rapid streaming will hit 429s.

**Example:**

```typescript
class OutputBuffer {
  private content = "";
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private discordMessage: Message | null = null;

  constructor(
    private channel: TextChannel,
    private flushInterval = 1500 // ms
  ) {}

  append(text: string) {
    this.content += text;
    this.dirty = true;
    if (!this.timer) {
      this.timer = setInterval(() => this.flush(), this.flushInterval);
    }
  }

  private async flush() {
    if (!this.dirty) return;
    this.dirty = false;

    // Truncate to Discord's 2000 char limit for the live message
    const display = this.content.length > 1900
      ? "..." + this.content.slice(-1900)
      : this.content;

    if (!this.discordMessage) {
      this.discordMessage = await this.channel.send(
        `\`\`\`\n${display}\n\`\`\``
      );
    } else {
      await this.discordMessage.edit(
        `\`\`\`\n${display}\n\`\`\``
      ).catch(() => {}); // Swallow rate limit errors gracefully
    }
  }

  async finalize() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}
```

### Pattern 4: Thread-Based Log Isolation

**What:** Keep the main channel clean with summary messages. Create a Discord thread for each Claude session and post detailed tool calls, outputs, and intermediate steps there.

**When to use:** When Claude sessions produce verbose output (which they almost always do).

**Trade-offs:** Slightly more complex message routing, but dramatically better UX. The user sees a clean summary in-channel and can drill into the thread for full details.

**Example flow:**
1. User sends `/prompt Fix the login bug`
2. Bot posts summary message in channel: "Working on: Fix the login bug"
3. Bot creates thread from that message: "Session: Fix the login bug"
4. All tool calls, outputs, permission prompts go in the thread
5. When complete, bot edits the channel message: "Done: Fix the login bug (3 files changed)"

## Data Flow

### Primary Request Flow

```
Discord User
    |
    | /prompt "Fix the login bug"
    v
Command Handler (discord/commands/prompt.ts)
    |
    | Validates input, identifies channel
    v
Bridge Router (bridge/router.ts)
    |
    | Creates or resumes session, maps channel -> session
    v
Session Manager (claude/session.ts)
    |
    | Calls query({ prompt, options })
    v
Claude Agent SDK
    |
    | Streams SDKMessage events via AsyncGenerator
    v
Session Manager
    |
    +-- SDKSystemMessage (init) --> save session_id
    |
    +-- SDKAssistantMessage --> Output Buffer --> Discord thread
    |
    +-- canUseTool fires --> Permission Forwarder --> Discord buttons
    |                                                     |
    |                         <-- user clicks Allow/Deny --+
    |                         returns PermissionResult to SDK
    |
    +-- SDKResultMessage --> Output Renderer --> summary in channel
```

### Permission Flow (Detail)

```
Claude Agent SDK calls canUseTool(toolName, input)
    |
    v
Permission Forwarder (claude/permissions.ts)
    |
    | Formats tool request as human-readable description
    v
Discord Thread: posts message with Allow/Deny buttons
    |
    | awaitMessageComponent (5 min timeout)
    v
User clicks button (or timeout)
    |
    v
Permission Forwarder resolves Promise
    |
    | Returns { behavior: "allow", updatedInput } or { behavior: "deny", message }
    v
Claude Agent SDK continues execution
```

### AskUserQuestion Flow (Detail)

```
Claude calls AskUserQuestion tool --> canUseTool fires
    |
    v
Permission Forwarder detects toolName === "AskUserQuestion"
    |
    | Extracts questions[].question, options[].label
    v
Discord Thread: posts question with Select Menu or numbered buttons
    |
    | awaitMessageComponent
    v
User selects option(s)
    |
    v
Permission Forwarder builds answers object: { [questionText]: selectedLabel }
    |
    | Returns { behavior: "allow", updatedInput: { questions, answers } }
    v
Claude receives answers and continues
```

### Output Streaming Flow

```
Agent SDK emits SDKAssistantMessage / SDKPartialAssistantMessage
    |
    v
Session Manager dispatches to Output Buffer
    |
    | buffer.append(extractText(message))
    v
Output Buffer (debounced, 1.5s interval)
    |
    | Coalesces accumulated text
    v
Discord Thread: edit existing message OR create new if >2000 chars
    |
    v
On SDKResultMessage:
    | buffer.finalize()
    | Post summary to main channel
    v
Done
```

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single user (target) | Everything in-process. One Discord bot, one session at a time. In-memory state. No database needed. |
| 2-5 concurrent users | Add a session queue. Agent SDK sessions are heavyweight (API calls, tool execution). Queue requests and process sequentially, or allow 2-3 concurrent with `AbortController` for cancellation. |
| 10+ concurrent users | Out of scope for this project, but would require: process isolation (each session in a worker), persistent state (SQLite/Redis), and careful API cost management. |

### Scaling Priorities

1. **First bottleneck:** Discord rate limits on message edits. Solved by Output Buffer pattern (debounce at 1-2 second intervals).
2. **Second bottleneck:** Agent SDK session cost and duration. A single Claude session can run for minutes and cost dollars. For single-user, this is fine. For multi-user, you need queuing and budget limits (`maxBudgetUsd` option).

## Anti-Patterns

### Anti-Pattern 1: PTY Spawning with Terminal Parsing

**What people do:** Spawn `claude` as a child process with node-pty, capture raw terminal output, regex-parse ANSI sequences to extract text, and simulate keystrokes for permission prompts.

**Why it is wrong:** Extremely fragile. Claude Code's terminal UI is not a stable API. Any update to formatting, colors, prompt text, or cursor behavior breaks the parser. The Agent SDK exists precisely to avoid this. Two real-world projects (discord-agent-bridge, claude-discord-bridge) started with tmux/PTY approaches and the architecture is inherently limited.

**Do this instead:** Use `@anthropic-ai/claude-agent-sdk` with `query()`. Structured messages, typed callbacks, no parsing.

### Anti-Pattern 2: Editing Discord Messages on Every Token

**What people do:** Update the Discord message every time the SDK emits a partial token or message event.

**Why it is wrong:** Discord's API rate limits message edits to roughly 5 per 5 seconds per channel. Streaming tokens arrive many times per second. This causes 429 errors, message edit failures, and laggy/broken output display.

**Do this instead:** Buffer output and flush on a timer (1-2 second interval). Only send the latest accumulated state, not every intermediate state.

### Anti-Pattern 3: Monolithic Message Handler

**What people do:** Put all logic (Discord handling, SDK management, permission forwarding, output formatting) in a single large file or function.

**Why it is wrong:** Untestable, hard to debug, impossible to reason about state. The Session Manager needs to track session state, the Permission Forwarder needs to manage button interactions, and the Output Buffer needs to manage timers -- these are independent concerns.

**Do this instead:** Separate into layers (Discord, Bridge, Claude) with clean interfaces between them. Each component should be testable in isolation.

### Anti-Pattern 4: Ignoring Session Resume

**What people do:** Start a fresh session for every user message, losing all context from previous interactions.

**Why it is wrong:** Claude Code sessions maintain context (files read, changes made, conversation history). Starting fresh means Claude re-reads files, loses understanding of what was already done, and costs more tokens.

**Do this instead:** Track session IDs. Use the SDK's `resume` option to continue conversations. The `SDKSystemMessage` with `subtype: "init"` provides the `session_id` to store.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Discord API | discord.js v14 WebSocket gateway + REST | discord.js handles rate limiting, reconnection, and caching internally |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk` `query()` async generator | Requires `ANTHROPIC_API_KEY` env var. SDK spawns a Claude Code subprocess internally |
| Anthropic API | Handled by Agent SDK (transparent) | SDK manages API calls, token counting, and model selection. Cost tracked in `SDKResultMessage.total_cost_usd` |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Discord Layer <-> Bridge | Function calls + callbacks | Bridge exposes `startSession(prompt)`, `sendFollowUp(text)`, `stopSession()`. Bridge calls back with `onOutput(text)`, `onPermissionRequest(...)`, `onComplete(result)` |
| Bridge <-> Claude Layer | Function calls + EventEmitter or callbacks | Session Manager exposes typed events. Bridge subscribes. Permission Forwarder is injected as `canUseTool` callback |
| Output Buffer <-> Discord | Discord.js `Message.edit()` | Buffer owns a single Discord message reference, edits it on flush. Creates new messages when content exceeds 2000 chars |

## Build Order (Dependencies)

The components have clear dependency ordering that informs phase structure:

```
Phase 1: Foundation
  config.ts
  types/index.ts
  discord/client.ts (basic bot that connects and responds)

Phase 2: Claude Integration
  claude/session.ts (wraps Agent SDK query(), consumes generator)
  claude/hooks.ts (basic hook wiring)
  bridge/router.ts (connects Discord input -> session)

Phase 3: Permission System
  claude/permissions.ts (canUseTool callback)
  discord/handlers/interaction.ts (button handling)
  [depends on Phase 2 -- needs working session to test]

Phase 4: Output Quality
  bridge/buffer.ts (debounced streaming)
  discord/renderer.ts (formatting, code blocks, thread creation)
  [depends on Phase 2 -- needs streaming output to buffer]

Phase 5: Session Management
  Session store (resume, continue, list)
  discord/commands/session.ts
  [depends on Phase 2 -- needs session IDs to store]
```

**Key dependency chain:** You cannot build permissions or output rendering without first having a working SDK session. The session manager is the foundation that everything else plugs into.

## Sources

- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview) -- Official Anthropic documentation (HIGH confidence)
- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- Full API types and interfaces (HIGH confidence)
- [Claude Agent SDK User Input / Permissions](https://platform.claude.com/docs/en/agent-sdk/user-input) -- canUseTool, AskUserQuestion handling (HIGH confidence)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) -- CLI flags and modes (HIGH confidence)
- [Claude Code Permissions](https://code.claude.com/docs/en/permissions) -- Permission system details (HIGH confidence)
- [discord-agent-bridge](https://github.com/DoBuDevel/discord-agent-bridge) -- Existing tmux-polling approach, TypeScript (MEDIUM confidence)
- [claude-discord-bridge](https://github.com/thcapp/claude-discord-bridge) -- Existing hybrid tmux/PTY approach (MEDIUM confidence)
- [node-pty GitHub](https://github.com/microsoft/node-pty) -- PTY spawning library, v1.1.0 (HIGH confidence)
- [Discord API Rate Limits](https://docs.discord.com/developers/topics/rate-limits) -- 50 req/s global, per-route limits (HIGH confidence)
- [discord.js Threads Guide](https://discordjs.guide/popular-topics/threads.html) -- Thread creation patterns (HIGH confidence)
- [strip-ansi npm](https://www.npmjs.com/package/strip-ansi) -- ANSI stripping (reference only, not needed with SDK approach)

---
*Architecture research for: GSD Proxy -- Discord-to-Claude Code bridge*
*Researched: 2026-02-12*
