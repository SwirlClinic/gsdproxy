# Phase 2: Interactive Proxy - Research

**Researched:** 2026-02-12
**Domain:** Claude CLI permission proxying via MCP, Discord interactive components (buttons/selects), real-time streaming output, Discord threads
**Confidence:** MEDIUM-HIGH

## Summary

Phase 2 transforms the existing one-way proxy (Discord -> Claude -> Discord) into a fully interactive system where Claude's permission requests and clarifying questions are surfaced as Discord buttons/select menus, responses stream in real-time, and output is organized into threads. The architecture has three major integration points: (1) an MCP permission-prompt server that bridges Claude's tool approval requests to Discord UI, (2) real-time streaming via debounced message edits, and (3) Discord thread management for organized output.

The most architecturally significant change is the MCP permission-prompt server. When Claude CLI is run with `--permission-prompt-tool mcp__<server>__<tool_name>`, it delegates tool approval decisions to a custom MCP server. This MCP server runs as a subprocess of Claude Code (via stdio transport), meaning it is a **separate process** from the Discord bot. The MCP tool call **blocks Claude's execution** until a response is returned. The critical design challenge is inter-process communication: the MCP server must notify the Discord bot to display a button prompt, then block until the user clicks a button, then return the allow/deny response to Claude.

The `AskUserQuestion` tool follows the same permission-prompt callback pattern -- it fires `canUseTool` with `toolName === "AskUserQuestion"` and an input containing a `questions` array with multiple-choice options. The response format is the same `{ behavior: "allow", updatedInput: { questions, answers } }` structure. This means a single MCP permission-prompt tool handles BOTH tool permissions AND clarifying questions.

**Primary recommendation:** Build a custom MCP permission-prompt server (using `@modelcontextprotocol/sdk`) that communicates with the Discord bot process via a local HTTP server or Unix domain socket. The MCP server sends permission/question requests to the bot, which renders Discord buttons and waits for user interaction. On button click, the bot responds to the MCP server's pending HTTP request, which unblocks the MCP tool call and returns the result to Claude.

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| discord.js | ^14.25.0 | Discord bot framework, buttons, threads, embeds | Already installed. Provides ButtonBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, thread creation. |
| Node.js | 22.x LTS | Runtime | Already in use. |
| TypeScript | ^5.9.0 | Type safety | Already in use. |

### New Dependencies
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | latest | Build the MCP permission-prompt server | Official MCP TypeScript SDK. Provides McpServer, StdioServerTransport, tool registration with Zod schemas. Required to implement --permission-prompt-tool. |
| zod | ^3.23.0 | Schema validation for MCP tool inputs | Required by @modelcontextprotocol/sdk for tool parameter schemas. |

### Not Needed
| Library | Why Not |
|---------|---------|
| node-ipc | Overkill. A simple local HTTP server or EventEmitter-based IPC is sufficient for MCP<->bot communication. |
| socket.io | Too heavy. Raw HTTP request/response or a simple TCP/Unix socket is all we need for synchronous permission bridging. |
| express | Not needed for the internal IPC server. Node's built-in `http.createServer()` is sufficient for a single-endpoint local server. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| MCP stdio server + HTTP IPC | In-process MCP via custom transport | Simpler but impossible -- Claude Code launches MCP as subprocess via `--mcp-config`, separate process is mandatory |
| HTTP IPC between MCP and bot | Unix domain socket | Unix socket is slightly faster but HTTP is cross-platform and easier to debug. HTTP recommended. |
| HTTP IPC between MCP and bot | File-based signaling (temp files) | Fragile, polling-based. HTTP is reliable and event-driven. |
| Per-message awaitMessageComponent | Persistent interactionCreate listener | awaitMessageComponent is simpler for permission prompts (one prompt, one response, with timeout). Use it. |

**Installation:**
```bash
npm install @modelcontextprotocol/sdk zod
```

## Architecture Patterns

### Recommended Project Structure Changes
```
src/
  mcp/
    permission-server.ts   # MCP server entry point (separate process)
    ipc-client.ts          # HTTP client to call back to Discord bot
  bridge/
    router.ts              # MODIFIED: thread creation, streaming, IPC server
    permission-handler.ts  # NEW: Discord button/embed rendering, response collection
    ipc-server.ts          # NEW: HTTP server receiving MCP permission requests
  claude/
    process.ts             # MODIFIED: add --permission-prompt-tool and --mcp-config flags
    parser.ts              # Unchanged
    types.ts               # MODIFIED: add AskUserQuestion types
  discord/
    formatter.ts           # MODIFIED: add formatPermissionEmbed, formatQuestionEmbed
    client.ts              # Unchanged
    components/
      permission-prompt.ts # NEW: ButtonBuilder/ActionRowBuilder for Allow/Deny
      question-prompt.ts   # NEW: StringSelectMenuBuilder for AskUserQuestion
    commands/              # Existing
    handlers/              # MODIFIED: add button interaction handling
```

### Pattern 1: MCP Permission-Prompt Server with IPC Bridge
**What:** A standalone MCP server that Claude Code spawns as a subprocess. When Claude needs permission, the MCP server receives the tool_name and input, makes an HTTP POST to the Discord bot's internal IPC server, and blocks until the bot responds with allow/deny.
**When to use:** Every time Claude requests a tool that isn't auto-approved via --allowedTools.

**How it works:**
```
Claude CLI (--permission-prompt-tool mcp__permsrv__permission_prompt)
  |
  | (Claude needs Write permission)
  | calls MCP tool via stdio
  v
MCP Permission Server (permission-server.ts, separate process)
  |
  | HTTP POST to localhost:<IPC_PORT>/permission
  | body: { tool_use_id, tool_name, input }
  | (blocks waiting for HTTP response)
  v
Discord Bot IPC Server (ipc-server.ts, same process as bot)
  |
  | Creates permission embed + Allow/Deny buttons
  | Sends to Discord channel/thread
  | Calls message.awaitMessageComponent({ time: 300_000 })  // 5 min timeout
  |
  | (user clicks Allow or Deny button)
  |
  | Responds to HTTP request with { behavior, updatedInput/message }
  v
MCP Permission Server receives HTTP response
  |
  | Returns MCP tool result to Claude via stdio
  v
Claude CLI receives allow/deny and continues/adjusts
```

**Example - MCP Server (permission-server.ts):**
```typescript
// Source: @modelcontextprotocol/sdk docs + UnknownJoe796/claude-code-mcp-permission
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const IPC_PORT = parseInt(process.env.GSD_IPC_PORT || "9824");

const server = new McpServer({
  name: "gsdproxy-permissions",
  version: "1.0.0",
});

server.tool(
  "permission_prompt",
  "Handle permission requests from Claude CLI",
  {
    tool_use_id: z.string(),
    tool_name: z.string(),
    input: z.any(),
  },
  async ({ tool_use_id, tool_name, input }) => {
    // Forward to Discord bot via HTTP
    const response = await fetch(`http://127.0.0.1:${IPC_PORT}/permission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool_use_id, tool_name, input }),
    });

    const result = await response.json();
    // result is { behavior: "allow", updatedInput } or { behavior: "deny", message }

    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Example - IPC Server (ipc-server.ts):**
```typescript
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";

export class IpcServer extends EventEmitter {
  private server: ReturnType<typeof createServer>;
  private port: number;

  constructor(port: number) {
    super();
    this.port = port;
    this.server = createServer(this.handleRequest.bind(this));
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, "127.0.0.1", () => resolve());
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    if (req.method === "POST" && req.url === "/permission") {
      const body = await readBody(req);
      const request = JSON.parse(body);

      // Emit event to Discord bot -- the handler will resolve with the decision
      // This Promise will block until the user clicks Allow/Deny in Discord
      const decision = await new Promise<PermissionDecision>((resolve) => {
        this.emit("permission-request", request, resolve);
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(decision));
    }
  }
}
```

### Pattern 2: Discord Permission Prompt with Buttons
**What:** When the IPC server receives a permission request, render an embed with tool info and Allow/Deny buttons. Use `awaitMessageComponent` with a 5-minute timeout.
**When to use:** Every permission request from Claude.

**Example:**
```typescript
// Source: discord.js docs -- ButtonBuilder, ActionRowBuilder, EmbedBuilder
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Message,
  TextChannel,
} from "discord.js";

interface PermissionRequest {
  tool_use_id: string;
  tool_name: string;
  input: Record<string, unknown>;
}

async function promptPermission(
  channel: TextChannel,
  request: PermissionRequest
): Promise<{ behavior: "allow" | "deny"; updatedInput?: unknown; message?: string }> {
  const embed = new EmbedBuilder()
    .setTitle(`Permission Request: ${request.tool_name}`)
    .setDescription(formatToolInput(request.tool_name, request.input))
    .setColor(0xffa500); // Orange

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`perm_allow_${request.tool_use_id}`)
      .setLabel("Allow")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`perm_deny_${request.tool_use_id}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
  );

  const promptMsg = await channel.send({ embeds: [embed], components: [row] });

  try {
    const interaction = await promptMsg.awaitMessageComponent({
      time: 300_000, // 5 minutes
    });

    // Acknowledge the button click
    await interaction.update({ components: [] }); // Remove buttons

    if (interaction.customId.startsWith("perm_allow")) {
      return { behavior: "allow", updatedInput: request.input };
    } else {
      return { behavior: "deny", message: "User denied this action" };
    }
  } catch {
    // Timeout -- auto-deny
    await promptMsg.edit({
      embeds: [embed.setColor(0xff0000).setFooter({ text: "Timed out - auto-denied" })],
      components: [],
    });
    return { behavior: "deny", message: "Permission request timed out (5 minutes)" };
  }
}
```

### Pattern 3: AskUserQuestion via Discord Select Menus
**What:** When Claude calls AskUserQuestion, render each question as a Discord select menu (StringSelectMenuBuilder) or buttons if options are few. Return answers in the format Claude expects.
**When to use:** When tool_name in the permission prompt is "AskUserQuestion".

**Key format details (from official docs):**
- Input: `{ questions: [{ question, header, options: [{ label, description }], multiSelect }] }`
- Response: `{ behavior: "allow", updatedInput: { questions: [...], answers: { "question text": "selected label" } } }`
- Each question has 2-4 options
- 1-4 questions per AskUserQuestion call
- multiSelect: join multiple labels with ", "

**Example:**
```typescript
import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";

async function promptQuestion(channel: TextChannel, input: AskUserQuestionInput) {
  const answers: Record<string, string> = {};

  for (const q of input.questions) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`question_${q.header}`)
      .setPlaceholder(q.question)
      .setMinValues(1)
      .setMaxValues(q.multiSelect ? q.options.length : 1)
      .addOptions(
        q.options.map((opt) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(opt.label)
            .setDescription(opt.description)
            .setValue(opt.label)
        )
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const msg = await channel.send({
      content: `**${q.header}:** ${q.question}`,
      components: [row],
    });

    const interaction = await msg.awaitMessageComponent({ time: 300_000 });
    await interaction.update({ components: [] });

    if (interaction.isStringSelectMenu()) {
      answers[q.question] = interaction.values.join(", ");
    }
  }

  return {
    behavior: "allow" as const,
    updatedInput: { questions: input.questions, answers },
  };
}
```

### Pattern 4: Real-Time Streaming via Debounced Message Edits
**What:** Instead of accumulating all text and sending at the end (Phase 1 behavior), edit a "streaming" message in-place as text deltas arrive. Debounce edits to respect Discord's rate limits (approximately 5 edits per 5 seconds per channel).
**When to use:** For CLDI-04 (real-time streaming output).

**Rate limit constraints:**
- Discord allows approximately 5 message edits per 5 seconds per channel (MEDIUM confidence -- exact limits are undocumented and may vary)
- discord.js handles rate limiting internally (queues requests), but debouncing on our side prevents unnecessary API calls
- A 1.5-2 second debounce interval is safe and provides a good streaming feel

**Example:**
```typescript
class StreamingMessage {
  private message: Message;
  private pendingText = "";
  private editTimer: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_MS = 1500;

  constructor(message: Message) {
    this.message = message;
  }

  appendText(text: string): void {
    this.pendingText += text;
    this.scheduleEdit();
  }

  private scheduleEdit(): void {
    if (this.editTimer) return; // Already scheduled
    this.editTimer = setTimeout(async () => {
      this.editTimer = null;
      const content = this.pendingText.slice(0, 1900); // Discord limit
      try {
        await this.message.edit(content || "*Working...*");
      } catch {
        // Message may be deleted
      }
    }, this.DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }
    // Final edit with full content
    try {
      await this.message.edit(this.pendingText.slice(0, 1900));
    } catch {
      // Ignore
    }
  }
}
```

### Pattern 5: Thread-Based Output Organization
**What:** Create a Discord thread for each session/request. Post detailed output (tool calls, full responses) in the thread. Post a concise summary in the main channel with a link to the thread.
**When to use:** Every Claude session (OUTD-02, OUTD-03, OUTD-04).

**Example:**
```typescript
import { ThreadAutoArchiveDuration, TextChannel, ThreadChannel } from "discord.js";

async function createSessionThread(
  channel: TextChannel,
  prompt: string
): Promise<ThreadChannel> {
  const threadName = prompt.slice(0, 95) + (prompt.length > 95 ? "..." : "");

  const thread = await channel.threads.create({
    name: threadName,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
    reason: "Claude session output",
  });

  return thread;
}

// Summary in main channel + full output in thread
async function postWithThread(
  channel: TextChannel,
  thread: ThreadChannel,
  fullText: string
): Promise<void> {
  // Full output goes to thread
  const chunks = splitMessage(fullText);
  for (const chunk of chunks) {
    await thread.send(chunk);
  }

  // Summary in main channel
  if (fullText.length > 1500) {
    const summary = fullText.slice(0, 1500) + "...";
    await channel.send(
      `${summary}\n\n*Full output in thread: ${thread.toString()}*`
    );
  } else {
    await channel.send(fullText);
  }
}
```

### Pattern 6: MCP Config for Claude CLI
**What:** Pass MCP server configuration to Claude CLI via `--mcp-config` flag. The config is a JSON string or file path specifying how to launch the MCP permission server.
**When to use:** Every Claude CLI invocation.

**Example:**
```typescript
// In process.ts, modify spawnClaude to include MCP config
const mcpConfig = JSON.stringify({
  mcpServers: {
    permsrv: {
      command: "node",
      args: [path.resolve(__dirname, "../mcp/permission-server.js")],
      env: {
        GSD_IPC_PORT: String(ipcPort),
      },
    },
  },
});

args.push(
  "--mcp-config", mcpConfig,
  "--permission-prompt-tool", "mcp__permsrv__permission_prompt"
);
```

### Anti-Patterns to Avoid

- **Writing to Claude CLI's stdin for permission responses:** The `--input-format stream-json` flag is for sending follow-up messages, NOT for answering permission prompts. Permission responses must go through the MCP permission-prompt tool. Do not try to write permission responses directly to the subprocess stdin.

- **Running MCP server in-process with the bot:** The `--mcp-config` flag requires specifying a `command` to spawn. The MCP server MUST be a separate process communicating via stdio with Claude Code. It cannot be a function inside the bot process.

- **Using the interactionCreate event for permission buttons without scoping:** If you use a global interactionCreate handler for button clicks, you must filter by customId prefix to avoid handling buttons from other features. Better: use `awaitMessageComponent` scoped to the specific permission prompt message.

- **Not handling the MCP server as a compiled JS file:** Since `permission-server.ts` runs as a separate process, it must be compiled to JS or run via tsx. The `--mcp-config` command must point to the compiled output (e.g., `dist/mcp/permission-server.js`) or use `tsx` as the command.

- **Editing messages on every text delta:** Text deltas arrive many times per second. Without debouncing, you will hit Discord rate limits immediately and get queued requests. Always debounce with 1-2 second intervals.

- **Creating threads for very short responses:** If Claude's response is under 1500 chars with no tool activity, creating a thread adds noise. Only create threads when there's meaningful detail to organize (tool calls, long output).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP server protocol | Custom JSON-RPC over stdio | `@modelcontextprotocol/sdk` McpServer + StdioServerTransport | MCP protocol has versioning, negotiation, and specific JSON-RPC patterns. The SDK handles all of this. |
| MCP tool schema validation | Manual JSON validation | `zod` schemas via MCP SDK `server.tool()` | The MCP SDK expects Zod schemas for tool parameters. Using anything else fights the framework. |
| Discord button timeout | Custom timer + cleanup | `message.awaitMessageComponent({ time: 300_000 })` | awaitMessageComponent handles the timeout, cleanup, and race condition with the collector. It rejects on timeout which maps cleanly to auto-deny. |
| Discord rate limit handling for edits | Custom rate limiter | discord.js built-in + application-side debounce | discord.js queues requests when rate limited. Add a debounce on our side to reduce unnecessary API calls. |
| Message splitting for threads | New splitter for threads | Existing `splitMessage()` from Phase 1 | The same splitting logic works for thread messages. Reuse it. |

**Key insight:** The `--permission-prompt-tool` MCP integration is the load-bearing architectural piece. Everything else (buttons, threads, streaming) is standard discord.js patterns. Get the MCP<->Discord IPC bridge right and the rest follows naturally.

## Common Pitfalls

### Pitfall 1: MCP Server Process Lifecycle Management
**What goes wrong:** The MCP permission server is spawned by Claude CLI as a subprocess. If Claude CLI is killed (via /stop), the MCP server should also die. But if the MCP server has an open HTTP request to the bot (waiting for user's button click), and Claude dies, the HTTP request hangs forever.
**Why it happens:** Claude CLI manages MCP server lifecycle, but the HTTP connection to the bot is independent.
**How to avoid:** (1) Set a timeout on the HTTP request in the MCP server (e.g., 6 minutes, longer than the 5-minute button timeout). (2) Handle SIGTERM in the MCP server to abort pending requests. (3) In the bot's IPC server, track pending requests and clean them up when the Claude process exits.
**Warning signs:** Hanging HTTP connections after /stop. MCP server process not exiting.

### Pitfall 2: Claude CLI Blocking While Waiting for Permission
**What goes wrong:** While Claude waits for the MCP permission-prompt tool to respond, no stream events are emitted. The streaming output "freezes." Users may think the bot crashed.
**Why it happens:** The permission prompt is a blocking tool call. Claude pauses execution until it gets a response.
**How to avoid:** When the permission prompt is displayed, update the status message to indicate Claude is waiting for the user's decision. The stream will resume after the user responds.
**Warning signs:** Long pauses in streaming output with no status indicator.

### Pitfall 3: Discord's 3-Second Interaction Acknowledgement Requirement
**What goes wrong:** When a user clicks a button, Discord requires acknowledgement within 3 seconds. If the handler does async work (like responding to the HTTP request) before acknowledging, the interaction fails.
**Why it happens:** Discord's interaction model requires immediate acknowledgement.
**How to avoid:** Always call `interaction.update()` or `interaction.deferUpdate()` FIRST, then do async work (respond to HTTP, update UI).
**Warning signs:** "This interaction failed" in Discord when clicking buttons.

### Pitfall 4: Multiple Concurrent Permission Requests
**What goes wrong:** Claude may request permission for multiple tools in rapid succession (unlikely but possible). If the bot only tracks one pending permission request, subsequent requests get lost.
**Why it happens:** The MCP tool is called once per permission check. If Claude needs multiple permissions (e.g., Read then Write in the same turn), they come sequentially but could overlap with async processing.
**How to avoid:** Track pending permission requests by `tool_use_id` in a Map. Each request gets its own Discord message with its own awaitMessageComponent.
**Warning signs:** Permission prompts appearing but button clicks having no effect.

### Pitfall 5: Thread Creation Race with First Message
**What goes wrong:** Thread is created, but the first status/streaming message is sent to the main channel instead of the thread because the thread reference isn't wired up fast enough.
**Why it happens:** Thread creation is async. If the stream event handler fires before the thread is fully set up, it defaults to the main channel.
**How to avoid:** Create the thread BEFORE starting the Claude process, or buffer events until the thread is ready.
**Warning signs:** First few messages appearing in the main channel, rest in thread.

### Pitfall 6: Streaming Message Exceeding 2000 Characters
**What goes wrong:** The streaming message is edited in-place, but Claude's response grows beyond 2000 characters. The edit fails with a Discord API error.
**Why it happens:** Streaming accumulates text. A single Discord message can only hold 2000 characters.
**How to avoid:** When the streaming text approaches 1800 characters, truncate the display with "..." and note that full output is in the thread. The thread gets the full text via splitMessage.
**Warning signs:** Discord API errors in logs. Streaming message stops updating.

### Pitfall 7: MCP Server Logging to stdout
**What goes wrong:** The MCP server communicates with Claude Code via stdio (stdin/stdout). If the MCP server uses `console.log()`, it corrupts the JSON-RPC message stream.
**Why it happens:** Console.log writes to stdout, which is the MCP transport channel.
**How to avoid:** Use `console.error()` for all logging in the MCP server. Never use console.log.
**Warning signs:** MCP server connection failures. Garbled JSON-RPC errors.

### Pitfall 8: IPC Port Conflicts
**What goes wrong:** The hardcoded IPC port (e.g., 9824) is already in use by another process. The IPC server fails to start.
**Why it happens:** Port collisions in development environments.
**How to avoid:** Use port 0 (OS-assigned) and pass the actual port to the MCP server via environment variable. Or use a configurable port from .env.
**Warning signs:** EADDRINUSE errors on startup.

## Code Examples

### Complete MCP Config Wiring in process.ts
```typescript
// Source: Claude Code CLI --mcp-config docs + UnknownJoe796/claude-code-mcp-permission
import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";

export function spawnClaude(
  prompt: string,
  options: SpawnOptions & { ipcPort: number }
): ChildProcess {
  const args: string[] = [];

  if (options.continueSession) {
    args.push("--continue");
  } else if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }

  // MCP permission server config
  const mcpConfig = JSON.stringify({
    mcpServers: {
      permsrv: {
        command: process.execPath, // node or tsx
        args: [path.resolve(import.meta.dirname, "../mcp/permission-server.js")],
        env: {
          GSD_IPC_PORT: String(options.ipcPort),
        },
      },
    },
  });

  args.push(
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--allowedTools", "Read", "Glob", "Grep",
    "--mcp-config", mcpConfig,
    "--permission-prompt-tool", "mcp__permsrv__permission_prompt"
  );

  return spawn("claude", args, {
    cwd: options.cwd,
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  });
}
```

### Permission Embed with Tool Info
```typescript
// Source: discord.js EmbedBuilder docs
import { EmbedBuilder } from "discord.js";

function formatPermissionEmbed(
  toolName: string,
  input: Record<string, unknown>
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Tool Permission: ${toolName}`)
    .setColor(0xffa500);

  // Add relevant fields based on tool type
  switch (toolName) {
    case "Bash":
      embed.setDescription(`\`\`\`\n${input.command}\n\`\`\``);
      if (input.description) {
        embed.addFields({ name: "Description", value: String(input.description) });
      }
      break;
    case "Write":
      embed.setDescription(`Writing to \`${input.file_path}\``);
      if (input.content) {
        const preview = String(input.content).slice(0, 500);
        embed.addFields({ name: "Content Preview", value: `\`\`\`\n${preview}\n\`\`\`` });
      }
      break;
    case "Edit":
      embed.setDescription(`Editing \`${input.file_path}\``);
      break;
    default:
      embed.setDescription(`\`\`\`json\n${JSON.stringify(input, null, 2).slice(0, 1000)}\n\`\`\``);
  }

  return embed;
}
```

### Thread + Summary Pattern
```typescript
// Source: discord.js Thread docs
async function handleSessionOutput(
  channel: TextChannel,
  thread: ThreadChannel,
  accumulatedText: string,
  resultEvent: ResultEvent
): Promise<void> {
  // Post full output to thread
  const chunks = splitMessage(accumulatedText);
  for (const chunk of chunks) {
    await thread.send(chunk);
  }

  // Post result info to thread
  if (resultEvent.num_turns !== undefined && resultEvent.total_cost_usd !== undefined) {
    await thread.send(
      `*Completed in ${resultEvent.num_turns} turn(s) ($${resultEvent.total_cost_usd.toFixed(4)})*`
    );
  }

  // Post summary to main channel
  if (accumulatedText.length > 1500) {
    const summary = accumulatedText.slice(0, 1500) + "...";
    await channel.send(`${summary}\n\n*Full output: ${thread.toString()}*`);
  } else {
    await channel.send(accumulatedText);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `--dangerouslySkipPermissions` for headless | `--permission-prompt-tool` MCP integration | 2025 (Claude Code 2.x) | Enables granular per-tool approval in headless mode without blanket permission bypass |
| No AskUserQuestion support | AskUserQuestion tool via canUseTool callback | 2025 (v2.0.21) | Claude can ask clarifying questions in programmatic mode, not just interactive terminal |
| MessageActionRow (discord.js v13) | ActionRowBuilder + ButtonBuilder (v14) | discord.js 14.0 | Builder pattern replaces direct construction. Must use .addComponents() |
| MessageSelectMenu (discord.js v13) | StringSelectMenuBuilder (v14) | discord.js 14.0 | Renamed. Use .addOptions() (not .addOption()) |
| SSE transport for MCP | Streamable HTTP (preferred) or stdio | MCP spec 2025-03-26 | SSE deprecated in favor of Streamable HTTP. For local subprocess, stdio remains correct |

## Open Questions

1. **Exact behavior of --permission-prompt-tool with AskUserQuestion**
   - What we know: The Agent SDK docs show AskUserQuestion fires through the same `canUseTool` callback with `toolName === "AskUserQuestion"`. The `--permission-prompt-tool` MCP tool handles "permission prompts in non-interactive mode" per CLI docs.
   - What's unclear: Does AskUserQuestion route through `--permission-prompt-tool` in CLI mode? Or is it only for actual tool permissions? The Agent SDK and CLI may differ here.
   - Recommendation: Test empirically during implementation. If AskUserQuestion does NOT route through the MCP tool, we may need to handle it differently (possibly via `--input-format stream-json` to write user answers to stdin, or by including AskUserQuestion in --allowedTools and handling it another way). **HIGH priority to validate early.**

2. **IPC Port Discovery for MCP Server**
   - What we know: The MCP server is spawned by Claude Code as a subprocess. We can pass env vars via the `--mcp-config` env field.
   - What's unclear: If we use port 0 (OS-assigned), the bot knows the port but the MCP server needs it via env var. The env var is set before the port is assigned.
   - Recommendation: Use a fixed configurable port (from .env, default 9824). Simpler than dynamic discovery. Add to config.ts.

3. **Thread creation timing -- before or after Claude responds?**
   - What we know: Threads should contain full session output including tool activity.
   - What's unclear: Should we create the thread when the user sends a message (before Claude starts), or when we get the first stream event?
   - Recommendation: Create thread immediately when user sends message. This ensures all output (including early tool activity) goes to the thread. The main channel gets only the summary at the end.

4. **Streaming message in thread vs main channel**
   - What we know: CLDI-04 requires real-time streaming. OUTD-02 requires thread-based detailed output.
   - What's unclear: Should the streaming message appear in the main channel (visible, compact) or the thread (detailed)?
   - Recommendation: Stream in the thread for detailed view. In the main channel, show only the status message (tool activity). At completion, post summary in main channel with thread link.

5. **stdin behavior with --permission-prompt-tool**
   - What we know: Phase 1 uses `stdio: ["inherit", "pipe", "pipe"]` (stdin inherited). The permission-prompt-tool replaces the need for interactive stdin.
   - What's unclear: Can we safely change stdin to "pipe" now that permissions go through MCP? Or does Claude CLI still need inherited stdin for something?
   - Recommendation: Test changing stdin from "inherit" to "pipe". If it works, it prevents accidental stdin interference. If not, keep "inherit" but don't write to it.

## Sources

### Primary (HIGH confidence)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) -- All CLI flags including --permission-prompt-tool, --mcp-config, --input-format
- [Claude Code Permissions](https://code.claude.com/docs/en/permissions) -- Three-layer permission model, permission modes, rule syntax
- [Claude Code Headless Mode](https://code.claude.com/docs/en/headless) -- Running Claude programmatically with -p flag, stream-json output
- [Agent SDK User Input Docs](https://platform.claude.com/docs/en/agent-sdk/user-input) -- AskUserQuestion tool format, canUseTool callback, permission response format (allow/deny/updatedInput)
- [@modelcontextprotocol/sdk npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) -- Official MCP TypeScript SDK for building MCP servers
- [discord.js Guide - Buttons](https://discordjs.guide/legacy/interactive-components/buttons) -- ButtonBuilder, ButtonStyle, ActionRowBuilder
- [discord.js Guide - Component Interactions](https://discordjs.guide/legacy/interactive-components/interactions) -- awaitMessageComponent, createMessageComponentCollector, timeout handling
- [discord.js Guide - Select Menus](https://discordjs.guide/legacy/interactive-components/select-menus) -- StringSelectMenuBuilder, options
- [discord.js Guide - Threads](https://discordjs.guide/popular-topics/threads.html) -- channel.threads.create(), message.startThread(), ThreadAutoArchiveDuration

### Secondary (MEDIUM confidence)
- [UnknownJoe796/claude-code-mcp-permission](https://github.com/UnknownJoe796/claude-code-mcp-permission) -- Working MCP permission server implementation with tool registration, demonstrates tool_use_id/tool_name/input parameters and allow/deny response format
- [VibesParking Permission Prompt Tool Guide](https://www.vibesparking.com/en/blog/ai/claude-code/docs/cli/2025-08-28-outsourcing-permissions-with-claude-code-permission-prompt-tool/) -- MCP tool naming convention (mcp__server__tool), three-layer permission evaluation, TypeScript conceptual implementation
- [Claude Code Issue #1175](https://github.com/anthropics/claude-code/issues/1175) -- Permission-prompt-tool feature request, response format details, community workarounds
- [Claude Code Issue #10346](https://github.com/anthropics/claude-code/issues/10346) -- AskUserQuestion tool documentation gap, confirms tool existence and basic schema
- [Discord API Rate Limits](https://discord.com/developers/docs/topics/rate-limits) -- Rate limit headers, approximately 5 edits per 5 seconds per channel

### Tertiary (LOW confidence)
- Discord message edit rate limits: "5 per 5 seconds per channel" is widely cited in community but not precisely documented by Discord. The exact limits may vary. Debounce at 1.5-2s to be safe.
- AskUserQuestion routing through --permission-prompt-tool: NOT confirmed by official docs for CLI mode. Needs empirical validation.

## Metadata

**Confidence breakdown:**
- MCP permission-prompt server architecture: MEDIUM-HIGH -- The MCP SDK and --permission-prompt-tool flag are well-documented. The IPC bridge pattern (HTTP between MCP server and bot) is a standard engineering pattern but has not been validated in this specific configuration.
- Discord interactive components: HIGH -- ButtonBuilder, StringSelectMenuBuilder, awaitMessageComponent, threads are all well-documented and mature in discord.js v14.
- Real-time streaming: MEDIUM -- Debounce intervals for message edits are based on community knowledge about Discord rate limits, which are not precisely documented.
- AskUserQuestion integration: MEDIUM -- Agent SDK docs are clear on the format. Whether it routes through --permission-prompt-tool in CLI mode needs empirical validation.
- Pitfalls: HIGH -- Process lifecycle, port management, Discord interaction timing are well-understood patterns.

**Research date:** 2026-02-12
**Valid until:** 30 days (Claude Code CLI flags are stable; discord.js v14 is mature)
