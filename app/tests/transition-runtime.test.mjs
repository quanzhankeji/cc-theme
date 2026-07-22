import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildAdapterPackage } from "../scripts/adapter-package.mjs";
import { downloadTransitionPackage } from "../scripts/prepare-runtime-resources.mjs";

const managerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.dirname(managerRoot);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-transition-runtime-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, "package");
  const built = await buildAdapterPackage({
    sourceRoot: path.join(workspaceRoot, "adapters", "mac-workbuddy"),
    outputDirectory: packageRoot,
    adapterId: "mac-workbuddy",
    architecture: "arm64",
    minimumManagerVersion: "0.2.0",
    unifiedThemeSchemaVersion: 1,
  });
  return {
    root,
    built,
    descriptor: {
      adapterId: built.manifest.adapterId,
      adapterVersion: built.manifest.adapterVersion,
      adapterReleaseRevision: built.manifest.adapterReleaseRevision,
      assetIdentity: built.manifest.assetIdentity,
      source: {
        kind: "github-release-asset",
        capabilityVersion: built.manifest.contracts.capabilityVersion,
        releaseTag: "cc-theme-v0.2.0-adapters.2",
        downloadUrl: `https://github.com/quanzhankeji/cc-theme/releases/download/cc-theme-v0.2.0-adapters.2/${built.assetName}`,
        bytes: built.bytes,
        archiveSha256: built.sha256,
        manifestSha256: built.manifestSha256,
      },
    },
  };
}

test("transition baseline carries the retired bundled CodeX identity without consulting the current Registry", async () => {
  const [baseline, registry, source] = await Promise.all([
    fs.readFile(path.join(managerRoot, "config", "transition-baseline.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(managerRoot, "registry", "adapter-versions.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(managerRoot, "scripts", "prepare-runtime-resources.mjs"), "utf8"),
  ]);
  const oldCodex = baseline.adapters.find(({ adapterId }) => adapterId === "mac-codex");
  assert.equal(oldCodex.assetIdentity, "mac-codex-26.715.31925-r1-macos-arm64");
  assert.equal(oldCodex.source.capabilityVersion, "2.0.0");
  assert.equal(
    registry.adapters.some(({ releases }) => releases.some(({ assetIdentity }) => assetIdentity === oldCodex.assetIdentity)),
    false,
  );
  assert.match(source, /capabilityVersion:\s*descriptor\.source\.capabilityVersion/);
  assert.doesNotMatch(source, /find\(\(\{ assetIdentity \}\) => assetIdentity === descriptor\.assetIdentity\)/);
});

test("a corrupt transition cache is replaced, while a verified cache is reused without downloading", async (t) => {
  const { root, built, descriptor } = await fixture(t);
  const cache = path.join(root, "cache");
  await fs.mkdir(cache);
  const cachedArchive = path.join(cache, built.assetName);
  await fs.writeFile(cachedArchive, Buffer.alloc(built.bytes, 0x41));
  let downloads = 0;
  const download = async (_url, destination) => {
    downloads += 1;
    await fs.copyFile(built.archivePath, destination);
  };
  const first = await downloadTransitionPackage(cache, descriptor, "0.2.1", { download });
  assert.equal(first.verified.sha256, built.sha256);
  assert.equal(downloads, 1);
  const second = await downloadTransitionPackage(cache, descriptor, "0.2.1", {
    download: async () => assert.fail("a verified cache must not redownload"),
  });
  assert.equal(second.verified.manifestSha256, built.manifestSha256);
});

test("transition download fails closed on archive and top-level manifest digest drift", async (t) => {
  const { root, built, descriptor } = await fixture(t);
  const download = async (_url, destination) => fs.copyFile(built.archivePath, destination);
  await assert.rejects(
    downloadTransitionPackage(path.join(root, "archive-drift"), {
      ...descriptor,
      source: { ...descriptor.source, archiveSha256: "0".repeat(64) },
    }, "0.2.1", { download }),
    /downloaded archive SHA-256 differs/,
  );
  await assert.rejects(
    downloadTransitionPackage(path.join(root, "manifest-drift"), {
      ...descriptor,
      source: { ...descriptor.source, manifestSha256: "0".repeat(64) },
    }, "0.2.1", { download }),
    /verified package provenance differs/,
  );
});
