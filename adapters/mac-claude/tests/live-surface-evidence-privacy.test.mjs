import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateLiveSurfaceEvidence, writeLiveSurfaceEvidence } from "../scripts/live-surface-evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const record = {
  kind: "cc-theme.live-surface-evidence",
  schemaVersion: 1,
  adapter: "mac-claude",
  privacy: { policy: "structure-only-v1", structuralOnly: true, rawArtifactsCommitted: false, sensitiveFieldCount: 0 },
  nodes: [{ id: "composer", element: "div", stableClasses: ["rounded", "border"], childElementCount: 3, bounds: { x: 1, y: 2, width: 300, height: 48 } }],
};
assert.deepEqual(validateLiveSurfaceEvidence(record, { forbiddenValues: ["private chat sentence"] }), []);
assert(validateLiveSurfaceEvidence({ ...record, nodes: [{ textContent: "private chat sentence" }] }).length > 0);
assert(validateLiveSurfaceEvidence({ ...record, nodes: [{ stableClasses: ["private chat sentence"] }] }, { forbiddenValues: ["private chat sentence"] }).length > 0);

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-evidence-"));
try {
  const output = path.join(temporary, "evidence.json");
  await writeLiveSurfaceEvidence(output, record);
  assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), record);
  assert.equal((await fs.stat(output)).mode & 0o777, 0o600);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

const injector = await fs.readFile(path.join(root, "scripts", "injector.mjs"), "utf8");
const start = injector.indexOf("async function captureLiveSurfaceEvidence");
const end = injector.indexOf("async function verifySession", start);
const evidenceSource = injector.slice(start, end);
for (const forbidden of [".innerText", ".textContent", ".value", "accessibleName", "getAttribute(\"aria-label\")", "location.href", "currentSrc"]) {
  assert.equal(evidenceSource.includes(forbidden), false, `Evidence collector reads forbidden data: ${forbidden}`);
}
console.log("live-surface-evidence-privacy.test.mjs: ok");
