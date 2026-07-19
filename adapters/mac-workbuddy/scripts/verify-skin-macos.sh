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
verify_debug_endpoint "$port" || die "No verified WorkBuddy CDP endpoint on port $port."
exec "$NODE_RUNTIME" "$PROJECT_ROOT/scripts/injector.mjs" --verify --port "$port" --timeout-ms 10000 "$@"
