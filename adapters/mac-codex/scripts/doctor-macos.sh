#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

REQUIRE_LIVE="false"
REQUIRE_SURFACE_ADMISSION="false"
SURFACE_EVIDENCE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --require-live) REQUIRE_LIVE="true"; shift ;;
    --require-surface-admission) REQUIRE_SURFACE_ADMISSION="true"; shift ;;
    --surface-evidence) SURFACE_EVIDENCE="${2:-}"; shift 2 ;;
    *) fail "Unknown doctor argument: $1" ;;
  esac
done

discover_codex_app
require_macos_runtime
if SURFACE_ADMISSION_JSON="$(surface_admission_report 2>/dev/null)"; then
  SURFACE_ADMITTED="true"
else
  SURFACE_ADMITTED="false"
  if [ -z "$SURFACE_ADMISSION_JSON" ]; then
    SURFACE_ADMISSION_JSON='{"kind":"cc-theme.surface-admission-result","revision":1,"adapterId":"mac-codex","allowed":false,"code":"surface-evidence-unavailable","diagnostics":[]}'
  fi
fi
if [ "$REQUIRE_SURFACE_ADMISSION" = "true" ] && [ "$SURFACE_ADMITTED" != "true" ]; then
  SURFACE_CODE="$(printf '%s' "$SURFACE_ADMISSION_JSON" | "$NODE" -e '
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => {
      try { process.stdout.write(JSON.parse(text).code || "surface-evidence-unavailable"); }
      catch { process.stdout.write("surface-evidence-unavailable"); }
    });
  ' 2>/dev/null || printf 'surface-evidence-unavailable')"
  fail "Current Codex Surface evidence did not admit Theme application ($SURFACE_CODE)."
fi
[ -f "$CONFIG_PATH" ] || fail "Codex config not found: $CONFIG_PATH"
for required in \
  "$PROJECT_ROOT/assets/skin.css" \
  "$PROJECT_ROOT/assets/renderer-inject.js" \
  "$PROJECT_ROOT/scripts/injector.mjs"; do
  [ -s "$required" ] || fail "Required project file is missing or empty: $required"
done

CHECK_THEME_DIR="$THEME_DIR"
THEME_AVAILABLE="false"
if [ -f "$CHECK_THEME_DIR/theme.json" ]; then
  PAYLOAD_JSON="$("$NODE" "$INJECTOR" --check-payload --theme-dir "$CHECK_THEME_DIR")"
  THEME_AVAILABLE="true"
else
  PAYLOAD_JSON='{"themeId":null,"themeName":null,"imageBytes":0,"payloadBytes":0}'
fi
PORT=9341
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
EVIDENCE_CAPTURED="false"
if [ -n "$SURFACE_EVIDENCE" ]; then
  [ "$LIVE" = "true" ] || fail "Live Surface Evidence requires an active Theme session."
  case "$SURFACE_EVIDENCE" in /*) ;; *) fail "Surface Evidence output must be an absolute path." ;; esac
  "$NODE" "$INJECTOR" --surface-evidence --port "$PORT" --timeout-ms 12000 --output "$SURFACE_EVIDENCE" >/dev/null
  EVIDENCE_CAPTURED="true"
fi

"$NODE" -e '
  const payload = JSON.parse(process.argv[1]);
  const result = {
    pass: true,
    product: "CC Theme",
    version: process.argv[2],
    platform: `darwin-${process.argv[3]}`,
    codexVersion: process.argv[4],
    codexTeamId: process.argv[5],
    nodeVersion: process.argv[6],
    officialAppSignatureValid: true,
    modifiesAppAsar: false,
    live: process.argv[7] === "true",
    port: Number(process.argv[8]),
    clientVersionPolicy: "always-latest",
    themeVerification: process.argv[7] === "true" ? "passed"
      : process.argv[11] === "true" ? "payload-only" : "no-external-theme",
    surfaceEvidenceCaptured: process.argv[9] === "true",
    surfaceAdmission: JSON.parse(process.argv[10]),
    theme: process.argv[11] === "true" ? {
      id: payload.themeId,
      name: payload.themeName,
      imageBytes: payload.imageBytes,
      payloadBytes: payload.payloadBytes,
    } : null,
  };
  console.log(JSON.stringify(result, null, 2));
' "$PAYLOAD_JSON" "$SKIN_VERSION" "$(/usr/bin/uname -m)" "$CODEX_VERSION" "$CODEX_TEAM_ID" "$NODE_VERSION" "$LIVE" "$PORT" "$EVIDENCE_CAPTURED" "$SURFACE_ADMISSION_JSON" "$THEME_AVAILABLE"
