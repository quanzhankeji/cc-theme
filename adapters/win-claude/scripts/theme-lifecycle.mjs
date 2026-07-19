#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const startedAt = Date.now();
const allowedOperations = new Set([
  "detect",
  "preflight",
  "install",
  "apply",
  "launch",
  "apply-and-launch",
  "verify",
  "pause",
  "restore",
]);

const args = process.argv.slice(2);
const operation = args[0];
const requestIdIndex = args.indexOf("--request-id");
const requestId = requestIdIndex >= 0 && args[requestIdIndex + 1]
  ? args[requestIdIndex + 1]
  : `local-${randomUUID().replaceAll("-", "").slice(0, 16)}`;

const capability = JSON.parse(await readFile(
  new URL("../contracts/adapter-capability.json", import.meta.url),
  "utf8",
));

const phaseFor = {
  detect: "detect",
  preflight: "preflight",
  install: "install",
  apply: "apply",
  launch: "launch",
  "apply-and-launch": "apply",
  verify: "verify",
  pause: "cleanup",
  restore: "cleanup",
};

const failureFor = {
  detect: ["runtime-invalid", "Claude 1.22209.0 MSIX/ARM64 identity is recorded, but the Windows live detector is not implemented; no current-state claim is made."],
  preflight: ["runtime-invalid", "Basic installed-client identity is verified, but exact allowlist anchors, live UI landmarks, and a reversible production transport are not verified."],
  install: ["runtime-invalid", "The target skin.theme normalizer and local theme library are not implemented."],
  apply: ["transport-unavailable", "No fixed reversible Windows Claude runtime transport is verified; no client state was changed."],
  launch: ["runtime-invalid", "The installed MSIX identity is verified, but a fixed package-aware launch implementation is not available; no process was started."],
  "apply-and-launch": ["transport-unavailable", "Apply-and-launch is blocked before mutation because the Windows runtime transport is unverified."],
  verify: ["verification-failed", "No live adapter-owned marker or version-scoped Surface Catalog is available to verify."],
  pause: ["operation-cancelled", "No verified adapter-owned runtime resources exist to pause; no client state was changed."],
  restore: ["operation-cancelled", "No verified adapter-owned runtime resources or snapshot exist to restore; no client state was changed."],
};

let result;
if (!allowedOperations.has(operation)) {
  result = {
    kind: "cc-theme.lifecycle-result",
    schemaVersion: 1,
    adapterId: "win-claude",
    requestId,
    operation: "detect",
    phase: "detect",
    status: "failed",
    ok: false,
    changed: false,
    code: "invalid-request",
    message: `Expected one operation: ${[...allowedOperations].join(", ")}.`,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  };
} else {
  const [code, message] = failureFor[operation];
  result = {
    kind: "cc-theme.lifecycle-result",
    schemaVersion: 1,
    adapterId: "win-claude",
    requestId,
    operation,
    phase: phaseFor[operation],
    status: "failed",
    ok: false,
    changed: false,
    code,
    message,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    details: {
      clientVersion: null,
      packageIdentityStatus: "not-run",
      processRunning: false,
      transportAvailable: false,
      verification: "not-run",
      artifactProvenance: {
        fileSha256: null,
        manifestSha256: null,
        archiveSha256: null,
      },
      warnings: [capability.gate.reasonCode],
    },
  };
}

process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = 2;
