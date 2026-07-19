import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeLifecyclePhase, validateLifecycleResult, writeLifecycleReport } from "../scripts/theme-lifecycle.mjs";

const fixedNow = () => new Date("2026-07-18T00:00:00.000Z");
for (const phase of ["detect", "preflight", "apply", "verify", "pause", "restore"]) {
  const request = phase === "apply" ? { packageFile: "/tmp/external-theme.cctheme" } : {};
  const calls = [];
  const result = await executeLifecyclePhase(phase, request, {
    now: fixedNow,
    runAdapter: async (script, args) => {
      calls.push({ script, args });
      return { stdout: JSON.stringify({ pass: true }) };
    },
  });
  assert.equal(result.pass, true);
  assert.equal(result.phase, phase);
  assert.equal(result.failureCategory, null);
  assert.equal(calls.length, 1);
  validateLifecycleResult(result);
}
const landmarkFailure = await executeLifecyclePhase("verify", {}, {
  now: fixedNow,
  runAdapter: async () => { const error = new Error("No page matched expected Claude shell landmarks"); error.stderr = error.message; throw error; },
});
assert.equal(landmarkFailure.failureCategory, "adapter-landmark");
const themeFailure = await executeLifecyclePhase("apply", { packageFile: "/tmp/external-theme.cctheme" }, {
  now: fixedNow,
  runAdapter: async () => { const error = new Error("Theme payload failed validation"); error.stderr = error.message; throw error; },
});
assert.equal(themeFailure.failureCategory, "theme-contract");

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-lifecycle-"));
try {
  const report = path.join(temporary, "result.json");
  await writeLifecycleReport(report, landmarkFailure);
  assert.equal((await fs.stat(report)).mode & 0o777, 0o600);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
console.log("theme-lifecycle.test.mjs: ok");
