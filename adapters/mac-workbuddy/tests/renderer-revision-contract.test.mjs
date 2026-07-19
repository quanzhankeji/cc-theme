import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createSyntheticTheme } from "./helpers/synthetic-theme.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const injector = path.join(root, "scripts", "injector.mjs");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-revision-"));
await createSyntheticTheme(temporary);

async function preflightInNewProcess() {
  const { stdout } = await execFileAsync(process.execPath, [
    injector,
    "--check-payload",
    "--theme-dir",
    temporary,
  ], {
    cwd: root,
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

try {
  const [first, second] = await Promise.all([
    preflightInNewProcess(),
    preflightInNewProcess(),
  ]);

  for (const report of [first, second]) {
    assert.equal(report.status, "ok");
    assert.equal(report.code, "payload-valid");
    assert.match(report.revision, /^[a-f0-9]{20}$/);
    assert.equal(report.revisionScope, "renderer-session-generation");
    assert.equal(report.releaseTraceability, "file-manifest-sha256");
  }

  assert.notEqual(first.revision, second.revision,
    "separate injector processes must not expose renderer revision as a deterministic source digest");

  const source = await fs.readFile(injector, "utf8");
  assert.match(source, /RENDERER_SESSION_NONCE = randomBytes\(18\)/,
    "the renderer generation must retain its process session nonce");
  assert.match(source, /\.update\(RENDERER_SESSION_NONCE\)/,
    "the process session nonce must continue to invalidate stale renderer bindings");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("PASS: renderer revision is session-scoped while deterministic release traceability uses SHA-256.");
