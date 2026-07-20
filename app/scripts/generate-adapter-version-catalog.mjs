#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyAdapterPackage } from "./adapter-package.mjs";

const ADAPTER_IDS = Object.freeze(["mac-codex", "mac-workbuddy"]);
const SIDECAR_SUFFIX = ".ccadapter.manifest.json";
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ARCHITECTURES = new Set(["arm64", "x86_64", "universal2"]);
const PLATFORMS = new Set(["macos", "windows"]);
const PACKAGE_SCHEMA_VERSION = 1;

export const canonicalAdapterIds = ADAPTER_IDS;

function fail(message) {
  throw new Error(`Adapter release catalog: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function assertExactKeys(value, allowed, label) {
  assertObject(value, label);
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  assert(unexpected.length === 0, `${label} contains unknown fields: ${unexpected.join(", ")}`);
}

function assertSemver(value, label) {
  assert(typeof value === "string" && SEMVER.test(value), `${label} must be a semantic version`);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSemver(left, right) {
  const parse = (value) => {
    const separator = value.indexOf("-");
    return {
      core: (separator === -1 ? value : value.slice(0, separator)).split(".").map(Number),
      prerelease: separator === -1 ? [] : value.slice(separator + 1).split("."),
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    const aNumeric = /^[0-9]+$/.test(a.prerelease[index]);
    const bNumeric = /^[0-9]+$/.test(b.prerelease[index]);
    if (aNumeric && bNumeric) {
      if (Number(a.prerelease[index]) !== Number(b.prerelease[index])) {
        return Number(a.prerelease[index]) - Number(b.prerelease[index]);
      }
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else {
      const order = compareText(a.prerelease[index], b.prerelease[index]);
      if (order !== 0) return order;
    }
  }
  return 0;
}

export function compareAdapterVersionsDescending(left, right) {
  return -compareSemver(left, right);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(filename, label = filename) {
  let source;
  try {
    source = await readFile(filename, "utf8");
  } catch (error) {
    fail(`cannot read ${label}: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

async function readTrimmed(filename, label) {
  const value = (await readFile(filename, "utf8")).trim();
  assert(value.length > 0, `${label} is empty`);
  return value;
}

function normalizeCapabilityVersion(value, label) {
  if (typeof value === "string") {
    assertSemver(value, label);
    return value;
  }
  assert(Number.isSafeInteger(value) && value >= 1, `${label} must be a semantic version or positive integer revision`);
  return `${value}.0.0`;
}

function normalizeDownloadBaseUrl(value) {
  if (value === undefined) return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("--download-base-url must be an absolute HTTPS URL");
  }
  assert(url.protocol === "https:", "--download-base-url must use HTTPS");
  assert(!url.username && !url.password, "--download-base-url must not contain credentials");
  assert(!url.search && !url.hash, "--download-base-url must not contain a query or fragment");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function releaseTagFromDownloadBaseUrl(url) {
  if (!url) return undefined;
  const match = url.pathname.match(/^\/quanzhankeji\/cc-theme\/releases\/download\/(cc-theme-v[^/]+)\/$/);
  assert(url.hostname === "github.com" && match, "published download origin must be the official exact GitHub Release tag");
  return match[1];
}

function normalizePublishedMetadata({ channel, sequence, publishedAt, expiresAt, keyId, revokedSha256 }) {
  assert(channel === "stable", "published catalog channel must be stable");
  assert(Number.isSafeInteger(sequence) && sequence >= 1, "published catalog sequence must be a positive integer");
  const published = new Date(publishedAt);
  const expires = new Date(expiresAt);
  const utcTimestamp = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;
  assert(typeof publishedAt === "string" && utcTimestamp.test(publishedAt) && Number.isFinite(published.valueOf()), "publishedAt must be canonical RFC3339 UTC");
  assert(typeof expiresAt === "string" && utcTimestamp.test(expiresAt) && Number.isFinite(expires.valueOf()), "expiresAt must be canonical RFC3339 UTC");
  assert(expires > published, "expiresAt must be later than publishedAt");
  assert(/^cc-theme-adapter-root-[0-9]{4}-[0-9]{2}$/.test(keyId), "published catalog keyId is invalid");
  assert(Array.isArray(revokedSha256), "revokedSha256 must be an array");
  assert(revokedSha256.every((digest) => typeof digest === "string" && SHA256.test(digest)), "revokedSha256 contains an invalid digest");
  assert(new Set(revokedSha256).size === revokedSha256.length, "revokedSha256 contains duplicates");
  return { channel, sequence, publishedAt, expiresAt, keyId, revokedSha256: [...revokedSha256].sort(compareText) };
}

function assertReleaseRevision(value, label) {
  assert(Number.isSafeInteger(value) && value >= 1, `${label} must be a positive integer`);
}

function expectedAssetIdentity(adapterId, adapterVersion, adapterReleaseRevision, platform, architecture) {
  return `${adapterId}-${adapterVersion}-r${adapterReleaseRevision}-${platform}-${architecture}`;
}

function expectedAssetName(assetIdentity) {
  return `${assetIdentity}.ccadapter`;
}

async function readEngineFacts(workspaceRoot, adapterId, managerVersion, unifiedThemeSchemaVersion) {
  const adapterRoot = path.join(workspaceRoot, "adapters", adapterId);
  const [adapterVersion, packageDocument, capability, projectManifest, releaseManifest] = await Promise.all([
    readTrimmed(path.join(adapterRoot, "VERSION"), `${adapterId}/VERSION`),
    readJson(path.join(adapterRoot, "package.json"), `${adapterId}/package.json`),
    readJson(path.join(adapterRoot, "contracts", "adapter-capability.json"), `${adapterId} capability`),
    readJson(path.join(adapterRoot, "PROJECT_MANIFEST.json"), `${adapterId} project manifest`),
    readJson(path.join(adapterRoot, "contracts", "adapter-release-manifest.json"), `${adapterId} release manifest`),
  ]);

  assertSemver(adapterVersion, `${adapterId} Adapter version`);
  assert(packageDocument.name === adapterId, `${adapterId} package name does not match its canonical Adapter ID`);
  assert(packageDocument.version === adapterVersion, `${adapterId} VERSION and package.json version differ`);
  assert(capability.adapterId === adapterId, `${adapterId} capability declares a different Adapter ID`);
  assert(projectManifest.adapterId === adapterId, `${adapterId} project manifest declares a different Adapter ID`);
  assert(releaseManifest.adapterId === adapterId, `${adapterId} release manifest declares a different Adapter ID`);

  const adapterDescriptor = packageDocument.ccThemeAdapter;
  assertObject(adapterDescriptor, `${adapterId} package ccThemeAdapter`);
  const adapterReleaseRevision = releaseManifest.adapterReleaseRevision;
  assertReleaseRevision(adapterReleaseRevision, `${adapterId} adapterReleaseRevision`);
  for (const [label, document] of [
    ["package descriptor", adapterDescriptor],
    ["capability", capability],
    ["project manifest", projectManifest],
    ["release manifest", releaseManifest],
  ]) {
    assert(document.adapterVersion === adapterVersion, `${adapterId} ${label} adapterVersion differs from VERSION`);
    assert(
      document.adapterReleaseRevision === adapterReleaseRevision,
      `${adapterId} ${label} adapterReleaseRevision differs from release manifest`,
    );
  }

  const platform = releaseManifest.platform ?? releaseManifest.os;
  const architecture = releaseManifest.architecture ?? releaseManifest.arch;
  assert(PLATFORMS.has(platform), `${adapterId} release manifest uses an unknown platform`);
  assert(ARCHITECTURES.has(architecture), `${adapterId} release manifest uses an unknown architecture`);
  assert(
    (adapterDescriptor.platform ?? adapterDescriptor.os) === platform,
    `${adapterId} package descriptor platform differs from release manifest`,
  );
  assert(
    (adapterDescriptor.architecture ?? adapterDescriptor.arch) === architecture,
    `${adapterId} package descriptor architecture differs from release manifest`,
  );
  const assetIdentity = expectedAssetIdentity(adapterId, adapterVersion, adapterReleaseRevision, platform, architecture);
  assert(releaseManifest.assetIdentity === assetIdentity, `${adapterId} release manifest assetIdentity is inconsistent`);
  const projectAssetIdentity = projectManifest.releaseTarget?.assetIdentity ?? projectManifest.release?.assetIdentity;
  assert(projectAssetIdentity === assetIdentity, `${adapterId} project manifest assetIdentity differs from release manifest`);
  if (adapterDescriptor.assetIdentity !== undefined) {
    assert(adapterDescriptor.assetIdentity === assetIdentity, `${adapterId} package descriptor assetIdentity differs from release manifest`);
  }

  return {
    adapterId,
    adapterVersion,
    adapterReleaseRevision,
    platform,
    architecture,
    assetIdentity,
    contracts: {
      minimumManagerVersion: managerVersion,
      capabilityVersion: normalizeCapabilityVersion(capability.capabilityVersion, `${adapterId} capabilityVersion`),
      unifiedThemeSchemaVersion,
      adapterPackageSchemaVersion: PACKAGE_SCHEMA_VERSION,
    },
  };
}

function validateSidecar(sidecar, filename) {
  assertExactKeys(
    sidecar,
    ["kind", "schemaVersion", "assetName", "bytes", "sha256", "manifestSha256", "package"],
    filename,
  );
  assert(sidecar.kind === "cc-theme.adapter-package-sidecar", `${filename} has an invalid kind`);
  assert(sidecar.schemaVersion === 1, `${filename} has an unsupported schemaVersion`);
  assert(typeof sidecar.assetName === "string", `${filename}.assetName must be a string`);
  assert(Number.isSafeInteger(sidecar.bytes) && sidecar.bytes >= 1, `${filename}.bytes must be a positive integer`);
  assert(typeof sidecar.sha256 === "string" && SHA256.test(sidecar.sha256), `${filename}.sha256 must be lowercase SHA-256`);
  assert(
    typeof sidecar.manifestSha256 === "string" && SHA256.test(sidecar.manifestSha256),
    `${filename}.manifestSha256 must be lowercase SHA-256`,
  );
  assertObject(sidecar.package, `${filename}.package`);
}

function readPackageIdentity(manifest, filename) {
  assertExactKeys(
    manifest,
    [
      "kind", "schemaVersion", "adapterId", "adapterVersion", "adapterReleaseRevision",
      "assetIdentity", "platform", "architecture", "contracts", "files",
    ],
    `${filename}.package`,
  );
  assert(manifest.kind === "cc-theme.adapter-package", `${filename} package has an invalid kind`);
  assert(manifest.schemaVersion === PACKAGE_SCHEMA_VERSION, `${filename} package has an unsupported schemaVersion`);
  const adapterId = manifest.adapterId;
  const adapterVersion = manifest.adapterVersion;
  const adapterReleaseRevision = manifest.adapterReleaseRevision;
  const assetIdentity = manifest.assetIdentity;
  const platform = manifest.platform;
  const architecture = manifest.architecture;
  assert(ADAPTER_IDS.includes(adapterId), `${filename} uses an unknown Adapter ID`);
  assertSemver(adapterVersion, `${filename} Adapter version`);
  assertReleaseRevision(adapterReleaseRevision, `${filename} Adapter release revision`);
  assert(PLATFORMS.has(platform), `${filename} uses an unknown platform`);
  assert(ARCHITECTURES.has(architecture), `${filename} uses an unknown architecture`);
  assert(
    assetIdentity === expectedAssetIdentity(adapterId, adapterVersion, adapterReleaseRevision, platform, architecture),
    `${filename} assetIdentity is inconsistent`,
  );
  assertObject(manifest.contracts, `${filename}.package.contracts`);
  assertExactKeys(
    manifest.contracts,
    ["minimumManagerVersion", "capabilityVersion", "unifiedThemeSchemaVersion", "adapterPackageSchemaVersion"],
    `${filename}.package.contracts`,
  );
  assert(Array.isArray(manifest.files) && manifest.files.length > 0, `${filename}.package.files must not be empty`);
  const filePaths = [];
  for (const [index, file] of manifest.files.entries()) {
    assertExactKeys(file, ["path", "bytes", "sha256", "mode"], `${filename}.package.files[${index}]`);
    const relativePath = typeof file.path === "string" && file.path.startsWith("payload/")
      ? file.path.slice("payload/".length)
      : "";
    const segments = relativePath.split("/");
    assert(
      relativePath.length > 0 &&
        !relativePath.includes("\\") &&
        segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
      `${filename}.package.files[${index}].path is unsafe`,
    );
    assert(Number.isSafeInteger(file.bytes) && file.bytes >= 0, `${filename}.package.files[${index}].bytes is invalid`);
    assert(typeof file.sha256 === "string" && SHA256.test(file.sha256), `${filename}.package.files[${index}].sha256 is invalid`);
    assert([420, 493].includes(file.mode), `${filename}.package.files[${index}].mode is invalid`);
    filePaths.push(file.path);
  }
  assert(
    filePaths.every((filePath, index) => index === 0 || compareText(filePaths[index - 1], filePath) < 0),
    `${filename}.package.files must be sorted`,
  );
  assert(
    new Set(filePaths.map((filePath) => filePath.normalize("NFC").toLowerCase())).size === filePaths.length,
    `${filename}.package.files must be case-fold unique`,
  );
  return {
    adapterId,
    adapterVersion,
    adapterReleaseRevision,
    assetIdentity,
    platform,
    architecture,
    contracts: manifest.contracts,
  };
}

async function readPackages(packageDirectory, engineFacts, downloadBaseUrl, releaseTag) {
  const packagesByAdapter = new Map(ADAPTER_IDS.map((adapterId) => [adapterId, []]));
  if (!packageDirectory) return packagesByAdapter;

  const entries = (await readdir(packageDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(SIDECAR_SUFFIX))
    .sort((left, right) => compareText(left.name, right.name));

  for (const entry of entries) {
    const sidecarPath = path.join(packageDirectory, entry.name);
    const sidecar = await readJson(sidecarPath, entry.name);
    validateSidecar(sidecar, entry.name);
    const assetName = entry.name.slice(0, -".manifest.json".length);
    assert(sidecar.assetName === assetName, `${entry.name} does not name its adjacent archive exactly`);
    assert(assetName === path.basename(assetName), `${entry.name} contains an unsafe asset name`);

    const archivePath = path.join(packageDirectory, assetName);
    const archiveStat = await lstat(archivePath);
    assert(archiveStat.isFile() && !archiveStat.isSymbolicLink(), `${assetName} must be a regular file`);
    const archive = await readFile(archivePath);
    assert(archive.byteLength === sidecar.bytes, `${assetName} byte size differs from its sidecar`);
    assert(sha256(archive) === sidecar.sha256, `${assetName} SHA-256 differs from its sidecar`);
    assert(
      sha256(Buffer.from(`${JSON.stringify(sidecar.package, null, 2)}\n`, "utf8")) === sidecar.manifestSha256,
      `${entry.name} package manifest SHA-256 differs from its sidecar`,
    );

    const verified = await verifyAdapterPackage(archivePath, { expectedArchiveSha256: sidecar.sha256 });
    assert(verified.assetName === assetName, `${entry.name} archive name differs from the verified package`);
    assert(verified.bytes === sidecar.bytes, `${entry.name} archive bytes differ from the verified package`);
    assert(verified.manifestSha256 === sidecar.manifestSha256, `${entry.name} manifest digest differs from the archive`);
    assert(
      JSON.stringify(verified.manifest) === JSON.stringify(sidecar.package),
      `${entry.name} package manifest differs from the archive`,
    );

    const identity = readPackageIdentity(verified.manifest, entry.name);
    const facts = engineFacts.get(identity.adapterId);
    assert(identity.platform === "macos", `${assetName} is not a current Mac Adapter package`);
    assert(identity.adapterVersion === facts.adapterVersion, `${assetName} does not match ${identity.adapterId} VERSION`);
    assert(
      identity.adapterReleaseRevision === facts.adapterReleaseRevision,
      `${assetName} does not match ${identity.adapterId} release revision`,
    );
    assert(identity.assetIdentity === facts.assetIdentity, `${assetName} does not match ${identity.adapterId} asset identity`);
    assert(
      assetName === expectedAssetName(identity.assetIdentity),
      `${assetName} does not match the deterministic Adapter asset name`,
    );
    assert(
      JSON.stringify(identity.contracts) === JSON.stringify(facts.contracts),
      `${assetName} contract versions differ from current local Engine facts`,
    );

    const packageRecord = {
      platform: identity.platform,
      architecture: identity.architecture,
      assetName,
      bytes: archive.byteLength,
      sha256: sha256(archive),
      manifestSha256: sidecar.manifestSha256,
    };
    if (downloadBaseUrl) {
      packageRecord.releaseTag = releaseTag;
      packageRecord.downloadUrl = new URL(encodeURIComponent(assetName), downloadBaseUrl).href;
    }
    packagesByAdapter.get(identity.adapterId).push(packageRecord);
  }

  for (const [adapterId, packages] of packagesByAdapter) {
    packages.sort((left, right) =>
      compareText(
        `${left.platform}\0${left.architecture}\0${left.assetName}`,
        `${right.platform}\0${right.architecture}\0${right.assetName}`,
      ),
    );
    const identities = packages.map(({ platform, architecture }) => `${platform}/${architecture}`);
    assert(new Set(identities).size === identities.length, `${adapterId} has duplicate platform/architecture packages`);
  }
  return packagesByAdapter;
}

export function serializeCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

export async function generateAdapterVersionCatalog({
  workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  packageDirectory,
  publicationStatus = "development-local",
  downloadBaseUrl,
  channel,
  sequence,
  publishedAt,
  expiresAt,
  keyId,
  revokedSha256,
} = {}) {
  assert(["development-local", "published"].includes(publicationStatus), "publicationStatus is invalid");
  const normalizedDownloadBaseUrl = normalizeDownloadBaseUrl(downloadBaseUrl);
  if (publicationStatus === "published") {
    assert(normalizedDownloadBaseUrl, "published catalog requires an HTTPS download base URL");
  }
  const releaseTag = releaseTagFromDownloadBaseUrl(normalizedDownloadBaseUrl);
  const publishedMetadata = publicationStatus === "published"
    ? normalizePublishedMetadata({ channel, sequence, publishedAt, expiresAt, keyId, revokedSha256 })
    : undefined;
  const managerPackage = await readJson(path.join(workspaceRoot, "app", "package.json"), "Manager package.json");
  assertSemver(managerPackage.version, "Manager version");
  const unifiedThemeSchema = await readJson(
    path.join(workspaceRoot, "app", "packages", "contracts", "unified-theme-v1.schema.json"),
    "Unified Theme schema",
  );
  const unifiedThemeSchemaVersion = unifiedThemeSchema?.properties?.schemaVersion?.const;
  assert(Number.isSafeInteger(unifiedThemeSchemaVersion) && unifiedThemeSchemaVersion >= 1, "Unified Theme schema version is invalid");

  const facts = await Promise.all(
    ADAPTER_IDS.map((adapterId) =>
      readEngineFacts(workspaceRoot, adapterId, managerPackage.version, unifiedThemeSchemaVersion),
    ),
  );
  const factsByAdapter = new Map(facts.map((entry) => [entry.adapterId, entry]));
  const packagesByAdapter = await readPackages(packageDirectory, factsByAdapter, normalizedDownloadBaseUrl, releaseTag);

  const adapters = facts.map(({ adapterId, adapterVersion, adapterReleaseRevision, assetIdentity, contracts }) => ({
    adapterId,
    current: { adapterVersion, adapterReleaseRevision },
    releases: [
      {
        adapterVersion,
        adapterReleaseRevision,
        assetIdentity,
        contracts,
        packages: packagesByAdapter.get(adapterId),
      },
    ].sort((left, right) =>
      compareAdapterVersionsDescending(left.adapterVersion, right.adapterVersion) ||
      right.adapterReleaseRevision - left.adapterReleaseRevision,
    ),
  }));

  for (const adapter of adapters) {
    assert(
      adapter.releases[0].adapterVersion === adapter.current.adapterVersion &&
        adapter.releases[0].adapterReleaseRevision === adapter.current.adapterReleaseRevision,
      `${adapter.adapterId} current release is not the highest release`,
    );
    if (publicationStatus === "published") {
      assert(adapter.releases[0].packages.length > 0, `${adapter.adapterId} has no verified package for a published catalog`);
    }
  }

  return {
    kind: "cc-theme.adapter-release-catalog",
    schemaVersion: 1,
    publicationStatus,
    currentVersionPolicy: "explicit",
    ...(publishedMetadata ?? {}),
    adapters,
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (["--workspace", "--packages", "--output", "--status", "--download-base-url", "--channel", "--sequence", "--published-at", "--expires-at", "--key-id", "--revoked-sha256"].includes(argument)) {
      const value = argv[index + 1];
      assert(value && !value.startsWith("--"), `${argument} requires a value`);
      options[argument.slice(2)] = value;
      index += 1;
    } else fail(`unknown argument ${argument}`);
  }
  return options;
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const workspaceRoot = path.resolve(options.workspace ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
  const output = path.resolve(options.output ?? path.join(workspaceRoot, "app", "registry", "adapter-versions.json"));
  const catalog = await generateAdapterVersionCatalog({
    workspaceRoot,
    packageDirectory: options.packages ? path.resolve(options.packages) : undefined,
    publicationStatus: options.status ?? "development-local",
    downloadBaseUrl: options["download-base-url"],
    channel: options.channel,
    sequence: options.sequence === undefined ? undefined : Number(options.sequence),
    publishedAt: options["published-at"],
    expiresAt: options["expires-at"],
    keyId: options["key-id"],
    revokedSha256: options["revoked-sha256"] ? options["revoked-sha256"].split(",").filter(Boolean) : undefined,
  });
  const serialized = serializeCatalog(catalog);
  if (options.check) {
    const existing = await readFile(output, "utf8");
    assert(existing === serialized, `${output} is stale; regenerate it`);
    return;
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, serialized, { encoding: "utf8", mode: 0o644 });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
