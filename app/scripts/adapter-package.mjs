import { createHash } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ADAPTER_PACKAGE_KIND = "cc-theme.adapter-package";
export const ADAPTER_PACKAGE_SCHEMA_VERSION = 1;

const ROOT_MANIFEST = "adapter.json";
const PAYLOAD_PREFIX = "payload/";
const ALLOWED_ADAPTERS = new Set(["mac-codex", "mac-doubao", "mac-workbuddy"]);
const ALLOWED_ARCHITECTURES = new Set(["arm64", "x86_64", "universal2"]);
const MAX_ENTRIES = 256;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024;
const DOS_TIME = 0;
const DOS_DATE = 0x21;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const FORBIDDEN_SEGMENTS = new Set(["fixture", "fixtures", "preset", "presets", "release", "staging", "test", "tests", "theme", "themes"]);
const FORBIDDEN_BASENAMES = new Set(["family.json", "unified-theme.json"]);
const FORBIDDEN_EXTENSIONS = new Set([
  ".3gp", ".7z", ".aac", ".avif", ".avi", ".bmp", ".bz2", ".ccadapter", ".cctheme",
  ".flac", ".gif", ".heic", ".jpeg", ".jpg", ".m4a", ".m4v", ".mkv", ".mov", ".mp3",
  ".mp4", ".mpeg", ".mpg", ".ogg", ".png", ".rar", ".tar", ".tiff", ".wav", ".webm",
  ".webp", ".xz", ".zip",
]);
const RELEASE_MANIFESTS = Object.freeze({
  "mac-codex": {
    kind: "mac-codex-adapter.release-manifest",
    keys: [
      "adapterId", "adapterReleaseRevision", "adapterVersion", "arch", "artifacts",
      "assetIdentity", "entries", "kind", "os", "revision",
    ],
    platformKey: "os",
    architectureKey: "arch",
  },
  "mac-doubao": {
    kind: "mac-doubao-adapter.release-manifest",
    keys: [
      "adapterId", "adapterReleaseRevision", "adapterVersion", "architecture",
      "assetIdentity", "entries", "kind", "platform", "revision",
    ],
    platformKey: "platform",
    architectureKey: "architecture",
  },
  "mac-workbuddy": {
    kind: "workbuddy-adapter.release-manifest",
    keys: [
      "adapterId", "adapterReleaseRevision", "adapterVersion", "architecture",
      "assetIdentity", "entries", "kind", "platform", "revision",
    ],
    platformKey: "platform",
    architectureKey: "architecture",
  },
});

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function fail(message) {
  throw new Error(`Invalid .ccadapter: ${message}`);
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} contains missing or unknown fields`);
  return value;
}

function assertSemver(value, label) {
  if (typeof value !== "string" || value.length > 80 || !SEMVER.test(value)) fail(`${label} must be a semantic version`);
  return value;
}

function assertReleaseRevision(value, label = "adapterReleaseRevision") {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive integer`);
  return value;
}

function expectedAssetIdentity(adapterId, adapterVersion, adapterReleaseRevision, platform, architecture) {
  return `${adapterId}-${adapterVersion}-r${adapterReleaseRevision}-${platform}-${architecture}`;
}

function normalizedCapabilityVersion(value) {
  if (Number.isSafeInteger(value) && value >= 0) return `${value}.0.0`;
  return assertSemver(value, "capabilityVersion");
}

function parsePayloadJson(byRelative, relative, label, { required = true } = {}) {
  const file = byRelative.get(relative);
  if (!file) {
    if (!required) return undefined;
    fail(`${label} is missing from the closed release manifest`);
  }
  try {
    const value = JSON.parse(file.bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be a JSON object`);
    return value;
  } catch (error) {
    if (error?.message?.startsWith("Invalid .ccadapter:")) throw error;
    fail(`${label} is not valid JSON`);
  }
}

function assertReleaseQualification(byRelative, identity, capability) {
  if (capability.runtimeApplyAvailable !== true) {
    fail("release qualification rejects an Adapter whose runtime apply is unavailable");
  }
  if (Object.hasOwn(capability, "availability") && capability.availability !== "available") {
    fail("release qualification rejects an unavailable Adapter Capability");
  }
  if (Object.hasOwn(capability, "available") && capability.available !== true) {
    fail("release qualification rejects an unavailable Adapter Capability");
  }

  const compatibility = capability.compatibility;
  const requiresCurrentSurfaceGate = identity.adapterId === "mac-codex" ||
    compatibility?.surfaceEvidenceIsGate === true ||
    compatibility?.currentEvidence?.clientVersion !== undefined;
  const hasVerifiedVersionGate = compatibility?.verifiedClientVersions !== undefined;
  if (hasVerifiedVersionGate) {
    if (!Array.isArray(compatibility.verifiedClientVersions) ||
        !compatibility.verifiedClientVersions.includes(identity.adapterVersion)) {
      fail("release qualification does not admit the Adapter host version");
    }
  }
  const hasCurrentSurfaceGate = compatibility?.currentEvidence?.clientVersion !== undefined;
  if (requiresCurrentSurfaceGate && !hasCurrentSurfaceGate) {
    fail("release qualification cannot downgrade the Adapter's current Surface evidence gate");
  }
  if (hasCurrentSurfaceGate && compatibility.currentEvidence.clientVersion !== identity.adapterVersion) {
    fail("release qualification current Surface evidence targets a different host version");
  }
  if (!requiresCurrentSurfaceGate && !hasVerifiedVersionGate) {
    fail("release qualification has no verified host or Surface admission gate");
  }

  const project = parsePayloadJson(byRelative, "PROJECT_MANIFEST.json", "PROJECT_MANIFEST", { required: false });
  const evidencePath = project?.contracts?.uiEvidenceCatalog ?? project?.host?.compatibilityEvidence?.uiSurfaceCatalog;
  if (requiresCurrentSurfaceGate && evidencePath === undefined) {
    fail("release qualification has no bound UI Surface evidence path");
  }
  if (evidencePath !== undefined) {
    const relative = normalizeSourcePath(evidencePath, "UI Surface evidence path");
    if (identity.adapterId === "mac-codex" &&
        relative !== `compatibility/chatgpt-macos/${identity.adapterVersion}/ui-surface-catalog.json`) {
      fail("release qualification uses a non-canonical CodeX Surface evidence path");
    }
    const surface = parsePayloadJson(byRelative, relative, "UI Surface evidence");
    if ((requiresCurrentSurfaceGate || surface.admission !== undefined) &&
        (surface.admission?.status !== "verified" || surface.admission?.failClosed !== true)) {
      fail("release Surface qualification is not verified");
    }
    const currentEvidence = compatibility?.currentEvidence;
    const expectedCatalogId = identity.adapterId === "mac-codex"
      ? `chatgpt-macos-${identity.adapterVersion}`
      : currentEvidence?.surfaceCatalogId;
    if (requiresCurrentSurfaceGate &&
        (typeof currentEvidence?.surfaceCatalogId !== "string" ||
         currentEvidence.surfaceCatalogId !== expectedCatalogId ||
         surface.catalogId !== expectedCatalogId)) {
      fail("release Surface Catalog identity differs from the Adapter Capability");
    }
    if (requiresCurrentSurfaceGate) {
      const expectedVersion = currentEvidence?.surfaceCatalogVersion;
      const schemaMajor = typeof surface.schemaVersion === "string" && SEMVER.test(surface.schemaVersion)
        ? Number(surface.schemaVersion.split(".", 1)[0])
        : undefined;
      const actualVersion = surface.catalogVersion ?? schemaMajor;
      if (!Number.isSafeInteger(expectedVersion) || actualVersion !== expectedVersion) {
        fail("release Surface Catalog version differs from the Adapter Capability");
      }
    }
    if (requiresCurrentSurfaceGate && surface.client?.version !== identity.adapterVersion) {
      fail("release Surface evidence targets a different host version");
    }
    if (requiresCurrentSurfaceGate &&
        (typeof currentEvidence?.clientBuild !== "string" ||
         surface.client?.build !== currentEvidence.clientBuild)) {
      fail("release Surface evidence targets a different host build");
    }
  }
}

function compareSemver(left, right) {
  const parse = (value) => {
    const match = SEMVER.exec(assertSemver(value, "version"));
    return {
      core: match.slice(1, 4).map(Number),
      prerelease: match[4] === undefined ? [] : match[4].split("."),
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    const aNumeric = /^[0-9]+$/.test(a.prerelease[index]);
    const bNumeric = /^[0-9]+$/.test(b.prerelease[index]);
    if (aNumeric && bNumeric) {
      const aNumber = BigInt(a.prerelease[index]);
      const bNumber = BigInt(b.prerelease[index]);
      if (aNumber !== bNumber) return aNumber < bNumber ? -1 : 1;
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else {
      const order = lexical(a.prerelease[index], b.prerelease[index]);
      if (order !== 0) return order;
    }
  }
  return 0;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function normalizeSourcePath(value, label = "payload path") {
  if (typeof value !== "string" || value.length < 1 || value.length > 504 || !SAFE_RELATIVE_PATH.test(value) || value.includes("\\")) {
    fail(`${label} is not a safe POSIX relative path`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment.length === 0)) fail(`${label} contains path traversal`);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const forbidden = lowerSegments.find((segment) => FORBIDDEN_SEGMENTS.has(segment));
  if (forbidden) fail(`${label} contains forbidden directory ${forbidden}`);
  const basename = lowerSegments.at(-1);
  if (FORBIDDEN_BASENAMES.has(basename) || FORBIDDEN_EXTENSIONS.has(path.posix.extname(basename))) {
    fail(`${label} contains production theme, media, or archive content`);
  }
  return value;
}

function assertNoRetiredPublicId(bytes, label) {
  const lowered = bytes.toString("utf8").toLowerCase();
  for (const client of ["codex", "workbuddy"]) {
    const retired = ["mac", client, "skin"].join("-");
    if (lowered.includes(retired)) fail(`${label} contains a retired public Adapter ID`);
  }
}

function startsWithBytes(bytes, signature, offset = 0) {
  return bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value);
}

function assertNoForbiddenMagic(bytes, label) {
  const ascii = (value, offset = 0) => startsWithBytes(bytes, [...Buffer.from(value, "ascii")], offset);
  const binarySignatures = [
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    [0xff, 0xd8, 0xff],
    [0x1a, 0x45, 0xdf, 0xa3],
    [0x49, 0x49, 0x2a, 0x00],
    [0x4d, 0x4d, 0x00, 0x2a],
    [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
    [0x1f, 0x8b],
    [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00],
  ];
  const forbidden = binarySignatures.some((signature) => startsWithBytes(bytes, signature)) ||
    ascii("GIF87a") || ascii("GIF89a") || ascii("BM") || ascii("OggS") || ascii("fLaC") || ascii("ID3") ||
    ascii("Rar!\u001a\u0007") || ascii("BZh") || ascii("PK\u0003\u0004") || ascii("PK\u0005\u0006") ||
    ascii("PK\u0007\u0008") || ascii("ustar", 257) ||
    (ascii("RIFF") && (ascii("WEBP", 8) || ascii("WAVE", 8) || ascii("AVI ", 8))) ||
    (bytes.length >= 12 && ascii("ftyp", 4));
  if (forbidden) fail(`${label} contains media or archive content disguised by its filename`);
}

function lexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function stableReadRegularFile(root, relative, maxBytes = MAX_FILE_BYTES) {
  const absolute = path.resolve(root, ...relative.split("/"));
  const resolvedRoot = path.resolve(root);
  const rootPrefix = `${resolvedRoot}${path.sep}`;
  if (!absolute.startsWith(rootPrefix)) fail(`${relative} escapes the source root`);
  let parent = resolvedRoot;
  for (const segment of relative.split("/").slice(0, -1)) {
    parent = path.join(parent, segment);
    const parentStat = await fsp.lstat(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) fail(`${relative} traverses a symlink or non-directory`);
  }
  const realRoot = await fsp.realpath(resolvedRoot);
  const realFile = await fsp.realpath(absolute);
  if (!realFile.startsWith(`${realRoot}${path.sep}`)) fail(`${relative} resolves outside the source root`);
  const before = await fsp.lstat(absolute, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) fail(`${relative} must be a regular non-symlink file`);
  if (before.size < 1n || before.size > BigInt(maxBytes)) fail(`${relative} exceeds the per-file byte budget`);
  const noFollow = FS_CONSTANTS.O_NOFOLLOW ?? 0;
  let handle;
  try {
    handle = await fsp.open(absolute, FS_CONSTANTS.O_RDONLY | noFollow);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) fail(`${relative} changed while it was opened`);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "mode"]) {
      if (opened[key] !== after[key]) fail(`${relative} changed while it was read`);
    }
    const linkedAfter = await fsp.lstat(absolute, { bigint: true });
    if (!linkedAfter.isFile() || linkedAfter.isSymbolicLink() || linkedAfter.dev !== opened.dev || linkedAfter.ino !== opened.ino) {
      fail(`${relative} changed its filesystem identity while it was read`);
    }
    const realFileAfter = await fsp.realpath(absolute);
    if (!realFileAfter.startsWith(`${realRoot}${path.sep}`)) fail(`${relative} resolved outside the source root while it was read`);
    if (BigInt(bytes.length) !== after.size) fail(`${relative} changed size while it was read`);
    return { bytes, mode: (Number(after.mode) & 0o111) === 0 ? 0o644 : 0o755 };
  } finally {
    await handle?.close();
  }
}

async function loadReleaseInput(sourceRoot, adapterId) {
  if (!ALLOWED_ADAPTERS.has(adapterId)) fail("adapterId is not a canonical Mac Adapter ID");
  const rootStat = await fsp.lstat(sourceRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("source root must be a non-symlink directory");
  const manifestRelative = "contracts/adapter-release-manifest.json";
  const { bytes: releaseBytes } = await stableReadRegularFile(sourceRoot, manifestRelative);
  let release;
  try {
    release = JSON.parse(releaseBytes.toString("utf8"));
  } catch {
    fail("release manifest is not valid JSON");
  }
  const releaseContract = RELEASE_MANIFESTS[adapterId];
  exactObject(release, releaseContract.keys, "release manifest");
  if (release.kind !== releaseContract.kind || release.revision !== 1 || release.adapterId !== adapterId) {
    fail("release manifest identity does not match adapterId");
  }
  const adapterVersion = assertSemver(release.adapterVersion, "release manifest adapterVersion");
  const adapterReleaseRevision = assertReleaseRevision(release.adapterReleaseRevision);
  const platform = release[releaseContract.platformKey];
  const architecture = release[releaseContract.architectureKey];
  if (platform !== "macos" || !ALLOWED_ARCHITECTURES.has(architecture)) fail("release manifest target is unsupported");
  const assetIdentity = expectedAssetIdentity(adapterId, adapterVersion, adapterReleaseRevision, platform, architecture);
  if (release.assetIdentity !== assetIdentity) fail("release manifest assetIdentity does not match its dual-axis identity");
  if (adapterId === "mac-codex") {
    exactObject(release.artifacts, ["client", "source"], "release manifest artifacts");
    if (release.artifacts.source !== `${assetIdentity}.zip` || release.artifacts.client !== `cc-theme-${assetIdentity}.zip`) {
      fail("release manifest artifact names do not match assetIdentity");
    }
  }
  if (!Array.isArray(release.entries) || release.entries.length < 1 || release.entries.length > MAX_ENTRIES) fail("release manifest entries are invalid");
  const entries = release.entries.map((entry) => normalizeSourcePath(entry, "release manifest entry"));
  const folded = entries.map((entry) => entry.toLowerCase());
  if (new Set(folded).size !== entries.length) fail("release manifest contains duplicate entries");
  for (const required of [manifestRelative, "contracts/adapter-capability.json", "VERSION"]) {
    if (!entries.includes(required)) fail(`release manifest is missing ${required}`);
  }
  const sorted = [...entries].sort(lexical);
  const files = [];
  let totalBytes = 0;
  for (const relative of sorted) {
    const source = await stableReadRegularFile(sourceRoot, relative);
    assertNoForbiddenMagic(source.bytes, relative);
    assertNoRetiredPublicId(source.bytes, relative);
    totalBytes += source.bytes.length;
    if (totalBytes > MAX_PAYLOAD_BYTES) fail("payload exceeds the total byte budget");
    files.push({ relative, ...source });
  }
  return {
    files,
    identity: { adapterId, adapterVersion, adapterReleaseRevision, platform, architecture, assetIdentity },
  };
}

function manifestFileRecord(file) {
  return {
    path: `${PAYLOAD_PREFIX}${file.relative}`,
    bytes: file.bytes.length,
    sha256: sha256(file.bytes),
    mode: file.mode,
  };
}

function uint16(value) {
  const result = Buffer.alloc(2);
  result.writeUInt16LE(value, 0);
  return result;
}

function uint32(value) {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value >>> 0, 0);
  return result;
}

function encodeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.bytes);
    const local = Buffer.concat([
      uint32(0x04034b50), uint16(20), uint16(UTF8_FLAG), uint16(STORE_METHOD), uint16(DOS_TIME), uint16(DOS_DATE),
      uint32(checksum), uint32(entry.bytes.length), uint32(entry.bytes.length), uint16(name.length), uint16(0), name,
    ]);
    localParts.push(local, entry.bytes);
    const unixMode = 0o100000 | entry.mode;
    centralParts.push(Buffer.concat([
      uint32(0x02014b50), uint16(0x0314), uint16(20), uint16(UTF8_FLAG), uint16(STORE_METHOD), uint16(DOS_TIME), uint16(DOS_DATE),
      uint32(checksum), uint32(entry.bytes.length), uint32(entry.bytes.length), uint16(name.length), uint16(0), uint16(0),
      uint16(0), uint16(0), uint32(unixMode << 16), uint32(offset), name,
    ]));
    offset += local.length + entry.bytes.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    uint32(0x06054b50), uint16(0), uint16(0), uint16(entries.length), uint16(entries.length),
    uint32(central.length), uint32(offset), uint16(0),
  ]);
  return Buffer.concat([...localParts, central, end]);
}

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validateManifest(manifest) {
  exactObject(
    manifest,
    [
      "adapterId", "adapterReleaseRevision", "adapterVersion", "architecture", "assetIdentity",
      "contracts", "files", "kind", "platform", "schemaVersion",
    ],
    "adapter.json",
  );
  if (manifest.kind !== ADAPTER_PACKAGE_KIND || manifest.schemaVersion !== ADAPTER_PACKAGE_SCHEMA_VERSION) fail("unsupported package kind or schemaVersion");
  if (!ALLOWED_ADAPTERS.has(manifest.adapterId)) fail("adapterId is not a canonical Mac Adapter ID");
  assertSemver(manifest.adapterVersion, "adapterVersion");
  assertReleaseRevision(manifest.adapterReleaseRevision);
  if (manifest.platform !== "macos") fail("platform must be macos");
  if (!ALLOWED_ARCHITECTURES.has(manifest.architecture)) fail("architecture is unsupported");
  if (manifest.assetIdentity !== expectedAssetIdentity(
    manifest.adapterId,
    manifest.adapterVersion,
    manifest.adapterReleaseRevision,
    manifest.platform,
    manifest.architecture,
  )) fail("assetIdentity does not match the Adapter package identity");
  const contracts = exactObject(manifest.contracts, ["adapterPackageSchemaVersion", "capabilityVersion", "minimumManagerVersion", "unifiedThemeSchemaVersion"], "contracts");
  assertSemver(contracts.minimumManagerVersion, "minimumManagerVersion");
  assertSemver(contracts.capabilityVersion, "capabilityVersion");
  if (!Number.isSafeInteger(contracts.unifiedThemeSchemaVersion) || contracts.unifiedThemeSchemaVersion < 1 || contracts.unifiedThemeSchemaVersion > 65535) fail("unifiedThemeSchemaVersion is invalid");
  if (contracts.adapterPackageSchemaVersion !== ADAPTER_PACKAGE_SCHEMA_VERSION) fail("adapterPackageSchemaVersion is unsupported");
  if (!Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > MAX_ENTRIES) fail("files must be a bounded non-empty array");
  const paths = [];
  let totalBytes = 0;
  for (const record of manifest.files) {
    exactObject(record, ["bytes", "mode", "path", "sha256"], "file record");
    if (typeof record.path !== "string" || !record.path.startsWith(PAYLOAD_PREFIX)) fail("file record path must be under payload/");
    const relative = normalizeSourcePath(record.path.slice(PAYLOAD_PREFIX.length), "file record path");
    paths.push(relative);
    if (!Number.isSafeInteger(record.bytes) || record.bytes < 1 || record.bytes > MAX_FILE_BYTES) fail("file record bytes are invalid");
    totalBytes += record.bytes;
    if (totalBytes > MAX_PAYLOAD_BYTES) fail("payload exceeds the total byte budget");
    if (typeof record.sha256 !== "string" || !SHA256.test(record.sha256)) fail("file record SHA-256 is invalid");
    if (record.mode !== 0o644 && record.mode !== 0o755) fail("file record mode is invalid");
  }
  const sorted = [...paths].sort(lexical);
  if (JSON.stringify(paths) !== JSON.stringify(sorted) || new Set(paths.map((item) => item.toLowerCase())).size !== paths.length) {
    fail("file records must be sorted and unique");
  }
  return manifest;
}

function decodeZip(archive) {
  if (!Buffer.isBuffer(archive) || archive.length < 22 || archive.length > MAX_ARCHIVE_BYTES) fail("archive size is invalid");
  const endOffset = archive.length - 22;
  if (archive.readUInt32LE(endOffset) !== 0x06054b50 || archive.readUInt16LE(endOffset + 20) !== 0) fail("archive must have one canonical end record and no comment");
  const disk = archive.readUInt16LE(endOffset + 4);
  const centralDisk = archive.readUInt16LE(endOffset + 6);
  const diskEntries = archive.readUInt16LE(endOffset + 8);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralBytes = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount || entryCount < 2 || entryCount > MAX_ENTRIES + 1) fail("split, empty, or oversized archives are unsupported");
  if (centralOffset + centralBytes !== endOffset) fail("central directory bounds are invalid");
  const entries = [];
  const foldedNames = new Set();
  let cursor = centralOffset;
  let expectedLocalOffset = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > endOffset || archive.readUInt32LE(cursor) !== 0x02014b50) fail("central directory entry is invalid");
    const versionMadeBy = archive.readUInt16LE(cursor + 4);
    const versionNeeded = archive.readUInt16LE(cursor + 6);
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const time = archive.readUInt16LE(cursor + 12);
    const date = archive.readUInt16LE(cursor + 14);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedBytes = archive.readUInt32LE(cursor + 20);
    const bytes = archive.readUInt32LE(cursor + 24);
    const nameBytes = archive.readUInt16LE(cursor + 28);
    const extraBytes = archive.readUInt16LE(cursor + 30);
    const commentBytes = archive.readUInt16LE(cursor + 32);
    const diskStart = archive.readUInt16LE(cursor + 34);
    const external = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameBytes + extraBytes + commentBytes;
    if (next > endOffset || nameBytes < 1) fail("central directory entry is truncated");
    const nameBuffer = archive.subarray(cursor + 46, cursor + 46 + nameBytes);
    const name = nameBuffer.toString("utf8");
    if (!nameBuffer.equals(Buffer.from(name, "utf8")) || !SAFE_RELATIVE_PATH.test(name)) fail("entry name is not canonical UTF-8");
    if (versionMadeBy !== 0x0314 || versionNeeded !== 20 || flags !== UTF8_FLAG || method !== STORE_METHOD || time !== DOS_TIME || date !== DOS_DATE || extraBytes !== 0 || commentBytes !== 0 || diskStart !== 0 || compressedBytes !== bytes) {
      fail("entry encoding is not canonical deterministic ZIP");
    }
    const folded = name.toLowerCase();
    if (foldedNames.has(folded)) fail("archive contains duplicate entries");
    foldedNames.add(folded);
    const unixMode = external >>> 16;
    if ((unixMode & 0o170000) !== 0o100000) fail("archive contains a symlink or non-regular entry");
    const mode = unixMode & 0o777;
    if (mode !== 0o644 && mode !== 0o755) fail("archive contains an unsupported file mode");
    if (localOffset !== expectedLocalOffset || localOffset + 30 > centralOffset || archive.readUInt32LE(localOffset) !== 0x04034b50) fail("local entry offsets are invalid");
    const localNameBytes = archive.readUInt16LE(localOffset + 26);
    const localExtraBytes = archive.readUInt16LE(localOffset + 28);
    const localData = localOffset + 30 + localNameBytes + localExtraBytes;
    if (archive.readUInt16LE(localOffset + 4) !== versionNeeded || archive.readUInt16LE(localOffset + 6) !== flags || archive.readUInt16LE(localOffset + 8) !== method || archive.readUInt16LE(localOffset + 10) !== time || archive.readUInt16LE(localOffset + 12) !== date || archive.readUInt32LE(localOffset + 14) !== checksum || archive.readUInt32LE(localOffset + 18) !== compressedBytes || archive.readUInt32LE(localOffset + 22) !== bytes || localNameBytes !== nameBytes || localExtraBytes !== 0 || !archive.subarray(localOffset + 30, localOffset + 30 + localNameBytes).equals(nameBuffer)) {
      fail("local and central entry metadata differ");
    }
    if (bytes < 1 || bytes > MAX_FILE_BYTES || localData + bytes > centralOffset) fail("entry data bounds are invalid");
    const data = archive.subarray(localData, localData + bytes);
    if (crc32(data) !== checksum) fail(`${name} CRC-32 mismatch`);
    entries.push({ name, bytes: data, mode });
    expectedLocalOffset = localData + bytes;
    cursor = next;
  }
  if (cursor !== endOffset || expectedLocalOffset !== centralOffset) fail("archive contains unindexed or trailing data");
  return entries;
}

function parseManifest(bytes) {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("adapter.json is not valid JSON");
  }
  const canonical = canonicalJson(manifest);
  if (!bytes.equals(canonical)) fail("adapter.json is not canonical JSON");
  return validateManifest(manifest);
}

function checkExpectedCompatibility(manifest, expected) {
  if (!expected) return;
  exactObject(expected, ["adapterId", "architecture", "capabilityVersion", "managerVersion", "platform", "unifiedThemeSchemaVersion"], "verification expectation");
  if (manifest.adapterId !== expected.adapterId) fail("adapterId does not match the requested Adapter");
  if (manifest.platform !== expected.platform) fail("platform does not match the current platform");
  if (manifest.architecture !== expected.architecture && manifest.architecture !== "universal2") fail("architecture is incompatible with the current machine");
  assertSemver(expected.managerVersion, "current Manager version");
  if (compareSemver(expected.managerVersion, manifest.contracts.minimumManagerVersion) < 0) fail("Manager version is below the package minimum");
  const expectedCapability = normalizedCapabilityVersion(expected.capabilityVersion);
  if (manifest.contracts.capabilityVersion !== expectedCapability) fail("capability contract version mismatch");
  if (!Number.isSafeInteger(expected.unifiedThemeSchemaVersion) || manifest.contracts.unifiedThemeSchemaVersion !== expected.unifiedThemeSchemaVersion) fail("Unified Theme schema version mismatch");
}

async function loadQualifiedReleaseInput({ sourceRoot, adapterId, architecture }) {
  if (typeof sourceRoot !== "string") fail("sourceRoot is required");
  if (!ALLOWED_ARCHITECTURES.has(architecture)) fail("architecture is unsupported");
  const releaseInput = await loadReleaseInput(path.resolve(sourceRoot), adapterId);
  const { files, identity } = releaseInput;
  if (identity.architecture !== architecture) fail("requested architecture differs from the release manifest");
  const byRelative = new Map(files.map((file) => [file.relative, file]));
  const version = assertSemver(byRelative.get("VERSION").bytes.toString("utf8").trim(), "Adapter VERSION");
  if (version !== identity.adapterVersion) fail("Adapter VERSION differs from release manifest adapterVersion");
  let capability;
  try {
    capability = JSON.parse(byRelative.get("contracts/adapter-capability.json").bytes.toString("utf8"));
  } catch {
    fail("Adapter capability is not valid JSON");
  }
  if (!capability || typeof capability !== "object" || capability.adapterId !== adapterId) fail("Adapter capability identity mismatch");
  assertReleaseQualification(byRelative, identity, capability);
  return { ...releaseInput, capability, capabilityVersion: normalizedCapabilityVersion(capability.capabilityVersion) };
}

export async function verifyAdapterReleaseSource({ sourceRoot, adapterId, architecture } = {}) {
  const { identity, capabilityVersion } = await loadQualifiedReleaseInput({ sourceRoot, adapterId, architecture });
  return { ...identity, capabilityVersion };
}

export async function buildAdapterPackage({
  sourceRoot,
  outputDirectory,
  adapterId,
  architecture,
  minimumManagerVersion = "0.1.0",
  unifiedThemeSchemaVersion = 1,
} = {}) {
  if (typeof sourceRoot !== "string" || typeof outputDirectory !== "string") fail("sourceRoot and outputDirectory are required");
  assertSemver(minimumManagerVersion, "minimumManagerVersion");
  if (!Number.isSafeInteger(unifiedThemeSchemaVersion) || unifiedThemeSchemaVersion < 1 || unifiedThemeSchemaVersion > 65535) fail("unifiedThemeSchemaVersion is invalid");
  const { files, identity, capabilityVersion } = await loadQualifiedReleaseInput({
    sourceRoot,
    adapterId,
    architecture,
  });
  const manifest = validateManifest({
    kind: ADAPTER_PACKAGE_KIND,
    schemaVersion: ADAPTER_PACKAGE_SCHEMA_VERSION,
    adapterId,
    adapterVersion: identity.adapterVersion,
    adapterReleaseRevision: identity.adapterReleaseRevision,
    assetIdentity: identity.assetIdentity,
    platform: identity.platform,
    architecture,
    contracts: {
      minimumManagerVersion,
      capabilityVersion,
      unifiedThemeSchemaVersion,
      adapterPackageSchemaVersion: ADAPTER_PACKAGE_SCHEMA_VERSION,
    },
    files: files.map(manifestFileRecord),
  });
  const manifestBytes = canonicalJson(manifest);
  const archive = encodeZip([
    { name: ROOT_MANIFEST, bytes: manifestBytes, mode: 0o644 },
    ...files.map((file) => ({ name: `${PAYLOAD_PREFIX}${file.relative}`, bytes: file.bytes, mode: file.mode })),
  ]);
  const assetName = `${identity.assetIdentity}.ccadapter`;
  const destinationDirectory = path.resolve(outputDirectory);
  await fsp.mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
  const archivePath = path.join(destinationDirectory, assetName);
  const sidecarPath = `${archivePath}.manifest.json`;
  const archiveSha256 = sha256(archive);
  const sidecar = {
    kind: "cc-theme.adapter-package-sidecar",
    schemaVersion: 1,
    assetName,
    bytes: archive.length,
    sha256: archiveSha256,
    manifestSha256: sha256(manifestBytes),
    package: manifest,
  };
  const nonce = `${process.pid}-${Date.now()}`;
  const temporaryArchive = `${archivePath}.tmp-${nonce}`;
  const temporarySidecar = `${sidecarPath}.tmp-${nonce}`;
  let sidecarPublished = false;
  try {
    await fsp.writeFile(temporaryArchive, archive, { flag: "wx", mode: 0o600 });
    await fsp.writeFile(temporarySidecar, canonicalJson(sidecar), { flag: "wx", mode: 0o600 });
    await fsp.link(temporarySidecar, sidecarPath);
    sidecarPublished = true;
    await fsp.link(temporaryArchive, archivePath);
  } catch (error) {
    if (sidecarPublished) await fsp.rm(sidecarPath, { force: true });
    throw error;
  } finally {
    await Promise.all([fsp.rm(temporaryArchive, { force: true }), fsp.rm(temporarySidecar, { force: true })]);
  }
  return { archivePath, sidecarPath, assetName, bytes: archive.length, sha256: archiveSha256, manifestSha256: sidecar.manifestSha256, manifest };
}

export async function verifyAdapterPackage(archivePath, { expectedArchiveSha256, expected } = {}) {
  if (typeof archivePath !== "string" || path.extname(archivePath).toLowerCase() !== ".ccadapter") fail("archive path must end in .ccadapter");
  const archive = await stableReadRegularFile(path.dirname(path.resolve(archivePath)), path.basename(archivePath), MAX_ARCHIVE_BYTES);
  const archiveSha256 = sha256(archive.bytes);
  if (expectedArchiveSha256 !== undefined && (typeof expectedArchiveSha256 !== "string" || !SHA256.test(expectedArchiveSha256) || archiveSha256 !== expectedArchiveSha256)) {
    fail("complete archive SHA-256 mismatch");
  }
  const entries = decodeZip(archive.bytes);
  if (entries[0]?.name !== ROOT_MANIFEST || entries[0].mode !== 0o644) fail("adapter.json must be the first root entry");
  const manifest = parseManifest(entries[0].bytes);
  const expectedNames = [ROOT_MANIFEST, ...manifest.files.map(({ path: file }) => file)];
  if (JSON.stringify(entries.map(({ name }) => name)) !== JSON.stringify(expectedNames)) fail("archive entries do not exactly match adapter.json");
  let payloadBytes = 0;
  for (let index = 0; index < manifest.files.length; index += 1) {
    const record = manifest.files[index];
    const entry = entries[index + 1];
    payloadBytes += entry.bytes.length;
    if (payloadBytes > MAX_PAYLOAD_BYTES || record.bytes !== entry.bytes.length || record.sha256 !== sha256(entry.bytes) || record.mode !== entry.mode) {
      fail(`${record.path} bytes, SHA-256, or mode mismatch`);
    }
    assertNoForbiddenMagic(entry.bytes, record.path);
    assertNoRetiredPublicId(entry.bytes, record.path);
  }
  checkExpectedCompatibility(manifest, expected);
  return {
    ok: true,
    archivePath: path.resolve(archivePath),
    assetName: path.basename(archivePath),
    bytes: archive.bytes.length,
    sha256: archiveSha256,
    manifestSha256: sha256(entries[0].bytes),
    manifest,
  };
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (command !== "pack" && command !== "verify") fail("command must be pack or verify");
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail("CLI options must be --name value pairs");
    const name = key.slice(2);
    if (Object.hasOwn(options, name)) fail(`duplicate CLI option --${name}`);
    options[name] = value;
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseCli(process.argv.slice(2));
  if (command === "pack") {
    const allowed = new Set(["adapter-id", "architecture", "minimum-manager-version", "out", "source", "unified-theme-schema-version"]);
    if (Object.keys(options).some((key) => !allowed.has(key))) fail("pack contains an unknown CLI option");
    return buildAdapterPackage({
      sourceRoot: options.source,
      outputDirectory: options.out,
      adapterId: options["adapter-id"],
      architecture: options.architecture,
      minimumManagerVersion: options["minimum-manager-version"] ?? "0.1.0",
      unifiedThemeSchemaVersion: options["unified-theme-schema-version"] === undefined ? 1 : Number(options["unified-theme-schema-version"]),
    });
  }
  const allowed = new Set(["adapter-id", "architecture", "archive", "archive-sha256", "capability-version", "manager-version", "platform", "unified-theme-schema-version"]);
  if (Object.keys(options).some((key) => !allowed.has(key))) fail("verify contains an unknown CLI option");
  const compatibilityKeys = ["adapter-id", "architecture", "capability-version", "manager-version", "platform", "unified-theme-schema-version"];
  const supplied = compatibilityKeys.filter((key) => options[key] !== undefined);
  if (supplied.length !== 0 && supplied.length !== compatibilityKeys.length) fail("verify compatibility options must be supplied together");
  return verifyAdapterPackage(options.archive, {
    expectedArchiveSha256: options["archive-sha256"],
    expected: supplied.length === 0 ? undefined : {
      adapterId: options["adapter-id"],
      architecture: options.architecture,
      capabilityVersion: options["capability-version"],
      managerVersion: options["manager-version"],
      platform: options.platform,
      unifiedThemeSchemaVersion: Number(options["unified-theme-schema-version"]),
    },
  });
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
