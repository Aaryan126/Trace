#!/bin/bash
# Build the native Trace menu-bar app bundle used by start.sh.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_DIR="$PROJECT_DIR/menubar/Trace"
APP_DIR="$PROJECT_DIR/.trace-build/Trace.app"
CACHE_DIR="$PROJECT_DIR/.trace-build/swift-cache"

mkdir -p "$CACHE_DIR"
SWIFTPM_MODULECACHE_OVERRIDE="$CACHE_DIR" CLANG_MODULE_CACHE_PATH="$CACHE_DIR" \
  swift build -c release --package-path "$PACKAGE_DIR" >&2
mkdir -p "$APP_DIR/Contents/MacOS"
install -m 755 "$PACKAGE_DIR/.build/release/Trace" "$APP_DIR/Contents/MacOS/Trace"
install -m 644 "$PACKAGE_DIR/Resources/Info.plist" "$APP_DIR/Contents/Info.plist"
SIGNING_IDENTITY="${TRACE_CODESIGN_IDENTITY:-}"
if [ -z "$SIGNING_IDENTITY" ]; then
  SIGNING_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk '/"Apple Development:/{print $2; exit}')"
fi
if [ -n "$SIGNING_IDENTITY" ]; then
  codesign --force --sign "$SIGNING_IDENTITY" --timestamp=none --identifier com.trace.local "$APP_DIR" >/dev/null
else
  echo "Warning: no Apple Development signing identity found; Screen Recording permission may need to be granted after each rebuild." >&2
  codesign --force --sign - --identifier com.trace.local "$APP_DIR" >/dev/null
fi
echo "$APP_DIR"
