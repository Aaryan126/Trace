# Implementation Log — Trace

This file tracks the latest implementation progress, decisions made, and technical notes. Agents should update this file as code is written and milestones are reached.

---

## Current Status

**Phase:** Autonomous Trace v4 implemented — canvas-first research stories, source-backed comparisons, resumable sessions, Chrome visual capture, checkpoints, audit, and recovery scheduling
**Last Updated:** 2026-08-04

---

## Milestones

### Week 1 — Spec + Ingestion Pipeline

| Task | Status | Notes |
|------|--------|-------|
| OpenClaw skill scaffold | Done | |
| Screenshot watcher + OCR | Done | Waits for completed writes, drains in-flight work on shutdown, uses correct MIME types, and hands new items to the autonomous coordinator |
| Browser history reader (Chrome/Safari) | Done | First-run baseline prevents backlog imports; debounced main/WAL/SHM file events trigger snapshots with a two-minute fallback poll |
| Data model + SQLite storage | Done | Schema v6 migration, consistent pre-migration backup, working states, comparison snapshots/overrides, embeddings, audit actions, checkpoint kinds, and conservative legacy handling |

### Week 2 — Clustering + Synthesis Agents

| Task | Status | Notes |
|------|--------|-------|
| Autonomous routing | Done | Strict `ignore/new_thread/continue_branch/new_branch` output, public-page enrichment, hybrid retrieval, deterministic application, and visible errors |
| Live working tree + checkpoints | Done | Working state is visible immediately; Sol writes in-progress/resolved commits after 25 seconds quiet or semantic completion, then immediately reconciles branches |
| Audit, retry, and undo | Done | Every automation action records rationale/context/latency; failed routes retry after about 20 seconds; isolated routing actions support dependency-safe undo |

### Week 3 — Resurfacing + UI

| Task | Status | Notes |
|------|--------|-------|
| Reopen detection | Done | |
| Diff generation | Done | |
| Heartbeat digest job | Done | |
| Dashboard: Decision workspace | Done | Light-first interactive research canvas with deterministic left-to-right layout, semantic zoom, screenshots, current answer, source-backed comparison, and Resume Research |
| Dashboard: All-threads list | Done | Repository layout sorted by real evidence activity |
| Dashboard: Activity + Live Trace drawers | Done | Audit events and live pipeline/capture health moved into contextual drawers; neither is an approval gate |

### Week 4 — Menu Bar App, Polish, Demo

| Task | Status | Notes |
|------|--------|-------|
| Native menu bar app (SwiftUI) | Done | Controls the service-owned Chrome screenshot policy and reports extension status without requesting Screen Recording access |
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
| 2026-08-03 | Rename product to Trace | Renamed product copy, package identifiers, runtime paths, environment variables, OpenClaw skills, and the Swift package consistently; stopped tracking generated Swift build artifacts. |
| 2026-08-03 | OpenClaw uses deterministic command jobs | Scheduled jobs execute the tested Trace CLI with declaration keys and no delivery channel, instead of asking an agent to infer commands. |
| 2026-08-03 | Explicit full shutdown lifecycle | Following user clarification, `stop.sh` and Ctrl+C stop Trace and uninstall OpenClaw's LaunchAgent; the next start reinstalls it. The API and built dashboard share port 3333. |
| 2026-08-03 | Canonical camelCase client API | Fastify composes typed DTOs shared with React; Swift decodes the same feed contract. SQLite models remain snake_case internally. |
| 2026-08-03 | Reopen evidence belongs to a branch | Closed-thread matches create an AI-labelled branch from the latest commit, preserving contextual divergence and branch-specific synthesis. |
| 2026-08-03 | Browser ingestion starts from a clean baseline | First startup records current browser-history watermarks rather than importing an arbitrary backlog; only later visits are ingested. |
| 2026-08-03 | Non-decisions are a first-class clustering result | The model can return `ignore`; only high-confidence ignores are automatic, while uncertain items remain in Review Queue. Browser auto-filing requires 90% confidence. |
| 2026-08-03 | Evidence time defines thread recency | Last Activity and recent/stale ordering use the latest source capture timestamp instead of the time clustering happened to create the thread. |
| 2026-08-03 | Dashboard mirrors the decision lifecycle | Activity, repository, staging area, and branch graph share explicit Capture → Curate → Commit → Revisit language and git-style visual conventions. |
| 2026-08-03 | Browser evidence targets a 10-second ingestion window | Reduced the history poll interval from five minutes to 10 seconds so the 10-second Review Queue refresh is backed by equally responsive ingestion. |
| 2026-08-03 | Browser ingestion is event-driven with a fallback heartbeat | Chrome/Safari main, WAL, and SHM changes are debounced for 1.5 seconds; a two-minute poll remains because macOS filesystem events are not a complete reliability boundary. |
| 2026-08-03 | Trace hot path is fully autonomous | Watcher events invoke an in-process coordinator; Live Trace is an audit/undo surface rather than required HITL. OpenClaw is retained for five-minute recovery, 15-minute reconciliation, and weekly digest scheduling. |
| 2026-08-03 | Two-speed GPT-5.6 pipeline | Terra with low reasoning performs latency-sensitive strict-schema routing; Sol with medium reasoning performs checkpoints and high-confidence branch reconciliation; embeddings provide semantic candidate retrieval. |
| 2026-08-03 | Working state precedes commits | Evidence updates a branch working tree immediately; commits are durable checkpoints after inactivity or an explicit semantic conclusion. |
| 2026-08-03 | Automation remains inspectable and reversible | Actions store model, confidence, rationale, snapshots, latency, and outcome. Undo is allowed only when no later action depends on the result. |
| 2026-08-04 | Fast service path with scheduled safety nets | Failed routes retry in-process after 20 seconds, quiet checkpoints reset to 25 seconds on each new item, and checkpoints immediately queue thread reconciliation. OpenClaw's five-minute recovery and 15-minute reconciliation remain unchanged as safety nets; digest remains weekly. |
| 2026-08-04 | Native capture, service-owned policy | ScreenCaptureKit in the menu app owns macOS permission and pixels; the Node service matches fresh history events, applies safety/rate/retention policy, stores assets, and supplies image plus OCR context to autonomous routing. `start.sh` and `stop.sh` manage both processes with a private per-launch localhost token. |
| 2026-08-04 | Decision graph is canonical; Activity is condensed | Decisions opens by default. Screenshots stay attached to evidence, while Activity groups 30-minute same-branch checkpoint sessions without deleting commits from the graph. Full images use a 1 GB cap and retained thumbnails preserve long-term context. |
| 2026-08-04 | Native capture identity and leasing are stable | The packaged menu app uses an installed Apple Development identity when available, the lease endpoint is an uncached POST, and its 25-second processing deadline begins only after the app receives the job. macOS 26 uses `captureScreenshot`; macOS 14–15 retain `captureImage`. |
| 2026-08-04 | Chrome extension replaces ScreenCaptureKit for browser context | Manifest V3 `captureVisibleTab` records the exact visible research viewport after service approval. Chrome native messaging uses a fixed extension identity and per-launch token; start/stop register and remove the bridge. History ingestion remains the fallback. |
| 2026-08-04 | Decision map is the single primary workspace | Removed persistent sidebar navigation, made the latest decision open by default, moved Activity and Live Trace into top tabs, introduced semantic light/dark tokens, and put screenshot thumbnails plus the current working point directly on the graph. |
| 2026-08-04 | Research canvas replaces the fixed SVG | React Flow owns accessible DOM nodes, viewport interaction, and temporary dragging; Dagre computes a deterministic left-to-right layout; Motion supplies restrained springs and reduced-motion fallbacks. Visual coordinates are never stored. |
| 2026-08-04 | Comparisons are AI-maintained and correction-safe | The router emits only explicit option/criterion claims with source IDs added locally. Working states carry the live matrix, commits snapshot it, and a separate override table ensures user corrections survive later AI updates. |
| 2026-08-04 | Resume Research reopens bounded context | Each decision derives the next unresolved question and up to three recent branch-relevant pages. The localhost dashboard asks the fixed Chrome extension to reopen validated HTTP/S URLs; the browser fallback opens one page when the extension is unavailable. |
| 2026-08-04 | Screenshot capacity favors research intent | Manual captures, already-filed decision pages, and explicit comparison/evaluation pages receive priority; obvious feed/Shorts noise is routed without spending screenshot capacity. Existing hourly/daily limits and local retention remain. |
| 2026-08-04 | Graph geometry is authoritative | Every canvas node has an explicit layout size and receives its own cloned Dagre label because Dagre mutates labels with coordinates; selected nodes reflow at their expanded size, semantic zoom uses hysteresis, and Motion no longer performs competing viewport-relative layout measurement inside React Flow. |

---

## Data Model (from PRD)

```
Thread
 - id, title, tags, status (open/closed), created_at

Branch
 - id, thread_id, parent_commit_id (null = trunk), context_label

Commit
 - id, branch_id, verdict_summary, reasoning, source_item_ids[], kind, resolution_status, comparison_json, created_at, regret: bool, regret_note?

SourceItem
 - id, type (screenshot | browser_history), raw_text, extracted_entities, url?, captured_at,
   thread_id?, branch_id?, content_text?, content_status, automation_status, attempts, clustering_confidence?, processed

BranchWorkingState
 - branch_id, research_question, summary, options[], constraints[], open_questions[], tentative_direction?, evidence_ids[], comparison_json, checkpoint_due_at

ComparisonOverride
 - branch_id, option_id, criterion_id, value, status, pinned, updated_at

AutomationAction
 - action, source/thread/branch ids, model, confidence, rationale, context/before/after snapshots, latency, status

MergeEvent
 - id, thread_id, source_branch_ids[], resulting_commit_id, resolved_rule
```

---

## Implementation Notes

### 2026-08-04 — Canvas-First Research Story (Schema v6)
- Replaced the fixed SVG graph and external inspector cards with a React Flow/Dagre canvas. The canonical story is left-to-right, context paths separate vertically, and temporary dragging never mutates SQLite.
- Added semantic zoom, in-map focus expansion, screenshot strips, current-answer and resume nodes, a source-backed comparison matrix, fit/minimap controls, and Motion transitions that honor reduced-motion preferences.
- Simplified the shell to Decisions + Search. Activity and Live Trace now open as animated audit/system drawers while their old URLs redirect safely.
- Added structured comparison observations to autonomous routing, live matrix merging, commit snapshots, durable user overrides, grouped lexical search, Markdown/ADR export, and a validated three-tab Chrome resume bridge.
- Added screenshot relevance/priority handling before capture reservations and preserved history-only routing for skipped visual noise.
- Fixed the React Flow viewport contract so every decision canvas has a resolvable height, and made the complete decision index directly accessible from both the top Decisions tab and an All decisions action in the workspace.
- Stabilized graph interactions by cloning each node's Dagre geometry instead of sharing mutable size objects, giving normal, screenshot-bearing, comparison, resume, and focused nodes explicit dimensions; selection now re-lays out surrounding nodes, zoom detail changes use separate enter/exit thresholds, and fixed card bodies scroll bounded detail instead of growing into neighboring paths.
- Fixed OpenClaw job synchronization under `set -e`: an empty legacy-job lookup now returns success, startup waits for the cron control surface, and all three declarations verify healthy instead of printing a false warning.
- Migrated the populated local database to schema v6 and verified the production API against existing decisions, captures, story nodes, search, resume, and export. Validation passes 205 TypeScript tests, ESLint, and production builds.

### 2026-07-26 — Monorepo Scaffold
- Created pnpm workspace with three packages: `@trace/core`, `@trace/service`, `@trace/dashboard`.
- Root dev tooling: TypeScript 5.x (strict, NodeNext), Vitest, ESLint 9 (flat config), Prettier.
- Core: better-sqlite3, openai, uuid.
- Service: fastify, @fastify/cors, chokidar, workspace link to @trace/core.
- Dashboard: React 19, React Router 7, Vite 6, Tailwind CSS 4 (via @tailwindcss/vite).
- Skills directory: ingestion, clustering, synthesis, resurfacing (all placeholder).
- All three placeholder tests pass via `pnpm test`.

### 2026-08-03 — Unified Start/Stop Scripts
- Rewrote `scripts/start.sh` to manage OpenClaw daemon, API server, and dashboard in one command.
- Created `scripts/stop.sh` for stopping all services from a separate terminal using PID files.
- Added `.trace-*.pid` to `.gitignore`.
- Updated `readme.md` Quick Start section to reference the stop script.

### 2026-08-03 — Fix Ctrl+C Not Stopping OpenClaw Daemon
- Root cause: `trap cleanup EXIT` alone doesn't reliably fire on SIGINT in all bash versions when `wait` is active.
- Fix: added `trap 'exit 130' INT TERM` so SIGINT/SIGTERM explicitly triggers exit, which then fires the EXIT trap.
- Added `set +e` inside cleanup to prevent `set -e` from aborting cleanup mid-way.
- Replaced silent `openclaw daemon stop 2>/dev/null || true` with verbose stop + LaunchAgent fallback (`launchctl unload ~/Library/LaunchAgents/ai.openclaw.gateway.plist`).
- Added 1-second sleep before daemon stop to let child processes terminate first.
- Applied same robust stop logic to `scripts/stop.sh`.

### 2026-08-03 — Product Rename to Trace
- Renamed the product, `@trace/*` workspace packages, `TRACE_*` environment variables, `~/.trace` runtime directory, config file, OpenClaw skills, and Swift menu bar package.
- Removed generated Swift `.build` artifacts from version control and added `.build/` to `.gitignore`.

### 2026-08-03 — Reliability, Migration, and OpenClaw Acceptance
- Added schema version 2 migrations with `source_items.branch_id` and `clustering_confidence`; existing assigned items backfill to their earliest branch.
- Reopen clustering now creates a branch from the latest commit using the model-generated context label. Synthesis groups uncommitted evidence by branch.
- Resurfacing is idempotent per reopen event and no longer loses events after a 24-hour scan window.
- Added shared camelCase API contracts, composed thread/feed/capture DTOs, explicit correction endpoints, localhost-only CORS, and an acyclic merge tree.
- The production dashboard is built and served by Fastify on port 3333; the Swift menu bar uses the same endpoint.
- Added a reusable runtime plus overlap-locked `cluster`, `synthesize`, `resurface`, and `digest` CLI commands.
- OpenClaw now has four idempotent command jobs with successful acceptance runs and no delivery dependency. Obsolete skills were archived recoverably and obsolete jobs removed only after replacements passed.
- Migrated the populated pre-Trace database after timestamped backups. Verified schema version 2 and zero assigned items without a branch.
- Live-tested full shutdown and verified the Trace listener, OpenClaw gateway listener, LaunchAgent, and gateway process all terminate.

### 2026-08-03 — Conservative Ingestion, Data Recovery, and UI Upgrade
- Added `ignore` to the clustering contract and instructed GPT-5.4 to reject feeds, inboxes, generic homepages, entertainment, and other activity without decision intent.
- High-confidence browser history requires a 0.90 score for automatic assignment or thread creation. Low-confidence matches, new decisions, and ignores remain unprocessed for manual review.
- Added manual “Ignore as noise” handling that preserves the source row but removes it from the active review queue without creating a thread.
- Changed the default browser-history lookback to zero. The initial poll records Chrome and Safari baselines; controlled tests verify only visits newer than the baseline are imported.
- Corrected thread Last Activity and sorting to use source capture timestamps.
- Rebuilt the dashboard around Activity, Decision Threads, Review Queue, and a git-style commit/branch graph with a visible Capture → Curate → Commit → Revisit flow.
- Preserved the noisy 336-thread database under `~/.trace/backups/2026-08-03T20-30-restore/`, restored the verified clean database, and migrated it to schema v2. Live startup retained exactly 3 threads and 11 source items while establishing fresh browser watermarks.
- Acceptance checks: 159 TypeScript tests, ESLint, production build, 15 Swift tests, healthy localhost API, healthy OpenClaw gateway, and verified full shutdown with no listeners or LaunchAgent remaining.

### 2026-08-03 — Near-Real-Time Browser Ingestion
- Initially reduced `browserHistoryPollIntervalMs` from 300,000 ms to 10,000 ms as an intermediate latency improvement.
- Replaced constant 10-second reads with file-event triggers for the Chrome/Safari history databases and their SQLite WAL/SHM sidecars.
- Coalesces write bursts for 1,500 ms, then uses the existing read-only snapshot path; a 120,000 ms fallback poll handles missed or replaced-file events.
- Shutdown clears the debounce and fallback timers, closes the filesystem watcher, and waits for an active history poll before closing Trace's database.
- Added controlled tests for event coalescing, fallback polling, and clean shutdown.

### 2026-08-03 — Newest-First Review Queue
- Changed the Review Queue API to return unprocessed evidence by `captured_at DESC`, with insertion order as a deterministic tie-breaker, so new captures appear at the top after refresh.
- Kept the clustering agent's repository read oldest-first so related evidence is still evaluated chronologically.
- Added API regression coverage for newest-first ordering and limit application.

### 2026-08-03 — Autonomous Research Pipeline (Schema v3)
- Replaced the scheduled clustering/synthesis hot path with `AutonomousCoordinator`, triggered directly by new screenshot and browser-history rows after a one-second micro-batch debounce.
- Added bounded public-page enrichment (HTTP/S only, DNS/private-address checks, redirect validation, four-second deadline, no cookies or JavaScript, text-only and one-megabyte limits) with metadata fallback.
- Added a deliberately narrow local fast filter for Trace localhost pages, authentication redirects, inbox/feed pages, generic social homepages, and YouTube Shorts, avoiding enrichment/embedding/model spend for obvious noise while leaving ambiguous pages to the router.
- Bounded routing to two concurrent model calls and three automatic attempts per item. Failures retry in-process after about 20 seconds; terminal errors remain visible for explicit retry instead of becoming an infinite recovery loop.
- Recovery skips database work while the live service health endpoint is available. Checkpoints use an atomic state claim, and reconciliation records a no-merge watermark until branch commits change, preventing duplicate commits and unnecessary repeated model calls.
- Added semantic retrieval with `text-embedding-3-small`, recent-thread fallback, and a maximum of 12 candidate threads sent to the strict-schema Terra router.
- Added branch working trees and 25-second quiet checkpoints whose timers reset whenever evidence arrives. Sol decides whether each checkpoint remains in progress or resolves the thread, then immediately queues reconciliation for that thread.
- Same-context revisits continue their existing branch; new branches require a material context change. Reconciliation merges compatible multi-branch conclusions only at 95%+ model confidence.
- Added `GET /api/events` SSE, `GET /api/live`, retry, and dependency-safe undo APIs. The dashboard's Review Queue is now Live Trace and uses SSE with a 30-second safety refresh.
- Added schema-v3 automation/audit/embedding/working-state tables and source/commit fields. Existing unprocessed rows become `legacy_unresolved`; a SQLite `VACUUM INTO` backup is created before the first v3 migration.
- Replaced OpenClaw's 30-minute cluster, six-hour synthesis, and hourly resurface schedules with five-minute recovery and 15-minute reconciliation safety jobs; weekly digest remains.
- Live acceptance migrated the real database to v3 with one consistent backup, processed a fresh casual-browsing batch without creating junk threads, exposed three timeouts as retryable errors, and fully removed both Trace/OpenClaw listeners plus the LaunchAgent on stop.
- Final acceptance: the local fast filter cleared the retryable casual-media errors without AI calls; the database ended with no pending/processing/error items and no new junk threads. Live Terra routing/embedding and an isolated strict-schema Sol checkpoint call succeeded. OpenClaw contains exactly `trace.recover`, `trace.reconcile`, and `trace.digest`; obsolete jobs are absent. `stop.sh` leaves no PID file, listener, or LaunchAgent. Validation passes 174 TypeScript tests, ESLint, production builds, shell syntax checks, and 15 Swift tests.

### 2026-08-04 — Automatic Browser Context Screenshots (Schema v4)
- Added an opt-in toggle to the native Trace menu app. It uses ScreenCaptureKit to capture only a frontmost normal Chrome/Safari window that matches a fresh history event, performs local Vision OCR, and skips private/incognito windows.
- Added a token-protected localhost capture bridge to the Node service. Normal `start.sh` builds and launches the app with the service; Ctrl+C and `stop.sh` terminate both. No separate capture command or background service is required.
- Routing waits two seconds for page dwell and at most eight seconds for capture before falling back to history-only processing. Sensitive URLs, stale/native-disabled agents, unmatched windows, and capture failures never block routing.
- Added limits of one capture per 10 seconds, six per minute, 120 per hour, and 500 per day; also added a ten-minute URL cooldown, perceptual near-duplicate suppression, user-only filesystem permissions, 30-day full-image expiry, and a 1 GB full-image cap. Thumbnails remain associated with evidence.
- Added `visual_context` and `capture_assets`; the pre-v4 migration creates a timestamped SQLite backup. Live routing receives the stored screenshot pixels and OCR; checkpoints and OpenClaw recovery receive the OCR context.
- End-to-end acceptance started the Node service, packaged `Trace.app`, and OpenClaw together, verified all three declared OpenClaw jobs, then confirmed `stop.sh` removed both PID files, both listeners, all exact processes, and the OpenClaw LaunchAgent.
- Validation passes 181 TypeScript tests, ESLint, production builds, shell syntax checks, and 17 Swift tests.

### 2026-08-04 — Visible Screenshot Evidence and Grouped Activity (Schema v5)
- Added persistent capture states/reasons and surfaced native connectivity, permission state, and the latest outcome in Live Trace. The menu app now reports typed failures instead of silently falling back.
- Native capture selects the exact frontmost layer-zero Chrome/Safari window by process and window ID, checks privacy only on that window, and allows 25 seconds after leasing before history-only routing resumes.
- Added source-ID-based thumbnail/full-image endpoints with no raw paths and private/no-store headers. Thumbnails render in active research and commit evidence with a full-image viewer.
- Full images remain until the 1 GB cap evicts the oldest unpinned files. Near-duplicates retain their own thumbnail and OCR while omitting a duplicate full image.
- Activity groups same-branch in-progress checkpoints within 30 minutes and labels checkpoints separately from resolved verdicts. Every underlying commit remains in the decision graph.
- Decisions is now the default dashboard route; Activity remains the ambient feed and Live Trace remains the real-time audit surface.
- Capture polling is an uncached POST with a 60-second stale-queue deadline and a separate 25-second leased deadline. The native app checks permission once per minute instead of on every poll, uses fast supplemental OCR, and is signed with a stable Apple Development identity when one is installed.
- Startup bounds OpenClaw synchronization attempts; shutdown bounds OpenClaw CLI waits and verifies exact gateway processes. A live stop audit left ports 3333/18789 and all Trace/OpenClaw processes absent.
- Live migration reached schema v5 and created `~/.trace/backups/trace-pre-v5-2026-08-04T05-02-10-366Z.sqlite`. OpenClaw's recovery, reconciliation, and digest jobs were all healthy after direct synchronization.
- Automated validation passes 190 TypeScript tests, ESLint, production builds, shell syntax checks, and 19 Swift tests.
- The ScreenCaptureKit timeout is superseded for Chrome by the companion extension. Safari continues as history-only in this release; its visual capture remains a later browser-specific integration.

### 2026-08-04 — Chrome Visual Capture and Unified Decision Workspace
- Added an unpacked Manifest V3 extension using `webNavigation`, visible-tab capture, bounded DOM text, local image resizing, thumbnailing, and perceptual hashing. It never runs in incognito and rejects internal/sensitive URLs in both extension and service layers.
- Added immediate authenticated visit ingestion and one-minute history deduplication. The extension receives a reserved request, waits for the two-second dwell, rechecks the active tab/URL, and completes through the existing asset and multimodal routing pipeline.
- Added a Chrome native-messaging host with a fixed extension ID. `start.sh` installs its manifest and user-only token/port files; Ctrl+C and `stop.sh` remove all three so the installed extension cannot capture while Trace is stopped.
- Fixed Chrome native messaging to parse a complete frame without waiting for stdin to close, and register a user-only launcher with Trace's absolute Node path so GUI-launched Chrome can start the host without inheriting a shell PATH.
- Reworked the menu screenshot toggle into a persistent service policy and extension connection indicator. Chrome capture no longer prompts for Desktop, Downloads, or Screen Recording permission.
- Removed the dashboard sidebar. Decisions, Activity, and Live Trace now share a compact top tab bar; light mode is the default, dark mode is persisted as an option, and the UI uses semantic surfaces, borders, text roles, and a consistent system sans type scale.
- The most recent decision opens automatically. Its graph displays evidence screenshots, readable verdict nodes, branches/merges/regrets, and a dashed “You left off here” working node; the existing inspector/lightbox preserves complete source context.
- Validation: 199 TypeScript/React tests, 19 Swift tests, ESLint, extension/native-host and shell syntax checks, the complete production build, live service startup, native-bridge messaging, safe file permissions, and full shutdown/restart pass. The Chrome extension now completes automatic heartbeats and visible-tab capture against the live service; relevant-page screenshot retention remains subject to the documented safety and rate limits.

---

## How to Update This File

When completing implementation work:
1. Update the relevant task row's **Status** column (Not Started → In Progress → Done).
2. Add any key decisions to the **Technical Decisions Log**.
3. Add detailed notes under **Implementation Notes** if warranted.
4. Update the **Last Updated** date at the top.
