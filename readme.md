# Trace — Git for your recurring decisions

## Overview

Trace is a tool that treats your personal decisions the way git treats code changes — as first-class, revisitable objects with history, reasoning, and context.

Developers constantly re-research the same decisions: "Postgres or Mongo?", "Which auth provider?", "Should I use this library again?" — and lose track of what they concluded last time and why. Trace fixes that.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Thread** | A recurring decision topic (e.g., "Postgres vs Mongo") |
| **Working tree** | The live, pre-commit research state: question, options, constraints, open questions, and tentative direction |
| **Commit** | An automatic checkpoint: what you read, the current conclusion, and why; an actionable recommendation can resolve even when minor validation remains |
| **Branch** | A reopening in a different context that may diverge from the trunk's verdict |
| **Merge** | Reconciling two branches into one durable rule |
| **Outcome** | An after-action review attached to a resolved decision: worked, mixed, regretted, or superseded |
| **Diff** | What's different about the current context vs. the prior commit's context |
| **Comparison** | A source-backed option/criterion matrix maintained by Trace; unknowns stay explicit and user corrections are preserved |

## Target User

- **Primary:** Developers who live in browser + VS Code + terminal, hitting the same technical decisions across projects.
- **Secondary (post-v1):** Anyone doing recurring high-stakes research.

## Architecture

- **Runtime:** Trace service for the event-driven hot path + OpenClaw command jobs for recovery, reconciliation, and digest scheduling
- **Models:** GPT-5.6 Terra (low reasoning) for live routing, GPT-5.6 Sol (medium reasoning) for checkpoints/reconciliation, and `text-embedding-3-small` for retrieval
- **Storage:** SQLite (local-first)
- **UI:** Native menu bar app (SwiftUI) + localhost web dashboard
- **Developer integration:** Read-only local MCP server for Qoder and other compatible clients

### Agents

1. **Ingestion Agent** — Receives immediate Chrome navigation context from the Trace extension, watches Chrome/Safari history as a fallback, and watches optional screenshot folders. Approved Chrome research pages receive a visible-viewport screenshot without macOS Screen Recording access.
2. **Autonomous Router** — Enriches public pages, ignores ordinary browsing, retrieves relevant context, and chooses new thread / same branch / new branch without requiring approval
3. **Checkpoint Agent** — Updates the working tree immediately and writes an in-progress or resolved commit after 25 seconds of inactivity (or sooner when the research reaches a conclusion). Actionable defaults resolve when remaining questions are only validation or refinement.
4. **Resurfacing Agent** — Detects reopens, generates diffs, pushes nudges

Routing and checkpoints operate on branch-owned source items. A closed thread continues on the same branch when its context is unchanged; Trace forks only when the goal or constraints materially differ. Every checkpoint immediately checks whether compatible branch conclusions can merge at 95%+ confidence; the 15-minute OpenClaw reconciliation job is only a safety net.

## UI Experience

1. **Decisions** — The complete decision index is available from the top tab; opening a decision shows its canonical canvas research story. The canvas uses an automatic left-to-right layout with pan/zoom, temporary node dragging, context branches, checkpoints, current answer, screenshots, a live comparison, “You left off here,” and an outcome review after resolution.
2. **Search** — Searches decision titles, verdicts, reasoning, and evidence, then opens the matching story directly.
3. **Activity drawer** — Grouped checkpoints, resolved verdicts, revisits, nudges, and digests; it is an audit trail rather than a staging queue.
4. **System drawer** — Live working trees, capture health/failure reasons, routing rationales, retryable errors, and recent automation. Automatic reconciliation is named explicitly; the decision workspace exposes reconciliation only as a **Manual override**.

Selecting a map node expands its detail inside the canvas and reflows surrounding paths using the expanded dimensions, preventing cards from overlapping. Overview zoom keeps the story compact; reading zoom reveals summaries and screenshots without repeatedly toggling near the zoom boundary. **Resume Research** shows the next unresolved question and reopens up to three validated pages through the Chrome extension.

## Non-Goals (v1)

- Not a general note-taking or bookmarking app
- Not a chatbot — the agent acts from local browser/screenshot events
- Single-user only (no team features)
- No direct IDE-content or Obsidian ingestion; the Qoder MCP surface is read-only retrieval
- No mobile

## Key Files

- [AGENTS.md](./AGENTS.md) — Agent coding guidelines and project context
- [PRD](./prd.md) — Full product requirements document
- [Implementation Log](./implementation.md) — Latest implementation progress and decisions
- [Hackathon Demo Script](./demo-script.md) — Timed 2:45 video plan with screen actions and voiceover

## MVP Timeline (4 weeks)

| Week | Focus |
|------|-------|
| 1 | Spec + ingestion pipeline (screenshot watcher, OCR, browser history, data model) |
| 2 | Clustering + synthesis agents, manual correction flow |
| 3 | Resurfacing, diff generation, dashboard UI |
| 4 | Menu bar app, polish, demo prep |

## Prerequisites

- macOS 13+ (Ventura or later)
- Node.js 22+ (`node --version`)
- pnpm (`npm install -g pnpm`)
- OpenClaw (`npm install -g openclaw@latest`) — for scheduled agent jobs
- Xcode 15+ / Swift 5.9+ — for the menu bar app (optional)

## Setup

1. **Install dependencies:**
   ```bash
   cd ~/Desktop/Trace
   pnpm install
   ```

2. **Configure your API key:**
   Edit `.env` at the project root and set your OpenAI API key:
   ```
   OPENAI_API_KEY=sk-your-key-here
   ```

3. **Create runtime directory:**
   ```bash
   mkdir -p ~/.trace
   cp trace.config.json ~/.trace/config.json
   ```

4. **Install OpenClaw skills and declare scheduled jobs (optional):**
   ```bash
   cp -r skills/trace-* ~/.openclaw/workspace/skills/
   ./scripts/setup-cron.sh
   ```

## Running

### Quick Start
```bash
./scripts/start.sh
```
This builds the dashboard and native menu app, serves the API and dashboard at `http://127.0.0.1:3333`, starts ingestion, registers the Chrome native-messaging bridge, launches the menu app, and ensures OpenClaw is available. Press Ctrl+C to stop, or use a separate terminal:

```bash
./scripts/stop.sh
```

`stop.sh` and Ctrl+C perform a full shutdown: they stop the native menu app and Trace service, remove the Chrome bridge token and registration, stop OpenClaw, and uninstall its LaunchAgent so it cannot restart at login. The next `start.sh` reinstalls the local services when needed.

Automatic Chrome screenshots require one one-time extension install. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `browser-extension/` in this repository. Chrome shows broad page access because automatic `captureVisibleTab` cannot use the click-only `activeTab` permission. Incognito is disabled, and localhost, internal, login, payment, mail, banking, and health pages are excluded before any known-page or manual priority is considered. After installation, normal use is still only `./scripts/start.sh`; turn **Automatic browser screenshots** on or off from the Trace menu. No macOS Screen Recording permission is needed.

The extension waits two seconds after a completed navigation, sends bounded title/URL/visible text to the local service, and captures only after Trace approves the candidate and verifies the same tab is still active. It records the visible viewport—the state you actually saw—then creates a full JPEG, thumbnail, and visual hash locally. Screenshot pixels and page context may be sent to your configured OpenAI model as part of autonomous routing.

Capture limits are conservative: ordinary pages use a 10-second soft interval, while explicit research and manual captures receive priority; all pages still respect six per minute, 120 per hour, 500 per day, and a normalized-URL cooldown. Obvious feed/Shorts noise is routed without consuming screenshot capacity. Near-duplicates retain a fresh thumbnail and OCR context without storing another full image. Full images remain until storage exceeds 1 GB, at which point the oldest unpinned files are evicted; thumbnails remain with the evidence. Assets live under `~/.trace/assets/screenshots/` with user-only permissions. Disabling the toggle immediately stops new captures without affecting normal browser-history routing.

Captured thumbnails appear directly on research nodes and in their in-map evidence view. Click a thumbnail to inspect the full image. The current uncommitted node is marked **You left off here**; capture connection and failure details live in the System drawer.

On the first run, browser-history fallback records the current Chrome/Safari position as its baseline instead of importing an old backlog. The Chrome extension creates or deduplicates a source immediately; history database changes still trigger safe snapshot reads after a 1.5-second debounce, with a two-minute missed-event fallback. A conservative local filter discards obvious dashboard/feed/inbox/Shorts noise, then Trace routes the remaining evidence and pushes the result over server-sent events. Normal routing targets 10 seconds and has a 25-second service deadline envelope; remote API or network failures become visible retryable errors.

The live router is fully automatic. It records every decision and rationale in `automation_actions`; isolated actions can be undone from the System drawer. Processing is capped at two concurrent AI routes. A failed route retries in-process after about 20 seconds and stops after three attempts, while the five-minute OpenClaw recovery job remains a disaster-recovery path. Within a 30-minute research session, normalized repeat URLs are filed once. High-similarity questions with the same semantic anchor reuse an existing single-branch decision, and compatible comparison claims no longer become false conflicts. Schema-v7 migration creates a consistent pre-migration SQLite backup, adds outcome records and reconciliation origin, and retains the behavior of labeling old unprocessed rows `legacy_unresolved` instead of replaying them.

### Qoder MCP integration

Trace includes a project-scoped, read-only STDIO MCP server configured in `.mcp.json`. Build Trace once, then restart Qoder or run `/mcp reload`:

```bash
pnpm build
qodercli mcp list
```

Qoder discovers `search_decisions`, `get_decision_trace`, `get_current_answer`, `get_relevant_constraints`, and `get_prior_regrets`. The process opens the same local SQLite database in read-only mode and exits when Qoder closes the STDIO connection; it does not require the Trace web service to be running. A useful Agent Mode prompt is: “Before choosing this database, search my prior Trace decisions and check whether this project's constraints require a different branch.”

`browserHistoryDebounceMs` controls event coalescing, while `browserHistoryPollIntervalMs` controls only the fallback heartbeat. The defaults are 1,500 ms and 120,000 ms respectively.

### Individual Services

**API Server + Watchers (development):**
```bash
pnpm dev:service
```
Runs on `http://127.0.0.1:3333`

**Dashboard (dev mode):**
```bash
pnpm dev:dashboard
```
Opens on `http://127.0.0.1:5173`; production uses the bundled dashboard on port 3333.

**Menu Bar App (normally launched by `start.sh`):**
```bash
cd menubar/Trace
swift build
swift run
```

### Production Build

```bash
pnpm build:dashboard    # Builds dashboard to packages/dashboard/dist/
pnpm build              # Builds core, service, and bundled dashboard
pnpm build:menubar      # Compiles the Swift menu bar app
```

### OpenClaw Daemon

OpenClaw runs as a background daemon (LaunchAgent). Manage it with:

```bash
openclaw daemon status     # Check if it's running
openclaw daemon stop       # Stop the daemon (do this when not testing)
openclaw daemon start      # Start it again when needed
openclaw daemon restart    # Restart after config changes
```

The declared jobs run tested local commands rather than free-form agent messages:

| Job | Schedule |
|---|---|
| `trace-recovery` | Every 5 minutes |
| `trace-reconciliation` | Every 15 minutes |
| `trace-weekly-digest` | Monday 09:00 Asia/Singapore |

They load the project `.env`, prevent overlapping runs, return JSON statistics, and do not require a chat delivery channel. The Trace service—not OpenClaw cron—owns 20-second routing retries, 25-second quiet checkpoints, and immediate post-checkpoint reconciliation. OpenClaw retains the five-minute and 15-minute jobs as safety nets; the digest intentionally remains weekly. Run recovery or reconciliation manually with `pnpm --filter @trace/service cli recover` or `pnpm --filter @trace/service cli reconcile`.

OpenClaw is only required for automatic schedules; the Trace UI and ingestion service can otherwise run independently.

---

## Testing

```bash
pnpm test              # Run all JavaScript/TypeScript tests once
pnpm lint              # ESLint
pnpm build             # Clean TypeScript and dashboard build
cd menubar/Trace && swift test
```

### Manual Testing with Seed Data

**Warning:** the seed script replaces `~/.trace/trace.sqlite`. Use it only when you intentionally want to discard the current local database, or after making a backup.

Seed the database with realistic test data to explore the full UI:

```bash
./scripts/seed-test.sh              # Seed only
./scripts/seed-test.sh --start      # Seed and start the app
```

This creates:
- A reopened thread (Postgres vs Mongo — previously decided, now revisited for a different context)
- An open thread with multiple research items (Auth provider comparison)
- A newly opened thread (Zustand vs Jotai)
- Live source items and working states (visible in Live Trace)
- Feed events: commit closed, reopen with diff, weekly digest, and synthesis nudge

Then open `http://127.0.0.1:3333` to browse the dashboard with real data.

### Existing Data Migration

`pnpm migrate:legacy` migrates an older pre-Trace database only when the Trace database is empty. It creates timestamped backups under `~/.trace/backups/` and aborts without changing either database when both contain data.

## Project Structure

```
packages/
├── core/              # Shared: data model, DB, AI client, agents
├── service/           # API server (Fastify) + ingestion watchers
└── dashboard/         # React web UI (Vite + Tailwind)
skills/                # OpenClaw skill definitions
menubar/Trace/       # Native SwiftUI menu bar app
scripts/               # Setup and start scripts
```
