#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

import { validateThemeFamily } from "../../app/packages/shared-core/compiler.mjs";

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/;
const SAFE_ASSET = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp|mp4)$/i;
const SAFE_LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const MAX_ASSET_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const CONTENT_TYPES = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
});

function fail(message) {
  throw new Error(`CC Theme package: ${message}`);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(`${label} contains unsupported fields: ${unknown.sort().join(", ")}`);
}

function boundedString(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) fail(`${label} is invalid`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function contentTypeFor(filename) {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? fail(`unsupported asset type: ${filename}`);
}

function hasMediaSignature(bytes, contentType) {
  if (contentType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/webp") return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (contentType === "video/mp4") return bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  return false;
}

function validateMetadata(metadata) {
  object(metadata, "family.metadata");
  exactKeys(metadata, ["author", "defaultLocale", "locales", "previewAsset", "license", "assetLicense"], "family.metadata");
  boundedString(metadata.author, "family.metadata.author", 120);
  boundedString(metadata.license, "family.metadata.license", 80);
  boundedString(metadata.assetLicense, "family.metadata.assetLicense", 80);
  if (!SAFE_LOCALE.test(metadata.defaultLocale)) fail("family.metadata.defaultLocale is invalid");
  if (!SAFE_ASSET.test(metadata.previewAsset) || path.basename(metadata.previewAsset) !== metadata.previewAsset) fail("family.metadata.previewAsset must be a safe image basename");
  if (!/\.(?:png|jpe?g|webp)$/i.test(metadata.previewAsset)) fail("family.metadata.previewAsset must be an image");
  const locales = object(metadata.locales, "family.metadata.locales");
  for (const required of ["zh-CN", "en-US"]) if (!Object.hasOwn(locales, required)) fail(`family.metadata.locales requires ${required}`);
  if (Object.keys(locales).length > 24) fail("family.metadata.locales has too many entries");
  for (const [locale, display] of Object.entries(locales)) {
    if (!SAFE_LOCALE.test(locale)) fail(`invalid locale: ${locale}`);
    object(display, `family.metadata.locales.${locale}`);
    exactKeys(display, ["name", "description"], `family.metadata.locales.${locale}`);
    boundedString(display.name, `family.metadata.locales.${locale}.name`, 120);
    boundedString(display.description, `family.metadata.locales.${locale}.description`, 500);
  }
  if (!Object.hasOwn(locales, metadata.defaultLocale)) fail("family.metadata.defaultLocale must exist in locales");
}

function collectAssetRoles(theme, previewAsset) {
  const background = theme.sharedCore.background;
  const roles = new Map();
  const add = (filename, role) => {
    if (!filename) return;
    if (!SAFE_ASSET.test(filename) || path.basename(filename) !== filename) fail(`unsafe asset binding: ${filename}`);
    const current = roles.get(filename) ?? new Set();
    current.add(role);
    roles.set(filename, current);
  };
  add(background.image, "background");
  add(background.homeHeroImage, "home-hero");
  add(background.video, "video");
  add(background.atlas, "atlas");
  add(previewAsset, "preview");
  return roles;
}

async function readJson(file, label) {
  let value;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch {
    fail(`${label} is not valid JSON`);
  }
  return value;
}

async function regularFile(file, label) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) fail(`${label} is missing or not a regular file`);
  return info;
}

export async function buildThemePackage(themeDirectory) {
  const root = path.resolve(themeDirectory);
  const familyFile = path.join(root, "family.json");
  const sourceFile = path.join(root, "unified-theme.json");
  const assetsRoot = path.join(root, "assets");
  await regularFile(familyFile, "family.json");
  await regularFile(sourceFile, "unified-theme.json");
  const assetsInfo = await stat(assetsRoot).catch(() => null);
  if (!assetsInfo?.isDirectory()) fail("assets must be a directory");

  const family = object(await readJson(familyFile, "family.json"), "family");
  exactKeys(family, ["kind", "schemaVersion", "id", "version", "minimumManagerVersion", "metadata", "source", "assets", "signatures"], "family");
  if (family.kind !== "cc-theme.theme-family-package" || family.schemaVersion !== 1) fail("family.json must use cc-theme.theme-family-package schemaVersion 1");
  if (!SAFE_ID.test(family.id)) fail("family.id is invalid");
  if (!SAFE_VERSION.test(family.version) || !SAFE_VERSION.test(family.minimumManagerVersion)) fail("family version is invalid");
  if (family.signatures?.length) fail("source changed after signing; remove signatures and sign the completed manifest again");
  validateMetadata(family.metadata);

  const theme = await readJson(sourceFile, "unified-theme.json");
  validateThemeFamily(theme);
  if (theme.id !== family.id || theme.version !== family.version) fail("family.json and unified-theme.json identity/version must match");

  const sourceBytes = await readFile(sourceFile);
  const rolesByName = collectAssetRoles(theme, family.metadata.previewAsset);
  const actualNames = (await readdir(assetsRoot)).sort();
  if (!actualNames.length || actualNames.length > 64) fail("assets must contain 1 to 64 files");
  if (actualNames.some((name) => !rolesByName.has(name)) || [...rolesByName.keys()].some((name) => !actualNames.includes(name))) {
    fail("assets must exactly match Unified Theme bindings and metadata.previewAsset");
  }

  let totalBytes = sourceBytes.length;
  const archiveEntries = [{ name: "unified-theme.json", bytes: sourceBytes }];
  const assets = [];
  for (const name of actualNames) {
    if (!SAFE_ASSET.test(name) || path.basename(name) !== name) fail(`unsafe asset filename: ${name}`);
    const file = path.join(assetsRoot, name);
    const info = await regularFile(file, `asset ${name}`);
    if (info.size < 1 || info.size > MAX_ASSET_BYTES) fail(`asset size is invalid: ${name}`);
    totalBytes += info.size;
    if (totalBytes > MAX_TOTAL_BYTES) fail("uncompressed package exceeds 256 MiB");
    const bytes = await readFile(file);
    const contentType = contentTypeFor(name);
    if (!hasMediaSignature(bytes, contentType)) fail(`asset content does not match its extension: ${name}`);
    assets.push({
      path: `assets/${name}`,
      bytes: bytes.length,
      sha256: sha256(bytes),
      contentType,
      roles: [...rolesByName.get(name)].sort(),
    });
    archiveEntries.push({ name: `assets/${name}`, bytes });
  }

  const manifest = {
    kind: family.kind,
    schemaVersion: family.schemaVersion,
    id: family.id,
    version: family.version,
    minimumManagerVersion: family.minimumManagerVersion,
    metadata: family.metadata,
    source: { path: "unified-theme.json", bytes: sourceBytes.length, sha256: sha256(sourceBytes) },
    assets,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  archiveEntries.unshift({ name: "family.json", bytes: manifestBytes });
  return { root, manifest, manifestBytes, archiveEntries };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function localHeader(entry, offset) {
  const name = Buffer.from(entry.name, "utf8");
  const compressed = deflateRawSync(entry.bytes, { level: 9 });
  const method = compressed.length < entry.bytes.length ? 8 : 0;
  const payload = method === 8 ? compressed : entry.bytes;
  const crc = crc32(entry.bytes);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(payload.length, 18);
  header.writeUInt32LE(entry.bytes.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return { name, payload, crc, method, offset, compressedSize: payload.length, size: entry.bytes.length, local: Buffer.concat([header, name, payload]) };
}

function centralHeader(entry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(33, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.name]);
}

export function createDeterministicZip(entries) {
  let offset = 0;
  const prepared = entries.map((entry) => {
    const value = localHeader(entry, offset);
    offset += value.local.length;
    return value;
  });
  const local = Buffer.concat(prepared.map((entry) => entry.local));
  const central = Buffer.concat(prepared.map(centralHeader));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(prepared.length, 8);
  end.writeUInt16LE(prepared.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([local, central, end]);
}

export async function packTheme(themeDirectory, outputFile) {
  const built = await buildThemePackage(themeDirectory);
  const destination = outputFile
    ? path.resolve(outputFile)
    : path.resolve(built.root, "..", "dist", `${built.manifest.id}-${built.manifest.version}.cctheme`);
  if (path.extname(destination).toLowerCase() !== ".cctheme") fail("output filename must end in .cctheme");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(path.join(built.root, "family.json"), built.manifestBytes);
  const archive = createDeterministicZip(built.archiveEntries);
  await writeFile(destination, archive);
  return { destination, bytes: archive.length, sha256: sha256(archive), manifest: built.manifest };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , themeDirectory, outputFile] = process.argv;
  if (!themeDirectory) {
    process.stderr.write("Usage: node themes/tools/pack-theme.mjs <theme-directory> [output.cctheme]\n");
    process.exitCode = 2;
  } else {
    packTheme(themeDirectory, outputFile)
      .then((result) => process.stdout.write(`${JSON.stringify({
        status: "ok",
        kind: "cc-theme.package-build-result",
        schemaVersion: 1,
        output: result.destination,
        bytes: result.bytes,
        sha256: result.sha256,
        theme: { id: result.manifest.id, version: result.manifest.version },
      }, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      });
  }
}
