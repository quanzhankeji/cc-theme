import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [manifest, catalog, hostEvidence, localeCatalog, detector] = await Promise.all([
  fs.readFile(path.join(root, "PROJECT_MANIFEST.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "compatibility/claude-macos/1.22209.3/ui-surface-catalog.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "compatibility/claude-macos/1.22209.3/host-evidence.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "contracts/claude-locale-catalog.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "scripts/detect-claude-macos.sh"), "utf8"),
]);

for (const key of [
  "bundleId", "signingTeamId", "electronVersion", "chromiumVersion", "remoteUiBuildId",
  "remoteUiGitHash", "remoteUiBuildTimestamp", "appAsarSha256", "appAsarIntegrity",
]) {
  assert.equal(manifest.client[key], catalog.target[key], `client evidence differs for ${key}`);
}
assert.equal(manifest.client.verifiedVersion, catalog.target.version);
assert.equal(manifest.client.verifiedBuild, catalog.target.build);
assert.equal(manifest.adapterVersion, hostEvidence.adapterVersion);
assert.equal(manifest.adapterReleaseRevision, hostEvidence.adapterReleaseRevision);
assert.deepEqual(manifest.releaseIdentity, {
  adapterId: hostEvidence.adapterId,
  adapterVersion: hostEvidence.adapterVersion,
  adapterReleaseRevision: hostEvidence.adapterReleaseRevision,
  ...hostEvidence.releaseTarget,
  releaseStatus: "development-unpublished",
  developmentOverwriteAllowed: true,
  immutableAfterFirstPublication: true,
});
assert.equal(hostEvidence.host.shortVersion, manifest.adapterVersion);
assert.equal(hostEvidence.host.build, manifest.client.verifiedBuild);
assert.equal(hostEvidence.host.appAsarSha256, manifest.client.appAsarSha256);
assert.equal(hostEvidence.host.appAsarIntegrity.hash, manifest.client.appAsarIntegrity);
assert.equal(hostEvidence.signature.teamId, manifest.client.signingTeamId);
assert.equal(hostEvidence.runtime.electronVersion, manifest.client.electronVersion);
assert.equal(hostEvidence.runtime.chromiumVersion, manifest.client.chromiumVersion);
assert.equal(hostEvidence.remoteRendererEvidence.status, "not-reverified-for-1.22209.3");
assert.equal(hostEvidence.admission.surfaceAdmission, "fail-closed-pending-live-landmarks");
assert.equal(hostEvidence.admission.runtimeApplyAvailable, false);
assert.equal(hostEvidence.admission.managerApplyAllowed, false);
assert.equal(hostEvidence.processIdentity.capturedCommandLines, false);
assert.equal(hostEvidence.processIdentity.capturedUserPaths, false);
assert.deepEqual(catalog.localeEvidence.locales, localeCatalog.locales);
assert.equal(catalog.localeEvidence.authority, localeCatalog.authority.global);
assert.equal(catalog.localeEvidence.signedResourceKeyCountPerLocale,
  localeCatalog.evidence.resourceKeyCountPerLocale);
assert.match(detector, /-extract CFBundleVersion raw/);
assert.match(detector, /Print :ElectronAsarIntegrity:Resources\/app\.asar:hash/);
assert.match(detector, /CandidateCDHashFull sha256/);
assert.match(detector, /fail-closed-pending-live-landmarks/);
assert.equal(detector.includes("CFBundleShortVersionString raw -o - \"$FRAMEWORK_INFO\""), false);
console.log("client-evidence-contract.test.mjs: ok");
