#!/bin/bash
# Trace — build and start the local service, ingestion, and dashboard.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_PID_FILE="$PROJECT_DIR/.trace-service.pid"
MENUBAR_PID_FILE="$PROJECT_DIR/.trace-menubar.pid"
PORT="${TRACE_PORT:-3333}"
TRACE_RUNTIME_DIR="$HOME/.trace"
CHROME_HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
CHROME_HOST_MANIFEST="$CHROME_HOST_DIR/com.trace.browser_capture.json"
CHROME_HOST_LAUNCHER="$TRACE_RUNTIME_DIR/trace-chrome-host"

run_with_timeout() {
  local seconds="$1"
  shift
  "$@" &
  local child_pid=$!
  for ((elapsed = 0; elapsed < seconds; elapsed++)); do
    kill -0 "$child_pid" 2>/dev/null || { wait "$child_pid"; return $?; }
    sleep 1
  done
  kill "$child_pid" 2>/dev/null || true
  sleep 1
  kill -9 "$child_pid" 2>/dev/null || true
  wait "$child_pid" 2>/dev/null || true
  return 124
}

cd "$PROJECT_DIR"

if [ ! -f .env ]; then
  echo "Trace requires $PROJECT_DIR/.env with OPENAI_API_KEY set."
  exit 1
fi

if ! grep -Eq '^OPENAI_API_KEY=.+$' .env || grep -Eq '^OPENAI_API_KEY=your-api-key-here$' .env; then
  echo "Set a real OPENAI_API_KEY in $PROJECT_DIR/.env."
  exit 1
fi

if [ -f "$SERVICE_PID_FILE" ] && kill -0 "$(cat "$SERVICE_PID_FILE")" 2>/dev/null; then
  echo "Trace is already running (PID $(cat "$SERVICE_PID_FILE"))."
  exit 0
fi

echo "Building Trace..."
pnpm build
MENUBAR_APP="$($PROJECT_DIR/scripts/build-menubar.sh)"
MENUBAR_EXECUTABLE="$MENUBAR_APP/Contents/MacOS/Trace"
CAPTURE_TOKEN="$(openssl rand -hex 32)"
NODE_EXECUTABLE="$(command -v node)"

mkdir -p "$TRACE_RUNTIME_DIR" "$CHROME_HOST_DIR"
chmod 700 "$TRACE_RUNTIME_DIR"
umask 077
printf '%s' "$CAPTURE_TOKEN" > "$TRACE_RUNTIME_DIR/capture-token"
printf '%s' "$PORT" > "$TRACE_RUNTIME_DIR/capture-port"
printf '#!/bin/sh\nexec "%s" "%s"\n' "$NODE_EXECUTABLE" "$PROJECT_DIR/scripts/trace-chrome-host.mjs" > "$CHROME_HOST_LAUNCHER"
chmod 700 "$CHROME_HOST_LAUNCHER"
printf '{\n  "name": "com.trace.browser_capture",\n  "description": "Trace browser capture bridge",\n  "path": "%s",\n  "type": "stdio",\n  "allowed_origins": ["chrome-extension://maahnfbolbhanbmofehlmmgkbjcgilgn/"]\n}\n' \
  "$CHROME_HOST_LAUNCHER" > "$CHROME_HOST_MANIFEST"

if command -v openclaw >/dev/null 2>&1; then
  if openclaw daemon status 2>/dev/null | grep -qi running; then
    echo "Using the existing OpenClaw daemon."
  else
    echo "Starting OpenClaw daemon..."
    openclaw daemon start || true
    if ! openclaw daemon status 2>/dev/null | grep -qi 'Runtime: running'; then
      echo "Installing the OpenClaw LaunchAgent..."
      openclaw daemon install
      openclaw daemon start
    fi
  fi
fi

if command -v openclaw >/dev/null 2>&1 && openclaw daemon status 2>/dev/null | grep -qi 'Runtime: running'; then
  OPENCLAW_READY=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if run_with_timeout 4 openclaw cron list --json >/dev/null 2>&1; then
      OPENCLAW_READY=1
      break
    fi
    sleep 2
  done
  if [ "$OPENCLAW_READY" -eq 1 ]; then
    echo "Synchronizing Trace recovery jobs..."
    if ! run_with_timeout 20 "$PROJECT_DIR/scripts/setup-cron.sh" >/dev/null 2>&1; then
      echo "Warning: OpenClaw jobs could not be synchronized; Trace live automation will still run."
    fi
  else
    echo "Warning: OpenClaw scheduler was not ready; Trace live automation will still run."
  fi
fi

echo "Starting Trace at http://127.0.0.1:$PORT..."
TRACE_PORT="$PORT" TRACE_CAPTURE_TOKEN="$CAPTURE_TOKEN" node packages/service/dist/index.js &
SERVICE_PID=$!
echo "$SERVICE_PID" > "$SERVICE_PID_FILE"

echo "Starting the Trace menu-bar app..."
TRACE_PORT="$PORT" TRACE_CAPTURE_TOKEN="$CAPTURE_TOKEN" "$MENUBAR_EXECUTABLE" &
MENUBAR_PID=$!
echo "$MENUBAR_PID" > "$MENUBAR_PID_FILE"

cleanup() {
  set +e
  if kill -0 "$MENUBAR_PID" 2>/dev/null; then
    kill "$MENUBAR_PID" 2>/dev/null
    wait "$MENUBAR_PID" 2>/dev/null
  fi
  rm -f "$MENUBAR_PID_FILE"
  if kill -0 "$SERVICE_PID" 2>/dev/null; then
    kill "$SERVICE_PID" 2>/dev/null
    wait "$SERVICE_PID" 2>/dev/null
  fi
  rm -f "$SERVICE_PID_FILE"
  rm -f "$TRACE_RUNTIME_DIR/capture-token" "$TRACE_RUNTIME_DIR/capture-port" "$CHROME_HOST_LAUNCHER" "$CHROME_HOST_MANIFEST"
  if command -v openclaw >/dev/null 2>&1; then
    echo "Stopping OpenClaw..."
    openclaw daemon stop || true
    openclaw daemon uninstall || true
  fi
}
trap cleanup EXIT INT TERM

READY=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl --silent --fail "http://127.0.0.1:$PORT/api/health" >/dev/null; then
    READY=1
    break
  fi
  if ! kill -0 "$SERVICE_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "Trace did not become healthy; shutting down."
  exit 1
fi

echo "Trace is ready. Dashboard and API: http://127.0.0.1:$PORT"
echo "The Trace menu-bar app and Chrome capture bridge are linked to this service."
echo "One-time Chrome setup: open chrome://extensions, enable Developer mode, then Load unpacked:"
echo "  $PROJECT_DIR/browser-extension"
echo "Press Ctrl+C or run ./scripts/stop.sh to stop it."
wait "$SERVICE_PID"
