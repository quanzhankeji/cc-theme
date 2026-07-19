import fs from "node:fs/promises";
import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { normalizeSkinTheme, themeMediaNames } from "./skin-theme.mjs";
import { inspectDirectionalAtlas } from "./interactive-background.mjs";
import {
  inspectV2PetAtlas,
  MAX_PET_ATLAS_BYTES,
  MAX_PET_MANIFEST_BYTES,
  normalizeThemePetReference,
  THEME_PET_MANIFEST_PATH,
  THEME_PET_SPRITESHEET_PATH,
  validateV2PetAtlasFile,
  validatePetManifest,
} from "./skin-pet.mjs";
import {
  MAX_DIRECTIONAL_ATLAS_BYTES,
  MAX_IMAGE_BYTES,
  MAX_PACKAGE_BYTES,
  MAX_TOTAL_MEDIA_BYTES,
  MAX_VIDEO_BYTES,
} from "./media-limits.mjs";

const [sourceDirArg, stageDirArg] = process.argv.slice(2);
if (!sourceDirArg || !stageDirArg) {
  throw new Error("Usage: stage-theme.mjs <source-theme-dir> <stage-dir>");
}

const MAX_CONFIG_BYTES = 1024 * 1024;
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);

function assertContained(rootPath, candidatePath, label) {
  const relative = path.relative(rootPath, candidatePath);
  if (
    relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  ) return;
  throw new Error(`${label} must stay inside its theme directory`);
}

function sameStat(left, right) {
  return left.isFile() && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function readStableFile(filePath, label, maxBytes) {
  let handle;
  try {
    handle = await fs.open(filePath, OPEN_FLAGS);
  } catch (error) {
    if (error.code === "ELOOP") throw new Error(`${label} must not be a symbolic link`);
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`${label} must be a regular file`);
    if (before.size > maxBytes) throw new Error(`${label} is larger than ${maxBytes} bytes`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameStat(before, after)) throw new Error(`${label} changed while it was being staged`);
    if (bytes.length > maxBytes) throw new Error(`${label} is larger than ${maxBytes} bytes`);
    return { bytes, stat: after };
  } finally {
    await handle.close();
  }
}

async function inspectStableFile(filePath, label, maxBytes) {
  let handle;
  try {
    handle = await fs.open(filePath, OPEN_FLAGS);
  } catch (error) {
    if (error.code === "ELOOP") throw new Error(`${label} must not be a symbolic link`);
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`${label} must be a regular file`);
    if (stat.size < 1 || stat.size > maxBytes) throw new Error(`${label} must be between 1 and ${maxBytes} bytes`);
    return stat;
  } finally {
    await handle.close();
  }
}

async function copyStableFile(sourcePath, destination, label, expectedStat, maxBytes) {
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(sourcePath, OPEN_FLAGS);
    const before = await handle.stat();
    if (!sameStat(before, expectedStat) || before.size > maxBytes) throw new Error(`${label} changed before it was staged`);
    await pipeline(
      createReadStream(sourcePath, { fd: handle.fd, autoClose: false }),
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    );
    const after = await handle.stat();
    if (!sameStat(before, after)) throw new Error(`${label} changed while it was being staged`);
    await fs.rename(temporary, destination);
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function decodeJson(bytes, label) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) throw new Error(`${label} contains NUL characters`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function mediaName(value, label, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${label} is required`);
    return null;
  }
  if (typeof value !== "string" || path.basename(value) !== value || value === "theme.json") {
    throw new Error(`${label} must stay inside its theme directory`);
  }
  const hasControl = [...value].some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029;
  });
  if (hasControl) throw new Error(`${label} contains control characters`);
  return value;
}

async function writeExclusive(filePath, bytes) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function main() {
  const sourceRoot = await fs.realpath(sourceDirArg);
  if (!(await fs.stat(sourceRoot)).isDirectory()) throw new Error("Theme source must be a directory");
  const stageRoot = await fs.realpath(stageDirArg);
  if (!(await fs.stat(stageRoot)).isDirectory()) throw new Error("Theme stage must be a directory");

  const configPath = path.join(sourceRoot, "theme.json");
  const config = await readStableFile(configPath, "Theme config", MAX_CONFIG_BYTES);
  const theme = decodeJson(config.bytes, "Theme config");
  themeMediaNames(theme, "Theme config");
  const normalizedTheme = normalizeSkinTheme(theme, "Theme config");
  const petReference = normalizeThemePetReference(theme.pet, theme.id, "Theme config");
  const backgroundVideo = mediaName(theme.backgroundVideo, "Background video");
  const directionalBackground = normalizedTheme.interactiveBackground?.type === "directional"
    ? normalizedTheme.interactiveBackground : null;
  const media = [
    { name: mediaName(theme.image, "Theme image", true), maximum: MAX_IMAGE_BYTES },
    { name: mediaName(theme.homeHeroImage, "New Task Hero image"), maximum: MAX_IMAGE_BYTES },
    { name: backgroundVideo, maximum: MAX_VIDEO_BYTES },
    {
      name: mediaName(directionalBackground?.atlas, "Directional background atlas"),
      maximum: MAX_DIRECTIONAL_ATLAS_BYTES,
      directional: directionalBackground,
    },
  ].filter((entry) => entry.name);
  const uniqueMedia = [...new Map(media.map((entry) => [entry.name, entry])).values()];
  const snapshots = [];
  let totalBytes = 0;
  let directionalAtlas = null;
  for (const { name, maximum, directional } of uniqueMedia) {
    const sourcePath = path.resolve(sourceRoot, name);
    assertContained(sourceRoot, sourcePath, `Theme media ${name}`);
    const inspected = directional
      ? await readStableFile(sourcePath, "Directional background atlas", maximum)
      : null;
    const stat = inspected?.stat ?? await inspectStableFile(sourcePath, `Theme media ${name}`, maximum);
    if (inspected) directionalAtlas = inspectDirectionalAtlas(inspected.bytes, directional, "Directional background atlas");
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_MEDIA_BYTES) {
      throw new Error(`Theme media exceed the ${MAX_TOTAL_MEDIA_BYTES}-byte total asset budget`);
    }
    snapshots.push({ name, sourcePath, stat, maximum });
  }

  let pet = null;
  if (petReference) {
    const petRoot = path.resolve(sourceRoot, "pet");
    assertContained(sourceRoot, petRoot, "Theme pet directory");
    const petRootStat = await fs.lstat(petRoot);
    if (petRootStat.isSymbolicLink()) throw new Error("Theme pet directory must not be a symbolic link");
    if (!petRootStat.isDirectory()) throw new Error("Theme pet directory must be a directory");
    const petEntries = (await fs.readdir(petRoot)).sort();
    if (petEntries.length !== 2 || petEntries[0] !== "pet.json" || petEntries[1] !== "spritesheet.webp") {
      throw new Error("Theme pet directory must contain exactly pet.json and spritesheet.webp");
    }
    const manifestPath = path.resolve(sourceRoot, THEME_PET_MANIFEST_PATH);
    const spritesheetPath = path.resolve(sourceRoot, THEME_PET_SPRITESHEET_PATH);
    assertContained(sourceRoot, manifestPath, "Theme pet manifest");
    assertContained(sourceRoot, spritesheetPath, "Theme pet spritesheet");
    const manifestSnapshot = await readStableFile(manifestPath, "Theme pet manifest", MAX_PET_MANIFEST_BYTES);
    const manifest = validatePetManifest(
      decodeJson(manifestSnapshot.bytes, "Theme pet manifest"),
      petReference.expectedId,
      "Theme pet manifest",
    );
    const spritesheetSnapshot = await readStableFile(spritesheetPath, "Theme pet spritesheet", MAX_PET_ATLAS_BYTES);
    const atlas = inspectV2PetAtlas(spritesheetSnapshot.bytes, "Theme pet spritesheet");
    totalBytes += manifestSnapshot.bytes.length + spritesheetSnapshot.bytes.length;
    if (totalBytes > MAX_PACKAGE_BYTES) {
      throw new Error(`Theme bundle exceeds the ${MAX_PACKAGE_BYTES}-byte total asset budget`);
    }
    pet = {
      id: manifest.id,
      manifestBytes: manifestSnapshot.bytes,
      spritesheetBytes: spritesheetSnapshot.bytes,
      atlas,
    };
  }

  for (const { name, sourcePath, stat, maximum } of snapshots) {
    const destination = path.resolve(stageRoot, name);
    assertContained(stageRoot, destination, `Staged theme media ${name}`);
    await copyStableFile(sourcePath, destination, `Theme media ${name}`, stat, maximum);
  }
  if (pet) {
    const stagedPetRoot = path.join(stageRoot, "pet");
    await fs.mkdir(stagedPetRoot, { mode: 0o700 });
    await writeExclusive(path.join(stageRoot, THEME_PET_MANIFEST_PATH), pet.manifestBytes);
    await writeExclusive(path.join(stageRoot, THEME_PET_SPRITESHEET_PATH), pet.spritesheetBytes);
    await validateV2PetAtlasFile(path.join(stageRoot, THEME_PET_SPRITESHEET_PATH), "Theme pet spritesheet");
  }
  const stagedConfig = path.join(stageRoot, "theme.json");
  assertContained(stageRoot, stagedConfig, "Staged theme config");
  // theme.json is deliberately written last: it is also the live commit marker.
  await writeExclusive(stagedConfig, config.bytes);
  process.stdout.write(JSON.stringify({
    media: uniqueMedia.map((entry) => entry.name),
    totalBytes,
    interactiveBackground: directionalAtlas ? { type: "directional", atlas: directionalAtlas }
      : normalizedTheme.interactiveBackground ? { type: normalizedTheme.interactiveBackground.type }
        : { type: "media" },
    pet: pet ? { id: pet.id, atlas: pet.atlas } : { status: "absent" },
  }));
}

await main();
