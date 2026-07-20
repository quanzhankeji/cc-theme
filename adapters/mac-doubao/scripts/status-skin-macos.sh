#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
require_macos
discover_doubao
discover_node
mode="$(state_value mode)"; mode="${mode:-native}"
port="$(state_value port)"; port="${port:-$DEFAULT_PORT}"
live=false
if verified_cdp_endpoint "$port" && "$NODE_RUNTIME" "$INJECTOR" --verify --port "$port" --timeout-ms 5000 >/dev/null 2>&1; then live=true; fi
printf '{"adapter":"mac-doubao","mode":"%s","port":%s,"live":%s,"appVersion":"%s"}\n' "$mode" "$port" "$live" "$DOUBAO_VERSION"
