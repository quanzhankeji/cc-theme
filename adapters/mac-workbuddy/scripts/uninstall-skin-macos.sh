#!/bin/bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common-macos.sh
. "$SCRIPT_DIR/common-macos.sh"

validate_install_destination
/bin/bash "$PROJECT_ROOT/scripts/restore-skin-macos.sh"
if [ "$PROJECT_ROOT" = "$INSTALL_ROOT" ]; then
  install_root_is_owned || die "Refusing to remove an unowned install directory: $INSTALL_ROOT"
  parent="$(dirname "$INSTALL_ROOT")"
  tombstone="$parent/.workbuddy-skin-remove.$$"
  /bin/mv "$INSTALL_ROOT" "$tombstone"
  /bin/rm -rf "$tombstone"
  printf '[workbuddy-skin] Adapter uninstalled.\n'
else
  warn "Current source tree was not removed; deployed installs live at $INSTALL_ROOT"
fi
