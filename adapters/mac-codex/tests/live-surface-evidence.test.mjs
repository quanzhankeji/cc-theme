import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MAX_EVIDENCE_NODES,
  assertSurfaceEvidencePrivacy,
  buildSurfaceEvidenceExpression,
  normalizeSurfaceEvidence,
  writeSurfaceEvidence,
} from "../scripts/live-surface-evidence.mjs";

const expression = buildSurfaceEvidenceExpression();
for (const forbidden of ["innerText", "textContent", ".value", "aria-label", "location.href", "document.title", "getAttribute('href')", "getAttribute('src')"]) {
  assert(!expression.includes(forbidden), `Evidence expression reads forbidden data: ${forbidden}`);
}
assert(expression.includes("getBoundingClientRect"));
assert(expression.includes("getComputedStyle"));
assert(expression.includes("priorityCandidates"));
assert(expression.includes('[role="menu"]'));
assert(expression.includes('[role="menuitem"]'));
assert(expression.includes("[data-radix-popper-content-wrapper]"));

const injector = await fs.readFile(new URL("../scripts/injector.mjs", import.meta.url), "utf8");
assert(!injector.includes("activeArt: document.documentElement.style.getPropertyValue"));
assert(injector.includes("activeArtState:"));

const rawNodes = Array.from({ length: MAX_EVIDENCE_NODES + 40 }, (_, index) => ({
  tag: "button",
  classes: index === 0 ? ["stable-class", "user@example.com", "deadbeefdeadbeef"] : ["stable-class"],
  stable: { role: "button", testId: "settings-item", accessibleName: "private account" },
  state: { selected: "true" },
  rect: { x: index, y: 0, width: 20, height: 20 },
  visible: true,
  computed: { color: "rgb(0, 0, 0)", backgroundImage: "url(https://private.invalid/image)" },
  textContent: "private chat",
  value: "secret",
  href: "https://private.invalid/path?query=secret",
}));
const evidence = normalizeSurfaceEvidence({
  viewport: { width: 1200, height: 800, deviceScaleFactor: 2 },
  landmarks: { shell: true, overlay: true },
  counts: { considered: rawNodes.length },
  nodes: rawNodes,
});
assert.equal(evidence.nodes.length, MAX_EVIDENCE_NODES);
assert.equal(evidence.counts.truncated, true);
assert.equal(evidence.landmarks.overlay, true);
assert.deepEqual(evidence.nodes[0].classes, ["stable-class"]);
assert.equal(Object.hasOwn(evidence.nodes[0], "textContent"), false);
assert.equal(Object.hasOwn(evidence.nodes[0].stable, "accessibleName"), false);
assert.equal(Object.hasOwn(evidence.nodes[0].computed, "backgroundImage"), false);
assert.equal(assertSurfaceEvidencePrivacy(evidence), evidence);
assert.throws(() => assertSurfaceEvidencePrivacy({ nodes: [{ textContent: "private" }] }), /forbidden field/);
assert.throws(() => assertSurfaceEvidencePrivacy({ nodes: [{ computed: { color: "url(https://private.invalid)" } }] }), /URL or media source/);

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-evidence-"));
try {
  const file = path.join(temporary, "evidence.json");
  await writeSurfaceEvidence(file, evidence);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(saved.privacyPolicy, "structural-only-v1");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("live-surface-evidence.test.mjs: ok");
