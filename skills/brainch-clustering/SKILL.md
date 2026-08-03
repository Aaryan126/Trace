---
name: brainch-clustering
description: Assigns new research items to decision threads, detecting new topics and reopens.
metadata:
  openclaw:
    requires:
      env: ["OPENAI_API_KEY"]
      bins: ["node"]
    os: ["darwin"]
---

# Brainch Clustering

You manage Brainch's clustering agent. When new source items are ingested, this skill assigns them to the correct decision thread.

## What it does

For each unprocessed source item:
1. Compares the item against all existing threads (open + recently closed)
2. Decides: belongs to existing thread, starts a new thread, or reopens a closed thread
3. Items below the confidence threshold (0.6) are flagged for manual review in the Capture View

## When to run

- Triggered automatically after ingestion captures new items
- Can be run manually: "cluster new items", "assign research items"
- Scheduled via cron every 30 minutes

## How to run

```bash
cd /Users/aaryan/Desktop/Trace && node --loader ts-node/esm -e "
  const { createDatabase } = require('@brainch/core');
  const { ClusteringAgent } = require('@brainch/core');
  const { createBrainchAI } = require('@brainch/core');
  // ... instantiate and run
"
```

Or invoke via the Brainch API: the service exposes clustering as part of its pipeline.

## Safety constraints

- Only reads and writes to the local Brainch SQLite database
- No filesystem access beyond the database file
- AI calls limited to clustering decisions (no arbitrary generation)
