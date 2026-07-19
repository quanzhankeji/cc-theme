#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

enter_adapter_transaction activate-external-package "$SCRIPT_DIR/apply-cc-theme-macos.sh" "$@"

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
[ -f "$PACKAGE" ] || fail "Theme package not found: $PACKAGE"
[ "$APPLY_NOW" != "true" ] || require_runtime_apply_available

ensure_state_root
ensure_node_runtime
discover_claude_app

result="$($NODE "$SCRIPT_DIR/import-cc-theme.mjs" \
  --file "$PACKAGE" \
  --active-theme-root "$THEME_DIR")" || fail "The CC Theme package is unsafe or damaged."

theme_id="$($NODE -e '
  const value = JSON.parse(process.argv[1]);
  if (typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value.id)) process.exit(1);
  process.stdout.write(value.id);
' "$result")" || fail "The CC Theme importer returned an invalid theme id."

if [ "$APPLY_NOW" = "true" ]; then
  exec "$SCRIPT_DIR/start-skin-macos.sh" --restart-existing
else
  "$NODE" -e '
    const value = JSON.parse(process.argv[1]);
    process.stdout.write(`${JSON.stringify({
      kind: "cc-theme.lifecycle-result", schemaVersion: 1, phase: "apply",
      status: "passed", pass: true, failureCategory: null, code: "ok",
      adapter: "mac-claude", privacy: "structure-only-no-user-content",
      id: value.id, name: value.name, applied: false, mode: "external-package-staged",
    })}\n`);
  ' "$result"
fi
