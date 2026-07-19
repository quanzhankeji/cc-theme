#!/bin/bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common-macos.sh
. "$SCRIPT_DIR/common-macos.sh"

require_macos
log "macOS: ok"
discover_workbuddy
validate_workbuddy
log "WorkBuddy identity: ok ($EXPECTED_BUNDLE_ID, team $EXPECTED_TEAM_ID, version $WORKBUDDY_VERSION)"
discover_node
log "Node runtime: ok ($NODE_RUNTIME, $($NODE_RUNTIME --version))"
for file in \
  "$PROJECT_ROOT/assets/skin.css" \
  "$PROJECT_ROOT/assets/renderer-inject.js" \
  "$PROJECT_ROOT/assets/ui-interpreter.js" \
  "$PROJECT_ROOT/assets/theme-settings-session.js" \
  "$PROJECT_ROOT/contracts/operation-result.schema.json" \
  "$PROJECT_ROOT/contracts/adapter-capability.json" \
  "$PROJECT_ROOT/contracts/adapter-capability.schema.json" \
  "$PROJECT_ROOT/contracts/target-profile.schema.json" \
  "$PROJECT_ROOT/contracts/theme-runtime-settings.schema.json" \
  "$PROJECT_ROOT/contracts/theme-style-catalog.json" \
  "$PROJECT_ROOT/contracts/theme-settings-locales.json" \
  "$PROJECT_ROOT/contracts/adapter-release-manifest.json" \
  "$PROJECT_ROOT/scripts/adapter-capability.mjs" \
  "$PROJECT_ROOT/scripts/adapter-release.mjs" \
  "$PROJECT_ROOT/scripts/adapter-transaction.mjs" \
  "$PROJECT_ROOT/scripts/operation-result.mjs" \
  "$PROJECT_ROOT/scripts/theme-runtime-settings.mjs" \
  "$PROJECT_ROOT/scripts/workbuddy-theme-projection.mjs" \
  "$PROJECT_ROOT/scripts/theme-style-catalog.mjs" \
  "$PROJECT_ROOT/scripts/theme-settings-locales.mjs" \
  "$PROJECT_ROOT/scripts/injector.mjs" \
  "$PROJECT_ROOT/skills/repair-workbuddy-compatibility/SKILL.md"; do
  [ -f "$file" ] || die "Required file is missing: $file"
done
"$NODE_RUNTIME" "$PROJECT_ROOT/scripts/adapter-capability.mjs" >/dev/null
log "Adapter capability and versioned catalogs: ok"
theme_dir="$(state_value theme_dir)"
if [ -n "$theme_dir" ]; then
  [ -d "$theme_dir" ] && [ ! -L "$theme_dir" ] || die "Selected external theme directory is missing or unsafe: $theme_dir"
  "$NODE_RUNTIME" "$PROJECT_ROOT/scripts/injector.mjs" --check-payload \
    --theme-dir "$theme_dir" --themes-root "$STATE_DIR/themes" >/dev/null
  log "Selected external theme and renderer payload: ok"
else
  log "External theme payload: skipped (WorkBuddy remains in its native state)"
fi
port="$(state_value port)"; port="${port:-$DEFAULT_PORT}"
if verify_debug_endpoint "$port"; then
  log "CDP ownership: verified WorkBuddy listener on 127.0.0.1:$port"
  if "$NODE_RUNTIME" "$PROJECT_ROOT/scripts/injector.mjs" --verify --port "$port" --timeout-ms 4000 >/dev/null 2>&1; then
    log "Live skin: verified"
  else
    warn "CDP is available, but the skin is not currently active."
  fi
else
  log "CDP/live check: skipped (WorkBuddy is not running with the adapter endpoint)"
fi
log "Doctor completed successfully."
