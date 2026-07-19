import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const proof = await readFile(
  new URL("../docs/DEVTOOLS-PROOF.md", import.meta.url),
  "utf8",
);

test("DevTools proof is manual, non-production, and non-persistent", () => {
  assert.match(proof, /manual and non-production/i);
  assert.match(proof, /must never enter a `skin\.theme`/);
  assert.match(proof, /no\s+remote-debugging port\/pipe/i);
  assert.doesNotMatch(proof, /localStorage|sessionStorage|indexedDB|fetch\(|WebSocket/);
});

test("DevTools proof has an explicit complete cleanup", () => {
  for (const marker of [
    "cc-theme-devtools-proof-style",
    "cc-theme-devtools-proof-marker",
    "ccThemeDevtoolsProof",
  ]) {
    assert.match(proof, new RegExp(marker));
  }
  assert.match(proof, /restored: true/);
  assert.match(proof, /cleanup-incomplete/);
  assert.match(proof, /close the detached DevTools window/);
  assert.match(proof, /cold-start Claude normally/);
  assert.match(proof, /process-scoped environment value/);
});

test("DevTools proof fails closed when its namespace is occupied", () => {
  const applySection = proof.split("## Apply the disposable proof")[1].split("## Verify without collecting user content")[0];
  assert.match(applySection, /proof-namespace-occupied/);
  assert.match(applySection, /Object\.hasOwn/);
  assert.doesNotMatch(applySection, /\.remove\(/);
});

test("DevTools proof never embeds or assigns authentication material", () => {
  assert.doesNotMatch(proof, /CLAUDE_CDP_AUTH\s*=/);
  assert.doesNotMatch(proof, /CLAUDE_USER_DATA_DIR\s*=/);
  assert.doesNotMatch(proof, /remote-debugging-(?:port|pipe)\s*=/);
});
