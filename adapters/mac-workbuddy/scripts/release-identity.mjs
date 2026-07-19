import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readJson = async (relative) => JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
const requireEqual = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label} must be ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}`);
};

export async function loadReleaseIdentity() {
  const [versionFile, project, packageDocument, capability, uiCatalog, styleCatalog, localeCatalog,
    packageContract, releaseManifest] = await Promise.all([
    fs.readFile(path.join(root, "VERSION"), "utf8").then((value) => value.trim()),
    readJson("PROJECT_MANIFEST.json"),
    readJson("package.json"),
    readJson("contracts/adapter-capability.json"),
    readJson("compatibility/workbuddy-macos/5.2.6/ui-surface-catalog.json"),
    readJson("contracts/theme-style-catalog.json"),
    readJson("contracts/theme-settings-locales.json"),
    readJson("contracts/cc-theme-package.json"),
    readJson("contracts/adapter-release-manifest.json"),
  ]);

  requireEqual(project.kind, "cc-theme.adapter-project-manifest", "PROJECT_MANIFEST kind");
  requireEqual(project.schemaVersion, 1, "PROJECT_MANIFEST schemaVersion");
  const identity = {
    adapterId: project.adapterId,
    adapterVersion: project.adapterVersion,
    adapterReleaseRevision: project.adapterReleaseRevision,
    platform: project.platform,
    architecture: project.architecture,
    assetIdentity: project.release?.assetIdentity,
    sourceArchive: project.release?.sourceArchive,
    clientArchive: project.release?.clientArchive,
  };
  requireEqual(identity.adapterId, "mac-workbuddy", "adapterId");
  requireEqual(identity.adapterVersion, "5.2.6", "adapterVersion");
  if (!Number.isSafeInteger(identity.adapterReleaseRevision) || identity.adapterReleaseRevision < 1) {
    throw new Error("adapterReleaseRevision must be a positive safe integer");
  }
  requireEqual(identity.platform, "macos", "platform");
  requireEqual(identity.architecture, "arm64", "architecture");
  requireEqual(project.host?.application, "WorkBuddy", "host application");
  requireEqual(project.host?.bundleIdentifier, "com.workbuddy.workbuddy", "host bundle identifier");
  requireEqual(project.host?.cfBundleShortVersionString, identity.adapterVersion,
    "adapterVersion/CFBundleShortVersionString");
  requireEqual(project.release?.publicationStatus, "unpublished-development", "release publication status");
  requireEqual(project.release?.overwritePolicy, "replace-unpublished-development-revision", "release overwrite policy");

  const expectedAssetIdentity = `${identity.adapterId}-${identity.adapterVersion}-r${identity.adapterReleaseRevision}-${identity.platform}-${identity.architecture}`;
  requireEqual(identity.assetIdentity, expectedAssetIdentity, "release asset identity");
  requireEqual(identity.sourceArchive, `${expectedAssetIdentity}.zip`, "source archive name");
  requireEqual(identity.clientArchive, `cc-theme-${expectedAssetIdentity}.zip`, "client archive name");
  for (const name of [identity.sourceArchive, identity.clientArchive]) {
    if (!/^[a-z0-9][A-Za-z0-9._-]{1,159}\.zip$/.test(name) || name.includes("..") || name.includes("/")) {
      throw new Error(`unsafe release archive name: ${name}`);
    }
  }

  requireEqual(versionFile, identity.adapterVersion, "VERSION");
  requireEqual(packageDocument.version, identity.adapterVersion, "package version");
  for (const [label, value] of [
    ["package ccThemeAdapter", packageDocument.ccThemeAdapter],
    ["adapter capability", capability],
    ["release manifest", releaseManifest],
  ]) {
    requireEqual(value?.adapterId, identity.adapterId, `${label} adapterId`);
    requireEqual(value?.adapterVersion, identity.adapterVersion, `${label} adapterVersion`);
    requireEqual(value?.adapterReleaseRevision, identity.adapterReleaseRevision, `${label} adapterReleaseRevision`);
    requireEqual(value?.platform, identity.platform, `${label} platform`);
    requireEqual(value?.architecture, identity.architecture, `${label} architecture`);
  }
  requireEqual(releaseManifest.assetIdentity, identity.assetIdentity, "release manifest assetIdentity");
  requireEqual(uiCatalog.adapter, identity.adapterId, "UI Surface Catalog adapterId");
  requireEqual(uiCatalog.adapterVersion, identity.adapterVersion, "UI Surface Catalog adapterVersion");
  requireEqual(uiCatalog.adapterReleaseRevision, identity.adapterReleaseRevision,
    "UI Surface Catalog adapterReleaseRevision");
  requireEqual(uiCatalog.target?.version, identity.adapterVersion,
    "UI Surface Catalog host ShortVersion");
  requireEqual(styleCatalog.adapterId, identity.adapterId, "Theme Style Catalog adapterId");
  requireEqual(styleCatalog.adapterVersion, identity.adapterVersion, "Theme Style Catalog adapterVersion");
  requireEqual(styleCatalog.adapterReleaseRevision, identity.adapterReleaseRevision,
    "Theme Style Catalog adapterReleaseRevision");
  requireEqual(localeCatalog.adapter, identity.adapterId, "locale Catalog adapterId");
  requireEqual(localeCatalog.adapterVersion, identity.adapterVersion, "locale Catalog adapterVersion");
  requireEqual(localeCatalog.adapterReleaseRevision, identity.adapterReleaseRevision,
    "locale Catalog adapterReleaseRevision");
  requireEqual(packageContract.target?.adapterId, identity.adapterId, "package contract adapterId");
  requireEqual(packageContract.target?.adapterVersion, identity.adapterVersion, "package contract adapterVersion");
  requireEqual(packageContract.target?.adapterReleaseRevision, identity.adapterReleaseRevision,
    "package contract adapterReleaseRevision");
  requireEqual(packageContract.target?.version, identity.adapterVersion, "package contract host ShortVersion");
  if (!capability.compatibility?.verifiedClientVersions?.includes(identity.adapterVersion) ||
      capability.compatibility?.policy !== "verified-only" || capability.compatibility?.runtimeProbeRequired !== true) {
    throw new Error("release identity must remain admitted by the verified-only Capability gate");
  }
  return Object.freeze(identity);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const identity = await loadReleaseIdentity();
  if (process.argv[2] === "--field") {
    const field = process.argv[3];
    if (!Object.hasOwn(identity, field)) throw new Error(`unknown release identity field: ${field}`);
    process.stdout.write(`${identity[field]}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
  }
}
