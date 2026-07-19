import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(
  await readFile(new URL(`../${path}`, import.meta.url), "utf8"),
);

test("Capability separates renderer ordering from artifact provenance", async () => {
  const capability = await readJson("contracts/adapter-capability.json");
  const { runtimeOrdering, artifactProvenance } = capability.identityResponsibilities;
  assert.equal(runtimeOrdering.scope, "renderer-session");
  assert.deepEqual(runtimeOrdering.fields, ["sessionNonce", "generation", "revision"]);
  assert.equal(runtimeOrdering.crossProcessComparable, false);
  assert.equal(runtimeOrdering.releaseDigest, false);
  assert.deepEqual(artifactProvenance.fields, ["fileSha256", "manifestSha256", "archiveSha256"]);
  assert.equal(artifactProvenance.algorithm, "sha256");
  assert.equal(artifactProvenance.sessionScoped, false);
});

test("Transaction forbids crossing ordering and provenance responsibilities", async () => {
  const transaction = await readJson("contracts/adapter-transaction.json");
  assert.equal(transaction.runtimeOrdering.crossProcessRule, "never-compare-without-matching-session-nonce");
  assert.equal(transaction.runtimeOrdering.releaseIdentityUse, "forbidden");
  assert.equal(transaction.artifactProvenance.runtimeOrderingUse, "forbidden");
  assert.equal(transaction.artifactProvenance.algorithm, "sha256");
});

test("Result schema exposes two distinct bounded objects", async () => {
  const schema = await readJson("contracts/operation-result.schema.json");
  const details = schema.properties.details.properties;
  assert.ok(details.runtimeOrdering);
  assert.ok(details.artifactProvenance);
  assert.deepEqual(Object.keys(details.runtimeOrdering.properties).sort(), ["generation", "revision", "sessionNonce"]);
  assert.deepEqual(Object.keys(details.artifactProvenance.properties).sort(), ["archiveSha256", "fileSha256", "manifestSha256"]);
  for (const digest of Object.values(details.artifactProvenance.properties)) {
    assert.equal(digest.pattern, "^[0-9a-f]{64}$");
  }
});

test("Runtime override policy never treats session values as digests", async () => {
  const policy = await readJson("contracts/runtime-overrides-interface.json");
  assert.equal(policy.persistence.runtimeOrdering.scope, "renderer-session");
  assert.equal(policy.persistence.runtimeOrdering.crossProcessComparable, false);
  assert.equal(policy.persistence.artifactBinding.sessionNonceIsDigest, false);
  assert.equal(policy.persistence.artifactBinding.generationIsDigest, false);
});
