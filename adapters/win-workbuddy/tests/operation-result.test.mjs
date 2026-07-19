import test from "node:test";
import assert from "node:assert/strict";
import { operationResult } from "../src/operation-result.mjs";

test("operation result keeps renderer generation separate from deterministic artifact digest", () => {
  const digest = "a".repeat(64);
  const result = operationResult({
    operation: "apply",
    ok: true,
    phase: "apply",
    details: {
      themeId: "xtxg",
      rendererGeneration: 7,
      rendererGenerationScope: "renderer-session",
      artifactManifestSha256: digest,
      artifactDigestScope: "deterministic-runtime-manifest",
    },
  });
  assert.equal(result.details.rendererGeneration, 7);
  assert.equal(result.details.rendererGenerationScope, "renderer-session");
  assert.equal(result.details.artifactManifestSha256, digest);
  assert.equal(result.details.artifactDigestScope, "deterministic-runtime-manifest");
  assert.notEqual(String(result.details.rendererGeneration), result.details.artifactManifestSha256);
});
