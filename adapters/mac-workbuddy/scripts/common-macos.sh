#!/bin/bash

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$COMMON_DIR/.." && pwd -P)"
ADAPTER_ID="mac-workbuddy"
EXPECTED_BUNDLE_ID="${WORKBUDDY_EXPECTED_BUNDLE_ID:-com.workbuddy.workbuddy}"
EXPECTED_TEAM_ID="${WORKBUDDY_EXPECTED_TEAM_ID:-FN2V63AD2J}"
EXPECTED_WORKBUDDY_VERSION="$(/usr/bin/awk 'NR == 1 { gsub(/[[:space:]]/, ""); print; exit }' "$PROJECT_ROOT/VERSION" 2>/dev/null || true)"
DEFAULT_PORT="${WORKBUDDY_SKIN_PORT:-9342}"
USER_HOME="${HOME:-$(/usr/bin/dscl . -read "/Users/$(/usr/bin/id -un)" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}')}"
STATE_DIR="$USER_HOME/Library/Application Support/$ADAPTER_ID"
LEGACY_STATE_DIR="${STATE_DIR}-skin"
STATE_FILE="$STATE_DIR/state.env"
INJECTOR_PID_FILE="$STATE_DIR/injector.pid"
WATCHER_STARTUP_REPORT="$STATE_DIR/watcher-startup.json"
SIGNATURE_CACHE_FILE="$STATE_DIR/signature-cache-v1.env"
LOG_DIR="$STATE_DIR/logs"
INSTALL_PARENT="$USER_HOME/.workbuddy"
DEFAULT_INSTALL_ROOT="$INSTALL_PARENT/workbuddy-skin-studio"
INSTALL_ROOT="${WORKBUDDY_SKIN_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
INSTALL_OWNER_MARKER=".cc-theme-install-owner"
LAUNCH_AGENT_LABEL="app.cc-theme.mac-workbuddy.injector"
LAUNCH_AGENT_PLIST="$USER_HOME/Library/LaunchAgents/$LAUNCH_AGENT_LABEL.plist"
WORKBUDDY_BUNDLE=""
WORKBUDDY_EXECUTABLE=""
WORKBUDDY_VERSION=""
NODE_RUNTIME=""

log() { printf '[workbuddy-skin] %s\n' "$*"; }
warn() { printf '[workbuddy-skin] warning: %s\n' "$*" >&2; }
die() { printf '[workbuddy-skin] error: %s\n' "$*" >&2; exit 1; }

version_is_strictly_newer() {
  local host="$1" adapter="$2"
  /usr/bin/awk -v host="$host" -v adapter="$adapter" '
    function numeric(value, output, count, index) {
      count=split(value, output, ".")
      if (count != 3) return 0
      for (index=1; index<=3; index++) if (output[index] !~ /^[0-9]+$/) return 0
      return 1
    }
    BEGIN {
      if (!numeric(host, h) || !numeric(adapter, a)) exit 1
      for (i=1; i<=3; i++) {
        if ((h[i] + 0) > (a[i] + 0)) exit 0
        if ((h[i] + 0) < (a[i] + 0)) exit 1
      }
      exit 1
    }
  '
}

migrate_legacy_state_once() {
  local owner state_temporary migration_marker
  [ -e "$LEGACY_STATE_DIR" ] || return 0
  if [ -e "$STATE_DIR" ]; then
    warn "Canonical Adapter state already exists; the pre-canonical directory was not read or merged."
    return 0
  fi
  [ -d "$LEGACY_STATE_DIR" ] && [ ! -L "$LEGACY_STATE_DIR" ] \
    || die "Refusing an unsafe pre-canonical Adapter state directory."
  owner="$(/usr/bin/stat -f '%u' "$LEGACY_STATE_DIR" 2>/dev/null || true)"
  [ "$owner" = "$(/usr/bin/id -u)" ] || die "Pre-canonical Adapter state has an unexpected owner."
  [ -z "$(/usr/bin/find "$LEGACY_STATE_DIR" -type l -print -quit 2>/dev/null)" ] \
    || die "Pre-canonical Adapter state contains a symbolic link."

  /bin/launchctl bootout "gui/$(/usr/bin/id -u)/$LAUNCH_AGENT_LABEL" >/dev/null 2>&1 || true
  /bin/rm -f "$LAUNCH_AGENT_PLIST"
  /bin/mv "$LEGACY_STATE_DIR" "$STATE_DIR"
  /bin/chmod 700 "$STATE_DIR"
  /bin/rm -f "$INJECTOR_PID_FILE"

  if [ -f "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ]; then
    state_temporary="$STATE_DIR/.state-id-migration.$$"
    /usr/bin/awk -F= -v adapter="$ADAPTER_ID" -v old_root="$LEGACY_STATE_DIR" \
      -v new_root="$STATE_DIR" -v project_root="$PROJECT_ROOT" '
      $1 == "adapter" { print "adapter=" adapter; next }
      $1 == "mode" { print "mode=paused"; next }
      $1 == "theme_dir" {
        value=substr($0, length($1) + 2)
        if (index(value, old_root) == 1) value=new_root substr(value, length(old_root) + 1)
        print "theme_dir=" value
        next
      }
      $1 == "project_root" { print "project_root=" project_root; next }
      { print }
    ' "$STATE_FILE" >"$state_temporary"
    /bin/chmod 600 "$state_temporary"
    /bin/mv "$state_temporary" "$STATE_FILE"
  fi
  migration_marker="$STATE_DIR/.adapter-id-migration-v1"
  /usr/bin/printf '%s\n' "$ADAPTER_ID" >"$migration_marker"
  /bin/chmod 600 "$migration_marker"
  log "Pre-canonical Adapter state was moved once to the canonical state directory; the live injector was paused."
}

migrate_legacy_state_once

write_operation_report() {
  local output="$1" operation="$2" status="$3" code="$4" changed="$5" message="$6" details_json="{}"
  if [ "$#" -ge 7 ]; then details_json="$7"; fi
  [ -n "$output" ] || return 0
  "$NODE_RUNTIME" "$PROJECT_ROOT/scripts/operation-result.mjs" \
    --operation "$operation" --status "$status" --code "$code" --changed "$changed" \
    --message "$message" --details-json "$details_json" --output "$output"
}

install_root_is_owned() {
  [ -d "$INSTALL_ROOT" ] \
    && [ ! -L "$INSTALL_ROOT" ] \
    && [ -f "$INSTALL_ROOT/$INSTALL_OWNER_MARKER" ] \
    && [ "$(/bin/cat "$INSTALL_ROOT/$INSTALL_OWNER_MARKER" 2>/dev/null || true)" = "$ADAPTER_ID" ]
}

validate_install_destination() {
  local physical_home physical_parent
  [ "$INSTALL_ROOT" = "$DEFAULT_INSTALL_ROOT" ] \
    || die "Custom install roots are not supported; expected $DEFAULT_INSTALL_ROOT"
  [ -d "$USER_HOME" ] && [ ! -L "$USER_HOME" ] \
    || die "The current home directory is missing or is a symbolic link."
  [ ! -L "$INSTALL_PARENT" ] \
    || die "Refusing an install parent that is a symbolic link: $INSTALL_PARENT"
  /bin/mkdir -p "$INSTALL_PARENT"
  physical_home="$(cd "$USER_HOME" && pwd -P)"
  physical_parent="$(cd "$INSTALL_PARENT" && pwd -P)"
  [ "$physical_parent" = "$physical_home/.workbuddy" ] \
    || die "Install parent escaped the current home directory: $physical_parent"
  if [ -e "$INSTALL_ROOT" ] && ! install_root_is_owned; then
    die "Refusing to replace an unrelated directory: $INSTALL_ROOT"
  fi
}

mark_install_directory() {
  local directory="$1"
  printf '%s\n' "$ADAPTER_ID" >"$directory/$INSTALL_OWNER_MARKER"
  /bin/chmod 600 "$directory/$INSTALL_OWNER_MARKER"
}

require_macos() {
  [ "$(/usr/bin/uname -s)" = "Darwin" ] || die "This adapter only supports macOS."
}

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null || true
}

bundle_metadata_fingerprint() {
  /usr/bin/find "$WORKBUDDY_BUNDLE" -xdev -print0 \
    | /usr/bin/xargs -0 /usr/bin/stat -f '%N:%d:%i:%p:%u:%g:%z:%m:%c:%B:%f:%HT' \
    | LC_ALL=C /usr/bin/sort \
    | /usr/bin/shasum -a 256 \
    | /usr/bin/awk 'NF == 2 && $1 ~ /^[a-f0-9]{64}$/ { print $1; exit }'
}

signature_cache_value() {
  local key="$1"
  /usr/bin/awk -F= -v key="$key" '$1 == key { print substr($0, length($1) + 2); exit }' \
    "$SIGNATURE_CACHE_FILE" 2>/dev/null || true
}

signature_cache_base_matches() {
  local owner permissions
  [ -f "$SIGNATURE_CACHE_FILE" ] && [ ! -L "$SIGNATURE_CACHE_FILE" ] || return 1
  owner="$(/usr/bin/stat -f '%u' "$SIGNATURE_CACHE_FILE" 2>/dev/null || true)"
  permissions="$(/usr/bin/stat -f '%Lp' "$SIGNATURE_CACHE_FILE" 2>/dev/null || true)"
  [ "$owner" = "$(/usr/bin/id -u)" ] && [ "$permissions" = "600" ] || return 1
  [ "$(signature_cache_value kind)" = "cc-theme.workbuddy-signature-cache" ] || return 1
  [ "$(signature_cache_value schema)" = "1" ] || return 1
  [ "$(signature_cache_value bundle)" = "$WORKBUDDY_BUNDLE" ] || return 1
  [ "$(signature_cache_value bundle_id)" = "$EXPECTED_BUNDLE_ID" ] || return 1
  [ "$(signature_cache_value team_id)" = "$EXPECTED_TEAM_ID" ] || return 1
  [ "$(signature_cache_value version)" = "$WORKBUDDY_VERSION" ] || return 1
  [ "$(signature_cache_value executable)" = "$WORKBUDDY_EXECUTABLE" ]
}

signature_cache_matches() {
  local fingerprint="$1"
  signature_cache_base_matches || return 1
  [ "$(signature_cache_value strategy)" = "metadata-cache" ] || return 1
  [ "$(signature_cache_value fingerprint)" = "$fingerprint" ]
}

write_signature_cache() {
  local strategy="$1" fingerprint="$2" temporary="$STATE_DIR/.signature-cache.$$"
  /bin/mkdir -p "$STATE_DIR"
  /bin/chmod 700 "$STATE_DIR"
  (
    umask 077
    {
      printf 'kind=cc-theme.workbuddy-signature-cache\n'
      printf 'schema=1\n'
      printf 'bundle=%s\n' "$WORKBUDDY_BUNDLE"
      printf 'bundle_id=%s\n' "$EXPECTED_BUNDLE_ID"
      printf 'team_id=%s\n' "$EXPECTED_TEAM_ID"
      printf 'version=%s\n' "$WORKBUDDY_VERSION"
      printf 'executable=%s\n' "$WORKBUDDY_EXECUTABLE"
      printf 'strategy=%s\n' "$strategy"
      printf 'fingerprint=%s\n' "$fingerprint"
    } >"$temporary"
  )
  /bin/chmod 600 "$temporary"
  /bin/mv "$temporary" "$SIGNATURE_CACHE_FILE"
}

verify_workbuddy_recursively_and_cache() {
  local fingerprint="${1:-}" started_at finished_at elapsed
  started_at="$(/bin/date +%s)"
  /usr/bin/codesign --verify --deep --strict "$WORKBUDDY_BUNDLE" >/dev/null 2>&1 \
    || die "WorkBuddy recursive code signature verification failed."
  finished_at="$(/bin/date +%s)"
  elapsed=$((finished_at - started_at))
  if [ "$elapsed" -ge 3 ]; then
    if [ -z "$fingerprint" ]; then
      fingerprint="$(bundle_metadata_fingerprint)" \
        || die "WorkBuddy bundle change identity could not be computed safely."
    fi
    case "$fingerprint" in ''|*[!a-f0-9]*) die "WorkBuddy bundle change identity is invalid." ;; esac
    [ "${#fingerprint}" -eq 64 ] || die "WorkBuddy bundle change identity is invalid."
    write_signature_cache metadata-cache "$fingerprint"
  else
    # Recursive verification is already faster than walking this filesystem.
    # Keep the stronger check on each operation and avoid a slower cache path.
    write_signature_cache deep-always ""
  fi
}

discover_workbuddy() {
  local candidate
  for candidate in \
    "${WORKBUDDY_APP_BUNDLE:-}" \
    "/Applications/WorkBuddy.app" \
    "$USER_HOME/Applications/WorkBuddy.app"; do
    [ -n "$candidate" ] || continue
    if [ -d "$candidate" ]; then
      WORKBUDDY_BUNDLE="$(cd "$candidate" && pwd -P)"
      break
    fi
  done
  if [ -z "$WORKBUDDY_BUNDLE" ]; then
    candidate="$(/usr/bin/mdfind "kMDItemCFBundleIdentifier == '$EXPECTED_BUNDLE_ID'" 2>/dev/null | /usr/bin/head -n 1 || true)"
    [ -z "$candidate" ] || WORKBUDDY_BUNDLE="$candidate"
  fi
  [ -n "$WORKBUDDY_BUNDLE" ] || die "WorkBuddy.app was not found."
}

validate_workbuddy() {
  local bundle_id executable_name signature team identifier fingerprint
  bundle_id="$(plist_value "$WORKBUDDY_BUNDLE" CFBundleIdentifier)"
  [ "$bundle_id" = "$EXPECTED_BUNDLE_ID" ] || die "Unexpected WorkBuddy bundle id: ${bundle_id:-missing}"
  executable_name="$(plist_value "$WORKBUDDY_BUNDLE" CFBundleExecutable)"
  [ -n "$executable_name" ] || die "WorkBuddy CFBundleExecutable is missing."
  WORKBUDDY_EXECUTABLE="$WORKBUDDY_BUNDLE/Contents/MacOS/$executable_name"
  [ -x "$WORKBUDDY_EXECUTABLE" ] || die "WorkBuddy executable is missing: $WORKBUDDY_EXECUTABLE"
  WORKBUDDY_VERSION="$(plist_value "$WORKBUDDY_BUNDLE" CFBundleShortVersionString)"
  case "$EXPECTED_WORKBUDDY_VERSION" in ''|*[!0-9.]*) die "Adapter host version contract is invalid." ;; esac
  if [ "$WORKBUDDY_VERSION" != "$EXPECTED_WORKBUDDY_VERSION" ]; then
    [ "${CC_THEME_ADAPTER_COMPATIBILITY_ATTEMPT:-0}" = "1" ] \
      && version_is_strictly_newer "$WORKBUDDY_VERSION" "$EXPECTED_WORKBUDDY_VERSION" \
      || die "WorkBuddy $WORKBUDDY_VERSION is not supported by this Adapter; expected $EXPECTED_WORKBUDDY_VERSION."
    warn "older-adapter-compatibility-attempt: runtime role discovery is required before theme state can commit."
  fi
  signature="$(/usr/bin/codesign -dvvv "$WORKBUDDY_BUNDLE" 2>&1)" || die "WorkBuddy code signature could not be read."
  team="$(printf '%s\n' "$signature" | /usr/bin/sed -n 's/^TeamIdentifier=//p' | /usr/bin/head -n 1)"
  identifier="$(printf '%s\n' "$signature" | /usr/bin/sed -n 's/^Identifier=//p' | /usr/bin/head -n 1)"
  [ "$identifier" = "$EXPECTED_BUNDLE_ID" ] || die "Unexpected signature identifier: ${identifier:-missing}"
  [ "$team" = "$EXPECTED_TEAM_ID" ] || die "Unexpected WorkBuddy signing team: ${team:-missing}"
  if signature_cache_base_matches \
    && [ "$(signature_cache_value strategy)" = "metadata-cache" ]; then
    /usr/bin/codesign --verify --strict "$WORKBUDDY_BUNDLE" >/dev/null 2>&1 \
      || die "WorkBuddy outer code signature verification failed."
    fingerprint="$(bundle_metadata_fingerprint)" \
      || die "WorkBuddy bundle change identity could not be computed safely."
    if ! signature_cache_matches "$fingerprint"; then
      verify_workbuddy_recursively_and_cache "$fingerprint"
    fi
  else
    # A recursive verification includes the outer seal. Fast filesystems keep
    # this stronger path instead of redundantly running both checks.
    verify_workbuddy_recursively_and_cache
  fi
}

node_is_supported() {
  local candidate="$1" major
  [ -x "$candidate" ] || return 1
  major="$($candidate -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
  [ -n "$major" ] && [ "$major" -ge 22 ]
}

discover_node() {
  local candidate managed_root
  if [ -n "${NODE:-}" ] && node_is_supported "$NODE"; then
    NODE_RUNTIME="$NODE"
    return
  fi
  candidate="$(command -v node 2>/dev/null || true)"
  if [ -n "$candidate" ] && node_is_supported "$candidate"; then
    NODE_RUNTIME="$candidate"
    return
  fi
  managed_root="$USER_HOME/.workbuddy/binaries/node/versions"
  if [ -d "$managed_root" ]; then
    while IFS= read -r candidate; do
      if node_is_supported "$candidate"; then NODE_RUNTIME="$candidate"; return; fi
    done < <(/usr/bin/find "$managed_root" -mindepth 3 -maxdepth 3 -type f -path '*/bin/node' -print 2>/dev/null | /usr/bin/sort -r)
  fi
  die "Node.js 22 or newer is required."
}

workbuddy_pids() {
  [ -n "$WORKBUDDY_EXECUTABLE" ] || return 0
  /bin/ps -ww -axo pid=,ppid=,comm= | /usr/bin/awk -v executable="$WORKBUDDY_EXECUTABLE" '
    {
      pid=$1
      ppid=$2
      sub(/^[[:space:]]*[0-9]+[[:space:]]+[0-9]+[[:space:]]+/, "", $0)
      if (ppid == 1 && $0 == executable) print pid
    }
  '
}

workbuddy_owned_pids() {
  [ -n "$WORKBUDDY_BUNDLE" ] || return 0
  /bin/ps -ww -axo pid=,ppid=,comm= | /usr/bin/awk -v prefix="$WORKBUDDY_BUNDLE/Contents/" '
    {
      pid=$1
      sub(/^[[:space:]]*[0-9]+[[:space:]]+[0-9]+[[:space:]]+/, "", $0)
      if (index($0, prefix) == 1) print pid
    }
  '
}

workbuddy_running() {
  [ -n "$(workbuddy_pids)" ]
}

stop_workbuddy() {
  local pid deadline
  /usr/bin/osascript -e "tell application id \"$EXPECTED_BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  deadline=$((SECONDS + 10))
  while workbuddy_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.2; done
  if workbuddy_running; then
    warn "WorkBuddy did not quit in time; sending TERM to its main process."
    while IFS= read -r pid; do [ -z "$pid" ] || /bin/kill -TERM "$pid" 2>/dev/null || true; done < <(workbuddy_pids)
    deadline=$((SECONDS + 5))
    while workbuddy_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.2; done
  fi
  if workbuddy_running; then
    warn "WorkBuddy main process ignored TERM; forcing only the main UI process to exit."
    while IFS= read -r pid; do [ -z "$pid" ] || /bin/kill -KILL "$pid" 2>/dev/null || true; done < <(workbuddy_pids)
  fi
  deadline=$((SECONDS + 3))
  while [ -n "$(workbuddy_owned_pids)" ] && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.1; done
  if [ -n "$(workbuddy_owned_pids)" ]; then
    warn "Verified residual WorkBuddy bundle processes remained after main exit; terminating only those owned paths."
    while IFS= read -r pid; do [ -z "$pid" ] || /bin/kill -TERM "$pid" 2>/dev/null || true; done < <(workbuddy_owned_pids)
    deadline=$((SECONDS + 2))
    while [ -n "$(workbuddy_owned_pids)" ] && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.1; done
  fi
  if [ -n "$(workbuddy_owned_pids)" ]; then
    warn "Verified residual WorkBuddy bundle processes ignored TERM; forcing those owned paths to exit."
    while IFS= read -r pid; do [ -z "$pid" ] || /bin/kill -KILL "$pid" 2>/dev/null || true; done < <(workbuddy_owned_pids)
  fi
}

pid_belongs_to_workbuddy() {
  local pid="$1" executable parent hops=0
  while [ "$pid" -gt 1 ] 2>/dev/null && [ "$hops" -lt 12 ]; do
    executable="$(/bin/ps -ww -p "$pid" -o comm= 2>/dev/null | /usr/bin/sed 's/^[[:space:]]*//' || true)"
    case "$executable" in "$WORKBUDDY_BUNDLE/Contents/"*) return 0 ;; esac
    parent="$(/bin/ps -p "$pid" -o ppid= 2>/dev/null | /usr/bin/tr -d ' ' || true)"
    [ -n "$parent" ] || break
    pid="$parent"
    hops=$((hops + 1))
  done
  return 1
}

verify_debug_endpoint() {
  local port="$1" pid response owned=1
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    if pid_belongs_to_workbuddy "$pid"; then owned=0; break; fi
  done < <(/usr/sbin/lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | /usr/bin/sort -u || true)
  [ "$owned" -eq 0 ] || return 1
  response="$(/usr/bin/curl --silent --show-error --max-time 2 "http://127.0.0.1:$port/json/list" 2>/dev/null || true)"
  printf '%s' "$response" | /usr/bin/grep -q 'webSocketDebuggerUrl'
}

wait_for_debug_endpoint() {
  local port="$1" timeout_seconds="${2:-25}" deadline
  deadline=$((SECONDS + timeout_seconds))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if verify_debug_endpoint "$port"; then return 0; fi
    /bin/sleep 0.25
  done
  return 1
}

wait_for_workbuddy_main() {
  local timeout_seconds="${1:-10}" deadline
  deadline=$((SECONDS + timeout_seconds))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if workbuddy_running; then return 0; fi
    /bin/sleep 0.05
  done
  return 1
}

launch_workbuddy_debug() {
  local port="$1"
  /bin/mkdir -p "$LOG_DIR"
  # LaunchServices owns the process, so WorkBuddy survives the invoking terminal.
  # The CLI switches are understood by Electron; the short-lived launchd env value
  # also activates WorkBuddy's own WORKBUDDY_REMOTE_DEBUGGING_PORT handling.
  /bin/launchctl setenv WORKBUDDY_REMOTE_DEBUGGING_PORT "$port"
  if ! /usr/bin/open -na "$WORKBUDDY_BUNDLE" --args \
    "--remote-debugging-address=127.0.0.1" "--remote-debugging-port=$port"; then
    /bin/launchctl unsetenv WORKBUDDY_REMOTE_DEBUGGING_PORT || true
    return 1
  fi
  /bin/launchctl unsetenv WORKBUDDY_REMOTE_DEBUGGING_PORT || true
}

launch_workbuddy_normal() {
  /usr/bin/open -na "$WORKBUDDY_BUNDLE"
}

workbuddy_frontmost() {
  local asn info
  asn="$(/usr/bin/lsappinfo front 2>/dev/null || true)"
  [ -n "$asn" ] || return 1
  info="$(/usr/bin/lsappinfo info -only bundleid "$asn" 2>/dev/null || true)"
  printf '%s\n' "$info" | /usr/bin/grep -Fq "\"CFBundleIdentifier\"=\"$EXPECTED_BUNDLE_ID\""
}

activate_workbuddy() {
  local deadline
  /usr/bin/osascript -e "tell application id \"$EXPECTED_BUNDLE_ID\" to activate" >/dev/null 2>&1 || return 1
  deadline=$((SECONDS + 4))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if workbuddy_frontmost; then return 0; fi
    /bin/sleep 0.1
  done
  return 1
}

state_value() {
  local key="$1"
  [ -f "$STATE_FILE" ] || return 0
  /usr/bin/awk -F= -v key="$key" '$1 == key { print substr($0, length(key) + 2); exit }' "$STATE_FILE"
}

write_state() {
  local mode="$1" port="$2" theme_dir="$3"
  /bin/mkdir -p "$STATE_DIR"
  /bin/chmod 700 "$STATE_DIR"
  umask 077
  {
    printf 'adapter=%s\n' "$ADAPTER_ID"
    printf 'mode=%s\n' "$mode"
    printf 'port=%s\n' "$port"
    printf 'theme_dir=%s\n' "$theme_dir"
    printf 'app_bundle=%s\n' "$WORKBUDDY_BUNDLE"
    printf 'app_version=%s\n' "$WORKBUDDY_VERSION"
    printf 'project_root=%s\n' "$PROJECT_ROOT"
    printf 'updated_at=%s\n' "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$STATE_FILE"
}

injector_running() {
  /bin/launchctl print "gui/$(/usr/bin/id -u)/$LAUNCH_AGENT_LABEL" >/dev/null 2>&1
}

launch_agent_argument() {
  /usr/libexec/PlistBuddy -c "Print :ProgramArguments:$1" "$LAUNCH_AGENT_PLIST" 2>/dev/null || true
}

watcher_report_matches_fingerprint() {
  local expected_fingerprint="$1"
  [ -f "$WATCHER_STARTUP_REPORT" ] && [ ! -L "$WATCHER_STARTUP_REPORT" ] || return 1
  "$NODE_RUNTIME" -e '
    const fs = require("fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const valid = report?.kind === "cc-theme.operation-result"
      && report?.adapter === "mac-workbuddy"
      && report?.status === "ok"
      && report?.code === "watcher-ready"
      && report?.version === process.argv[3]
      && report?.runtimeInputFingerprint === process.argv[2]
      && report?.revisionScope === "renderer-session-generation"
      && report?.releaseTraceability === "file-manifest-sha256";
    process.exit(valid ? 0 : 1);
  ' "$WATCHER_STARTUP_REPORT" "$expected_fingerprint" "$WORKBUDDY_VERSION" >/dev/null 2>&1
}

trusted_injector_running() {
  local port="$1" theme_dir="$2" themes_root="$3" uid owner pid executable index actual
  local expected_fingerprint deadline preflight
  uid="$(/usr/bin/id -u)"
  injector_running || return 1
  [ -f "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ] || return 1
  [ "$(state_value adapter)" = "$ADAPTER_ID" ] || return 1
  [ "$(state_value port)" = "$port" ] || return 1
  [ "$(state_value theme_dir)" = "$theme_dir" ] || return 1
  [ "$(state_value project_root)" = "$PROJECT_ROOT" ] || return 1
  [ -f "$LAUNCH_AGENT_PLIST" ] && [ ! -L "$LAUNCH_AGENT_PLIST" ] || return 1
  owner="$(/usr/bin/stat -f '%u' "$LAUNCH_AGENT_PLIST" 2>/dev/null || true)"
  [ "$owner" = "$uid" ] || return 1
  [ "$(/usr/libexec/PlistBuddy -c 'Print :Label' "$LAUNCH_AGENT_PLIST" 2>/dev/null || true)" = "$LAUNCH_AGENT_LABEL" ] \
    || return 1
  index=0
  for actual in \
    "$NODE_RUNTIME" "$PROJECT_ROOT/scripts/injector.mjs" --watch --port "$port" \
    --theme-dir "$theme_dir" --themes-root "$themes_root" --report-file "$WATCHER_STARTUP_REPORT"; do
    [ "$(launch_agent_argument "$index")" = "$actual" ] || return 1
    index=$((index + 1))
  done
  [ -z "$(launch_agent_argument "$index")" ] || return 1
  pid="$(/bin/launchctl print "gui/$uid/$LAUNCH_AGENT_LABEL" 2>/dev/null \
    | /usr/bin/awk '/pid =/ { print $3; exit }')"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  executable="$(/bin/ps -ww -p "$pid" -o comm= 2>/dev/null | /usr/bin/sed 's/^[[:space:]]*//' || true)"
  [ "$executable" = "$NODE_RUNTIME" ] || return 1

  preflight="$("$NODE_RUNTIME" "$PROJECT_ROOT/scripts/injector.mjs" --check-payload \
    --theme-dir "$theme_dir" --themes-root "$themes_root" 2>/dev/null)" || return 1
  expected_fingerprint="$("$NODE_RUNTIME" -e '
    const value = JSON.parse(process.argv[1]);
    const fingerprint = value?.runtimeInputFingerprint;
    if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) process.exit(1);
    process.stdout.write(fingerprint);
  ' "$preflight")" || return 1
  deadline=$((SECONDS + 2))
  while [ "$SECONDS" -lt "$deadline" ]; do
    watcher_report_matches_fingerprint "$expected_fingerprint" && return 0
    /bin/sleep 0.05
  done
  watcher_report_matches_fingerprint "$expected_fingerprint"
}

stop_injector() {
  local deadline uid
  uid="$(/usr/bin/id -u)"
  /bin/launchctl bootout "gui/$(/usr/bin/id -u)/$LAUNCH_AGENT_LABEL" >/dev/null 2>&1 || true
  deadline=$((SECONDS + 5))
  while /bin/launchctl print "gui/$uid/$LAUNCH_AGENT_LABEL" >/dev/null 2>&1 && [ "$SECONDS" -lt "$deadline" ]; do
    /bin/sleep 0.1
  done
  if /bin/launchctl print "gui/$uid/$LAUNCH_AGENT_LABEL" >/dev/null 2>&1; then
    warn "The previous injector LaunchAgent did not stop within its bounded shutdown window."
    return 1
  fi
  /bin/rm -f "$LAUNCH_AGENT_PLIST"
  /bin/rm -f "$INJECTOR_PID_FILE"
  /bin/rm -f "$WATCHER_STARTUP_REPORT"
}

xml_escape() {
  printf '%s' "$1" | /usr/bin/sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

start_injector() {
  local port="$1" theme_dir="$2" themes_root="${3:-$STATE_DIR/themes}" pid uid attempt deadline ready=0 bootstrapped=0
  stop_injector || die "The previous injector could not be stopped safely."
  uid="$(/usr/bin/id -u)"
  /bin/mkdir -p "$LOG_DIR" "$(dirname "$LAUNCH_AGENT_PLIST")"
  {
    printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>'
    printf '%s\n' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    printf '%s\n' '<plist version="1.0"><dict>'
    printf '  <key>Label</key><string>%s</string>\n' "$(xml_escape "$LAUNCH_AGENT_LABEL")"
    printf '%s\n' '  <key>ProgramArguments</key><array>'
    for argument in "$NODE_RUNTIME" "$PROJECT_ROOT/scripts/injector.mjs" --watch --port "$port" \
      --theme-dir "$theme_dir" --themes-root "$themes_root" --report-file "$WATCHER_STARTUP_REPORT"; do
      printf '    <string>%s</string>\n' "$(xml_escape "$argument")"
    done
    printf '%s\n' '  </array>'
    printf '%s\n' '  <key>RunAtLoad</key><true/>'
    printf '%s\n' '  <key>KeepAlive</key><true/>'
    printf '  <key>StandardOutPath</key><string>%s</string>\n' "$(xml_escape "$LOG_DIR/injector.log")"
    printf '  <key>StandardErrorPath</key><string>%s</string>\n' "$(xml_escape "$LOG_DIR/injector.log")"
    printf '%s\n' '</dict></plist>'
  } >"$LAUNCH_AGENT_PLIST"
  /bin/chmod 600 "$LAUNCH_AGENT_PLIST"
  # launchd can briefly retain the old label after bootout during a hot theme switch.
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if /bin/launchctl bootstrap "gui/$uid" "$LAUNCH_AGENT_PLIST" >/dev/null 2>&1; then
      bootstrapped=1
      break
    fi
    /bin/sleep 0.25
  done
  [ "$bootstrapped" -eq 1 ] || die "Could not register the injector LaunchAgent after retry."
  # bootstrap + RunAtLoad already starts the job. A forced kickstart here kills the
  # just-created process and triggers launchd's ten-second crash-throttle window.
  deadline=$((SECONDS + 12))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ -s "$WATCHER_STARTUP_REPORT" ] && "$NODE_RUNTIME" -e '
      const fs = require("fs");
      const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.exit(value?.code === "watcher-ready" && value?.status === "ok" ? 0 : 1);
    ' "$WATCHER_STARTUP_REPORT" >/dev/null 2>&1; then
      ready=1
      break
    fi
    if [ -s "$WATCHER_STARTUP_REPORT" ] && "$NODE_RUNTIME" -e '
      const fs = require("fs");
      const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.exit(value?.status === "failed" ? 0 : 1);
    ' "$WATCHER_STARTUP_REPORT" >/dev/null 2>&1; then
      die "The injector rejected its payload/media startup; see $LOG_DIR/injector.log"
    fi
    injector_running || die "The injector LaunchAgent stopped during startup; see $LOG_DIR/injector.log"
    /bin/sleep 0.1
  done
  [ "$ready" -eq 1 ] || die "The injector did not complete its bounded payload/media startup; see $LOG_DIR/injector.log"
  pid="$(/bin/launchctl print "gui/$uid/$LAUNCH_AGENT_LABEL" 2>/dev/null | /usr/bin/awk '/pid =/ { print $3; exit }')"
  [ -z "$pid" ] || printf '%s\n' "$pid" >"$INJECTOR_PID_FILE"
}
