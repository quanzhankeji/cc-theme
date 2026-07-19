import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const THEME_PET_MANIFEST_PATH = "pet/pet.json";
export const THEME_PET_SPRITESHEET_PATH = "pet/spritesheet.webp";
export const PET_SPRITESHEET_FILE = "spritesheet.webp";
export const PET_SPRITE_VERSION = 2;
export const PET_ATLAS_WIDTH = 1536;
export const PET_ATLAS_HEIGHT = 2288;
export const PET_ATLAS_COLUMNS = 8;
export const PET_ATLAS_ROWS = 11;
export const PET_CELL_WIDTH = 192;
export const PET_CELL_HEIGHT = 208;
export const MAX_PET_MANIFEST_BYTES = 64 * 1024;
export const MAX_PET_ATLAS_BYTES = 20 * 1024 * 1024;

const THEME_REFERENCE_KEYS = new Set(["manifest", "spritesheet", "installPolicy", "selectionPolicy"]);
const PET_MANIFEST_KEYS = new Set(["id", "displayName", "description", "spriteVersionNumber", "spritesheetPath"]);

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function assertAllowedKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}`);
}

function safeText(value, name, maximum, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`${label} ${name} must be a non-empty string no longer than ${maximum} characters`);
  }
  if ([...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029;
  })) throw new Error(`${label} ${name} contains control characters`);
  if (/(?:https?:\/\/|javascript:|<script|\.asar)/i.test(value)) {
    throw new Error(`${label} ${name} contains a forbidden resource or executable reference`);
  }
  return value.trim();
}

export function expectedThemePetId(themeId) {
  if (typeof themeId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(themeId)) {
    throw new Error("Theme id is invalid for a namespaced pet");
  }
  const normalized = themeId.toLowerCase();
  return normalized.startsWith("skin-") ? normalized : `skin-${normalized}`;
}

export function normalizeThemePetReference(value, themeId, label = "Theme config") {
  if (value === undefined || value === null) return null;
  const pet = plainObject(value);
  if (!pet) throw new Error(`${label} pet must be an object`);
  assertAllowedKeys(pet, THEME_REFERENCE_KEYS, `${label} pet`);
  if (pet.manifest !== THEME_PET_MANIFEST_PATH) {
    throw new Error(`${label} pet.manifest must be ${THEME_PET_MANIFEST_PATH}`);
  }
  if (pet.spritesheet !== THEME_PET_SPRITESHEET_PATH) {
    throw new Error(`${label} pet.spritesheet must be ${THEME_PET_SPRITESHEET_PATH}`);
  }
  if (pet.installPolicy !== undefined && pet.installPolicy !== "if-absent") {
    throw new Error(`${label} pet.installPolicy must be if-absent`);
  }
  if (pet.selectionPolicy !== undefined && pet.selectionPolicy !== "manual") {
    throw new Error(`${label} pet.selectionPolicy must be manual`);
  }
  return {
    manifest: THEME_PET_MANIFEST_PATH,
    spritesheet: THEME_PET_SPRITESHEET_PATH,
    installPolicy: "if-absent",
    selectionPolicy: "manual",
    expectedId: expectedThemePetId(themeId),
  };
}

export function validatePetManifest(value, expectedId, label = "Theme pet manifest") {
  const manifest = plainObject(value);
  if (!manifest) throw new Error(`${label} must be an object`);
  assertAllowedKeys(manifest, PET_MANIFEST_KEYS, label);
  if (manifest.id !== expectedId || !/^skin-[a-z0-9_-]{1,80}$/.test(manifest.id)) {
    throw new Error(`${label} id must be the namespaced id ${expectedId}`);
  }
  const displayName = safeText(manifest.displayName, "displayName", 80, label);
  const description = safeText(manifest.description, "description", 280, label);
  if (manifest.spriteVersionNumber !== PET_SPRITE_VERSION) {
    throw new Error(`${label} spriteVersionNumber must be ${PET_SPRITE_VERSION}`);
  }
  if (manifest.spritesheetPath !== PET_SPRITESHEET_FILE) {
    throw new Error(`${label} spritesheetPath must be ${PET_SPRITESHEET_FILE}`);
  }
  return {
    id: expectedId,
    displayName,
    description,
    spriteVersionNumber: PET_SPRITE_VERSION,
    spritesheetPath: PET_SPRITESHEET_FILE,
  };
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function uint24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function uint32LE(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function parseLosslessDimensions(chunk, label) {
  if (chunk.length < 5 || chunk[0] !== 0x2f) throw new Error(`${label} has an invalid VP8L image header`);
  const width = 1 + (chunk[1] | ((chunk[2] & 0x3f) << 8));
  const height = 1 + ((chunk[2] >> 6) | (chunk[3] << 2) | ((chunk[4] & 0x0f) << 10));
  return { width, height, alpha: (chunk[4] & 0x10) !== 0 };
}

function parseLossyDimensions(chunk, label) {
  if (chunk.length < 10 || chunk[3] !== 0x9d || chunk[4] !== 0x01 || chunk[5] !== 0x2a) {
    throw new Error(`${label} has an invalid VP8 image header`);
  }
  return {
    width: (chunk[6] | (chunk[7] << 8)) & 0x3fff,
    height: (chunk[8] | (chunk[9] << 8)) & 0x3fff,
  };
}

export function inspectV2PetAtlas(value, label = "Theme pet spritesheet") {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (bytes.length < 30 || bytes.length > MAX_PET_ATLAS_BYTES) {
    throw new Error(`${label} has an invalid file size`);
  }
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    throw new Error(`${label} must be a WebP file`);
  }
  const declaredSize = uint32LE(bytes, 4) + 8;
  if (declaredSize !== bytes.length) throw new Error(`${label} has an invalid RIFF size`);

  let offset = 12;
  let canvas = null;
  let image = null;
  let hasAlphaChunk = false;
  let hasAlphaFlag = false;
  let animated = false;
  const chunkNames = [];
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error(`${label} has a truncated WebP chunk header`);
    const name = ascii(bytes, offset, 4);
    const length = uint32LE(bytes, offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) throw new Error(`${label} has a truncated ${name} chunk`);
    const chunk = bytes.subarray(start, end);
    chunkNames.push(name);
    if (name === "VP8X") {
      if (canvas || chunk.length !== 10) throw new Error(`${label} has an invalid VP8X chunk`);
      hasAlphaFlag = (chunk[0] & 0x10) !== 0;
      animated = (chunk[0] & 0x02) !== 0;
      canvas = { width: 1 + uint24LE(chunk, 4), height: 1 + uint24LE(chunk, 7) };
    } else if (name === "VP8L") {
      if (image) throw new Error(`${label} contains multiple WebP image payloads`);
      image = parseLosslessDimensions(chunk, label);
    } else if (name === "VP8 ") {
      if (image) throw new Error(`${label} contains multiple WebP image payloads`);
      image = parseLossyDimensions(chunk, label);
    } else if (name === "ALPH") {
      hasAlphaChunk = true;
    } else if (name === "ANIM" || name === "ANMF") {
      animated = true;
    }
    offset = end + (length % 2);
  }
  if (offset !== bytes.length || !image) throw new Error(`${label} has an incomplete WebP payload`);
  const width = canvas?.width ?? image.width;
  const height = canvas?.height ?? image.height;
  if (image.width !== width || image.height !== height) throw new Error(`${label} canvas and image dimensions disagree`);
  if (width !== PET_ATLAS_WIDTH || height !== PET_ATLAS_HEIGHT) {
    throw new Error(`${label} must be ${PET_ATLAS_WIDTH}x${PET_ATLAS_HEIGHT}, received ${width}x${height}`);
  }
  if (animated) throw new Error(`${label} must be a static WebP atlas`);
  const alpha = image.alpha === true || (hasAlphaFlag && hasAlphaChunk);
  if (!alpha) throw new Error(`${label} must decode as RGBA with an alpha channel`);
  if (width / PET_ATLAS_COLUMNS !== PET_CELL_WIDTH || height / PET_ATLAS_ROWS !== PET_CELL_HEIGHT) {
    throw new Error(`${label} does not match the ${PET_ATLAS_COLUMNS}x${PET_ATLAS_ROWS} v2 grid`);
  }
  return {
    format: "WEBP",
    mode: "RGBA",
    width,
    height,
    columns: PET_ATLAS_COLUMNS,
    rows: PET_ATLAS_ROWS,
    cellWidth: PET_CELL_WIDTH,
    cellHeight: PET_CELL_HEIGHT,
    chunkNames,
  };
}

export async function validateV2PetAtlasFile(filePath, label = "Theme pet spritesheet") {
  let stdout;
  try {
    ({ stdout } = await execFile("/usr/bin/sips", [
      "-g", "format",
      "-g", "pixelWidth",
      "-g", "pixelHeight",
      "-g", "hasAlpha",
      filePath,
    ], { maxBuffer: 64 * 1024 }));
  } catch {
    throw new Error(`${label} could not be decoded as a WebP image`);
  }
  const field = (name) => stdout.match(new RegExp(`\\b${name}:\\s*([^\\r\\n]+)`, "i"))?.[1]?.trim().toLowerCase();
  const width = Number(field("pixelWidth"));
  const height = Number(field("pixelHeight"));
  if (field("format") !== "webp" || width !== PET_ATLAS_WIDTH || height !== PET_ATLAS_HEIGHT || field("hasAlpha") !== "yes") {
    throw new Error(`${label} must decode as RGBA WebP ${PET_ATLAS_WIDTH}x${PET_ATLAS_HEIGHT}`);
  }
  return { format: "WEBP", mode: "RGBA", width, height };
}

export function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
