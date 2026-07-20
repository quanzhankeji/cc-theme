import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [common, start, injector, releaseManifest] = await Promise.all([
  fs.readFile(path.join(root, "scripts/common-macos.sh"), "utf8"),
  fs.readFile(path.join(root, "scripts/start-skin-macos.sh"), "utf8"),
  fs.readFile(path.join(root, "scripts/injector.mjs"), "utf8"),
  fs.readFile(path.join(root, "contracts/adapter-release-manifest.json"), "utf8").then(JSON.parse),
]);
const switchTheme = await fs.readFile(path.join(root, "scripts/switch-theme-macos.sh"), "utf8");

const launch = common.slice(common.indexOf("launch_codex_with_cdp()"), common.indexOf("launch_codex_normally()"));
assert.equal((launch.match(/\/usr\/bin\/open -gna/g) ?? []).length, 1,
  "cold launch must make one background LaunchServices request");
assert.ok(launch.indexOf("wait-new") > launch.indexOf("/usr/bin/open -gna"));
assert.ok(launch.indexOf("wait-new") < launch.indexOf("/usr/bin/nohup"),
  "the executable fallback must wait for the LaunchServices request to become visible");
assert.match(launch, /CODEX_LAUNCH_PID=/);
assert.match(launch, /CODEX_LAUNCH_STARTED_AT=/);

assert.equal(start.includes("/usr/bin/open -na"), false, "start must not issue a second launch request");
assert.match(switchTheme, /if codex_is_running && hot_reapply_theme "\$PORT" 8000/,
  "a stopped host must skip the expensive live hot-path verification and proceed directly to one cold launch");
const coldBranch = start.slice(start.indexOf('if [ "$DEBUG_READY" = "false" ]'));
assert.ok(coldBranch.indexOf("stop_recorded_injector") >= 0 &&
  coldBranch.indexOf("stop_recorded_injector") < coldBranch.indexOf('launch_codex_with_cdp "$PORT"'),
"a stale watcher must stop before a replacement Codex process can reuse its CDP port");
assert.ok(start.indexOf("activate_trusted_codex") > start.indexOf("wait_for_injector_ready") &&
  start.indexOf("activate_trusted_codex") < start.indexOf("write_state"),
"the host window must remain behind Manager feedback until readiness and foreground before state commit");
assert.equal(start.includes("/bin/sleep 0.8"), false);
assert.equal(start.includes("continuing with soft verification"), false);
assert.match(start, /wait_for_cdp "\$PORT" "\$CODEX_LAUNCH_PID" "\$CODEX_LAUNCH_STARTED_AT"/);
assert.match(start, /wait_for_injector_ready/);
assert.match(start, /COLD_RENDERER_READY_TIMEOUT_MS="45000"/,
  "cold renderer startup must allow the verified host to finish its first document load");
assert.match(start, /wait_for_injector_ready "\$PORT" "\$INJECTOR_PID" "\$RUNTIME_GENERATION" "\$COLD_RENDERER_READY_TIMEOUT_MS"/,
  "cold readiness must use the explicit bounded cold-start budget");
assert.equal(start.includes('"$INJECTOR" --once'), false,
  "watcher readiness must not race a one-shot injector");

const hot = common.slice(common.indexOf("hot_reapply_theme()"), common.indexOf("release_codex_launchd_job()"));
for (const fixedDelay of ["/bin/sleep 0.15", "/bin/sleep 0.25", "/bin/sleep 0.6"]) {
  assert.equal(hot.includes(fixedDelay), false, `hot reapply retains fixed delay ${fixedDelay}`);
}
assert.equal(hot.includes('"$INJECTOR" --once'), false);
assert.match(hot, /wait_for_injector_ready/);
assert.match(common, /lifecycle-process-guard\.mjs/);
assert.match(common, /verify-listener/);
assert.match(common, /emit_lifecycle_stage/);
assert.match(common, /activate_trusted_codex\(\)[\s\S]*trusted_cdp_process[\s\S]*tell application id "com\.openai\.codex" to activate/,
  "foreground handoff must re-check the trusted CDP process and activate the existing official app");
assert.match(common, /stop_recorded_injector\(\)[\s\S]*remove_injector_launch_agent/,
  "recorded watcher cleanup must wait for launchd to release the old service label");
assert.match(common, /launch_injector_daemon\(\)[\s\S]*write_injector_launch_agent[\s\S]*launchctl bootstrap/,
  "watcher launch must retry a persistent owned LaunchAgent after bounded bootout");
assert.match(common, /write_injector_launch_agent\(\)[\s\S]*RunAtLoad[\s\S]*KeepAlive/,
  "the owned watcher must outlive the Manager command and reconnect across host documents");
const readiness = common.slice(common.indexOf("wait_for_injector_ready()"), common.indexOf("# Resolve Node quickly"));
assert.match(readiness, /verifier_pid/,
  "renderer readiness must run under a shell-owned bounded verifier process");
assert.match(readiness, /readiness_deadline/);
assert.match(readiness, /kill -TERM "\$verifier_pid"/);
assert.match(readiness, /wait "\$verifier_pid"/);
assert.match(injector, /flushCliStreamsAndExit/,
  "one-shot CDP commands must not remain alive on a stalled WebSocket close handshake");
assert(releaseManifest.entries.includes("scripts/document-generation.mjs"));
assert(releaseManifest.entries.includes("scripts/lifecycle-process-guard.mjs"));

console.log("PASS: lifecycle wiring uses one bounded launch, process-tree CDP ownership, and generation readiness without fixed delays.");
