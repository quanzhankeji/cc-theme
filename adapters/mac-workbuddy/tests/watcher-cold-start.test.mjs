import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeWorkBuddyCdpServer } from "./helpers/fake-cdp-server.mjs";
import { createSyntheticTheme, readSyntheticTheme } from "./helpers/synthetic-theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-cold-watcher-"));
const themeDirectory = path.join(temporary, "theme");
const reportFile = path.join(temporary, "watcher.json");
const cdp = await createFakeWorkBuddyCdpServer({ initialUrl: "about:blank" });
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
  const base = await readSyntheticTheme();
  await createSyntheticTheme(themeDirectory, {
    backgroundVideo: "background.mp4",
    appearance: { ...base.appearance, backgroundVideoPosterMode: "image" },
  });
  const mp4 = Buffer.alloc(32);
  mp4.writeUInt32BE(32, 0);
  mp4.write("ftyp", 4, "ascii");
  mp4.write("isom", 8, "ascii");
  await fs.writeFile(path.join(themeDirectory, "background.mp4"), mp4);

  child = spawn(process.execPath, [
    path.join(root, "scripts", "injector.mjs"), "--watch",
    "--port", String(cdp.port),
    "--theme-dir", themeDirectory,
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
  }, 5000, "Watcher readiness report");
  await waitFor(() => cdp.earlySources.length === 1, 5000, "first CDP generation");
  assert.equal(cdp.calls.filter(({ method }) => method === "Page.addScriptToEvaluateOnNewDocument").length, 1,
    "the Watcher did not pre-register its generation on the verified pre-navigation page target");
  cdp.setTargetUrl("file:///Applications/WorkBuddy.app/Contents/Resources/app.asar/renderer/index.html");
  await waitFor(() => cdp.calls.some(({ method, params }) => method === "Runtime.evaluate" &&
    String(params?.expression).includes("const applicationName = document.body")), 5000, "renderer handoff probe");

  const report = JSON.parse(await fs.readFile(reportFile, "utf8"));
  assert.equal(report.details.videoEnabled, true);
  assert.equal(report.details.videoTransport, "loopback-range");
  assert.equal(report.details.generationContract, "single-long-lived-watcher");
  assert.equal(cdp.earlySources.length, 1, "cold startup registered more than one initial generation");
  const first = cdp.earlySources[0];
  assert.match(first, /http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}\/background\.mp4\?v=\d+-\d+/,
    "the first generation did not contain the live Range media URL");
  assert.doesNotMatch(first, /__WORKBUDDY_SKIN_VIDEO_JSON__/,
    "the first generation still contained an unresolved media marker");
  assert.doesNotMatch(first, /fetch\(VIDEO_URL/,
    "the first generation regressed to full fetch-to-Blob playback");
  assert.equal(cdp.calls.filter(({ method }) => method === "Page.addScriptToEvaluateOnNewDocument").length, 1);
  assert.equal(child.exitCode, null, stderr);
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await cdp.close();
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("PASS: one cold Watcher generation owns the validated loopback Range video before WorkBuddy CDP attaches.");
