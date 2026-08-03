#!/bin/bash
# Brainch — Start everything with one command
# Manages: OpenClaw daemon, API server, Dashboard

set -e

echo "🧠 Starting Brainch..."
echo ""

# Load .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^\s*$' | xargs)
else
  echo "❌ No .env file found. Create one with your OPENAI_API_KEY."
  exit 1
fi

if [ "$OPENAI_API_KEY" = "your-api-key-here" ] || [ -z "$OPENAI_API_KEY" ]; then
  echo "❌ Please set your OPENAI_API_KEY in .env"
  exit 1
fi

# 1. Start OpenClaw daemon (if installed)
if command -v openclaw &> /dev/null; then
  echo "→ Starting OpenClaw daemon..."
  openclaw daemon start 2>/dev/null || echo "  (already running)"
else
  echo "→ OpenClaw not installed — skipping scheduled agents"
fi

# 2. Start API server
echo "→ Starting API server on http://127.0.0.1:${BRAINCH_PORT:-3333}..."
npx tsx packages/service/src/index.ts &
SERVICE_PID=$!
echo $SERVICE_PID > .brainch-service.pid

# 3. Start Dashboard
echo "→ Starting dashboard on http://127.0.0.1:5173..."
npx vite packages/dashboard --host 127.0.0.1 &
DASHBOARD_PID=$!
echo $DASHBOARD_PID > .brainch-dashboard.pid

# Wait a moment for services to start
sleep 2

echo ""
echo "✅ Brainch is running!"
echo "   API:       http://127.0.0.1:${BRAINCH_PORT:-3333}"
echo "   Dashboard: http://127.0.0.1:5173"
if command -v openclaw &> /dev/null; then
  echo "   OpenClaw:  $(openclaw daemon status 2>/dev/null || echo 'running')"
fi
echo ""
echo "To stop everything: ./scripts/stop.sh"
echo "Press Ctrl+C to stop."

cleanup() {
  # Prevent set -e from aborting cleanup mid-way
  set +e
  echo ""
  echo "🛑 Shutting down Brainch..."

  echo "→ Stopping API server (PID $SERVICE_PID)..."
  kill $SERVICE_PID 2>/dev/null
  echo "→ Stopping dashboard (PID $DASHBOARD_PID)..."
  kill $DASHBOARD_PID 2>/dev/null
  rm -f .brainch-service.pid .brainch-dashboard.pid

  if command -v openclaw &> /dev/null; then
    # Brief pause to let child processes die before stopping the daemon
    sleep 1
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

  echo "✅ Brainch stopped."
}

# Trap EXIT for normal exits, INT/TERM so Ctrl+C and kill are handled explicitly.
# On INT/TERM we call exit which then triggers the EXIT trap reliably.
trap cleanup EXIT
trap 'exit 130' INT TERM
wait
