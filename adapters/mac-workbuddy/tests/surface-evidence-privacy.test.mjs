import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await fs.readFile(path.join(root, "scripts", "injector.mjs"), "utf8");

function between(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source boundary: ${start}`);
  assert.notEqual(endIndex, -1, `missing source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

const probe = between("async function probeSession", "async function waitForProbe");
const inspect = between("async function inspectSurfaceSession", "async function waitForVerifiedSession");
const oneShot = between("async function runOneShot", "export function earlyPayloadFor");

for (const [label, block] of [["probe", probe], ["surface evidence", inspect], ["one-shot report", oneShot]]) {
  for (const forbidden of [
    /textContent/,
    /innerText/,
    /textSamples/,
    /ancestryForText/,
    /aria-label/i,
    /aria-labelledby/i,
    /accessibleName/i,
    /location\.(?:href|search|hash)/,
    /\b(?:href|currentSrc)\b/,
    /\.src\b/,
    /target\.(?:title|url)/,
  ]) {
    assert.doesNotMatch(block, forbidden, `${label} leaks a forbidden content-bearing field`);
  }
  assert.doesNotMatch(block, /[\u3400-\u9fff]/u, `${label} contains a fixed CJK text probe`);
}

for (const forbidden of [
  /contentSecurityPolicy/,
  /backgroundImage/,
  /errorMessage/,
  /sourceIsBlob/,
  /endpointIsLoopback/,
  /\.value\b/,
  /\.defaultValue\b/,
]) {
  assert.doesNotMatch(inspect, forbidden, "surface evidence includes a potentially content-bearing value");
}

for (const required of [
  'kind: "workbuddy.surface-evidence"',
  'privacy: "content-free"',
  "stableClasses",
  "stableId",
  "childCount",
  "interaction",
  "computedStyle",
]) {
  assert.match(inspect, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing privacy-safe evidence field: ${required}`);
}

assert.doesNotMatch(inspect, /id:\s*stableToken\(node\.id\)/,
  "surface evidence must not emit arbitrary DOM ids that could contain user-derived text");

console.log("PASS: WorkBuddy live-surface evidence is content-free and limited to structural, geometric, state, and computed-style data.");
