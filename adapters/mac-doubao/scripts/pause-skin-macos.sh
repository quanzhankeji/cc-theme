#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
require_macos
discover_doubao
discover_node
port="$(state_value port)"; port="${port:-$DEFAULT_PORT}"
theme_dir="$(state_value theme_dir)"
stop_injector
if verified_cdp_endpoint "$port"; then
  "$NODE_RUNTIME" "$INJECTOR" --remove --port "$port" --timeout-ms 8000 >/dev/null
  if "$NODE_RUNTIME" "$INJECTOR" --verify --port "$port" --timeout-ms 5000 >/dev/null 2>&1; then
    die "Doubao markers remained after pause."
  fi
fi
write_state paused "$port" "$theme_dir"
printf '{"kind":"cc-theme.operation-result","schemaVersion":1,"adapter":"mac-doubao","operation":"pause","status":"ok","code":"pause-complete","changed":true}\n'
