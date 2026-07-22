import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relative) => fs.readFile(path.join(root, relative), "utf8").then(JSON.parse);
const [versionText, packageManifest, projectManifest, capability, releaseManifest, packageContract, surfaceCatalog, semanticReport] = await Promise.all([
  fs.readFile(path.join(root, "VERSION"), "utf8"),
  readJson("package.json"),
  readJson("PROJECT_MANIFEST.json"),
  readJson("contracts/adapter-capability.json"),
  readJson("contracts/adapter-release-manifest.json"),
  readJson("contracts/cc-theme-package.json"),
  readJson("compatibility/chatgpt-macos/26.715.71837/ui-surface-catalog.json"),
  readJson("compatibility/chatgpt-macos/26.715.71837/semantic-role-visual-report.json"),
]);

const adapterVersion = versionText.trim();
const adapterReleaseRevision = releaseManifest.adapterReleaseRevision;
const assetIdentity = `mac-codex-${adapterVersion}-r${adapterReleaseRevision}-macos-arm64`;
const expectedArtifacts = {
  source: `${assetIdentity}.zip`,
  client: `cc-theme-${assetIdentity}.zip`,
};

assert.equal(adapterVersion, "26.715.71837");
assert.match(adapterVersion, /^\d+(?:\.\d+){2}$/);
assert(Number.isSafeInteger(adapterReleaseRevision) && adapterReleaseRevision > 0);
assert.equal(releaseManifest.revision, 1, "manifest schema revision is not the release revision");
assert.equal(releaseManifest.adapterId, "mac-codex");
assert.equal(releaseManifest.adapterVersion, adapterVersion);
assert.equal(releaseManifest.os, "macos");
assert.equal(releaseManifest.arch, "arm64");
assert.equal(releaseManifest.assetIdentity, assetIdentity);
assert.deepEqual(releaseManifest.artifacts, expectedArtifacts);

const expectedPackageIdentity = {
  adapterId: "mac-codex",
  adapterVersion,
  adapterReleaseRevision,
  os: "macos",
  arch: "arm64",
  assetIdentity,
};
assert.equal(packageManifest.version, adapterVersion);
assert.deepEqual(packageManifest.ccThemeAdapter, expectedPackageIdentity);
assert.equal(projectManifest.adapterId, "mac-codex");
assert.equal(projectManifest.adapterVersion, adapterVersion);
assert.equal(projectManifest.adapterReleaseRevision, adapterReleaseRevision);
assert.equal(projectManifest.productVersion, adapterVersion);
assert.equal(projectManifest.client.supportedShortVersion, adapterVersion);
assert.deepEqual(projectManifest.releaseTarget, {
  os: "macos",
  arch: "arm64",
  assetIdentity,
  sourceArtifact: expectedArtifacts.source,
  clientArtifact: expectedArtifacts.client,
});
assert.equal(capability.adapterId, "mac-codex");
assert.equal(capability.adapterVersion, adapterVersion);
assert.equal(capability.adapterReleaseRevision, adapterReleaseRevision);
assert.equal(capability.releaseTarget.assetIdentity, assetIdentity);
assert.equal(capability.compatibility.currentEvidence.clientVersion, adapterVersion);
assert.equal(capability.compatibility.currentEvidence.clientBuild, "5702");
assert.equal(capability.compatibility.currentEvidence.surfaceCatalogId, "chatgpt-macos-26.715.71837");
assert.equal(capability.compatibility.currentEvidence.verifiedAt, surfaceCatalog.client.capturedAt);
assert.equal(capability.compatibility.currentEvidence.verifiedAt, semanticReport.capturedAt);
assert.equal(packageContract.target.adapterId, "mac-codex");
assert.equal(packageContract.target.version, adapterVersion);

assert.equal(assetIdentity, `mac-codex-${adapterVersion}-r${adapterReleaseRevision}-macos-arm64`,
  "host build must not participate in the canonical asset identity");
assert.notEqual(assetIdentity, `mac-codex-${adapterVersion}+5702-r${adapterReleaseRevision}-macos-arm64`);

const [common, injector, sourceBuilder, clientBuilder] = await Promise.all([
  fs.readFile(path.join(root, "scripts/common-macos.sh"), "utf8"),
  fs.readFile(path.join(root, "scripts/injector.mjs"), "utf8"),
  fs.readFile(path.join(root, "scripts/build-release.sh"), "utf8"),
  fs.readFile(path.join(root, "scripts/build-client-release.sh"), "utf8"),
]);
assert(common.includes("$PROJECT_ROOT/VERSION"));
assert(injector.includes('path.join(root, "VERSION")'));
assert.equal(common.includes('SKIN_VERSION="0.1.0"'), false);
assert.equal(injector.includes('SKIN_VERSION = "0.1.0"'), false);
for (const builder of [sourceBuilder, clientBuilder]) {
  assert(builder.includes("adapter-release.mjs\" describe"));
  assert(builder.includes("Refusing to overwrite Adapter release revision"));
}

console.log("PASS: Adapter version, release revision, canonical identity, and host-build evidence are consistent.");
