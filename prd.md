# PRD — Trace
### Git for your recurring decisions

**Status:** v1 implemented and in active product refinement

**Last updated:** 2026-08-04

---

## 1. Problem

Developers (and knowledge workers generally) re-research the same recurring decisions over and over — "Postgres or Mongo," "which auth provider," "should I take this job/vendor/apartment" — and have no memory of what they concluded last time, why, or whether it worked out. Notes apps store facts; they don't store *verdicts*. Bookmarks store links; they don't store *reasoning*. Nothing treats "a decision you've already made" as a first-class, revisitable object — the way git treats a change as a first-class, revisitable object.

The failure is not just storage; it is maintenance. Existing tools expect the user to stop researching, decide what matters, organize it, summarize it, and remember to look it up later. That manual tax is why the history of a decision is usually incomplete by the time it becomes useful.

Git solved the equivalent problem for code: work can exist in progress, meaningful states are committed with reasons, history is inspectable, and divergence is explicit. Trace applies that model to decision-making.

## 2. Product objective

**Trace gives one person a durable, local memory of how their decisions evolve, without requiring them to maintain that memory manually.**

Trace should quietly observe decision-relevant research, separate it from ordinary browsing, and turn it into a live working tree of the question, evidence, options, constraints, and tentative direction. It should automatically checkpoint useful conclusions and reasoning, preserve materially different contexts as branches, and resurface the right prior conclusion when the topic returns.

The product is successful when a user can resume or revisit a decision and immediately understand:

- what they were trying to decide;
- which evidence and constraints shaped the decision;
- what the current or last conclusion was, and why;
- how the present context differs from earlier attempts; and
- whether the earlier verdict held up.

This autonomy must remain inspectable and reversible. Trace records why it filed, ignored, branched, checkpointed, or merged something; failures are visible and retryable; and isolated automatic actions can be undone. The intended experience is an ambient decision-memory system, not a note-taking ritual, chatbot conversation, or approval queue.

## 3. Target user

Primary: **individual researchers, developers, founders, analysts, and other knowledge workers** who make recurring comparison-heavy decisions in a desktop browser and need to resume the reasoning later. The initial beachhead remains technical research—library choices, architecture patterns, models, tools, and vendors—because these users already understand commits and branches.

Secondary: people researching significant purchases, education, careers, travel, health questions, or investments. Sensitive categories may benefit from the decision-memory model, but automatic visual capture remains excluded on sensitive pages in v1.

## 4. Core concept

- **Thread** — a recurring decision topic (e.g. "Postgres vs Mongo").
- **Working tree** — the live, pre-commit state of a research session: question, options, constraints, open questions, tentative direction, and evidence.
- **Commit** — an automatic durable checkpoint: what you read, the current conclusion, and why. A commit can be in progress or resolved; no confirmation is required.
- **Branch** — a reopening of the thread in a *different context* (new project, new constraints) that may diverge from the trunk's verdict. Branches fork from the commit they diverged from.
- **Merge** — when compatible branches reconcile into one durable rule ("going forward, default to Postgres unless the data is mostly unstructured"). Trace may do this automatically only at high confidence and always records the rationale.
- **Regret marker** — a tag attached retroactively to a commit when you indicate the verdict didn't hold up, so future resurfacing carries that warning.
- **Diff** — when a thread is reopened, the agent surfaces what's different about this context vs. the context of the prior commit, not just that the topic recurred.
- **Comparison** — a live, source-backed option/criterion matrix. Unsupported cells stay unknown; user corrections overlay later AI refreshes without turning the workflow into an approval queue.

## 5. Non-goals (v1)

- Not a general-purpose note-taking or bookmarking app.
- Not a chatbot conversation that the user must maintain. Search is available for retrieval, but the decision history is created from local research events rather than a prompting ritual.
- Not multi-user / team decision tracking in v1 — single-user only.
- Not ingesting VS Code or Obsidian directly via API/file-watching in v1 — covered via screenshots only. (Native ingestion is a natural v2 extension once the core loop works.)
- Not mobile.

## 6. System architecture

**Runtime:** the local Trace service owns the latency-sensitive ingestion, routing, working-state, checkpoint, and SSE path. **OpenClaw** remains the self-hosted background scheduler for recovery, reconciliation, and digest safety jobs; it is not on the per-item critical path.

**Models:** OpenAI GPT-5.6 Terra with low reasoning for strict-schema live routing; GPT-5.6 Sol with medium reasoning for checkpoint synthesis and branch reconciliation; `text-embedding-3-small` for semantic retrieval.

```
┌─────────────────────────────────────────────────────────┐
│                    Local Trace service                     │
│  (watchers, public-page enrichment, retrieval, SSE/API)    │
│                                                             │
│  ┌───────────────┐   ┌────────────────┐   ┌─────────────┐│
│  │ Ingestion      │→ │ Autonomous      │→ │ Working tree ││
│  │ agent          │   │ curation agent  │   │ agent        ││
│  │ (screenshots,  │   │ (assigns to     │   │ (writes      ││
│  │ browser hist.) │   │ thread/branch)  │   │ checkpoints) ││
│  └───────────────┘   └────────────────┘   └──────┬──────┘│
│                                                     │       │
│  ┌───────────────────────────────────────────────▼──────┐│
│  │       Audit log + retry/undo + checkpoint timers         ││
│  │  records decisions and pushes live server-sent events   ││
│  └───────────────────────────────────────────────┬──────┘│
└──────────────────────────────────────────────────┼───────┘
                                                      │
                        ┌─────────────────────────────┼─────────────────────┐
                        ▼                             ▼                     ▼
              Menu bar app (native)         Local dashboard          Notification
              ambient nudges                 (localhost web app)     fallback (optional)
```

### Ingestion agent
- Watches screenshots saved to a configured folder; runs vision extraction to pull text, source app (best-effort, via window title / visual cues), and URL if visible.
- Watches local Chrome/Safari history databases and safely snapshots new visits after file changes, with a slow fallback poll for missed events.
- Uses a Chrome Manifest V3 companion extension to report visits immediately and capture the visible viewport only after the local service approves the candidate. The same active URL is rechecked before capture; incognito, internal, login, payment, mail, banking, and health pages are excluded. Chrome/Safari history remains a fallback, and skipped captures fall through to history-only routing.
- Treats screenshots as first-class research evidence, not decoration. Manual requests, already-filed decision pages, and comparison/evaluation pages receive priority; cooldowns, hourly/daily limits, duplicate detection, local-only storage, and full-image retention bounds prevent indiscriminate recording. Long-lived thumbnails remain attached to their source items.

### Autonomous routing agent
- Within the 10–25-second target window, decides: ignore, start a thread, continue a branch, or fork a new context branch.
- Fetches public page text without browser cookies/JavaScript, embeds the evidence, retrieves semantic and recent candidates, and uses strict structured output.
- Same-context revisits continue the prior branch even when the thread was closed. A new branch requires a material change in goal, constraint, audience, or timeframe.
- Persists the result locally and pushes it to the dashboard over SSE (the research equivalent of a local git push). Every action is audited; isolated actions can be undone.
- Requires no review queue or approval step. Low-confidence or failed automation stays visible and retryable rather than silently creating a poor thread, branch, or checkpoint.

### Checkpoint and reconciliation agent
- Updates the branch working tree on every filed item so useful state appears immediately.
- After 25 seconds without new evidence, with the timer reset by every newly filed item, or sooner when the route signals semantic completion, writes an in-progress or resolved commit with synthesized verdict and reasoning.
- Immediately after each checkpoint, may merge compatible branches only at 95%+ confidence; otherwise the branches remain separate. A 15-minute reconciliation job remains as a safety net.

### Resurfacing agent
- Reacts immediately when a new item reopens a closed thread, generates the diff against the most relevant prior commit, and pushes a nudge.
- Produces a weekly digest for open threads. The digest is deliberately not part of the seconds-level ingestion path.

## 7. UI/UX

**Visual direction:** light-first, white-surface developer tool with dark text, restrained borders, consistent system sans-serif typography, and monospace only for commit IDs and metadata. An optional dark theme preserves the same semantic tokens. The git map and its visual evidence are the primary story.

### Decisions canvas (default and core screen)
The git-log-made-visual screen. It is one pan/zoom canvas with a deterministic left-to-right story:
- Trunk = main line of commits for the thread.
- Forks = branches, drawn diverging from the commit they reopened from, labeled with the context that caused the divergence (e.g. "orders service" vs "notifications service").
- Merge points = explicit, drawn as branches rejoining into a single node with the reconciled rule.
- Regret markers = visually distinct commit color/icon on the graph, not a separate list.
- Clicking a node expands its synthesized verdict, reasoning, comparison, and source items inside the map while the surrounding path remains visible. Expanded dimensions participate in automatic layout; cards must not overlap, and selecting another node restores the previous node before reflowing.
- Screenshot thumbnails appear on graph nodes and beside evidence, opening a full-image viewer; local filesystem paths are never exposed to the client.
- The current uncommitted working node is dashed and marked “You left off here.”
- The current answer, its reasoning, supporting sources/screenshots, live comparison, and next unresolved question are first-class map nodes.
- Semantic zoom shows compact history at overview scale and richer summaries/evidence at reading scale. Its overview/detail thresholds use hysteresis so small wheel or trackpad movements cannot repeatedly rebuild or flicker the graph. Dragging is temporary; Trace owns the canonical automatic layout.
- The top Decisions tab opens the complete, searchable decision index. Inside a decision, a searchable picker switches trails, an All decisions action returns to the index, and the root dashboard may open the most recently active decision. Global search covers decision titles, verdicts, reasoning, and evidence.
- Resume Research reopens at most three branch-relevant HTTP/S pages through the local Chrome extension.

### Activity drawer
Reverse-chronological feed of grouped research checkpoints, resolved verdicts, reopens, digests, and closed-thread notices. Consecutive in-progress checkpoints on the same branch within 30 minutes collapse into an expandable card without changing the underlying graph.

### System drawer (Live Trace)
Near-real-time autonomous working area: what Trace is processing, each branch's working state, and why evidence was filed, branched, ignored, checkpointed, or merged. It is not an approval gate. Failed work has retry and isolated automatic actions have optional undo. It also shows Chrome extension connectivity, the latest structured skip/failure reason, and screenshots attached to active evidence.

### Menu bar app (native, in scope for v1)
Persistent, glanceable presence — icon state changes when there's something worth surfacing. Click opens a compact dropdown with the latest 1–2 feed cards, a link into the full dashboard, and the automatic browser screenshot policy toggle. Chrome owns page capture through the companion extension; the Node service owns approval, routing, storage, rate limits, retention, and native-bridge lifecycle. No Screen Recording permission is required.

### Dashboard
Everything else (thread view, all-threads, Live Trace) is a **local web app served by the Trace service** (localhost), opened in-browser or a thin wrapper window.

### Core interaction requirements
- New relevant browsing should appear as working evidence within 10 seconds in normal conditions and no later than the 20–25-second service deadline when enrichment or capture is slow.
- The user never needs to assign evidence, choose a thread, create a branch, or commit a checkpoint manually for the core loop to work.
- Every visible conclusion must retain links to its evidence and any available screenshots; unsupported comparison cells remain explicitly unknown.
- The decision map is canonical history. Activity is a condensed audit view, and Live Trace is operational visibility—not staging or an approval queue.
- Service shutdown must stop the Trace service, menu app, Chrome capture bridge, and OpenClaw gateway completely; starting Trace restores the linked runtime and recovery jobs.

## 8. Data model (high level)

```
Thread
 - id, title, tags, status (open/closed), created_at

Branch
 - id, thread_id, parent_commit_id (null = trunk), context_label

Commit
 - id, branch_id, verdict_summary, reasoning, source_item_ids[], kind, resolution_status, comparison_json, created_at, regret: bool, regret_note?

SourceItem
 - id, type, raw_text, content_text?, visual_context?, url?, captured_at, thread_id?, branch_id?, content_status, automation_status, capture_status, capture_reason?

CaptureAsset
 - source_item_id, full_path?, thumbnail_path, mime_type, dimensions, visual_hash, captured_at, full_expires_at, pinned

BranchWorkingState
 - branch_id, research_question, summary, options[], constraints[], open_questions[], tentative_direction?, evidence_ids[], comparison_json, checkpoint_due_at

ComparisonOverride
 - branch_id, option_id, criterion_id, value, status, pinned, updated_at

AutomationAction
 - action, source/thread/branch ids, model, confidence, rationale, snapshots, latency, status

MergeEvent
 - id, thread_id, source_branch_ids[], resulting_commit_id, resolved_rule
```

## 9. MVP scope (4-week build)

**Week 1 — Spec + ingestion pipeline**
- OpenClaw skill scaffold, screenshot watcher + vision extraction, browser history reader.
- Data model + storage (SQLite, consistent with OpenClaw's existing local-first storage pattern).

**Week 2 — Clustering + synthesis agents**
- Autonomous thread/branch routing, live working state, automatic checkpoints, audit/retry/undo, and recovery flow.

**Week 3 — Resurfacing + UI**
- Reopen detection, diff generation, heartbeat digest job.
- Dashboard: Thread view (branch/tree viz) + All-threads + Live Trace.

**Week 4 — Menu bar app, polish, demo**
- Native menu bar app, nudge wiring, end-to-end demo script, bug fixing, Quest Mode task verification pass.

## 10. Stretch goals (post-MVP, not v1)

- Native VS Code / Obsidian ingestion (file watchers instead of screenshots).
- Multi-user / shared threads for teams.
- Outcome tracking beyond binary regret (e.g. a lightweight satisfaction score over time).

## 11. Success criteria for the hackathon demo

- Live demo: research a topic through normal browser activity and screenshots; show Trace ignoring noise, updating the working tree, and creating a checkpoint without manual filing or approval. Revisit the topic in a materially different simulated context and show Trace catching it, surfacing the diff, and rendering the fork in real time.
- At every stage, the user can inspect what Trace did and why; a recoverable failure can be retried and an isolated automatic action can be undone.
- Judges should be able to see, without narration, that this is meaningfully different from "a note-taking app with AI tags" — the branch/merge/regret structure needs to be visually self-evident.
- A user can open an existing decision and understand the current answer, supporting evidence/screenshots, divergent contexts, comparison gaps, and exact next research question from the map alone.
- Pan, zoom, selection, live updates, and node expansion remain stable: no overlapping cards, repeated re-layout flicker, or loss of the visible research path.

## 12. Open risks

- Routing accuracy (same topic worded differently or genuinely changed context) — mitigated by semantic retrieval, bounded candidate context, strict route actions, visible rationales, audit, retry, and optional undo. Quality remains the biggest product risk.
- Screenshot OCR and title matching reliability across Chrome/Safari pages — mitigated by using OCR as supplemental context and falling through to history-only routing whenever matching or capture fails.
- Screen capture privacy — mitigated by explicit opt-in, service approval before each Chrome visible-tab capture, active-URL revalidation, incognito and sensitive URL exclusions, rate limits, local storage, retention, and immediate pause control. Chrome capture does not require macOS Screen Recording, Desktop, or Downloads access.
- Menu bar native app scope creep — keep it to ambient feed, dashboard link, and the capture permission/toggle required by the native boundary.
