import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { neutralAtlasFixture, writeSyntheticPng } from "./helpers/media-fixtures.mjs";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const injector = path.join(root, "scripts", "injector.mjs");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-interactive-injector-"));

async function check(directory) {
  const { stdout } = await execFile(process.execPath, [
    injector, "--check-payload", "--theme-dir", directory,
  ]);
  return JSON.parse(stdout);
}

try {
  await writeSyntheticPng(path.join(temporary, "background.png"), { width: 1600, height: 900 });
  await fs.writeFile(path.join(temporary, "theme.json"), `${JSON.stringify({
    kind: "skin.theme",
    id: "ripple-injector",
    name: "Ripple Injector",
    image: "background.png",
    interactiveBackground: { type: "ripple" },
  })}\n`);
  const ripple = await check(temporary);
  assert.equal(ripple.pass, true);
  assert.equal(ripple.backgroundRenderMode, "ripple");
  assert.equal(ripple.videoEnabled, false);
  assert.equal(ripple.interactiveAtlasBytes, 0);

  await fs.copyFile(
    neutralAtlasFixture,
    path.join(temporary, "directions.webp"),
  );
  await fs.writeFile(path.join(temporary, "theme.json"), `${JSON.stringify({
    kind: "skin.theme",
    id: "directional-injector",
    name: "Directional Injector",
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
  assert.equal(directional.interactiveAtlasBytes > 0, true);
  assert.deepEqual(directional.interactiveAtlasMetadata, {
    width: 1536,
    height: 2288,
    pixels: 3514368,
    frameWidth: 384,
    frameHeight: 572,
    directions: 16,
    columns: 4,
    rows: 4,
  });
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("PASS: injector payloads load ripple locally and defer a validated directional atlas outside the script body.");
