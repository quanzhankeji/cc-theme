import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CC_THEME_CONTAINER,
  CC_THEME_FILE_EXTENSION,
  CC_THEME_MIME_TYPE,
  MAC_CODEX_ADAPTER_ID,
  MAC_CODEX_CONTRACT,
  MAC_CODEX_TARGET_PATH,
  SKIN_DOCUMENT_KIND,
  SKIN_PACKAGE_KIND,
  SKIN_THEME_KIND,
} from "../scripts/skin-theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relative) => JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
const contract = await readJson("contracts/cc-theme-package.json");
const project = await readJson("PROJECT_MANIFEST.json");

assert.equal(contract.kind, "cc-theme.package-contract");
assert.equal(contract.revision, 1);
assert.equal(contract.extension, CC_THEME_FILE_EXTENSION);
assert.equal(contract.mimeType, CC_THEME_MIME_TYPE);
assert.equal(contract.container, CC_THEME_CONTAINER);
assert.equal(contract.manifestKind, SKIN_PACKAGE_KIND);
assert.equal(contract.documentKind, SKIN_DOCUMENT_KIND);
assert.equal(contract.themeKind, SKIN_THEME_KIND);
assert.deepEqual(contract.target, {
  application: "codex",
  platform: "macos",
  version: contract.target.version,
  adapterId: MAC_CODEX_ADAPTER_ID,
  adapterContract: MAC_CODEX_CONTRACT,
  targetPath: MAC_CODEX_TARGET_PATH,
});
assert.equal(Object.hasOwn(contract.target, ["legacyRead", "AdapterIds"].join("")), false);
assert.equal(Object.hasOwn(contract.target, ["adapter", "Ids"].join("")), false);
assert.equal(Object.hasOwn(contract, "presetDistribution"), false);
assert.equal(Object.hasOwn(project, "bundledPreset"), false);
assert.equal(Object.hasOwn(project, "themeLibrary"), false);
assert.equal(project.runtimeState.externalPackageInputOnly, true);
assert.equal(project.runtimeState.repositoryOwnsThemeAssets, false);
assert.equal(project.securityBoundary.bundlesProductionThemes, false);
assert.equal(project.securityBoundary.fallbackRestoresNativeHost, true);
await assert.rejects(
  fs.access(path.join(root, "compatibility/chatgpt-macos/26.707.91948")),
  (error) => error?.code === "ENOENT",
);

assert.equal(project.client.versionPolicy, "always-latest");
console.log("PASS: mac-codex accepts portable .cctheme input without owning preset distribution.");
