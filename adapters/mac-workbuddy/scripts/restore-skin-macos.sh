#!/bin/bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common-macos.sh
. "$SCRIPT_DIR/common-macos.sh"

restart_normal=1
report_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-restart) restart_normal=0; shift ;;
    --report-file) [ "$#" -ge 2 ] || die "--report-file requires a value"; report_file="$2"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done
require_macos
discover_workbuddy
validate_workbuddy
discover_node
port="$(state_value port)"; port="${port:-$DEFAULT_PORT}"
stop_injector
if verify_debug_endpoint "$port"; then
  "$NODE_RUNTIME" "$PROJECT_ROOT/scripts/injector.mjs" --remove --port "$port" --timeout-ms 8000 >/dev/null || true
fi
if [ "$restart_normal" -eq 1 ] && workbuddy_running; then
  stop_workbuddy
  launch_workbuddy_normal
fi
/bin/rm -f "$STATE_FILE" "$INJECTOR_PID_FILE"
write_operation_report "$report_file" restore ok restore-complete true "WorkBuddy was restored to its native UI"
log "WorkBuddy restored to its native UI; app.asar and the application signature were never changed."
