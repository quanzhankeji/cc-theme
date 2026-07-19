import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { writeSyntheticImage } from "./helpers/synthetic-theme.mjs";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importer = path.join(root, "scripts", "import-cc-theme.mjs");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-cc-theme-import-"));

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function staticWebp(width, height) {
  const vp8x = Buffer.alloc(10);
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const chunk = Buffer.alloc(8);
  chunk.write("VP8X", 0, 4, "ascii");
  chunk.writeUInt32LE(vp8x.length, 4);
  const body = Buffer.concat([Buffer.from("WEBP"), chunk, vp8x]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, 4, "ascii");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

async function buildPackage(id, application, extension = ".cctheme", options = {}) {
  const directory = path.join(temporary, `source-${id}-${crypto.randomUUID()}`);
  const target = path.join(directory, "targets", "macos-workbuddy");
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(directory, "theme.json"), `${JSON.stringify({
    kind: "skin.document", id, name: id, application, platform: "macos", appVersion: "5.2.6",
  })}\n`);
  await writeSyntheticImage(path.join(target, "background.png"));
  const compiledTheme = {
    kind: "skin.theme",
    id,
    name: id,
    image: "background.png",
    appearance: { paletteStrategy: "system", shellMode: "auto" },
  };
  if (options.directional) {
    compiledTheme.interactiveBackground = {
      type: "directional", atlas: "directions.webp", directions: 16, columns: 4, rows: 4,
    };
    await fs.writeFile(
      path.join(target, "directions.webp"),
      options.atlasBytes ?? staticWebp(1600, 800),
    );
  }
  await fs.writeFile(path.join(target, "theme.json"), `${JSON.stringify(compiledTheme, null, 2)}\n`);

  const relativeFiles = ["theme.json", "targets/macos-workbuddy/background.png", "targets/macos-workbuddy/theme.json"];
  if (options.directional) relativeFiles.push("targets/macos-workbuddy/directions.webp");
  const files = [];
  const hashes = {};
  for (const relative of relativeFiles) {
    const bytes = await fs.readFile(path.join(directory, relative));
    files.push({
      path: relative,
      mediaType: relative.endsWith(".png") ? "image/png" : relative.endsWith(".webp")
        ? options.atlasMediaType ?? "image/webp" : "application/json",
      size: bytes.length,
    });
    hashes[relative] = sha256(bytes);
  }
  const manifest = {
    kind: "skin.package",
    id,
    name: id,
    author: "tests",
    exportedAt: "2026-07-17T00:00:00.000Z",
    target: { application, platform: "macos", version: "5.2.6" },
    capabilities: ["advanced"],
    adapters: [{
      id: "mac-workbuddy",
      contract: "skin.theme",
      profileId: "workbuddy-macos-5.2.6-test",
      targetPath: "targets/macos-workbuddy/theme.json",
      status: "compiled",
      unsupportedEditorFields: [],
    }],
    files,
    integrity: { algorithm: "sha256", files: hashes },
  };
  await fs.writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const packagePath = path.join(temporary, `${id}-${crypto.randomUUID()}${extension}`);
  await execFile("/usr/bin/zip", ["-q", packagePath, "manifest.json", ...relativeFiles], { cwd: directory });
  return packagePath;
}

async function importPackage(packagePath, themesRoot) {
  const { stdout } = await execFile(process.execPath, [
    importer,
    "--file", packagePath,
    "--themes-root", themesRoot,
    "--client-version", "5.2.6",
  ]);
  return JSON.parse(stdout);
}

try {
  const imported = await importPackage(
    await buildPackage("workbuddy-import", "workbuddy"),
    path.join(temporary, "themes"),
  );
  assert.equal(imported.id, "workbuddy-import");
  assert.equal(imported.targetVersion, "5.2.6");
  assert.equal(imported.adapter, "mac-workbuddy");

  const directionalRoot = path.join(temporary, "directional-themes");
  const directional = await importPackage(
    await buildPackage("workbuddy-directional", "workbuddy", ".cctheme", { directional: true }),
    directionalRoot,
  );
  assert.equal(directional.id, "workbuddy-directional");
  const installedDirectional = JSON.parse(await fs.readFile(
    path.join(directionalRoot, "workbuddy-directional", "theme.json"),
    "utf8",
  ));
  assert.equal(installedDirectional.interactiveBackground.type, "directional");
  assert.equal((await fs.stat(path.join(directionalRoot, "workbuddy-directional", "directions.webp"))).isFile(), true);
  await assert.rejects(
    importPackage(
      await buildPackage("bad-atlas-type", "workbuddy", ".cctheme", {
        directional: true, atlasMediaType: "application/octet-stream",
      }),
      path.join(temporary, "bad-atlas-themes"),
    ),
    /media is missing or invalid: directions\.webp/,
  );

  const rollbackRoot = path.join(temporary, "rollback-themes");
  const rollbackDestination = path.join(rollbackRoot, "rollback-directional");
  await fs.mkdir(rollbackDestination, { recursive: true });
  await fs.writeFile(path.join(rollbackDestination, "preserve.txt"), "keep previous install\n");
  await assert.rejects(
    importPackage(
      await buildPackage("rollback-directional", "workbuddy", ".cctheme", {
        directional: true,
        atlasBytes: Buffer.from("not a webp"),
      }),
      rollbackRoot,
    ),
    /not a WebP image/,
  );
  assert.equal(
    await fs.readFile(path.join(rollbackDestination, "preserve.txt"), "utf8"),
    "keep previous install\n",
  );

  await assert.rejects(
    importPackage(await buildPackage("wrong-application", "codex"), path.join(temporary, "wrong-app-themes")),
    /does not target WorkBuddy for macOS/,
  );
  await assert.rejects(
    importPackage(await buildPackage("wrong-extension", "workbuddy", ".zip"), path.join(temporary, "wrong-extension-themes")),
    /must use the lowercase \.cctheme extension/,
  );

  await assert.rejects(
    importPackage(
      await buildPackage("legacy-extension", "workbuddy", ".codexskin"),
      path.join(temporary, "legacy-extension-themes"),
    ),
    /must use the lowercase \.cctheme extension/,
  );

  await assert.rejects(
    importPackage(
      await buildPackage("uppercase-extension", "workbuddy", ".CCTHEME"),
      path.join(temporary, "uppercase-extension-themes"),
    ),
    /must use the lowercase \.cctheme extension/,
  );

  console.log("cc-theme-import.test.mjs: target identity and the exclusive .cctheme extension are enforced");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
