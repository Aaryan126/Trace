---
name: brainch-resurfacing
description: Detects reopened decision threads, generates context diffs, and creates periodic digests.
metadata:
  openclaw:
    requires:
      env: ["OPENAI_API_KEY"]
      bins: ["node"]
    os: ["darwin"]
---

# Brainch Resurfacing

You manage Brainch's resurfacing agent. This is the proactive nudge system that alerts the user when past decisions are being revisited.

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

- Reopen check: every hour via cron
- Weekly digest: Monday 9 AM via cron

## Cron setup

```bash
openclaw cron create --every 1h --name "brainch-resurface-check" --session isolated \
  --system-event "Run Brainch resurfacing: check for reopens and generate diffs"

openclaw cron create --cron "0 9 * * 1" --tz "America/New_York" --name "brainch-weekly-digest" --session isolated \
  --system-event "Run Brainch weekly digest for open threads"
```

## Safety constraints

- Read-only with respect to threads and commits (only creates feed events)
- AI calls limited to diff generation (comparing contexts)
- No external network access beyond OpenAI API
