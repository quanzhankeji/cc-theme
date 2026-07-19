#!/bin/bash

set -euo pipefail

if [ -z "${HOME:-}" ]; then
  CURRENT_USER="$(/usr/bin/id -un)"
  HOME="$(/usr/bin/id -P "$CURRENT_USER" 2>/dev/null | /usr/bin/awk -F: '{print $9}')"
  if [ -z "$HOME" ]; then
    HOME="$(/usr/bin/dscl . -read "/Users/$CURRENT_USER" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}')"
  fi
  [ -n "$HOME" ] || { printf 'CC Theme: could not resolve the current macOS home directory.\n' >&2; exit 1; }
  export HOME
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
INJECTOR="$SCRIPT_DIR/injector.mjs"
INSTALL_ROOT="$HOME/.claude/cc-theme-studio"
STATE_ROOT="$HOME/Library/Application Support/CCTheme/claude"
STATE_PATH="$STATE_ROOT/state.json"
THEME_BACKUP_PATH="$STATE_ROOT/theme-backup.json"
THEME_DIR="$STATE_ROOT/theme"
ACTIVE_THEME_PATH="$STATE_ROOT/active-theme.json"
INJECTOR_LOG="$STATE_ROOT/injector.log"
INJECTOR_ERROR_LOG="$STATE_ROOT/injector-error.log"
APP_LOG="$STATE_ROOT/claude-launch.log"
APP_ERROR_LOG="$STATE_ROOT/claude-launch-error.log"
START_ERROR_LOG="$STATE_ROOT/start-error.log"
DIAGNOSTIC_PREVIEW_STATE_PATH="$STATE_ROOT/diagnostic-preview.json"
DIAGNOSTIC_PREVIEW_READY_PATH="$STATE_ROOT/diagnostic-preview-ready.json"
DIAGNOSTIC_PREVIEW_LOG="$STATE_ROOT/diagnostic-preview.log"
DIAGNOSTIC_PREVIEW_ERROR_LOG="$STATE_ROOT/diagnostic-preview-error.log"
CLAUDE_APP_JOB_LABEL="app.cc-theme.mac-claude.app"
INJECTOR_JOB_LABEL="app.cc-theme.mac-claude.injector"
DIAGNOSTIC_PREVIEW_JOB_LABEL="app.cc-theme.mac-claude.diagnostic-preview"
EXPECTED_CLAUDE_TEAM_ID="${CLAUDE_EXPECTED_TEAM_ID:-Q6L2SF6YDW}"
EXPECTED_CLAUDE_VERSION="1.22209.3"
EXPECTED_CLAUDE_ASAR_SHA256="a72a8b5085dbe4bcf7a4271fa9928b5755b7942c99ae70e2a72416755d14e06b"
SKIN_VERSION="1.22209.3"
MEDIA_LIMITS_PATH="$PROJECT_ROOT/contracts/media-limits.json"
ADAPTER_CAPABILITY_PATH="$PROJECT_ROOT/contracts/adapter-capability.json"
if [ ! -f "$MEDIA_LIMITS_PATH" ]; then
  printf 'CC Theme: missing media limits contract: %s\n' "$MEDIA_LIMITS_PATH" >&2
  exit 1
fi
[ -f "$ADAPTER_CAPABILITY_PATH" ] || { printf 'CC Theme: missing adapter capability contract: %s\n' "$ADAPTER_CAPABILITY_PATH" >&2; exit 1; }
MAX_IMAGE_BYTES="$(/usr/bin/plutil -extract imageBytes raw -o - "$MEDIA_LIMITS_PATH")"
MAX_STANDARD_VIDEO_BYTES="$(/usr/bin/plutil -extract standardVideoBytes raw -o - "$MEDIA_LIMITS_PATH")"
MAX_VIDEO_BYTES="$(/usr/bin/plutil -extract largeVideoBytes raw -o - "$MEDIA_LIMITS_PATH")"
MAX_TOTAL_MEDIA_BYTES="$(/usr/bin/plutil -extract totalThemeMediaBytes raw -o - "$MEDIA_LIMITS_PATH")"
MAX_PACKAGE_BYTES="$(/usr/bin/plutil -extract packageBytes raw -o - "$MEDIA_LIMITS_PATH")"
for media_limit in "$MAX_IMAGE_BYTES" "$MAX_STANDARD_VIDEO_BYTES" "$MAX_VIDEO_BYTES" "$MAX_TOTAL_MEDIA_BYTES" "$MAX_PACKAGE_BYTES"; do
  case "$media_limit" in ''|*[!0-9]*) printf 'CC Theme: invalid media limits contract.\n' >&2; exit 1 ;; esac
  [ "$media_limit" -gt 0 ] || { printf 'CC Theme: invalid media limits contract.\n' >&2; exit 1; }
done

fail() {
  local message="$*"
  if [ -n "${START_ERROR_LOG:-}" ] && [ -n "${STATE_ROOT:-}" ]; then
    /bin/mkdir -p "$STATE_ROOT" 2>/dev/null || true
    printf '%s %s\n' "$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')" "$message" >> "$START_ERROR_LOG" 2>/dev/null || true
  fi
  printf 'CC Theme: %s\n' "$message" >&2
  exit 1
}

runtime_apply_available() {
  [ "$(/usr/bin/plutil -extract availability.runtimeApplyAvailable raw -o - "$ADAPTER_CAPABILITY_PATH" 2>/dev/null || true)" = "true" ]
}

require_runtime_apply_available() {
  runtime_apply_available || fail "Claude runtime apply is unavailable: the verified client requires an Anthropic-signed CLAUDE_CDP_AUTH token. Projection and offline validation remain available; CC Theme will not bypass this host security control."
}

enter_adapter_transaction() {
  local operation="$1"
  local command="$2"
  shift 2
  [ "${CC_THEME_ADAPTER_TRANSACTION_HELD:-}" != "1" ] || return 0
  ensure_node_runtime
  exec "$NODE" "$SCRIPT_DIR/adapter-transaction.mjs" --run "$operation" -- "$command" "$@"
}

remove_launchd_job_label() {
  local label="$1"
  local user_domain="gui/$(/usr/bin/id -u)"
  /bin/launchctl bootout "$user_domain/$label" >/dev/null 2>&1 || true
  /bin/launchctl remove "$label" >/dev/null 2>&1 || true
}

# Releases before the independent CC Theme namespace used two incorrectly
# attributed submit labels. Construct them only for exact cleanup so the new
# package never advertises or registers that retired namespace.
legacy_cc_theme_job_label() {
  case "$1" in app|injector) ;; *) return 1 ;; esac
  /usr/bin/printf '%s.%s.%s.%s' 'com' 'openai' 'cc-theme-studio' "$1"
}

remove_legacy_injector_launchd_job() {
  remove_launchd_job_label "$(legacy_cc_theme_job_label injector)"
}

remove_legacy_claude_launchd_job() {
  remove_launchd_job_label "$(legacy_cc_theme_job_label app)"
}

cleanup_legacy_launchd_jobs() {
  remove_legacy_injector_launchd_job
  remove_legacy_claude_launchd_job
}

ensure_state_root() {
  /bin/mkdir -p "$STATE_ROOT"
  /bin/chmod 700 "$STATE_ROOT"
}

discover_claude_app() {
  local candidate=""
  local identifier=""
  local executable_name=""
  local configured="${CLAUDE_APP_BUNDLE:-}"

  for candidate in "$configured" "/Applications/Claude.app" "$HOME/Applications/Claude.app"; do
    [ -n "$candidate" ] || continue
    [ -f "$candidate/Contents/Info.plist" ] || continue
    identifier="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$candidate/Contents/Info.plist" 2>/dev/null || true)"
    if [ "$identifier" = "com.anthropic.claudefordesktop" ]; then
      CLAUDE_BUNDLE="$candidate"
      break
    fi
  done

  if [ -z "${CLAUDE_BUNDLE:-}" ]; then
    candidate="$(/usr/bin/mdfind 'kMDItemCFBundleIdentifier == "com.anthropic.claudefordesktop"' | /usr/bin/head -n 1)"
    if [ -n "$candidate" ] && [ -f "$candidate/Contents/Info.plist" ]; then
      identifier="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$candidate/Contents/Info.plist" 2>/dev/null || true)"
      [ "$identifier" = "com.anthropic.claudefordesktop" ] && CLAUDE_BUNDLE="$candidate"
    fi
  fi

  [ -n "${CLAUDE_BUNDLE:-}" ] || fail "Could not find the official Claude app bundle (com.anthropic.claudefordesktop)."
  executable_name="$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$CLAUDE_BUNDLE/Contents/Info.plist")"
  CLAUDE_EXE="$CLAUDE_BUNDLE/Contents/MacOS/$executable_name"
  CLAUDE_VERSION="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$CLAUDE_BUNDLE/Contents/Info.plist")"
  [ -x "$CLAUDE_EXE" ] || fail "Claude executable is missing: $CLAUDE_EXE"
  export CLAUDE_BUNDLE CLAUDE_EXE CLAUDE_VERSION
}

codesign_team_id() {
  /usr/bin/codesign -dv --verbose=4 "$1" 2>&1 \
    | /usr/bin/awk -F= '/^TeamIdentifier=/{print $2; exit}'
}

require_macos_runtime() {
  [ "$(/usr/bin/uname -s)" = "Darwin" ] || fail "This launcher requires macOS."
  [ -n "${CLAUDE_BUNDLE:-}" ] || fail "Discover the Claude app before validating its runtime."

  /usr/bin/codesign --verify --deep --strict "$CLAUDE_BUNDLE" >/dev/null 2>&1 \
    || fail "The Claude app signature is not valid. Restore or reinstall the official app before continuing."

  CLAUDE_TEAM_ID="$(codesign_team_id "$CLAUDE_BUNDLE")"
  [ "$CLAUDE_TEAM_ID" = "$EXPECTED_CLAUDE_TEAM_ID" ] \
    || fail "Unexpected Claude signing team: ${CLAUDE_TEAM_ID:-missing}."
  [ "$CLAUDE_VERSION" = "$EXPECTED_CLAUDE_VERSION" ] \
    || fail "Claude $CLAUDE_VERSION is not covered by the verified $EXPECTED_CLAUDE_VERSION UI Surface Catalog."
  local asar="$CLAUDE_BUNDLE/Contents/Resources/app.asar"
  local asar_sha256=""
  [ -f "$asar" ] || fail "Claude app.asar is missing."
  asar_sha256="$(/usr/bin/shasum -a 256 "$asar" | /usr/bin/awk '{print $1}')"
  [ "$asar_sha256" = "$EXPECTED_CLAUDE_ASAR_SHA256" ] \
    || fail "Claude app.asar does not match the verified $EXPECTED_CLAUDE_VERSION build evidence."

  # Claude Desktop does not ship an embedded Node.js runtime.
  # Resolve a local Node.js installation explicitly and keep the official app
  # signature check independent from that external toolchain.
  local candidate=""
  local configured_node="${CC_THEME_NODE:-${NODE:-}}"
  for candidate in "$configured_node" /opt/homebrew/bin/node /usr/local/bin/node "$(/usr/bin/which node 2>/dev/null || true)"; do
    [ -n "$candidate" ] || continue
    [ -x "$candidate" ] || continue
    RUNTIME_NODE="$(cd "$(dirname "$candidate")" && pwd -P)/$(basename "$candidate")"
    break
  done
  [ -x "${RUNTIME_NODE:-}" ] \
    || fail "Node.js 20 or newer is required. Install Node.js or set CC_THEME_NODE to its absolute path."

  local machine_arch
  local node_major
  machine_arch="$(/usr/bin/uname -m)"
  /usr/bin/file "$RUNTIME_NODE" | /usr/bin/grep -q "$machine_arch" \
    || fail "The Claude Node.js runtime does not match this Mac architecture ($machine_arch)."
  NODE_VERSION="$("$RUNTIME_NODE" --version)"
  node_major="${NODE_VERSION#v}"
  node_major="${node_major%%.*}"
  case "$node_major" in ''|*[!0-9]*) fail "Could not parse Node.js version: $NODE_VERSION" ;; esac
  [ "$node_major" -ge 20 ] || fail "Node.js $NODE_VERSION is too old; version 20 or newer is required."

  NODE="$RUNTIME_NODE"
  NODE_TEAM_ID="external"
  export NODE RUNTIME_NODE NODE_VERSION CLAUDE_TEAM_ID NODE_TEAM_ID
}

claude_main_pids() {
  local pid
  local command_line
  while read -r pid command_line; do
    [ -n "$pid" ] || continue
    case "$command_line" in
      "$CLAUDE_EXE"*) printf '%s\n' "$pid" ;;
    esac
  done < <(/bin/ps -axo pid=,command=)
}

claude_is_running() {
  [ -n "$(claude_main_pids)" ]
}

process_started_at() {
  /bin/ps -p "$1" -o lstart= 2>/dev/null | /usr/bin/awk '{$1=$1; print}'
}

stop_claude() {
  local allow_force="${1:-false}"
  local deadline
  local pid

  release_claude_launchd_job
  claude_is_running || return 0
  /usr/bin/osascript -e 'tell application id "com.anthropic.claudefordesktop" to quit' >/dev/null 2>&1 || true
  deadline=$((SECONDS + 15))
  while claude_is_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.25; done
  claude_is_running || return 0

  [ "$allow_force" = "true" ] || fail "Claude did not close within 15 seconds; explicit restart authorization is required for a forced stop."
  while IFS= read -r pid; do
    [ -n "$pid" ] && /bin/kill -TERM "$pid" 2>/dev/null || true
  done < <(claude_main_pids)
  deadline=$((SECONDS + 5))
  while claude_is_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.25; done
  if claude_is_running; then
    while IFS= read -r pid; do
      [ -n "$pid" ] && /bin/kill -KILL "$pid" 2>/dev/null || true
    done < <(claude_main_pids)
  fi
  /bin/sleep 0.5
  claude_is_running && fail "Claude could not be stopped safely."
  return 0
}

listener_pids() {
  /usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | /usr/bin/sort -u || true
}

port_is_available() {
  [ -z "$(listener_pids "$1")" ]
}

pid_is_claude_descendant() {
  local current="$1"
  local command_line=""
  local parent=""
  local depth=0
  while [ "$current" -gt 1 ] 2>/dev/null && [ "$depth" -lt 32 ]; do
    command_line="$(/bin/ps -p "$current" -o command= 2>/dev/null || true)"
    case "$command_line" in "$CLAUDE_EXE"*) return 0 ;; esac
    parent="$(/bin/ps -p "$current" -o ppid= 2>/dev/null | /usr/bin/awk '{$1=$1; print}')"
    case "$parent" in ''|*[!0-9]*) return 1 ;; esac
    [ "$parent" -ne "$current" ] || return 1
    current="$parent"
    depth=$((depth + 1))
  done
  return 1
}

port_belongs_to_claude() {
  local port="$1"
  local found_direct="false"
  local pid
  local command_line
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    command_line="$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)"
    case "$command_line" in
      "$CLAUDE_EXE"*) found_direct="true" ;;
      *) pid_is_claude_descendant "$pid" || return 1 ;;
    esac
  done < <(listener_pids "$port")
  [ "$found_direct" = "true" ]
}

# Cheap: can we talk to a loopback DevTools HTTP endpoint?
cdp_http_ready() {
  local port="$1"
  /usr/bin/curl --noproxy '*' --silent --fail --max-time 1 \
    "http://127.0.0.1:${port}/json/version" >/dev/null 2>&1
}

verified_cdp_endpoint() {
  local port="$1"
  # Prefer identity check, but accept loopback CDP if HTTP is healthy and a
  # Claude/Claude process is listening (path case / helper PIDs can fail belongs).
  if port_belongs_to_claude "$port"; then
    cdp_http_ready "$port" || return 1
    return 0
  fi
  cdp_http_ready "$port" || return 1
  # Fallback: listener must still be Claude-related.
  local pid command_line
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    command_line="$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)"
    case "$command_line" in
      *Claude*|*Claude*|*claude*) return 0 ;;
    esac
  done < <(listener_pids "$port")
  return 1
}

select_available_port() {
  local preferred="$1"
  local candidate="$preferred"
  local last=$((preferred + 100))
  [ "$last" -le 65535 ] || last=65535
  while [ "$candidate" -le "$last" ]; do
    if port_is_available "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
    candidate=$((candidate + 1))
  done
  fail "No free loopback port was found between $preferred and $last."
}

wait_for_cdp() {
  local port="$1"
  local deadline=$((SECONDS + 45))
  local last_note=0
  while [ "$SECONDS" -lt "$deadline" ]; do
    # Fast path: HTTP up is enough to proceed once process identity is soft-ok.
    if cdp_http_ready "$port"; then
      if verified_cdp_endpoint "$port" || cdp_http_ready "$port"; then
        # If HTTP is up and Claude is running, accept.
        if claude_is_running || verified_cdp_endpoint "$port"; then
          return 0
        fi
      fi
    fi
    if [ $((SECONDS - last_note)) -ge 8 ]; then
      last_note=$SECONDS
      printf 'Waiting for Claude debug port %s… (%ss)\n' "$port" "$SECONDS" >&2
    fi
    /bin/sleep 0.35
  done
  return 1
}

state_field() {
  local key="$1"
  "$NODE" -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[process.argv[2]];
    if (value !== undefined && value !== null) process.stdout.write(String(value));
  ' "$STATE_PATH" "$key"
}

write_state() {
  local port="$1"
  local injector_pid="$2"
  local injector_started_at="$3"
  local claude_pid="$4"
  local node_ver="${NODE_VERSION:-unknown}"
  local bundle="${CLAUDE_BUNDLE:-}"
  local exe="${CLAUDE_EXE:-}"
  local app_ver="${CLAUDE_VERSION:-}"
  local team="${CLAUDE_TEAM_ID:-}"
  "$NODE" -e '
    const fs = require("node:fs");
    const [file, version, port, pid, startedAt, injector, node, nodeVersion, bundle, exe, appVersion, teamId, root, themeDir, claudePid, arch] = process.argv.slice(1);
    const state = {
      schemaVersion: 4,
      platform: `darwin-${arch}`,
      skinVersion: version,
      port: Number(port),
      injectorPid: Number(pid),
      injectorStartedAt: startedAt,
      injectorPath: injector,
      nodePath: node,
      nodeVersion,
      claudeBundle: bundle,
      claudeExe: exe,
      claudeVersion: appVersion,
      claudeTeamId: teamId,
      claudePid: Number(claudePid || 0),
      projectRoot: root,
      themeDir,
      createdAt: new Date().toISOString()
    };
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  ' "$STATE_PATH" "$SKIN_VERSION" "$port" "$injector_pid" "$injector_started_at" "$INJECTOR" "$NODE" "$node_ver" "$bundle" "$exe" "$app_ver" "$team" "$PROJECT_ROOT" "$THEME_DIR" "$claude_pid" "$(/usr/bin/uname -m)"
}

stop_recorded_injector() {
  remove_legacy_injector_launchd_job
  [ -f "$STATE_PATH" ] || return 0
  local pid
  local saved_start
  local saved_node
  local saved_injector
  local actual_start
  local command_line
  pid="$(state_field injectorPid 2>/dev/null || true)"
  # Already paused / no daemon
  if [ -z "${pid:-}" ] || [ "$pid" = "0" ]; then
    remove_launchd_job_label "$INJECTOR_JOB_LABEL"
    return 0
  fi
  /bin/kill -0 "$pid" 2>/dev/null || {
    remove_launchd_job_label "$INJECTOR_JOB_LABEL"
    return 0
  }
  saved_start="$(state_field injectorStartedAt 2>/dev/null || true)"
  saved_node="$(state_field nodePath 2>/dev/null || true)"
  saved_injector="$(state_field injectorPath 2>/dev/null || true)"
  # Soft identity check for case-insensitive macOS paths.
  local node_ok="true" inj_ok="true"
  if [ -n "$saved_node" ] && [ -n "${NODE:-}" ]; then
    [ "$(printf '%s' "$saved_node" | /usr/bin/tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$NODE" | /usr/bin/tr '[:upper:]' '[:lower:]')" ] || node_ok="false"
  fi
  if [ -n "$saved_injector" ] && [ -n "${INJECTOR:-}" ]; then
    [ "$(printf '%s' "$saved_injector" | /usr/bin/tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$INJECTOR" | /usr/bin/tr '[:upper:]' '[:lower:]')" ] || inj_ok="false"
  fi
  # If identity clearly wrong but process looks like our injector, still stop by cmdline.
  command_line="$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$command_line" in
    *injector.mjs*--watch*) ;;
    *)
      if [ "$node_ok" = "true" ] && [ "$inj_ok" = "true" ]; then
        :
      else
        # Stale PID that is not our injector — ignore
        return 0
      fi
      ;;
  esac
  if [ -n "$saved_start" ]; then
    actual_start="$(process_started_at "$pid")"
    if [ -n "$actual_start" ] && [ "$actual_start" != "$saved_start" ]; then
      # PID recycled — do not kill stranger
      return 0
    fi
  fi
  remove_launchd_job_label "$INJECTOR_JOB_LABEL"
  /bin/kill -TERM "$pid" 2>/dev/null || true
  local deadline=$((SECONDS + 6))
  while /bin/kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.2; done
  /bin/kill -KILL "$pid" 2>/dev/null || true
  return 0
}

stop_diagnostic_preview_server() {
  [ -f "$DIAGNOSTIC_PREVIEW_STATE_PATH" ] || {
    /bin/rm -f "$DIAGNOSTIC_PREVIEW_READY_PATH"
    return 0
  }
  local pid command_line deadline
  pid="$(/usr/bin/plutil -extract serverPid raw -o - "$DIAGNOSTIC_PREVIEW_STATE_PATH" 2>/dev/null || true)"
  case "$pid" in ''|*[!0-9]*) pid="" ;; esac
  # Remove ownership first so a submitted diagnostic job cannot be restarted
  # while its process is being terminated.
  remove_launchd_job_label "$DIAGNOSTIC_PREVIEW_JOB_LABEL"
  if [ -n "$pid" ] && /bin/kill -0 "$pid" 2>/dev/null; then
    command_line="$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)"
    case "$command_line" in
      *"$SCRIPT_DIR/diagnostic-preview-server.mjs"*)
        /bin/kill -TERM "$pid" 2>/dev/null || true
        deadline=$((SECONDS + 4))
        while /bin/kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.1; done
        /bin/kill -KILL "$pid" 2>/dev/null || true
        ;;
    esac
  fi
  remove_launchd_job_label "$DIAGNOSTIC_PREVIEW_JOB_LABEL"
  /bin/rm -f "$DIAGNOSTIC_PREVIEW_STATE_PATH" "$DIAGNOSTIC_PREVIEW_READY_PATH"
}

launch_injector_daemon() {
  local port="$1"
  local pid=""
  local deadline=$((SECONDS + 10))
  : > "$INJECTOR_LOG"
  : > "$INJECTOR_ERROR_LOG"
  remove_legacy_injector_launchd_job
  remove_launchd_job_label "$INJECTOR_JOB_LABEL"

  # Prefer a direct background process — launchctl submit is unreliable on newer macOS.
  /usr/bin/nohup "$NODE" "$INJECTOR" --watch --port "$port" --theme-dir "$THEME_DIR" \
    >>"$INJECTOR_LOG" 2>>"$INJECTOR_ERROR_LOG" &
  pid="$!"
  /bin/sleep 0.4
  if [ -n "$pid" ] && /bin/kill -0 "$pid" 2>/dev/null; then
    printf '%s\n' "$pid"
    return 0
  fi

  # Fallback: launchctl submit
  /bin/launchctl submit -l "$INJECTOR_JOB_LABEL" -o "$INJECTOR_LOG" -e "$INJECTOR_ERROR_LOG" -- \
    "$NODE" "$INJECTOR" --watch --port "$port" --theme-dir "$THEME_DIR" >/dev/null 2>&1 || true
  /bin/launchctl kickstart -k "gui/$(/usr/bin/id -u)/$INJECTOR_JOB_LABEL" >/dev/null 2>&1 || true
  while [ "$SECONDS" -lt "$deadline" ]; do
    pid="$(/bin/launchctl print "gui/$(/usr/bin/id -u)/$INJECTOR_JOB_LABEL" 2>/dev/null \
      | /usr/bin/awk '/^[[:space:]]*pid = [0-9]+/{print $3; exit}')"
    if [ -n "$pid" ] && /bin/kill -0 "$pid" 2>/dev/null; then
      printf '%s\n' "$pid"
      return 0
    fi
    # Also detect the nohup node process by command line
    pid="$(/bin/ps -axo pid=,command= | /usr/bin/awk -v inj="$INJECTOR" -v port="$port" '
      index($0, inj) && index($0, "--watch") && index($0, port) { print $1; exit }
    ')"
    if [ -n "$pid" ] && /bin/kill -0 "$pid" 2>/dev/null; then
      printf '%s\n' "$pid"
      return 0
    fi
    /bin/sleep 0.2
  done
  fail "The injector did not start. See $INJECTOR_ERROR_LOG and $INJECTOR_LOG"
}

# Resolve Node quickly: prefer the configured/system runtime, else perform the
# full Claude signature and runtime check.
ensure_node_runtime() {
  if [ -n "${NODE:-}" ] && [ -x "${NODE:-}" ]; then
    if [ -z "${NODE_VERSION:-}" ]; then
      NODE_VERSION="$("$NODE" --version 2>/dev/null || echo unknown)"
      export NODE_VERSION
    fi
    # Fill CLAUDE_* if missing so write_state does not explode under set -u
    : "${CLAUDE_BUNDLE:=}"
    : "${CLAUDE_EXE:=}"
    : "${CLAUDE_VERSION:=}"
    : "${CLAUDE_TEAM_ID:=}"
    return 0
  fi
  local candidate
  for candidate in \
    "${CC_THEME_NODE:-}" \
    "/opt/homebrew/bin/node" \
    "/usr/local/bin/node" \
    "$(/usr/bin/which node 2>/dev/null || true)"
  do
    if [ -x "$candidate" ]; then
      NODE="$candidate"
      NODE_VERSION="$("$NODE" --version 2>/dev/null || echo unknown)"
      export NODE NODE_VERSION
      : "${CLAUDE_BUNDLE:=/Applications/Claude.app}"
      : "${CLAUDE_EXE:=/Applications/Claude.app/Contents/MacOS/Claude}"
      : "${CLAUDE_VERSION:=}"
      : "${CLAUDE_TEAM_ID:=}"
      # Soft-fill from state if present
      if [ -f "$STATE_PATH" ]; then
        eval "$(/usr/bin/python3 -c 'import json,sys
try:
  s=json.load(open(sys.argv[1]))
  for k,env in [("claudeBundle","CLAUDE_BUNDLE"),("claudeExe","CLAUDE_EXE"),("claudeVersion","CLAUDE_VERSION"),("claudeTeamId","CLAUDE_TEAM_ID")]:
    v=s.get(k) or ""
    if v: print(f"export {env}={json.dumps(v)}")
except Exception: pass' "$STATE_PATH" 2>/dev/null || true)"
      fi
      return 0
    fi
  done
  discover_claude_app
  require_macos_runtime
}

# Fast path when CDP is already open: restart injector + one-shot inject.
# Returns 0 on success, 1 if CDP is not ready (caller should full-start).
hot_reapply_theme() {
  local port="${1:-9451}"
  local timeout_ms="${2:-8000}"

  cdp_http_ready "$port" || return 1
  ensure_node_runtime || return 1
  if [ -z "${CLAUDE_BUNDLE:-}" ] || [ ! -f "$CLAUDE_BUNDLE/Contents/Info.plist" ]; then
    discover_claude_app || return 1
  fi
  stop_recorded_injector 2>/dev/null || true
  # Kill any leftover watch injectors for this theme injector path
  local old
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    /bin/kill -TERM "$old" 2>/dev/null || true
  done < <(/bin/ps -axo pid=,command= | /usr/bin/awk -v inj="$INJECTOR" '
    index($0, inj) && index($0, "--watch") { print $1 }
  ')
  /bin/sleep 0.15

  local inj_pid
  inj_pid="$(launch_injector_daemon "$port")"
  /bin/sleep 0.25
  /bin/kill -0 "$inj_pid" 2>/dev/null || return 1

  # One-shot reloads theme files from disk (watch may still be starting).
  if ! "$NODE" "$INJECTOR" --once --port "$port" --theme-dir "$THEME_DIR" --timeout-ms "$timeout_ms" >/dev/null 2>&1; then
    # Soft: keep watch running even if once flaked
    :
  fi

  local started_at claude_pid
  started_at="$(process_started_at "$inj_pid")"
  claude_pid="$(claude_main_pids 2>/dev/null | /usr/bin/head -n 1)"
  [ -n "$started_at" ] || started_at="$(/bin/date)"
  write_state "$port" "$inj_pid" "$started_at" "${claude_pid:-0}"
  return 0
}

# Always tear down any leftover launchd babysitter for the themed Claude process.
# Older builds used `launchctl submit`, which can relaunch Claude after the user
# quits. The clean repository always removes that obsolete babysitter.
release_claude_launchd_job() {
  remove_launchd_job_label "$CLAUDE_APP_JOB_LABEL"
  remove_legacy_claude_launchd_job
}

launch_claude_with_cdp() {
  local port="$1"
  : > "$APP_LOG"
  : > "$APP_ERROR_LOG"
  release_claude_launchd_job
  # Start as a normal user process (NOT launchctl submit). submit keeps a job
  # that will restart Claude when the window is closed.
  /usr/bin/open -a "$CLAUDE_BUNDLE" --args \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port="$port" \
    >>"$APP_LOG" 2>>"$APP_ERROR_LOG" || true
  # LaunchServices can acknowledge before the process becomes observable. Give
  # the exact bundle a short confirmation window before using the executable.
  local launch_deadline=$((SECONDS + 4))
  while ! claude_is_running && [ "$SECONDS" -lt "$launch_deadline" ]; do /bin/sleep 0.2; done
  # Fallback if open failed to launch or pass args on this Claude build.
  if ! claude_is_running; then
    /usr/bin/nohup "$CLAUDE_EXE" \
      --remote-debugging-address=127.0.0.1 \
      --remote-debugging-port="$port" \
      >>"$APP_LOG" 2>>"$APP_ERROR_LOG" &
  fi
}

launch_claude_with_devtools() {
  : > "$APP_LOG"
  : > "$APP_ERROR_LOG"
  release_claude_launchd_job
  # This is Claude's documented diagnostic entry.  It opens the detached
  # DevTools UI but does not request or synthesize remote CDP authorization.
  /usr/bin/open -a "$CLAUDE_BUNDLE" --env CLAUDE_DEV_TOOLS=detach \
    >>"$APP_LOG" 2>>"$APP_ERROR_LOG" || true
  local launch_deadline=$((SECONDS + 12))
  while ! claude_is_running && [ "$SECONDS" -lt "$launch_deadline" ]; do /bin/sleep 0.2; done
  claude_is_running || fail "Claude diagnostic DevTools launch did not start the verified application."
}

launch_claude_normally() {
  release_claude_launchd_job
  /usr/bin/open -a "$CLAUDE_BUNDLE"
}
