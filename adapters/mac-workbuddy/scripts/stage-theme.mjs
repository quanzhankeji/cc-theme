import fs from "node:fs/promises";
import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { inspectDirectionalAtlas } from "./interactive-background.mjs";
import { normalizeSkinTheme, themeMediaNames } from "./skin-theme.mjs";
import {
  MAX_DIRECTIONAL_ATLAS_BYTES,
  MAX_IMAGE_BYTES,
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
  if (relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) return;
  throw new Error(`${label} must stay inside its theme directory`);
}

function sameStat(left, right) {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
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
    if (before.size < 1 || before.size > maxBytes) {
      throw new Error(`${label} must be between 1 and ${maxBytes} bytes`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameStat(before, after)) throw new Error(`${label} changed while it was being staged`);
    return { bytes, stat: after };
  } finally {
    await handle.close();
  }
}

async function copyStableFile(sourcePath, destination, label, snapshot, maxBytes) {
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(sourcePath, OPEN_FLAGS);
    const before = await handle.stat();
    if (!sameStat(before, snapshot) || before.size > maxBytes) throw new Error(`${label} changed before it was staged`);
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

function parseJson(bytes, label) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) throw new Error(`${label} contains NUL characters`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
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
  const stageRoot = await fs.realpath(stageDirArg);
  if (!(await fs.stat(sourceRoot)).isDirectory()) throw new Error("Theme source must be a directory");
  if (!(await fs.stat(stageRoot)).isDirectory()) throw new Error("Theme stage must be a directory");

  const configPath = path.join(sourceRoot, "theme.json");
  const config = await readStableFile(configPath, "Theme config", MAX_CONFIG_BYTES);
  const rawTheme = parseJson(config.bytes, "Theme config");
  themeMediaNames(rawTheme, "Theme config");
  const theme = normalizeSkinTheme(rawTheme, "Theme config");
  const entries = [
    { name: theme.image, maximum: MAX_IMAGE_BYTES, label: "Theme image" },
    ...(theme.backgroundVideo ? [{ name: theme.backgroundVideo, maximum: MAX_VIDEO_BYTES, label: "Background video" }] : []),
    ...(theme.interactiveBackground?.type === "directional" ? [{
      name: theme.interactiveBackground.atlas,
      maximum: MAX_DIRECTIONAL_ATLAS_BYTES,
      label: "Directional background atlas",
      directional: theme.interactiveBackground,
    }] : []),
  ];
  const uniqueEntries = [...new Map(entries.map((entry) => [entry.name, entry])).values()];
  const snapshots = [];
  let totalBytes = 0;
  let atlasMetadata = null;
  for (const entry of uniqueEntries) {
    if (path.basename(entry.name) !== entry.name || entry.name === "theme.json") {
      throw new Error(`${entry.label} must stay inside its theme directory`);
    }
    const sourcePath = path.resolve(sourceRoot, entry.name);
    assertContained(sourceRoot, sourcePath, entry.label);
    const loaded = await readStableFile(sourcePath, entry.label, entry.maximum);
    if (entry.directional) atlasMetadata = inspectDirectionalAtlas(loaded.bytes, entry.directional, entry.label);
    totalBytes += loaded.stat.size;
    if (totalBytes > MAX_TOTAL_MEDIA_BYTES) {
      throw new Error(`Theme media exceed the ${MAX_TOTAL_MEDIA_BYTES}-byte total asset budget`);
    }
    snapshots.push({ ...entry, sourcePath, stat: loaded.stat });
  }

  for (const entry of snapshots) {
    const destination = path.resolve(stageRoot, entry.name);
    assertContained(stageRoot, destination, `Staged ${entry.label}`);
    await copyStableFile(entry.sourcePath, destination, entry.label, entry.stat, entry.maximum);
  }
  await writeExclusive(path.join(stageRoot, "theme.json"), config.bytes);
  process.stdout.write(JSON.stringify({
    media: uniqueEntries.map((entry) => entry.name),
    totalBytes,
    interactiveBackground: atlasMetadata
      ? { type: "directional", atlas: atlasMetadata }
      : theme.interactiveBackground ? { type: theme.interactiveBackground.type } : { type: "media" },
  }));
}

await main();
