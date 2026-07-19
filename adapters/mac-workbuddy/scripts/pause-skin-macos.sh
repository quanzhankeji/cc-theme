#!/bin/bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common-macos.sh
. "$SCRIPT_DIR/common-macos.sh"

report_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --report-file) [ "$#" -ge 2 ] || die "--report-file requires a value"; report_file="$2"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

require_macos
discover_workbuddy
validate_workbuddy
discover_node
port="$(state_value port)"; port="${port:-$DEFAULT_PORT}"
theme_dir="$(state_value theme_dir)"
stop_injector
if verify_debug_endpoint "$port"; then
  "$NODE_RUNTIME" "$PROJECT_ROOT/scripts/injector.mjs" --remove --port "$port" --timeout-ms 8000 >/dev/null
fi
write_state paused "$port" "$theme_dir"
write_operation_report "$report_file" pause ok pause-complete true "CC Theme was removed from the live WorkBuddy renderer"
log "Skin paused. WorkBuddy files were not modified."
