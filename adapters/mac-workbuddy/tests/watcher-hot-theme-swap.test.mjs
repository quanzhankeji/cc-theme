import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeWorkBuddyCdpServer } from "./helpers/fake-cdp-server.mjs";
import { createSyntheticTheme } from "./helpers/synthetic-theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-hot-theme-swap-"));
const runtimeRoot = path.join(temporary, "runtime");
const currentTheme = path.join(runtimeRoot, "current");
const reportFile = path.join(temporary, "watcher.json");
const cdp = await createFakeWorkBuddyCdpServer();
let child;

const waitFor = async (predicate, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

try {
  await createSyntheticTheme(currentTheme, { name: "First generation" });
  child = spawn(process.execPath, [
    path.join(root, "scripts", "injector.mjs"), "--watch",
    "--port", String(cdp.port),
    "--theme-dir", currentTheme,
    "--themes-root", temporary,
    "--report-file", reportFile,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  await waitFor(async () => {
    try {
      const report = JSON.parse(await fs.readFile(reportFile, "utf8"));
      return report.status === "ok" && report.code === "watcher-ready";
    } catch {
      return false;
    }
  }, 5000, "initial Watcher readiness");
  await waitFor(() => cdp.earlySources.some((source) => source.includes("First generation")),
    5000, "first renderer generation");
  const initialReport = JSON.parse(await fs.readFile(reportFile, "utf8"));
  const initialRevision = initialReport.revision;
  const initialInputFingerprint = initialReport.runtimeInputFingerprint;
  assert.match(initialInputFingerprint, /^[a-f0-9]{64}$/);

  const nextTheme = path.join(runtimeRoot, ".next");
  const previousTheme = path.join(runtimeRoot, ".previous");
  await createSyntheticTheme(nextTheme, { name: "Second generation" });
  await fs.rename(currentTheme, previousTheme);
  await fs.rename(nextTheme, currentTheme);

  await waitFor(async () => {
    try {
      const report = JSON.parse(await fs.readFile(reportFile, "utf8"));
      return report.revision !== initialRevision
        && report.runtimeInputFingerprint !== initialInputFingerprint
        && cdp.earlySources.some((source) => source.includes("Second generation"));
    } catch {
      return false;
    }
  }, 5000, "hot-swapped renderer generation");
  assert.equal(child.exitCode, null, stderr);
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await cdp.close();
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("PASS: one long-lived WorkBuddy Watcher follows an atomic runtime theme swap and publishes the new generation.");
