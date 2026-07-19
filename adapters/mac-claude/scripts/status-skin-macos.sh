#!/bin/bash

# Fast command-line status. No codesign / CDP probes by default.

set +e
set -u

SHORT="false"
JSON="false"
DEEP="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --short) SHORT="true"; shift ;;
    --json) JSON="true"; shift ;;
    --deep) DEEP="true"; shift ;;
    *) printf 'Unknown status argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

STATE_ROOT="${HOME}/Library/Application Support/CCTheme/claude"
STATE_PATH="${STATE_ROOT}/state.json"
THEME_DIR="${STATE_ROOT}/theme"

PORT="9451"
SESSION="off"
INJECTOR_ALIVE="false"
CDP_OK="false"
THEME_NAME=""
CLAUDE_RUNNING="false"

read_json_field() {
  /usr/bin/plutil -extract "$2" raw -o - "$1" 2>/dev/null || true
}

# Claude process: cheap name match only
if /usr/bin/pgrep -x Claude >/dev/null 2>&1; then
  CLAUDE_RUNNING="true"
fi

if [ -f "$STATE_PATH" ]; then
  saved_port="$(read_json_field "$STATE_PATH" port)"
  [ -n "${saved_port:-}" ] && PORT="$saved_port"
  SESSION="$(read_json_field "$STATE_PATH" session)"
  pid="$(read_json_field "$STATE_PATH" injectorPid)"
  if [ -n "${pid:-}" ] && [ "$pid" != "0" ] && /bin/kill -0 "$pid" 2>/dev/null; then
    INJECTOR_ALIVE="true"
    SESSION="active"
  elif [ "${SESSION:-}" = "paused" ]; then
    SESSION="paused"
  elif [ -n "${pid:-}" ] && [ "$pid" != "0" ]; then
    SESSION="stale"
  elif [ -z "${SESSION:-}" ]; then
    SESSION="unknown"
  fi
fi

if [ -f "$THEME_DIR/theme.json" ]; then
  THEME_NAME="$(read_json_field "$THEME_DIR/theme.json" name)"
  [ -n "$THEME_NAME" ] || THEME_NAME="$(read_json_field "$THEME_DIR/theme.json" id)"
fi

if [ "$DEEP" = "true" ]; then
  if /usr/bin/curl --noproxy '*' --silent --fail --max-time 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
    CDP_OK="true"
  fi
fi

label="Skin"
case "$SESSION" in
  active) label="Skin ON" ;;
  paused) label="Skin 暂停" ;;
  stale|unknown) label="Skin ?" ;;
  *) label="Skin 关" ;;
esac

if [ "$SHORT" = "true" ]; then
  printf '%s\n' "$label"
  exit 0
fi

if [ "$JSON" = "true" ]; then
  NODE="${CC_THEME_NODE:-}"
  for candidate in "$NODE" /opt/homebrew/bin/node /usr/local/bin/node "$(/usr/bin/which node 2>/dev/null || true)"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] && { NODE="$candidate"; break; }
  done
  [ -x "$NODE" ] || { printf 'Node.js 20 or newer is required for --json.\n' >&2; exit 1; }
  "$NODE" -e '
    const [session, port, injector, cdp, claude, theme] = process.argv.slice(1);
    console.log(JSON.stringify({
      session,
      port: /^\d+$/.test(port) ? Number(port) : port,
      injectorAlive: injector === "true",
      cdpOk: cdp === "true",
      claudeRunning: claude === "true",
      themeName: theme || "",
    }));
  ' "$SESSION" "$PORT" "$INJECTOR_ALIVE" "$CDP_OK" "$CLAUDE_RUNNING" "$THEME_NAME"
  exit 0
fi

printf 'session=%s\n' "$SESSION"
printf 'port=%s\n' "$PORT"
printf 'injector=%s\n' "$INJECTOR_ALIVE"
printf 'cdp=%s\n' "$CDP_OK"
printf 'claude=%s\n' "$CLAUDE_RUNNING"
printf 'theme=%s\n' "${THEME_NAME:-}"
