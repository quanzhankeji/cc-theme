import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relative) => fs.readFile(path.join(root, relative), "utf8").then(JSON.parse);
const [manifest, packageJson, capability, releaseManifest, styleCatalog, localeCatalog, catalog, evidence] = await Promise.all([
  readJson("PROJECT_MANIFEST.json"),
  readJson("package.json"),
  readJson("contracts/adapter-capability.json"),
  readJson("contracts/adapter-release-manifest.json"),
  readJson("contracts/theme-style-catalog.json"),
  readJson("contracts/claude-locale-catalog.json"),
  readJson("compatibility/claude-macos/1.22209.3/ui-surface-catalog.json"),
  readJson("compatibility/claude-macos/1.22209.3/host-evidence.json"),
]);
const version = (await fs.readFile(path.join(root, "VERSION"), "utf8")).trim();

assert.equal(manifest.adapterId, "mac-claude");
assert.equal(version, "1.22209.3");
assert.equal(packageJson.version, version);
assert.equal(manifest.productVersion, version);
assert.equal(manifest.adapterVersion, version);
assert.equal(manifest.client.verifiedVersion, version);
assert.equal(capability.adapterVersion, version);
assert.equal(capability.compatibility.verifiedVersion, version);
assert.equal(releaseManifest.adapterVersion, version);
assert.equal(styleCatalog.adapterVersion, version);
assert.equal(localeCatalog.adapterVersion, version);
assert.equal(catalog.adapterVersion, version);
assert.equal(catalog.target.version, version);
assert.equal(evidence.adapterVersion, version);
assert.equal(evidence.host.shortVersion, version);

const revision = manifest.adapterReleaseRevision;
assert(Number.isInteger(revision) && revision > 0);
for (const value of [
  capability.adapterReleaseRevision,
  releaseManifest.adapterReleaseRevision,
  styleCatalog.adapterReleaseRevision,
  localeCatalog.adapterReleaseRevision,
  catalog.adapterReleaseRevision,
  evidence.adapterReleaseRevision,
]) assert.equal(value, revision);

assert.deepEqual(manifest.releaseIdentity, {
  adapterId: "mac-claude",
  adapterVersion: version,
  adapterReleaseRevision: revision,
  os: "macos",
  arch: "arm64",
  releaseStatus: "development-unpublished",
  developmentOverwriteAllowed: true,
  immutableAfterFirstPublication: true,
});
assert.equal(capability.releaseStatus, "development-unpublished");
assert.equal(releaseManifest.releaseStatus, "development-unpublished");
assert.equal(evidence.releaseStatus, "development-unpublished");
assert.equal(manifest.projectStatus, "preserved-source");
assert.equal(manifest.managerRegistration.status, "paused");
assert.equal(manifest.managerRegistration.engineDeliveryAllowed, false);
assert.equal(manifest.managerRegistration.prepareReadyAllowed, false);
assert.equal(capability.projectStatus, "preserved-source");
assert.equal(capability.availability.managerRegistrationStatus, "paused");
assert.equal(capability.availability.managerEngineDeliveryAllowed, false);
assert.equal(capability.availability.managerPrepareReadyAllowed, false);
assert.equal(releaseManifest.managerDistributionAllowed, false);
assert.equal(evidence.projectStatus, "preserved-source");
assert.equal(evidence.managerRegistrationStatus, "paused");
assert.equal(manifest.client.verifiedBuild, evidence.host.build);
assert.equal(capability.compatibility.verifiedBuild, evidence.host.build);
assert.equal(catalog.target.build, evidence.host.build);
assert.equal(capability.availability.runtimeApplyAvailable, false);
assert.equal(capability.availability.managerApplyAllowed, false);

const assetStem = `mac-claude-v${version}-r${revision}-macos-arm64`;
const [runtimeBuilder, clientBuilder, readme] = await Promise.all([
  fs.readFile(path.join(root, "scripts/build-release.sh"), "utf8"),
  fs.readFile(path.join(root, "scripts/build-client-release.sh"), "utf8"),
  fs.readFile(path.join(root, "README.md"), "utf8"),
]);
assert(runtimeBuilder.includes("${ADAPTER_ID}-v${VERSION}-r${RELEASE_REVISION}-${RELEASE_OS}-${RELEASE_ARCH}"));
assert(clientBuilder.includes("${ADAPTER_ID}-v${VERSION}-r${RELEASE_REVISION}-${RELEASE_OS}-${RELEASE_ARCH}"));
assert.match(runtimeBuilder, /RELEASE_STATUS.*development-unpublished/s);
assert.match(clientBuilder, /RELEASE_STATUS.*development-unpublished/s);
assert.match(runtimeBuilder, /Manager registration is paused; Engine release delivery is disabled/);
assert.match(clientBuilder, /Manager registration is paused; client Engine delivery is disabled/);
assert.match(runtimeBuilder, /Refusing to overwrite a published Adapter revision asset/);
assert.match(clientBuilder, /Refusing to overwrite a published revision or a non-canonical output/);
assert.match(runtimeBuilder, /mv -f.*ARCHIVE_STAGE.*ARCHIVE/s);
assert.match(clientBuilder, /mv -f.*OUTPUT_STAGE.*OUTPUT/s);
assert(readme.includes(`\`${assetStem}.zip\``));
assert(readme.includes(`\`cc-theme-${assetStem}.zip\``));

const appInfo = "/Applications/Claude.app/Contents/Info.plist";
try {
  await fs.access(appInfo);
  const shortVersion = (await execFile("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", appInfo])).stdout.trim();
  const build = (await execFile("/usr/bin/plutil", ["-extract", "CFBundleVersion", "raw", "-o", "-", appInfo])).stdout.trim();
  assert.equal(version, shortVersion, "adapterVersion must equal the installed host ShortVersion");
  assert.equal(evidence.host.build, build, "exact build must remain compatibility evidence");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log("adapter-version-contract.test.mjs: ok");
