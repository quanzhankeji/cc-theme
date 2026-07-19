import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(
  await readFile(new URL(`../${path}`, import.meta.url), "utf8"),
);

test("CLI unpacked-extension candidate fails closed from static evidence", async () => {
  const contract = await readJson("contracts/runtime-seam-candidates.json");
  const candidate = contract.candidates.find(({ id }) => id === "electron-unpacked-extension-command-line");
  assert.equal(candidate.status, "failed-static-no-supported-loader");
  assert.equal(candidate.claudeStaticEvidence.loadExtensionOccurrences, 5);
  assert.equal(candidate.claudeStaticEvidence.loadExtensionSwitchLiteralObserved, false);
  assert.equal(candidate.claudeStaticEvidence.genericOfficialExtensionHookObserved, false);
  assert.equal(candidate.minimumVmCommand, null);
  assert.equal(candidate.decision, "do-not-run-load-extension-command");
  assert.equal(candidate.proof.status, "static-security-fixture-not-authorized-to-launch");
  assert.equal(contract.productionRuntimeApplyAvailable, false);
});

test("inactive extension fixture has the minimum exact host scope", async () => {
  const manifest = await readJson("proofs/electron-extension/manifest.json");
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, []);
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://claude.ai/*"]);
  assert.equal(manifest.content_scripts[0].all_frames, false);
  for (const forbidden of ["host_permissions", "background", "web_accessible_resources", "externally_connectable"]) {
    assert.equal(Object.hasOwn(manifest, forbidden), false);
  }
});

test("inactive content script reads no host or account content", async () => {
  const script = await readFile(
    new URL("../proofs/electron-extension/content-script.js", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    "querySelector",
    "innerText",
    "MutationObserver",
    "XMLHttpRequest",
    "fetch(",
    "WebSocket",
    "chrome.storage",
    "document.cookie",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "clipboard",
  ]) {
    assert.equal(script.includes(forbidden), false, forbidden);
  }
  assert.match(script, /location\.origin !== "https:\/\/claude\.ai"/);
  assert.match(script, /namespaceOccupied/);
  assert.match(script, /removeEventListener/);
  assert.match(script, /delete document\.documentElement\.dataset\[datasetKey\]/);
});

test("inactive extension fixture has deterministic file provenance", async () => {
  const proofManifest = await readJson("proofs/electron-extension/proof-manifest.json");
  assert.equal(proofManifest.status, "not-authorized-to-launch");
  assert.equal(proofManifest.launchCommand, null);
  for (const file of proofManifest.files) {
    const bytes = await readFile(new URL(`../proofs/electron-extension/${file.name}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  }
});

test("forbidden privilege and interception channels are permanently rejected", async () => {
  const contract = await readJson("contracts/runtime-seam-candidates.json");
  for (const rejected of [
    "modify-app-asar",
    "modify-windowsapps-package-files",
    "forge-copy-replay-or-bypass-cdp-auth-token",
    "dll-injection",
    "node-inspector-bypass",
    "react-devtools-profile-fallback",
    "dxt-or-mcp-permission-reuse",
    "https-proxy-or-tls-interception",
  ]) {
    assert.ok(contract.permanentlyRejected.includes(rejected), rejected);
  }
});

test("force-dark fallback cannot claim a CC Theme marker or runtime capability", async () => {
  const contract = await readJson("contracts/runtime-seam-candidates.json");
  const candidate = contract.candidates.find(({ id }) => id === "system-or-forced-dark-mode");
  assert.equal(candidate.capability, "approximated-dark-only");
  assert.equal(candidate.expectedMarker, null);
  assert.match(candidate.minimumVmCommandTemplate, /--force-dark-mode/);
  assert.doesNotMatch(candidate.minimumVmCommandTemplate, /remote-debugging|proxy|inspect|load-extension/);
});
