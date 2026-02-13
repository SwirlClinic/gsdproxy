# Roadmap: GSD Proxy

## Overview

GSD Proxy delivers full bidirectional Claude Code access from Discord in three phases. Phase 1 proves the connection works end-to-end (bot starts, message goes to Claude via CLI spawning, formatted response comes back). Phase 2 adds the defining proxy capabilities -- permission forwarding with interactive buttons, thread-based output organization, and real-time streaming. Phase 3 completes the experience with session persistence, resume support, and cost visibility.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Bot + Claude Connection** - Discord bot that sends messages to Claude and displays formatted responses
- [ ] **Phase 2: Interactive Proxy** - Permission forwarding, thread output, and real-time streaming
- [ ] **Phase 3: Session Persistence** - Session resume, continuation, and cost tracking

## Phase Details

### Phase 1: Bot + Claude Connection
**Goal**: User can start the bot, send a message to Claude from Discord, and see a properly formatted response
**Depends on**: Nothing (first phase)
**Requirements**: BOTF-01, BOTF-02, BOTF-03, BOTF-04, BOTF-05, BOTF-06, CLDI-01, CLDI-02, CLDI-03, OUTD-01
**Success Criteria** (what must be TRUE):
  1. User can start the bot from the command line and see it come online in Discord
  2. User can type a message in Discord and receive Claude's response with proper markdown and code block formatting
  3. A non-owner Discord user who tries to interact with the bot gets rejected
  4. Long responses are split at natural boundaries (paragraph, code block) without breaking formatting
  5. Bot stops gracefully when terminated, without orphaned processes
**Plans:** 3 plans

Plans:
- [x] 01-01-PLAN.md -- Project scaffold, Discord client, slash commands, and owner-only access control
- [x] 01-02-PLAN.md -- TDD: Discord message formatter (splitMessage + formatToolActivity)
- [x] 01-03-PLAN.md -- Claude CLI integration, bridge router, and end-to-end wiring

### Phase 2: Interactive Proxy
**Goal**: User can approve/deny Claude's tool requests via Discord buttons, see streaming output in real-time, and get organized thread-based output
**Depends on**: Phase 1
**Requirements**: PERM-01, PERM-02, PERM-03, PERM-04, PERM-05, OUTD-02, OUTD-03, OUTD-04, CLDI-04, CLDI-05
**Success Criteria** (what must be TRUE):
  1. When Claude needs tool permission, user sees a button prompt in Discord and can approve or deny with one click
  2. Unanswered permission prompts auto-deny after 5 minutes with a notification
  3. When Claude asks a clarifying question, user sees selectable options rendered as Discord buttons or select menus
  4. User can watch Claude's response stream in real-time via in-place message edits, with tool activity indicators showing what Claude is doing
  5. Each session creates a thread with full details while the main channel gets a concise summary
**Plans:** 4 plans

Plans:
- [ ] 02-01-PLAN.md -- MCP permission server + IPC bridge infrastructure
- [ ] 02-02-PLAN.md -- Discord interactive components + permission handler
- [ ] 02-03-PLAN.md -- Claude CLI MCP wiring + config
- [ ] 02-04-PLAN.md -- Thread output, streaming, router integration, and end-to-end verification

### Phase 3: Session Persistence
**Goal**: User can resume sessions across bot restarts, continue previous conversations, and track costs
**Depends on**: Phase 2
**Requirements**: SESN-01, SESN-02, SESN-03, SESN-04, CLDI-06, OUTD-05
**Success Criteria** (what must be TRUE):
  1. User can restart the bot and resume a previous session without losing context
  2. User can run `/continue` to pick up the last conversation where it left off
  3. User can run `/new` to start a fresh session and `/stop` to abort an active one
  4. User can see token usage and estimated cost after each session completes
**Plans**: TBD

Plans:
- [ ] 03-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Bot + Claude Connection | 3/3 | Complete | 2026-02-12 |
| 2. Interactive Proxy | 0/4 | Not started | - |
| 3. Session Persistence | 0/TBD | Not started | - |
