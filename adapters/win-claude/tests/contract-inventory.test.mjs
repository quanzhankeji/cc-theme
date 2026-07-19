import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(
  await readFile(new URL(`../${path}`, import.meta.url), "utf8"),
);

const contractFiles = [
  "contracts/adapter-capability.json",
  "contracts/adapter-capability.schema.json",
  "contracts/adapter-transaction.json",
  "contracts/compile-context.schema.json",
  "contracts/host-evidence.schema.json",
  "contracts/live-surface-evidence-policy.json",
  "contracts/operation-result.schema.json",
  "contracts/runtime-overrides-interface.json",
  "contracts/runtime-seam-candidates.json",
  "contracts/runtime-seam-candidates.schema.json",
  "contracts/runtime-seam-evidence.schema.json",
  "contracts/settings-wysiwyg-interface.json",
  "contracts/theme-editor-locales.json",
  "contracts/theme-lifecycle-interface.json",
  "contracts/theme-style-catalog.json",
  "contracts/ui-surface-catalog.schema.json",
  "contracts/windows-claude-target-profile.schema.json",
  "compatibility/claude-windows/1.22209.0/host-evidence.json",
  "compatibility/claude-windows/1.22209.0/runtime-seam-evidence.json",
  "compatibility/claude-windows/1.22209.0/ui-surface-catalog.json",
  "compatibility/claude-windows/unverified/ui-surface-catalog.json",
  "proofs/electron-extension/manifest.json",
  "proofs/electron-extension/proof-manifest.json",
];

test("all published baseline contracts are parseable JSON", async () => {
  for (const file of contractFiles) {
    assert.ok(await readJson(file), file);
  }
});

test("Target Profile stays empty until Windows evidence exists", async () => {
  const schema = await readJson("contracts/windows-claude-target-profile.schema.json");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.maxProperties, 0);
  assert.deepEqual(schema.properties, {});
});

test("Style Catalog references current Unified Theme v2 Shared Core paths", async () => {
  const catalog = await readJson("contracts/theme-style-catalog.json");
  const allowed = new Set([
    "sharedCore.tokens.colors.surfaceBase",
    "sharedCore.tokens.colors.text",
    "sharedCore.tokens.colors.action",
    "sharedCore.tokens.fonts.ui",
  ]);
  for (const token of catalog.tokens) {
    assert.ok(allowed.has(token.sourcePath), token.sourcePath);
    assert.equal(token.runtimeBinding, null);
  }
});

test("WYSIWYG contract is autosave-only and fully rollback-capable", async () => {
  const contract = await readJson("contracts/settings-wysiwyg-interface.json");
  assert.equal(contract.editor.preview, "immediate");
  assert.equal(contract.editor.autosave, true);
  assert.equal(contract.editor.saveButton, false);
  assert.equal(contract.editor.ordering, "latest-write-wins");
  assert.match(contract.editor.failure, /ui-renderer-disk/);
});

test("all editor locales cover identical groups, tokens, and statuses", async () => {
  const locales = await readJson("contracts/theme-editor-locales.json");
  const [first, ...rest] = Object.values(locales.messages);
  const shape = (messages) => ({
    groups: Object.keys(messages.groups).sort(),
    tokens: Object.keys(messages.tokens).sort(),
    status: Object.keys(messages.status).sort(),
  });
  for (const messages of rest) assert.deepEqual(shape(messages), shape(first));
});

test("unverified Surface Catalog cannot claim runtime apply", async () => {
  const catalog = await readJson("compatibility/claude-windows/unverified/ui-surface-catalog.json");
  assert.equal(catalog.evidenceClass, "unverified");
  assert.equal(catalog.runtime.runtimeApplyAvailable, false);
  assert.equal(catalog.settingsEntry.nativeAdjacentEntryVerified, false);
});

test("verified host identity does not open the production runtime gate", async () => {
  const evidence = await readJson("compatibility/claude-windows/1.22209.0/host-evidence.json");
  const catalog = await readJson("compatibility/claude-windows/1.22209.0/ui-surface-catalog.json");
  assert.equal(evidence.client.version, "1.22209.0");
  assert.equal(evidence.client.packageForm, "msix");
  assert.equal(evidence.client.architecture, "arm64");
  assert.equal(evidence.client.signatureStatus, "valid");
  assert.equal(evidence.remoteDebuggingGate.tokenSegments, 3);
  assert.equal(evidence.remoteDebuggingGate.freshnessSeconds, 300);
  assert.equal(evidence.remoteDebuggingGate.adapterBypassPolicy, "forbidden");
  assert.equal(evidence.officialDeveloperTools.allowedUse, "manual-disposable-proof-only");
  assert.equal(evidence.identityAnchors.futureAllowlistReady, false);
  assert.deepEqual(evidence.identityAnchors.missing.sort(), [
    "binary-sha256",
    "package-family-name",
    "package-full-name",
    "signer-subject",
  ]);
  assert.equal(evidence.conclusion.runtimeApplyAvailable, false);
  assert.equal(evidence.conclusion.reasonCode, "production-runtime-seam-unverified");
  assert.equal(catalog.evidenceClass, "unverified");
  assert.equal(catalog.runtime.runtimeApplyAvailable, false);
});
