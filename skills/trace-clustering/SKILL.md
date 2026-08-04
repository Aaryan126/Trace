---
name: trace-clustering
description: Recovers pending autonomous routing work after an interruption.
metadata:
  openclaw:
    requires:
      bins: ["pnpm"]
    os: ["darwin"]
---

# Trace Routing Recovery

Trace normally routes each new item inside the local service within seconds. This skill is the OpenClaw recovery path for pending or failed work after a crash or temporary API outage.

## What it does

For each fresh item with `pending` or `error` automation status:
1. Enriches public page text safely when available
2. Retrieves semantic and recent thread candidates
3. Chooses ignore, new thread, continue branch, or new branch using strict structured output
4. Updates Live Trace and records an auditable action with rationale

## When to run

- The Trace service handles fresh events directly
- OpenClaw runs this recovery command every five minutes

## How to run

```bash
cd /Users/aaryan/Desktop/Trace
pnpm --filter @trace/service cli recover
```

The command loads the project `.env`, prevents overlapping runs, prints JSON statistics, and exits nonzero on failure.

## Safety constraints

- Only reads and writes to the local Trace SQLite database
- No filesystem access beyond the database file
- Old `legacy_unresolved` rows are not replayed automatically
