import assert from "node:assert/strict";
import { syntheticPng } from "./fixtures/synthetic-media.mjs";
import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  classifyImageDimensions,
  readImageMetadata,
} from "../scripts/image-metadata.mjs";

const fixture = syntheticPng(2560, 1440);
assert.deepEqual(readImageMetadata(fixture, ".png"), {
  width: 2560,
  height: 1440,
  ratio: 2560 / 1440,
  wide: true,
  aspect: "wide",
  taskMode: "ambient",
});

const malformedPng = Buffer.from(fixture);
malformedPng[0] = 0;
assert.equal(readImageMetadata(malformedPng, ".png"), null);
assert.deepEqual(classifyImageDimensions({ width: 3200, height: 2000 }), {
  width: 3200,
  height: 2000,
  ratio: 1.6,
  wide: false,
  aspect: "wide",
  taskMode: "ambient",
});
assert.equal(MAX_IMAGE_DIMENSION, 16384);
assert.equal(MAX_IMAGE_PIXELS, 50_000_000);
assert.equal(classifyImageDimensions({ width: 10000, height: 6000 }), null);
assert.equal(classifyImageDimensions({ width: 20000, height: 1 }), null);
assert.equal(classifyImageDimensions({ width: 2560.5, height: 1440 }), null);

console.log("PASS: image metadata validates supported dimensions and rejects unsafe profiles.");
