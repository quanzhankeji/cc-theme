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
const stageScript = path.join(root, "scripts", "stage-theme.mjs");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-theme-stage-"));

function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function staticWebp(width, height, extra = []) {
  const vp8x = Buffer.alloc(10);
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const body = Buffer.concat([Buffer.from("WEBP"), chunk("VP8X", vp8x), ...extra]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, 4, "ascii");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

async function stage(source, destination) {
  await fs.mkdir(destination);
  const { stdout } = await execFile(process.execPath, [stageScript, source, destination]);
  return JSON.parse(stdout);
}

try {
  const source = path.join(temporary, "directional");
  const destination = path.join(temporary, "stage");
  await fs.mkdir(source);
  await writeSyntheticImage(path.join(source, "background.png"));
  const atlas = staticWebp(1600, 800);
  await fs.writeFile(path.join(source, "directions.webp"), atlas);
  await fs.writeFile(path.join(source, "theme.json"), `${JSON.stringify({
    kind: "skin.theme",
    id: "directional-stage",
    image: "background.png",
    interactiveBackground: {
      type: "directional", atlas: "directions.webp", directions: 16, columns: 4, rows: 4,
    },
  })}\n`);
  const result = await stage(source, destination);
  assert.deepEqual(result.media, ["background.png", "directions.webp"]);
  assert.equal(result.interactiveBackground.atlas.frameWidth, 400);
  assert.deepEqual(await fs.readFile(path.join(destination, "directions.webp")), atlas);
  await fs.writeFile(path.join(source, "directions.webp"), Buffer.from("changed"));
  assert.deepEqual(await fs.readFile(path.join(destination, "directions.webp")), atlas);

  const symlinkSource = path.join(temporary, "symlink");
  await fs.mkdir(symlinkSource);
  await writeSyntheticImage(path.join(symlinkSource, "background.png"));
  await fs.symlink(path.join(destination, "directions.webp"), path.join(symlinkSource, "directions.webp"));
  await fs.writeFile(path.join(symlinkSource, "theme.json"), `${JSON.stringify({
    kind: "skin.theme", id: "symlink", image: "background.png",
    interactiveBackground: { type: "directional", atlas: "directions.webp", directions: 8, columns: 8, rows: 1 },
  })}\n`);
  await assert.rejects(stage(symlinkSource, path.join(temporary, "symlink-stage")), /symbolic link/);

  const animatedSource = path.join(temporary, "animated");
  await fs.mkdir(animatedSource);
  await writeSyntheticImage(path.join(animatedSource, "background.png"));
  await fs.writeFile(path.join(animatedSource, "directions.webp"), staticWebp(1600, 800, [chunk("ANIM", Buffer.alloc(6))]));
  await fs.writeFile(path.join(animatedSource, "theme.json"), `${JSON.stringify({
    kind: "skin.theme", id: "animated", image: "background.png",
    interactiveBackground: { type: "directional", atlas: "directions.webp", directions: 16, columns: 4, rows: 4 },
  })}\n`);
  await assert.rejects(stage(animatedSource, path.join(temporary, "animated-stage")), /must be a static WebP/);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("PASS: WorkBuddy theme staging snapshots and validates directional media without following symlinks.");
