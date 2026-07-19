import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { writeSyntheticImage } from "./helpers/synthetic-theme.mjs";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const injector = path.join(root, "scripts", "injector.mjs");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-interactive-injector-"));

function staticWebp(width, height) {
  const vp8x = Buffer.alloc(10);
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write("VP8X", 0, 4, "ascii");
  chunkHeader.writeUInt32LE(vp8x.length, 4);
  const body = Buffer.concat([Buffer.from("WEBP"), chunkHeader, vp8x]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, 4, "ascii");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

async function check(directory) {
  const { stdout } = await execFile(process.execPath, [injector, "--check-payload", "--theme-dir", directory]);
  return JSON.parse(stdout);
}

try {
  await writeSyntheticImage(path.join(temporary, "background.png"));
  await fs.writeFile(path.join(temporary, "theme.json"), `${JSON.stringify({
    kind: "skin.theme",
    id: "ripple-injector",
    image: "background.png",
    interactiveBackground: { type: "ripple" },
    appearance: { paletteStrategy: "system" },
  })}\n`);
  const ripple = await check(temporary);
  assert.equal(ripple.pass, true);
  assert.equal(ripple.backgroundRenderMode, "ripple");
  assert.equal(ripple.videoEnabled, false);
  assert.equal(ripple.interactiveAtlasBytes, 0);

  await fs.writeFile(path.join(temporary, "directions.webp"), staticWebp(1600, 800));
  await fs.writeFile(path.join(temporary, "theme.json"), `${JSON.stringify({
    kind: "skin.theme",
    id: "directional-injector",
    image: "background.png",
    interactiveBackground: {
      type: "directional",
      atlas: "directions.webp",
      directions: 16,
      columns: 4,
      rows: 4,
    },
  })}\n`);
  const directional = await check(temporary);
  assert.equal(directional.pass, true);
  assert.equal(directional.backgroundRenderMode, "directional");
  assert.equal(directional.interactiveAtlasBytes, 30);
  assert.deepEqual(directional.interactiveAtlasMetadata, {
    width: 1600,
    height: 800,
    pixels: 1_280_000,
    frameWidth: 400,
    frameHeight: 200,
    directions: 16,
    columns: 4,
    rows: 4,
  });
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("PASS: WorkBuddy injector builds ripple and deferred directional payloads with the fixed engine.");
