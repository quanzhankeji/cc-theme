import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { neutralAtlasFixture, writeSyntheticPng } from "./helpers/media-fixtures.mjs";

const execFile = promisify(execFileCallback);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const importer = path.join(root, "scripts", "import-cc-theme.mjs");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-pet-import-"));
const background = path.join(temporary, "neutral-background.png");
const atlas = neutralAtlasFixture;
await writeSyntheticPng(background, { width: 1600, height: 900 });

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function buildPackage(id, {
  pet = true,
  interactive = false,
  atlasMediaType = "image/webp",
  badAtlasHash = false,
  badHash = false,
  symlink = false,
  application = "codex",
  adapterId = "mac-codex",
  omitAdapterSettings = false,
} = {}) {
  const directory = path.join(temporary, `package-${id}-${crypto.randomUUID()}`);
  const target = path.join(directory, "targets", "macos");
  await fs.mkdir(target, { recursive: true });
  const document = {
    kind: "skin.document",
    id,
    name: id,
    author: "tests",
    application,
    platform: "macos",
    appVersion: "test-client",
    scene: "task",
    capabilities: ["advanced"],
    tokens: {
      background: "#101112", panel: "#202122", panelAlt: "#303132", accent: "#405060",
      accentAlt: "#506070", secondary: "#607080", highlight: "#708090", text: "#f0f1f2",
      muted: "#909192", line: "#a0a1a2", actionForeground: "#111213", success: "#20a060",
      danger: "#d04050", uiFont: "Avenir Next", displayFont: "Georgia", codeFont: "Menlo",
      radiusScale: 1.25, shellOpacity: 73, backdropBlurPx: 22,
    },
    ...(!omitAdapterSettings ? { adapters: { macos: {
      profileId: "test", shellMode: "dark", newTaskLayout: "banner",
      backgroundVideoPosterMode: "none", backdropSaturation: 1.2, reduceParticles: false,
    } } } : {}),
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
  await fs.writeFile(path.join(directory, "theme.json"), `${JSON.stringify(document, null, 2)}\n`);
  await fs.copyFile(background, path.join(target, "background.png"));
  const compiled = { kind: "skin.theme", id, name: id, image: "background.png", colors: {} };
  if (interactive) {
    compiled.interactiveBackground = {
      type: "directional",
      atlas: "background-directions.webp",
      directions: 16,
      columns: 4,
      rows: 4,
      firstDirectionDegrees: -90,
      idleFrame: 0,
      origin: { xPercent: 50, yPercent: 50 },
      scrimOpacity: 0.16,
    };
    await fs.copyFile(atlas, path.join(target, "background-directions.webp"));
  }
  if (pet) {
    compiled.pet = { manifest: "pet/pet.json", spritesheet: "pet/spritesheet.webp", installPolicy: "if-absent", selectionPolicy: "manual" };
    await fs.mkdir(path.join(target, "pet"));
    await fs.writeFile(path.join(target, "pet", "pet.json"), `${JSON.stringify({
      id: id.startsWith("skin-") ? id : `skin-${id}`,
      displayName: id,
      description: "Packaged Codex v2 pet",
      spriteVersionNumber: 2,
      spritesheetPath: "spritesheet.webp",
    }, null, 2)}\n`);
    if (symlink) await fs.symlink(atlas, path.join(target, "pet", "spritesheet.webp"));
    else await fs.copyFile(atlas, path.join(target, "pet", "spritesheet.webp"));
  }
  await fs.writeFile(path.join(target, "theme.json"), `${JSON.stringify(compiled, null, 2)}\n`);

  const relativeFiles = ["theme.json", "targets/macos/background.png", "targets/macos/theme.json"];
  if (interactive) relativeFiles.push("targets/macos/background-directions.webp");
  if (pet) relativeFiles.push("targets/macos/pet/pet.json", "targets/macos/pet/spritesheet.webp");
  const files = [];
  const hashes = {};
  for (const relative of relativeFiles) {
    const bytes = await fs.readFile(path.join(directory, relative));
    const mediaType = relative.endsWith("background-directions.webp") ? atlasMediaType
      : relative.endsWith(".webp") ? "image/webp"
        : relative.endsWith(".png") ? "image/png" : "application/json";
    files.push({ path: relative, mediaType, size: bytes.length });
    hashes[relative] = sha256(bytes);
  }
  if (badHash) hashes["targets/macos/theme.json"] = "0".repeat(64);
  if (badAtlasHash) hashes["targets/macos/background-directions.webp"] = "0".repeat(64);
  const manifest = {
    kind: "skin.package",
    id,
    name: id,
    author: "tests",
    exportedAt: "2026-07-17T00:00:00.000Z",
    target: { application, platform: "macos", version: "test-client" },
    capabilities: ["advanced"],
    adapters: [{
      id: adapterId,
      contract: "skin.theme",
      profileId: "test",
      targetPath: "targets/macos/theme.json",
      status: "compiled",
      unsupportedEditorFields: [],
    }],
    files,
    integrity: { algorithm: "sha256", files: hashes },
  };
  await fs.writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const packagePath = path.join(temporary, `${id}-${crypto.randomUUID()}.cctheme`);
  const entries = ["manifest.json", ...relativeFiles];
  await execFile("/usr/bin/zip", ["-q", ...(symlink ? ["-y"] : []), packagePath, ...entries], { cwd: directory });
  return packagePath;
}

async function importPackage(packagePath, roots) {
  const { stdout } = await execFile(process.execPath, [
    importer,
    "--file", packagePath,
    "--active-theme-root", roots.active,
    "--pets-root", roots.pets,
    "--pet-records-root", roots.records,
  ]);
  return JSON.parse(stdout);
}

try {
  const roots = {
    active: path.join(temporary, "active-theme"),
    pets: path.join(temporary, "pets"),
    records: path.join(temporary, "records"),
  };
  const validPackage = await buildPackage("pet-import");
  const formerExtensionPackage = path.join(temporary, "former-theme.codexskin");
  await fs.copyFile(validPackage, formerExtensionPackage);
  await assert.rejects(
    importPackage(formerExtensionPackage, roots),
    /must use the \.cctheme extension/,
  );
  const imported = await importPackage(validPackage, roots);
  assert.equal(imported.pet.status, "installed");
  assert.equal(imported.pet.petId, "skin-pet-import");
  assert.deepEqual((await fs.readdir(path.join(roots.active, "pet"))).sort(), ["pet.json", "spritesheet.webp"]);
  assert.deepEqual((await fs.readdir(path.join(roots.pets, "skin-pet-import"))).sort(), ["pet.json", "spritesheet.webp"]);
  const installedTheme = JSON.parse(await fs.readFile(path.join(roots.active, "theme.json"), "utf8"));
  assert.equal(installedTheme.colors.accent, "#405060");
  assert.equal(installedTheme.semanticColors.composerSurface, "rgba(48, 49, 50, 0.73)");
  assert.deepEqual(installedTheme.fonts, { ui: ["Avenir Next"], display: ["Georgia"], code: ["Menlo"] });
  assert.equal(installedTheme.appearance.newTaskLayout, "banner");
  assert.equal(installedTheme.appearance.reduceParticles, false);
  assert.equal(installedTheme.appearance.radiusScale, 1.25);
  assert.equal(installedTheme.appearance.backdropBlurPx, 22);

  await fs.writeFile(path.join(roots.active, "preserve.txt"), "previous theme must return\n");
  await fs.writeFile(path.join(roots.pets, "skin-pet-import", "pet.json"), `${JSON.stringify({
    id: "skin-pet-import", displayName: "Changed by user", description: "conflict", spriteVersionNumber: 2, spritesheetPath: "spritesheet.webp",
  })}\n`);
  await assert.rejects(importPackage(validPackage, roots), /Pet id conflict/);
  assert.equal(await fs.readFile(path.join(roots.active, "preserve.txt"), "utf8"), "previous theme must return\n");

  const legacyRoots = {
    active: path.join(temporary, "legacy-active"),
    pets: path.join(temporary, "legacy-pets"),
    records: path.join(temporary, "legacy-records"),
  };
  const legacy = await importPackage(await buildPackage("legacy", { pet: false, omitAdapterSettings: true }), legacyRoots);
  assert.equal(legacy.pet.status, "absent");
  const legacyTheme = JSON.parse(await fs.readFile(path.join(legacyRoots.active, "theme.json"), "utf8"));
  assert.equal(legacyTheme.appearance.newTaskLayout, "cards");
  assert.equal(legacyTheme.appearance.reduceParticles, true);
  await assert.rejects(fs.stat(path.join(legacyRoots.active, "pet")), { code: "ENOENT" });

  const interactiveRoots = {
    active: path.join(temporary, "interactive-active"),
    pets: path.join(temporary, "interactive-pets"),
    records: path.join(temporary, "interactive-records"),
  };
  const interactive = await importPackage(
    await buildPackage("directional", { pet: false, interactive: true }),
    interactiveRoots,
  );
  assert.equal(interactive.pet.status, "absent");
  const interactiveTheme = JSON.parse(await fs.readFile(
    path.join(interactiveRoots.active, "theme.json"), "utf8",
  ));
  assert.equal(interactiveTheme.interactiveBackground.type, "directional");
  assert.equal((await fs.stat(path.join(
    interactiveRoots.active, "background-directions.webp",
  ))).isFile(), true);

  await assert.rejects(
    importPackage(await buildPackage("directional-media-type", {
      pet: false,
      interactive: true,
      atlasMediaType: "application/octet-stream",
    }), {
      active: path.join(temporary, "directional-bad-active"),
      pets: path.join(temporary, "directional-bad-pets"),
      records: path.join(temporary, "directional-bad-records"),
    }),
    /directional background atlas is invalid or missing/,
  );

  await assert.rejects(
    importPackage(await buildPackage("directional-bad-hash", {
      pet: false,
      interactive: true,
      badAtlasHash: true,
    }), {
      active: path.join(temporary, "directional-hash-active"),
      pets: path.join(temporary, "directional-hash-pets"),
      records: path.join(temporary, "directional-hash-records"),
    }),
    /integrity mismatch: targets\/macos\/background-directions\.webp/,
  );

  await assert.rejects(
    importPackage(await buildPackage("bad-hash", { badHash: true }), {
      active: path.join(temporary, "bad-active"), pets: path.join(temporary, "bad-pets"), records: path.join(temporary, "bad-records"),
    }),
    /integrity mismatch/,
  );

  await assert.rejects(
    importPackage(await buildPackage("symlink-pet", { symlink: true }), {
      active: path.join(temporary, "link-active"), pets: path.join(temporary, "link-pets"), records: path.join(temporary, "link-records"),
    }),
    /symbolic link/,
  );

  await assert.rejects(
    importPackage(await buildPackage("wrong-application", { pet: false, application: "workbuddy" }), {
      active: path.join(temporary, "wrong-app-active"), pets: path.join(temporary, "wrong-app-pets"), records: path.join(temporary, "wrong-app-records"),
    }),
    /does not target Codex for macOS/,
  );

  const retiredAdapterId = ["mac", "codex", "skin"].join("-");
  await assert.rejects(
    importPackage(await buildPackage("retired-adapter-id", { pet: false, adapterId: retiredAdapterId }), {
      active: path.join(temporary, "retired-id-active"), pets: path.join(temporary, "retired-id-pets"), records: path.join(temporary, "retired-id-records"),
    }),
    /does not contain the required compiled Mac-CodeX adapter/,
  );

  console.log("PASS: .cctheme import requires the canonical Adapter id and covers target identity, pet integrity, older theme data, conflicts, rollback, and archive symlinks.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
