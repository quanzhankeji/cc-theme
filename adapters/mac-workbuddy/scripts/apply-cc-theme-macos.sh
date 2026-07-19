#!/bin/bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common-macos.sh
. "$SCRIPT_DIR/common-macos.sh"

package=""
apply_now=1
report_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --file) [ "$#" -ge 2 ] || die "--file requires a value"; package="$2"; shift 2 ;;
    --no-apply) apply_now=0; shift ;;
    --report-file) [ "$#" -ge 2 ] || die "--report-file requires a value"; report_file="$2"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[ -n "$package" ] || die "Usage: apply-cc-theme-macos.sh --file <theme.cctheme> [--no-apply]"
[ -f "$package" ] || die "Theme package not found: $package"

require_macos
discover_workbuddy
validate_workbuddy
discover_node
/bin/mkdir -p "$STATE_DIR/themes"

result="$($NODE_RUNTIME "$SCRIPT_DIR/import-cc-theme.mjs" \
  --file "$package" \
  --themes-root "$STATE_DIR/themes" \
  --client-version "$WORKBUDDY_VERSION")" || die "The CC Theme package is unsafe, incompatible, or damaged."

theme_id="$($NODE_RUNTIME -e '
  const value = JSON.parse(process.argv[1]);
  if (typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value.id)) process.exit(1);
  process.stdout.write(value.id);
' "$result")" || die "The CC Theme importer returned an invalid theme id."
theme_dir="$STATE_DIR/themes/$theme_id"
[ -d "$theme_dir" ] && [ ! -L "$theme_dir" ] || die "The imported theme directory is missing or unsafe."
theme_dir="$(cd "$theme_dir" && pwd -P)"
"$NODE_RUNTIME" "$SCRIPT_DIR/injector.mjs" --check-payload \
  --theme-dir "$theme_dir" --themes-root "$STATE_DIR/themes" >/dev/null \
  || die "The imported theme failed WorkBuddy payload validation."

if [ "$apply_now" -eq 1 ]; then
  args=(--theme-dir "$theme_dir")
  [ -z "$report_file" ] || args+=(--report-file "$report_file")
  exec "$SCRIPT_DIR/start-skin-macos.sh" "${args[@]}"
fi
write_operation_report "$report_file" preflight ok theme-ready false "The external theme passed WorkBuddy payload validation"
log "External theme is validated and ready: $theme_id"
