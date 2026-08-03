# PRD — Trace
### Git for your recurring decisions

---

## 1. Problem

Developers (and knowledge workers generally) re-research the same recurring decisions over and over — "Postgres or Mongo," "which auth provider," "should I take this job/vendor/apartment" — and have no memory of what they concluded last time, why, or whether it worked out. Notes apps store facts; they don't store *verdicts*. Bookmarks store links; they don't store *reasoning*. Nothing treats "a decision you've already made" as a first-class, revisitable object — the way git treats a change as a first-class, revisitable object.

Git solved this for code: every change is committed with a reason, history is inspectable, and you can see exactly when and why something diverged. Trace applies that same model to your own decision-making.

## 2. Target user

Primary: **developers** who already live in the browser, VS Code, and Obsidian/notion-style tools, and who repeatedly hit the same class of technical decisions across projects (library choice, architecture pattern, vendor/tool choice). Secondary (not a v1 focus): anyone doing recurring high-stakes research (big purchases, investments).

## 3. Core concept

- **Thread** — a recurring decision topic (e.g. "Postgres vs Mongo").
- **Commit** — a closed research session on that thread: what you read, what you concluded, and why. Written by the agent, confirmed by you.
- **Branch** — a reopening of the thread in a *different context* (new project, new constraints) that may diverge from the trunk's verdict. Branches fork from the commit they diverged from.
- **Merge** — when you consciously reconcile two branches into one durable rule ("going forward, default to Postgres unless the data is mostly unstructured").
- **Regret marker** — a tag attached retroactively to a commit when you indicate the verdict didn't hold up, so future resurfacing carries that warning.
- **Diff** — when a thread is reopened, the agent surfaces what's different about this context vs. the context of the prior commit, not just that the topic recurred.

## 4. Non-goals (v1)

- Not a general-purpose note-taking or bookmarking app.
- Not a chatbot you query — the agent acts on a schedule and interrupts proactively, it isn't a search box.
- Not multi-user / team decision tracking in v1 — single-user only.
- Not ingesting VS Code or Obsidian directly via API/file-watching in v1 — covered via screenshots only. (Native ingestion is a natural v2 extension once the core loop works.)
- Not mobile.

## 5. System architecture

**Runtime substrate: OpenClaw**, self-hosted, running as a background daemon on the user's Mac. Trace is implemented as a custom OpenClaw skill + a purpose-built data layer, not a runtime built from scratch — this gets the heartbeat scheduler, persistent memory, and skill framework for free so build time goes into the actual novel logic.

**Model: OpenAI GPT-5.4** via the OpenAI API, used for OCR-adjacent extraction/cleanup, thread synthesis, similarity/clustering judgments, and resurfacing copy generation.

```
┌─────────────────────────────────────────────────────────┐
│                      OpenClaw daemon                      │
│  (heartbeat scheduler, memory store, skill runtime)        │
│                                                             │
│  ┌───────────────┐   ┌────────────────┐   ┌─────────────┐│
│  │ Ingestion      │→ │ Clustering /    │→ │ Synthesis    ││
│  │ agent          │   │ curation agent  │   │ agent        ││
│  │ (screenshots,  │   │ (assigns to     │   │ (writes      ││
│  │ browser hist.) │   │ thread/branch)  │   │ commits)     ││
│  └───────────────┘   └────────────────┘   └──────┬──────┘│
│                                                     │       │
│  ┌───────────────────────────────────────────────▼──────┐│
│  │              Resurfacing agent (heartbeat-triggered)   ││
│  │  detects reopens, generates diffs, pushes nudges       ││
│  └───────────────────────────────────────────────┬──────┘│
└──────────────────────────────────────────────────┼───────┘
                                                      │
                        ┌─────────────────────────────┼─────────────────────┐
                        ▼                             ▼                     ▼
              Menu bar app (native)         Local dashboard          Notification
              ambient nudges                 (localhost web app)     fallback (optional)
```

### Ingestion agent
- Watches screen for screenshots saved to a configured folder; runs OCR + layout extraction (GPT-5.4 vision) to pull text, source app (best-effort, via window title / visual cues), and URL if visible.
- Reads local browser history (Chrome/Safari history DB) on a polling interval to capture research trails without requiring a screenshot for every page.

### Clustering / curation agent
- For each new item, decides: does this belong to an existing open thread, an existing closed thread (→ triggers a reopen), or is it a new thread?
- Similarity judgment via GPT-5.4 over topic/entities extracted from the item plus existing thread summaries.

### Synthesis agent
- Runs when a thread goes quiet (no new related activity for a configurable window, e.g. 24–48h) — closes the research session into a commit: synthesized verdict + reasoning, not just a link dump.

### Resurfacing agent
- Runs on the heartbeat. Two jobs:
  1. Detect a reopen (new item lands in a *closed* thread) → generate the diff against the most relevant prior commit, push a nudge.
  2. Periodic digest — "3 new items on X this week" for threads still open.

## 6. UI/UX

**Visual direction:** dev-tool aesthetic throughout — dark-first, monospace for metadata (dates, tags, hashes), git-log/IDE-diff visual language rather than consumer-app styling. Should feel at home next to VS Code and a terminal, not like a lifestyle app.

### Screen 1 — Home / feed
Passive check-in screen. Reverse-chronological feed of agent-generated cards: reopens, digests, closed-thread notices. This is the only screen checked without intent.

### Screen 2 — Thread view (core screen)
The git-log-made-visual screen. A branch/tree structure, git-graph style:
- Trunk = main line of commits for the thread.
- Forks = branches, drawn diverging from the commit they reopened from, labeled with the context that caused the divergence (e.g. "orders service" vs "notifications service").
- Merge points = explicit, drawn as branches rejoining into a single node with the reconciled rule.
- Regret markers = visually distinct commit color/icon on the graph, not a separate list.
- Clicking a commit expands its synthesized verdict + source items.

### Screen 3 — Capture view
Lightweight, near-real-time: "here's what I think you're researching right now," with an inline control to confirm, correct, or merge it into an existing thread rather than starting a new one. This is the main point of manual correction, since the clustering agent won't be perfect.

### Screen 4 — All threads
Filterable list as the default (searchable, sortable by recency/staleness), with an optional light graph overlay *only* for threads that share branches across projects (e.g. "database choice" appearing in three repos) — graph is secondary, not the primary navigation.

### Menu bar app (native, in scope for v1)
Persistent, glanceable presence — icon state changes when there's something worth surfacing (e.g. a subtle badge on reopen detection). Click opens a compact dropdown with the latest 1–2 feed cards and a link into the full dashboard. No Dynamic Island hardware equivalent exists on Mac, but the interaction pattern (small, ambient, glanceable, click-to-expand) is the same idea, native menu bar implementation (SwiftUI).

### Dashboard
Everything else (thread view, all-threads, capture view) is a **local web app served by the daemon** (localhost), opened in-browser or a thin wrapper window — same pattern OpenClaw already uses for its own control UI.

## 7. Data model (high level)

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

## 8. MVP scope (4-week build)

**Week 1 — Spec + ingestion pipeline**
- OpenClaw skill scaffold, screenshot watcher + OCR via GPT-5.4 vision, browser history reader.
- Data model + storage (SQLite, consistent with OpenClaw's existing local-first storage pattern).

**Week 2 — Clustering + synthesis agents**
- Thread assignment logic, commit synthesis on session-close, manual correction flow (feeds Capture view).

**Week 3 — Resurfacing + UI**
- Reopen detection, diff generation, heartbeat digest job.
- Dashboard: Thread view (branch/tree viz) + All-threads + Capture view.

**Week 4 — Menu bar app, polish, demo**
- Native menu bar app, nudge wiring, end-to-end demo script, bug fixing, Quest Mode task verification pass.

## 9. Stretch goals (post-MVP, not v1)

- Native VS Code / Obsidian ingestion (file watchers instead of screenshots).
- Multi-user / shared threads for teams.
- Outcome tracking beyond binary regret (e.g. a lightweight satisfaction score over time).

## 10. Success criteria for the hackathon demo

- Live demo: research a topic (generate real browser history + screenshots), let the agent close the thread into a commit, then reopen it in a different simulated context and show the agent catching it, surfacing the diff, and the tree view rendering the fork in real time.
- Judges should be able to see, without narration, that this is meaningfully different from "a note-taking app with AI tags" — the branch/merge/regret structure needs to be visually self-evident.

## 11. Open risks

- Clustering accuracy (same topic worded differently across sessions) — mitigated by the Capture view's manual correction loop, but this is the single biggest technical risk to the whole product working believably in a demo.
- Screenshot OCR reliability across different app UIs (browser vs PDF vs code editor) — worth testing early in Week 1, not late.
- Menu bar native app scope creep — keep it to icon state + dropdown only; resist adding features there.
