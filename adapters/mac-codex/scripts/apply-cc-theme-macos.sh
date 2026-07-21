#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

PACKAGE=""
APPLY_NOW="true"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --file) PACKAGE="${2:-}"; shift 2 ;;
    --no-apply) APPLY_NOW="false"; shift ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[ -n "$PACKAGE" ] || fail "Usage: apply-cc-theme-macos.sh --file <theme.cctheme> [--no-apply]"
[ -f "$PACKAGE" ] || fail "The selected Theme Package was not found."

ensure_state_root
ensure_node_runtime
discover_codex_app
require_macos_runtime
if [ "$APPLY_NOW" = "true" ]; then require_surface_admission >/dev/null; fi

result="$($NODE "$SCRIPT_DIR/import-cc-theme.mjs" \
  --file "$PACKAGE" \
  --active-theme-root "$THEME_DIR" \
  --pets-root "$PETS_ROOT" \
  --pet-records-root "$PET_RECORDS_ROOT")" || fail "The CC Theme package is unsafe or damaged."

theme_id="$($NODE -e '
  const value = JSON.parse(process.argv[1]);
  if (typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value.id)) process.exit(1);
  process.stdout.write(value.id);
' "$result")" || fail "The CC Theme importer returned an invalid theme id."
pet_result="$($NODE -e '
  const value = JSON.parse(process.argv[1]);
  process.stdout.write(JSON.stringify(value.pet ?? { status: "absent", owned: false }));
' "$result")" || fail "The CC Theme importer returned an invalid pet result."
"$NODE" "$SCRIPT_DIR/theme-pet-store.mjs" activate \
  --state-root "$STATE_ROOT" \
  --theme-id "$theme_id" \
  --pet-result "$pet_result" >/dev/null \
  || fail "The external theme was activated, but its runtime ownership state could not be recorded."

emit_result() {
  "$NODE" -e '
    const imported = JSON.parse(process.argv[1]);
    process.stdout.write(`${JSON.stringify({ ...imported, applied: process.argv[2] === "true", mode: process.argv[3] })}\n`);
  ' "$result" "$1" "$2"
}

if [ "$APPLY_NOW" != "true" ]; then
  emit_result false staged
  exit 0
fi

PORT=9341
if [ -f "$STATE_PATH" ]; then
  saved="$(state_field port 2>/dev/null || true)"
  [ -n "${saved:-}" ] && PORT="$saved"
fi
if hot_reapply_theme "$PORT" 8000; then
  emit_result true hot
  exit 0
fi
if "$SCRIPT_DIR/start-skin-macos.sh" --port "$PORT" --restart-existing; then
  emit_result true cold
  exit 0
fi
fail "The external Theme Package was validated, but application failed; native Codex appearance was restored."
