import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assembleAdapterRelease,
  assertAdapterReleaseBoundary,
  loadAdapterReleaseManifest,
} from "../scripts/adapter-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "mac-codex-adapter-release-"));

try {
  const releaseSource = root;

  const { manifest, identity } = await loadAdapterReleaseManifest(releaseSource);
  const adapterVersion = (await fs.readFile(path.join(releaseSource, "VERSION"), "utf8")).trim();
  const expectedIdentity = `mac-codex-${adapterVersion}-r1-macos-arm64`;
  assert.equal(manifest.kind, "mac-codex-adapter.release-manifest");
  assert.equal(manifest.revision, 1, "release-manifest schema revision remains independent");
  assert.equal(manifest.adapterId, "mac-codex");
  assert.equal(manifest.adapterVersion, adapterVersion);
  assert.equal(manifest.adapterReleaseRevision, 1);
  assert(Number.isSafeInteger(manifest.adapterReleaseRevision) && manifest.adapterReleaseRevision > 0);
  assert.equal(identity.assetIdentity, expectedIdentity);
  assert.deepEqual(identity.artifacts, {
    source: `${expectedIdentity}.zip`,
    client: `cc-theme-${expectedIdentity}.zip`,
  });
  assert.deepEqual(manifest.entries, [...manifest.entries].sort());
  assert(manifest.entries.includes("contracts/adapter-release-manifest.json"));
  assert(manifest.entries.includes("scripts/adapter-release.mjs"));
  assert(manifest.entries.some((entry) => entry.startsWith("assets/")));
  assert(manifest.entries.some((entry) => entry.startsWith("compatibility/")));
  assert(manifest.entries.some((entry) => entry.startsWith("contracts/")));
  assert(manifest.entries.some((entry) => entry.startsWith("scripts/")));
  assert(manifest.entries.every((entry) => !/(^|\/)(?:docs|skills|tests|fixtures|presets|themes|theme-sources|release)(\/|$)/.test(entry)));
  assert(manifest.entries.every((entry) => !/\.(?:cctheme|gif|jpe?g|mov|mp4|png|webm|webp)$/i.test(entry)));

  const output = path.join(temporary, "output");
  const result = await assembleAdapterRelease(output, { sourceRoot: releaseSource });
  assert.equal(result.kind, "mac-codex-adapter.release");
  assert.equal(result.adapterId, "mac-codex");
  assert.equal(result.adapterVersion, adapterVersion);
  assert.equal(result.adapterReleaseRevision, 1);
  assert.equal(result.os, "macos");
  assert.equal(result.arch, "arm64");
  assert.equal(result.assetIdentity, expectedIdentity);
  assert.equal(result.files, manifest.entries.length);
  assert(result.bytes > 0);
  assert.deepEqual((await assertAdapterReleaseBoundary(output, manifest.entries)).sort(), [...manifest.entries].sort());
  for (const forbidden of ["docs", "skills", "tests", "presets", "themes", "theme-sources", "release"]) {
    await assert.rejects(fs.access(path.join(output, forbidden)), (error) => error?.code === "ENOENT");
  }
  assert.equal(JSON.parse(await fs.readFile(path.join(output, "contracts/adapter-capability.json"), "utf8")).adapterId, "mac-codex");

  const cleanCheckoutSource = path.join(temporary, "clean-checkout-source");
  await fs.cp(releaseSource, cleanCheckoutSource, { recursive: true });
  await fs.rm(path.join(cleanCheckoutSource, "release"), { recursive: true, force: true });
  const cleanCheckoutResult = await assembleAdapterRelease(
    path.join(temporary, "clean-checkout-output"),
    { sourceRoot: cleanCheckoutSource },
  );
  assert.equal(cleanCheckoutResult.files, manifest.entries.length,
    "runtime assembly must not depend on an ignored release archive");

  const occupied = path.join(temporary, "occupied");
  await fs.mkdir(occupied);
  await fs.writeFile(path.join(occupied, "keep.txt"), "do not overwrite\n");
  await assert.rejects(assembleAdapterRelease(occupied, { sourceRoot: releaseSource }), /must be empty/);

  const copiedSource = path.join(temporary, "source");
  await fs.cp(releaseSource, copiedSource, { recursive: true, verbatimSymlinks: true });
  const outside = path.join(temporary, "outside.css");
  await fs.writeFile(outside, ":root{}\n");
  await fs.rm(path.join(copiedSource, "assets/skin.css"));
  await fs.symlink(outside, path.join(copiedSource, "assets/skin.css"));
  await assert.rejects(
    assembleAdapterRelease(path.join(temporary, "symlink-output"), { sourceRoot: copiedSource }),
    /symbolic link/,
  );

  const traversalSource = path.join(temporary, "traversal-source");
  await fs.cp(releaseSource, traversalSource, { recursive: true });
  const traversalManifestPath = path.join(traversalSource, "contracts/adapter-release-manifest.json");
  const traversalManifest = JSON.parse(await fs.readFile(traversalManifestPath, "utf8"));
  traversalManifest.entries.push("../escape");
  await fs.writeFile(traversalManifestPath, `${JSON.stringify(traversalManifest)}\n`);
  await assert.rejects(
    assembleAdapterRelease(path.join(temporary, "traversal-output"), { sourceRoot: traversalSource }),
    /not normalized|unsafe segment|relative paths/,
  );

  const invalidRevisionSource = path.join(temporary, "invalid-revision-source");
  await fs.cp(releaseSource, invalidRevisionSource, { recursive: true });
  await fs.rm(path.join(invalidRevisionSource, "release"), { recursive: true, force: true });
  const invalidRevisionPath = path.join(invalidRevisionSource, "contracts/adapter-release-manifest.json");
  const invalidRevision = JSON.parse(await fs.readFile(invalidRevisionPath, "utf8"));
  invalidRevision.adapterReleaseRevision = 0;
  await fs.writeFile(invalidRevisionPath, `${JSON.stringify(invalidRevision)}\n`);
  await assert.rejects(loadAdapterReleaseManifest(invalidRevisionSource), /positive integer/);

  const mismatchedPackageSource = path.join(temporary, "mismatched-package-source");
  await fs.cp(releaseSource, mismatchedPackageSource, { recursive: true });
  await fs.rm(path.join(mismatchedPackageSource, "release"), { recursive: true, force: true });
  const mismatchedPackagePath = path.join(mismatchedPackageSource, "package.json");
  const mismatchedPackage = JSON.parse(await fs.readFile(mismatchedPackagePath, "utf8"));
  mismatchedPackage.version = "26.715.31926";
  await fs.writeFile(mismatchedPackagePath, `${JSON.stringify(mismatchedPackage)}\n`);
  await assert.rejects(loadAdapterReleaseManifest(mismatchedPackageSource), /package\.json does not match/);

  const boundary = path.join(temporary, "boundary");
  await fs.mkdir(path.join(boundary, "docs"), { recursive: true });
  await fs.writeFile(path.join(boundary, "docs/readme.txt"), "forbidden\n");
  await assert.rejects(assertAdapterReleaseBoundary(boundary), /forbidden directory/);

  const disguisedMedia = path.join(temporary, "disguised-media");
  await fs.mkdir(path.join(disguisedMedia, "assets"), { recursive: true });
  await fs.writeFile(
    path.join(disguisedMedia, "assets/skin.css"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  await assert.rejects(assertAdapterReleaseBoundary(disguisedMedia), /media or a nested installable package/);

  console.log("PASS: Mac Codex assembles a clean-checkout Adapter runtime from one fixed, theme-free release manifest.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
