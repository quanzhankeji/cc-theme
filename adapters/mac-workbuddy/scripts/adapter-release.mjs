import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const manifestPath = path.join(projectRoot, "contracts", "adapter-release-manifest.json");
const forbiddenDirectoryNames = new Set(["presets", "themes", "theme-sources", "release", "tests", "fixtures"]);
const forbiddenExtensions = new Set([
  ".cctheme", ".gif", ".jpeg", ".jpg", ".mov", ".mp4", ".png", ".webm", ".webp",
]);
const forbiddenProductionIds = ["xt" + "xg", "wo" + "lp"];
const forbiddenPresetKind = "skin." + "preset-source";
const forbiddenThemeKinds = new Set([forbiddenPresetKind, "skin.theme", "skin.document", "skin.package"]);

function hasThemeMediaMagic(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP") return true;
  if (bytes.length >= 8 && bytes.subarray(4, 8).toString("ascii") === "ftyp") return true;
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return true;
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
      [[0x03, 0x04], [0x05, 0x06], [0x07, 0x08]].some(([a, b]) => bytes[2] === a && bytes[3] === b)) return true;
  return false;
}

function assertContained(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)) return;
  throw new Error(`${label} escaped the Adapter release root`);
}

async function copyEntry(sourceRoot, destinationRoot, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error("Adapter release manifest entries must be non-empty relative paths");
  }
  const source = path.resolve(sourceRoot, relativePath);
  const destination = path.resolve(destinationRoot, relativePath);
  assertContained(sourceRoot, source, "Release source");
  assertContained(destinationRoot, destination, "Release destination");
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Adapter release entry must not be a symbolic link: ${relativePath}`);
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    const children = (await fs.readdir(source)).sort();
    for (const child of children) await copyEntry(sourceRoot, destinationRoot, path.join(relativePath, child));
    return;
  }
  if (!stat.isFile()) throw new Error(`Adapter release entry must be a regular file: ${relativePath}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  await fs.chmod(destination, stat.mode & 0o777);
}

async function walkFiles(root, relative = "") {
  const directory = path.join(root, relative);
  const files = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error(`Adapter release contains a symbolic link: ${path.join(relative, entry.name)}`);
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, next));
    else if (entry.isFile()) files.push(next);
    else throw new Error(`Adapter release contains a non-regular entry: ${next}`);
  }
  return files;
}

export async function assertAdapterReleaseBoundary(destinationRoot) {
  const files = await walkFiles(destinationRoot);
  for (const file of files) {
    const segments = file.split(path.sep);
    const forbiddenDirectory = segments.find((segment) => forbiddenDirectoryNames.has(segment.toLowerCase()));
    if (forbiddenDirectory) throw new Error(`Adapter release contains forbidden directory: ${file}`);
    const extension = path.extname(file).toLowerCase();
    if (forbiddenExtensions.has(extension) || path.basename(file).toLowerCase() === "theme.json") {
      throw new Error(`Adapter release contains theme package content: ${file}`);
    }
    const bytes = await fs.readFile(path.join(destinationRoot, file));
    if (hasThemeMediaMagic(bytes)) {
      throw new Error(`Adapter release contains media or a nested installable package: ${file}`);
    }
    if (bytes.includes(Buffer.from(forbiddenPresetKind))) {
      throw new Error(`Adapter release contains a production preset declaration: ${file}`);
    }
    if (extension === ".json") {
      try {
        const value = JSON.parse(bytes.toString("utf8"));
        if (forbiddenThemeKinds.has(value?.kind)) {
          throw new Error(`Adapter release contains a production theme document: ${file}`);
        }
      } catch (error) {
        if (error?.message?.startsWith("Adapter release contains")) throw error;
      }
    }
    const lower = bytes.toString("utf8").toLowerCase();
    if (forbiddenProductionIds.some((id) => lower.includes(id))) {
      throw new Error(`Adapter release contains a known production theme identity: ${file}`);
    }
  }
  return files;
}

export async function assembleAdapterRelease(destinationRoot, { sourceRoot = projectRoot } = {}) {
  const raw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (raw?.kind !== "workbuddy-adapter.release-manifest" || raw?.revision !== 1 ||
      raw?.adapterId !== "mac-workbuddy" || raw?.adapterVersion !== "5.2.6" ||
      raw?.adapterReleaseRevision !== 4 || raw?.platform !== "macos" || raw?.architecture !== "arm64" ||
      raw?.assetIdentity !== "mac-workbuddy-5.2.6-r4-macos-arm64" || !Array.isArray(raw.entries)) {
    throw new Error("Invalid WorkBuddy Adapter release manifest");
  }
  await fs.mkdir(destinationRoot, { recursive: true });
  for (const entry of raw.entries) await copyEntry(path.resolve(sourceRoot), path.resolve(destinationRoot), entry);
  return assertAdapterReleaseBoundary(path.resolve(destinationRoot));
}

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  const destination = process.argv[2];
  if (!destination) throw new Error("Usage: adapter-release.mjs <destination>");
  const files = await assembleAdapterRelease(path.resolve(destination));
  console.log(JSON.stringify({ kind: "workbuddy-adapter.release", files: files.length }));
}
