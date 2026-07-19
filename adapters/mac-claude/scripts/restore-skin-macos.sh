#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

enter_adapter_transaction restore "$SCRIPT_DIR/restore-skin-macos.sh" "$@"

PORT=9451
PORT_EXPLICIT="false"
RESTORE_BASE_THEME="false"
RESTART_CLAUDE="false"
UNINSTALL="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; PORT_EXPLICIT="true"; shift 2 ;;
    --restore-base-theme) RESTORE_BASE_THEME="true"; shift ;;
    --restart-claude) RESTART_CLAUDE="true"; shift ;;
    --uninstall) UNINSTALL="true"; shift ;;
    *) fail "Unknown restore argument: $1" ;;
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
  PORT="$(state_field port)" || fail "Could not read the saved CDP port; state was preserved."
fi

[ -f "$STATE_PATH" ] && stop_recorded_injector
# Always remove the themed Claude launchd babysitter so quitting Claude stays quit.
release_claude_launchd_job || true
CLAUDE_RUNNING="false"
claude_is_running && CLAUDE_RUNNING="true"
DEBUG_READY="false"
verified_cdp_endpoint "$PORT" && DEBUG_READY="true"

if [ "$DEBUG_READY" = "true" ]; then
  "$NODE" "$INJECTOR" --remove --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 8000 >/dev/null \
    || fail "The live skin could not be removed and verified; restore stopped safely."
elif [ "$CLAUDE_RUNNING" = "true" ] && [ "$RESTART_CLAUDE" = "false" ]; then
  fail "Claude is still running but its saved CDP endpoint cannot be verified. Pass --restart-claude for a full restore."
fi

if [ "$RESTORE_BASE_THEME" = "true" ]; then
  printf 'Claude Desktop stores appearance in its web renderer; no Claude Code config file was changed.\n'
fi

if [ "$RESTART_CLAUDE" = "true" ]; then
  [ "$CLAUDE_RUNNING" = "true" ] && stop_claude true
  launch_claude_normally
fi

/bin/rm -f "$STATE_PATH"
if [ "$UNINSTALL" = "true" ]; then
  "$SCRIPT_DIR/launcher-app-macos.sh" remove \
    --output "$HOME/Applications/CC Theme.app" >/dev/null \
    || fail "The CC Theme launcher app could not be removed safely."
  /bin/rm -f "$HOME/Desktop/CC Theme.command"
  /bin/rm -f "$HOME/Desktop/CC Theme - Customize.command"
  /bin/rm -f "$HOME/Desktop/CC Theme - Verify.command"
  /bin/rm -f "$HOME/Desktop/CC Theme - Restore.command"
  if [ -f "$INSTALL_ROOT/PROJECT_MANIFEST.json" ] &&
     /usr/bin/grep -q '"kind": "mac-claude.repository"' "$INSTALL_ROOT/PROJECT_MANIFEST.json"; then
    /bin/rm -rf "$INSTALL_ROOT"
  fi
  case "$STATE_ROOT" in
    "$HOME/Library/Application Support/CCTheme/claude") /bin/rm -rf "$STATE_ROOT" ;;
    *) fail "Refusing to remove an unexpected Claude state root: $STATE_ROOT" ;;
  esac
fi

"$NODE" -e '
  const [port, restarted, uninstall, diagnosticStopped] = process.argv.slice(1);
  console.log(JSON.stringify({
    kind: "cc-theme.lifecycle-result", schemaVersion: 1, phase: "restore",
    status: "passed", pass: true, failureCategory: null, code: "ok",
    adapter: "mac-claude", privacy: "structure-only-no-user-content",
    details: {
      port: Number(port),
      restartedClaude: restarted === "true",
      uninstalled: uninstall === "true",
      diagnosticPreviewServerStopped: diagnosticStopped === "true",
      cleanupComplete: true
    }
  }, null, 2));
' "$PORT" "$RESTART_CLAUDE" "$UNINSTALL" "$DIAGNOSTIC_PREVIEW_STOPPED"
