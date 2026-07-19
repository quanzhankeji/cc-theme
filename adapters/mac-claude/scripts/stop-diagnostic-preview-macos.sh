#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

enter_adapter_transaction diagnostic-preview-stop "$SCRIPT_DIR/stop-diagnostic-preview-macos.sh" "$@"

RESTART_NORMAL="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --restart-normal) RESTART_NORMAL="true"; shift ;;
    *) fail "Unknown diagnostic preview stop argument: $1" ;;
  esac
done

cleanup_legacy_launchd_jobs
discover_claude_app
require_macos_runtime
ensure_state_root
HAD_STATE="false"
[ -f "$DIAGNOSTIC_PREVIEW_STATE_PATH" ] && HAD_STATE="true"
stop_diagnostic_preview_server

CLAUDE_RUNNING="false"
claude_is_running && CLAUDE_RUNNING="true"
if [ "$RESTART_NORMAL" = "true" ]; then
  [ "$CLAUDE_RUNNING" = "false" ] || stop_claude true
  launch_claude_normally
  CLAUDE_RUNNING="true"
fi

"$NODE" -e '
  const [hadState, restarted, running] = process.argv.slice(1);
  console.log(JSON.stringify({
    kind: "cc-theme.diagnostic-preview-result",
    schemaVersion: 1,
    adapterId: "mac-claude",
    operation: "stop",
    status: "stopped",
    pass: true,
    code: "diagnostic-preview-stopped",
    runtimeApplyAvailable: false,
    diagnosticPreviewAvailable: true,
    previousSessionFound: hadState === "true",
    restartedNormalClaude: restarted === "true",
    claudeRunning: running === "true",
    rendererCleanupPending: restarted !== "true" && running === "true",
    cleanupComplete: restarted === "true" || running !== "true",
    privacy: "structure-only-no-user-content"
  }, null, 2));
' "$HAD_STATE" "$RESTART_NORMAL" "$CLAUDE_RUNNING"

