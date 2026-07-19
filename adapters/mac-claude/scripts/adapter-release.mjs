import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const manifestRelativePath = "contracts/adapter-release-manifest.json";
const forbiddenDirectoryNames = new Set([
  "docs", "fixtures", "generator", "presets", "release", "runtime", "skills",
  "tests", "theme-sources", "themes",
]);
const forbiddenExtensions = new Set([
  ".7z", ".aac", ".avif", ".bin", ".bmp", ".bz2", ".cctheme", ".flac",
  ".gif", ".glsl", ".gz", ".heic", ".jpeg", ".jpg", ".m4a", ".m4v",
  ".metal", ".mov", ".mp3", ".mp4", ".ogg", ".opus", ".png", ".rar",
  ".tar", ".tif", ".tiff", ".tgz", ".wasm", ".wav", ".webm", ".webp",
  ".wgsl", ".xz", ".zip",
]);
const forbiddenThemeKinds = new Set([
  "cc-theme.unified-theme", "skin.document", "skin.package", "skin.preset-source", "skin.theme",
]);
const allowedRootFiles = new Set(["LICENSE", "VERSION", "package.json"]);
const allowedTopLevelDirectories = new Set(["assets", "compatibility", "contracts", "scripts"]);
const requiredRuntimeFiles = new Set([
  "assets/background-effects.js",
  "assets/renderer-inject.js",
  "assets/skin.css",
  "assets/ui-interpreter.js",
  "compatibility/claude-macos/1.22209.3/host-evidence.json",
  "compatibility/claude-macos/1.22209.3/ui-surface-catalog.json",
  "contracts/adapter-capability.json",
  manifestRelativePath,
  "contracts/skin-theme.schema.json",
  "contracts/theme-style-catalog.json",
  "scripts/adapter-capability.mjs",
  "scripts/adapter-release.mjs",
  "scripts/diagnostic-preview-server.mjs",
  "scripts/diagnostic-preview.mjs",
  "scripts/injector.mjs",
  "scripts/project-unified-theme.mjs",
  "scripts/skin-theme.mjs",
  "scripts/start-diagnostic-preview-macos.sh",
  "scripts/stop-diagnostic-preview-macos.sh",
]);

function assertContained(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) return;
  throw new Error(`${label} escaped its trusted root`);
}

function normalizeEntry(relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath) || relativePath.includes("\\")) {
    throw new Error("Adapter release manifest entries must be non-empty POSIX relative paths");
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Adapter release manifest contains an unsafe path: ${relativePath}`);
  }
  const topLevel = segments[0];
  if (segments.length === 1 ? !allowedRootFiles.has(topLevel) : !allowedTopLevelDirectories.has(topLevel)) {
    throw new Error(`Adapter release manifest contains a path outside the runtime allowlist: ${relativePath}`);
  }
  const forbidden = segments.find((segment) => forbiddenDirectoryNames.has(segment.toLowerCase()));
  if (forbidden) throw new Error(`Adapter release manifest contains forbidden directory ${forbidden}: ${relativePath}`);
  if (forbiddenExtensions.has(path.extname(relativePath).toLowerCase()) || path.basename(relativePath).toLowerCase() === "theme.json") {
    throw new Error(`Adapter release manifest contains production theme content: ${relativePath}`);
  }
  return segments.join(path.sep);
}

function hasForbiddenFileMagic(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return true;
  if (bytes.length >= 8 && bytes.subarray(4, 8).toString("ascii") === "ftyp") return true;
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return true;
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    [[0x03, 0x04], [0x05, 0x06], [0x07, 0x08]].some(([a, b]) => bytes[2] === a && bytes[3] === b);
}

async function readManifest(sourceRoot) {
  const { source: file } = await assertRegularSourcePath(sourceRoot, manifestRelativePath.split("/").join(path.sep));
  const manifest = JSON.parse(await fs.readFile(file, "utf8"));
  if (manifest?.kind !== "claude-adapter.release-manifest" || manifest?.revision !== 1 ||
      manifest?.adapterId !== "mac-claude" || manifest?.adapterVersion !== "1.22209.3" ||
      manifest?.adapterReleaseRevision !== 1 || manifest?.os !== "macos" || manifest?.arch !== "arm64" ||
      manifest?.releaseStatus !== "development-unpublished" || manifest?.developmentOverwriteAllowed !== true ||
      manifest?.immutableAfterFirstPublication !== true ||
      manifest?.projectStatus !== "preserved-source" || manifest?.managerRegistrationStatus !== "paused" ||
      manifest?.managerDistributionAllowed !== false ||
      manifest?.runtimeApplyAvailable !== false || !Array.isArray(manifest.entries)) {
    throw new Error("Invalid Claude Adapter release manifest");
  }
  const entries = manifest.entries.map(normalizeEntry);
  if (!entries.length || new Set(entries).size !== entries.length) throw new Error("Claude Adapter release manifest entries must be non-empty and unique");
  const sorted = [...entries].sort();
  if (JSON.stringify(entries) !== JSON.stringify(sorted)) throw new Error("Claude Adapter release manifest entries must be sorted");
  for (const required of requiredRuntimeFiles) {
    if (!entries.includes(required.split("/").join(path.sep))) throw new Error(`Claude Adapter release manifest is missing runtime file: ${required}`);
  }
  return { manifest, entries };
}

async function assertRegularSourcePath(sourceRoot, relativePath) {
  let current = sourceRoot;
  for (const segment of relativePath.split(path.sep)) {
    current = path.join(current, segment);
    const metadata = await fs.lstat(current);
    if (metadata.isSymbolicLink()) throw new Error(`Adapter release entry must not be a symbolic link: ${relativePath}`);
  }
  const metadata = await fs.lstat(current);
  if (!metadata.isFile()) throw new Error(`Adapter release entry must be a regular file: ${relativePath}`);
  return { source: current, metadata };
}

async function copyEntry(sourceRoot, destinationRoot, relativePath) {
  const source = path.resolve(sourceRoot, relativePath);
  const destination = path.resolve(destinationRoot, relativePath);
  assertContained(sourceRoot, source, "Release source");
  assertContained(destinationRoot, destination, "Release destination");
  const { metadata } = await assertRegularSourcePath(sourceRoot, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  await fs.chmod(destination, metadata.mode & 0o777);
}

async function walkFiles(root, relative = "") {
  const files = [];
  for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const next = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Adapter release contains a symbolic link: ${next}`);
    if (entry.isDirectory()) files.push(...await walkFiles(root, next));
    else if (entry.isFile()) files.push(next);
    else throw new Error(`Adapter release contains a non-regular entry: ${next}`);
  }
  return files;
}

async function assertProjectionOnly(destinationRoot) {
  const capability = JSON.parse(await fs.readFile(path.join(destinationRoot, "contracts", "adapter-capability.json"), "utf8"));
  if (capability?.adapterId !== "mac-claude" || capability?.availability?.status !== "projection-only" ||
      capability?.availability?.runtimeApplyAvailable !== false || capability?.availability?.managerApplyAllowed !== false ||
      capability?.availability?.projectionAvailable !== true || capability?.availability?.diagnosticPreviewAvailable !== true) {
    throw new Error("Claude Adapter runtime release must remain projection-only with runtime apply disabled");
  }
}

export async function assertAdapterReleaseBoundary(destinationRoot, expectedEntries = null) {
  const root = path.resolve(destinationRoot);
  const files = await walkFiles(root);
  for (const file of files) {
    normalizeEntry(file.split(path.sep).join("/"));
    const bytes = await fs.readFile(path.join(root, file));
    if (hasForbiddenFileMagic(bytes)) throw new Error(`Adapter release contains media or a nested installable package: ${file}`);
    if (path.extname(file).toLowerCase() === ".json") {
      try {
        const value = JSON.parse(bytes.toString("utf8"));
        if (forbiddenThemeKinds.has(value?.kind)) throw new Error(`Adapter release contains a production theme document: ${file}`);
      } catch (error) {
        if (error?.message?.startsWith("Adapter release contains")) throw error;
      }
    }
  }
  const sortedFiles = [...files].sort();
  if (expectedEntries) {
    const expected = [...expectedEntries].sort();
    if (JSON.stringify(sortedFiles) !== JSON.stringify(expected)) throw new Error("Claude Adapter release output does not exactly match its manifest");
  }
  await assertProjectionOnly(root);
  return sortedFiles;
}

export async function assembleAdapterRelease(destinationRoot, { sourceRoot = projectRoot } = {}) {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  const sourceMetadata = await fs.lstat(source);
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()) throw new Error("Claude Adapter source root must be a real directory");
  assertContained(source, path.join(source, manifestRelativePath), "Release manifest");
  const destinationRelativeToSource = path.relative(source, destination);
  if (destinationRelativeToSource === "" || (!path.isAbsolute(destinationRelativeToSource) && destinationRelativeToSource !== ".." && !destinationRelativeToSource.startsWith(`..${path.sep}`))) {
    throw new Error("Claude Adapter release destination must be outside the source tree");
  }
  try {
    await fs.lstat(destination);
    throw new Error("Claude Adapter release destination already exists");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const { entries } = await readManifest(source);
  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  const staging = path.join(parent, `.${path.basename(destination)}.assembling-${process.pid}-${randomUUID()}`);
  await fs.mkdir(staging, { mode: 0o700 });
  try {
    for (const entry of entries) await copyEntry(source, staging, entry);
    const files = await assertAdapterReleaseBoundary(staging, entries);
    await fs.rename(staging, destination);
    return files;
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  const destination = process.argv[2];
  if (!destination || process.argv.length !== 3) throw new Error("Usage: adapter-release.mjs <destination>");
  fs.readFile(path.join(projectRoot, manifestRelativePath), "utf8")
    .then(JSON.parse)
    .then((manifest) => {
      if (manifest?.managerRegistrationStatus === "paused" || manifest?.managerDistributionAllowed !== true) {
        throw new Error("Mac-Claude Manager registration is paused; runtime Engine delivery is disabled");
      }
      return assembleAdapterRelease(destination);
    })
    .then((files) => process.stdout.write(`${JSON.stringify({
      kind: "claude-adapter.release",
      adapterId: "mac-claude",
      adapterVersion: "1.22209.3",
      adapterReleaseRevision: 1,
      releaseStatus: "development-unpublished",
      os: "macos",
      arch: "arm64",
      runtimeApplyAvailable: false,
      files: files.length,
    })}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
