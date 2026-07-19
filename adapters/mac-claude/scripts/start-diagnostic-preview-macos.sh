#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

enter_adapter_transaction diagnostic-preview-prepare "$SCRIPT_DIR/start-diagnostic-preview-macos.sh" "$@"

USER_CONFIRMED="false"
RESTART_CLAUDE="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --user-confirmed) USER_CONFIRMED="true"; shift ;;
    --restart-claude) RESTART_CLAUDE="true"; shift ;;
    *) fail "Unknown diagnostic preview argument: $1" ;;
  esac
done
[ "$USER_CONFIRMED" = "true" ] || fail "Diagnostic preview requires explicit user confirmation."
[ "$RESTART_CLAUDE" = "true" ] || fail "Diagnostic preview requires explicit permission to restart Claude."

cleanup_legacy_launchd_jobs
discover_claude_app
require_macos_runtime
ensure_state_root

THEME_SOURCE="$THEME_DIR"
[ -f "$THEME_SOURCE/theme.json" ] \
  || fail "Diagnostic preview requires an active theme imported from a verified external Theme Package."

stop_diagnostic_preview_server
if claude_is_running; then
  stop_claude true
fi

/bin/rm -f "$DIAGNOSTIC_PREVIEW_READY_PATH"
: > "$DIAGNOSTIC_PREVIEW_LOG"
: > "$DIAGNOSTIC_PREVIEW_ERROR_LOG"
remove_launchd_job_label "$DIAGNOSTIC_PREVIEW_JOB_LABEL"
/bin/launchctl submit -l "$DIAGNOSTIC_PREVIEW_JOB_LABEL" \
  -o "$DIAGNOSTIC_PREVIEW_LOG" -e "$DIAGNOSTIC_PREVIEW_ERROR_LOG" -- \
  "$NODE" "$SCRIPT_DIR/diagnostic-preview-server.mjs" \
  --theme-dir "$THEME_SOURCE" \
  --state-file "$DIAGNOSTIC_PREVIEW_STATE_PATH" \
  --ready-file "$DIAGNOSTIC_PREVIEW_READY_PATH" \
  >/dev/null

READY_DEADLINE=$((SECONDS + 25))
while [ ! -f "$DIAGNOSTIC_PREVIEW_READY_PATH" ] && [ "$SECONDS" -lt "$READY_DEADLINE" ]; do
  /bin/sleep 0.1
done
SERVER_PID="$(/usr/bin/plutil -extract serverPid raw -o - "$DIAGNOSTIC_PREVIEW_STATE_PATH" 2>/dev/null || true)"
if [ ! -f "$DIAGNOSTIC_PREVIEW_READY_PATH" ] || [ -z "$SERVER_PID" ] || ! /bin/kill -0 "$SERVER_PID" 2>/dev/null; then
  remove_launchd_job_label "$DIAGNOSTIC_PREVIEW_JOB_LABEL"
  fail "Diagnostic preview server did not become ready."
fi

if ! launch_claude_with_devtools; then
  stop_diagnostic_preview_server
  fail "Claude diagnostic DevTools launch failed."
fi

"$NODE" -e '
  const fs = require("node:fs");
  const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  state.claudeRunning = true;
  state.devToolsLaunchRequested = true;
  state.runtimeApplyAvailable = false;
  state.diagnosticPreviewAvailable = true;
  console.log(JSON.stringify(state, null, 2));
' "$DIAGNOSTIC_PREVIEW_STATE_PATH"
