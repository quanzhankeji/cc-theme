#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
ADAPTER_ID="mac-doubao"
EXPECTED_BUNDLE_ID="com.bot.pc.doubao"
EXPECTED_MANAGER_BUNDLE_ID="com.quanzhankeji.cc-theme"
EXPECTED_TEAM_ID="${DOUBAO_EXPECTED_TEAM_ID:-96L78H6LMH}"
EXPECTED_VERSION="$(/usr/bin/tr -d '[:space:]' < "$PROJECT_ROOT/VERSION")"
DEFAULT_PORT="${DOUBAO_SKIN_PORT:-9343}"
USER_HOME="${HOME:-$(/usr/bin/dscl . -read "/Users/$(/usr/bin/id -un)" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}')}"
STATE_DIR="$USER_HOME/Library/Application Support/$ADAPTER_ID"
STATE_FILE="$STATE_DIR/state.env"
INJECTOR_PID_FILE="$STATE_DIR/injector.pid"
LOG_DIR="$STATE_DIR/logs"
LAUNCH_AGENT_LABEL="app.cc-theme.mac-doubao.injector"
LAUNCH_AGENT_PLIST="$USER_HOME/Library/LaunchAgents/$LAUNCH_AGENT_LABEL.plist"
INJECTOR="$PROJECT_ROOT/scripts/injector.mjs"
DOUBAO_BUNDLE=""
DOUBAO_EXECUTABLE=""
DOUBAO_VERSION=""
NODE_RUNTIME=""
NODE_RUNTIME_SHA256=""
MANAGER_BUNDLE=""

log() { printf '[mac-doubao] %s\n' "$*"; }
warn() { printf '[mac-doubao] warning: %s\n' "$*" >&2; }
die() { printf '[mac-doubao] error: %s\n' "$*" >&2; exit 1; }

require_macos() {
  [ "$(/usr/bin/uname -s)" = "Darwin" ] || die "This Adapter only supports macOS."
}

plist_value() {
  /usr/bin/plutil -extract "$2" raw -o - "$1/Contents/Info.plist" 2>/dev/null || true
}

discover_doubao() {
  local candidate bundle_id executable_name team
  for candidate in "${DOUBAO_APP_BUNDLE:-}" "/Applications/Doubao.app" "$USER_HOME/Applications/Doubao.app"; do
    [ -n "$candidate" ] || continue
    [ -d "$candidate" ] && [ ! -L "$candidate" ] || continue
    bundle_id="$(plist_value "$candidate" CFBundleIdentifier)"
    if [ "$bundle_id" = "$EXPECTED_BUNDLE_ID" ]; then
      DOUBAO_BUNDLE="$(cd "$candidate" && pwd -P)"
      break
    fi
  done
  [ -n "$DOUBAO_BUNDLE" ] || die "The official Doubao app ($EXPECTED_BUNDLE_ID) was not found."
  executable_name="$(plist_value "$DOUBAO_BUNDLE" CFBundleExecutable)"
  DOUBAO_EXECUTABLE="$DOUBAO_BUNDLE/Contents/MacOS/$executable_name"
  DOUBAO_VERSION="$(plist_value "$DOUBAO_BUNDLE" CFBundleShortVersionString)"
  [ -x "$DOUBAO_EXECUTABLE" ] || die "Doubao executable is missing."
  [ "$DOUBAO_VERSION" = "$EXPECTED_VERSION" ] \
    || die "Doubao $DOUBAO_VERSION is not supported; this Adapter is verified for $EXPECTED_VERSION."
  /usr/bin/codesign --verify --deep --strict "$DOUBAO_BUNDLE" >/dev/null 2>&1 \
    || die "Doubao code signature verification failed."
  team="$(/usr/bin/codesign -dv --verbose=4 "$DOUBAO_BUNDLE" 2>&1 | /usr/bin/awk -F= '/^TeamIdentifier=/{print $2; exit}')"
  [ "$team" = "$EXPECTED_TEAM_ID" ] || die "Unexpected Doubao signing team: ${team:-missing}."
  export DOUBAO_BUNDLE DOUBAO_EXECUTABLE DOUBAO_VERSION
}

node_supported() {
  local candidate="$1" major
  [ -x "$candidate" ] || return 1
  major="$("$candidate" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
  [ -n "$major" ] && [ "$major" -ge 22 ]
}

discover_node() {
  local candidate manager expected_node actual_sha expected_sha manager_id
  candidate="${CC_THEME_NODE:-}"
  manager="${CC_THEME_MANAGER_BUNDLE:-}"
  expected_sha="${CC_THEME_NODE_SHA256:-}"
  [ -n "$candidate" ] && [ -n "$manager" ] && [ -n "$expected_sha" ] \
    || die "The Manager must explicitly provide its packaged Node path, bundle, and SHA-256."
  [ -d "$manager" ] && [ ! -L "$manager" ] \
    || die "The CC Theme Manager bundle path is missing or unsafe."
  manager="$(cd "$manager" && pwd -P)"
  manager_id="$(plist_value "$manager" CFBundleIdentifier)"
  [ "$manager_id" = "$EXPECTED_MANAGER_BUNDLE_ID" ] \
    || die "The packaged Node owner is not the CC Theme Manager."
  expected_node="$manager/Contents/Resources/runtime/node/bin/node"
  [ "$candidate" = "$expected_node" ] \
    || die "The Doubao Adapter only accepts the current CC Theme Manager packaged Node."
  [ -f "$candidate" ] && [ ! -L "$candidate" ] && [ -x "$candidate" ] \
    || die "The CC Theme packaged Node is missing or unsafe."
  [[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] \
    || die "The CC Theme packaged Node SHA-256 is invalid."
  /usr/bin/codesign --verify --deep --strict "$manager" >/dev/null 2>&1 \
    || die "The CC Theme Manager signature is invalid."
  /usr/bin/codesign --verify --strict "$candidate" >/dev/null 2>&1 \
    || die "The CC Theme packaged Node signature is invalid."
  actual_sha="$(/usr/bin/shasum -a 256 "$candidate" | /usr/bin/awk '{print $1}')"
  [ "$actual_sha" = "$expected_sha" ] \
    || die "The CC Theme packaged Node digest does not match the Manager handoff."
  node_supported "$candidate" \
    || die "The CC Theme packaged Node must be version 22 or newer."
  NODE_RUNTIME="$candidate"
  NODE_RUNTIME_SHA256="$actual_sha"
  MANAGER_BUNDLE="$manager"
}

state_value() {
  local key="$1"
  [ -f "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ] || return 0
  /usr/bin/awk -F= -v key="$key" '$1 == key { print substr($0, length(key) + 2); exit }' "$STATE_FILE"
}

write_state() {
  local mode="$1" port="$2" theme_dir="$3" temporary
  /bin/mkdir -p "$STATE_DIR" "$LOG_DIR"
  /bin/chmod 700 "$STATE_DIR" "$LOG_DIR"
  temporary="$STATE_DIR/.state.$$"
  umask 077
  {
    printf 'adapter=%s\n' "$ADAPTER_ID"
    printf 'mode=%s\n' "$mode"
    printf 'port=%s\n' "$port"
    printf 'theme_dir=%s\n' "$theme_dir"
    printf 'app_bundle=%s\n' "$DOUBAO_BUNDLE"
    printf 'app_version=%s\n' "$DOUBAO_VERSION"
    printf 'manager_bundle=%s\n' "$MANAGER_BUNDLE"
    printf 'node_sha256=%s\n' "$NODE_RUNTIME_SHA256"
    printf 'updated_at=%s\n' "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$temporary"
  /bin/chmod 600 "$temporary"
  /bin/mv "$temporary" "$STATE_FILE"
}

doubao_main_pids() {
  [ -n "$DOUBAO_EXECUTABLE" ] || return 0
  /bin/ps -ww -axo pid=,comm= | /usr/bin/awk -v executable="$DOUBAO_EXECUTABLE" '
    { pid=$1; sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", $0); if ($0 == executable) print pid }
  '
}

doubao_owned_pids() {
  [ -n "$DOUBAO_BUNDLE" ] || return 0
  /bin/ps -ww -axo pid=,comm= | /usr/bin/awk -v prefix="$DOUBAO_BUNDLE/Contents/" '
    { pid=$1; sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", $0); if (index($0, prefix) == 1) print pid }
  '
}

doubao_running() { [ -n "$(doubao_main_pids)" ]; }

process_belongs_to_doubao() {
  local pid="$1" executable parent hops=0 saw_owned=0
  while [ "$pid" -gt 1 ] 2>/dev/null && [ "$hops" -lt 16 ]; do
    executable="$(/bin/ps -ww -p "$pid" -o comm= 2>/dev/null | /usr/bin/sed 's/^[[:space:]]*//' || true)"
    if [ "$executable" = "$DOUBAO_EXECUTABLE" ]; then
      [ "$saw_owned" -eq 1 ] && return 0
      return 0
    fi
    case "$executable" in
      "$DOUBAO_BUNDLE/Contents/"*) saw_owned=1 ;;
      *) return 1 ;;
    esac
    parent="$(/bin/ps -p "$pid" -o ppid= 2>/dev/null | /usr/bin/tr -d ' ' || true)"
    [ -n "$parent" ] || break
    pid="$parent"
    hops=$((hops + 1))
  done
  return 1
}

port_listener_pids() {
  local port="$1"
  /usr/sbin/lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | /usr/bin/sort -u || true
}

verified_cdp_endpoint() {
  local port="$1" pid found=1 response
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    if process_belongs_to_doubao "$pid"; then found=0; break; fi
  done < <(port_listener_pids "$port")
  [ "$found" -eq 0 ] || return 1
  response="$(/usr/bin/curl --silent --show-error --max-time 2 "http://127.0.0.1:$port/json/list" 2>/dev/null || true)"
  printf '%s' "$response" | /usr/bin/grep -q 'doubao://doubao-chat'
}

wait_for_port_clear() {
  local port="$1" deadline=$((SECONDS + ${2:-8}))
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ -z "$(port_listener_pids "$port")" ] && return 0
    /bin/sleep 0.1
  done
  [ -z "$(port_listener_pids "$port")" ]
}

wait_for_cdp() {
  local port="$1" deadline=$((SECONDS + ${2:-30}))
  while [ "$SECONDS" -lt "$deadline" ]; do
    verified_cdp_endpoint "$port" && return 0
    /bin/sleep 0.25
  done
  return 1
}

stop_doubao() {
  local pid deadline
  /usr/bin/osascript -e "tell application id \"$EXPECTED_BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  deadline=$((SECONDS + 8))
  while doubao_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.2; done
  if doubao_running; then
    while IFS= read -r pid; do [ -z "$pid" ] || /bin/kill -TERM "$pid" 2>/dev/null || true; done < <(doubao_main_pids)
    deadline=$((SECONDS + 4))
    while doubao_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.2; done
  fi
  if doubao_running; then
    warn "Doubao ignored graceful quit and TERM; forcing only its verified main process."
    while IFS= read -r pid; do [ -z "$pid" ] || /bin/kill -KILL "$pid" 2>/dev/null || true; done < <(doubao_main_pids)
  fi
  deadline=$((SECONDS + 3))
  while [ -n "$(doubao_owned_pids)" ] && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.1; done
  if [ -n "$(doubao_owned_pids)" ]; then
    while IFS= read -r pid; do [ -z "$pid" ] || /bin/kill -TERM "$pid" 2>/dev/null || true; done < <(doubao_owned_pids)
    deadline=$((SECONDS + 3))
    while [ -n "$(doubao_owned_pids)" ] && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.1; done
  fi
  if [ -n "$(doubao_owned_pids)" ]; then
    warn "Verified Doubao helper processes ignored TERM; forcing only bundle-owned processes."
    while IFS= read -r pid; do [ -z "$pid" ] || /bin/kill -KILL "$pid" 2>/dev/null || true; done < <(doubao_owned_pids)
    deadline=$((SECONDS + 2))
    while [ -n "$(doubao_owned_pids)" ] && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.1; done
  fi
  [ -z "$(doubao_owned_pids)" ] || die "Verified Doubao processes remained after bounded shutdown."
}

launch_doubao_debug() {
  local port="$1"
  /usr/bin/open -na "$DOUBAO_BUNDLE" --args \
    "--remote-debugging-address=127.0.0.1" "--remote-debugging-port=$port"
}

launch_doubao_normal() { /usr/bin/open -na "$DOUBAO_BUNDLE"; }

injector_owned_pids() {
  [ -n "$NODE_RUNTIME" ] || return 0
  /bin/ps -ww -axo pid=,args= | /usr/bin/awk -v prefix="$NODE_RUNTIME $INJECTOR --watch" '
    { pid=$1; sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", $0); if (index($0, prefix) == 1) print pid }
  '
}

injector_running() {
  /bin/launchctl print "gui/$(/usr/bin/id -u)/$LAUNCH_AGENT_LABEL" >/dev/null 2>&1
}

launch_agent_argument() {
  /usr/libexec/PlistBuddy -c "Print :ProgramArguments:$1" "$LAUNCH_AGENT_PLIST" 2>/dev/null || true
}

trusted_injector_running() {
  local port="$1" theme_dir="$2" uid owner pid index actual command
  uid="$(/usr/bin/id -u)"
  injector_running || return 1
  [ -f "$LAUNCH_AGENT_PLIST" ] && [ ! -L "$LAUNCH_AGENT_PLIST" ] || return 1
  owner="$(/usr/bin/stat -f '%u' "$LAUNCH_AGENT_PLIST" 2>/dev/null || true)"
  [ "$owner" = "$uid" ] || return 1
  [ "$(/usr/libexec/PlistBuddy -c 'Print :Label' "$LAUNCH_AGENT_PLIST" 2>/dev/null || true)" = "$LAUNCH_AGENT_LABEL" ] \
    || return 1
  index=0
  for actual in "$NODE_RUNTIME" "$INJECTOR" --watch --port "$port" --theme-dir "$theme_dir" --timeout-ms 30000; do
    [ "$(launch_agent_argument "$index")" = "$actual" ] || return 1
    index=$((index + 1))
  done
  [ -z "$(launch_agent_argument "$index")" ] || return 1
  pid="$(/bin/launchctl print "gui/$uid/$LAUNCH_AGENT_LABEL" 2>/dev/null \
    | /usr/bin/awk '/pid =/ { print $3; exit }')"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  command="$(/bin/ps -ww -p "$pid" -o args= 2>/dev/null | /usr/bin/sed 's/^[[:space:]]*//' || true)"
  case "$command" in "$NODE_RUNTIME $INJECTOR --watch "*) ;; *) return 1 ;; esac
  /bin/kill -0 "$pid" 2>/dev/null
}

stop_injector() {
  local pid deadline uid
  uid="$(/usr/bin/id -u)"
  /bin/launchctl bootout "gui/$uid/$LAUNCH_AGENT_LABEL" >/dev/null 2>&1 || true
  deadline=$((SECONDS + 5))
  while injector_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.1; done
  injector_running && die "Doubao injector LaunchAgent remained after bounded shutdown."
  if [ -f "$INJECTOR_PID_FILE" ] && [ ! -L "$INJECTOR_PID_FILE" ]; then
    pid="$(/usr/bin/tr -d '[:space:]' < "$INJECTOR_PID_FILE")"
    case "$pid" in
      ''|*[!0-9]*) ;;
      *)
        if injector_owned_pids | /usr/bin/grep -qx "$pid"; then /bin/kill -TERM "$pid" 2>/dev/null || true; fi
        ;;
    esac
  fi
  while IFS= read -r pid; do [ -z "$pid" ] || /bin/kill -TERM "$pid" 2>/dev/null || true; done < <(injector_owned_pids)
  deadline=$((SECONDS + 5))
  while [ -n "$(injector_owned_pids)" ] && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.1; done
  if [ -n "$(injector_owned_pids)" ]; then
    while IFS= read -r pid; do [ -z "$pid" ] || /bin/kill -KILL "$pid" 2>/dev/null || true; done < <(injector_owned_pids)
    deadline=$((SECONDS + 2))
    while [ -n "$(injector_owned_pids)" ] && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.1; done
  fi
  [ ! -L "$LAUNCH_AGENT_PLIST" ] || die "Refusing to remove a symbolic-link Doubao LaunchAgent plist."
  [ ! -L "$INJECTOR_PID_FILE" ] || die "Refusing to remove a symbolic-link Doubao injector PID file."
  /bin/rm -f "$LAUNCH_AGENT_PLIST" "$INJECTOR_PID_FILE"
  [ -z "$(injector_owned_pids)" ] || die "Doubao injector watcher remained after bounded shutdown."
}

xml_escape() {
  printf '%s' "$1" | /usr/bin/sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

start_injector() {
  local port="$1" theme_dir="$2" pid uid attempt bootstrapped=0 deadline ready=0 temporary
  stop_injector
  uid="$(/usr/bin/id -u)"
  /bin/mkdir -p "$STATE_DIR" "$LOG_DIR" "$(dirname "$LAUNCH_AGENT_PLIST")"
  /bin/chmod 700 "$STATE_DIR" "$LOG_DIR"
  [ ! -L "$LAUNCH_AGENT_PLIST" ] || die "Refusing to replace a symbolic-link Doubao LaunchAgent plist."
  temporary="$LAUNCH_AGENT_PLIST.tmp.$$"
  umask 077
  {
    printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>'
    printf '%s\n' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    printf '%s\n' '<plist version="1.0"><dict>'
    printf '  <key>Label</key><string>%s</string>\n' "$(xml_escape "$LAUNCH_AGENT_LABEL")"
    printf '%s\n' '  <key>ProgramArguments</key><array>'
    for argument in "$NODE_RUNTIME" "$INJECTOR" --watch --port "$port" --theme-dir "$theme_dir" --timeout-ms 30000; do
      printf '    <string>%s</string>\n' "$(xml_escape "$argument")"
    done
    printf '%s\n' '  </array>'
    printf '%s\n' '  <key>RunAtLoad</key><true/>'
    printf '%s\n' '  <key>KeepAlive</key><true/>'
    printf '%s\n' '  <key>ProcessType</key><string>Background</string>'
    printf '  <key>StandardOutPath</key><string>%s</string>\n' "$(xml_escape "$LOG_DIR/injector.log")"
    printf '  <key>StandardErrorPath</key><string>%s</string>\n' "$(xml_escape "$LOG_DIR/injector-error.log")"
    printf '%s\n' '</dict></plist>'
  } > "$temporary"
  /bin/chmod 600 "$temporary"
  /usr/bin/plutil -lint "$temporary" >/dev/null || { /bin/rm -f "$temporary"; die "Doubao injector LaunchAgent plist is invalid."; }
  /bin/mv "$temporary" "$LAUNCH_AGENT_PLIST"
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if /bin/launchctl bootstrap "gui/$uid" "$LAUNCH_AGENT_PLIST" >/dev/null 2>&1; then
      bootstrapped=1
      break
    fi
    /bin/sleep 0.25
  done
  [ "$bootstrapped" -eq 1 ] || die "Could not register the Doubao injector LaunchAgent after retry."
  deadline=$((SECONDS + 5))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if trusted_injector_running "$port" "$theme_dir"; then ready=1; break; fi
    /bin/sleep 0.1
  done
  [ "$ready" -eq 1 ] || die "Doubao injector LaunchAgent did not start with the frozen Engine arguments."
  pid="$(/bin/launchctl print "gui/$uid/$LAUNCH_AGENT_LABEL" 2>/dev/null | /usr/bin/awk '/pid =/ { print $3; exit }')"
  [ ! -L "$INJECTOR_PID_FILE" ] || die "Refusing to replace a symbolic-link Doubao injector PID file."
  temporary="$STATE_DIR/.injector-pid.$$"
  printf '%s\n' "$pid" > "$temporary"
  /bin/chmod 600 "$temporary"
  /bin/mv "$temporary" "$INJECTOR_PID_FILE"
  /bin/chmod 600 "$INJECTOR_PID_FILE"
  "$NODE_RUNTIME" "$INJECTOR" --verify --port "$port" --timeout-ms 5000 >/dev/null 2>&1 \
    || die "Doubao injector LaunchAgent started but the applied generation was not ready."
  trusted_injector_running "$port" "$theme_dir" \
    || die "Doubao injector LaunchAgent stopped during bounded readiness verification."
}

restore_native_runtime() {
  local port="$1" relaunch="${2:-true}"
  stop_injector
  if [ -n "$NODE_RUNTIME" ] && verified_cdp_endpoint "$port"; then
    "$NODE_RUNTIME" "$INJECTOR" --remove --port "$port" --timeout-ms 8000 >/dev/null 2>&1 || true
  fi
  if doubao_running || [ -n "$(doubao_owned_pids)" ]; then stop_doubao; fi
  wait_for_port_clear "$port" 8 || die "Doubao CDP port $port remained after native rollback."
  /bin/rm -f "$STATE_FILE" "$INJECTOR_PID_FILE"
  if [ "$relaunch" = "true" ]; then launch_doubao_normal; fi
}
