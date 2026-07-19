import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assembleAdapterRelease, assertAdapterReleaseBoundary } from "../scripts/adapter-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFile = promisify(execFileCallback);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-adapter-boundary-"));
const forbiddenSourceDirectories = ["presets", "themes", "theme-sources"];
const forbiddenProductionIds = [["xt", "xg"].join(""), ["wo", "lp"].join("")];
const themeMediaExtensions = new Set([".cctheme", ".gif", ".jpeg", ".jpg", ".mov", ".mp4", ".png", ".webm", ".webp"]);

async function walk(directory, relative = "") {
  const result = [];
  for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await walk(directory, next));
    else if (entry.isFile()) result.push(next);
    else result.push(next);
  }
  return result;
}

try {
  for (const directory of forbiddenSourceDirectories) {
    await assert.rejects(fs.access(path.join(root, directory)), { code: "ENOENT" },
      `production theme directory remains in the interpreter repository: ${directory}`);
  }
  for (const relative of [
    "scripts/apply-preset-macos.sh",
    "scripts/analyze-theme-media.mjs",
    "scripts/set-theme-palette-strategy.mjs",
    "scripts/theme-library.mjs",
    "scripts/theme-library-service.mjs",
    "contracts/theme-library.schema.json",
    "skills/build-workbuddy-skin",
  ]) {
    await assert.rejects(fs.access(path.join(root, relative)), { code: "ENOENT" },
      `theme authoring/library ownership leaked into the Adapter: ${relative}`);
  }

  const switchSource = await fs.readFile(path.join(root, "scripts", "switch-theme-macos.sh"), "utf8");
  assert.match(switchSource, /--id/);
  assert.match(switchSource, /\$STATE_DIR\/themes/);
  assert.match(switchSource, /stage-theme\.mjs/);
  assert.match(switchSource, /--check-payload/);
  assert.match(switchSource, /last-known-good|\.previous/);
  assert.doesNotMatch(switchSource, /presets|theme-library|--theme-dir\)/,
    "Manager switch must not accept paths or fall back to Adapter-owned themes");

  const sourceFiles = await walk(root);
  for (const relative of sourceFiles) {
    if (relative.startsWith(`tests${path.sep}`) || relative.startsWith(`.git${path.sep}`)) continue;
    assert.equal(themeMediaExtensions.has(path.extname(relative).toLowerCase()), false,
      `production theme media remains in the Adapter source: ${relative}`);
    assert.notEqual(path.basename(relative).toLowerCase(), "theme.json",
      `production theme document remains in the Adapter source: ${relative}`);
    const lower = (await fs.readFile(path.join(root, relative))).toString("utf8").toLowerCase();
    assert.equal(forbiddenProductionIds.some((id) => lower.includes(id)), false,
      `known production theme identity remains in Adapter source: ${relative}`);
  }

  const buildSource = await fs.readFile(path.join(root, "scripts", "build-release.sh"), "utf8");
  const buildClient = await fs.readFile(path.join(root, "scripts", "build-client-release.sh"), "utf8");
  const installer = await fs.readFile(path.join(root, "scripts", "install-skin-macos.sh"), "utf8");
  for (const source of [buildSource, buildClient, installer]) {
    assert.match(source, /adapter-release\.mjs/);
    assert.doesNotMatch(source, /rsync[\s\S]*?\$ROOT\//,
      "a release/install path still copies the whole repository");
    assert.doesNotMatch(source, /ditto[\s\S]*?\$PROJECT_ROOT/,
      "the installer still copies the whole repository");
  }

  const assembled = path.join(temporary, "adapter");
  const files = await assembleAdapterRelease(assembled);
  assert(files.length > 20);
  assert.deepEqual(await assertAdapterReleaseBoundary(assembled), files);
  assert.equal(files.some((file) => file.startsWith(`tests${path.sep}`)), false);
  assert.equal(files.some((file) => themeMediaExtensions.has(path.extname(file).toLowerCase())), false);
  assert.equal(files.some((file) => path.basename(file).toLowerCase() === "theme.json"), false);
  assert.ok(files.includes("scripts/switch-theme-macos.sh"), "fixed Manager switch is missing from the Adapter release");

  const releaseRoot = path.join(root, "release");
  const releaseArchives = await fs.access(releaseRoot).then(() => walk(releaseRoot)).catch(() => []);
  for (const relative of releaseArchives.filter((file) => file.toLowerCase().endsWith(".zip"))) {
    const archive = path.join(releaseRoot, relative);
    const { stdout } = await execFile("/usr/bin/unzip", ["-Z1", archive], { maxBuffer: 4 * 1024 * 1024 });
    for (const entry of stdout.split("\n").filter(Boolean)) {
      const segments = entry.toLowerCase().split("/");
      assert.equal(segments.some((segment) => forbiddenSourceDirectories.includes(segment) ||
        ["tests", "fixtures", "release"].includes(segment)), false,
      `release archive contains a forbidden theme/staging directory: ${relative}:${entry}`);
      assert.equal(themeMediaExtensions.has(path.extname(entry).toLowerCase()), false,
        `release archive contains theme media or an installable package: ${relative}:${entry}`);
      assert.notEqual(path.basename(entry).toLowerCase(), "theme.json",
        `release archive contains a theme document: ${relative}:${entry}`);
      assert.equal(forbiddenProductionIds.some((id) => entry.toLowerCase().includes(id)), false,
        `release archive contains a known production theme identity: ${relative}:${entry}`);
    }
  }

  console.log("PASS: WorkBuddy source, installer, staging, release allowlist, and any local release archive contain no production theme, media, catalog, or authoring payload.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
