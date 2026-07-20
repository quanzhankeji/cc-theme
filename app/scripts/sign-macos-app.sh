#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
APP_BUNDLE="${1:-$APP_ROOT/src-tauri/target/release/bundle/macos/CC Theme.app}"
IDENTITY="${2:-${CC_THEME_SIGNING_IDENTITY:-}}"
NODE="$APP_BUNDLE/Contents/Resources/runtime/node/bin/node"
NODE_ENTITLEMENTS="$APP_ROOT/src-tauri/node-runtime.entitlements.plist"

[ -n "$IDENTITY" ] || {
  printf 'Set CC_THEME_SIGNING_IDENTITY or pass a Developer ID identity as argument 2.\n' >&2
  exit 2
}
[ -x "$NODE" ] || {
  printf 'Packaged Node runtime is missing.\n' >&2
  exit 1
}
/usr/bin/plutil -lint "$NODE_ENTITLEMENTS" >/dev/null

# Node/V8 alone receives the two executable-memory permissions needed by the
# declarative theme compiler. The Manager binary and Adapter scripts do not.
/usr/bin/codesign \
  --force \
  --timestamp \
  --options runtime \
  --entitlements "$NODE_ENTITLEMENTS" \
  --sign "$IDENTITY" \
  "$NODE"

# Re-seal the outer bundle after updating its nested runtime signature.
/usr/bin/codesign \
  --force \
  --timestamp \
  --options runtime \
  --sign "$IDENTITY" \
  "$APP_BUNDLE"

"$SCRIPT_DIR/verify-packaged-runtime.sh" "$APP_BUNDLE"
