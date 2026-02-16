# Phase 3: Session Persistence - Context

**Gathered:** 2026-02-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Session lifecycle management for the Discord-Claude bridge. Users can start new sessions, continue previous conversations, stop active sessions, and see usage costs. Multiple concurrent sessions are supported. Sessions are in-memory only (do not survive bot restarts). Success criterion #1 from the roadmap ("resume after restart") is relaxed — persistence is within the bot's process lifetime only.

</domain>

<decisions>
## Implementation Decisions

### Resume experience
- `/continue` reuses the existing Discord thread (posts new messages into the same thread)
- If the previous Claude session can't be resumed (expired, crashed, context lost), notify the user and ask: start fresh or abort — don't silently restart
- On resume, post a status embed in the thread showing session info (session resumed, started time, messages so far, etc.)
- Sessions are in-memory only — lost on bot restart. Original roadmap criterion #1 is relaxed to match this simpler scope

### Session commands UX
- `/stop` kills the session immediately — no confirmation, even if Claude is mid-response. Show what was completed so far
- `/new` while a session is active: warn and confirm ("A session is active. Stop it and start a new one?" with buttons)
- `/status` command shows session state (active/inactive, session age, message count, thread link, cost info) AND bot presence indicator reflects session state (online/idle/dnd)
- `/new` auto-creates a thread immediately — don't wait for the first message

### Cost tracking display
- Cost info shown on demand only (via `/status`) — not after every message, not at session end automatically
- Display both token counts (input/output) AND estimated dollar cost
- Cost info embedded in the `/status` response alongside other session info

### Session management
- Multiple concurrent sessions supported (different threads)
- `/continue` resumes the most recent session. To resume a specific one, use that thread directly
- `/stop` shows a picker of active sessions to choose which to stop
- `/new` warns if sessions already active (per earlier decision)

### Claude's Discretion
- Whether to keep a lightweight session history log (start time, message count, cost, thread link) — weigh complexity vs value
- Cumulative cost tracking (all-time/daily totals) vs per-session only — pick based on implementation simplicity
- Bot presence state mapping (which Discord status maps to which session state)
- How to handle the session picker UX for `/stop` (select menu vs buttons)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-session-persistence*
*Context gathered: 2026-02-15*
