import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [start, common, injector, renderer] = await Promise.all([
  fs.readFile(path.join(root, "scripts", "start-skin-macos.sh"), "utf8"),
  fs.readFile(path.join(root, "scripts", "common-macos.sh"), "utf8"),
  fs.readFile(path.join(root, "scripts", "injector.mjs"), "utf8"),
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
]);

assert.doesNotMatch(start, /injector\.mjs" --once/,
  "cold start must not inject a static one-shot generation before the video Watcher");
const watcherIndex = start.indexOf("start_injector");
const launchIndex = start.indexOf("launch_workbuddy_debug");
assert(watcherIndex >= 0 && launchIndex > watcherIndex,
  "a cold startup must start one media-owning Watcher before it launches WorkBuddy");
assert.match(start, /trusted_injector_running/,
  "a trusted long-lived Watcher must be eligible for reuse on a later Manager operation");
assert.match(start, /if \[ "\$reuse_injector" -eq 0 \]; then[\s\S]*start_injector/,
  "only an absent or untrusted Watcher may be stopped and replaced");
assert.match(common, /Print :ProgramArguments:\$1/,
  "Watcher reuse must validate every fixed launchd argument by index instead of trusting only a PID or label");
assert.match(common, /\[ -z "\$\(launch_agent_argument "\$index"\)" \]/,
  "Watcher reuse must reject a launchd job with unexpected trailing arguments");
assert.match(start, /activate_workbuddy/);
assert.match(start, /--verify --startup/);
assert.match(common, /--report-file[^\n]*WATCHER_STARTUP_REPORT|WATCHER_STARTUP_REPORT[^\n]*--report-file/s,
  "launchd Watcher needs a bounded readiness handshake instead of a fixed sleep");
assert.doesNotMatch(common, /\/bin\/sleep 0\.6/);
assert.doesNotMatch(common, /kickstart -k/,
  "bootstrap must not kill its new RunAtLoad process and incur launchd's ten-second throttle");
assert.match(injector, /export function assessVideoStartup/);
assert.match(renderer, /backgroundVideo\.src\s*=\s*trustedVideoUrl/,
  "the trusted loopback Range URL must be attached directly to the video element");
assert.match(renderer, /const startTrustedBlobFallback = async \(\) =>/,
  "WorkBuddy may use the bounded trusted Blob fallback without creating a second generation");
assert.match(renderer, /videoTransportDiagnostic = "direct-media-source-unsupported"/,
  "a direct media rejection must remain an explicit startup diagnostic");
assert.match(renderer, /fetch\(trustedVideoResource\.url/,
  "the fallback may fetch only the validated loopback media resource");

console.log("PASS: cold startup uses one media-owning generation, strict playback readiness, foreground handoff, and bounded trusted media fallback.");
