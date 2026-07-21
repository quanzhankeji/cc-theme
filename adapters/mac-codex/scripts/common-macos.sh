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
SURFACE_ADMISSION="$SCRIPT_DIR/surface-admission.mjs"
LIFECYCLE_PROCESS_GUARD="$SCRIPT_DIR/lifecycle-process-guard.mjs"
INSTALL_ROOT="$HOME/.codex/cc-theme-studio"
STATE_ROOT="$HOME/Library/Application Support/CCTheme"
STATE_PATH="$STATE_ROOT/state.json"
THEME_BACKUP_PATH="$STATE_ROOT/theme-backup.json"
THEME_DIR="$STATE_ROOT/theme"
PETS_ROOT="$HOME/.codex/pets"
PET_RECORDS_ROOT="$STATE_ROOT/pet-ownership"
ACTIVE_THEME_PATH="$STATE_ROOT/active-theme.json"
CONFIG_PATH="$HOME/.codex/config.toml"
INJECTOR_LOG="$STATE_ROOT/injector.log"
INJECTOR_ERROR_LOG="$STATE_ROOT/injector-error.log"
APP_LOG="$STATE_ROOT/codex-launch.log"
APP_ERROR_LOG="$STATE_ROOT/codex-launch-error.log"
START_ERROR_LOG="$STATE_ROOT/start-error.log"
CODEX_APP_JOB_LABEL="app.cc-theme.mac-codex.app"
INJECTOR_JOB_LABEL="app.cc-theme.mac-codex.injector"
INJECTOR_LAUNCH_AGENT_PLIST="$HOME/Library/LaunchAgents/$INJECTOR_JOB_LABEL.plist"
EXPECTED_CODEX_TEAM_ID="${CODEX_EXPECTED_TEAM_ID:-2DC432GLL2}"
SKIN_VERSION="$(/usr/bin/tr -d '[:space:]' < "$PROJECT_ROOT/VERSION")"
[[ "$SKIN_VERSION" =~ ^[0-9]+([.][0-9]+){2}$ ]] || {
  printf 'CC Theme: invalid Adapter VERSION: %s\n' "$SKIN_VERSION" >&2
  exit 1
}
MEDIA_LIMITS_PATH="$PROJECT_ROOT/contracts/media-limits.json"
if [ ! -f "$MEDIA_LIMITS_PATH" ]; then
  printf 'CC Theme: missing media limits contract: %s\n' "$MEDIA_LIMITS_PATH" >&2
  exit 1
fi
CONTRACT_NODE=""
for candidate in \
  "${CC_THEME_NODE:-}" \
  "${NODE:-}" \
  "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" \
  "$HOME/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" \
  "$(/usr/bin/which node 2>/dev/null || true)"; do
  [ -n "$candidate" ] || continue
  [ -x "$candidate" ] || continue
  CONTRACT_NODE="$candidate"
  break
done
if [ -z "$CONTRACT_NODE" ]; then
  printf 'CC Theme: packaged Node runtime is unavailable; set CC_THEME_NODE to its absolute path.\n' >&2
  exit 1
fi
MEDIA_LIMIT_VALUES="$("$CONTRACT_NODE" "$SCRIPT_DIR/read-media-limits.mjs" "$MEDIA_LIMITS_PATH")" || {
  printf 'CC Theme: media limits contract is invalid.\n' >&2
  exit 1
}
IFS=$'\t' read -r MAX_IMAGE_BYTES MAX_STANDARD_VIDEO_BYTES MAX_VIDEO_BYTES MAX_TOTAL_MEDIA_BYTES MAX_PACKAGE_BYTES <<< "$MEDIA_LIMIT_VALUES"
for value in "$MAX_IMAGE_BYTES" "$MAX_STANDARD_VIDEO_BYTES" "$MAX_VIDEO_BYTES" "$MAX_TOTAL_MEDIA_BYTES" "$MAX_PACKAGE_BYTES"; do
  case "$value" in ''|*[!0-9]*) printf 'CC Theme: media limits contract returned a non-integer.\n' >&2; exit 1 ;; esac
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

remove_launchd_job_label() {
  local label="$1"
  local user_domain="gui/$(/usr/bin/id -u)"
  /bin/launchctl bootout "$user_domain/$label" >/dev/null 2>&1 || true
  /bin/launchctl remove "$label" >/dev/null 2>&1 || true
}

wait_for_launchd_job_absent() {
  local label="$1"
  local timeout_seconds="${2:-5}"
  local user_domain="gui/$(/usr/bin/id -u)"
  local deadline=$((SECONDS + timeout_seconds))
  while /bin/launchctl print "$user_domain/$label" >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || return 1
    /bin/sleep 0.1
  done
  return 0
}

remove_injector_launch_agent() {
  local user_domain="gui/$(/usr/bin/id -u)"
  /bin/launchctl bootout "$user_domain/$INJECTOR_JOB_LABEL" >/dev/null 2>&1 || true
  if [ -f "$INJECTOR_LAUNCH_AGENT_PLIST" ] && [ ! -L "$INJECTOR_LAUNCH_AGENT_PLIST" ]; then
    /bin/launchctl bootout "$user_domain" "$INJECTOR_LAUNCH_AGENT_PLIST" >/dev/null 2>&1 || true
  fi
  /bin/launchctl remove "$INJECTOR_JOB_LABEL" >/dev/null 2>&1 || true
  wait_for_launchd_job_absent "$INJECTOR_JOB_LABEL" 5 || return 1
  /bin/rm -f "$INJECTOR_LAUNCH_AGENT_PLIST"
}

xml_escape() {
  printf '%s' "$1" | /usr/bin/sed \
    -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
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

remove_legacy_codex_launchd_job() {
  remove_launchd_job_label "$(legacy_cc_theme_job_label app)"
}

cleanup_legacy_launchd_jobs() {
  remove_legacy_injector_launchd_job
  remove_legacy_codex_launchd_job
}

ensure_state_root() {
  /bin/mkdir -p "$STATE_ROOT"
  /bin/chmod 700 "$STATE_ROOT"
}

copy_adapter_release_tree() {
  local source="$1"
  local destination="$2"
  local assembler="$source/scripts/adapter-release.mjs"
  [ -f "$assembler" ] && [ ! -L "$assembler" ] \
    || fail "Adapter release assembler is missing or unsafe."
  "$CONTRACT_NODE" "$assembler" "$destination" >/dev/null \
    || fail "Adapter release tree did not match its machine-readable manifest."
}

discover_codex_app() {
  local candidate=""
  local identifier=""
  local executable_name=""
  local configured="${CODEX_APP_BUNDLE:-}"

  for candidate in "$configured" "/Applications/ChatGPT.app" "$HOME/Applications/ChatGPT.app"; do
    [ -n "$candidate" ] || continue
    [ -f "$candidate/Contents/Info.plist" ] || continue
    identifier="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$candidate/Contents/Info.plist" 2>/dev/null || true)"
    if [ "$identifier" = "com.openai.codex" ]; then
      CODEX_BUNDLE="$candidate"
      break
    fi
  done

  if [ -z "${CODEX_BUNDLE:-}" ]; then
    candidate="$(/usr/bin/mdfind 'kMDItemCFBundleIdentifier == "com.openai.codex"' | /usr/bin/head -n 1)"
    if [ -n "$candidate" ] && [ -f "$candidate/Contents/Info.plist" ]; then
      identifier="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$candidate/Contents/Info.plist" 2>/dev/null || true)"
      [ "$identifier" = "com.openai.codex" ] && CODEX_BUNDLE="$candidate"
    fi
  fi

  [ -n "${CODEX_BUNDLE:-}" ] || fail "Could not find the official Codex app bundle (com.openai.codex)."
  executable_name="$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$CODEX_BUNDLE/Contents/Info.plist")"
  CODEX_EXE="$CODEX_BUNDLE/Contents/MacOS/$executable_name"
  CODEX_VERSION="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$CODEX_BUNDLE/Contents/Info.plist")"
  [ -x "$CODEX_EXE" ] || fail "Codex executable is missing: $CODEX_EXE"
  export CODEX_BUNDLE CODEX_EXE CODEX_VERSION
}

codesign_team_id() {
  /usr/bin/codesign -dv --verbose=4 "$1" 2>&1 \
    | /usr/bin/awk -F= '/^TeamIdentifier=/{print $2; exit}'
}

require_macos_runtime() {
  [ "$(/usr/bin/uname -s)" = "Darwin" ] || fail "This launcher requires macOS."
  [ -n "${CODEX_BUNDLE:-}" ] || fail "Discover the Codex app before validating its runtime."

  RUNTIME_NODE="$CODEX_BUNDLE/Contents/Resources/cua_node/bin/node"
  [ -x "$RUNTIME_NODE" ] || fail "The signed Node.js runtime bundled with Codex was not found."
  /usr/bin/codesign --verify --deep --strict "$CODEX_BUNDLE" >/dev/null 2>&1 \
    || fail "The Codex app signature is not valid. Restore or reinstall the official app before continuing."
  /usr/bin/codesign --verify --strict "$RUNTIME_NODE" >/dev/null 2>&1 \
    || fail "The Node.js runtime bundled with Codex failed code-signature validation."

  CODEX_TEAM_ID="$(codesign_team_id "$CODEX_BUNDLE")"
  NODE_TEAM_ID="$(codesign_team_id "$RUNTIME_NODE")"
  [ "$CODEX_TEAM_ID" = "$EXPECTED_CODEX_TEAM_ID" ] \
    || fail "Unexpected Codex signing team: ${CODEX_TEAM_ID:-missing}."
  [ "$NODE_TEAM_ID" = "$CODEX_TEAM_ID" ] \
    || fail "The bundled Node.js signer does not match the Codex app signer."

  local machine_arch
  local node_major
  machine_arch="$(/usr/bin/uname -m)"
  /usr/bin/file "$RUNTIME_NODE" | /usr/bin/grep -q "$machine_arch" \
    || fail "The Codex Node.js runtime does not match this Mac architecture ($machine_arch)."
  NODE_VERSION="$($RUNTIME_NODE --version)"
  node_major="${NODE_VERSION#v}"
  node_major="${node_major%%.*}"
  case "$node_major" in ''|*[!0-9]*) fail "Could not parse bundled Node.js version: $NODE_VERSION" ;; esac
  [ "$node_major" -ge 20 ] || fail "Codex bundled Node.js $NODE_VERSION is too old; version 20 or newer is required."

  NODE="$RUNTIME_NODE"
  export NODE RUNTIME_NODE NODE_VERSION CODEX_TEAM_ID NODE_TEAM_ID
}

surface_admission_report() {
  [ -n "${CODEX_BUNDLE:-}" ] || fail "Discover the Codex app before checking current Surface evidence."
  [ -x "${NODE:-}" ] || fail "Validate the signed Codex runtime before checking current Surface evidence."
  local args=(--app "$CODEX_BUNDLE")
  if [ "${CC_THEME_ADAPTER_COMPATIBILITY_ATTEMPT:-0}" = "1" ]; then
    args+=(--compatibility-attempt)
  fi
  "$NODE" "$SURFACE_ADMISSION" "${args[@]}"
}

require_surface_admission() {
  local report=""
  if ! report="$(surface_admission_report 2>/dev/null)"; then
    local code="surface-evidence-unavailable"
    if [ -n "$report" ]; then
      code="$(printf '%s' "$report" | "$NODE" -e '
        let text = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => { text += chunk; });
        process.stdin.on("end", () => {
          try { process.stdout.write(JSON.parse(text).code || "surface-evidence-unavailable"); }
          catch { process.stdout.write("surface-evidence-unavailable"); }
        });
      ' 2>/dev/null || printf 'surface-evidence-unavailable')"
    fi
    fail "Current Codex Surface evidence did not admit Theme application ($code). Revalidate this installed client before applying a theme."
  fi
  printf '%s\n' "$report"
}

codex_main_pids() {
  local pid
  local command_line
  while read -r pid command_line; do
    [ -n "$pid" ] || continue
    case "$command_line" in
      "$CODEX_EXE"*) printf '%s\n' "$pid" ;;
    esac
  done < <(/bin/ps -axo pid=,command=)
}

codex_is_running() {
  [ -n "$(codex_main_pids)" ]
}

process_started_at() {
  /bin/ps -p "$1" -o lstart= 2>/dev/null | /usr/bin/awk '{$1=$1; print}'
}

lifecycle_now_ms() {
  "$NODE" -e 'process.stdout.write(String(Date.now()))'
}

emit_lifecycle_stage() {
  local stage="$1"
  local status="$2"
  local started_ms="$3"
  local code="${4:-ok}"
  local ended_ms
  ended_ms="$(lifecycle_now_ms)"
  "$NODE" -e '
    const [stage, status, started, ended, code] = process.argv.slice(1);
    process.stderr.write(`${JSON.stringify({
      kind: "cc-theme.lifecycle-stage", revision: 1, stage, status,
      durationMs: Math.max(0, Number(ended) - Number(started)), code,
    })}\n`);
  ' "$stage" "$status" "$started_ms" "$ended_ms" "$code"
}

new_runtime_generation() {
  "$NODE" -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))'
}

stop_codex() {
  local allow_force="${1:-false}"
  local deadline
  local pid

  release_codex_launchd_job
  codex_is_running || return 0
  /usr/bin/osascript -e 'tell application id "com.openai.codex" to quit' >/dev/null 2>&1 || true
  deadline=$((SECONDS + 15))
  while codex_is_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.25; done
  codex_is_running || return 0

  [ "$allow_force" = "true" ] || fail "Codex did not close within 15 seconds; explicit restart authorization is required for a forced stop."
  while IFS= read -r pid; do
    [ -n "$pid" ] && /bin/kill -TERM "$pid" 2>/dev/null || true
  done < <(codex_main_pids)
  deadline=$((SECONDS + 5))
  while codex_is_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.25; done
  if codex_is_running; then
    while IFS= read -r pid; do
      [ -n "$pid" ] && /bin/kill -KILL "$pid" 2>/dev/null || true
    done < <(codex_main_pids)
  fi
  /bin/sleep 0.5
  codex_is_running && fail "Codex could not be stopped safely."
  return 0
}

listener_pids() {
  /usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | /usr/bin/sort -u || true
}

port_is_available() {
  [ -z "$(listener_pids "$1")" ]
}

pid_is_codex_descendant() {
  local current="$1"
  local command_line=""
  local parent=""
  local depth=0
  while [ "$current" -gt 1 ] 2>/dev/null && [ "$depth" -lt 32 ]; do
    command_line="$(/bin/ps -p "$current" -o command= 2>/dev/null || true)"
    case "$command_line" in "$CODEX_EXE"*) return 0 ;; esac
    parent="$(/bin/ps -p "$current" -o ppid= 2>/dev/null | /usr/bin/awk '{$1=$1; print}')"
    case "$parent" in ''|*[!0-9]*) return 1 ;; esac
    [ "$parent" -ne "$current" ] || return 1
    current="$parent"
    depth=$((depth + 1))
  done
  return 1
}

port_belongs_to_codex() {
  local port="$1"
  local found_direct="false"
  local pid
  local command_line
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    command_line="$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)"
    case "$command_line" in
      "$CODEX_EXE"*) found_direct="true" ;;
      *) pid_is_codex_descendant "$pid" || return 1 ;;
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
  trusted_cdp_process "$port" >/dev/null
}

trusted_cdp_process() {
  local port="$1"
  local pid=""
  local started=""
  local pids=""
  if [ -f "$STATE_PATH" ]; then
    pid="$(state_field codexPid 2>/dev/null || true)"
    started="$(state_field codexStartedAt 2>/dev/null || true)"
  fi
  if [ -z "$pid" ] || [ "$pid" = "0" ] || [ -z "$started" ]; then
    pids="$(codex_main_pids)"
    [ "$(printf '%s\n' "$pids" | /usr/bin/awk 'NF{count++} END{print count+0}')" -eq 1 ] || return 1
    pid="$(printf '%s\n' "$pids" | /usr/bin/head -n 1)"
    started="$(process_started_at "$pid")"
  fi
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  [ -n "$started" ] || return 1
  "$NODE" "$LIFECYCLE_PROCESS_GUARD" verify-listener --exe "$CODEX_EXE" \
    --pid "$pid" --started-at "$started" --port "$port" >/dev/null 2>&1 || return 1
  printf '%s\t%s\n' "$pid" "$started"
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
  local pid="$2"
  local started="$3"
  local timeout_seconds="${4:-45}"
  local deadline=$((SECONDS + timeout_seconds))
  while [ "$SECONDS" -lt "$deadline" ]; do
    "$NODE" "$LIFECYCLE_PROCESS_GUARD" verify-listener --exe "$CODEX_EXE" \
      --pid "$pid" --started-at "$started" --port "$port" >/dev/null 2>&1 && return 0
    /bin/sleep 0.1
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
  local codex_pid="$4"
  local codex_started_at="$5"
  local runtime_generation="$6"
  local node_ver="${NODE_VERSION:-unknown}"
  local bundle="${CODEX_BUNDLE:-}"
  local exe="${CODEX_EXE:-}"
  local app_ver="${CODEX_VERSION:-}"
  local team="${CODEX_TEAM_ID:-}"
  "$NODE" -e '
    const fs = require("node:fs");
    const [file, version, port, pid, startedAt, injector, node, nodeVersion, bundle, exe, appVersion, teamId, root, themeDir, codexPid, codexStartedAt, runtimeGeneration, arch] = process.argv.slice(1);
    const state = {
      schemaVersion: 5,
      platform: `darwin-${arch}`,
      skinVersion: version,
      port: Number(port),
      injectorPid: Number(pid),
      injectorStartedAt: startedAt,
      injectorPath: injector,
      nodePath: node,
      nodeVersion,
      codexBundle: bundle,
      codexExe: exe,
      codexVersion: appVersion,
      codexTeamId: teamId,
      codexPid: Number(codexPid || 0),
      codexStartedAt,
      runtimeGeneration,
      projectRoot: root,
      themeDir,
      createdAt: new Date().toISOString()
    };
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  ' "$STATE_PATH" "$SKIN_VERSION" "$port" "$injector_pid" "$injector_started_at" "$INJECTOR" "$NODE" "$node_ver" "$bundle" "$exe" "$app_ver" "$team" "$PROJECT_ROOT" "$THEME_DIR" "$codex_pid" "$codex_started_at" "$runtime_generation" "$(/usr/bin/uname -m)"
}

stop_recorded_injector() {
  remove_legacy_injector_launchd_job
  # The current launchd label is project-owned. Remove it even when state.json
  # is absent or stale so restore/uninstall cannot leave an orphan watcher.
  remove_injector_launch_agent || return 1
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
    return 0
  fi
  /bin/kill -0 "$pid" 2>/dev/null || {
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
  /bin/kill -TERM "$pid" 2>/dev/null || true
  local deadline=$((SECONDS + 6))
  while /bin/kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.2; done
  /bin/kill -KILL "$pid" 2>/dev/null || true
  return 0
}

write_injector_launch_agent() {
  local port="$1" runtime_generation="$2"
  local launch_agents="$HOME/Library/LaunchAgents"
  local temporary="$STATE_ROOT/.injector-launch-agent.$$"
  ensure_state_root
  [ ! -L "$launch_agents" ] || fail "The user LaunchAgents directory is a symbolic link."
  /bin/mkdir -p "$launch_agents"
  [ ! -L "$INJECTOR_LAUNCH_AGENT_PLIST" ] \
    || fail "The owned injector LaunchAgent path is a symbolic link."
  (
    umask 077
    {
      printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>'
      printf '%s\n' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
      printf '%s\n' '<plist version="1.0"><dict>'
      printf '  <key>Label</key><string>%s</string>\n' "$(xml_escape "$INJECTOR_JOB_LABEL")"
      printf '%s\n' '  <key>ProgramArguments</key><array>'
      for argument in "$NODE" "$INJECTOR" --watch --port "$port" --theme-dir "$THEME_DIR" \
        --runtime-generation "$runtime_generation"; do
        printf '    <string>%s</string>\n' "$(xml_escape "$argument")"
      done
      printf '%s\n' '  </array>'
      printf '%s\n' '  <key>RunAtLoad</key><true/>'
      printf '%s\n' '  <key>KeepAlive</key><true/>'
      printf '%s\n' '  <key>ProcessType</key><string>Background</string>'
      printf '  <key>StandardOutPath</key><string>%s</string>\n' "$(xml_escape "$INJECTOR_LOG")"
      printf '  <key>StandardErrorPath</key><string>%s</string>\n' "$(xml_escape "$INJECTOR_ERROR_LOG")"
      printf '%s\n' '</dict></plist>'
    } >"$temporary"
  )
  /usr/bin/plutil -lint "$temporary" >/dev/null \
    || fail "The owned injector LaunchAgent could not be validated."
  /bin/chmod 600 "$temporary"
  /bin/mv "$temporary" "$INJECTOR_LAUNCH_AGENT_PLIST"
}

launch_injector_daemon() {
  local port="$1"
  local runtime_generation="$2"
  local pid=""
  local deadline=""
  local attempt=0
  local bootstrapped="false"
  local user_domain="gui/$(/usr/bin/id -u)"
  : > "$INJECTOR_LOG"
  : > "$INJECTOR_ERROR_LOG"
  remove_legacy_injector_launchd_job
  remove_injector_launch_agent \
    || fail "The previous injector service did not stop within the bounded cleanup window."
  write_injector_launch_agent "$port" "$runtime_generation"
  deadline=$((SECONDS + 10))

  # An owned user LaunchAgent is independent of the Manager command's PTY and
  # process group. This keeps one watcher alive across renderer documents and
  # avoids the intermittent submit/nohup race seen on repeated launches.
  while [ "$attempt" -lt 12 ]; do
    if /bin/launchctl bootstrap "$user_domain" "$INJECTOR_LAUNCH_AGENT_PLIST" \
      >>"$INJECTOR_LOG" 2>>"$INJECTOR_ERROR_LOG"; then
      bootstrapped="true"
      break
    fi
    attempt=$((attempt + 1))
    /bin/sleep 0.25
  done
  [ "$bootstrapped" = "true" ] \
    || fail "The injector LaunchAgent could not be registered after bounded retries. Runtime diagnostics were recorded privately."
  while [ "$SECONDS" -lt "$deadline" ]; do
    pid="$(/bin/launchctl print "$user_domain/$INJECTOR_JOB_LABEL" 2>/dev/null \
      | /usr/bin/awk '/^[[:space:]]*pid = [0-9]+/{print $3; exit}')"
    if [ -n "$pid" ] && /bin/kill -0 "$pid" 2>/dev/null; then
      printf '%s\n' "$pid"
      return 0
    fi
    /bin/sleep 0.1
  done
  remove_injector_launch_agent || true
  fail "The injector LaunchAgent did not expose a live process. Runtime diagnostics were recorded privately."
}

wait_for_injector_ready() {
  local port="$1"
  local injector_pid="$2"
  local runtime_generation="$3"
  local timeout_ms="${4:-20000}"
  local timeout_seconds=$(( (timeout_ms + 999) / 1000 + 2 ))
  local readiness_deadline=$((SECONDS + timeout_seconds))
  local verifier_pid=""
  /bin/kill -0 "$injector_pid" 2>/dev/null || return 1
  "$NODE" "$INJECTOR" --wait-ready --port "$port" --theme-dir "$THEME_DIR" \
    --runtime-generation "$runtime_generation" --timeout-ms "$timeout_ms" >/dev/null 2>&1 &
  verifier_pid="$!"
  while /bin/kill -0 "$verifier_pid" 2>/dev/null; do
    if ! /bin/kill -0 "$injector_pid" 2>/dev/null || [ "$SECONDS" -ge "$readiness_deadline" ]; then
      /bin/kill -TERM "$verifier_pid" 2>/dev/null || true
      wait "$verifier_pid" 2>/dev/null || true
      return 1
    fi
    /bin/sleep 0.1
  done
  if ! wait "$verifier_pid"; then
    return 1
  fi
  /bin/kill -0 "$injector_pid" 2>/dev/null
}

# Resolve Node quickly: prefer known Codex path, else full runtime check.
ensure_node_runtime() {
  if [ -n "${NODE:-}" ] && [ -x "${NODE:-}" ]; then
    if [ -z "${NODE_VERSION:-}" ]; then
      NODE_VERSION="$("$NODE" --version 2>/dev/null || echo unknown)"
      export NODE_VERSION
    fi
    # Fill CODEX_* if missing so write_state does not explode under set -u
    : "${CODEX_BUNDLE:=}"
    : "${CODEX_EXE:=}"
    : "${CODEX_VERSION:=}"
    : "${CODEX_TEAM_ID:=}"
    return 0
  fi
  local candidate
  for candidate in \
    "/Applications/Codex.app/Contents/Resources/cua_node/bin/node" \
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" \
    "$HOME/Applications/Codex.app/Contents/Resources/cua_node/bin/node"
  do
    if [ -x "$candidate" ]; then
      NODE="$candidate"
      NODE_VERSION="$("$NODE" --version 2>/dev/null || echo unknown)"
      export NODE NODE_VERSION
      : "${CODEX_BUNDLE:=/Applications/Codex.app}"
      : "${CODEX_EXE:=/Applications/Codex.app/Contents/MacOS/ChatGPT}"
      : "${CODEX_VERSION:=}"
      : "${CODEX_TEAM_ID:=}"
      # Soft-fill from state if present
      if [ -f "$STATE_PATH" ]; then
        CODEX_BUNDLE="$(state_field codexBundle 2>/dev/null || true)"
        CODEX_EXE="$(state_field codexExe 2>/dev/null || true)"
        CODEX_VERSION="$(state_field codexVersion 2>/dev/null || true)"
        CODEX_TEAM_ID="$(state_field codexTeamId 2>/dev/null || true)"
        export CODEX_BUNDLE CODEX_EXE CODEX_VERSION CODEX_TEAM_ID
      fi
      return 0
    fi
  done
  discover_codex_app
  require_macos_runtime
}

# Fast path when CDP is already open: restart injector + one-shot inject.
# Success means both the live renderer and the persistent watcher have passed
# their stability checks. A one-shot renderer update alone is not sufficient:
# reporting success in that state would leave navigation/reloads unmanaged.
# Returns 0 on success, 1 if the stable hot path is unavailable (caller should
# use the full start path).
hot_reapply_theme() {
  local port="${1:-9341}"
  local timeout_ms="${2:-8000}"
  local stage_started
  local runtime_generation
  local trusted
  local codex_pid
  local codex_started_at

  ensure_node_runtime || return 1
  if [ -z "${CODEX_BUNDLE:-}" ] || [ ! -f "$CODEX_BUNDLE/Contents/Info.plist" ]; then
    discover_codex_app || return 1
  fi
  require_macos_runtime
  require_surface_admission >/dev/null
  trusted="$(trusted_cdp_process "$port")" || return 1
  IFS=$'\t' read -r codex_pid codex_started_at <<< "$trusted"
  runtime_generation="$(new_runtime_generation)"
  stage_started="$(lifecycle_now_ms)"
  stop_recorded_injector 2>/dev/null || true
  /bin/rm -f "$STATE_PATH"
  # Kill any leftover watch injectors for this theme injector path
  local old
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    /bin/kill -TERM "$old" 2>/dev/null || true
  done < <(/bin/ps -axo pid=,command= | /usr/bin/awk -v inj="$INJECTOR" '
    index($0, inj) && index($0, "--watch") { print $1 }
  ')
  local stop_deadline=$((SECONDS + 4))
  while /bin/ps -axo command= | /usr/bin/grep -F "$INJECTOR" | /usr/bin/grep -q -- '--watch'; do
    [ "$SECONDS" -lt "$stop_deadline" ] || {
      emit_lifecycle_stage "hot-stop-previous" "failed" "$stage_started" "watcher-stop-timeout"
      return 1
    }
    /bin/sleep 0.1
  done
  emit_lifecycle_stage "hot-stop-previous" "ready" "$stage_started" "ok"

  local inj_pid
  stage_started="$(lifecycle_now_ms)"
  inj_pid="$(launch_injector_daemon "$port" "$runtime_generation")"
  if ! /bin/kill -0 "$inj_pid" 2>/dev/null; then
    remove_injector_launch_agent || true
    emit_lifecycle_stage "hot-watcher-readiness" "failed" "$stage_started" "watcher-exited"
    return 1
  fi
  if ! wait_for_injector_ready "$port" "$inj_pid" "$runtime_generation" "$timeout_ms"; then
    remove_injector_launch_agent || true
    /bin/kill -TERM "$inj_pid" 2>/dev/null || true
    emit_lifecycle_stage "hot-watcher-readiness" "failed" "$stage_started" "generation-readiness-timeout"
    return 1
  fi
  emit_lifecycle_stage "hot-watcher-readiness" "ready" "$stage_started" "ok"

  local started_at
  started_at="$(process_started_at "$inj_pid")"
  [ -n "$started_at" ] || started_at="$(/bin/date)"
  if ! write_state "$port" "$inj_pid" "$started_at" "$codex_pid" "$codex_started_at" "$runtime_generation"; then
    remove_injector_launch_agent || true
    /bin/kill -TERM "$inj_pid" 2>/dev/null || true
    /bin/rm -f "$STATE_PATH"
    return 1
  fi
  return 0
}

# Always tear down any leftover launchd babysitter for the themed Codex process.
# Older builds used `launchctl submit`, which can relaunch Codex after the user
# quits. The clean repository always removes that obsolete babysitter.
release_codex_launchd_job() {
  remove_launchd_job_label "$CODEX_APP_JOB_LABEL"
  remove_legacy_codex_launchd_job
}

activate_trusted_codex() {
  local port="$1"
  local expected_pid="$2"
  local expected_started_at="$3"
  local trusted
  local pid
  local started_at
  trusted="$(trusted_cdp_process "$port")" || return 1
  IFS=$'\t' read -r pid started_at <<< "$trusted"
  [ "$pid" = "$expected_pid" ] && [ "$started_at" = "$expected_started_at" ] || return 1
  /usr/bin/osascript -e 'tell application id "com.openai.codex" to activate' >/dev/null 2>&1 || return 1
  trusted="$(trusted_cdp_process "$port")" || return 1
  IFS=$'\t' read -r pid started_at <<< "$trusted"
  [ "$pid" = "$expected_pid" ] && [ "$started_at" = "$expected_started_at" ]
}

launch_codex_with_cdp() {
  local port="$1"
  local before_report
  local before_pids
  local launched_report=""
  local stage_started
  : > "$APP_LOG"
  : > "$APP_ERROR_LOG"
  release_codex_launchd_job
  before_report="$("$NODE" "$LIFECYCLE_PROCESS_GUARD" snapshot --exe "$CODEX_EXE")" \
    || fail "Could not snapshot the trusted Codex process set."
  before_pids="$("$NODE" -e '
    const value = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(value.pids ?? []));
  ' "$before_report")"
  stage_started="$(lifecycle_now_ms)"
  # Start as a normal user process (NOT launchctl submit). submit keeps a job
  # that will restart Codex when the window is closed.
  /usr/bin/open -gna "$CODEX_BUNDLE" --args \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port="$port" \
    >>"$APP_LOG" 2>>"$APP_ERROR_LOG" || true
  if launched_report="$("$NODE" "$LIFECYCLE_PROCESS_GUARD" wait-new --exe "$CODEX_EXE" \
    --before "$before_pids" --timeout-ms 12000 2>>"$APP_ERROR_LOG")"; then
    emit_lifecycle_stage "launchservices-process" "ready" "$stage_started" "ok"
  else
    if codex_is_running; then
      emit_lifecycle_stage "launchservices-process" "failed" "$stage_started" "ambiguous-process-set"
      fail "LaunchServices did not produce one uniquely owned Codex process."
    fi
    emit_lifecycle_stage "launchservices-process" "fallback" "$stage_started" "launch-process-timeout"
    stage_started="$(lifecycle_now_ms)"
    /usr/bin/nohup "$CODEX_EXE" \
      --remote-debugging-address=127.0.0.1 \
      --remote-debugging-port="$port" \
      >>"$APP_LOG" 2>>"$APP_ERROR_LOG" &
    launched_report="$("$NODE" "$LIFECYCLE_PROCESS_GUARD" wait-new --exe "$CODEX_EXE" \
      --before "$before_pids" --timeout-ms 12000 2>>"$APP_ERROR_LOG")" || {
        emit_lifecycle_stage "executable-fallback-process" "failed" "$stage_started" "launch-process-timeout"
        fail "The bounded Codex executable fallback did not create one trusted process."
      }
    emit_lifecycle_stage "executable-fallback-process" "ready" "$stage_started" "ok"
  fi
  CODEX_LAUNCH_PID="$("$NODE" -e 'process.stdout.write(String(JSON.parse(process.argv[1]).pid ?? ""))' "$launched_report")"
  CODEX_LAUNCH_STARTED_AT="$("$NODE" -e 'process.stdout.write(String(JSON.parse(process.argv[1]).startedAt ?? ""))' "$launched_report")"
  case "$CODEX_LAUNCH_PID" in ''|*[!0-9]*) fail "Codex launch did not return a trusted PID." ;; esac
  [ -n "$CODEX_LAUNCH_STARTED_AT" ] || fail "Codex launch did not return a process start identity."
  export CODEX_LAUNCH_PID CODEX_LAUNCH_STARTED_AT
}

launch_codex_normally() {
  release_codex_launchd_job
  /usr/bin/open -na "$CODEX_BUNDLE"
}
