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
  ["mac-codex", "mac-codex-26.715.71837-r2-macos-arm64"],
  ["mac-doubao", "mac-doubao-2.19.9-r2-macos-arm64"],
  ["mac-workbuddy", "mac-workbuddy-5.2.6-r2-macos-arm64"],
]);
const expectedPublishedPackages = new Map([
  ["mac-codex", {
    bytes: 1_083_380,
    sha256: "d30ab16038a11ae5a55d40772953e0198cf15ec9b2c9bc1816026d965a7d54b4",
    manifestSha256: "13dcf5e6dd13104881a1e30fd94cebd69e7bbc7fc07634c1d3837797003fc925",
    minimumManagerVersion: "0.2.1",
  }],
  ["mac-doubao", {
    bytes: 161_537,
    sha256: "9fd79e213e2627333bb111c5e087d1cab259a953424af27729be88a112b9d277",
    manifestSha256: "76aa7d37fae88a243ec44762b9140d11c457dc9d9ee2d62bed997b0166df4895",
    minimumManagerVersion: "0.2.1",
  }],
  ["mac-workbuddy", {
    bytes: 736_560,
    sha256: "abe6bdbca0a0a2714c289b012db1f2df6cc7cd943e7ee2a65d48de003010c4b9",
    manifestSha256: "55903b3136157e0d136cfe3dd3368e5c3886257ba500f0c8ecf10bab7d58fa05",
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
    assert.equal(verified.manifest.adapterReleaseRevision, 2);
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
