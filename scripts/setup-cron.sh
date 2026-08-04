#!/bin/bash
# Declare Trace command jobs in OpenClaw. Safe to run repeatedly.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

declare_job() {
  openclaw cron create \
    --declaration-key "$1" \
    --name "$2" \
    "${@:3}" \
    --command-cwd "$PROJECT_DIR" \
    --no-deliver \
    --timeout-seconds 600 \
    --output-max-bytes 20000
}

remove_legacy_job() {
  local declaration_key="$1"
  local job_ids
  job_ids="$(openclaw cron list --all --json 2>/dev/null | node -e '
    let input=""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => {
      try { const parsed=JSON.parse(input); const jobs=Array.isArray(parsed) ? parsed : (parsed.jobs || []);
        for (const job of jobs) if (job.declarationKey === process.argv[1] || job.declaration_key === process.argv[1]) console.log(job.id);
      } catch {}
    });
  ' "$declaration_key")"
  while IFS= read -r job_id; do
    [ -n "$job_id" ] && openclaw cron rm "$job_id"
  done <<< "$job_ids"
  return 0
}

remove_legacy_job trace.cluster
remove_legacy_job trace.synthesize
remove_legacy_job trace.resurface

declare_job trace.recover trace-recovery \
  --every 5m --command-argv '["pnpm","--filter","@trace/service","cli","recover"]'

declare_job trace.reconcile trace-reconciliation \
  --every 15m --command-argv '["pnpm","--filter","@trace/service","cli","reconcile"]'

declare_job trace.digest trace-weekly-digest \
  --cron '0 9 * * 1' --tz Asia/Singapore --command-argv '["pnpm","--filter","@trace/service","cli","digest"]'

echo "Trace OpenClaw jobs declared. Verify with: openclaw cron list"
