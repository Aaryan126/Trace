#!/bin/bash
# Sets up OpenClaw cron jobs for Brainch agents
# Run this once after OpenClaw is installed and configured

echo "Setting up Brainch cron jobs..."

# Clustering - every 30 minutes
openclaw cron create --every 30m --name "brainch-clustering" --session isolated \
  --message "Run Brainch clustering: assign new items to threads"

# Synthesis - every 6 hours
openclaw cron create --every 6h --name "brainch-synthesis" --session isolated \
  --message "Run Brainch synthesis: close quiet threads into commits"

# Resurfacing check - every hour
openclaw cron create --every 1h --name "brainch-resurface-check" --session isolated \
  --message "Run Brainch resurfacing: check for reopens and generate diffs"

# Weekly digest - Monday 9 AM
openclaw cron create --cron "0 9 * * 1" --name "brainch-weekly-digest" --session isolated \
  --message "Run Brainch weekly digest for open threads"

echo "Done! Verify with: openclaw cron list"
