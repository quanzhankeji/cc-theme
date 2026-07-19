import assert from "node:assert/strict";
import fs from "node:fs/promises";

const forbiddenKey = /^(?:text|textcontent|innertext|textsamples|value|defaultvalue|accessible(?:name)?|arialabel|arialabelledby|href|src|currentsrc|url|query|search|hash|links?|mediasource|contentsecuritypolicy|csp|title|errormessage)$/i;
const contentBearingUrl = /(?:https?|file|data|blob):/i;
const fixedCjkText = /[\u3400-\u9fff]/u;

export function auditSurfaceEvidence(evidence) {
  assert.equal(evidence?.kind, "workbuddy.surface-evidence");
  assert.equal(evidence?.privacy, "content-free");
  const visit = (value, trail) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${trail}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") {
      if (typeof value === "string") {
        assert.doesNotMatch(value, contentBearingUrl, `${trail} contains a URL or media source`);
        assert.doesNotMatch(value, fixedCjkText, `${trail} contains fixed or captured CJK content`);
      }
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      assert.doesNotMatch(key.replaceAll("-", ""), forbiddenKey, `${trail}.${key} is content-bearing`);
      visit(child, `${trail}.${key}`);
    }
  };
  visit(evidence, "$surface");
  return true;
}

function findSurfaceEvidence(value, result = []) {
  if (Array.isArray(value)) value.forEach((item) => findSurfaceEvidence(item, result));
  else if (value && typeof value === "object") {
    if (value.kind === "workbuddy.surface-evidence") result.push(value);
    Object.values(value).forEach((child) => findSurfaceEvidence(child, result));
  }
  return result;
}

const livePath = process.env.WORKBUDDY_SURFACE_EVIDENCE_FILE;
if (livePath) {
  const report = JSON.parse(await fs.readFile(livePath, "utf8"));
  const surfaces = findSurfaceEvidence(report);
  assert(surfaces.length > 0, "live inspect report contains no privacy-versioned surface evidence");
  surfaces.forEach(auditSurfaceEvidence);
  console.log(`PASS: ${surfaces.length} live WorkBuddy surface evidence report(s) contain no user content, URLs, accessible names, or media sources.`);
} else {
  const safe = {
    kind: "workbuddy.surface-evidence",
    privacy: "content-free",
    schemaVersion: 1,
    viewport: { width: 1200, height: 800 },
    nodes: [{
      tag: "main",
      stableClasses: ["teams-container"],
      semanticRole: "main",
      childCount: 4,
      rect: { x: 0, y: 0, width: 900, height: 800 },
      interaction: { disabled: false, hidden: false },
      computedStyle: { display: "block", backgroundColor: "rgba(0, 0, 0, 0)" },
    }],
  };
  assert.equal(auditSurfaceEvidence(safe), true);
  for (const unsafe of [
    { ...safe, text: "private task" },
    { ...safe, nodes: [{ ...safe.nodes[0], accessibleName: "private project" }] },
    { ...safe, background: { src: "blob:private-media" } },
    { ...safe, route: { hash: "#private-thread" } },
    { ...safe, sample: "固定中文文案" },
  ]) assert.throws(() => auditSurfaceEvidence(unsafe));
  console.log("PASS: the live-surface evidence auditor rejects content, accessible names, routes, and media sources.");
}
