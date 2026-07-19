#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

discover_claude_app
require_macos_runtime
INFO="$CLAUDE_BUNDLE/Contents/Info.plist"
ASAR="$CLAUDE_BUNDLE/Contents/Resources/app.asar"
FRAMEWORK_INFO="$CLAUDE_BUNDLE/Contents/Frameworks/Electron Framework.framework/Resources/Info.plist"
FRAMEWORK_BINARY="$CLAUDE_BUNDLE/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework"
[ -f "$ASAR" ] || fail "Claude app.asar was not found."
BUILD="$(/usr/bin/plutil -extract CFBundleVersion raw -o - "$INFO")"
ELECTRON_VERSION="$(/usr/bin/plutil -extract CFBundleVersion raw -o - "$FRAMEWORK_INFO" 2>/dev/null || true)"
set +o pipefail
CHROMIUM_VERSION="$(/usr/bin/strings -a "$FRAMEWORK_BINARY" | /usr/bin/sed -n 's/.*Chrome\/\([0-9][0-9.]*\).*/\1/p' | /usr/bin/head -n 1)"
set -o pipefail
ASAR_INTEGRITY="$(/usr/libexec/PlistBuddy -c 'Print :ElectronAsarIntegrity:Resources/app.asar:hash' "$FRAMEWORK_INFO" 2>/dev/null || true)"
ASAR_SHA256="$(/usr/bin/shasum -a 256 "$ASAR" | /usr/bin/awk '{print $1}')"
SIGNING_DETAILS="$(/usr/bin/codesign -dvvv "$CLAUDE_BUNDLE" 2>&1)"
CODE_DIRECTORY_SHA256="$(/usr/bin/printf '%s\n' "$SIGNING_DETAILS" | /usr/bin/awk -F= '/^CandidateCDHashFull sha256=/{print $2; exit}')"
HARDENED_RUNTIME="false"
NOTARIZATION_STAPLED="false"
/usr/bin/printf '%s\n' "$SIGNING_DETAILS" | /usr/bin/grep -q 'flags=.*(runtime)' && HARDENED_RUNTIME="true"
/usr/bin/printf '%s\n' "$SIGNING_DETAILS" | /usr/bin/grep -q '^Notarization Ticket=stapled$' && NOTARIZATION_STAPLED="true"
GATEKEEPER_ACCEPTED="false"
if /usr/sbin/spctl -a -t exec "$CLAUDE_BUNDLE" >/dev/null 2>&1; then GATEKEEPER_ACCEPTED="true"; fi

MAIN_PROCESS_COUNT=0
RENDERER_PROCESS_COUNT=0
GPU_PROCESS_COUNT=0
UTILITY_PROCESS_COUNT=0
MAIN_PID="$(claude_main_pids | /usr/bin/head -n 1 || true)"
if [ -n "$MAIN_PID" ]; then
  MAIN_PROCESS_COUNT="$(claude_main_pids | /usr/bin/awk 'NF {count++} END {print count+0}')"
  while read -r child_type; do
    case "$child_type" in
      renderer) RENDERER_PROCESS_COUNT=$((RENDERER_PROCESS_COUNT + 1)) ;;
      gpu-process) GPU_PROCESS_COUNT=$((GPU_PROCESS_COUNT + 1)) ;;
      utility) UTILITY_PROCESS_COUNT=$((UTILITY_PROCESS_COUNT + 1)) ;;
    esac
  done < <(/bin/ps -axo ppid=,command= | /usr/bin/awk -v parent="$MAIN_PID" '
    $1 == parent {
      type = "other";
      for (i = 2; i <= NF; i++) if ($i ~ /^--type=/) { split($i, value, "="); type = value[2]; }
      print type;
    }
  ')
fi

"$NODE" -e '
  const [version, build, team, electron, chromium, asar, integrity, codeDirectory,
    hardened, notarized, gatekeeper, node, mainCount, rendererCount, gpuCount, utilityCount] = process.argv.slice(1);
  const pass = version === "1.22209.3" && build === "1.22209.3" && team === "Q6L2SF6YDW" &&
    electron === "42.5.1" && chromium === "148.0.7778.271" &&
    asar === "a72a8b5085dbe4bcf7a4271fa9928b5755b7942c99ae70e2a72416755d14e06b" &&
    integrity === "5d18bf11c657d56b2445d5cf72f6adb90321af1496c2788db0d855a8012af412" &&
    codeDirectory === "9cf979f2bf5f36fc9d568f7fe362d586f40aead11866eae4e5cbe354f14d9707" &&
    hardened === "true" && notarized === "true" && gatekeeper === "true";
  console.log(JSON.stringify({
    kind: "cc-theme.lifecycle-result",
    schemaVersion: 1,
    phase: "detect",
    status: pass ? "passed" : "failed",
    pass,
    failureCategory: pass ? null : "adapter-landmark",
    code: pass ? "ok" : "runtime-invalid",
    adapter: "mac-claude",
    privacy: "structure-only-no-user-content",
    compatibility: pass ? "exact-host-binary-evidence-matched-surface-admission-blocked" : "unverified-build",
    bundleId: "com.anthropic.claudefordesktop",
    version,
    build,
    signingTeamId: team,
    signatureValid: true,
    electronVersion: electron || null,
    chromiumVersion: chromium,
    appAsarSha256: asar,
    appAsarIntegrity: integrity,
    codeDirectorySha256: codeDirectory,
    hardenedRuntime: hardened === "true",
    notarizationTicket: notarized === "true" ? "stapled" : "missing",
    gatekeeperAccepted: gatekeeper === "true",
    processIdentity: {
      mainProcessCount: Number(mainCount),
      directChildProcessCounts: {
        renderer: Number(rendererCount),
        "gpu-process": Number(gpuCount),
        utility: Number(utilityCount)
      },
      capturedCommandLines: false,
      capturedUserPaths: false
    },
    renderer: {
      localShell: "asar-backed",
      remoteOriginRequired: true,
      debugEntry: "CLAUDE_DEV_TOOLS=detach",
      transport: "official-authenticated-cdp-required"
    },
    externalRuntime: { nodeVersion: node },
    officialBundleReadOnly: true,
    availability: {
      status: "projection-only",
      runtimeApplyAvailable: false,
      managerApplyAllowed: false,
      managerSelectionScope: "adapter-local",
      deepSettingsAvailable: false,
      diagnosticPreviewAvailable: true,
      diagnosticPreviewMode: "user-confirmed-devtools",
      diagnosticPreviewPersistence: "renderer-session",
      diagnosticPreviewRequiresUserAction: true,
      reasonCode: "official-cdp-auth-required"
    },
    remoteRendererEvidence: {
      status: "not-reverified-for-1.22209.3",
      buildId: null,
      gitHash: null,
      buildTimestamp: null,
      surfaceAdmission: "fail-closed-pending-live-landmarks"
    }
  }, null, 2));
  if (!pass) process.exitCode = 2;
' "$CLAUDE_VERSION" "$BUILD" "$CLAUDE_TEAM_ID" "$ELECTRON_VERSION" "$CHROMIUM_VERSION" "$ASAR_SHA256" "$ASAR_INTEGRITY" \
  "$CODE_DIRECTORY_SHA256" "$HARDENED_RUNTIME" "$NOTARIZATION_STAPLED" "$GATEKEEPER_ACCEPTED" "$NODE_VERSION" \
  "$MAIN_PROCESS_COUNT" "$RENDERER_PROCESS_COUNT" "$GPU_PROCESS_COUNT" "$UTILITY_PROCESS_COUNT"
