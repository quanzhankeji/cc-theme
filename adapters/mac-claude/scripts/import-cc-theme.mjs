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
  MAC_CLAUDE_ADAPTER_ID,
  MAC_CLAUDE_CONTRACT,
  MAC_CLAUDE_TARGET_PATH,
  SKIN_PACKAGE_KIND,
  themeMediaNames,
} from "./skin-theme.mjs";
import { MAX_PACKAGE_BYTES, MAX_PACKAGE_ENTRIES } from "./media-limits.mjs";

const execFile = promisify(execFileCallback);
const here = path.dirname(fileURLToPath(import.meta.url));
const blockedExtensions = /\.(?:exe|dll|dmg|pkg|msi|asar|js|mjs|cjs|html?|svg|css|sh|ps1|bat|cmd|app|glsl|wgsl|metal|wasm|bin|zip|tar|tgz|gz|bz2|xz|7z|rar|mov|webm|m4v|avif|bmp)$/i;
const hexColor = /^#[0-9a-f]{6}$/i;
const safeFont = /^[\p{L}\p{N} ._-]{1,80}$/u;

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
    else if (stat.isFile()) result.push({
      path: path.relative(root, absolute).split(path.sep).join("/"),
      absolute,
      size: stat.size,
    });
    else throw new Error(`Archive contains an unsupported entry: ${entry.name}`);
  }
  return result;
}

async function parseJson(file, label) {
  const bytes = await fs.readFile(file);
  if (bytes.length > 1024 * 1024 || bytes.includes(0)) throw new Error(`${label} is not a safe JSON file`);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON`);
  }
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function boundedNumber(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a number from ${minimum} to ${maximum}`);
  }
  return value;
}

function rgba(hex, opacity) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return `rgba(${channels.join(", ")}, ${Math.round(opacity * 1000) / 1000})`;
}

// A portable package contains both the editable skin.document and the compiled
// skin.theme Adapter. Reapply allowlisted document values after package
// integrity has been verified so user-authored data survives export -> import
// without accepting executable input.
function mergeDocumentEdits(theme, document, manifest) {
  if (!plainObject(document) || document.kind !== "skin.document") throw new Error("Theme document does not use the skin.document contract");
  if (document.id !== theme.id || document.id !== manifest.id) throw new Error("Package theme identity mismatch");
  if (document.application !== "claude" || document.platform !== "macos") {
    throw new Error("Package theme document target mismatch");
  }
  if (document.appVersion !== undefined) throw new Error("Theme documents must not carry a Claude appVersion");
  const tokens = plainObject(document.tokens);
  if (!tokens) throw new Error("Theme document tokens are missing");
  const colorKeys = ["background", "panel", "panelAlt", "accent", "accentAlt", "secondary", "highlight", "text", "muted", "line"];
  const colors = {};
  for (const key of colorKeys) {
    if (!hexColor.test(tokens[key] ?? "")) throw new Error(`Theme document token ${key} is invalid`);
    colors[key] = tokens[key];
  }
  for (const key of ["actionForeground", "success", "danger"]) {
    if (!hexColor.test(tokens[key] ?? "")) throw new Error(`Theme document token ${key} is invalid`);
  }
  const fonts = {};
  for (const [target, source] of [["ui", "uiFont"], ["display", "displayFont"], ["code", "codeFont"]]) {
    if (typeof tokens[source] !== "string" || !safeFont.test(tokens[source])) throw new Error(`Theme document token ${source} is invalid`);
    fonts[target] = [tokens[source]];
  }
  const radiusScale = boundedNumber(tokens.radiusScale, "Theme document radiusScale", 0.75, 1.5);
  const shellOpacity = boundedNumber(tokens.shellOpacity, "Theme document shellOpacity", 35, 100);
  const backdropBlurPx = boundedNumber(tokens.backdropBlurPx, "Theme document backdropBlurPx", 0, 48);
  const adapterValue = plainObject(document.adapters)?.macos;
  if (adapterValue !== undefined && !plainObject(adapterValue)) throw new Error("Theme document Mac adapter settings are invalid");
  const adapter = adapterValue ?? {
    shellMode: "auto",
    backgroundVideoPosterMode: "none",
    backdropSaturation: 1,
  };
  if (!plainObject(adapter)
      || !["auto", "light", "dark"].includes(adapter.shellMode)
      || !["none", "image"].includes(adapter.backgroundVideoPosterMode)
  ) {
    throw new Error("Theme document Mac adapter settings are invalid");
  }
  const backdropSaturation = boundedNumber(adapter.backdropSaturation, "Theme document backdropSaturation", 0.5, 1.5);

  return {
    ...theme,
    colors: { ...(plainObject(theme.colors) ?? {}), ...colors },
    semanticColors: {
      ...(plainObject(theme.semanticColors) ?? {}),
      actionForeground: tokens.actionForeground,
      success: tokens.success,
      danger: tokens.danger,
      composerSurface: rgba(tokens.panelAlt, shellOpacity / 100),
    },
    fonts: { ...(plainObject(theme.fonts) ?? {}), ...fonts },
    appearance: {
      ...(plainObject(theme.appearance) ?? {}),
      shellMode: adapter.shellMode,
      ...(theme.backgroundVideo ? { backgroundVideoPosterMode: adapter.backgroundVideoPosterMode } : {}),
      backdropBlurPx,
      backdropSaturation,
      radiusScale,
    },
  };
}

async function validatePackage(extractedRoot) {
  const extracted = await walkFiles(extractedRoot);
  if (extracted.length < 4 || extracted.length > MAX_PACKAGE_ENTRIES) throw new Error("Package has an invalid entry count");
  if (extracted.some((file) => !safeArchivePath(file.path))) throw new Error("Package contains an unsafe path");
  if (extracted.reduce((total, file) => total + file.size, 0) > MAX_PACKAGE_BYTES) throw new Error("Package is too large after extraction");

  const byPath = new Map(extracted.map((file) => [file.path, file]));
  const manifestFile = byPath.get("manifest.json");
  if (!manifestFile) throw new Error("Package is missing manifest.json");
  const manifest = await parseJson(manifestFile.absolute, "Package manifest");
  if (manifest?.kind !== SKIN_PACKAGE_KIND || manifest?.target?.application !== "claude" || manifest?.target?.platform !== "macos") {
    throw new Error("Package does not target Claude for macOS");
  }
  const capabilityVersion = manifest.target.capabilityVersion ?? null;
  if (manifest.target.version !== undefined || manifest.target.claudeVersion !== undefined) {
    throw new Error("Client-version package migration is unsupported; use the Mac-Claude capability contract");
  }
  if (capabilityVersion !== "1.0.0") {
    throw new Error("Package does not target the Mac-Claude capability 1.0.0 contract");
  }
  if (!Array.isArray(manifest.adapters) || manifest.adapters.length !== 1) {
    throw new Error("Package must contain exactly one canonical Mac-Claude adapter");
  }
  const adapter = manifest.adapters[0];
  if (adapter?.id !== MAC_CLAUDE_ADAPTER_ID) {
    throw new Error("Package does not use the canonical Mac-Claude adapter id");
  }
  if (!adapter || adapter.contract !== MAC_CLAUDE_CONTRACT || adapter.status !== "compiled" || adapter.targetPath !== MAC_CLAUDE_TARGET_PATH) {
    throw new Error("Package does not contain the required compiled Mac-Claude adapter");
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

  const targetConfig = byPath.get(MAC_CLAUDE_TARGET_PATH);
  if (!targetConfig) throw new Error("Compiled macOS theme is missing");
  const sourceDocumentFile = byPath.get("theme.json");
  if (!sourceDocumentFile) throw new Error("Package is missing theme.json");
  const sourceDocument = await parseJson(sourceDocumentFile.absolute, "Theme document");
  let theme = await parseJson(targetConfig.absolute, "Compiled macOS theme");
  assertSkinThemeIdentity(theme, "Compiled macOS theme");
  theme = mergeDocumentEdits(theme, sourceDocument, manifest);
  assertSkinThemeIdentity(theme, "Compiled macOS theme");
  if (theme.pet !== undefined || [...byPath.keys()].some((entry) => entry.startsWith("targets/macos/pet/"))) {
    throw new Error("Claude Desktop theme packages do not support pet bundles");
  }
  if (typeof theme.image !== "string" || path.basename(theme.image) !== theme.image) throw new Error("Compiled macOS theme image is invalid");
  const targetRoot = path.dirname(targetConfig.absolute);
  if (!byPath.has(`targets/macos/${theme.image}`)) throw new Error("Compiled macOS theme image is missing");
  if (theme.homeHeroImage && (!/^[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp)$/i.test(theme.homeHeroImage) || !byPath.has(`targets/macos/${theme.homeHeroImage}`))) {
    throw new Error("Compiled macOS home hero image is invalid or missing");
  }
  if (theme.backgroundVideo && (!/^[A-Za-z0-9_.-]+\.mp4$/i.test(theme.backgroundVideo) || !byPath.has(`targets/macos/${theme.backgroundVideo}`))) {
    throw new Error("Compiled macOS background video is invalid or missing");
  }
  if (theme.interactiveBackground?.type === "directional") {
    const atlasPath = `targets/macos/${theme.interactiveBackground.atlas}`;
    const atlasEntry = manifest.files.find((file) => file.path === atlasPath);
    if (!/^[A-Za-z0-9_.-]+\.webp$/i.test(theme.interactiveBackground.atlas) ||
        !byPath.has(atlasPath) || atlasEntry?.mediaType !== "image/webp") {
      throw new Error("Compiled macOS directional background atlas is invalid or missing");
    }
  }
  const allowedPayloadPaths = new Set([
    "manifest.json",
    "theme.json",
    MAC_CLAUDE_TARGET_PATH,
    ...themeMediaNames(theme, "Compiled macOS theme").map((name) => `targets/macos/${name}`),
  ]);
  for (const packagePath of byPath.keys()) {
    if (!allowedPayloadPaths.has(packagePath)) {
      throw new Error(`Package contains undeclared or unreferenced payload: ${packagePath}`);
    }
  }
  await fs.writeFile(targetConfig.absolute, `${JSON.stringify(theme, null, 2)}\n`, { mode: 0o600 });
  return {
    manifest, theme, targetRoot, capabilityVersion,
  };
}

async function installTheme(sourceRoot, activeThemeRoot, theme) {
  const parent = path.dirname(activeThemeRoot);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const staging = path.join(parent, `.${path.basename(activeThemeRoot)}.importing.${process.pid}.${randomUUID()}`);
  const previous = path.join(parent, `.${path.basename(activeThemeRoot)}.previous.${process.pid}.${randomUUID()}`);
  const destination = activeThemeRoot;
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
    } catch (error) {
      if (hadPrevious) await fs.rename(previous, destination).catch(() => {});
      throw error;
    }
    // The new theme is committed at this point. A stale
    // backup must not turn a successful import into an ambiguous failure; it is
    // safer to preserve that recoverable directory for a later cleanup.
    if (hadPrevious) await fs.rm(previous, { recursive: true, force: true }).catch(() => {});
    return { destination };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    // A leftover previous directory is deliberate if rollback itself failed:
    // preserving recoverable user data is safer than deleting the backup.
  }
}

async function main() {
  const packageArg = valueFor("file");
  const activeThemeRootArg = valueFor("active-theme-root");
  if (!packageArg || !activeThemeRootArg) {
    throw new Error("Usage: import-cc-theme.mjs --file <theme.cctheme> --active-theme-root <active-theme-dir>");
  }
  const packagePath = path.resolve(packageArg);
  const activeThemeRoot = path.resolve(activeThemeRootArg);
  if (!packagePath.toLowerCase().endsWith(CC_THEME_FILE_EXTENSION)) throw new Error(`Theme package must use the ${CC_THEME_FILE_EXTENSION} extension`);
  const packageStat = await fs.stat(packagePath);
  if (!packageStat.isFile() || packageStat.size < 1 || packageStat.size > MAX_PACKAGE_BYTES) throw new Error("Theme package size is invalid");

  const { stdout } = await execFile("/usr/bin/unzip", ["-Z1", packagePath], { maxBuffer: 1024 * 1024 });
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  if (entries.length < 4 || entries.length > MAX_PACKAGE_ENTRIES || entries.some((entry) => !safeArchivePath(entry))) throw new Error("Theme archive contains unsafe entries");

  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-import-"));
  try {
    await execFile("/usr/bin/ditto", ["-x", "-k", packagePath, temporary]);
    const { theme, targetRoot, capabilityVersion } = await validatePackage(temporary);
    const { destination } = await installTheme(targetRoot, activeThemeRoot, theme);
    process.stdout.write(JSON.stringify({
      id: theme.id,
      name: theme.name,
      capabilityVersion,
      adapter: MAC_CLAUDE_ADAPTER_ID,
      destination,
    }));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

await main();
