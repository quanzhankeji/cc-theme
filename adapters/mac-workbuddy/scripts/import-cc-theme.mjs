import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto, { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assertSkinThemeIdentity,
  CC_THEME_FILE_EXTENSION,
  MAC_WORKBUDDY_ADAPTER_ID,
  MAC_WORKBUDDY_CONTRACT,
  MAC_WORKBUDDY_TARGET_PATH,
  normalizeSkinTheme,
  SKIN_PACKAGE_KIND,
} from "./skin-theme.mjs";
import { withAdapterTransaction } from "./adapter-transaction.mjs";
import { themeRuntimeBaseHash } from "./theme-runtime-settings.mjs";
import {
  MAX_DIRECTIONAL_ATLAS_BYTES,
  MAX_IMAGE_BYTES,
  MAX_PACKAGE_BYTES,
  MAX_VIDEO_BYTES,
} from "./media-limits.mjs";

const execFile = promisify(execFileCallback);
const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_PACKAGE_ENTRIES = 20;
const blockedExtensions = /\.(?:exe|dll|dmg|pkg|msi|asar|js|mjs|cjs|html?|svg|css|sh|ps1|bat|cmd|app)$/i;

function valueFor(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
  return value;
}

function safeArchivePath(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("\\")
    && !value.endsWith("/") && !value.split("/").includes("..")
    && ![...value].some((character) => character.codePointAt(0) < 32)
    && !blockedExtensions.test(value);
}

async function fileSha256(file) {
  const hash = crypto.createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

async function walkFiles(root, directory = root) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Archive contains a symbolic link: ${entry.name}`);
    if (stat.isDirectory()) result.push(...await walkFiles(root, absolute));
    else if (stat.isFile()) result.push({ path: path.relative(root, absolute).split(path.sep).join("/"), absolute, size: stat.size });
    else throw new Error(`Archive contains an unsupported entry: ${entry.name}`);
  }
  return result;
}

async function parseJson(file, label) {
  const bytes = await fs.readFile(file);
  if (bytes.length < 2 || bytes.length > 1024 * 1024 || bytes.includes(0)) throw new Error(`${label} is not a safe JSON file`);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON`);
  }
}

function mediaEntry(manifest, byPath, targetRoot, fileName, expectedType, maximum) {
  if (typeof fileName !== "string" || path.basename(fileName) !== fileName) throw new Error("Compiled WorkBuddy media filename is invalid");
  const packagePath = `${targetRoot}/${fileName}`;
  const listed = manifest.files.find((file) => file.path === packagePath);
  const extracted = byPath.get(packagePath);
  if (!listed || !extracted || listed.mediaType !== expectedType || extracted.size < 1 || extracted.size > maximum) {
    throw new Error(`Compiled WorkBuddy media is missing or invalid: ${fileName}`);
  }
}

async function validatePackage(extractedRoot, requestedClientVersion) {
  const extracted = await walkFiles(extractedRoot);
  if (extracted.length < 4 || extracted.length > MAX_PACKAGE_ENTRIES) throw new Error("Package has an invalid entry count");
  if (extracted.some((file) => !safeArchivePath(file.path))) throw new Error("Package contains an unsafe path");
  if (extracted.reduce((total, file) => total + file.size, 0) > MAX_PACKAGE_BYTES) throw new Error("Package is too large after extraction");

  const byPath = new Map(extracted.map((file) => [file.path, file]));
  const manifestFile = byPath.get("manifest.json");
  if (!manifestFile) throw new Error("Package is missing manifest.json");
  const manifest = await parseJson(manifestFile.absolute, "Package manifest");
  if (manifest?.kind !== SKIN_PACKAGE_KIND || manifest?.target?.application !== "workbuddy" || manifest?.target?.platform !== "macos") {
    throw new Error("Package does not target WorkBuddy for macOS");
  }
  if (requestedClientVersion && manifest.target.version !== requestedClientVersion) {
    throw new Error(`Package targets WorkBuddy ${manifest.target.version}, but this Mac has ${requestedClientVersion}`);
  }
  const adapter = manifest.adapters?.find((candidate) => candidate?.id === MAC_WORKBUDDY_ADAPTER_ID);
  if (!adapter || adapter.contract !== MAC_WORKBUDDY_CONTRACT || adapter.status !== "compiled" || adapter.targetPath !== MAC_WORKBUDDY_TARGET_PATH) {
    throw new Error("Package does not contain the required compiled Mac WorkBuddy adapter");
  }
  if (!Array.isArray(manifest.files) || manifest.integrity?.algorithm !== "sha256") throw new Error("Package manifest is incomplete");
  const listed = new Set(["manifest.json"]);
  for (const file of manifest.files) {
    if (!safeArchivePath(file?.path) || listed.has(file.path)) throw new Error("Package manifest contains an invalid or duplicate path");
    const extractedFile = byPath.get(file.path);
    if (!extractedFile || extractedFile.size !== file.size) throw new Error(`Package size mismatch: ${file.path}`);
    if (await fileSha256(extractedFile.absolute) !== manifest.integrity.files?.[file.path]) throw new Error(`Package integrity mismatch: ${file.path}`);
    listed.add(file.path);
  }
  if (listed.size !== byPath.size || [...byPath.keys()].some((file) => !listed.has(file))) throw new Error("Package contains unlisted files");

  const targetConfig = byPath.get(MAC_WORKBUDDY_TARGET_PATH);
  if (!targetConfig) throw new Error("Compiled WorkBuddy theme is missing");
  const theme = await parseJson(targetConfig.absolute, "Compiled WorkBuddy theme");
  assertSkinThemeIdentity(theme, "Compiled WorkBuddy theme");
  const normalized = normalizeSkinTheme(theme, "Compiled WorkBuddy theme");
  const targetRoot = path.posix.dirname(MAC_WORKBUDDY_TARGET_PATH);
  const imageType = /\.png$/i.test(theme.image) ? "image/png" : /\.webp$/i.test(theme.image) ? "image/webp" : /\.jpe?g$/i.test(theme.image) ? "image/jpeg" : null;
  if (!imageType) throw new Error("Compiled WorkBuddy image type is invalid");
  mediaEntry(manifest, byPath, targetRoot, theme.image, imageType, MAX_IMAGE_BYTES);
  if (theme.backgroundVideo) mediaEntry(manifest, byPath, targetRoot, theme.backgroundVideo, "video/mp4", MAX_VIDEO_BYTES);
  if (normalized.interactiveBackground?.type === "directional") {
    mediaEntry(
      manifest,
      byPath,
      targetRoot,
      normalized.interactiveBackground.atlas,
      "image/webp",
      MAX_DIRECTIONAL_ATLAS_BYTES,
    );
  }
  if (theme.pet || theme.homeHeroImage) throw new Error("WorkBuddy packages cannot contain Codex-only pet or Hero fields");
  return { manifest, theme: normalized, sourceRoot: path.dirname(targetConfig.absolute) };
}

async function installTheme(sourceRoot, themesRoot, theme) {
  const adapterStateRoot = path.basename(themesRoot) === "themes" ? path.dirname(themesRoot) : themesRoot;
  return withAdapterTransaction(theme.id, { root: adapterStateRoot }, async (transaction) => {
    await fs.mkdir(themesRoot, { recursive: true, mode: 0o700 });
    const staging = path.join(themesRoot, `.${theme.id}.importing.${process.pid}.${randomUUID()}`);
    const previous = path.join(themesRoot, `.${theme.id}.previous.${process.pid}.${randomUUID()}`);
    const destination = path.join(themesRoot, theme.id);
    await fs.mkdir(staging, { mode: 0o700 });
    try {
      await execFile(process.execPath, [path.join(here, "stage-theme.mjs"), sourceRoot, staging]);
      await execFile(process.execPath, [path.join(here, "injector.mjs"), "--check-payload", "--theme-dir", staging]);
      let hadPrevious = false;
      try {
        await fs.rename(destination, previous);
        hadPrevious = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      try {
        await fs.rename(staging, destination);
        await transaction.writeBase(themeRuntimeBaseHash(theme));
      } catch (error) {
        await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
        if (hadPrevious) await fs.rename(previous, destination).catch(() => {});
        throw error;
      }
      if (hadPrevious) await fs.rm(previous, { recursive: true, force: true }).catch(() => {});
      return destination;
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  });
}

async function main() {
  const packageArg = valueFor("file");
  const themesRootArg = valueFor("themes-root");
  const clientVersion = valueFor("client-version");
  if (!packageArg || !themesRootArg) throw new Error("Usage: import-cc-theme.mjs --file <theme.cctheme> --themes-root <saved-themes-dir> [--client-version <version>]");
  const packagePath = path.resolve(packageArg);
  const themesRoot = path.resolve(themesRootArg);
  if (!packagePath.endsWith(CC_THEME_FILE_EXTENSION)) throw new Error(`Theme package must use the lowercase ${CC_THEME_FILE_EXTENSION} extension`);
  const packageStat = await fs.stat(packagePath);
  if (!packageStat.isFile() || packageStat.size < 1 || packageStat.size > MAX_PACKAGE_BYTES) throw new Error("Theme package size is invalid");

  const { stdout } = await execFile("/usr/bin/unzip", ["-Z1", packagePath], { maxBuffer: 1024 * 1024 });
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  if (entries.length < 4 || entries.length > MAX_PACKAGE_ENTRIES || entries.some((entry) => !safeArchivePath(entry))) throw new Error("Theme archive contains unsafe entries");

  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-skin-import-"));
  try {
    await execFile("/usr/bin/ditto", ["-x", "-k", packagePath, temporary]);
    const { manifest, theme, sourceRoot } = await validatePackage(temporary, clientVersion);
    const destination = await installTheme(sourceRoot, themesRoot, theme);
    process.stdout.write(JSON.stringify({
      id: theme.id,
      name: theme.name,
      targetVersion: manifest.target.version,
      adapter: MAC_WORKBUDDY_ADAPTER_ID,
      destination,
    }));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

await main();
