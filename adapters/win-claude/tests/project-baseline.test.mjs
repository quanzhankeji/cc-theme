import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (relativePath) => JSON.parse(
  await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"),
);

test("adapter capability starts fail closed", async () => {
  const capability = await readJson("contracts/adapter-capability.json");
  assert.equal(capability.adapterId, "win-claude");
  assert.equal(capability.platform, "windows");
  assert.equal(capability.runtimeApplyAvailable, false);
  assert.equal(capability.compatibility.verifiedBuild, "1.22209.0");
  assert.equal(capability.compatibility.verifiedPackageForm, "msix");
  assert.equal(capability.compatibility.verifiedArchitecture, "arm64");
  assert.equal(capability.gate.policy, "fail-closed");
  assert.equal(capability.gate.reasonCode, "production-runtime-seam-unverified");
  assert.equal(capability.compatibility.identityAllowlistReady, false);
  assert.equal(capability.localRuntimeOverrides.serialTransactionSeamAvailable, false);
});

test("target profile is closed and contains no host implementation fields", async () => {
  const schema = await readJson("contracts/windows-claude-target-profile.schema.json");
  assert.equal(schema.additionalProperties, false);
  const serialized = JSON.stringify(schema).toLowerCase();
  for (const forbidden of ["selector", "javascript", "shader", "command", "url", "path"]) {
    assert.equal(serialized.includes(`\"${forbidden}\"`), false);
  }
});

test("style catalog uses semantic surface roles", async () => {
  const catalog = await readJson("contracts/theme-style-catalog.json");
  assert.equal(catalog.adapterId, "win-claude");
  const tokens = catalog.tokens;
  assert.ok(tokens.length > 0);
  for (const token of tokens) {
    assert.match(token.id, /^[a-z][A-Za-z0-9.]*$/);
    assert.ok(token.surfaceRoles.every((role) => !/[#>\[\]]/.test(role)));
    assert.equal(token.runtimeBinding, null);
  }
});
