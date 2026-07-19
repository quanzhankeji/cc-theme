import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { assembleAdapterRelease, assertAdapterReleaseBoundary } from "../scripts/adapter-release.mjs";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builder = path.join(root, "scripts", "adapter-release.mjs");
const manifestPath = path.join(root, "contracts", "adapter-release-manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const ownership = JSON.parse(await fs.readFile(path.join(root, "contracts", "adapter-resource-ownership.json"), "utf8"));
const project = JSON.parse(await fs.readFile(path.join(root, "PROJECT_MANIFEST.json"), "utf8"));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "mac-claude-adapter-release-"));

async function copyAllowlistedSource(name) {
  const sourceRoot = path.join(temporary, name);
  for (const relative of manifest.entries) {
    const source = path.join(root, relative);
    const destination = path.join(sourceRoot, relative);
    const metadata = await fs.stat(source);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    await fs.chmod(destination, metadata.mode & 0o777);
  }
  return sourceRoot;
}

try {
  assert.equal(manifest.kind, "claude-adapter.release-manifest");
  assert.equal(manifest.revision, 1);
  assert.equal(manifest.adapterId, "mac-claude");
  assert.equal(manifest.adapterVersion, "1.22209.3");
  assert.equal(manifest.adapterReleaseRevision, 1);
  assert.equal(manifest.releaseStatus, "development-unpublished");
  assert.equal(manifest.developmentOverwriteAllowed, true);
  assert.equal(manifest.immutableAfterFirstPublication, true);
  assert.equal(manifest.projectStatus, "preserved-source");
  assert.equal(manifest.managerRegistrationStatus, "paused");
  assert.equal(manifest.managerDistributionAllowed, false);
  assert.equal(manifest.os, "macos");
  assert.equal(manifest.arch, "arm64");
  assert.equal(manifest.runtimeApplyAvailable, false);
  assert.deepEqual(manifest.entries, [...manifest.entries].sort(), "release manifest must be deterministic");
  assert.equal(new Set(manifest.entries).size, manifest.entries.length, "release manifest must not contain duplicates");
  assert.equal(project.entrypoints.assembleRuntimeRelease, "scripts/adapter-release.mjs");
  assert.equal(project.contracts.adapterReleaseManifest, "contracts/adapter-release-manifest.json");
  assert.equal(ownership.runtimeRelease.manifest, project.contracts.adapterReleaseManifest);
  assert.equal(ownership.runtimeRelease.builder, project.entrypoints.assembleRuntimeRelease);
  assert.equal(ownership.runtimeRelease.runtimeApplyAvailable, false);
  assert.equal(ownership.runtimeRelease.productionMediaAllowed, false);
  assert.equal(ownership.runtimeRelease.symbolicLinksAllowed, false);
  assert(ownership.runtimeRelease.forbiddenPathSegments.includes("docs"));

  const output = path.join(temporary, "runtime");
  const files = await assembleAdapterRelease(output);
  assert.deepEqual(files, [...manifest.entries].sort());
  assert.deepEqual(await assertAdapterReleaseBoundary(output, manifest.entries), files);

  for (const required of [
    "assets/background-effects.js",
    "assets/renderer-inject.js",
    "assets/skin.css",
    "assets/ui-interpreter.js",
    "compatibility/claude-macos/1.22209.3/host-evidence.json",
    "compatibility/claude-macos/1.22209.3/ui-surface-catalog.json",
    "contracts/adapter-capability.json",
    "contracts/adapter-release-manifest.json",
    "contracts/skin-theme.schema.json",
    "contracts/theme-style-catalog.json",
    "scripts/adapter-capability.mjs",
    "scripts/adapter-release.mjs",
    "scripts/diagnostic-preview.mjs",
    "scripts/injector.mjs",
    "scripts/project-unified-theme.mjs",
    "scripts/skin-theme.mjs",
  ]) {
    assert.ok(files.includes(required), `runtime release is missing ${required}`);
  }

  const forbiddenSegments = new Set(["docs", "fixtures", "presets", "release", "tests", "theme-sources", "themes"]);
  const forbiddenExtensions = new Set([".cctheme", ".gif", ".jpeg", ".jpg", ".mov", ".mp4", ".png", ".webm", ".webp", ".zip"]);
  for (const file of files) {
    assert.equal(file.split(path.sep).some((segment) => forbiddenSegments.has(segment.toLowerCase())), false, `forbidden runtime path: ${file}`);
    assert.equal(forbiddenExtensions.has(path.extname(file).toLowerCase()), false, `production media leaked into runtime: ${file}`);
    assert.notEqual(path.basename(file).toLowerCase(), "theme.json", `production theme leaked into runtime: ${file}`);
  }

  const capability = JSON.parse(await fs.readFile(path.join(output, "contracts", "adapter-capability.json"), "utf8"));
  assert.equal(capability.adapterId, "mac-claude");
  assert.equal(capability.adapterVersion, manifest.adapterVersion);
  assert.equal(capability.adapterReleaseRevision, manifest.adapterReleaseRevision);
  assert.equal(capability.availability.status, "projection-only");
  assert.equal(capability.availability.runtimeApplyAvailable, false);
  assert.equal(capability.availability.managerApplyAllowed, false);
  assert.equal(capability.availability.diagnosticPreviewAvailable, true);

  await assert.rejects(
    assembleAdapterRelease(output),
    /destination already exists/,
    "builder must not merge into a stale destination",
  );

  const cliOutput = path.join(temporary, "cli-runtime");
  await assert.rejects(
    execFile(process.execPath, [builder, cliOutput]),
    /Manager registration is paused; runtime Engine delivery is disabled/,
  );
  await assert.rejects(fs.access(cliOutput), { code: "ENOENT" });

  const cleanSource = await copyAllowlistedSource("clean-source");
  await assert.rejects(fs.access(path.join(cleanSource, "release")), { code: "ENOENT" });
  const cleanOutput = path.join(temporary, "clean-output");
  assert.deepEqual(await assembleAdapterRelease(cleanOutput, { sourceRoot: cleanSource }), files);

  const symlinkSource = await copyAllowlistedSource("symlink-source");
  const symlinkEntry = path.join(symlinkSource, "assets", "skin.css");
  await fs.rm(symlinkEntry);
  await fs.symlink("background-effects.js", symlinkEntry);
  const symlinkOutput = path.join(temporary, "symlink-output");
  await assert.rejects(
    assembleAdapterRelease(symlinkOutput, { sourceRoot: symlinkSource }),
    /must not be a symbolic link/,
  );
  await assert.rejects(fs.access(symlinkOutput), { code: "ENOENT" }, "failed staging must not publish a partial runtime");

  const mediaSource = await copyAllowlistedSource("media-source");
  await fs.writeFile(
    path.join(mediaSource, "assets", "skin.css"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  await assert.rejects(
    assembleAdapterRelease(path.join(temporary, "media-output"), { sourceRoot: mediaSource }),
    /contains media or a nested installable package/,
  );

  const capabilitySource = await copyAllowlistedSource("capability-source");
  const capabilityFile = path.join(capabilitySource, "contracts", "adapter-capability.json");
  const unsafeCapability = JSON.parse(await fs.readFile(capabilityFile, "utf8"));
  unsafeCapability.availability.status = "available";
  unsafeCapability.availability.runtimeApplyAvailable = true;
  unsafeCapability.availability.managerApplyAllowed = true;
  await fs.writeFile(capabilityFile, `${JSON.stringify(unsafeCapability, null, 2)}\n`);
  await assert.rejects(
    assembleAdapterRelease(path.join(temporary, "capability-output"), { sourceRoot: capabilitySource }),
    /must remain projection-only with runtime apply disabled/,
  );

  console.log("adapter-release-builder.test.mjs: ok");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
