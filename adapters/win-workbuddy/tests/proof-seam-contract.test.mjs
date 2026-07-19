import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const start = read("../scripts/start-proof-workbuddy.ps1");
const wrapper = read("../scripts/proof-seam.ps1");
const cdp = read("../scripts/proof-cdp.mjs");
const evidence = JSON.parse(read("../evidence/proof-seam-2026-07-18.json"));

test("proof launch and wrapper require loopback, exact version, publisher and valid signature", () => {
  for (const source of [start, wrapper]) {
    assert.match(source, /127\.0\.0\.1/);
    assert.match(source, /::1/);
    assert.match(source, /Get-AuthenticodeSignature/);
    assert.match(source, /Tencent Technology \(Shenzhen\) Company Limited/);
    assert.match(source, /5\.2\.6/);
    assert.match(source, /OwningProcess/);
  }
});

test("proof target selection is conjunctive and exactly-one", () => {
  for (const marker of [
    "resources/app.asar/renderer/index.html", "WorkBuddy", "data-application-name",
    "data-electron-desktop", "data-platform", "data-product-version", "rootCount",
    "matches.length !== 1",
  ]) assert.ok(cdp.includes(marker), marker);
});

test("proof apply, pause and restore use fixed adapter-owned markers only", () => {
  assert.ok(cdp.includes("cc-theme-win-proof-style"));
  assert.ok(cdp.includes("cc-theme-win-proof-marker"));
  assert.ok(cdp.includes("data-cc-theme-runtime"));
  assert.ok(cdp.includes("data-cc-theme-state"));
  assert.ok(cdp.includes("proof-snapshot-missing"));
  assert.ok(cdp.includes("snapshot.attributes[name]"));
  assert.ok(cdp.includes("body.removeAttribute(name)"));
  assert.ok(cdp.includes("delete window["));
  assert.equal(cdp.includes("--css"), false);
  assert.equal(cdp.includes("--selector"), false);
  assert.equal(cdp.includes("--javascript"), false);
});

test("VM evidence records the closed proof loop without enabling production runtime", () => {
  assert.equal(evidence.classification, "vm-verified");
  assert.equal(evidence.cleanupComplete, false);
  for (const operation of ["launch", "preflight", "apply", "verify", "pause", "restore"]) {
    assert.equal(evidence.operations[operation], "success");
  }
  assert.ok(evidence.limitations.includes("production-runtime-apply-remains-disabled"));
  assert.ok(evidence.limitations.includes("debug-listener-cleanup-not-yet-verified"));
});
