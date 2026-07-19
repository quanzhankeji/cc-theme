import assert from "node:assert/strict";
import { directionalFrameForPointer, inspectDirectionalAtlas } from "../scripts/interactive-background.mjs";

function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function staticWebp(width, height, extraChunks = []) {
  const vp8x = Buffer.alloc(10);
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const body = Buffer.concat([Buffer.from("WEBP"), chunk("VP8X", vp8x), ...extraChunks]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

const config = {
  directions: 16,
  columns: 4,
  rows: 4,
  firstDirectionDegrees: -90,
  idleFrame: 0,
  origin: { xPercent: 50, yPercent: 50 },
};
assert.deepEqual(inspectDirectionalAtlas(staticWebp(1600, 800), config), {
  width: 1600,
  height: 800,
  pixels: 1_280_000,
  frameWidth: 400,
  frameHeight: 200,
  directions: 16,
  columns: 4,
  rows: 4,
});

const viewport = { width: 1000, height: 800 };
assert.equal(directionalFrameForPointer(config, { x: 500, y: 0 }, viewport), 0);
assert.equal(directionalFrameForPointer(config, { x: 1000, y: 400 }, viewport), 4);
assert.equal(directionalFrameForPointer(config, { x: 500, y: 800 }, viewport), 8);
assert.equal(directionalFrameForPointer(config, { x: 0, y: 400 }, viewport), 12);
assert.equal(directionalFrameForPointer(config, { x: 500, y: 400 }, viewport), 0);

assert.throws(
  () => inspectDirectionalAtlas(staticWebp(1601, 800), config),
  /dimensions must divide evenly/,
);
assert.throws(
  () => inspectDirectionalAtlas(staticWebp(8000, 5000), {
    ...config, directions: 8, columns: 8, rows: 1,
  }),
  /exceeds the directional atlas dimension or pixel limit/,
);
assert.throws(
  () => inspectDirectionalAtlas(staticWebp(1600, 800, [chunk("ANIM", Buffer.alloc(6))]), config),
  /must be a static WebP/,
);
assert.throws(() => inspectDirectionalAtlas(Buffer.from("not-webp"), config), /not a WebP image/);

console.log("PASS: directional atlas dimensions, animation, grid, limits, and pointer mapping are validated.");
