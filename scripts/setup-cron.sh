#!/bin/bash
# Sets up OpenClaw cron jobs for Trace agents
# Run this once after OpenClaw is installed and configured

echo "Setting up Trace cron jobs..."

# Clustering - every 30 minutes
openclaw cron create --every 30m --name "trace-clustering" --session isolated \
  --message "Run Trace clustering: assign new items to threads"

# Synthesis - every 6 hours
openclaw cron create --every 6h --name "trace-synthesis" --session isolated \
  --message "Run Trace synthesis: close quiet threads into commits"

# Resurfacing check - every hour
openclaw cron create --every 1h --name "trace-resurface-check" --session isolated \
  --message "Run Trace resurfacing: check for reopens and generate diffs"

# Weekly digest - Monday 9 AM
openclaw cron create --cron "0 9 * * 1" --name "trace-weekly-digest" --session isolated \
  --message "Run Trace weekly digest for open threads"

echo "Done! Verify with: openclaw cron list"
