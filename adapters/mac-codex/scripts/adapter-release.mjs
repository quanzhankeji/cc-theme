import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectOwnership } from "./distribution-ownership.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const manifestRelativePath = "contracts/adapter-release-manifest.json";
const forbiddenDirectories = new Set([
  "docs", "fixtures", "presets", "release", "skills", "tests", "themes", "theme-sources",
]);
const forbiddenMediaExtensions = new Set([
  ".cctheme", ".gif", ".jpeg", ".jpg", ".mov", ".mp4", ".png", ".webm", ".webp",
]);
const allowedTopLevel = new Set([
  "VERSION", "LICENSE", "NOTICE.md", "SOURCE_ATTRIBUTION.md", "package.json",
  "PROJECT_MANIFEST.json", "assets", "compatibility", "contracts", "scripts",
]);
const MAX_ENTRIES = 256;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_RELEASE_BYTES = 32 * 1024 * 1024;
const OPEN_READ_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);

function hasThemeMediaMagic(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return true;
  if (bytes.length >= 8 && bytes.subarray(4, 8).toString("ascii") === "ftyp") return true;
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return true;
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
      [[0x03, 0x04], [0x05, 0x06], [0x07, 0x08]].some(([left, right]) => bytes[2] === left && bytes[3] === right)) return true;
  return false;
}

function normalizeEntry(entry) {
  if (typeof entry !== "string" || !entry || entry.includes("\\") || path.posix.isAbsolute(entry)) {
    throw new Error("Adapter release entries must be non-empty POSIX relative paths");
  }
  if (path.posix.normalize(entry) !== entry || entry.startsWith("../") || entry.includes("/../") || entry.includes("/./")) {
    throw new Error(`Adapter release entry is not normalized: ${entry}`);
  }
  const segments = entry.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Adapter release entry contains an unsafe segment: ${entry}`);
  }
  if (!allowedTopLevel.has(segments[0])) {
    throw new Error(`Adapter release entry is outside the fixed engine allowlist: ${entry}`);
  }
  const forbidden = segments.find((segment) => forbiddenDirectories.has(segment.toLowerCase()));
  if (forbidden) throw new Error(`Adapter release entry uses forbidden directory ${forbidden}: ${entry}`);
  if (forbiddenMediaExtensions.has(path.posix.extname(entry).toLowerCase()) || path.posix.basename(entry).toLowerCase() === "theme.json") {
    throw new Error(`Adapter release entry is theme package content: ${entry}`);
  }
  return segments;
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

async function trustedSourceRoot(sourceRoot) {
  const absolute = path.resolve(sourceRoot);
  const stat = await fs.lstat(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Adapter release source must be a real directory");
  return fs.realpath(absolute);
}

async function validateSourcePath(root, segments, relativePath) {
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    if (!contained(root, current)) throw new Error(`Adapter release source escaped its root: ${relativePath}`);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Adapter release source must not contain a symbolic link: ${relativePath}`);
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`Adapter release source parent is not a directory: ${relativePath}`);
    }
    if (index === segments.length - 1 && !stat.isFile()) {
      throw new Error(`Adapter release source entry is not a regular file: ${relativePath}`);
    }
  }
  return current;
}

async function readStableSource(file, relativePath) {
  let handle;
  try {
    handle = await fs.open(file, OPEN_READ_FLAGS);
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_FILE_BYTES) {
      throw new Error(`Adapter release source file is invalid or too large: ${relativePath}`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes.length !== after.size) {
      throw new Error(`Adapter release source changed while being read: ${relativePath}`);
    }
    return { bytes, mode: after.mode & 0o777 };
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function prepareDestination(destinationRoot, sourceRoot) {
  const destination = path.resolve(destinationRoot);
  if (destination === sourceRoot || contained(sourceRoot, destination) || contained(destination, sourceRoot)) {
    throw new Error("Adapter release destination must be outside the Adapter source tree");
  }
  try {
    const stat = await fs.lstat(destination);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Adapter release destination must be a real directory");
    if ((await fs.readdir(destination)).length) throw new Error("Adapter release destination must be empty");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  }
  return fs.realpath(destination);
}

async function readReleaseJson(root, relativePath) {
  const file = await validateSourcePath(root, normalizeEntry(relativePath), relativePath);
  const { bytes } = await readStableSource(file, relativePath);
  return JSON.parse(bytes.toString("utf8"));
}

async function assertReleaseIdentity(root, manifest) {
  const versionFile = await validateSourcePath(root, normalizeEntry("VERSION"), "VERSION");
  const { bytes: versionBytes } = await readStableSource(versionFile, "VERSION");
  const adapterVersion = versionBytes.toString("utf8").trim();
  if (!/^\d+(?:\.\d+){2}$/.test(adapterVersion)) throw new Error("Adapter VERSION must be a host ShortVersion");
  const adapterReleaseRevision = manifest.adapterReleaseRevision;
  if (!Number.isSafeInteger(adapterReleaseRevision) || adapterReleaseRevision < 1) {
    throw new Error("Adapter release revision must be a positive integer");
  }
  if (manifest.adapterVersion !== adapterVersion || manifest.os !== "macos" || manifest.arch !== "arm64") {
    throw new Error("Adapter release identity does not match VERSION or target platform");
  }
  const assetIdentity = `${manifest.adapterId}-${adapterVersion}-r${adapterReleaseRevision}-${manifest.os}-${manifest.arch}`;
  const artifacts = {
    source: `${assetIdentity}.zip`,
    client: `cc-theme-${assetIdentity}.zip`,
  };
  if (manifest.assetIdentity !== assetIdentity ||
      manifest.artifacts?.source !== artifacts.source || manifest.artifacts?.client !== artifacts.client) {
    throw new Error("Adapter release asset identity is not canonical");
  }

  const [packageManifest, projectManifest, capability] = await Promise.all([
    readReleaseJson(root, "package.json"),
    readReleaseJson(root, "PROJECT_MANIFEST.json"),
    readReleaseJson(root, "contracts/adapter-capability.json"),
  ]);
  const expected = {
    adapterId: manifest.adapterId,
    adapterVersion,
    adapterReleaseRevision,
    os: manifest.os,
    arch: manifest.arch,
    assetIdentity,
  };
  if (packageManifest.version !== adapterVersion ||
      JSON.stringify(packageManifest.ccThemeAdapter) !== JSON.stringify(expected)) {
    throw new Error("package.json does not match the Adapter release identity");
  }
  if (projectManifest.adapterId !== manifest.adapterId || projectManifest.adapterVersion !== adapterVersion ||
      projectManifest.adapterReleaseRevision !== adapterReleaseRevision || projectManifest.productVersion !== adapterVersion ||
      projectManifest.client?.supportedShortVersion !== adapterVersion ||
      projectManifest.releaseTarget?.os !== manifest.os || projectManifest.releaseTarget?.arch !== manifest.arch ||
      projectManifest.releaseTarget?.assetIdentity !== assetIdentity ||
      projectManifest.releaseTarget?.sourceArtifact !== artifacts.source ||
      projectManifest.releaseTarget?.clientArtifact !== artifacts.client) {
    throw new Error("PROJECT_MANIFEST.json does not match the Adapter release identity");
  }
  if (capability.adapterId !== manifest.adapterId || capability.adapterVersion !== adapterVersion ||
      capability.adapterReleaseRevision !== adapterReleaseRevision ||
      capability.releaseTarget?.os !== manifest.os || capability.releaseTarget?.arch !== manifest.arch ||
      capability.releaseTarget?.assetIdentity !== assetIdentity ||
      capability.compatibility?.currentEvidence?.clientVersion !== adapterVersion) {
    throw new Error("Adapter Capability does not match the release or host ShortVersion");
  }

  const evidencePath = projectManifest.contracts?.uiEvidenceCatalog;
  if (typeof evidencePath !== "string") throw new Error("Adapter release has no UI Surface evidence path");
  const surfaceEvidence = await readReleaseJson(root, evidencePath);
  if (surfaceEvidence.client?.version !== adapterVersion ||
      surfaceEvidence.client?.build !== capability.compatibility.currentEvidence.clientBuild ||
      surfaceEvidence.catalogId !== capability.compatibility.currentEvidence.surfaceCatalogId ||
      surfaceEvidence.admission?.status !== "verified" || surfaceEvidence.admission?.failClosed !== true) {
    throw new Error("Adapter release does not have matching fail-closed Surface evidence");
  }
  return { ...expected, artifacts };
}

export async function loadAdapterReleaseManifest(sourceRoot = projectRoot) {
  const root = await trustedSourceRoot(sourceRoot);
  const manifestFile = await validateSourcePath(root, normalizeEntry(manifestRelativePath), manifestRelativePath);
  const { bytes } = await readStableSource(manifestFile, manifestRelativePath);
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest?.kind !== "mac-codex-adapter.release-manifest" || manifest?.revision !== 1 ||
      manifest?.adapterId !== "mac-codex" || !Array.isArray(manifest.entries) ||
      !manifest.entries.length || manifest.entries.length > MAX_ENTRIES) {
    throw new Error("Invalid Mac Codex Adapter release manifest");
  }
  const entries = manifest.entries.map((entry) => ({ entry, segments: normalizeEntry(entry) }));
  if (new Set(entries.map(({ entry }) => entry)).size !== entries.length) {
    throw new Error("Adapter release manifest contains duplicate entries");
  }
  const ordered = entries.map(({ entry }) => entry);
  if (JSON.stringify(ordered) !== JSON.stringify([...ordered].sort())) {
    throw new Error("Adapter release manifest entries must be sorted");
  }
  if (!manifest.entries.includes(manifestRelativePath) || !manifest.entries.includes("scripts/adapter-release.mjs")) {
    throw new Error("Adapter release manifest must include itself and its fixed builder");
  }
  const identity = await assertReleaseIdentity(root, manifest);
  return { root, manifest, entries, identity };
}

async function walkRelease(root, relative = "") {
  const files = [];
  for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Adapter release contains a symbolic link: ${next}`);
    if (entry.isDirectory()) {
      if (forbiddenDirectories.has(entry.name.toLowerCase())) {
        throw new Error(`Adapter release contains forbidden directory: ${next}`);
      }
      files.push(...await walkRelease(root, next));
    } else if (entry.isFile()) {
      normalizeEntry(next);
      files.push(next);
    } else {
      throw new Error(`Adapter release contains a non-regular entry: ${next}`);
    }
  }
  return files;
}

function assertExactEntries(actual, expected) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (left.length !== right.length || left.some((entry, index) => entry !== right[index])) {
    throw new Error("Adapter release output does not exactly match its manifest");
  }
}

export async function assertAdapterReleaseBoundary(destinationRoot, expectedEntries = null) {
  const root = path.resolve(destinationRoot);
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Adapter release root must be a real directory");
  const files = await walkRelease(root);
  if (expectedEntries) assertExactEntries(files, expectedEntries);
  for (const file of files) {
    const bytes = await fs.readFile(path.join(root, file));
    if (hasThemeMediaMagic(bytes)) {
      throw new Error(`Adapter release contains media or a nested installable package: ${file}`);
    }
  }
  const ownership = await inspectOwnership(root, { distribution: true });
  if (!ownership.allowed) {
    throw new Error(`Adapter release violates theme ownership: ${ownership.violations[0]?.code ?? "unknown"}`);
  }
  return files;
}

export async function assembleAdapterRelease(destinationRoot, { sourceRoot = projectRoot } = {}) {
  const { root: source, manifest, entries, identity } = await loadAdapterReleaseManifest(sourceRoot);
  const destination = await prepareDestination(destinationRoot, source);
  let totalBytes = 0;
  for (const { entry, segments } of entries) {
    const sourceFile = await validateSourcePath(source, segments, entry);
    const { bytes, mode } = await readStableSource(sourceFile, entry);
    totalBytes += bytes.length;
    if (totalBytes > MAX_RELEASE_BYTES) throw new Error("Adapter release exceeds its fixed size budget");
    const output = path.join(destination, ...segments);
    if (!contained(destination, output)) throw new Error(`Adapter release destination escaped its root: ${entry}`);
    await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    await fs.writeFile(output, bytes, { flag: "wx", mode });
    await fs.chmod(output, mode);
  }
  const files = await assertAdapterReleaseBoundary(destination, manifest.entries);
  return {
    kind: "mac-codex-adapter.release",
    revision: 1,
    adapterId: identity.adapterId,
    adapterVersion: identity.adapterVersion,
    adapterReleaseRevision: identity.adapterReleaseRevision,
    os: identity.os,
    arch: identity.arch,
    assetIdentity: identity.assetIdentity,
    files: files.length,
    bytes: totalBytes,
  };
}

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  const destination = process.argv[2];
  if (destination === "describe") {
    const { identity } = await loadAdapterReleaseManifest();
    process.stdout.write(`${JSON.stringify({ kind: "mac-codex-adapter.release-identity", revision: 1, ...identity })}\n`);
  } else {
    if (!destination) throw new Error("Usage: adapter-release.mjs <describe|empty-output-directory>");
    const result = await assembleAdapterRelease(path.resolve(destination));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
