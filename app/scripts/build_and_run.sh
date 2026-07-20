#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="CC Theme"
PROCESS_NAME="cc-theme"
BUNDLE_ID="com.quanzhankeji.cc-theme"
APP_BUNDLE="$APP_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/$PROCESS_NAME"

pkill -x "$PROCESS_NAME" >/dev/null 2>&1 || true

(
  cd "$APP_DIR"
  npm run tauri:build -- --bundles app
)

if [ -n "${CC_THEME_SIGNING_IDENTITY:-}" ]; then
  "$APP_DIR/scripts/sign-macos-app.sh" "$APP_BUNDLE" "$CC_THEME_SIGNING_IDENTITY"
else
  # Recent Rust/linker toolchains can leave a local Tauri bundle only
  # linker-signed. Seal the copied Node entitlement first, then the outer app,
  # so strict resource verification represents the artifact we actually run.
  LOCAL_NODE="$APP_BUNDLE/Contents/Resources/runtime/node/bin/node"
  /usr/bin/codesign --force --sign - \
    --entitlements "$APP_DIR/src-tauri/node-runtime.entitlements.plist" "$LOCAL_NODE"
  /usr/bin/codesign --force --sign - "$APP_BUNDLE"
  "$APP_DIR/scripts/verify-packaged-runtime.sh" "$APP_BUNDLE"
fi

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

case "$MODE" in
  run)
    open_app
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$PROCESS_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    sleep 2
    pgrep -x "$PROCESS_NAME" >/dev/null
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
