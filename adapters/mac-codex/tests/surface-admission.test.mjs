import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSurfaceAdmissionFacts } from "../scripts/surface-admission.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(await fs.readFile(path.join(root, "compatibility", "chatgpt-macos", "26.715.31925", "ui-surface-catalog.json"), "utf8"));
const visualReport = JSON.parse(await fs.readFile(path.join(root, "compatibility", "chatgpt-macos", "26.715.31925", "semantic-role-visual-report.json"), "utf8"));
assert(catalog.styleEvidence.consumers["colors.text"].includes("--skin-text"));
assert(catalog.styleEvidence.consumers["colors.muted"].includes("--skin-muted"));
assert.match(catalog.styleEvidence.unsupportedConsumers["fonts.code"], /no verified/);
assert.equal(catalog.surfaceTargets.find((target) => target.targetId === "target.sidebar")?.primarySelector,
  ".app-shell-left-panel");
assert.equal(visualReport.catalogId, catalog.catalogId);
assert.equal(visualReport.client.asarSha256, catalog.bundleEvidence.asarSha256);
assert.equal(visualReport.applyAdmission.surfaceEvidenceIsGate, true);
assert.equal(visualReport.homeAcceptance.forbiddenAssumption, "exactly-four-demo-cards");
assert.equal(visualReport.homeAcceptance.pass, true);
assert.equal(visualReport.lifecycle.restoreThenSwitch.pass, true);
assert.equal(visualReport.result.pass, true);
assert(visualReport.privacy.excluded.includes("accessible names"));
const facts = {
  bundleId: "com.openai.codex",
  version: "26.715.31925",
  build: "5551",
  chromium: "150.0.7871.124",
  teamId: "2DC432GLL2",
  asarSha256: "0c9dd677134340cb944e7642b8bc2504c7b73c7dc334d9d756547858171eea41",
  markerCounts: structuredClone(catalog.bundleEvidence.stableSelectorCounts),
};

const allowed = evaluateSurfaceAdmissionFacts(facts, catalog);
assert.equal(allowed.allowed, true);
assert.equal(allowed.code, "ok");
assert.equal(allowed.clientVersionPolicy, "always-latest");
assert.equal(allowed.evidencePolicy, "current-host-evidence-required");
assert.deepEqual(allowed.diagnostics, []);

const newerCompatibleFacts = structuredClone(facts);
newerCompatibleFacts.version = "26.715.52143";
newerCompatibleFacts.build = "6000";
newerCompatibleFacts.chromium = "151.0.8000.1";
newerCompatibleFacts.asarSha256 = "1".repeat(64);
const compatibilityAttempt = evaluateSurfaceAdmissionFacts(newerCompatibleFacts, catalog, {
  compatibilityAttempt: true,
});
assert.equal(compatibilityAttempt.allowed, true);
assert.equal(compatibilityAttempt.compatibilityAttempt, true);
assert.equal(compatibilityAttempt.evidencePolicy, "older-adapter-structural-probe-required");
assert(compatibilityAttempt.diagnostics.some((item) =>
  item.code === "older-adapter-compatibility-attempt" && item.severity === "warning"));

const incompatibleStructure = structuredClone(newerCompatibleFacts);
incompatibleStructure.markerCounts["data-settings-panel-slug"] = 0;
const blockedCompatibilityAttempt = evaluateSurfaceAdmissionFacts(incompatibleStructure, catalog, {
  compatibilityAttempt: true,
});
assert.equal(blockedCompatibilityAttempt.allowed, false);
assert(blockedCompatibilityAttempt.diagnostics.some((item) => item.code === "surface-evidence-landmark-missing"));

const olderHostAttempt = structuredClone(facts);
olderHostAttempt.version = "26.715.10000";
assert.equal(evaluateSurfaceAdmissionFacts(olderHostAttempt, catalog, {
  compatibilityAttempt: true,
}).allowed, false, "a newer Adapter must never be tried on an older host");

for (const [mutate, code] of [
  [(value) => { value.version = "26.715.99999"; }, "surface-evidence-client-version-mismatch"],
  [(value) => { value.build = "9999"; }, "surface-evidence-client-build-mismatch"],
  [(value) => { value.asarSha256 = "0".repeat(64); }, "surface-evidence-asar-mismatch"],
  [(value) => { value.markerCounts["data-settings-panel-slug"] = 0; }, "surface-evidence-landmark-missing"],
  [(value) => { value.teamId = "WRONG"; }, "surface-evidence-signature-mismatch"],
]) {
  const changed = structuredClone(facts);
  mutate(changed);
  const result = evaluateSurfaceAdmissionFacts(changed, catalog);
  assert.equal(result.allowed, false);
  assert(result.diagnostics.some((item) => item.code === code), `expected ${code}`);
}

const unverified = structuredClone(catalog);
unverified.admission.status = "experimental";
const denied = evaluateSurfaceAdmissionFacts(facts, unverified);
assert.equal(denied.allowed, false);
assert(denied.diagnostics.some((item) => item.code === "surface-evidence-unverified"));

const [common, start, applying, doctor] = await Promise.all([
  "scripts/common-macos.sh", "scripts/start-skin-macos.sh", "scripts/apply-cc-theme-macos.sh", "scripts/doctor-macos.sh",
].map((file) => fs.readFile(path.join(root, file), "utf8")));
assert(common.includes("require_surface_admission"));
assert(start.indexOf("require_surface_admission") < start.indexOf("launch_codex_with_cdp"));
assert(applying.includes("require_surface_admission"));
assert(doctor.includes("--require-surface-admission"));

console.log("surface-admission.test.mjs: ok");
