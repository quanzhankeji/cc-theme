import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSurfaceAdmissionFacts } from "../scripts/surface-admission.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(await fs.readFile(path.join(root, "compatibility", "chatgpt-macos", "26.715.71837", "ui-surface-catalog.json"), "utf8"));
const visualReport = JSON.parse(await fs.readFile(path.join(root, "compatibility", "chatgpt-macos", "26.715.71837", "semantic-role-visual-report.json"), "utf8"));
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
assert.equal(visualReport.result.adapterReleaseQualificationPass, true);
assert.equal(visualReport.result.managerEndToEndDeferred, true);
assert(visualReport.privacy.excluded.includes("accessible names"));
assert.equal(catalog.admission.status, "verified");
assert.equal(catalog.processEvidence.status, "verified");
assert.equal(catalog.liveEvidence.captureResult, "passed");
assert.deepEqual(catalog.liveEvidence.pendingRouteCoverage, []);
const verifiedCatalog = structuredClone(catalog);
const facts = {
  bundleId: "com.openai.codex",
  version: "26.715.71837",
  build: "5702",
  chromium: "150.0.7871.124",
  teamId: "2DC432GLL2",
  asarSha256: "11292b6a04d8aef36c30940b94ce3a744844dc5a52797228fbebb87f8529f102",
  markerCounts: structuredClone(verifiedCatalog.bundleEvidence.stableSelectorCounts),
};

const allowed = evaluateSurfaceAdmissionFacts(facts, verifiedCatalog);
assert.equal(allowed.allowed, true);
assert.equal(allowed.code, "ok");
assert.equal(allowed.clientVersionPolicy, "always-latest");
assert.equal(allowed.evidencePolicy, "current-host-evidence-required");
assert.deepEqual(allowed.diagnostics, []);

const newerCompatibleFacts = structuredClone(facts);
newerCompatibleFacts.version = "26.715.80000";
newerCompatibleFacts.build = "6000";
newerCompatibleFacts.chromium = "151.0.8000.1";
newerCompatibleFacts.asarSha256 = "1".repeat(64);
const compatibilityAttempt = evaluateSurfaceAdmissionFacts(newerCompatibleFacts, verifiedCatalog, {
  compatibilityAttempt: true,
});
assert.equal(compatibilityAttempt.allowed, false);
assert.equal(compatibilityAttempt.compatibilityAttempt, true);
assert.equal(compatibilityAttempt.evidencePolicy, "current-host-evidence-required");
assert(compatibilityAttempt.diagnostics.some((item) =>
  item.code === "surface-evidence-client-version-mismatch" && item.severity === "error"));

const oldHostFacts = structuredClone(facts);
oldHostFacts.version = "26.715.61943";
oldHostFacts.build = "5628";
oldHostFacts.asarSha256 = "7501dd25c22e090bb131fe3fe6423e5c3b21b7f275c7e45b86ebe00a68052c80";
const oldHost = evaluateSurfaceAdmissionFacts(oldHostFacts, verifiedCatalog);
assert.equal(oldHost.allowed, false, "26.715.71837-r2 must reject the stale 26.715.61943 host context");
assert(oldHost.diagnostics.some((item) => item.code === "surface-evidence-client-version-mismatch"));

const previousHostFacts = structuredClone(facts);
previousHostFacts.version = "26.715.70719";
previousHostFacts.build = "5650";
previousHostFacts.asarSha256 = "954760af20a1b74275a9db50c99a09266da4f5d1e08f4b613c8a46f97adc9ce4";
const previousHost = evaluateSurfaceAdmissionFacts(previousHostFacts, verifiedCatalog);
assert.equal(previousHost.allowed, false, "the unverified 26.715.70719 candidate must not reuse current Surface evidence");
assert(previousHost.diagnostics.some((item) => item.code === "surface-evidence-client-version-mismatch"));

const incompatibleStructure = structuredClone(newerCompatibleFacts);
incompatibleStructure.markerCounts["data-settings-panel-slug"] = 0;
const blockedCompatibilityAttempt = evaluateSurfaceAdmissionFacts(incompatibleStructure, verifiedCatalog, {
  compatibilityAttempt: true,
});
assert.equal(blockedCompatibilityAttempt.allowed, false);
assert(blockedCompatibilityAttempt.diagnostics.some((item) => item.code === "surface-evidence-landmark-missing"));

const olderHostAttempt = structuredClone(facts);
olderHostAttempt.version = "26.715.10000";
assert.equal(evaluateSurfaceAdmissionFacts(olderHostAttempt, verifiedCatalog, {
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
  const result = evaluateSurfaceAdmissionFacts(changed, verifiedCatalog);
  assert.equal(result.allowed, false);
  assert(result.diagnostics.some((item) => item.code === code), `expected ${code}`);
}

const unverified = structuredClone(verifiedCatalog);
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
