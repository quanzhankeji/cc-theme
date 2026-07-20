#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

theme_id=""
apply_now=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --id) [ "$#" -ge 2 ] || die "--id requires a value"; theme_id="$2"; shift 2 ;;
    --no-apply) apply_now=0; shift ;;
    *) die "Unknown switch argument: $1" ;;
  esac
done
case "$theme_id" in ''|*[!A-Za-z0-9_-]*) die "Theme id is invalid." ;; esac
[ "${#theme_id}" -le 80 ] || die "Theme id is too long."
themes_root="$STATE_DIR/themes"
source_theme="$themes_root/$theme_id"
[ -d "$themes_root" ] && [ ! -L "$themes_root" ] || die "The Manager theme library is unavailable."
[ -d "$source_theme" ] && [ ! -L "$source_theme" ] || die "Theme is unavailable: $theme_id"
[ "$(dirname "$(cd "$source_theme" && pwd -P)")" = "$(cd "$themes_root" && pwd -P)" ] || die "Theme escaped the Manager library."

require_macos
discover_doubao
discover_node
"$NODE_RUNTIME" "$INJECTOR" --check-payload --theme-dir "$source_theme" >/dev/null
port="$(state_value port)"; port="${port:-$DEFAULT_PORT}"
if [ "$apply_now" -eq 0 ]; then
  stop_injector
  verified_cdp_endpoint "$port" && "$NODE_RUNTIME" "$INJECTOR" --remove --port "$port" --timeout-ms 8000 >/dev/null || true
  write_state paused "$port" "$source_theme"
  printf '{"kind":"cc-theme.operation-result","schemaVersion":1,"adapter":"mac-doubao","operation":"apply","status":"ok","code":"apply-staged","changed":true,"details":{"themeId":"%s"}}\n' "$theme_id"
  exit 0
fi
exec "$SCRIPT_DIR/start-skin-macos.sh" --port "$port" --theme-dir "$source_theme"
