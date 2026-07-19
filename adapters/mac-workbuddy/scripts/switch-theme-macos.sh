#!/bin/bash

# Manager-only theme selection entry. The caller supplies a validated id, not a
# path. This Adapter resolves exactly one direct child of its private Manager
# library, snapshots it, validates it again, and atomically commits the runtime
# copy before touching WorkBuddy.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common-macos.sh
. "$SCRIPT_DIR/common-macos.sh"

theme_id=""
apply_now=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --id) [ "$#" -ge 2 ] || die "--id requires a value"; theme_id="$2"; shift 2 ;;
    --no-apply) apply_now=0; shift ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[ -n "$theme_id" ] || die "Usage: switch-theme-macos.sh --id <theme-id> [--no-apply]"
case "$theme_id" in
  *[!A-Za-z0-9_-]*|'') die "Theme id may contain only letters, numbers, underscores, and hyphens." ;;
esac
[ "${#theme_id}" -le 80 ] || die "Theme id is too long."

themes_root="$STATE_DIR/themes"
[ -d "$STATE_DIR" ] && [ ! -L "$STATE_DIR" ] \
  || die "The Adapter state directory is unavailable or unsafe."
[ -d "$themes_root" ] && [ ! -L "$themes_root" ] \
  || die "The Manager theme library is unavailable or unsafe."
source_theme="$themes_root/$theme_id"
[ -d "$source_theme" ] && [ ! -L "$source_theme" ] \
  || die "Theme is not available in the Manager library: $theme_id"
[ -f "$source_theme/theme.json" ] && [ ! -L "$source_theme/theme.json" ] \
  || die "The Manager theme is missing a trusted theme.json: $theme_id"

themes_root_real="$(cd "$themes_root" && pwd -P)"
source_theme_real="$(cd "$source_theme" && pwd -P)"
[ "$(dirname "$source_theme_real")" = "$themes_root_real" ] \
  || die "Theme directory escapes the Manager library."

require_macos
discover_workbuddy
validate_workbuddy
discover_node

runtime_root="$STATE_DIR/runtime"
runtime_theme="$runtime_root/current"
[ ! -L "$runtime_root" ] || die "The Adapter runtime directory is unsafe."
/bin/mkdir -p "$runtime_root"
[ "$(cd "$runtime_root" && pwd -P)" = "$(cd "$STATE_DIR" && pwd -P)/runtime" ] \
  || die "The Adapter runtime directory escaped its state root."
/bin/chmod 700 "$STATE_DIR" "$themes_root" "$runtime_root"

stage="$(/usr/bin/mktemp -d "$runtime_root/.next.XXXXXX")"
previous=""
state_backup=""
start_report=""
had_previous=0
had_state=0
selection_committed=0

cleanup_transaction() {
  [ -z "$stage" ] || /bin/rm -rf "$stage"
  [ -z "$previous" ] || /bin/rm -rf "$previous"
  [ -z "$state_backup" ] || /bin/rm -f "$state_backup"
  [ -z "$start_report" ] || /bin/rm -f "$start_report"
}
trap cleanup_transaction EXIT
/bin/chmod 700 "$stage"

stage_result="$("$NODE_RUNTIME" "$SCRIPT_DIR/stage-theme.mjs" "$source_theme_real" "$stage")" \
  || die "Manager theme changed or failed stable staging: $theme_id"
"$NODE_RUNTIME" -e '
  const fs = require("fs");
  const staged = JSON.parse(process.argv[1]);
  const theme = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (!Array.isArray(staged.media) || staged.media.some((item) => typeof item !== "string")) process.exit(1);
  if (theme.id !== process.argv[3]) process.exit(1);
' "$stage_result" "$stage/theme.json" "$theme_id" \
  || die "Theme staging returned an invalid manifest or mismatched theme id."
"$NODE_RUNTIME" "$SCRIPT_DIR/injector.mjs" --check-payload \
  --theme-dir "$stage" --themes-root "$themes_root_real" >/dev/null \
  || die "Manager theme failed the WorkBuddy payload validation: $theme_id"

previous_mode="$(state_value mode)"
previous_port="$(state_value port)"; previous_port="${previous_port:-$DEFAULT_PORT}"
previous_theme="$(state_value theme_dir)"
was_running=0
workbuddy_running && was_running=1

if [ -e "$STATE_FILE" ] || [ -L "$STATE_FILE" ]; then
  [ -f "$STATE_FILE" ] && [ ! -L "$STATE_FILE" ] \
    || die "The Adapter state record is unsafe."
  state_backup="$(/usr/bin/mktemp "$STATE_DIR/.state.previous.XXXXXX")"
  /bin/chmod 600 "$state_backup"
  /bin/cp -p "$STATE_FILE" "$state_backup"
  had_state=1
fi

if [ -e "$runtime_theme" ] || [ -L "$runtime_theme" ]; then
  [ -d "$runtime_theme" ] && [ ! -L "$runtime_theme" ] \
    || die "The live runtime theme path is unsafe."
  previous="$(/usr/bin/mktemp -d "$runtime_root/.previous.XXXXXX")"
  /bin/rmdir "$previous"
  /bin/mv "$runtime_theme" "$previous" \
    || die "Could not preserve the last-known-good WorkBuddy theme."
  had_previous=1
fi
if ! /bin/mv "$stage" "$runtime_theme"; then
  [ "$had_previous" -eq 0 ] || /bin/mv "$previous" "$runtime_theme" 2>/dev/null || true
  die "Could not atomically commit the validated WorkBuddy theme."
fi
stage=""
selection_committed=1

rollback_selection() {
  if [ "$selection_committed" -eq 1 ] && [ -d "$runtime_theme" ] && [ ! -L "$runtime_theme" ]; then
    /bin/rm -rf "$runtime_theme"
  fi
  if [ "$had_previous" -eq 1 ] && [ -d "$previous" ] && [ ! -L "$previous" ]; then
    /bin/mv "$previous" "$runtime_theme"
    previous=""
  fi
  if [ "$had_state" -eq 1 ] && [ -f "$state_backup" ] && [ ! -L "$state_backup" ]; then
    /bin/mv -f "$state_backup" "$STATE_FILE"
    state_backup=""
  else
    /bin/rm -f "$STATE_FILE"
  fi
  selection_committed=0
}

finish_transaction() {
  [ -z "$previous" ] || /bin/rm -rf "$previous"
  previous=""
  [ -z "$state_backup" ] || /bin/rm -f "$state_backup"
  state_backup=""
  selection_committed=0
  trap - EXIT
}

emit_result() {
  local applied="$1" mode="$2" source_report="${3:-}"
  "$NODE_RUNTIME" -e '
    const fs = require("fs");
    const [id, applied, mode, source] = process.argv.slice(1);
    const base = source ? JSON.parse(fs.readFileSync(source, "utf8")) : null;
    const output = base ? {
      ...base,
      operation: "apply",
      phase: "apply",
      changed: true,
      details: { ...(base.details ?? {}), themeId: id, applied: true, mode },
    } : {
      kind: "cc-theme.operation-result", schemaVersion: 1, adapter: "mac-workbuddy",
      operation: "apply", phase: "apply", status: "ok", ok: true, changed: true,
      code: applied === "true" ? "apply-active" : "apply-staged",
      message: applied === "true" ? "CC Theme is active in WorkBuddy" : "CC Theme is selected and paused",
      details: { themeId: id, applied: applied === "true", mode },
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
  ' "$theme_id" "$applied" "$mode" "$source_report"
  [ -z "$source_report" ] || /bin/rm -f "$source_report"
}

if [ "$apply_now" -eq 0 ]; then
  # A selected-but-not-launched theme must not remain under an old live watcher.
  # Pause removes any current renderer payload while retaining the new runtime
  # selection for the next explicit Manager launch/apply.
  if ! "$SCRIPT_DIR/pause-skin-macos.sh" >/dev/null; then
    rollback_selection
    die "Theme was validated, but the prior live session could not be paused safely."
  fi
  write_state paused "$previous_port" "$runtime_theme"
  finish_transaction
  emit_result false paused
  exit 0
fi

start_report="$(/usr/bin/mktemp "$STATE_DIR/.manager-start-result.XXXXXX")"
/bin/rm -f "$start_report"
if "$SCRIPT_DIR/start-skin-macos.sh" --port "$previous_port" --theme-dir "$runtime_theme" \
  --report-file "$start_report"; then
  finish_transaction
  emit_result true active "$start_report"
  start_report=""
  exit 0
fi

rollback_selection

# Restore the previous live/paused/native state after a failed apply. This is a
# best-effort runtime recovery; the selection and state-file rollback above are
# completed first and do not depend on WorkBuddy being reachable.
recovered=0
if [ "$previous_mode" = "active" ] && [ -d "$previous_theme" ] && [ ! -L "$previous_theme" ] \
  && [ -f "$previous_theme/theme.json" ] && [ ! -L "$previous_theme/theme.json" ]; then
  "$SCRIPT_DIR/start-skin-macos.sh" --port "$previous_port" --theme-dir "$previous_theme" >/dev/null 2>&1 \
    && recovered=1
elif [ "$previous_mode" = "paused" ]; then
  "$SCRIPT_DIR/pause-skin-macos.sh" >/dev/null 2>&1 && recovered=1
else
  stop_injector
  if verify_debug_endpoint "$previous_port"; then
    "$NODE_RUNTIME" "$SCRIPT_DIR/injector.mjs" --remove --port "$previous_port" --timeout-ms 8000 >/dev/null 2>&1 || true
  fi
  if [ "$was_running" -eq 1 ]; then
    stop_workbuddy
    launch_workbuddy_normal >/dev/null 2>&1 || true
  else
    stop_workbuddy
  fi
  recovered=1
fi
[ "$recovered" -eq 1 ] \
  || warn "The previous WorkBuddy runtime could not be restarted automatically; its saved selection was still restored."
die "The Manager theme passed preflight, but WorkBuddy application failed; the prior selection was restored."
