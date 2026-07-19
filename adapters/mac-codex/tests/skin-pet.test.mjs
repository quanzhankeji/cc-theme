import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  inspectV2PetAtlas,
  normalizeThemePetReference,
  validatePetManifest,
} from "../scripts/skin-pet.mjs";
import {
  installThemePet,
  removeActiveThemePet,
  removeAllOwnedThemePets,
  removeOwnedThemePet,
  writeActiveTheme,
} from "../scripts/theme-pet-store.mjs";
import { neutralAtlasFixture, writeSyntheticPng } from "./helpers/media-fixtures.mjs";

const execFile = promisify(execFileCallback);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const stageScript = path.join(root, "scripts", "stage-theme.mjs");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-pet-test-"));
const backgroundFixture = path.join(temporary, "neutral-background.png");
const atlasFixture = neutralAtlasFixture;
await writeSyntheticPng(backgroundFixture, { width: 1600, height: 900 });

async function writeTheme(directory, id, { atlas = atlasFixture, pet = true, version = 2, symlinkAtlas = false } = {}) {
  await fs.mkdir(directory, { recursive: true });
  await fs.copyFile(backgroundFixture, path.join(directory, "background.png"));
  const theme = { kind: "skin.theme", id, name: id, image: "background.png" };
  if (pet) {
    theme.pet = { manifest: "pet/pet.json", spritesheet: "pet/spritesheet.webp", installPolicy: "if-absent", selectionPolicy: "manual" };
    await fs.mkdir(path.join(directory, "pet"));
    await fs.writeFile(path.join(directory, "pet", "pet.json"), `${JSON.stringify({
      id: id.startsWith("skin-") ? id : `skin-${id}`,
      displayName: "Test Companion",
      description: "A local Codex v2 test companion.",
      spriteVersionNumber: version,
      spritesheetPath: "spritesheet.webp",
    }, null, 2)}\n`);
    if (symlinkAtlas) await fs.symlink(atlas, path.join(directory, "pet", "spritesheet.webp"));
    else if (atlas instanceof Uint8Array) await fs.writeFile(path.join(directory, "pet", "spritesheet.webp"), atlas);
    else await fs.copyFile(atlas, path.join(directory, "pet", "spritesheet.webp"));
  }
  await fs.writeFile(path.join(directory, "theme.json"), `${JSON.stringify(theme, null, 2)}\n`);
}

async function stage(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  const { stdout } = await execFile(process.execPath, [stageScript, source, destination]);
  return JSON.parse(stdout);
}

function wrongWidth(bytes) {
  const changed = new Uint8Array(bytes);
  let offset = 12;
  while (offset + 8 <= changed.length) {
    const name = String.fromCharCode(...changed.subarray(offset, offset + 4));
    const length = (changed[offset + 4] | (changed[offset + 5] << 8) | (changed[offset + 6] << 16) | (changed[offset + 7] << 24)) >>> 0;
    const start = offset + 8;
    if (name === "VP8X") { changed[start + 4] ^= 1; return changed; }
    if (name === "VP8L") { changed[start + 1] ^= 1; return changed; }
    if (name === "VP8 ") { changed[start + 6] ^= 1; return changed; }
    offset = start + length + (length % 2);
  }
  throw new Error("Fixture has no WebP image chunk");
}

try {
  const fixtureStat = await fs.stat(atlasFixture);
  assert(fixtureStat.isFile() && fixtureStat.size > 0, "generated v2 example pet atlas is required");
  const atlasBytes = await fs.readFile(atlasFixture);
  const inspected = inspectV2PetAtlas(atlasBytes);
  assert.deepEqual({
    format: inspected.format, mode: inspected.mode, width: inspected.width, height: inspected.height,
    columns: inspected.columns, rows: inspected.rows, cellWidth: inspected.cellWidth, cellHeight: inspected.cellHeight,
  }, {
    format: "WEBP", mode: "RGBA", width: 1536, height: 2288,
    columns: 8, rows: 11, cellWidth: 192, cellHeight: 208,
  });
  assert.throws(() => inspectV2PetAtlas(wrongWidth(atlasBytes)), /1536x2288|dimensions disagree/);
  assert.throws(() => validatePetManifest({
    id: "skin-old", displayName: "Old", description: "v1", spriteVersionNumber: 1, spritesheetPath: "spritesheet.webp",
  }, "skin-old"), /spriteVersionNumber must be 2/);
  assert.throws(() => validatePetManifest({
    id: "skin-escape", displayName: "Escape", description: "traversal", spriteVersionNumber: 2, spritesheetPath: "../spritesheet.webp",
  }, "skin-escape"), /spritesheetPath must be spritesheet\.webp/);
  assert.throws(() => normalizeThemePetReference({
    manifest: "../pet.json", spritesheet: "pet/spritesheet.webp",
  }, "escape"), /pet\.manifest/);

  const source = path.join(temporary, "source");
  const staged = path.join(temporary, "staged");
  await writeTheme(source, "valid-pet");
  const stageResult = await stage(source, staged);
  assert.equal(stageResult.pet.id, "skin-valid-pet");
  assert.equal(stageResult.pet.atlas.mode, "RGBA");
  assert.deepEqual((await fs.readdir(path.join(staged, "pet"))).sort(), ["pet.json", "spritesheet.webp"]);

  const petsRoot = path.join(temporary, "pets");
  const recordsRoot = path.join(temporary, "records");
  const installed = await installThemePet({ themeDirectory: staged, petsRoot, recordsRoot });
  assert.equal(installed.status, "installed");
  assert.equal(installed.owned, true);
  assert.deepEqual((await fs.readdir(path.join(petsRoot, "skin-valid-pet"))).sort(), ["pet.json", "spritesheet.webp"]);
  const unchanged = await installThemePet({ themeDirectory: staged, petsRoot, recordsRoot });
  assert.equal(unchanged.status, "unchanged");

  await fs.writeFile(path.join(petsRoot, "skin-valid-pet", "pet.json"), `${JSON.stringify({
    id: "skin-valid-pet", displayName: "User edited", description: "Must be preserved", spriteVersionNumber: 2, spritesheetPath: "spritesheet.webp",
  })}\n`);
  await assert.rejects(
    installThemePet({ themeDirectory: staged, petsRoot, recordsRoot }),
    /already exists with different content/,
  );
  const preserved = await removeOwnedThemePet({ petId: "skin-valid-pet", petsRoot, recordsRoot });
  assert.equal(preserved.status, "preserved-modified");
  assert.equal((await fs.stat(path.join(petsRoot, "skin-valid-pet"))).isDirectory(), true);

  const updateWithoutPet = path.join(temporary, "update-without-pet");
  await writeTheme(updateWithoutPet, "valid-pet", { pet: false });
  assert.equal((await installThemePet({ themeDirectory: updateWithoutPet, petsRoot, recordsRoot })).status, "absent");
  assert.equal((await fs.stat(path.join(petsRoot, "skin-valid-pet"))).isDirectory(), true);

  const cleanPets = path.join(temporary, "clean-pets");
  const cleanRecords = path.join(temporary, "clean-records");
  const cleanInstall = await installThemePet({ themeDirectory: staged, petsRoot: cleanPets, recordsRoot: cleanRecords });
  assert.equal(cleanInstall.status, "installed");
  const activeState = path.join(temporary, "active-state");
  await writeActiveTheme({ stateRoot: activeState, themeId: "valid-pet", petResult: cleanInstall });
  assert.equal((await removeActiveThemePet({ stateRoot: activeState, petsRoot: cleanPets, recordsRoot: cleanRecords })).status, "removed");
  await assert.rejects(fs.stat(path.join(cleanPets, "skin-valid-pet")), { code: "ENOENT" });

  const uninstallPets = path.join(temporary, "uninstall-pets");
  const uninstallRecords = path.join(temporary, "uninstall-records");
  assert.equal((await installThemePet({ themeDirectory: staged, petsRoot: uninstallPets, recordsRoot: uninstallRecords })).status, "installed");
  assert.deepEqual(await removeAllOwnedThemePets({ petsRoot: uninstallPets, recordsRoot: uninstallRecords }), [
    { status: "removed", petId: "skin-valid-pet", removed: true },
  ]);

  const unownedPets = path.join(temporary, "unowned-pets");
  const unownedRecords = path.join(temporary, "unowned-records");
  await fs.mkdir(path.join(unownedPets, "skin-valid-pet"), { recursive: true });
  await fs.mkdir(unownedRecords, { recursive: true });
  await fs.copyFile(path.join(staged, "pet", "pet.json"), path.join(unownedPets, "skin-valid-pet", "pet.json"));
  await fs.copyFile(path.join(staged, "pet", "spritesheet.webp"), path.join(unownedPets, "skin-valid-pet", "spritesheet.webp"));
  const identical = await installThemePet({ themeDirectory: staged, petsRoot: unownedPets, recordsRoot: unownedRecords });
  assert.equal(identical.status, "existing-identical");
  assert.equal(identical.owned, false);
  assert.equal((await removeOwnedThemePet({ petId: "skin-valid-pet", petsRoot: unownedPets, recordsRoot: unownedRecords })).status, "unowned");
  assert.equal((await fs.stat(path.join(unownedPets, "skin-valid-pet"))).isDirectory(), true);

  const wrongSize = path.join(temporary, "wrong-size");
  await writeTheme(wrongSize, "wrong-size", { atlas: wrongWidth(atlasBytes) });
  await assert.rejects(stage(wrongSize, path.join(temporary, "wrong-size-stage")), /1536x2288|dimensions disagree/);

  const oldVersion = path.join(temporary, "old-version");
  await writeTheme(oldVersion, "old-version", { version: 1 });
  await assert.rejects(stage(oldVersion, path.join(temporary, "old-version-stage")), /spriteVersionNumber must be 2/);

  const symlink = path.join(temporary, "symlink");
  await writeTheme(symlink, "symlink", { symlinkAtlas: true });
  await assert.rejects(stage(symlink, path.join(temporary, "symlink-stage")), /symbolic link/);

  console.log("PASS: optional v2 theme pets validate, stage, install atomically, conflict safely, and preserve user changes.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
