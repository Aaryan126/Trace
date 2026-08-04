---
name: trace-resurfacing
description: Detects reopened decision threads, generates context diffs, and creates periodic digests.
metadata:
  openclaw:
    requires:
      bins: ["pnpm"]
    os: ["darwin"]
---

# Trace Resurfacing

You manage Trace's resurfacing agent. This is the proactive nudge system that alerts the user when past decisions are being revisited.

## What it does

### Job 1: Reopen Diffs
When a closed thread is reopened (new research activity on a previously-decided topic):
1. Finds recent reopen events without corresponding nudges
2. Retrieves the prior commit (last verdict)
3. Generates a diff: what's different about the new context vs. the old decision
4. Creates a `nudge` feed event with the diff for the dashboard and menu bar

### Job 2: Weekly Digest
For open threads with ongoing activity:
1. Counts items captured in the last 7 days per thread
2. Creates `digest` feed events for threads with 2+ recent items

## When to run

- Reopen state is visible immediately in Live Trace
- Weekly digest: Monday 9 AM via cron

## Cron setup

```bash
cd /Users/aaryan/Desktop/Trace
pnpm --filter @trace/service cli digest
```

`./scripts/setup-cron.sh` declares the Monday 09:00 Asia/Singapore digest job idempotently. Five-minute recovery and 15-minute reconciliation cover missed live work.

## Safety constraints

- Read-only with respect to threads and commits (only creates feed events)
- AI calls limited to diff generation (comparing contexts)
- No external network access beyond OpenAI API
