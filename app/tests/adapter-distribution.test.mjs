import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { buildAdapterDistribution } from "../scripts/build-adapter-packages.mjs";
import { verifyAdapterPackage } from "../scripts/adapter-package.mjs";

const execute = promisify(execFile);
const expectedIdentities = new Map([
  ["mac-codex", "mac-codex-26.715.61943-r1-macos-arm64"],
  ["mac-doubao", "mac-doubao-2.19.9-r1-macos-arm64"],
  ["mac-workbuddy", "mac-workbuddy-5.2.6-r1-macos-arm64"],
]);
const expectedPublishedPackages = new Map([
  ["mac-codex", {
    bytes: 1_074_742,
    sha256: "9510a2e6ac84fe930eebbf8d07e6b0b1dd3d4d1d9891ac41c944c59809fc97f7",
    manifestSha256: "2a3df4f94dd19f4989606c4bd6458361b529f1ed461f8ad6bf27ed7275728d5c",
  }],
  ["mac-doubao", {
    bytes: 156_913,
    sha256: "fb2412cc21fe1821769a940e730ea38f372f8a7271d696b466488ff57c60bc1d",
    manifestSha256: "902cc26c3d3581346cb34bdcffa510e6e4571696cc37f32e2585e328d2443213",
  }],
  ["mac-workbuddy", {
    bytes: 729_254,
    sha256: "2accd2142ad6e5a868d150972859c0b07cee4e25a01f74d476e2570c65c8d886",
    manifestSha256: "c035da2c8615411ec35878b09ef7b47901f708d896c0713e93d2a10187951947",
  }],
]);

test("one distribution build produces three verified Mac packages and one cacheable catalog", async (t) => {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-adapter-distribution-"));
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  const result = await buildAdapterDistribution({ outputDirectory, architecture: "arm64" });
  const registry = JSON.parse(await fs.readFile(new URL("../registry/adapter-capabilities.json", import.meta.url), "utf8"));

  assert.deepEqual(result.packages.map(({ adapterId }) => adapterId), ["mac-codex", "mac-doubao", "mac-workbuddy"]);
  assert.equal(result.catalog.publicationStatus, "development-local");
  assert.equal(JSON.stringify(result.catalog).includes("windows"), false);
  for (const packageRecord of result.packages) {
    const published = expectedPublishedPackages.get(packageRecord.adapterId);
    assert.equal(packageRecord.assetName, `${expectedIdentities.get(packageRecord.adapterId)}.ccadapter`);
    assert.deepEqual(
      { bytes: packageRecord.bytes, sha256: packageRecord.sha256, manifestSha256: packageRecord.manifestSha256 },
      published,
      `${packageRecord.adapterId} changed bytes without changing its immutable Adapter identity`,
    );
    const verified = await verifyAdapterPackage(path.join(outputDirectory, packageRecord.assetName), {
      expectedArchiveSha256: packageRecord.sha256,
    });
    assert.equal(verified.ok, true);
    assert.equal(verified.manifest.adapterId, packageRecord.adapterId);
    assert.equal(verified.manifest.assetIdentity, expectedIdentities.get(packageRecord.adapterId));
    assert.equal(verified.manifest.adapterReleaseRevision, 1);
    assert.equal(verified.manifest.contracts.minimumManagerVersion, "0.2.0");
    const extracted = path.join(outputDirectory, `extracted-${packageRecord.adapterId}`);
    await fs.mkdir(extracted);
    await execute("/usr/bin/unzip", ["-q", path.join(outputDirectory, packageRecord.assetName), "-d", extracted]);
    const descriptor = registry.adapters.find(({ capabilityFile }) => capabilityFile.startsWith(`${packageRecord.adapterId}/`));
    const payload = path.join(extracted, "payload");
    const sourcePrefix = `${packageRecord.adapterId}/`;
    const projectorRelative = descriptor.projectorModule.slice(sourcePrefix.length);
    const normalizerRelative = descriptor.normalizerModule.slice(sourcePrefix.length);
    const projector = await import(pathToFileURL(path.join(payload, projectorRelative)).href);
    const normalizer = await import(pathToFileURL(path.join(payload, normalizerRelative)).href);
    assert.equal(typeof projector[descriptor.projectorExport], "function");
    assert.equal(typeof normalizer[descriptor.normalizerExport], "function");
  }
  for (const adapter of result.catalog.adapters) {
    assert.equal(adapter.releases[0].packages.length, 1);
    assert.equal(adapter.releases[0].packages[0].platform, "macos");
    assert.equal(adapter.releases[0].packages[0].architecture, "arm64");
    assert.equal(adapter.releases[0].packages[0].downloadUrl, undefined);
  }

  await assert.rejects(
    buildAdapterDistribution({ outputDirectory, architecture: "arm64" }),
    /outputDirectory must be empty/,
  );
});

test("published distribution requires a download origin before packaging begins", async (t) => {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-adapter-published-"));
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  await assert.rejects(
    buildAdapterDistribution({ outputDirectory, publicationStatus: "published" }),
    /requires an HTTPS download base URL/,
  );
  assert.deepEqual(await fs.readdir(outputDirectory), []);
});

test("a late catalog failure leaves the requested distribution directory unchanged", async (t) => {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-adapter-atomic-"));
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  await assert.rejects(
    buildAdapterDistribution({
      outputDirectory,
      publicationStatus: "published",
      downloadBaseUrl: "http://untrusted.example/releases",
    }),
    /must use HTTPS/,
  );
  assert.deepEqual(await fs.readdir(outputDirectory), []);
});
