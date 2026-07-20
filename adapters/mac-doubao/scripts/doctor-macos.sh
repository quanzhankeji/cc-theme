#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"
require_macos
discover_doubao
discover_node
port="$(state_value port)"; port="${port:-$DEFAULT_PORT}"
cdp=false
verified_cdp_endpoint "$port" && cdp=true
printf '{"adapter":"mac-doubao","ok":true,"bundleId":"%s","teamId":"%s","version":"%s","node":"%s","cdp":%s}\n' "$EXPECTED_BUNDLE_ID" "$EXPECTED_TEAM_ID" "$DOUBAO_VERSION" "$NODE_RUNTIME" "$cdp"
