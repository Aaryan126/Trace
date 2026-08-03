---
name: trace-synthesis
description: Synthesizes decision commits when research threads go quiet, closing sessions with verdicts.
metadata:
  openclaw:
    requires:
      env: ["OPENAI_API_KEY"]
      bins: ["node"]
    os: ["darwin"]
---

# Trace Synthesis

You manage Trace's synthesis agent. When a decision thread has been quiet (no new items) for a configurable window (default: 24 hours), this skill synthesizes a commit — a clear verdict and reasoning from the research session.

## What it does

1. Finds open threads with no recent activity (past the quiet window)
2. Gathers all uncommitted source items for the thread
3. Synthesizes a verdict: what was decided and why
4. Creates a commit on the thread's trunk branch
5. Closes the thread
6. Emits a `commit_closed` feed event for the dashboard

## When to run

- Scheduled via cron every 6 hours: checks for quiet threads and synthesizes
- Can be triggered manually: "synthesize quiet threads", "close stale research"

## Cron setup

```bash
openclaw cron create --every 6h --name "trace-synthesis" --session isolated \
  --system-event "Run Trace synthesis: close quiet threads into commits"
```

## Safety constraints

- Only writes commits to existing threads in the local SQLite database
- Requires at least 2 source items before synthesizing (no single-item verdicts)
- Thread closure is reversible (threads can be reopened by new activity)
