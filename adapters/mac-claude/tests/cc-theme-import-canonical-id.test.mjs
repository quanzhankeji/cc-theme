import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { syntheticPng } from "./fixtures/synthetic-media.mjs";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importer = path.join(root, "scripts", "import-cc-theme.mjs");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-import-canonical-id-"));
const retiredAdapterAlias = ["mac", "claude", "skin"].join("-");

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

async function buildPackage(
  name,
  versionBearing,
  extraFile = null,
  adapterId = versionBearing ? retiredAdapterAlias : "mac-claude",
  documentVersionBearing = versionBearing,
  additionalAdapterIds = [],
) {
  const packageRoot = path.join(temporary, name);
  const targetRoot = path.join(packageRoot, "targets", "macos");
  await fs.mkdir(targetRoot, { recursive: true });
  const id = versionBearing ? "retired-version-import" : "current-import";
  const document = {
    kind: "skin.document",
    id,
    application: "claude",
    platform: "macos",
    ...(documentVersionBearing ? { appVersion: "1.22209.3" } : {}),
    tokens: {
      background: "#101010", panel: "#202020", panelAlt: "#303030",
      accent: "#4488ff", accentAlt: "#66aaff", secondary: "#55cccc",
      highlight: "#7755aa", text: "#f5f5f5", muted: "#aaaaaa", line: "#555555",
      actionForeground: "#ffffff", success: "#22aa55", danger: "#dd3344",
      uiFont: "system-ui", displayFont: "system-ui", codeFont: "Menlo",
      radiusScale: 1, shellOpacity: 80, backdropBlurPx: 18,
    },
    adapters: { macos: { shellMode: "auto", backgroundVideoPosterMode: "none", backdropSaturation: 1 } },
  };
  const theme = { kind: "skin.theme", id, name: versionBearing ? "Retired Version Import" : "Current Import", image: "background.png" };
  const files = new Map([
    ["theme.json", Buffer.from(`${JSON.stringify(document, null, 2)}\n`)],
    ["targets/macos/theme.json", Buffer.from(`${JSON.stringify(theme, null, 2)}\n`)],
    ["targets/macos/background.png", syntheticPng()],
  ]);
  if (extraFile) files.set(extraFile.path, extraFile.bytes);
  for (const [relative, bytes] of files) {
    const destination = path.join(packageRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes);
  }
  const manifest = {
    kind: "skin.package",
    id,
    target: {
      application: "claude", platform: "macos",
      ...(versionBearing ? { version: "1.22209.3" } : { capabilityVersion: "1.0.0" }),
    },
    adapters: [adapterId, ...additionalAdapterIds].map((id) => ({
      id, contract: "skin.theme", status: "compiled", targetPath: "targets/macos/theme.json",
    })),
    files: [...files].map(([relative, bytes]) => ({
      path: relative, size: bytes.length,
      ...(relative.endsWith(".png") ? { mediaType: "image/png" } : {}),
    })),
    integrity: {
      algorithm: "sha256",
      files: Object.fromEntries([...files].map(([relative, bytes]) => [relative, sha256(bytes)])),
    },
  };
  await fs.writeFile(path.join(packageRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const archive = path.join(temporary, `${name}.cctheme`);
  await execFile("/usr/bin/zip", ["-X", "-q", archive, "manifest.json", ...files.keys()], { cwd: packageRoot });
  return archive;
}

try {
  const activeThemeRoot = path.join(temporary, "active-theme");
  const current = JSON.parse((await execFile(process.execPath, [importer, "--file", await buildPackage("current", false), "--active-theme-root", activeThemeRoot])).stdout);
  assert.equal(current.targetVersion, undefined);
  assert.equal(current.capabilityVersion, "1.0.0");
  assert.equal(current.migrationDiagnostics, undefined);
  assert.equal(current.adapter, "mac-claude");

  await assert.rejects(
    execFile(process.execPath, [
      importer, "--file", await buildPackage("retired-alias", false, null, retiredAdapterAlias),
      "--active-theme-root", activeThemeRoot,
    ]),
    (error) => /Mac-Claude adapter|canonical adapter/i.test(error.stderr || error.message),
    "Packages using a retired Adapter alias must fail closed",
  );

  await assert.rejects(
    execFile(process.execPath, [
      importer, "--file", await buildPackage("retired-version", true, null, "mac-claude"),
      "--active-theme-root", activeThemeRoot,
    ]),
    (error) => /capability|version|migration/i.test(error.stderr || error.message),
    "Packages with legacy client-version facts must fail closed",
  );

  await assert.rejects(
    execFile(process.execPath, [
      importer, "--file", await buildPackage("retired-document-version", false, null, "mac-claude", true),
      "--active-theme-root", activeThemeRoot,
    ]),
    (error) => /appVersion/i.test(error.stderr || error.message),
    "Theme documents with client-version facts must fail closed",
  );

  await assert.rejects(
    execFile(process.execPath, [
      importer, "--file", await buildPackage("multiple-adapters", false, null, "mac-claude", false, ["other-adapter"]),
      "--active-theme-root", activeThemeRoot,
    ]),
    (error) => /exactly one canonical/i.test(error.stderr || error.message),
    "Packages with more than the canonical Mac-Claude Adapter must fail closed",
  );

  for (const [name, pathName, bytes] of [
    ["shader-payload", "targets/macos/effect.wgsl", Buffer.from("shader")],
    ["wasm-payload", "targets/macos/runtime.wasm", Buffer.from([0, 97, 115, 109])],
    ["nested-archive", "targets/macos/payload.zip", Buffer.from("PK\u0003\u0004")],
    ["unused-media", "targets/macos/unused.png", syntheticPng(8, 8)],
  ]) {
    const archive = await buildPackage(name, false, { path: pathName, bytes });
    await assert.rejects(
      execFile(process.execPath, [importer, "--file", archive, "--active-theme-root", activeThemeRoot]),
      (error) => /unsafe|undeclared|not referenced/i.test(error.stderr || error.message),
      `${pathName} must not be accepted as an unused package payload`,
    );
  }
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("cc-theme-import-canonical-id.test.mjs: ok");
