---
name: trace-synthesis
description: Reconciles due checkpoints and compatible research branches as a background safety pass.
metadata:
  openclaw:
    requires:
      bins: ["pnpm"]
    os: ["darwin"]
---

# Trace Checkpoint Reconciliation

The Trace service creates checkpoints after 90 seconds of inactivity. This OpenClaw skill is a safety pass for checkpoints missed during downtime and for high-confidence branch reconciliation.

## What it does

1. Writes any overdue in-progress/resolved checkpoints
2. Compares branches that have durable verdicts
3. Merges only compatible branches at 95%+ confidence
4. Records the rule, confidence, rationale, and resulting commit in the audit log

## When to run

- Scheduled every 15 minutes as a recovery/reconciliation safety job
- Can be triggered manually: "reconcile Trace"

## Cron setup

```bash
cd /Users/aaryan/Desktop/Trace
pnpm --filter @trace/service cli reconcile
```

`./scripts/setup-cron.sh` declares the 15-minute OpenClaw command job idempotently.

## Safety constraints

- Only writes commits to existing threads in the local SQLite database
- Does not merge branches below the 95% confidence gate
- Thread closure is reversible (threads can be reopened by new activity)
