import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/theme-lifecycle.mjs", import.meta.url));

async function invoke(operation) {
  try {
    await execFileAsync(process.execPath, [script, operation, "--request-id", `test-${operation.replaceAll("-", "x")}-0001`]);
    assert.fail(`${operation} must fail closed`);
  } catch (error) {
    assert.equal(error.code, 2);
    return JSON.parse(error.stdout);
  }
}

for (const operation of ["apply", "launch", "verify", "pause", "restore"]) {
  test(`${operation} reports a truthful no-mutation failure`, async () => {
    const result = await invoke(operation);
    assert.equal(result.adapterId, "win-claude");
    assert.equal(result.operation, operation);
    assert.equal(result.status, "failed");
    assert.equal(result.ok, false);
    assert.equal(result.changed, false);
    assert.notEqual(result.code, "ok");
    assert.equal(result.details.transportAvailable, false);
  });
}
