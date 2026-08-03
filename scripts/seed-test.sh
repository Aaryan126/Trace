#!/bin/bash
# Brainch — Seed test data and optionally start the app
# Usage: ./scripts/seed-test.sh [--start]
#
# Seeds the database with realistic test data so you can see the dashboard
# populated with threads, commits, feed events, and unprocessed items.
#
# Add --start to automatically start the app after seeding.

set -euo pipefail

cd "$(dirname "$0")/.."

echo "🧠 Seeding Brainch with test data..."
echo ""

npx tsx scripts/seed.ts

if [ "${1:-}" = "--start" ]; then
  echo ""
  echo "Starting Brainch..."
  ./scripts/start.sh
fi
