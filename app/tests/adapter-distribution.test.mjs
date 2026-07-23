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
  ["mac-codex", "mac-codex-26.715.71837-r3-macos-arm64"],
  ["mac-doubao", "mac-doubao-2.19.9-r4-macos-arm64"],
  ["mac-workbuddy", "mac-workbuddy-5.2.6-r4-macos-arm64"],
]);
const expectedRevisions = new Map([
  ["mac-codex", 3],
  ["mac-doubao", 4],
  ["mac-workbuddy", 4],
]);
const expectedPublishedPackages = new Map([
  ["mac-codex", {
    bytes: 1_098_823,
    sha256: "e9e473059cf15847d59101d2e20b633f20406523180e90d42282e6a3f95b34d0",
    manifestSha256: "b78a6bc7c0db07eb3b060e0dd508441c799a203bfe9ed84c025ad1f02f9692c1",
    minimumManagerVersion: "0.2.1",
  }],
  ["mac-doubao", {
    bytes: 187_920,
    sha256: "28a6cb24db0b3ec60583973b62163dca90a27cb37c87ec43d77b5c6ed486cda0",
    manifestSha256: "fbb052ef3cfb99625a6586a09d715f87488d8acd027c23da631961bb127cd394",
    minimumManagerVersion: "0.2.1",
  }],
  ["mac-workbuddy", {
    bytes: 763_027,
    sha256: "90961b9a921e0af4b88cbcbc8e904ab807869ef649c6fd44d9b51cdb4819396c",
    manifestSha256: "e0a26b7a95ec0460d8f8aa241cc404689630118528d29111707899a9658ef586",
    minimumManagerVersion: "0.2.1",
  }],
]);

test("one distribution build produces three verified qualified Mac packages and one cacheable catalog", async (t) => {
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
      {
        bytes: packageRecord.bytes,
        sha256: packageRecord.sha256,
        manifestSha256: packageRecord.manifestSha256,
      },
      {
        bytes: published.bytes,
        sha256: published.sha256,
        manifestSha256: published.manifestSha256,
      },
      `${packageRecord.adapterId} changed bytes without changing its Adapter identity`,
    );
    const verified = await verifyAdapterPackage(path.join(outputDirectory, packageRecord.assetName), {
      expectedArchiveSha256: packageRecord.sha256,
    });
    assert.equal(verified.ok, true);
    assert.equal(verified.manifest.adapterId, packageRecord.adapterId);
    assert.equal(verified.manifest.assetIdentity, expectedIdentities.get(packageRecord.adapterId));
    assert.equal(verified.manifest.adapterReleaseRevision, expectedRevisions.get(packageRecord.adapterId));
    assert.equal(verified.manifest.contracts.minimumManagerVersion, published.minimumManagerVersion);
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
  assert.equal(result.catalog.adapters[0].current.adapterVersion, "26.715.71837");
  assert.equal(result.catalog.adapters[0].releases[0].contracts.minimumManagerVersion, "0.2.1");

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

test("an untrusted published origin is rejected before package bytes are written", async (t) => {
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
