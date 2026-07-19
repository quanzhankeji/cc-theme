import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

if (process.env.WORKBUDDY_LIVE_COLD_START !== "1") {
  console.log("SKIP: set WORKBUDDY_LIVE_COLD_START=1 for the ten-run local WorkBuddy cold-start acceptance.");
  process.exit(0);
}

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateFile = path.join(os.homedir(), "Library", "Application Support", "mac-workbuddy", "state.env");
const state = await fs.readFile(stateFile, "utf8");
const themeDirectory = state.split("\n").find((line) => line.startsWith("theme_dir="))?.slice("theme_dir=".length);
assert(themeDirectory, "active WorkBuddy theme directory was not recorded");
const theme = JSON.parse(await fs.readFile(path.join(themeDirectory, "theme.json"), "utf8"));
assert.equal(theme.id, "WOLP", "the ten-run product acceptance is bound to the installed WOLP package");
assert.equal(typeof theme.backgroundVideo, "string", "WOLP video is missing");

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-cold-acceptance-"));
const samples = [];
const metrics = [
  "hostLaunch", "cdpReady", "firstGenerationInstalled", "videoFirstFrame",
  "videoPlaying", "rendererTargetWait", "generationToFirstFrame", "generationToPlaying",
  "foregroundHandoff", "total",
];
const quantile = (values, percentile) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
};

try {
  for (let run = 1; run <= 10; run += 1) {
    const reportFile = path.join(temporary, `run-${run}.json`);
    const startedAt = Date.now();
    await execFile("/bin/bash", [path.join(root, "scripts", "start-skin-macos.sh"),
      "--restart", "--theme-dir", themeDirectory, "--report-file", reportFile], {
      cwd: root,
      maxBuffer: 1024 * 1024,
    });
    const externalElapsed = Date.now() - startedAt;
    const report = JSON.parse(await fs.readFile(reportFile, "utf8"));
    const details = report.details ?? {};
    const timings = details.timingsMs ?? {};
    const generation = details.generation ?? {};
    const playback = details.playback ?? {};
    assert.equal(report.status, "ok", `run ${run} did not finish successfully`);
    assert.equal(details.foregroundHandoff?.confirmed, true, `run ${run} did not confirm foreground handoff`);
    assert.equal(playback.videoReady, true, `run ${run} did not reach videoReady`);
    assert.equal(playback.playbackState, "playing", `run ${run} did not reach playing`);
    assert.equal(generation.installCount, 1, `run ${run} installed more than one renderer generation`);
    const cdpReadySinceStartup = ["signatureValidation", "priorWatcherStop", "hostStop", "watcherStartup", "cdpReady"]
      .reduce((total, key) => total + Number(timings[key] ?? 0), 0);
    const rendererTargetWait = Math.max(0, generation.firstInstalledSinceStartupMs - cdpReadySinceStartup);
    const generationToFirstFrame = generation.videoFirstFrameSinceStartupMs - generation.firstInstalledSinceStartupMs;
    const generationToPlaying = generation.videoPlayingSinceStartupMs - generation.firstInstalledSinceStartupMs;
    const anomaly = rendererTargetWait > 5000 ? {
      code: "host-renderer-target-late",
      rendererTargetWaitMs: rendererTargetWait,
      generationToPlayingMs: generationToPlaying,
    } : null;
    samples.push({
      run,
      status: report.status,
      playbackCode: playback.code,
      transport: playback.transport,
      transportDiagnostic: playback.transportDiagnostic ?? null,
      hostLaunch: timings.hostLaunch,
      cdpReady: timings.cdpReady,
      cdpReadySinceStartup,
      firstGenerationInstalled: generation.firstInstalledSinceStartupMs,
      videoFirstFrame: generation.videoFirstFrameSinceStartupMs,
      videoPlaying: generation.videoPlayingSinceStartupMs,
      rendererTargetWait,
      generationToFirstFrame,
      generationToPlaying,
      watcherTargetTimings: generation.watcherTargetTimingsMs ?? null,
      foregroundHandoff: timings.foregroundHandoff,
      total: timings.total,
      externalElapsed,
      anomaly,
    });
  }
  const percentiles = Object.fromEntries(metrics.map((metric) => [metric, {
    p50: quantile(samples.map((sample) => sample[metric]), 0.50),
    p95: quantile(samples.map((sample) => sample[metric]), 0.95),
  }]));
  console.log(JSON.stringify({
    kind: "workbuddy.cold-start-acceptance",
    schemaVersion: 1,
    hostVersion: "5.2.6",
    architecture: process.arch,
    rounds: samples.length,
    baselineMs: { hostLaunch: 19000, videoPlaying: 33400 },
    percentiles,
    anomalies: samples.filter((sample) => sample.anomaly),
    samples,
  }, null, 2));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
