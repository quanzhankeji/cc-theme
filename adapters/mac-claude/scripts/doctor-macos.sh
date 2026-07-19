#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

REQUIRE_LIVE="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --require-live) REQUIRE_LIVE="true"; shift ;;
    *) fail "Unknown doctor argument: $1" ;;
  esac
done

discover_claude_app
require_macos_runtime
for required in \
  "$PROJECT_ROOT/assets/skin.css" \
  "$PROJECT_ROOT/assets/renderer-inject.js" \
  "$PROJECT_ROOT/scripts/injector.mjs"; do
  [ -s "$required" ] || fail "Required project file is missing or empty: $required"
done

CHECK_THEME_DIR="$THEME_DIR"
THEME_AVAILABLE="false"
PAYLOAD_JSON='{}'
if [ -f "$CHECK_THEME_DIR/theme.json" ]; then
  PAYLOAD_JSON="$("$NODE" "$INJECTOR" --check-payload --theme-dir "$CHECK_THEME_DIR")"
  THEME_AVAILABLE="true"
fi
PORT=9451
if [ -f "$STATE_PATH" ]; then
  PORT="$(state_field port)"
fi
LIVE="false"
if [ -f "$STATE_PATH" ] && verified_cdp_endpoint "$PORT"; then
  [ -f "$THEME_DIR/theme.json" ] || fail "A live Skin session has no installed active theme: $THEME_DIR"
  "$NODE" "$INJECTOR" --verify --port "$PORT" --theme-dir "$THEME_DIR" --timeout-ms 12000 >/dev/null
  LIVE="true"
fi
[ "$REQUIRE_LIVE" = "false" ] || [ "$LIVE" = "true" ] || fail "No live Theme session is active."
APPLY_AVAILABLE="false"
runtime_apply_available && APPLY_AVAILABLE="true"

"$NODE" -e '
  const payload = JSON.parse(process.argv[1]);
  const applyAvailable = process.argv[9] === "true";
  const themeAvailable = process.argv[10] === "true";
  const result = {
    kind: "cc-theme.lifecycle-result",
    schemaVersion: 1,
    phase: "preflight",
    status: applyAvailable ? "passed" : "failed",
    pass: applyAvailable,
    failureCategory: applyAvailable ? null : "adapter-landmark",
    code: applyAvailable ? "ok" : "transport-unavailable",
    adapter: "mac-claude",
    privacy: "structure-only-no-user-content",
    product: "CC Theme",
    version: process.argv[2],
    platform: `darwin-${process.argv[3]}`,
    claudeVersion: process.argv[4],
    claudeTeamId: process.argv[5],
    nodeVersion: process.argv[6],
    officialAppSignatureValid: true,
    modifiesAppAsar: false,
    live: process.argv[7] === "true",
    port: Number(process.argv[8]),
    clientVersionPolicy: "verified-build-with-runtime-probe",
    themeVerification: process.argv[7] === "true" ? "passed" : themeAvailable ? "payload-only" : "no-external-theme-active",
    capability: {
      status: applyAvailable ? "available" : "projection-only",
      runtimeApplyAvailable: applyAvailable,
      managerApplyAllowed: applyAvailable,
      managerSelectionScope: "adapter-local",
      deepSettingsAvailable: applyAvailable,
      diagnosticPreviewAvailable: true,
      diagnosticPreviewMode: "user-confirmed-devtools",
      diagnosticPreviewPersistence: "renderer-session",
      diagnosticPreviewRequiresUserAction: true,
      reasonCode: applyAvailable ? null : "official-cdp-auth-required"
    },
    theme: themeAvailable ? {
      id: payload.themeId,
      name: payload.themeName,
      imageBytes: payload.imageBytes,
      payloadBytes: payload.payloadBytes,
    } : null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!applyAvailable) process.exitCode = 2;
' "$PAYLOAD_JSON" "$SKIN_VERSION" "$(/usr/bin/uname -m)" "$CLAUDE_VERSION" "$CLAUDE_TEAM_ID" "$NODE_VERSION" "$LIVE" "$PORT" "$APPLY_AVAILABLE" "$THEME_AVAILABLE"
