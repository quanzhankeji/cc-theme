#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
require_macos
discover_doubao
port="$(state_value port)"; port="${port:-$DEFAULT_PORT}"
relaunch=false
if verified_cdp_endpoint "$port" || [ -f "$STATE_FILE" ]; then relaunch=true; fi
restore_native_runtime "$port" "$relaunch"
printf '{"kind":"cc-theme.operation-result","schemaVersion":1,"adapter":"mac-doubao","operation":"restore","status":"ok","code":"restore-complete","changed":true}\n'
