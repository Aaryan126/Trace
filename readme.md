# Brainch — Git for your recurring decisions

## Overview

Brainch is a tool that treats your personal decisions the way git treats code changes — as first-class, revisitable objects with history, reasoning, and context.

Developers constantly re-research the same decisions: "Postgres or Mongo?", "Which auth provider?", "Should I use this library again?" — and lose track of what they concluded last time and why. Brainch fixes that.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Thread** | A recurring decision topic (e.g., "Postgres vs Mongo") |
| **Commit** | A closed research session: what you read, what you concluded, and why |
| **Branch** | A reopening in a different context that may diverge from the trunk's verdict |
| **Merge** | Reconciling two branches into one durable rule |
| **Regret Marker** | A retroactive tag when a verdict didn't hold up |
| **Diff** | What's different about the current context vs. the prior commit's context |

## Target User

- **Primary:** Developers who live in browser + VS Code + terminal, hitting the same technical decisions across projects.
- **Secondary (post-v1):** Anyone doing recurring high-stakes research.

## Architecture

- **Runtime:** OpenClaw daemon (self-hosted, Mac background process)
- **Model:** GPT-5.4 via OpenAI API
- **Storage:** SQLite (local-first)
- **UI:** Native menu bar app (SwiftUI) + localhost web dashboard

### Agents

1. **Ingestion Agent** — Watches screenshots (OCR via GPT-5.4 vision) + reads browser history
2. **Clustering / Curation Agent** — Assigns items to threads, detects new vs. existing threads
3. **Synthesis Agent** — Closes research sessions into commits when threads go quiet
4. **Resurfacing Agent** — Detects reopens, generates diffs, pushes nudges

## UI Screens

1. **Home / Feed** — Reverse-chronological agent-generated cards
2. **Thread View** — Git-log-style branch/tree visualization (core screen)
3. **Capture View** — Real-time "here's what I think you're researching" with correction controls
4. **All Threads** — Filterable/searchable list with optional graph overlay

## Non-Goals (v1)

- Not a general note-taking or bookmarking app
- Not a chatbot — the agent acts on a schedule
- Single-user only (no team features)
- No native VS Code / Obsidian ingestion (screenshots only)
- No mobile

## Key Files

- [AGENTS.md](./AGENTS.md) — Agent coding guidelines and project context
- [PRD](./prd.md) — Full product requirements document
- [Implementation Log](./implementation.md) — Latest implementation progress and decisions

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
   mkdir -p ~/.brainch
   cp brainch.config.json ~/.brainch/config.json
   ```

4. **Install OpenClaw skills (optional, for scheduled agents):**
   ```bash
   cp -r skills/brainch-* ~/.openclaw/workspace/skills/
   bash scripts/setup-cron.sh
   ```

## Running

### Quick Start (both services)
```bash
./scripts/start.sh
```
This starts the API server (port 3333), dashboard (port 5173), and OpenClaw daemon.
Press Ctrl+C to stop everything, or use a separate terminal:

```bash
./scripts/stop.sh          # Stops all services from another terminal
```

### Individual Services

**API Server + Watchers:**
```bash
pnpm dev:service
```
Runs on `http://127.0.0.1:3333`

**Dashboard (dev mode):**
```bash
pnpm dev:dashboard
```
Opens on `http://127.0.0.1:5173`

**Menu Bar App:**
```bash
cd menubar/Brainch
swift build
swift run
```

### Production Build

```bash
pnpm build:dashboard    # Builds dashboard to packages/dashboard/dist/
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

**When to run it:** Only needed when you want the scheduled Brainch agents (clustering, synthesis, resurfacing) to run automatically on their cron schedules. If you're just using the dashboard and API server manually, the daemon isn't required.

**After testing:** Stop the daemon to save resources:
```bash
openclaw daemon stop
```

**To fully disable auto-start on login:**
```bash
launchctl unload ~/Library/LaunchAgents/com.openclaw.gateway.plist
```

To re-enable:
```bash
launchctl load ~/Library/LaunchAgents/com.openclaw.gateway.plist
```

---

## Testing

```bash
pnpm test              # Run all tests (143 tests across all packages)
```

### Manual Testing with Seed Data

Seed the database with realistic test data to explore the full UI:

```bash
./scripts/seed-test.sh              # Seed only
./scripts/seed-test.sh --start      # Seed and start the app
```

This creates:
- A reopened thread (Postgres vs Mongo — previously decided, now revisited for a different context)
- An open thread with multiple research items (Auth provider comparison)
- A newly opened thread (Zustand vs Jotai)
- Unprocessed items awaiting clustering (visible in Capture View)
- Feed events: commit closed, reopen with diff, weekly digest, and synthesis nudge

Then open `http://127.0.0.1:5173` to browse the dashboard with real data.

## Project Structure

```
packages/
├── core/              # Shared: data model, DB, AI client, agents
├── service/           # API server (Fastify) + ingestion watchers
└── dashboard/         # React web UI (Vite + Tailwind)
skills/                # OpenClaw skill definitions
menubar/Brainch/       # Native SwiftUI menu bar app
scripts/               # Setup and start scripts
```
