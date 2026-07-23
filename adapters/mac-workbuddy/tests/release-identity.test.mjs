import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadReleaseIdentity } from "../scripts/release-identity.mjs";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "mac-workbuddy-release-identity-"));

try {
  const identity = await loadReleaseIdentity();
  assert.deepEqual(identity, {
    adapterId: "mac-workbuddy",
    adapterVersion: "5.2.6",
    adapterReleaseRevision: 4,
    platform: "macos",
    architecture: "arm64",
    assetIdentity: "mac-workbuddy-5.2.6-r4-macos-arm64",
    sourceArchive: "mac-workbuddy-5.2.6-r4-macos-arm64.zip",
    clientArchive: "cc-theme-mac-workbuddy-5.2.6-r4-macos-arm64.zip",
  });

  const project = JSON.parse(await fs.readFile(path.join(root, "PROJECT_MANIFEST.json"), "utf8"));
  assert.equal(project.host.cfBundleShortVersionString, identity.adapterVersion);
  assert.equal(project.host.compatibilityEvidence.cfBundleVersion, "5.2.6");
  assert.equal(Object.hasOwn(project, "cfBundleVersion"), false,
    "exact host build must remain compatibility evidence, not part of Adapter version identity");
  assert.equal(project.release.publicationStatus, "unpublished-development");
  assert.equal(project.release.overwritePolicy, "replace-unpublished-development-revision");

  const output = path.join(temporary, "output");
  await execFile(path.join(root, "scripts", "build-release.sh"), [output, "--skip-tests"], {
    env: { ...process.env, NODE: process.execPath },
    maxBuffer: 4 * 1024 * 1024,
  });
  const archive = path.join(output, identity.sourceArchive);
  const firstBytes = await fs.readFile(archive);
  const firstHash = crypto.createHash("sha256").update(firstBytes).digest("hex");
  assert.equal((await fs.readFile(`${archive}.sha256`, "utf8")).trim(),
    `${firstHash}  ${identity.sourceArchive}`);
  const { stdout: entries } = await execFile("/usr/bin/unzip", ["-Z1", archive]);
  assert.match(entries, new RegExp(`^${identity.assetIdentity}/PROJECT_MANIFEST\\.json$`, "m"));
  assert.match(entries, new RegExp(`^${identity.assetIdentity}/scripts/release-identity\\.mjs$`, "m"));

  await execFile(path.join(root, "scripts", "build-release.sh"), [output, "--skip-tests"], {
    env: { ...process.env, NODE: process.execPath },
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(crypto.createHash("sha256").update(await fs.readFile(archive)).digest("hex"), firstHash,
    "a repeated unpublished-development source build was not deterministic");

  console.log("PASS: Adapter version follows WorkBuddy ShortVersion and unpublished r4 builds deterministically until first publication.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
