import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCapabilityGate } from "../src/capability-gate.mjs";
import { runLifecycleOperation } from "../src/lifecycle.mjs";

const observed = {
  os: { product: "Windows 11 Pro", build: "26100", architecture: "ARM64" },
  client: {
    installed: true, running: true, version: "5.2.6",
    publisher: "Tencent Technology (Shenzhen) Company Limited",
    signatureStatus: "valid", packageKind: "electron-asar",
  },
  surfaceCatalog: { verificationStatus: "identity-only", clientVersion: "5.2.6" },
  transport: { verificationStatus: "unverified", localOnly: false, processBound: false },
  transaction: { rollbackVerified: false },
  capability: { runtimeApplyAvailable: false },
};

test("detect succeeds for the observed signed 5.2.6 identity", async () => {
  assert.equal(evaluateCapabilityGate(observed, "detect").allowed, true);
  const result = await runLifecycleOperation("detect", observed);
  assert.equal(result.ok, true);
  assert.equal(result.code, "ok");
});

test("all live operations fail closed before Catalog, transport, rollback and capability verification", async () => {
  for (const operation of ["preflight", "install", "apply", "launch", "verify", "pause", "restore"]) {
    const gate = evaluateCapabilityGate(observed, operation);
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, "runtime-seam-unverified");
    const result = await runLifecycleOperation(operation, observed);
    assert.equal(result.ok, false);
    assert.equal(result.code, "runtime-seam-unverified");
  }
});

test("wrong version or publisher is rejected before runtime checks", () => {
  const wrong = structuredClone(observed);
  wrong.client.version = "5.2.7";
  wrong.client.publisher = "Unknown";
  const gate = evaluateCapabilityGate(wrong, "detect");
  assert.equal(gate.allowed, false);
  assert.equal(gate.code, "environment-identity-unverified");
  assert.ok(gate.failedChecks.includes("client.version"));
  assert.ok(gate.failedChecks.includes("client.publisher"));
});
