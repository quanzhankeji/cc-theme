import { readImageMetadata } from "./image-metadata.mjs";
import {
  MAX_DIRECTIONAL_ATLAS_BYTES,
  MAX_DIRECTIONAL_ATLAS_DIMENSION,
  MAX_DIRECTIONAL_ATLAS_PIXELS,
} from "./media-limits.mjs";

function asBuffer(value, label) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new Error(`${label} must be binary WebP data`);
  }
  return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function inspectWebpChunks(bytes, label) {
  if (bytes.length < 20 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
      bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
    throw new Error(`${label} content is not a WebP image`);
  }
  const riffBytes = bytes.readUInt32LE(4) + 8;
  if (riffBytes !== bytes.length) throw new Error(`${label} has an invalid WebP container length`);
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const size = bytes.readUInt32LE(offset + 4);
    const next = offset + 8 + size + (size & 1);
    if (next > bytes.length) throw new Error(`${label} has a truncated WebP chunk`);
    if (type === "ANIM" || type === "ANMF") throw new Error(`${label} must be a static WebP`);
    offset = next;
  }
}

export function inspectDirectionalAtlas(value, config, label = "Directional background atlas") {
  const bytes = asBuffer(value, label);
  if (bytes.length < 1 || bytes.length > MAX_DIRECTIONAL_ATLAS_BYTES) {
    throw new Error(`${label} must be between 1 and ${MAX_DIRECTIONAL_ATLAS_BYTES} bytes`);
  }
  inspectWebpChunks(bytes, label);
  const metadata = readImageMetadata(bytes, ".webp");
  if (!metadata) throw new Error(`${label} has invalid WebP dimensions`);
  const { width, height } = metadata;
  const pixels = width * height;
  if (width > MAX_DIRECTIONAL_ATLAS_DIMENSION || height > MAX_DIRECTIONAL_ATLAS_DIMENSION ||
      pixels > MAX_DIRECTIONAL_ATLAS_PIXELS) {
    throw new Error(`${label} exceeds the directional atlas dimension or pixel limit`);
  }
  if (![8, 16, 32].includes(config?.directions) || !Number.isInteger(config?.columns) ||
      !Number.isInteger(config?.rows) || config.columns * config.rows !== config.directions) {
    throw new Error(`${label} columns × rows must equal directions`);
  }
  if (width % config.columns !== 0 || height % config.rows !== 0) {
    throw new Error(`${label} dimensions must divide evenly into its frame grid`);
  }
  return {
    width,
    height,
    pixels,
    frameWidth: width / config.columns,
    frameHeight: height / config.rows,
    directions: config.directions,
    columns: config.columns,
    rows: config.rows,
  };
}

function normalizedDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function shortestDegrees(left, right) {
  return Math.abs(((left - right + 540) % 360) - 180);
}

export function directionalFrameForPointer(config, pointer, viewport, previousFrame = null) {
  const directions = config.directions;
  const originX = viewport.width * (config.origin.xPercent / 100);
  const originY = viewport.height * (config.origin.yPercent / 100);
  const deltaX = pointer.x - originX;
  const deltaY = pointer.y - originY;
  if (Math.hypot(deltaX, deltaY) < 1) return config.idleFrame;
  const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
  const sector = 360 / directions;
  const relative = normalizedDegrees(angle - config.firstDirectionDegrees);
  const candidate = Math.round(relative / sector) % directions;
  if (!Number.isInteger(previousFrame) || previousFrame < 0 || previousFrame >= directions || candidate === previousFrame) {
    return candidate;
  }
  const previousCenter = normalizedDegrees(config.firstDirectionDegrees + previousFrame * sector);
  return shortestDegrees(angle, previousCenter) > sector * 0.62 ? candidate : previousFrame;
}
