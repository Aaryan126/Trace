# Implementation Log — Brainch

This file tracks the latest implementation progress, decisions made, and technical notes. Agents should update this file as code is written and milestones are reached.

---

## Current Status

**Phase:** Implementation complete — all phases done
**Last Updated:** 2026-08-03

---

## Milestones

### Week 1 — Spec + Ingestion Pipeline

| Task | Status | Notes |
|------|--------|-------|
| OpenClaw skill scaffold | Done | |
| Screenshot watcher + OCR (GPT-5.4 vision) | Done | |
| Browser history reader (Chrome/Safari) | Done | |
| Data model + SQLite storage | Done | |

### Week 2 — Clustering + Synthesis Agents

| Task | Status | Notes |
|------|--------|-------|
| Thread assignment / clustering logic | Done | |
| Commit synthesis on session-close | Done | |
| Manual correction flow (Capture view input) | Done | |

### Week 3 — Resurfacing + UI

| Task | Status | Notes |
|------|--------|-------|
| Reopen detection | Done | |
| Diff generation | Done | |
| Heartbeat digest job | Done | |
| Dashboard: Thread view (branch/tree viz) | Done | |
| Dashboard: All-threads list | Done | |
| Dashboard: Capture view | Done | |

### Week 4 — Menu Bar App, Polish, Demo

| Task | Status | Notes |
|------|--------|-------|
| Native menu bar app (SwiftUI) | Done | |
| Nudge wiring | Done | |
| End-to-end demo script | Done | |
| Bug fixing & polish | Done | |

---

## Technical Decisions Log

Record key implementation decisions here as they are made.

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-26 | pnpm monorepo scaffold | Switched from npm to pnpm for faster installs, stricter linking, and reliable workspace resolution. better-sqlite3 native build approved. |
| 2026-07-26 | pnpm workspaces, Vitest, Fastify, Tailwind 4, SPM for menu bar app | Final tech stack confirmed: pnpm workspaces for monorepo management, Vitest for testing, Fastify for the service layer, Tailwind CSS 4 for the dashboard, and Swift Package Manager (SPM) for the native menu bar app. |
| 2026-08-03 | Unified start/stop scripts | Added `scripts/stop.sh` and rewrote `scripts/start.sh` to manage all components (OpenClaw daemon, API server, Dashboard) with PID files for external stop support. |

---

## Data Model (from PRD)

```
Thread
 - id, title, tags, status (open/closed), created_at

Branch
 - id, thread_id, parent_commit_id (null = trunk), context_label

Commit
 - id, branch_id, verdict_summary, reasoning, source_item_ids[], created_at, regret: bool, regret_note?

SourceItem
 - id, type (screenshot | browser_history), raw_text, extracted_entities, url?, captured_at

MergeEvent
 - id, thread_id, source_branch_ids[], resulting_commit_id, resolved_rule
```

---

## Implementation Notes

### 2026-07-26 — Monorepo Scaffold
- Created pnpm workspace with three packages: `@brainch/core`, `@brainch/service`, `@brainch/dashboard`.
- Root dev tooling: TypeScript 5.x (strict, NodeNext), Vitest, ESLint 9 (flat config), Prettier.
- Core: better-sqlite3, openai, uuid.
- Service: fastify, @fastify/cors, chokidar, workspace link to @brainch/core.
- Dashboard: React 19, React Router 7, Vite 6, Tailwind CSS 4 (via @tailwindcss/vite).
- Skills directory: ingestion, clustering, synthesis, resurfacing (all placeholder).
- All three placeholder tests pass via `pnpm test`.

### 2026-08-03 — Unified Start/Stop Scripts
- Rewrote `scripts/start.sh` to manage OpenClaw daemon, API server, and dashboard in one command.
- Created `scripts/stop.sh` for stopping all services from a separate terminal using PID files.
- Added `.brainch-*.pid` to `.gitignore`.
- Updated `readme.md` Quick Start section to reference the stop script.

### 2026-08-03 — Fix Ctrl+C Not Stopping OpenClaw Daemon
- Root cause: `trap cleanup EXIT` alone doesn't reliably fire on SIGINT in all bash versions when `wait` is active.
- Fix: added `trap 'exit 130' INT TERM` so SIGINT/SIGTERM explicitly triggers exit, which then fires the EXIT trap.
- Added `set +e` inside cleanup to prevent `set -e` from aborting cleanup mid-way.
- Replaced silent `openclaw daemon stop 2>/dev/null || true` with verbose stop + LaunchAgent fallback (`launchctl unload ~/Library/LaunchAgents/ai.openclaw.gateway.plist`).
- Added 1-second sleep before daemon stop to let child processes terminate first.
- Applied same robust stop logic to `scripts/stop.sh`.

---

## How to Update This File

When completing implementation work:
1. Update the relevant task row's **Status** column (Not Started → In Progress → Done).
2. Add any key decisions to the **Technical Decisions Log**.
3. Add detailed notes under **Implementation Notes** if warranted.
4. Update the **Last Updated** date at the top.
