import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builder = path.join(root, "scripts", "build-client-release.sh");
const projectManifest = JSON.parse(await fs.readFile(path.join(root, "PROJECT_MANIFEST.json"), "utf8"));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-mac-workbuddy-release-test-"));
const output = path.join(temporary, "output");
const archiveName = projectManifest.release.clientArchive;
const archive = path.join(output, archiveName);
const extracted = path.join(temporary, "extracted");
const packageRootName = "CC Theme - mac-workbuddy";
const retiredBrand = ["codex", "skin"].join("");

async function walk(directory, prefix = "") {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    result.push({ relative, absolute, directory: entry.isDirectory() });
    if (entry.isDirectory()) result.push(...await walk(absolute, relative));
  }
  return result;
}

try {
  const { stdout } = await execFile(builder, [output, "--skip-tests"], {
    env: { ...process.env, NODE: process.execPath },
    maxBuffer: 1024 * 1024,
  });
  assert.match(stdout, new RegExp(`Created .*${archiveName.replaceAll(".", "\\.")}`));
  await execFile("/usr/bin/unzip", ["-tq", archive]);

  const archiveBytes = await fs.readFile(archive);
  const expectedHash = crypto.createHash("sha256").update(archiveBytes).digest("hex");
  assert.equal(
    (await fs.readFile(`${archive}.sha256`, "utf8")).trim(),
    `${expectedHash}  ${archiveName}`,
  );

  await fs.mkdir(extracted, { recursive: true });
  await execFile("/usr/bin/ditto", ["-x", "-k", archive, extracted]);
  assert.deepEqual(await fs.readdir(extracted), [packageRootName]);

  const packageRoot = path.join(extracted, packageRootName);
  const packageEntries = await walk(packageRoot);
  const names = new Set(packageEntries.map((entry) => entry.relative));
  for (const required of [
    "安装 CC Theme.command",
    "恢复 WorkBuddy.command",
    "使用说明.txt",
    ".mac-workbuddy/LICENSE",
    ".mac-workbuddy/PROJECT_MANIFEST.json",
    ".mac-workbuddy/README.md",
    ".mac-workbuddy/contracts/cc-theme-package.json",
    ".mac-workbuddy/contracts/adapter-capability.json",
    ".mac-workbuddy/contracts/adapter-capability.schema.json",
    ".mac-workbuddy/contracts/target-profile.schema.json",
    ".mac-workbuddy/contracts/theme-runtime-settings.schema.json",
    ".mac-workbuddy/contracts/theme-settings-locales.json",
    ".mac-workbuddy/contracts/adapter-release-manifest.json",
    ".mac-workbuddy/assets/theme-settings-locale.js",
    ".mac-workbuddy/scripts/apply-cc-theme-macos.sh",
    ".mac-workbuddy/scripts/import-cc-theme.mjs",
    ".mac-workbuddy/scripts/adapter-capability.mjs",
    ".mac-workbuddy/scripts/adapter-transaction.mjs",
    ".mac-workbuddy/scripts/workbuddy-theme-projection.mjs",
    ".mac-workbuddy/scripts/install-skin-macos.sh",
    ".mac-workbuddy/scripts/restore-skin-macos.sh",
    ".mac-workbuddy/scripts/switch-theme-macos.sh",
    ".mac-workbuddy/scripts/adapter-release.mjs",
    ".mac-workbuddy/scripts/release-identity.mjs",
    ".mac-workbuddy/skills/repair-workbuddy-compatibility/SKILL.md",
  ]) {
    assert.ok(names.has(required), `client release entry is missing: ${required}`);
  }

  assert.equal(
    packageEntries.some((entry) => entry.relative.toLowerCase().includes(retiredBrand)),
    false,
    "retired brand remains in a client release filename",
  );

  const installEntry = path.join(packageRoot, "安装 CC Theme.command");
  const restoreEntry = path.join(packageRoot, "恢复 WorkBuddy.command");
  assert.notEqual((await fs.stat(installEntry)).mode & 0o111, 0, "install entry is not executable");
  assert.notEqual((await fs.stat(restoreEntry)).mode & 0o111, 0, "restore entry is not executable");
  assert.match(await fs.readFile(installEntry, "utf8"), /\.mac-workbuddy\/scripts\/install-skin-macos\.sh/);
  assert.match(await fs.readFile(installEntry, "utf8"), /--no-start/);
  assert.match(await fs.readFile(restoreEntry, "utf8"), /\.mac-workbuddy\/scripts\/restore-skin-macos\.sh/);

  const forbiddenDirectories = new Set(["presets", "themes", "theme-sources", "tests", "fixtures", "release"]);
  const forbiddenMedia = new Set([".cctheme", ".gif", ".jpeg", ".jpg", ".mov", ".mp4", ".png", ".webm", ".webp"]);
  const knownProductionIds = [["xt", "xg"].join(""), ["wo", "lp"].join("")];
  for (const entry of packageEntries) {
    const segments = entry.relative.toLowerCase().split("/");
    assert.equal(segments.some((segment) => forbiddenDirectories.has(segment)), false,
      `client release contains a forbidden theme/staging directory: ${entry.relative}`);
    if (entry.directory) continue;
    assert.equal(forbiddenMedia.has(path.extname(entry.relative).toLowerCase()), false,
      `client release contains theme media or an installable package: ${entry.relative}`);
    assert.notEqual(path.basename(entry.relative).toLowerCase(), "theme.json",
      `client release contains a theme document: ${entry.relative}`);
    const lower = (await fs.readFile(entry.absolute)).toString("utf8").toLowerCase();
    assert.equal(knownProductionIds.some((id) => lower.includes(id)), false,
      `client release contains a known production theme identity: ${entry.relative}`);
  }

  const retiredMime = Buffer.from(`application/vnd.${retiredBrand}.theme+zip`);
  const retiredScriptNames = [
    `apply-${retiredBrand}-macos.sh`,
    `import-${retiredBrand}.mjs`,
    `${retiredBrand}-package.json`,
  ].map((value) => Buffer.from(value));
  for (const entry of packageEntries) {
    if (entry.directory) continue;
    const bytes = await fs.readFile(entry.absolute);
    assert.equal(bytes.includes(retiredMime), false, `retired MIME remains in ${entry.relative}`);
    for (const retired of retiredScriptNames) {
      assert.equal(bytes.includes(retired), false, `retired script reference remains in ${entry.relative}`);
    }
  }

  const beforeOverwriteAttempt = await fs.readFile(archive);
  await execFile(builder, [output, "--skip-tests"], {
    env: { ...process.env, NODE: process.execPath },
    maxBuffer: 1024 * 1024,
  });
  assert.deepEqual(await fs.readFile(archive), beforeOverwriteAttempt,
    "a repeated unpublished-development client build was not deterministic");

  console.log("PASS: the mac-workbuddy client release contains only the allowlisted Adapter and no production theme, media, staging, or authoring payload.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
