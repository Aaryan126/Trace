#!/bin/bash
# Trace — fully stop the local Trace service and OpenClaw.

set -u

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_PID_FILE="$PROJECT_DIR/.trace-service.pid"
MENUBAR_PID_FILE="$PROJECT_DIR/.trace-menubar.pid"
TRACE_RUNTIME_DIR="$HOME/.trace"
CHROME_HOST_MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.trace.browser_capture.json"
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

stop_openclaw_gateway_processes() {
  local pid command
  while read -r pid; do
    [ -n "$pid" ] || continue
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    case "$command" in
      *openclaw/dist/index.js*gateway*)
        kill "$pid" 2>/dev/null || true
        ;;
    esac
  done < <(pgrep -f 'openclaw/dist/index.js.*gateway' 2>/dev/null || true)
}

stop_menubar() {
  if [ ! -f "$MENUBAR_PID_FILE" ]; then
    echo "Trace menu-bar app is not running."
    return
  fi
  local pid command
  pid="$(cat "$MENUBAR_PID_FILE")"
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$command" in
    *Trace.app/Contents/MacOS/Trace)
      kill "$pid" 2>/dev/null || true
      echo "Trace menu-bar app stopped."
      ;;
    "") echo "Trace menu-bar app was already stopped." ;;
    *) echo "Refusing to stop PID $pid because it is not the Trace menu-bar app: $command"; return 1 ;;
  esac
  rm -f "$MENUBAR_PID_FILE"
}

stop_service() {
  if [ ! -f "$SERVICE_PID_FILE" ]; then
    echo "Trace service is not running."
    return
  fi

  PID="$(cat "$SERVICE_PID_FILE")"
  COMMAND="$(ps -p "$PID" -o command= 2>/dev/null || true)"
  case "$COMMAND" in
    *packages/service/dist/index.js*|*packages/service/src/index.ts*)
      kill "$PID" 2>/dev/null || true
      for _ in 1 2 3 4 5; do
        kill -0 "$PID" 2>/dev/null || break
        sleep 1
      done
      echo "Trace service stopped."
      ;;
    "")
      echo "Trace service was already stopped."
      ;;
    *)
      echo "Refusing to stop PID $PID because it is not a Trace service: $COMMAND"
      return 1
      ;;
  esac
  rm -f "$SERVICE_PID_FILE"
}

stop_menubar
stop_service

rm -f "$TRACE_RUNTIME_DIR/capture-token" "$TRACE_RUNTIME_DIR/capture-port" "$CHROME_HOST_LAUNCHER" "$CHROME_HOST_MANIFEST"
echo "Trace Chrome capture bridge stopped."

if command -v openclaw >/dev/null 2>&1; then
  echo "Stopping OpenClaw..."
  run_with_timeout 15 openclaw daemon stop || true
  run_with_timeout 15 openclaw daemon uninstall || true
  launchctl bootout "gui/$(id -u)/ai.openclaw.gateway" 2>/dev/null || true
  stop_openclaw_gateway_processes
fi

rm -f "$PROJECT_DIR/.trace-openclaw-owned"
