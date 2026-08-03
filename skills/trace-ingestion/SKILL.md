---
name: trace-ingestion
description: Watches screenshots and browser history to capture decision-research activity for Trace.
metadata:
  openclaw:
    requires:
      env: ["OPENAI_API_KEY"]
      bins: ["node"]
    os: ["darwin"]
---

# Trace Ingestion

You manage the Trace ingestion pipeline. This skill monitors the user's research activity by:

1. **Screenshot watching** — monitors a configured directory for new screenshots, runs OCR via GPT-5.4 vision to extract text, entities, and URLs.
2. **Browser history polling** — reads Chrome and Safari history databases on an interval to capture research trails.

## When to activate

- On startup: ensure the Trace service is running (`node packages/service/src/index.ts` from the Trace project root)
- On user request: "start tracking", "watch my research", "begin ingestion"

## How to run

Use the `exec` tool to start the Trace service process:

```bash
cd /Users/aaryan/Desktop/Trace && node --loader ts-node/esm packages/service/src/index.ts
```

The service starts both the screenshot watcher and browser history reader automatically.

## Configuration

The service reads configuration from `~/.trace/config.json` or environment variables:
- `TRACE_SCREENSHOT_DIR` — directory to watch (default: ~/Desktop)
- `TRACE_HISTORY_POLL_MS` — browser history poll interval in ms (default: 300000)
- `OPENAI_API_KEY` — required for OCR extraction

## Safety constraints

- Read-only access to browser history (copies DB to temp before reading)
- Only watches a single configured directory for screenshots
- No network access beyond OpenAI API calls
- No file modifications outside ~/.trace/
