import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeLifecycleOperation, writeLifecycleReport } from "../scripts/theme-lifecycle.mjs";

const fixedNow = () => new Date("2026-07-18T00:00:00.000Z");
const calls = [];
const success = await executeLifecycleOperation("preflight", { scope: "adapter" }, {
  now: fixedNow,
  runAdapter: async (script, args) => {
    calls.push({ script, args });
    return { stdout: JSON.stringify({ pass: true, clientVersionPolicy: "always-latest" }) };
  },
});
assert.equal(success.status, "success");
assert.equal(success.code, "ok");
assert.equal(success.clientVersionPolicy, "always-latest");
assert.equal(success.details.target, "adapter");
assert.deepEqual(calls[0], { script: "doctor-macos.sh", args: ["--require-live", "--require-surface-admission"] });

const failures = [
  ["apply", { package: "/tmp/neutral.cctheme" }, "Theme pack failed validation", "theme-invalid"],
  ["preflight", { scope: "adapter" }, "Current Surface evidence failed (surface-evidence-client-version-mismatch)", "surface-evidence-client-version-mismatch"],
  ["verify", {}, "No page matched expected Codex shell markers", "adapter-landmark-missing"],
  ["restore", {}, "Owned cleanup could not complete", "cleanup-incomplete"],
];
for (const [operation, request, message, code] of failures) {
  const result = await executeLifecycleOperation(operation, request, {
    now: fixedNow,
    runAdapter: async () => { const error = new Error(message); error.stderr = message; throw error; },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.code, code);
}

const invalid = await executeLifecycleOperation("preflight", { scope: "client-version" }, { now: fixedNow });
assert.equal(invalid.code, "invalid-request");

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-lifecycle-"));
try {
  const report = path.join(temporary, "last.json");
  await writeLifecycleReport(report, success);
  assert.deepEqual(JSON.parse(await fs.readFile(report, "utf8")), success);
  assert.equal((await fs.stat(report)).mode & 0o777, 0o600);
  const unsafe = path.join(temporary, "unsafe.json");
  await fs.symlink(report, unsafe);
  await assert.rejects(writeLifecycleReport(unsafe, success), /regular file/);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("theme-lifecycle.test.mjs: ok");
