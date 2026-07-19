import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFile(path.join(root, relative), "utf8");
const project = JSON.parse(await read("PROJECT_MANIFEST.json"));

assert.equal(project.client.versionPolicy, "always-latest");
assert.equal(project.securityBoundary.blocksByClientVersion, false);
assert.equal(project.securityBoundary.verifiesOfficialAppSignature, true);
assert.equal(project.securityBoundary.requiresCurrentSurfaceEvidence, true);

const activeRuntimeFiles = [
  "scripts/common-macos.sh",
  "scripts/install-skin-macos.sh",
  "scripts/start-skin-macos.sh",
  "scripts/doctor-macos.sh",
  "scripts/apply-cc-theme-macos.sh",
  "scripts/import-cc-theme.mjs",
  "scripts/injector.mjs",
  "scripts/theme-lifecycle.mjs",
];
const runtimeSource = (await Promise.all(activeRuntimeFiles.map(read))).join("\n");

for (const retiredGate of [
  "compatibility-matrix",
  "require_verified_codex_compatibility",
  "assertInjectorCompatibility",
  "--client-version",
  "repair-cc-theme-compatibility",
]) {
  assert.equal(runtimeSource.includes(retiredGate), false, `active runtime still contains retired gate: ${retiredGate}`);
}

assert.match(await read("scripts/common-macos.sh"), /codesign --verify --deep --strict/);
assert.match(await read("scripts/common-macos.sh"), /require_surface_admission/);
assert.match(await read("scripts/start-skin-macos.sh"), /wait_for_injector_ready/);
assert.match(await read("scripts/start-skin-macos.sh"), /require_surface_admission/);
assert.match(await read("scripts/apply-cc-theme-macos.sh"), /require_surface_admission/);
const commonRuntime = await read("scripts/common-macos.sh");
const hotReapply = commonRuntime.slice(
  commonRuntime.indexOf("hot_reapply_theme()"),
  commonRuntime.indexOf("release_codex_launchd_job()"),
);
assert.match(hotReapply, /wait_for_injector_ready/,
  "Hot theme switching must complete the watcher generation handshake before reporting success.");
assert.equal(hotReapply.includes('"$INJECTOR" --once'), false,
  "Hot theme switching must not race the persistent watcher with a one-shot injector.");
assert.match(hotReapply, /kill -0 "\$inj_pid"/,
  "Hot theme switching must prove the persistent watcher remains alive.");
assert.ok(hotReapply.indexOf("wait_for_injector_ready") < hotReapply.indexOf("write_state"),
  "Hot theme switching must not commit active state before live verification.");

for (const removed of [
  "contracts/compatibility-matrix.json",
  "scripts/codex-version-fingerprint.mjs",
  "scripts/compatibility-policy.mjs",
  "scripts/compatibility-self-check.mjs",
  "scripts/prepare-compatibility-repair.mjs",
  "scripts/repair-compatibility-macos.sh",
  "scripts/compatibility-rollback-macos.sh",
  "skills/repair-cc-theme-compatibility/SKILL.md",
]) {
  await assert.rejects(
    fs.access(path.join(root, removed)),
    (error) => error?.code === "ENOENT",
    `${removed} should not be shipped`,
  );
}

console.log("PASS: Mac Codex follows the newest installed client while fail-closing apply when current Surface evidence is absent.");
