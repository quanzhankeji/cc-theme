#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

PORT=9341
PORT_EXPLICIT="false"
RESTORE_BASE_THEME="false"
RESTART_CODEX="false"
UNINSTALL="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; PORT_EXPLICIT="true"; shift 2 ;;
    --restore-base-theme) RESTORE_BASE_THEME="true"; shift ;;
    --restart-codex) RESTART_CODEX="true"; shift ;;
    --uninstall) UNINSTALL="true"; shift ;;
    *) fail "Unknown restore argument: $1" ;;
  esac
done

cleanup_legacy_launchd_jobs
discover_codex_app
require_macos_runtime
ensure_state_root
if [ "$PORT_EXPLICIT" = "false" ] && [ -f "$STATE_PATH" ]; then
  PORT="$(state_field port)" || fail "Could not read the saved CDP port; state was preserved."
fi

stop_recorded_injector
# Always remove the themed Codex launchd babysitter so quitting Codex stays quit.
release_codex_launchd_job || true
CODEX_RUNNING="false"
codex_is_running && CODEX_RUNNING="true"
DEBUG_READY="false"
verified_cdp_endpoint "$PORT" && DEBUG_READY="true"

if [ "$DEBUG_READY" = "true" ]; then
  "$NODE" "$INJECTOR" --remove --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 8000 >/dev/null \
    || fail "The live skin could not be removed and verified; restore stopped safely."
elif [ "$CODEX_RUNNING" = "true" ] && [ "$RESTART_CODEX" = "false" ]; then
  fail "Codex is still running but its saved CDP endpoint cannot be verified. Pass --restart-codex for a full restore."
fi

if [ "$RESTORE_BASE_THEME" = "true" ]; then
  "$NODE" "$SCRIPT_DIR/theme-config.mjs" restore "$CONFIG_PATH" "$THEME_BACKUP_PATH"
fi

if [ "$RESTART_CODEX" = "true" ]; then
  [ "$CODEX_RUNNING" = "true" ] && stop_codex true
  launch_codex_normally
fi

PET_RESTORE_RESULT="$("$NODE" "$SCRIPT_DIR/theme-pet-store.mjs" remove-active \
  --state-root "$STATE_ROOT" \
  --pets-root "$PETS_ROOT" \
  --records-root "$PET_RECORDS_ROOT")" \
  || fail "The active theme pet could not be checked safely; restore stopped without deleting it."
PET_UNINSTALL_RESULT='[]'
if [ "$UNINSTALL" = "true" ]; then
  PET_UNINSTALL_RESULT="$("$NODE" "$SCRIPT_DIR/theme-pet-store.mjs" remove-owned \
    --pets-root "$PETS_ROOT" \
    --records-root "$PET_RECORDS_ROOT")" \
    || fail "Owned theme pets could not be checked safely; changed pets were preserved."
fi

/bin/rm -f "$STATE_PATH"
if [ "$UNINSTALL" = "true" ]; then
  "$SCRIPT_DIR/launcher-app-macos.sh" remove \
    --output "$HOME/Applications/CC Theme.app" >/dev/null \
    || fail "The CC Theme launcher app could not be removed safely."
  /bin/rm -f "$HOME/Desktop/CC Theme.command"
  /bin/rm -f "$HOME/Desktop/CC Theme - Verify.command"
  /bin/rm -f "$HOME/Desktop/CC Theme - Restore.command"
fi

printf 'CC Theme was removed and the requested macOS restore actions completed successfully.\n'
printf 'Pet cleanup: %s; uninstall cleanup: %s\n' "$PET_RESTORE_RESULT" "$PET_UNINSTALL_RESULT"
