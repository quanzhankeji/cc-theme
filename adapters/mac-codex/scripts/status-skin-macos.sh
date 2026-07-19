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

STATE_ROOT="${HOME}/Library/Application Support/CCTheme"
STATE_PATH="${STATE_ROOT}/state.json"
THEME_DIR="${STATE_ROOT}/theme"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"

NODE_RUNTIME=""
for candidate in \
  "${CC_THEME_NODE:-}" \
  "${NODE:-}" \
  "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" \
  "$HOME/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" \
  "$(/usr/bin/which node 2>/dev/null || true)"; do
  [ -n "$candidate" ] || continue
  [ -x "$candidate" ] || continue
  NODE_RUNTIME="$candidate"
  break
done
[ -n "$NODE_RUNTIME" ] || {
  printf 'CC Theme: packaged Node runtime is unavailable; set CC_THEME_NODE to its absolute path.\n' >&2
  exit 1
}

PORT="9341"
SESSION="off"
INJECTOR_ALIVE="false"
CDP_OK="false"
THEME_NAME=""
CODEX_RUNNING="false"

read_json_field() {
  "$NODE_RUNTIME" -e '
    const fs = require("node:fs");
    try {
      const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[process.argv[2]];
      if (value !== undefined && value !== null) process.stdout.write(String(value));
    } catch {}
  ' "$1" "$2" 2>/dev/null || true
}

# Codex process: bounded exact executable-path match. On macOS, pgrep may see
# the truncated process name (for example "/Applications/Ch") rather than
# "ChatGPT", so a name-only probe incorrectly reports a live app as stopped.
while IFS= read -r command_line; do
  for executable in \
    "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT" \
    "/Applications/Codex.app/Contents/MacOS/ChatGPT" \
    "$HOME/Applications/ChatGPT.app/Contents/MacOS/ChatGPT" \
    "$HOME/Applications/Codex.app/Contents/MacOS/ChatGPT"; do
    case "$command_line" in
      "$executable"|"$executable "*) CODEX_RUNNING="true"; break 2 ;;
    esac
  done
done < <(/bin/ps -axo command= 2>/dev/null)

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
  "$NODE_RUNTIME" -e '
    const [session, rawPort, injectorAlive, cdpOk, codexRunning, themeName] = process.argv.slice(1);
    const port = /^\d+$/.test(rawPort) ? Number(rawPort) : rawPort;
    process.stdout.write(`${JSON.stringify({
      session, port,
      injectorAlive: injectorAlive === "true",
      cdpOk: cdpOk === "true",
      codexRunning: codexRunning === "true",
      themeName: themeName || "",
    })}\n`);
  ' "$SESSION" "$PORT" "$INJECTOR_ALIVE" "$CDP_OK" "$CODEX_RUNNING" "$THEME_NAME"
  exit 0
fi

printf 'session=%s\n' "$SESSION"
printf 'port=%s\n' "$PORT"
printf 'injector=%s\n' "$INJECTOR_ALIVE"
printf 'cdp=%s\n' "$CDP_OK"
printf 'codex=%s\n' "$CODEX_RUNNING"
printf 'theme=%s\n' "${THEME_NAME:-}"
