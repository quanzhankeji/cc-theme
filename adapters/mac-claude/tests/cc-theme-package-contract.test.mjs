import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CC_THEME_CONTAINER,
  CC_THEME_FILE_EXTENSION,
  CC_THEME_MIME_TYPE,
  MAC_CLAUDE_ADAPTER_ID,
  MAC_CLAUDE_CONTRACT,
  MAC_CLAUDE_TARGET_PATH,
  SKIN_DOCUMENT_KIND,
  SKIN_PACKAGE_KIND,
  SKIN_THEME_KIND,
} from "../scripts/skin-theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relative) => JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
const contract = await readJson("contracts/cc-theme-package.json");
const project = await readJson("PROJECT_MANIFEST.json");

assert.equal(contract.kind, "cc-theme.package-contract");
assert.equal(contract.revision, 2);
assert.equal(contract.extension, CC_THEME_FILE_EXTENSION);
assert.equal(contract.mimeType, CC_THEME_MIME_TYPE);
assert.equal(contract.container, CC_THEME_CONTAINER);
assert.equal(contract.manifestKind, SKIN_PACKAGE_KIND);
assert.equal(contract.documentKind, SKIN_DOCUMENT_KIND);
assert.equal(contract.themeKind, SKIN_THEME_KIND);
assert.deepEqual(contract.target, {
  application: "claude",
  platform: "macos",
  adapterId: MAC_CLAUDE_ADAPTER_ID,
  capabilityVersion: "1.0.0",
  adapterContract: MAC_CLAUDE_CONTRACT,
  targetProfileSchema: "claude-target-profile.schema.json",
  targetPath: MAC_CLAUDE_TARGET_PATH,
});
assert.equal(contract.presetDistribution, undefined);
assert.equal(project.externalThemeInput.ownership, "independent-cc-theme-resource-layer");
assert.deepEqual(project.externalThemeInput.acceptedInputs, ["cc-theme.unified-theme", "skin.package"]);
assert.equal(project.externalThemeInput.repositoryOwnsProductionThemes, false);
assert.equal(project.externalThemeInput.failureFallback, "restore-native-host-state");
await assert.rejects(
  fs.access(path.join(root, "compatibility/claude-macos/26.707.91948")),
  (error) => error?.code === "ENOENT",
);

assert.equal(project.client.versionPolicy, "verified-build-with-runtime-probe");
assert.equal(contract.target.version, undefined);
assert.equal(contract.compatibilityMigration, undefined, "Mac-Claude must not publish a package migration reader");
console.log("PASS: mac-claude validates external Theme Packages without owning a preset distribution.");
