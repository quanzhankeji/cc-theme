#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
require_macos
discover_doubao
discover_node
port="$(state_value port)"; port="${port:-$DEFAULT_PORT}"
verified_cdp_endpoint "$port" || die "No verified Doubao CDP endpoint on port $port."
exec "$NODE_RUNTIME" "$INJECTOR" --verify --port "$port" --timeout-ms 10000 "$@"
