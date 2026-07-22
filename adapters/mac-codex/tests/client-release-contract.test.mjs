import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateBuilder = path.join(root, "scripts", "build-client-release.sh");
const version = (await fs.readFile(path.join(root, "VERSION"), "utf8")).trim();
const releaseManifest = JSON.parse(await fs.readFile(path.join(root, "contracts", "adapter-release-manifest.json"), "utf8"));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-client-release-test-"));
const home = path.join(temporary, "home-a");
const secondHome = path.join(temporary, "home-b");
const archiveName = releaseManifest.artifacts.client;
const archive = path.join(home, "Desktop", archiveName);
const secondArchive = path.join(secondHome, "Desktop", archiveName);
const extracted = path.join(temporary, "extracted");
const applyScript = path.join(root, "scripts", "apply-cc-theme-macos.sh");

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
  const builder = candidateBuilder;

  assert.notEqual((await fs.stat(applyScript)).mode & 0o111, 0, "source apply script must be executable");
  const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
  assert.ok(readme.includes(`\`${archiveName}\``));
  assert.ok(readme.includes(`\`${archiveName}.sha256\``));
  assert.ok(readme.includes(`\`${releaseManifest.artifacts.source}\``));
  assert.equal(readme.includes("mac-codex-installer-v0.1.0.zip"), false);
  await fs.mkdir(home, { recursive: true });
  const { stdout } = await execFile(builder, ["--skip-tests"], {
    env: { ...process.env, HOME: home, NODE: process.execPath },
    maxBuffer: 1024 * 1024,
  });
  assert.match(stdout, new RegExp(`Created .*${archiveName.replaceAll(".", "\\.")}`));
  await execFile("/usr/bin/unzip", ["-tq", archive]);

  const checksum = (await fs.readFile(`${archive}.sha256`, "utf8")).trim();
  assert.match(checksum, new RegExp(`^[a-f0-9]{64}  ${archiveName.replaceAll(".", "\\.")}$`));

  await fs.mkdir(secondHome, { recursive: true });
  await execFile(builder, ["--skip-tests"], {
    env: { ...process.env, HOME: secondHome, NODE: process.execPath },
    maxBuffer: 1024 * 1024,
  });
  assert.deepEqual(await fs.readFile(secondArchive), await fs.readFile(archive),
    "two clean client builds must be byte-identical");
  assert.equal(await fs.readFile(`${secondArchive}.sha256`, "utf8"), await fs.readFile(`${archive}.sha256`, "utf8"));

  const originalBytes = await fs.readFile(archive);
  await assert.rejects(execFile(builder, ["--skip-tests"], {
    env: { ...process.env, HOME: home, NODE: process.execPath },
    maxBuffer: 1024 * 1024,
  }), /Refusing to overwrite Adapter release revision/);
  assert.deepEqual(await fs.readFile(archive), originalBytes,
    "a duplicate revision attempt must leave the published archive unchanged");

  await fs.mkdir(extracted, { recursive: true });
  await execFile("/usr/bin/ditto", ["-x", "-k", archive, extracted]);
  assert.deepEqual(await fs.readdir(extracted), ["CC Theme - mac-codex"]);

  const packageRoot = path.join(extracted, "CC Theme - mac-codex");
  const packageEntries = await walk(packageRoot);
  const names = new Set(packageEntries.map((entry) => entry.relative));
  assert.ok(names.has("安装 CC Theme.command"));
  assert.ok(names.has(".mac-codex/contracts/cc-theme-package.json"));
  assert.ok(names.has(".mac-codex/scripts/import-cc-theme.mjs"));
  assert.ok(names.has(".mac-codex/scripts/apply-cc-theme-macos.sh"));
  assert.notEqual(
    (await fs.stat(path.join(packageRoot, ".mac-codex/scripts/apply-cc-theme-macos.sh"))).mode & 0o111,
    0,
    "packaged apply script must be executable",
  );
  assert.equal(packageEntries.some((entry) => entry.relative.startsWith(".mac-codex/tests/")), false,
    "test fixtures and golden inputs must not enter the client release");
  assert.equal(packageEntries.some((entry) => /(^|\/)(?:presets|themes|theme-sources)(\/|$)/.test(entry.relative)), false,
    "production theme directories must not enter the client release");
  assert.equal(packageEntries.some((entry) => /\.(?:cctheme|mp4|mov|webm|png|jpe?g|webp)$/i.test(entry.relative)), false,
    "theme packages and theme media must not enter the client release");
  const engineFiles = packageEntries
    .filter((entry) => !entry.directory && entry.relative.startsWith(".mac-codex/"))
    .map((entry) => entry.relative.slice(".mac-codex/".length))
    .sort();
  assert.deepEqual(engineFiles, [...releaseManifest.entries].sort(),
    "client Engine must exactly match the one machine-readable Adapter release manifest");

  for (const retired of [
    "安装 mac-codex.command",
    ".mac-codex/contracts/codexskin-package.json",
    ".mac-codex/scripts/import-codexskin.mjs",
    ".mac-codex/scripts/apply-codexskin-macos.sh",
  ]) {
    assert.equal(names.has(retired), false, `retired release entry remains: ${retired}`);
  }
  assert.equal(
    packageEntries.some((entry) => /(^|\/)(?:build-codex-skin|[^/]*codexskin[^/]*)($|\/)/i.test(entry.relative)),
    false,
    "retired file or directory name remains in the client ZIP",
  );

  const retiredMime = Buffer.from(["application/vnd.", "codexskin", ".theme+zip"].join(""));
  const retiredJobNamespace = Buffer.from(["com", "openai", "cc-theme-studio"].join("."));
  for (const entry of packageEntries) {
    if (entry.directory) continue;
    const bytes = await fs.readFile(entry.absolute);
    assert.equal(bytes.includes(retiredMime), false, `retired MIME remains in ${entry.relative}`);
    assert.equal(bytes.includes(retiredJobNamespace), false, `retired job namespace remains in ${entry.relative}`);
  }

  console.log("PASS: the CC Theme client release uses the versioned asset name and excludes retired filenames, scripts, and MIME.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
