#!/bin/bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common-macos.sh
. "$SCRIPT_DIR/common-macos.sh"

require_macos
discover_workbuddy
validate_workbuddy
discover_node
port="$(state_value port)"; port="${port:-$DEFAULT_PORT}"
mode="$(state_value mode)"; mode="${mode:-not-installed}"
printf 'Adapter: %s\n' "$ADAPTER_ID"
printf 'WorkBuddy: %s (%s)\n' "$WORKBUDDY_BUNDLE" "$WORKBUDDY_VERSION"
printf 'Signature: valid (%s / %s)\n' "$EXPECTED_BUNDLE_ID" "$EXPECTED_TEAM_ID"
printf 'State: %s\n' "$mode"
printf 'App process: %s\n' "$(workbuddy_running && printf running || printf stopped)"
printf 'CDP 127.0.0.1:%s: %s\n' "$port" "$(verify_debug_endpoint "$port" && printf verified || printf unavailable)"
printf 'Watch injector: %s\n' "$(injector_running && printf running || printf stopped)"
if verify_debug_endpoint "$port"; then
  "$NODE_RUNTIME" "$PROJECT_ROOT/scripts/injector.mjs" --verify --port "$port" --timeout-ms 4000 || true
fi
