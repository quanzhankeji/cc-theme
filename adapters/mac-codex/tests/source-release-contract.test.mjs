import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseManifest = JSON.parse(await fs.readFile(path.join(root, "contracts/adapter-release-manifest.json"), "utf8"));
const archiveName = releaseManifest.artifacts.source;
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "mac-codex-source-release-test-"));

async function cleanCopy(name) {
  const copy = path.join(temporary, name);
  await fs.cp(root, copy, { recursive: true });
  await fs.rm(path.join(copy, "release"), { recursive: true, force: true });
  return copy;
}

async function build(copy) {
  await execFile(path.join(copy, "scripts/build-release.sh"), ["--skip-tests"], {
    cwd: copy,
    env: { ...process.env, NODE: process.execPath },
    maxBuffer: 1024 * 1024,
  });
  return path.join(copy, "release", archiveName);
}

try {
  const [firstRoot, secondRoot] = await Promise.all([
    cleanCopy("source-a"),
    cleanCopy("source-b"),
  ]);
  const firstArchive = await build(firstRoot);
  const secondArchive = await build(secondRoot);
  assert.deepEqual(await fs.readFile(firstArchive), await fs.readFile(secondArchive),
    "two clean source builds must be byte-identical");
  assert.equal(await fs.readFile(`${firstArchive}.sha256`, "utf8"), await fs.readFile(`${secondArchive}.sha256`, "utf8"));

  const originalBytes = await fs.readFile(firstArchive);
  await assert.rejects(build(firstRoot), /Refusing to overwrite Adapter release revision/);
  assert.deepEqual(await fs.readFile(firstArchive), originalBytes,
    "a duplicate revision attempt must not change the first source artifact");

  const listing = (await execFile("/usr/bin/unzip", ["-Z1", firstArchive])).stdout.trim().split("\n");
  assert(listing.every((entry) => entry === "mac-codex/" || entry.startsWith("mac-codex/")));
  assert(listing.includes("mac-codex/contracts/adapter-release-manifest.json"));
  assert.equal(listing.some((entry) => /(^|\/)(?:presets|themes|theme-sources)(\/|$)/.test(entry)), false);
  const releaseFiles = listing
    .filter((entry) => entry.startsWith("mac-codex/") && !entry.endsWith("/"))
    .map((entry) => entry.slice("mac-codex/".length))
    .sort();
  assert.deepEqual(releaseFiles, [...releaseManifest.entries].sort(),
    "source ZIP must exactly match the one machine-readable Adapter release manifest");

  console.log("PASS: source release artifacts are canonical, deterministic, and immutable per release revision.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
