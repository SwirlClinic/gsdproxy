# Phase 3: Session Persistence - Research

**Researched:** 2026-02-15
**Domain:** Session lifecycle management, multi-session architecture, Discord presence/embeds, cost tracking
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Resume experience
- `/continue` reuses the existing Discord thread (posts new messages into the same thread)
- If the previous Claude session can't be resumed (expired, crashed, context lost), notify the user and ask: start fresh or abort -- don't silently restart
- On resume, post a status embed in the thread showing session info (session resumed, started time, messages so far, etc.)
- Sessions are in-memory only -- lost on bot restart. Original roadmap criterion #1 is relaxed to match this simpler scope

#### Session commands UX
- `/stop` kills the session immediately -- no confirmation, even if Claude is mid-response. Show what was completed so far
- `/new` while a session is active: warn and confirm ("A session is active. Stop it and start a new one?" with buttons)
- `/status` command shows session state (active/inactive, session age, message count, thread link, cost info) AND bot presence indicator reflects session state (online/idle/dnd)
- `/new` auto-creates a thread immediately -- don't wait for the first message

#### Cost tracking display
- Cost info shown on demand only (via `/status`) -- not after every message, not at session end automatically
- Display both token counts (input/output) AND estimated dollar cost
- Cost info embedded in the `/status` response alongside other session info

#### Session management
- Multiple concurrent sessions supported (different threads)
- `/continue` resumes the most recent session. To resume a specific one, use that thread directly
- `/stop` shows a picker of active sessions to choose which to stop
- `/new` warns if sessions already active (per earlier decision)

### Claude's Discretion
- Whether to keep a lightweight session history log (start time, message count, cost, thread link) -- weigh complexity vs value
- Cumulative cost tracking (all-time/daily totals) vs per-session only -- pick based on implementation simplicity
- Bot presence state mapping (which Discord status maps to which session state)
- How to handle the session picker UX for `/stop` (select menu vs buttons)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

## Summary

Phase 3 transforms the existing single-session architecture into a multi-session system with session lifecycle commands (`/new`, `/stop`, `/continue`, `/status`), cost tracking, and bot presence indicators. The existing codebase already has the building blocks: `ClaudeSession` manages individual CLI processes, `BridgeRouter` handles Discord-to-Claude message routing, and the slash command infrastructure is in place. The primary challenge is refactoring the 1:1 relationship between `BridgeRouter` and `ClaudeSession` into a 1:N `SessionManager` that maps Discord threads to independent sessions.

A critical architectural insight is that the current persistent `stream-json` process naturally maintains conversation context across multiple messages -- there is no need to use the CLI's `--continue` or `--resume` flags for normal operation. Those flags are relevant only when a Claude process has died and needs to be respawned with prior context loaded from disk (JSONL session files stored in `~/.claude/projects/`). However, since the user has decided sessions are in-memory only (lost on bot restart), the `--resume` mechanism is only needed for mid-session crash recovery, not for cross-restart persistence.

The cost tracking data is already captured: `ResultEvent` includes `total_cost_usd` and `usage` (input/output tokens). The implementation needs to accumulate these values per session and expose them through the `/status` embed.

**Primary recommendation:** Build a `SessionManager` class that wraps multiple `ClaudeSession` instances, maps them to Discord threads, tracks metadata (start time, message count, costs), and provides the session lifecycle operations that the slash commands need.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| discord.js | ^14.25.0 | Discord API client (already installed) | Bot framework, provides EmbedBuilder, StringSelectMenuBuilder, PresenceUpdateStatus, ActivityType |
| Claude CLI | 2.1.42+ | Claude Code subprocess (already used) | Provides stream-json, session persistence, --resume for crash recovery |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (no new deps) | - | - | All needed functionality is available in existing dependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory session store | SQLite/better-sqlite3 | Would survive bot restarts, but user explicitly decided in-memory only -- unnecessary complexity |
| Agent SDK TypeScript package | Claude CLI process | SDK provides programmatic resume, but current CLI approach works and is battle-tested through Phases 1-2 |

**Installation:**
```bash
# No new packages needed -- all functionality available in existing deps
```

## Architecture Patterns

### Current Architecture (Single Session)

```
index.ts
  -> ClaudeSession (1 instance)
  -> BridgeRouter (1 instance, holds ClaudeSession)
  -> Slash commands wired via callbacks (setOnStop, setOnNew, setSessionStatusGetter)
```

**Problem:** `BridgeRouter` owns a single `ClaudeSession` and a single `activeThread`. It creates a new thread per message. Multiple concurrent sessions require multiple ClaudeSession instances, each mapped to a specific thread.

### Target Architecture (Multi-Session)

```
src/
├── bridge/
│   ├── router.ts              # Refactored: delegates to SessionManager
│   ├── session-manager.ts     # NEW: owns Map<threadId, ManagedSession>
│   ├── streaming-message.ts   # Unchanged
│   ├── ipc-server.ts          # Unchanged
│   └── permission-handler.ts  # Unchanged (receives thread context per request)
├── claude/
│   ├── session.ts             # Unchanged (one process per session)
│   └── types.ts               # Extended: add token tracking fields to ResultEvent
├── discord/
│   ├── commands/
│   │   ├── index.ts           # Updated: register /continue
│   │   ├── new.ts             # Refactored: thread creation, active session warning
│   │   ├── stop.ts            # Refactored: session picker
│   │   ├── status.ts          # Refactored: embed with cost/token info
│   │   ├── continue.ts        # NEW: resume most recent session
│   │   └── help.ts            # Updated: document new commands
│   ├── handlers/
│   │   ├── message.ts         # Updated: route by thread (thread msg -> session, channel msg -> new or error)
│   │   └── interaction.ts     # Unchanged
│   └── components/
│       ├── session-picker.ts  # NEW: select menu for /stop
│       ├── status-embed.ts    # NEW: embed builder for /status
│       └── ...existing...
└── index.ts                   # Updated: wire SessionManager
```

### Pattern 1: Session Manager (Central Registry)

**What:** A `SessionManager` class that owns a `Map<string, ManagedSession>` where keys are Discord thread IDs and values are session metadata + `ClaudeSession` reference.

**When to use:** Always -- this is the core of the multi-session architecture.

**ManagedSession interface:**
```typescript
interface ManagedSession {
  id: string;                    // Internal session ID (UUID)
  claudeSession: ClaudeSession;  // The Claude CLI process wrapper
  threadId: string;              // Discord thread ID
  threadUrl: string;             // Discord thread URL for display
  startedAt: Date;               // When session was created
  messageCount: number;          // Messages sent in this session
  lastActivityAt: Date;          // Last message timestamp
  totalCostUsd: number;          // Accumulated from ResultEvent.total_cost_usd
  totalInputTokens: number;      // Accumulated from ResultEvent.usage.input_tokens
  totalOutputTokens: number;     // Accumulated from ResultEvent.usage.output_tokens
  isProcessing: boolean;         // Currently waiting for Claude response
}
```

**Key operations:**
```typescript
class SessionManager {
  // Lifecycle
  createSession(thread: ThreadChannel): ManagedSession
  destroySession(threadId: string): void
  destroyAllSessions(): void

  // Lookup
  getSession(threadId: string): ManagedSession | undefined
  getActiveSessionCount(): number
  getAllSessions(): ManagedSession[]
  getMostRecentSession(): ManagedSession | undefined

  // Message routing
  routeMessage(message: Message): Promise<void>

  // Status
  getGlobalStatus(): GlobalStatus
}
```

### Pattern 2: Thread-Based Message Routing

**What:** Messages in the main channel create new sessions (via `/new`). Messages in an existing session thread are routed to that thread's `ClaudeSession`. Messages in non-session threads are ignored.

**When to use:** In the refactored message handler.

**Routing logic:**
```typescript
// In message handler:
if (message.channel.isThread()) {
  const session = sessionManager.getSession(message.channel.id);
  if (session) {
    // Route to existing session
    await session.sendMessage(message);
  }
  // else: ignore (not a session thread)
} else if (message.channel.id === config.channelId) {
  // Main channel message -- this is now an implicit /new
  // OR: reject with "Use /new to start a session"
  // Decision depends on UX preference
}
```

### Pattern 3: Session Resume via Thread Context

**What:** `/continue` finds the most recent session (or the session in the current thread) and posts a status embed showing the session was resumed.

**When to use:** For the `/continue` command.

**Key insight:** Since sessions use persistent `stream-json` processes, "continuing" a session means simply posting a new message in its thread. The Claude process is already alive and has full context. The `/continue` command's main job is to help the user find the right thread and confirm the session is still active.

**If the Claude process has died (crashed):** The session's `ClaudeSession` will be in `state: "dead"`. At this point, notify the user that the session expired and ask if they want to start fresh or abort. Do NOT attempt `--resume` since sessions are in-memory only (user decision).

```typescript
// /continue logic:
const session = sessionManager.getMostRecentSession();
if (!session) {
  reply("No previous session found. Use /new to start one.");
  return;
}
if (session.claudeSession.isAlive()) {
  // Session is alive -- post resume embed in its thread
  await postResumeEmbed(session);
  reply(`Session resumed in <#${session.threadId}>`);
} else {
  // Session process died -- ask user what to do
  await askFreshOrAbort(interaction, session);
}
```

### Pattern 4: Bot Presence Reflecting Session State

**What:** Update the bot's Discord presence to reflect whether sessions are active.

**Recommendation for status mapping:**
| Session State | Discord Status | Activity Text |
|---------------|---------------|---------------|
| No active sessions | `Online` (green) | "Ready" |
| 1+ sessions idle (waiting for input) | `Idle` (yellow) | "1 session active" / "N sessions active" |
| 1+ sessions processing | `DoNotDisturb` (red) | "Working..." |

**Implementation:**
```typescript
import { PresenceUpdateStatus, ActivityType } from "discord.js";

function updatePresence(client: Client, sessions: SessionManager): void {
  const active = sessions.getActiveSessionCount();
  const processing = sessions.getAllSessions().some(s => s.isProcessing);

  if (active === 0) {
    client.user?.setPresence({
      status: PresenceUpdateStatus.Online,
      activities: [{ name: "Ready", type: ActivityType.Watching }],
    });
  } else if (processing) {
    client.user?.setPresence({
      status: PresenceUpdateStatus.DoNotDisturb,
      activities: [{ name: "Working...", type: ActivityType.Playing }],
    });
  } else {
    client.user?.setPresence({
      status: PresenceUpdateStatus.Idle,
      activities: [{
        name: `${active} session${active > 1 ? "s" : ""} active`,
        type: ActivityType.Watching,
      }],
    });
  }
}
```

**Note:** `PresenceUpdateStatus` and `ActivityType` are both exported directly from `discord.js`. The `GuildPresences` intent is NOT required for setting the bot's own presence -- it is only needed for tracking other members' presence.

### Pattern 5: Status Embed with Cost Info

**What:** The `/status` command responds with a rich embed showing all session information.

**Implementation using EmbedBuilder (already available in discord.js):**
```typescript
import { EmbedBuilder } from "discord.js";

function createStatusEmbed(sessions: ManagedSession[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("Session Status")
    .setColor(sessions.length > 0 ? 0x57f287 : 0x95a5a6);

  if (sessions.length === 0) {
    embed.setDescription("No active sessions. Use `/new` to start one.");
    return embed;
  }

  for (const session of sessions) {
    const age = formatDuration(Date.now() - session.startedAt.getTime());
    embed.addFields({
      name: `Session in <#${session.threadId}>`,
      value: [
        `**Status:** ${session.isProcessing ? "Processing" : "Idle"}`,
        `**Age:** ${age}`,
        `**Messages:** ${session.messageCount}`,
        `**Tokens:** ${session.totalInputTokens.toLocaleString()} in / ${session.totalOutputTokens.toLocaleString()} out`,
        `**Cost:** $${session.totalCostUsd.toFixed(4)}`,
      ].join("\n"),
    });
  }

  // Total cost across all sessions
  const totalCost = sessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
  embed.setFooter({ text: `Total cost: $${totalCost.toFixed(4)}` });

  return embed;
}
```

### Pattern 6: Session Picker for /stop

**What:** When multiple sessions are active, `/stop` shows a select menu letting the user choose which session to stop.

**Use StringSelectMenuBuilder** (already used in `question-prompt.ts` for AskUserQuestion):
```typescript
import {
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
} from "discord.js";

function createSessionPicker(
  sessions: ManagedSession[]
): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId("stop_session_picker")
    .setPlaceholder("Select a session to stop")
    .addOptions(
      sessions.map((s) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`Session in #${s.threadName}`)
          .setDescription(`${s.messageCount} msgs, $${s.totalCostUsd.toFixed(4)}`)
          .setValue(s.threadId)
      )
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}
```

**Recommendation:** Use StringSelectMenuBuilder (select menu) rather than buttons. Select menus support up to 25 options and provide a cleaner UX when there could be many sessions. Buttons are limited to 5 per row and would require multiple rows.

### Anti-Patterns to Avoid
- **Sharing a single ClaudeSession across threads:** Each Claude process has its own conversation context. Using one process for multiple unrelated threads will produce confused responses where Claude mixes up different conversations.
- **Creating threads lazily on first message:** The user decided `/new` should auto-create a thread immediately. Don't wait for the first message.
- **Using `--resume` for normal continuation:** The persistent `stream-json` process already maintains context. `--resume` is for respawning a dead process from disk, which is not needed since sessions are in-memory only.
- **Storing session state in the file system:** User decided in-memory only. Don't write session metadata to disk -- it adds complexity and creates expectations of cross-restart persistence.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session picker UI | Custom button grid | `StringSelectMenuBuilder` from discord.js | Already used in `question-prompt.ts`, supports 25 options, handles interaction natively |
| Status display | Plain text message | `EmbedBuilder` from discord.js | Already used in `permission-prompt.ts`, supports fields/footer/color for structured info |
| Bot presence | Manual WebSocket gateway updates | `client.user.setPresence()` from discord.js | Handles gateway presence update protocol internally |
| Cost accumulation | Manual token counting | `ResultEvent.total_cost_usd` and `ResultEvent.usage` | Claude CLI already tracks and reports this per turn |
| Duration formatting | Custom date math | Simple helper function | Only need `Xm Ys` or `Xh Ym` format -- a 5-line function, not a library |

**Key insight:** All the UI components needed (embeds, select menus, buttons, presence) are already available in discord.js v14 and are already used elsewhere in the codebase. No new libraries are needed.

## Common Pitfalls

### Pitfall 1: Race Condition on Session Creation
**What goes wrong:** Two `/new` commands fire simultaneously, creating two sessions that map to different threads but both try to own the same user's attention.
**Why it happens:** Slash commands are async and discord.js doesn't serialize them.
**How to avoid:** The `SessionManager.createSession()` method should be the single point of session creation. Since the user decided `/new` warns when sessions are active, this warning acts as a natural gate. However, still protect against race conditions by checking session count atomically within `createSession()`.
**Warning signs:** Duplicate thread creation, orphaned sessions.

### Pitfall 2: Permission Request Routing to Wrong Thread
**What goes wrong:** A permission request from one session's Claude process gets routed to a different session's thread.
**Why it happens:** The current `PermissionHandler` uses `this.activeThread` (single global reference). With multiple sessions, each session needs its own permission routing context.
**How to avoid:** Pass the thread reference through the IPC server event, or tag permission requests with the session/thread they belong to. Since each `ClaudeSession` spawns its own MCP subprocess on its own IPC port (or uses a shared port with request tagging), the permission routing must be session-aware.
**Warning signs:** Permission buttons appearing in the wrong thread.

### Pitfall 3: IPC Port Conflicts with Multiple Sessions
**What goes wrong:** Multiple `ClaudeSession` instances all try to use the same IPC port (9824) for their MCP permission server.
**Why it happens:** The current architecture uses a single fixed IPC port configured via `config.ipcPort`.
**How to avoid:** Two approaches: (a) keep a single IPC server but tag requests with session identifiers so the permission handler knows which thread to route to, or (b) assign dynamic ports per session. Option (a) is simpler -- the single IPC server already exists and works; just add a session identifier to the permission request payload or derive it from the request context.
**Warning signs:** "EADDRINUSE" errors, permission prompts going to wrong sessions.

### Pitfall 4: Orphaned Claude Processes on /stop
**What goes wrong:** The session is removed from the manager but the underlying Claude CLI process keeps running.
**Why it happens:** Forgetting to call `session.destroy()` before removing from the map, or not handling errors during destruction.
**How to avoid:** `SessionManager.destroySession()` must always call `ClaudeSession.destroy()` first, then remove from the map. Add a safety net in the shutdown handler that iterates all sessions.
**Warning signs:** Zombie `claude` processes visible in `ps`, growing memory usage.

### Pitfall 5: Thread Auto-Archive During Active Session
**What goes wrong:** Discord auto-archives the thread (after 1 hour per current config: `ThreadAutoArchiveDuration.OneHour`), making it impossible to post new messages.
**Why it happens:** If a session is idle for over an hour, Discord silently archives the thread.
**How to avoid:** Either (a) increase `autoArchiveDuration` to `OneDay` or `OneWeek` for session threads, or (b) unarchive the thread programmatically when sending a message (call `thread.setArchived(false)` before posting). Option (b) is more robust.
**Warning signs:** Messages fail to send in the session thread with "Thread is archived" errors.

### Pitfall 6: Select Menu Interaction Timeout
**What goes wrong:** The `/stop` session picker embed stays interactive indefinitely, or the interaction times out before the user selects.
**Why it happens:** Discord interactions must be responded to within 3 seconds (already handled via `deferReply`), and component interactions time out after 15 minutes by default.
**How to avoid:** Use `awaitMessageComponent` with a reasonable timeout (e.g., 60 seconds), then edit the message to remove the select menu. This pattern is already established in `permission-handler.ts`.
**Warning signs:** Stale select menus that error when clicked.

## Code Examples

### Example 1: Spawning a New Session with Thread
```typescript
// Source: Derived from existing BridgeRouter.handleMessage() + ClaudeSession.spawn()
async createSession(channel: TextChannel): Promise<ManagedSession> {
  const thread = await channel.threads.create({
    name: "New Claude Session",
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    reason: "Claude session",
  });

  const session = new ClaudeSession({
    cwd: this.cwd,
    ipcPort: config.ipcPort,
    dangerouslySkipPermissions: config.dangerouslySkipPermissions,
  });
  session.spawn();

  const managed: ManagedSession = {
    id: crypto.randomUUID(),
    claudeSession: session,
    threadId: thread.id,
    threadUrl: thread.url,
    startedAt: new Date(),
    messageCount: 0,
    lastActivityAt: new Date(),
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    isProcessing: false,
  };

  this.sessions.set(thread.id, managed);
  return managed;
}
```

### Example 2: Accumulating Cost from ResultEvent
```typescript
// Source: Derived from existing ClaudeSession.sendMessage() result handling
// In the message routing loop:
if (event.type === "result") {
  const result = event as ResultEvent;
  if (result.total_cost_usd !== undefined) {
    managed.totalCostUsd = result.total_cost_usd; // total_cost_usd is cumulative per process
  }
  if (result.usage) {
    managed.totalInputTokens += result.usage.input_tokens;
    managed.totalOutputTokens += result.usage.output_tokens;
  }
}
```

**Important:** `total_cost_usd` from the `ResultEvent` is the cumulative cost for the entire CLI process lifetime (all turns), not just the current turn. So assign, don't add. Token counts in `usage` are per-turn, so those should be accumulated.

### Example 3: Bot Presence Update
```typescript
// Source: discord.js v14 API -- PresenceUpdateStatus and ActivityType
import { PresenceUpdateStatus, ActivityType } from "discord.js";

// Call after session state changes (create, destroy, processing start/end)
client.user?.setPresence({
  status: PresenceUpdateStatus.DoNotDisturb,
  activities: [{
    name: "Working...",
    type: ActivityType.Playing,
  }],
});
```

### Example 4: /new with Active Session Warning
```typescript
// Source: Pattern from existing permission-handler.ts button interaction
import { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } from "discord.js";

// In /new command handler:
const activeSessions = sessionManager.getAllSessions();
if (activeSessions.length > 0) {
  const embed = new EmbedBuilder()
    .setTitle("Active Session Warning")
    .setDescription(
      `You have ${activeSessions.length} active session(s). Start a new one anyway?`
    )
    .setColor(0xffa500);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("new_confirm")
      .setLabel("Start New Session")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("new_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

  const reply = await interaction.editReply({
    embeds: [embed],
    components: [buttons],
  });

  // await button interaction...
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-invocation CLI (`claude -p "msg"`) | Persistent stream-json process | Phase 1-2 (2026-02-12) | Session context maintained across messages without --continue/--resume |
| Single global session | Multi-session with thread mapping | Phase 3 (this phase) | Multiple concurrent conversations in different threads |
| Plain text /status response | Rich embed with fields | Phase 3 (this phase) | Structured display of session info, costs, tokens |

**Note on `--resume`:** The Claude CLI supports `--resume <session_id>` which reloads conversation history from JSONL files stored in `~/.claude/projects/`. This is powerful for cross-process session recovery. However, the user decided sessions are in-memory only for this phase. If a Claude process dies mid-session, the correct behavior is to notify the user and ask whether to start fresh or abort -- not to silently resume. The `--resume` mechanism could be added later as an enhancement.

## Discretion Recommendations

### Session History Log
**Recommendation: Do NOT keep a persistent history log.**
Rationale: Sessions are in-memory only (user decision). Adding a history log implies persistence that doesn't exist. The `SessionManager`'s in-memory map already tracks all needed metadata. A `/status` command can show all current sessions. When the bot restarts, the log would be empty anyway, which is confusing. Keep it simple -- the in-memory `ManagedSession` objects are the history.

### Cumulative Cost Tracking
**Recommendation: Per-session only, with a total displayed in `/status`.**
Rationale: Since sessions are in-memory only, cumulative tracking across bot restarts is impossible without persistence (out of scope). Per-session cost is already available via `ResultEvent.total_cost_usd`. The `/status` embed can show a total across all currently-active sessions. This is the simplest approach that delivers value.

### Bot Presence State Mapping
**Recommendation:**
| State | Discord Status | Activity |
|-------|---------------|----------|
| No sessions | `Online` (green) | `Watching "Ready"` |
| Sessions active, all idle | `Idle` (yellow) | `Watching "N sessions active"` |
| Any session processing | `DoNotDisturb` (red) | `Playing "Working..."` |

Rationale: Green/yellow/red maps intuitively to ready/waiting/busy. `DoNotDisturb` (red dot) clearly signals "Claude is working, don't panic if it's slow." `Idle` (yellow) for "sessions exist but nothing is processing" helps the user know sessions are still alive. `Online` (green) for "ready for a new session" is the natural default.

### Session Picker UX for /stop
**Recommendation: Use StringSelectMenuBuilder (select menu).**
Rationale: Select menus support up to 25 options (more than enough for concurrent sessions), provide a compact dropdown UX, and are already implemented in the codebase (`question-prompt.ts`). Buttons are limited to 5 per action row and would require multiple rows for many sessions. When only 1 session is active, skip the picker and stop it directly.

## Open Questions

1. **IPC Port Strategy for Multi-Session**
   - What we know: The current architecture uses a single IPC server on port 9824. All Claude processes connect to it for permission forwarding.
   - What's unclear: When multiple Claude processes send permission requests through the same port, how does the IPC server know which thread to route each request to? The current `BridgeRouter` uses `this.activeThread` which is a single reference.
   - Recommendation: The simplest approach is to keep the single IPC server but add session-aware routing. When a `ClaudeSession` sends a user message, store a mapping of "expected next permission request -> this thread." Since sessions process messages sequentially (one at a time per session), the most recently-active session owns the next permission request. Alternatively, each session could use its own IPC port, but that adds port management complexity. A third option: embed the thread ID in the MCP config environment variables so the permission server includes it in the request payload.

2. **Message Handling in Main Channel vs Threads**
   - What we know: Currently, messages in the main channel create threads and route to Claude. The user decided `/new` auto-creates a thread.
   - What's unclear: Should plain messages in the main channel still work (implicitly creating a new session), or should users always use `/new`?
   - Recommendation: Keep the current behavior where main channel messages create sessions (backward compatibility), but also add the `/new` command for explicit session creation. This avoids breaking the existing UX while adding the new commands.

3. **Thread Naming for /new**
   - What we know: Currently, thread names use the first 95 chars of the user's message. `/new` creates a thread before any message is sent.
   - What's unclear: What should the thread name be for `/new`?
   - Recommendation: Use a timestamp-based default name like "Claude Session - Feb 15, 5:30 PM" that can be renamed later by the first message or by the user.

## Sources

### Primary (HIGH confidence)
- Claude CLI `--help` output (v2.1.42) -- verified all flags: `--continue`, `--resume`, `--session-id`, `--fork-session`, `--no-session-persistence`, `--input-format stream-json`
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) -- official documentation on all CLI flags and session management
- [Claude Code Headless Mode](https://code.claude.com/docs/en/headless) -- official docs on stream-json, continue, resume in print mode
- [Agent SDK Session Management](https://platform.claude.com/docs/en/agent-sdk/sessions) -- official TypeScript SDK docs on session resume, fork, session_id capture
- discord.js v14 type definitions (installed in node_modules) -- verified `PresenceUpdateStatus` enum: Online, DoNotDisturb, Idle, Invisible, Offline
- discord.js v14 type definitions -- verified `ActivityType` enum: Playing (0), Streaming (1), Listening (2), Watching (3), Custom (4), Competing (5)
- Existing codebase (`src/`) -- all code patterns verified against current implementation

### Secondary (MEDIUM confidence)
- [discord.js FAQ guide](https://discordjs.guide/popular-topics/faq) -- presence API usage examples (setPresence, setStatus, setActivity)
- [Claude Code session storage](https://github.com/anthropics/claude-code/issues/23948) -- confirmed JSONL session files in `~/.claude/projects/`

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries needed, all APIs verified in installed node_modules
- Architecture: HIGH -- patterns derived directly from existing codebase; multi-session is a well-understood refactoring
- Pitfalls: HIGH -- IPC port conflict and thread routing identified from code inspection; thread archive behavior verified in discord.js docs
- Cost tracking: HIGH -- `ResultEvent.total_cost_usd` and `usage` fields verified in existing `types.ts`
- Bot presence: HIGH -- `PresenceUpdateStatus` and `ActivityType` verified in installed discord-api-types

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (stable domain -- discord.js v14 and Claude CLI are mature)
