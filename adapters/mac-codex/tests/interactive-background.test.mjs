import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  directionalFrameForPointer,
  inspectDirectionalAtlas,
} from "../scripts/interactive-background.mjs";
import { neutralAtlasFixture } from "./helpers/media-fixtures.mjs";

const atlasBytes = await fs.readFile(neutralAtlasFixture);
const config = {
  directions: 16,
  columns: 4,
  rows: 4,
  firstDirectionDegrees: -90,
  idleFrame: 0,
  origin: { xPercent: 50, yPercent: 50 },
};

const atlas = inspectDirectionalAtlas(atlasBytes, config, "Test atlas");
assert.deepEqual(atlas, {
  width: 1536,
  height: 2288,
  pixels: 3514368,
  frameWidth: 384,
  frameHeight: 572,
  directions: 16,
  columns: 4,
  rows: 4,
});

const viewport = { width: 1000, height: 800 };
assert.equal(directionalFrameForPointer(config, { x: 500, y: 0 }, viewport), 0, "north is frame zero");
assert.equal(directionalFrameForPointer(config, { x: 1000, y: 400 }, viewport), 4, "east is one quarter turn");
assert.equal(directionalFrameForPointer(config, { x: 500, y: 800 }, viewport), 8, "south is one half turn");
assert.equal(directionalFrameForPointer(config, { x: 0, y: 400 }, viewport), 12, "west is three quarter turns");
assert.equal(directionalFrameForPointer(config, { x: 500, y: 400 }, viewport), 0, "origin uses idle frame");

assert.throws(
  () => inspectDirectionalAtlas(atlasBytes, { ...config, columns: 3 }, "Bad grid"),
  /columns × rows must equal directions/,
);

const animated = Buffer.concat([
  Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"),
  Buffer.from("ANIM"), Buffer.from([6, 0, 0, 0]), Buffer.alloc(6),
]);
animated.writeUInt32LE(animated.length - 8, 4);
assert.throws(() => inspectDirectionalAtlas(animated, config, "Animated atlas"), /must be a static WebP/);

const uneven = Buffer.from(atlasBytes);
const unevenBits = uneven.readUInt32LE(21);
uneven.writeUInt32LE((unevenBits & ~0x3fff) | (1535 - 1), 21);
assert.throws(
  () => inspectDirectionalAtlas(uneven, config, "Uneven atlas"),
  /dimensions must divide evenly/,
);

const oversized = Buffer.from(atlasBytes);
const oversizedBits = (8192 - 1) | ((4096 - 1) << 14);
oversized.writeUInt32LE(oversizedBits >>> 0, 21);
assert.throws(
  () => inspectDirectionalAtlas(oversized, config, "Oversized atlas"),
  /exceeds the directional atlas dimension or pixel limit/,
);

assert.throws(
  () => inspectDirectionalAtlas(Buffer.from("not-webp"), config, "Wrong atlas"),
  /not a WebP image/,
);

console.log("PASS: interactive backgrounds validate static atlases and map pointer directions deterministically.");
