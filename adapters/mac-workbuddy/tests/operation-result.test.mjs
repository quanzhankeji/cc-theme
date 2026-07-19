import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { operationResult, writeOperationResult } from "../scripts/operation-result.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

for (const operation of ["check", "preflight", "apply", "verify", "pause", "restore"]) {
  const result = operationResult({ operation, status: "ok", changed: operation === "apply", code: `${operation}-ok`, message: `${operation} completed` });
  assert.equal(result.kind, "cc-theme.operation-result");
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.operation, operation);
  assert.equal(result.ok, true);
  assert.equal(result.phase, ["pause", "restore"].includes(operation) ? "cleanup" : operation);
}
assert.throws(() => operationResult({ operation: "save", status: "ok", code: "save-ok", message: "no" }), /operation/);

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-operation-result-"));
try {
  const file = path.join(directory, "result.json");
  const result = operationResult({ operation: "verify", status: "failed", code: "visual-verification-failed", message: "Verification failed" });
  await writeOperationResult(file, result);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), result);
  assert.equal((await fs.stat(file)).mode & 0o077, 0);
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}

const failedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-operation-failure-"));
try {
  const reportFile = path.join(failedDirectory, "preflight.json");
  const invalidTheme = path.join(failedDirectory, "missing-theme");
  await assert.rejects(execFileAsync(process.execPath, [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "injector.mjs"),
    "--check-payload", "--theme-dir", invalidTheme, "--report-file", reportFile,
  ]));
  const failure = JSON.parse(await fs.readFile(reportFile, "utf8"));
  assert.equal(failure.operation, "preflight");
  assert.equal(failure.status, "failed");
  assert.equal(failure.ok, false);
  assert.equal(failure.code, "theme-contract-failure");
} finally {
  await fs.rm(failedDirectory, { recursive: true, force: true });
}

console.log("PASS: check/preflight/apply/verify/pause/restore share one machine-readable result contract.");
