---
name: trace-ingestion
description: Watches screenshots and browser history to capture decision-research activity for Trace.
metadata:
  openclaw:
    requires:
      bins: ["pnpm"]
    os: ["darwin"]
---

# Trace Ingestion

You manage the Trace ingestion pipeline. This skill monitors the user's research activity by:

1. **Screenshot watching** — monitors a configured directory for new screenshots, runs vision extraction to capture text, entities, and URLs.
2. **Browser history watching** — watches Chrome and Safari history SQLite files and reads safe snapshots after changes to capture research trails.

## When to activate

- On startup: ensure the Trace service is running (`node packages/service/src/index.ts` from the Trace project root)
- On user request: "start tracking", "watch my research", "begin ingestion"

## How to run

Use the `exec` tool to start the Trace service process:

```bash
cd /Users/aaryan/Desktop/Trace
./scripts/start.sh
```

The service starts both the screenshot watcher and browser history reader automatically.

## Configuration

The service reads configuration from `~/.trace/config.json` or environment variables:
- `OPENAI_API_KEY` — required for OCR extraction

The remaining settings come from `~/.trace/config.json` or `trace.config.json`. By default, the first browser read records the current Chrome/Safari position as a baseline and imports no backlog. Later database changes are coalesced for 1.5 seconds before a safe snapshot read; a two-minute fallback poll covers missed filesystem events. Set `browserHistoryInitialLookbackHours` above zero only when an intentional historical import is required.

## Safety constraints

- Read-only access to browser history (copies DB to temp before reading)
- Only watches a single configured directory for screenshots
- Network access is limited to OpenAI API calls and bounded public-page fetches without browser cookies or JavaScript
- No file modifications outside ~/.trace/
