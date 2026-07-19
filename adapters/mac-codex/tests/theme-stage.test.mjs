import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { neutralAtlasFixture, writeSyntheticPng } from "./helpers/media-fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const stageScript = path.join(root, "scripts", "stage-theme.mjs");
const tempRoot = await fs.mkdtemp(path.join("/tmp", "cc-theme-stage-"));
const fixtureAsset = path.join(tempRoot, "neutral-background.png");
const directionalAtlas = neutralAtlasFixture;
await writeSyntheticPng(fixtureAsset, { width: 1600, height: 900 });

function runStage(source, stage) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [stageScript, source, stage], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `stage-theme exited with ${code}`)));
  });
}

try {
  const source = path.join(tempRoot, "themes", "complete");
  const stage = path.join(tempRoot, "stage");
  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(stage);
  await fs.copyFile(fixtureAsset, path.join(source, "background.png"));
  await fs.copyFile(fixtureAsset, path.join(source, "hero.png"));
  const mp4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]);
  await fs.writeFile(path.join(source, "ambient.mp4"), mp4);
  await fs.writeFile(path.join(source, "theme.json"), `${JSON.stringify({
    kind: "skin.theme",
    id: "complete",
    image: "background.png",
    homeHeroImage: "hero.png",
    backgroundVideo: "ambient.mp4",
  })}\n`);

  const result = JSON.parse(await runStage(source, stage));
  assert.deepEqual(result.media, ["background.png", "hero.png", "ambient.mp4"]);
  const backgroundBeforeMutation = await fs.readFile(path.join(stage, "background.png"));
  await fs.writeFile(path.join(source, "background.png"), Buffer.from("changed-after-stage"));
  await fs.writeFile(path.join(source, "theme.json"), `${JSON.stringify({ kind: "skin.theme", id: "other", image: "other.png" })}\n`);
  assert.deepEqual(await fs.readFile(path.join(stage, "background.png")), backgroundBeforeMutation);
  assert.equal(JSON.parse(await fs.readFile(path.join(stage, "theme.json"), "utf8")).image, "background.png");

  const directionalSource = path.join(tempRoot, "themes", "directional");
  const directionalStage = path.join(tempRoot, "directional-stage");
  await fs.mkdir(directionalSource, { recursive: true });
  await fs.mkdir(directionalStage);
  await fs.copyFile(fixtureAsset, path.join(directionalSource, "fallback.png"));
  await fs.copyFile(directionalAtlas, path.join(directionalSource, "directions.webp"));
  await fs.writeFile(path.join(directionalSource, "theme.json"), `${JSON.stringify({
    kind: "skin.theme",
    id: "directional",
    image: "fallback.png",
    interactiveBackground: {
      type: "directional",
      atlas: "directions.webp",
      directions: 16,
      columns: 4,
      rows: 4,
    },
  })}\n`);
  const directionalResult = JSON.parse(await runStage(directionalSource, directionalStage));
  assert.deepEqual(directionalResult.media, ["fallback.png", "directions.webp"]);
  assert.deepEqual(directionalResult.interactiveBackground.atlas, {
    width: 1536,
    height: 2288,
    pixels: 3514368,
    frameWidth: 384,
    frameHeight: 572,
    directions: 16,
    columns: 4,
    rows: 4,
  });
  assert.deepEqual(await fs.readFile(path.join(directionalStage, "directions.webp")), await fs.readFile(directionalAtlas));

  const outside = path.join(tempRoot, "outside.png");
  await fs.copyFile(fixtureAsset, outside);
  const traversal = path.join(tempRoot, "traversal");
  await fs.mkdir(traversal);
  await fs.writeFile(path.join(traversal, "theme.json"), `${JSON.stringify({ kind: "skin.theme", id: "traversal", image: "../outside.png" })}\n`);
  const traversalStage = path.join(tempRoot, "traversal-stage");
  await fs.mkdir(traversalStage);
  await assert.rejects(runStage(traversal, traversalStage), /inside its theme directory/);

  const symlink = path.join(tempRoot, "symlink");
  await fs.mkdir(symlink);
  await fs.symlink(outside, path.join(symlink, "background.png"));
  await fs.writeFile(path.join(symlink, "theme.json"), `${JSON.stringify({ kind: "skin.theme", id: "symlink", image: "background.png" })}\n`);
  const symlinkStage = path.join(tempRoot, "symlink-stage");
  await fs.mkdir(symlinkStage);
  await assert.rejects(runStage(symlink, symlinkStage), /symbolic link/);

  const atlasSymlink = path.join(tempRoot, "atlas-symlink");
  const atlasSymlinkStage = path.join(tempRoot, "atlas-symlink-stage");
  await fs.mkdir(atlasSymlink);
  await fs.mkdir(atlasSymlinkStage);
  await fs.copyFile(fixtureAsset, path.join(atlasSymlink, "fallback.png"));
  await fs.symlink(directionalAtlas, path.join(atlasSymlink, "directions.webp"));
  await fs.writeFile(path.join(atlasSymlink, "theme.json"), `${JSON.stringify({
    kind: "skin.theme",
    id: "atlas-symlink",
    image: "fallback.png",
    interactiveBackground: {
      type: "directional", atlas: "directions.webp", directions: 16, columns: 4, rows: 4,
    },
  })}\n`);
  await assert.rejects(runStage(atlasSymlink, atlasSymlinkStage), /symbolic link/);

  const animatedSource = path.join(tempRoot, "animated-atlas");
  const animatedStage = path.join(tempRoot, "animated-atlas-stage");
  await fs.mkdir(animatedSource);
  await fs.mkdir(animatedStage);
  await fs.copyFile(fixtureAsset, path.join(animatedSource, "fallback.png"));
  const animated = Buffer.concat([
    Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"),
    Buffer.from("ANIM"), Buffer.from([6, 0, 0, 0]), Buffer.alloc(6),
  ]);
  animated.writeUInt32LE(animated.length - 8, 4);
  await fs.writeFile(path.join(animatedSource, "directions.webp"), animated);
  await fs.writeFile(path.join(animatedSource, "theme.json"), `${JSON.stringify({
    kind: "skin.theme",
    id: "animated-atlas",
    image: "fallback.png",
    interactiveBackground: {
      type: "directional", atlas: "directions.webp", directions: 16, columns: 4, rows: 4,
    },
  })}\n`);
  await assert.rejects(runStage(animatedSource, animatedStage), /must be a static WebP/);

  console.log("PASS: theme staging snapshots a stable image, Hero, video, and config bundle.");
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
