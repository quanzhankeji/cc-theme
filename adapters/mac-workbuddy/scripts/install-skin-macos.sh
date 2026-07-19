#!/bin/bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common-macos.sh
. "$SCRIPT_DIR/common-macos.sh"

start_after_install=0
start_args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-start) start_after_install=0; shift ;;
    --start) start_after_install=1; shift ;;
    --port) [ "$#" -ge 2 ] || die "$1 requires a value"; start_args+=("$1" "$2"); shift 2 ;;
    --theme-dir) [ "$#" -ge 2 ] || die "$1 requires a value"; start_after_install=1; start_args+=("$1" "$2"); shift 2 ;;
    --restart) start_after_install=1; start_args+=("$1"); shift ;;
    *) die "Unknown argument: $1" ;;
  esac
done

require_macos
discover_workbuddy
validate_workbuddy
discover_node

validate_install_destination
if [ "$PROJECT_ROOT" != "$INSTALL_ROOT" ]; then
  parent="$(dirname "$INSTALL_ROOT")"
  staging="$parent/.workbuddy-skin-staging.$$"
  previous="$parent/.workbuddy-skin-previous.$$"
  /bin/rm -rf "$staging"
  /bin/mkdir -p "$staging"
  "$NODE_RUNTIME" "$PROJECT_ROOT/scripts/adapter-release.mjs" "$staging" >/dev/null
  mark_install_directory "$staging"
  /bin/rm -rf "$previous"
  if [ -e "$INSTALL_ROOT" ]; then /bin/mv "$INSTALL_ROOT" "$previous"; fi
  if ! /bin/mv "$staging" "$INSTALL_ROOT"; then
    [ ! -e "$previous" ] || /bin/mv "$previous" "$INSTALL_ROOT"
    die "Could not install the adapter at $INSTALL_ROOT"
  fi
  /bin/rm -rf "$previous"
  log "Installed adapter at $INSTALL_ROOT"
else
  install_root_is_owned || die "Install ownership marker is missing: $INSTALL_ROOT"
  log "Adapter is already running from its install directory."
fi

if [ "$start_after_install" -eq 1 ]; then
  exec /bin/bash "$INSTALL_ROOT/scripts/start-skin-macos.sh" "${start_args[@]}"
fi
log "Adapter installed. WorkBuddy remains in its native state until an external theme is applied."
