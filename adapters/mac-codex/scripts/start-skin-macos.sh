#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

record_start_error() {
  local code="$1"
  local line="$2"
  ensure_state_root
  printf '%s exit=%s line=%s\n' "$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')" "$code" "$line" >> "$START_ERROR_LOG"
  printf 'CC Theme: start failed at stage line %s (exit %s). Runtime diagnostics were recorded privately.\n' "$line" "$code" >&2
}
trap 'code=$?; record_start_error "$code" "$LINENO"' ERR

PORT=9341
COLD_RENDERER_READY_TIMEOUT_MS="45000"
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
discover_codex_app
require_macos_runtime
require_surface_admission >/dev/null
ensure_state_root
[ -f "$THEME_DIR/theme.json" ] \
  || fail "No externally supplied theme is active. Codex remains in its native appearance."
"$NODE" "$INJECTOR" --check-payload --theme-dir "$THEME_DIR" >/dev/null \
  || fail "The external active theme failed validation. Codex remains in its native appearance."

rollback_for_theme_failure() {
  local reason="$1"
  stop_recorded_injector 2>/dev/null || true
  if verified_cdp_endpoint "$PORT"; then
    "$NODE" "$INJECTOR" --remove --port "$PORT" --timeout-ms 12000 >/dev/null 2>&1 || true
  fi
  /bin/rm -f "$STATE_PATH"
  fail "$reason The current theme was not applied and the native Codex appearance was preserved."
}

if [ "$PORT_EXPLICIT" = "false" ] && [ -f "$STATE_PATH" ]; then
  saved_port="$(state_field port)" || fail "Could not read the existing state port."
  [ -n "$saved_port" ] && PORT="$saved_port"
fi

DEBUG_READY="false"
CODEX_PID=""
CODEX_STARTED_AT=""
if trusted_cdp="$(trusted_cdp_process "$PORT")"; then
  DEBUG_READY="true"
  IFS=$'\t' read -r CODEX_PID CODEX_STARTED_AT <<< "$trusted_cdp"
fi

if codex_is_running && [ "$DEBUG_READY" = "false" ]; then
  if [ "$PROMPT_RESTART" = "true" ] && [ "$RESTART_EXISTING" = "false" ]; then
    /usr/bin/osascript -e 'display dialog "Codex 需要重启一次才能启用 Theme。" buttons {"取消", "重启并应用"} default button "重启并应用" with title "CC Theme"' >/dev/null \
      || fail "Theme launch was cancelled."
    RESTART_EXISTING="true"
  fi
  [ "$RESTART_EXISTING" = "true" ] || fail "Codex is already running without the Theme CDP endpoint. Close it first or pass --restart-existing."
  stop_codex true
fi

if [ "$DEBUG_READY" = "false" ]; then
  # A watcher intentionally outlives the renderer it was supervising. Stop it
  # before a replacement Codex process can reuse the same CDP port; otherwise
  # the stale generation can attach to the new document before the new watcher.
  stop_recorded_injector \
    || fail "The previous injector service did not stop before the replacement Codex launch."
  /bin/rm -f "$STATE_PATH"
  PORT="$(select_available_port "$PORT")"
  printf 'Launching Codex with skin debug port %s…\n' "$PORT" >&2
  launch_stage_started="$(lifecycle_now_ms)"
  launch_codex_with_cdp "$PORT"
  CODEX_PID="$CODEX_LAUNCH_PID"
  CODEX_STARTED_AT="$CODEX_LAUNCH_STARTED_AT"
  if ! wait_for_cdp "$PORT" "$CODEX_LAUNCH_PID" "$CODEX_LAUNCH_STARTED_AT"; then
    emit_lifecycle_stage "cdp-process-tree" "failed" "$launch_stage_started" "cdp-readiness-timeout"
    fail "Codex did not expose a verified CDP endpoint from this launch request within 45 seconds. Runtime diagnostics were recorded privately."
  fi
  emit_lifecycle_stage "cdp-process-tree" "ready" "$launch_stage_started" "ok"
fi

if [ -f "$STATE_PATH" ]; then
  stop_recorded_injector
  /bin/rm -f "$STATE_PATH"
fi

if [ "$FOREGROUND_INJECTOR" = "true" ]; then
  exec "$NODE" "$INJECTOR" --watch --port "$PORT" --theme-dir "$THEME_DIR" \
    --runtime-generation "$(new_runtime_generation)"
fi

RUNTIME_GENERATION="$(new_runtime_generation)"
readiness_started="$(lifecycle_now_ms)"
INJECTOR_PID="$(launch_injector_daemon "$PORT" "$RUNTIME_GENERATION")"
if ! wait_for_injector_ready "$PORT" "$INJECTOR_PID" "$RUNTIME_GENERATION" "$COLD_RENDERER_READY_TIMEOUT_MS"; then
  emit_lifecycle_stage "watcher-generation-readiness" "failed" "$readiness_started" "generation-readiness-timeout"
  rollback_for_theme_failure "The Theme engine did not complete its bounded renderer-generation handshake. Runtime diagnostics were recorded privately."
fi
emit_lifecycle_stage "watcher-generation-readiness" "ready" "$readiness_started" "ok"
INJECTOR_STARTED_AT="$(process_started_at "$INJECTOR_PID")"
[ -n "$INJECTOR_STARTED_AT" ] || fail "Could not record the injector process start time."
[ -n "$CODEX_PID" ] && [ -n "$CODEX_STARTED_AT" ] \
  || rollback_for_theme_failure "The trusted Codex process identity was lost before state commit."
handoff_started="$(lifecycle_now_ms)"
if ! activate_trusted_codex "$PORT" "$CODEX_PID" "$CODEX_STARTED_AT"; then
  emit_lifecycle_stage "foreground-handoff" "failed" "$handoff_started" "trusted-activation-failed"
  rollback_for_theme_failure "The themed Codex renderer was ready, but the trusted app could not be brought to the foreground."
fi
emit_lifecycle_stage "foreground-handoff" "ready" "$handoff_started" "ok"
write_state "$PORT" "$INJECTOR_PID" "$INJECTOR_STARTED_AT" "$CODEX_PID" "$CODEX_STARTED_AT" "$RUNTIME_GENERATION"

printf 'CC Theme %s is active on loopback port %s.\n' "$SKIN_VERSION" "$PORT"
