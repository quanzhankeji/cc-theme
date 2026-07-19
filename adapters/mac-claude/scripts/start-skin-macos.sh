#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

enter_adapter_transaction apply "$SCRIPT_DIR/start-skin-macos.sh" "$@"

record_start_error() {
  local code="$1"
  local line="$2"
  ensure_state_root
  printf '%s exit=%s line=%s\n' "$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')" "$code" "$line" >> "$START_ERROR_LOG"
  printf 'CC Theme: start failed at line %s (exit %s). See %s\n' "$line" "$code" "$START_ERROR_LOG" >&2
}
trap 'code=$?; record_start_error "$code" "$LINENO"' ERR

PORT=9451
PORT_EXPLICIT="false"
RESTART_EXISTING="false"
PROMPT_RESTART="false"
FOREGROUND_INJECTOR="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; PORT_EXPLICIT="true"; shift 2 ;;
    --restart-existing) RESTART_EXISTING="true"; shift ;;
    --prompt-restart) PROMPT_RESTART="true"; shift ;;
    --foreground-injector) FOREGROUND_INJECTOR="true"; shift ;;
    *) fail "Unknown start argument: $1" ;;
  esac
done
case "$PORT" in ''|*[!0-9]*) fail "Invalid port: $PORT" ;; esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || fail "Port must be between 1024 and 65535."

cleanup_legacy_launchd_jobs
discover_claude_app
require_macos_runtime
ensure_state_root
require_runtime_apply_available

rollback_for_theme_failure() {
  local reason="$1"
  stop_recorded_injector 2>/dev/null || true
  if verified_cdp_endpoint "$PORT"; then
    "$NODE" "$INJECTOR" --remove --port "$PORT" --timeout-ms 12000 >/dev/null 2>&1 || true
  fi
  /bin/rm -f "$STATE_PATH"
  fail "$reason The current theme was not applied and the native Claude appearance was preserved."
}

if [ "$PORT_EXPLICIT" = "false" ] && [ -f "$STATE_PATH" ]; then
  saved_port="$(state_field port)" || fail "Could not read the existing state port."
  [ -n "$saved_port" ] && PORT="$saved_port"
fi

DEBUG_READY="false"
if verified_cdp_endpoint "$PORT"; then DEBUG_READY="true"; fi

if claude_is_running && [ "$DEBUG_READY" = "false" ]; then
  if [ "$PROMPT_RESTART" = "true" ] && [ "$RESTART_EXISTING" = "false" ]; then
    /usr/bin/osascript -e 'display dialog "Claude 需要重启一次才能启用 Theme。" buttons {"取消", "重启并应用"} default button "重启并应用" with title "CC Theme"' >/dev/null \
      || fail "Theme launch was cancelled."
    RESTART_EXISTING="true"
  fi
  [ "$RESTART_EXISTING" = "true" ] || fail "Claude is already running without the Theme CDP endpoint. Close it first or pass --restart-existing."
  stop_claude true
fi

if [ "$DEBUG_READY" = "false" ]; then
  PORT="$(select_available_port "$PORT")"
  printf 'Launching Claude with skin debug port %s…\n' "$PORT" >&2
  launch_claude_with_cdp "$PORT"
  # Some builds open the window slowly; also try activating the app once.
  /usr/bin/open -a "$CLAUDE_BUNDLE" >/dev/null 2>&1 || true
  if ! wait_for_cdp "$PORT"; then
    # Last resort: if something already listens and answers HTTP, continue.
    if cdp_http_ready "$PORT"; then
      printf 'CDP HTTP is up on %s; continuing with soft verification.\n' "$PORT" >&2
    else
      fail "Claude did not expose a loopback CDP endpoint on port $PORT within 45 seconds. See $APP_LOG and $APP_ERROR_LOG"
    fi
  fi
fi

if [ -f "$STATE_PATH" ]; then
  stop_recorded_injector
  /bin/rm -f "$STATE_PATH"
fi

if [ "$FOREGROUND_INJECTOR" = "true" ]; then
  exec "$NODE" "$INJECTOR" --watch --port "$PORT" --theme-dir "$THEME_DIR"
fi

INJECTOR_PID="$(launch_injector_daemon "$PORT")"
/bin/sleep 0.8
if ! /bin/kill -0 "$INJECTOR_PID" 2>/dev/null; then
  rollback_for_theme_failure "The Theme engine could not load the active theme. See $INJECTOR_ERROR_LOG."
fi
INJECTOR_STARTED_AT="$(process_started_at "$INJECTOR_PID")"
[ -n "$INJECTOR_STARTED_AT" ] || fail "Could not record the injector process start time."
CLAUDE_PID="$(claude_main_pids | /usr/bin/head -n 1)"
write_state "$PORT" "$INJECTOR_PID" "$INJECTOR_STARTED_AT" "$CLAUDE_PID"

# Verify that the newest installed Theme payload is actually active.
if "$NODE" "$INJECTOR" --verify --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 20000 >/tmp/skin-verify.$$.json 2>/dev/null; then
  verify_code=0
else
  verify_code=$?
fi
if [ "$verify_code" -ne 0 ]; then
  # One more force inject before giving up
  "$NODE" "$INJECTOR" --once --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 15000 >/dev/null 2>&1 || true
  if "$NODE" "$INJECTOR" --verify --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 12000 >/tmp/skin-verify.$$.json 2>/dev/null; then
    verify_code=0
  else
    verify_code=$?
  fi
fi
if [ "$verify_code" -ne 0 ]; then
  /bin/rm -f /tmp/skin-verify.$$.json
  rollback_for_theme_failure "Theme injection verification failed."
fi
/bin/rm -f /tmp/skin-verify.$$.json

printf 'CC Theme %s is active on loopback port %s.\n' "$SKIN_VERSION" "$PORT"
