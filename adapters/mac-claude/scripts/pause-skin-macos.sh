#!/bin/bash

# Soft-off: remove the live skin and stop the injector. Does not restart Claude
# and does not restore the official base theme backup.

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

enter_adapter_transaction pause "$SCRIPT_DIR/pause-skin-macos.sh" "$@"

PORT=9451
PORT_EXPLICIT="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; PORT_EXPLICIT="true"; shift 2 ;;
    *) fail "Unknown pause argument: $1" ;;
  esac
done

cleanup_legacy_launchd_jobs
discover_claude_app
require_macos_runtime
ensure_state_root
DIAGNOSTIC_PREVIEW_STOPPED="false"
if [ -f "$DIAGNOSTIC_PREVIEW_STATE_PATH" ]; then
  stop_diagnostic_preview_server
  DIAGNOSTIC_PREVIEW_STOPPED="true"
fi

if [ "$PORT_EXPLICIT" = "false" ] && [ -f "$STATE_PATH" ]; then
  saved_port="$(state_field port 2>/dev/null || true)"
  [ -n "${saved_port:-}" ] && PORT="$saved_port"
fi

REMOVED="false"
# Drop any obsolete launchd job that would relaunch Claude with CDP after quit.
release_claude_launchd_job || true
if [ -f "$STATE_PATH" ]; then
  stop_recorded_injector || true
fi

DEBUG_READY="false"
if verified_cdp_endpoint "$PORT" 2>/dev/null; then
  DEBUG_READY="true"
fi

if [ "$DEBUG_READY" = "true" ]; then
  "$NODE" "$INJECTOR" --remove --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 8000 >/dev/null \
    || fail "Could not remove the live skin from Claude."
  REMOVED="true"
fi

"$NODE" -e '
  const fs = require("node:fs");
  const file = process.argv[1];
  const port = Number(process.argv[2]);
  const themeDir = process.argv[3];
  const root = process.argv[4];
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  const state = {
    ...prev,
    schemaVersion: 4,
    session: "paused",
    port,
    injectorPid: 0,
    injectorStartedAt: "",
    themeDir,
    projectRoot: root,
    pausedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
' "$STATE_PATH" "$PORT" "$THEME_DIR" "$PROJECT_ROOT"

CLAUDE_RUNNING="false"
claude_is_running && CLAUDE_RUNNING="true"
"$NODE" -e '
  const [port, removed, running, cdp, diagnosticStopped] = process.argv.slice(1);
  console.log(JSON.stringify({
    kind: "cc-theme.lifecycle-result", schemaVersion: 1, phase: "pause",
    status: "passed", pass: true, failureCategory: null, code: "ok",
    adapter: "mac-claude", privacy: "structure-only-no-user-content",
    details: {
      port: Number(port),
      liveSkinRemoved: removed === "true",
      claudeRunning: running === "true",
      cdpVerified: cdp === "true",
      diagnosticPreviewServerStopped: diagnosticStopped === "true",
      rendererCleanupPending: diagnosticStopped === "true" && running === "true" && removed !== "true"
    }
  }, null, 2));
' "$PORT" "$REMOVED" "$CLAUDE_RUNNING" "$DEBUG_READY" "$DIAGNOSTIC_PREVIEW_STOPPED"
