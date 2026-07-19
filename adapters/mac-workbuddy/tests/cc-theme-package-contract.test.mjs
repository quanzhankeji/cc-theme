import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CC_THEME_CONTAINER,
  CC_THEME_FILE_EXTENSION,
  CC_THEME_MIME_TYPE,
  MAC_WORKBUDDY_ADAPTER_ID,
  MAC_WORKBUDDY_CONTRACT,
  MAC_WORKBUDDY_TARGET_PATH,
  SKIN_DOCUMENT_KIND,
  SKIN_PACKAGE_KIND,
  SKIN_THEME_KIND,
} from "../scripts/skin-theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relative) => JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
const contract = await readJson("contracts/cc-theme-package.json");
const compatibility = await readJson("compatibility/workbuddy-macos/5.2.6/ui-surface-catalog.json");

assert.equal(contract.kind, "cc-theme.package-contract");
assert.equal(contract.revision, 1);
assert.equal(contract.extension, CC_THEME_FILE_EXTENSION);
assert.equal(contract.mimeType, CC_THEME_MIME_TYPE);
assert.equal(contract.container, CC_THEME_CONTAINER);
assert.equal(contract.manifestKind, SKIN_PACKAGE_KIND);
assert.equal(contract.documentKind, SKIN_DOCUMENT_KIND);
assert.equal(contract.themeKind, SKIN_THEME_KIND);
assert.deepEqual(contract.target, {
  application: "workbuddy",
  platform: "macos",
  version: compatibility.target.version,
  adapterId: MAC_WORKBUDDY_ADAPTER_ID,
  adapterVersion: compatibility.adapterVersion,
  adapterReleaseRevision: compatibility.adapterReleaseRevision,
  adapterContract: MAC_WORKBUDDY_CONTRACT,
  targetPath: MAC_WORKBUDDY_TARGET_PATH,
});

assert.equal(Object.hasOwn(contract, "presetDistribution"), false,
  "the Adapter package contract must not own a production preset distribution");
assert.deepEqual(Object.keys(contract).sort(), [
  "container", "documentKind", "extension", "kind", "manifestKind", "mimeType", "revision", "target", "themeKind",
]);

console.log("PASS: mac-workbuddy accepts the external .cctheme interface without owning a preset distribution.");
