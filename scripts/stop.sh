#!/bin/bash
# Brainch — Stop everything with one command

echo "🛑 Stopping Brainch..."

# 1. Stop API server
if [ -f .brainch-service.pid ]; then
  kill $(cat .brainch-service.pid) 2>/dev/null && echo "→ API server stopped" || echo "→ API server not running"
  rm -f .brainch-service.pid
else
  echo "→ No API server PID found (may not be running)"
fi

# 2. Stop Dashboard
if [ -f .brainch-dashboard.pid ]; then
  kill $(cat .brainch-dashboard.pid) 2>/dev/null && echo "→ Dashboard stopped" || echo "→ Dashboard not running"
  rm -f .brainch-dashboard.pid
else
  echo "→ No dashboard PID found (may not be running)"
fi

# 3. Stop OpenClaw daemon
if command -v openclaw &> /dev/null; then
  echo "→ Stopping OpenClaw daemon..."
  if openclaw daemon stop; then
    echo "→ OpenClaw daemon stopped."
  else
    echo "→ openclaw daemon stop failed — trying LaunchAgent fallback..."
    launchctl unload ~/Library/LaunchAgents/ai.openclaw.gateway.plist 2>/dev/null && \
      echo "→ OpenClaw LaunchAgent unloaded." || \
      echo "→ LaunchAgent not loaded (already stopped)."
  fi
fi

echo ""
echo "✅ Brainch fully stopped."
