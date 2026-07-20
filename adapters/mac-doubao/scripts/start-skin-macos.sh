#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

port="$DEFAULT_PORT"
theme_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) [ "$#" -ge 2 ] || die "--port requires a value"; port="$2"; shift 2 ;;
    --theme-dir) [ "$#" -ge 2 ] || die "--theme-dir requires a value"; theme_dir="$2"; shift 2 ;;
    *) die "Unknown start argument: $1" ;;
  esac
done
case "$port" in ''|*[!0-9]*) die "Invalid CDP port" ;; esac
[ "$port" -ge 1024 ] && [ "$port" -le 65535 ] || die "Invalid CDP port"
[ -n "$theme_dir" ] || theme_dir="$(state_value theme_dir)"
[ -d "$theme_dir" ] && [ ! -L "$theme_dir" ] || die "Theme directory is missing or unsafe."
theme_dir="$(cd "$theme_dir" && pwd -P)"

require_macos
discover_doubao
discover_node
"$NODE_RUNTIME" "$INJECTOR" --check-payload --theme-dir "$theme_dir" >/dev/null

managed_runtime=0
completed=0
rollback_on_exit() {
  code=$?
  trap - EXIT INT TERM
  if [ "$code" -ne 0 ] && [ "$managed_runtime" -eq 1 ] && [ "$completed" -eq 0 ]; then
    restore_native_runtime "$port" true || true
  fi
  exit "$code"
}
trap rollback_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

stop_injector
if ! verified_cdp_endpoint "$port"; then
  [ -z "$(port_listener_pids "$port")" ] || die "CDP port $port is occupied by an untrusted process."
  doubao_running && stop_doubao
  managed_runtime=1
  launch_doubao_debug "$port"
  wait_for_cdp "$port" 35 || die "Doubao did not expose a verified loopback CDP endpoint."
else
  managed_runtime=1
fi

/bin/mkdir -p "$STATE_DIR" "$LOG_DIR"
/bin/chmod 700 "$STATE_DIR" "$LOG_DIR"
apply_deadline=$((SECONDS + 20))
applied=0
while [ "$SECONDS" -lt "$apply_deadline" ]; do
  if "$NODE_RUNTIME" "$INJECTOR" --apply --port "$port" --theme-dir "$theme_dir" --timeout-ms 5000 \
      >/dev/null 2>"$LOG_DIR/apply-error.log" \
      && "$NODE_RUNTIME" "$INJECTOR" --verify --port "$port" --timeout-ms 5000 >/dev/null 2>&1; then
    applied=1
    break
  fi
  /bin/sleep 0.4
done
if [ "$applied" -ne 1 ]; then
  "$NODE_RUNTIME" "$INJECTOR" --remove --port "$port" --timeout-ms 5000 >/dev/null 2>&1 || true
  die "Doubao renderer landmarks did not become ready within 20 seconds; the native appearance was preserved."
fi
start_injector "$port" "$theme_dir"
write_state active "$port" "$theme_dir"
completed=1
printf '{"kind":"cc-theme.operation-result","schemaVersion":1,"adapter":"mac-doubao","operation":"apply","status":"ok","code":"apply-active","changed":true}\n'
