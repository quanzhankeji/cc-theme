#!/bin/bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common-macos.sh
. "$SCRIPT_DIR/common-macos.sh"

port="$DEFAULT_PORT"
theme_dir=""
force_restart=0
report_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) [ "$#" -ge 2 ] || die "--port requires a value"; port="$2"; shift 2 ;;
    --theme-dir) [ "$#" -ge 2 ] || die "--theme-dir requires a value"; theme_dir="$2"; shift 2 ;;
    --restart) force_restart=1; shift ;;
    --report-file) [ "$#" -ge 2 ] || die "--report-file requires a value"; report_file="$2"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

case "$port" in *[!0-9]*|'') die "Invalid port: $port" ;; esac
[ "$port" -ge 1024 ] && [ "$port" -le 65535 ] || die "Invalid port: $port"
if [ -z "$theme_dir" ]; then theme_dir="$(state_value theme_dir)"; fi
[ -n "$theme_dir" ] || die "No external theme is selected. Apply a validated .cctheme package or pass --theme-dir."
[ -d "$theme_dir" ] && [ ! -L "$theme_dir" ] || die "Theme directory is missing or unsafe: $theme_dir"
theme_dir="$(cd "$theme_dir" && pwd -P)"
[ -f "$theme_dir/theme.json" ] || die "Theme directory is missing theme.json: $theme_dir"

require_macos
discover_workbuddy
discover_node
now_ms() { "$NODE_RUNTIME" -e 'process.stdout.write(String(Date.now()))'; }
elapsed_ms() { "$NODE_RUNTIME" -e 'process.stdout.write(String(Math.max(0, Math.min(120000, Number(process.argv[2]) - Number(process.argv[1])))))' "$1" "$2"; }

total_started_ms="$(now_ms)"
validation_started_ms="$total_started_ms"
validate_workbuddy
validation_finished_ms="$(now_ms)"
/bin/mkdir -p "$STATE_DIR/themes"
/bin/chmod 700 "$STATE_DIR" "$STATE_DIR/themes"
startup_committed=0
startup_verify_report="$STATE_DIR/.startup-verify.$$.json"
cleanup_failed_start() {
  if [ "$startup_committed" -eq 0 ]; then
    if verify_debug_endpoint "$port"; then
      "$NODE_RUNTIME" "$PROJECT_ROOT/scripts/injector.mjs" --remove --port "$port" --timeout-ms 4000 >/dev/null 2>&1 || true
    fi
    stop_injector || true
  fi
  /bin/rm -f "$startup_verify_report"
}
trap cleanup_failed_start EXIT

watcher_stop_started_ms="$(now_ms)"
stop_injector || die "The previous injector could not be stopped safely."
watcher_stop_finished_ms="$(now_ms)"

needs_launch=0
host_stop_started_ms="$(now_ms)"
if [ "$force_restart" -eq 1 ] || ! verify_debug_endpoint "$port"; then
  needs_launch=1
  if workbuddy_running || [ -n "$(workbuddy_owned_pids)" ]; then
    log "Restarting WorkBuddy to enable its local CDP endpoint."
    stop_workbuddy
  fi
fi
host_stop_finished_ms="$(now_ms)"

watcher_started_ms="$(now_ms)"
start_injector "$port" "$theme_dir" "$STATE_DIR/themes"
watcher_ready_ms="$(now_ms)"

host_launch_started_ms="$(now_ms)"
if [ "$needs_launch" -eq 1 ]; then
  log "Launching WorkBuddy $WORKBUDDY_VERSION with CDP on 127.0.0.1:$port."
  launch_workbuddy_debug "$port"
  wait_for_workbuddy_main 10 || die "WorkBuddy main process did not appear from the verified bundle path."
  host_main_ready_ms="$(now_ms)"
  wait_for_debug_endpoint "$port" 30 || die "WorkBuddy CDP endpoint did not become ready; see $LOG_DIR/workbuddy.log"
else
  log "Reusing the verified WorkBuddy CDP endpoint on 127.0.0.1:$port."
  host_main_ready_ms="$host_launch_started_ms"
fi
cdp_ready_ms="$(now_ms)"

foreground_started_ms="$(now_ms)"
foreground_confirmed=false
if activate_workbuddy; then foreground_confirmed=true; fi
foreground_finished_ms="$(now_ms)"

verify_started_ms="$(now_ms)"
if ! "$NODE_RUNTIME" "$PROJECT_ROOT/scripts/injector.mjs" --verify --startup --port "$port" \
  --timeout-ms 20000 --report-file "$startup_verify_report" >/dev/null; then
  verify_finished_ms="$(now_ms)"
  failure_code="$("$NODE_RUNTIME" -e '
    const fs = require("fs");
    try {
      const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.stdout.write(String(value?.code || "startup-verification-failed"));
    } catch { process.stdout.write("startup-verification-failed"); }
  ' "$startup_verify_report")"
  details_json="$("$NODE_RUNTIME" -e '
    const fs = require("fs");
    const read = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
    const verify = read(process.argv[1]);
    const watcher = read(process.argv[2]);
    const inspected = verify?.targets?.[0]?.result?.inspected ?? {};
    process.stdout.write(JSON.stringify({
      foregroundHandoff: { requested: true, confirmed: process.argv[3] === "true" },
      playback: {
        outcome: "failed",
        code: verify?.code ?? "startup-verification-failed",
        videoReady: inspected.videoReady === true,
        playbackState: inspected.videoPlaybackState ?? null,
        errorCode: inspected.videoErrorCode ?? null,
        networkState: inspected.videoNetworkState ?? null,
        readyState: inspected.videoReadyState ?? null,
        transport: inspected.videoTransport ?? null,
        transportDiagnostic: inspected.videoTransportDiagnostic ?? null,
      },
      generation: { revision: watcher?.revision ?? null, installCount: inspected.generationInstallCount ?? null },
      timingsMs: JSON.parse(process.argv[4]),
    }));
  ' "$startup_verify_report" "$WATCHER_STARTUP_REPORT" "$foreground_confirmed" "$(printf '{\"signatureValidation\":%s,\"priorWatcherStop\":%s,\"hostStop\":%s,\"watcherStartup\":%s,\"hostLaunch\":%s,\"cdpReady\":%s,\"foregroundHandoff\":%s,\"startupVerify\":%s,\"total\":%s}' \
    "$(elapsed_ms "$validation_started_ms" "$validation_finished_ms")" \
    "$(elapsed_ms "$watcher_stop_started_ms" "$watcher_stop_finished_ms")" \
    "$(elapsed_ms "$host_stop_started_ms" "$host_stop_finished_ms")" \
    "$(elapsed_ms "$watcher_started_ms" "$watcher_ready_ms")" \
    "$(elapsed_ms "$host_launch_started_ms" "$host_main_ready_ms")" \
    "$(elapsed_ms "$host_launch_started_ms" "$cdp_ready_ms")" \
    "$(elapsed_ms "$foreground_started_ms" "$foreground_finished_ms")" \
    "$(elapsed_ms "$verify_started_ms" "$verify_finished_ms")" \
    "$(elapsed_ms "$total_started_ms" "$verify_finished_ms")")")"
  write_operation_report "$report_file" apply failed "$failure_code" false \
    "WorkBuddy did not reach its startup playback contract" "$details_json"
  die "WorkBuddy did not reach its startup playback contract."
fi
verify_finished_ms="$(now_ms)"

IFS=$'\t' read -r verify_status verify_code < <("$NODE_RUNTIME" -e '
  const fs = require("fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(`${value.status}\t${value.code}\n`);
' "$startup_verify_report")

final_status="$verify_status"
final_code="apply-active"
final_message="CC Theme is active in WorkBuddy"
if [ "$foreground_confirmed" != "true" ]; then
  final_status="partial"
  final_code="workbuddy-not-foreground"
  final_message="CC Theme is active, but WorkBuddy could not be confirmed in the foreground"
elif [ "$verify_status" = "partial" ]; then
  final_code="$verify_code"
  final_message="CC Theme is active with an explicit playback downgrade"
fi

timings_json="$(printf '{\"signatureValidation\":%s,\"priorWatcherStop\":%s,\"hostStop\":%s,\"watcherStartup\":%s,\"hostLaunch\":%s,\"cdpReady\":%s,\"foregroundHandoff\":%s,\"startupVerify\":%s,\"total\":%s}' \
  "$(elapsed_ms "$validation_started_ms" "$validation_finished_ms")" \
  "$(elapsed_ms "$watcher_stop_started_ms" "$watcher_stop_finished_ms")" \
  "$(elapsed_ms "$host_stop_started_ms" "$host_stop_finished_ms")" \
  "$(elapsed_ms "$watcher_started_ms" "$watcher_ready_ms")" \
  "$(elapsed_ms "$host_launch_started_ms" "$host_main_ready_ms")" \
  "$(elapsed_ms "$host_launch_started_ms" "$cdp_ready_ms")" \
  "$(elapsed_ms "$foreground_started_ms" "$foreground_finished_ms")" \
  "$(elapsed_ms "$verify_started_ms" "$verify_finished_ms")" \
  "$(elapsed_ms "$total_started_ms" "$verify_finished_ms")")"
details_json="$("$NODE_RUNTIME" -e '
  const fs = require("fs");
  const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const verify = read(process.argv[1]);
  const watcher = read(process.argv[2]);
  const result = verify.targets?.[0]?.result ?? {};
  const inspected = result.inspected ?? {};
  const timings = JSON.parse(process.argv[4]);
  const rendererTimings = inspected.generationTimingsMs ?? {};
  const installedSinceStartup = Number.isFinite(rendererTimings.installedBeforeInspect)
    ? Math.max(0, timings.total - rendererTimings.installedBeforeInspect) : null;
  const sinceStartup = (relative) => Number.isFinite(installedSinceStartup) && Number.isFinite(relative)
    ? Math.max(0, installedSinceStartup + relative) : null;
  process.stdout.write(JSON.stringify({
    foregroundHandoff: { requested: true, confirmed: process.argv[3] === "true" },
    playback: {
      outcome: result.startup?.outcome ?? "unknown",
      code: result.startup?.code ?? verify.code,
      videoEnabled: inspected.videoEnabled === true,
      videoReady: inspected.videoReady === true,
      playbackState: inspected.videoPlaybackState ?? null,
      reducedMotion: inspected.reducedMotion === true,
      userPaused: inspected.videoUserPaused === true,
      documentHidden: inspected.documentHidden === true,
      transport: inspected.videoTransport ?? null,
      transportDiagnostic: inspected.videoTransportDiagnostic ?? null,
    },
    generation: {
      revision: result.revision ?? watcher.revision ?? null,
      installCount: inspected.generationInstallCount ?? null,
      firstInstalledSinceStartupMs: installedSinceStartup,
      videoFirstFrameSinceStartupMs: sinceStartup(rendererTimings.firstFrame),
      videoPlayingSinceStartupMs: sinceStartup(rendererTimings.playing),
      rendererTimingsMs: rendererTimings,
      watcherTargetTimingsMs: watcher.details?.targetTimingsMs ?? null,
    },
    timingsMs: timings,
  }));
' "$startup_verify_report" "$WATCHER_STARTUP_REPORT" "$foreground_confirmed" "$timings_json")"

write_state active "$port" "$theme_dir"
write_operation_report "$report_file" apply "$final_status" "$final_code" true "$final_message" "$details_json"
startup_committed=1
/bin/rm -f "$startup_verify_report"
trap - EXIT
log "Skin is active for WorkBuddy $WORKBUDDY_VERSION (theme: $(state_value theme_dir))."
log "Use scripts/pause-skin-macos.sh to remove the live skin without changing WorkBuddy files."
