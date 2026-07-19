#!/bin/bash

# Apply one Manager-provided, already-compiled theme from the private saved
# library. The Adapter never falls back to bundled presets or accepts a caller
# supplied path: Manager selects a validated id and this fixed interpreter
# resolves exactly one direct child of $STATE_ROOT/themes.

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

THEME_ID=""
APPLY_NOW="true"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --id) THEME_ID="${2:-}"; shift 2 ;;
    --no-apply) APPLY_NOW="false"; shift ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[ -n "$THEME_ID" ] || fail "Usage: switch-theme-macos.sh --id <theme-id> [--no-apply]"
case "$THEME_ID" in
  *[!A-Za-z0-9_-]*|'') fail "Theme id may contain only letters, numbers, underscores, and hyphens." ;;
esac
[ "${#THEME_ID}" -le 80 ] || fail "Theme id is too long."

ensure_state_root
ensure_node_runtime
THEMES_ROOT="$STATE_ROOT/themes"
[ -d "$THEMES_ROOT" ] && [ ! -L "$THEMES_ROOT" ] \
  || fail "The Manager theme library is unavailable or unsafe."
SOURCE_THEME="$THEMES_ROOT/$THEME_ID"
[ -d "$SOURCE_THEME" ] && [ ! -L "$SOURCE_THEME" ] \
  || fail "Theme is not available in the Manager library: $THEME_ID"
[ -f "$SOURCE_THEME/theme.json" ] && [ ! -L "$SOURCE_THEME/theme.json" ] \
  || fail "The Manager theme is missing a trusted theme.json: $THEME_ID"

themes_root_real="$(cd "$THEMES_ROOT" && pwd -P)"
source_theme_real="$(cd "$SOURCE_THEME" && pwd -P)"
[ "$(dirname "$source_theme_real")" = "$themes_root_real" ] \
  || fail "Theme directory escapes the Manager library."

progress() {
  printf '%s\n' "$*" >&2
  /usr/bin/osascript -e "display notification \"$*\" with title \"CC Theme\"" >/dev/null 2>&1 || true
}

stage="$(/usr/bin/mktemp -d "$STATE_ROOT/.theme-switch.XXXXXX")"
previous=""
active_record_backup=""
had_previous="false"
had_active_record="false"

cleanup_transaction() {
  [ -z "$stage" ] || /bin/rm -rf "$stage"
  [ -z "$previous" ] || /bin/rm -rf "$previous"
  [ -z "$active_record_backup" ] || /bin/rm -f "$active_record_backup"
}
trap cleanup_transaction EXIT
/bin/chmod 700 "$stage"

progress "Validating Manager theme..."
STAGE_RESULT="$("$NODE" "$SCRIPT_DIR/stage-theme.mjs" "$source_theme_real" "$stage")" \
  || fail "Manager theme changed or failed stable staging: $THEME_ID"
"$NODE" -e '
  const fs = require("fs");
  const value = JSON.parse(process.argv[1]);
  const theme = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (!Array.isArray(value.media) || value.media.some((item) => typeof item !== "string")) process.exit(1);
  if (theme.id !== process.argv[3]) process.exit(1);
' "$STAGE_RESULT" "$stage/theme.json" "$THEME_ID" \
  || fail "Theme staging returned an invalid manifest or mismatched theme id."
"$NODE" "$INJECTOR" --check-payload --theme-dir "$stage" >/dev/null \
  || fail "Manager theme failed the Codex payload validation: $THEME_ID"
PET_RESULT="$("$NODE" "$SCRIPT_DIR/theme-pet-store.mjs" install \
  --theme-dir "$stage" \
  --pets-root "$PETS_ROOT" \
  --records-root "$PET_RECORDS_ROOT")" \
  || fail "Theme pet is unsafe, incomplete, or conflicts with a local Codex pet: $THEME_ID"

# Snapshot the active-record marker before committing the new selection. The
# theme directory itself is staged and validated in full before this bounded
# rename transaction; no partially copied theme becomes the live interpreter
# input.
if [ -e "$ACTIVE_THEME_PATH" ] || [ -L "$ACTIVE_THEME_PATH" ]; then
  [ -f "$ACTIVE_THEME_PATH" ] && [ ! -L "$ACTIVE_THEME_PATH" ] \
    || fail "The active-theme record is not a trusted regular file."
  active_record_backup="$(/usr/bin/mktemp "$STATE_ROOT/.active-theme.previous.XXXXXX")"
  /bin/chmod 600 "$active_record_backup"
  /bin/cp -p "$ACTIVE_THEME_PATH" "$active_record_backup"
  had_active_record="true"
fi

if [ -e "$THEME_DIR" ] || [ -L "$THEME_DIR" ]; then
  [ -d "$THEME_DIR" ] && [ ! -L "$THEME_DIR" ] \
    || fail "The live theme path is not a trusted directory."
  previous="$(/usr/bin/mktemp -d "$STATE_ROOT/.theme-previous.XXXXXX")"
  /bin/rmdir "$previous"
  /bin/mv "$THEME_DIR" "$previous" \
    || fail "Could not preserve the last-known-good Codex theme."
  had_previous="true"
fi
if ! /bin/mv "$stage" "$THEME_DIR"; then
  [ "$had_previous" != "true" ] || /bin/mv "$previous" "$THEME_DIR" 2>/dev/null || true
  fail "Could not atomically commit the validated Codex theme."
fi
stage=""

rollback_selection() {
  if [ -d "$THEME_DIR" ] && [ ! -L "$THEME_DIR" ]; then
    /bin/rm -rf "$THEME_DIR"
  fi
  if [ "$had_previous" = "true" ] && [ -d "$previous" ] && [ ! -L "$previous" ]; then
    /bin/mv "$previous" "$THEME_DIR"
    previous=""
  fi
  if [ "$had_active_record" = "true" ] && [ -f "$active_record_backup" ]; then
    /bin/mv -f "$active_record_backup" "$ACTIVE_THEME_PATH"
    active_record_backup=""
  else
    /bin/rm -f "$ACTIVE_THEME_PATH"
  fi
}

if ! "$NODE" "$SCRIPT_DIR/theme-pet-store.mjs" activate \
  --state-root "$STATE_ROOT" \
  --theme-id "$THEME_ID" \
  --pet-result "$PET_RESULT" >/dev/null; then
  rollback_selection
  fail "Theme was validated, but its runtime ownership state could not be committed."
fi

THEME_NAME="$("$NODE" -e 'try{const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(t.name||"")}catch{}' "$THEME_DIR/theme.json" 2>/dev/null || true)"
[ -n "$THEME_NAME" ] || THEME_NAME="$THEME_ID"

emit_result() {
  "$NODE" -e '
    const [id, name, applied, mode, rawPet] = process.argv.slice(1);
    process.stdout.write(`${JSON.stringify({ id, name, applied: applied === "true", mode, pet: JSON.parse(rawPet) })}\n`);
  ' "$THEME_ID" "$THEME_NAME" "$1" "$2" "$PET_RESULT"
}

finish_transaction() {
  [ -z "$previous" ] || /bin/rm -rf "$previous"
  previous=""
  [ -z "$active_record_backup" ] || /bin/rm -f "$active_record_backup"
  active_record_backup=""
  trap - EXIT
}

if [ "$APPLY_NOW" != "true" ]; then
  finish_transaction
  progress "Ready: ${THEME_NAME} (not applied)"
  emit_result false staged
  exit 0
fi

PORT=9341
if [ -f "$STATE_PATH" ]; then
  saved="$(state_field port 2>/dev/null || true)"
  [ -n "${saved:-}" ] && PORT="$saved"
fi

if hot_reapply_theme "$PORT" 8000; then
  finish_transaction
  progress "Done: ${THEME_NAME}"
  emit_result true hot
  exit 0
fi

progress "CDP not ready, starting the verified Codex runtime..."
if "$SCRIPT_DIR/start-skin-macos.sh" --port "$PORT" --restart-existing; then
  finish_transaction
  progress "Done: ${THEME_NAME}"
  emit_result true cold
  exit 0
fi

rollback_selection
fail "The Manager theme passed preflight, but Codex application failed; the prior selection was restored and native appearance was preserved."
