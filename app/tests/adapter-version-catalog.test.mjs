import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildAdapterPackage } from "../scripts/adapter-package.mjs";
import {
  canonicalAdapterIds,
  compareAdapterVersionsDescending,
  generateAdapterVersionCatalog,
  runCli,
  serializeCatalog,
} from "../scripts/generate-adapter-version-catalog.mjs";

const managerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.dirname(managerRoot);
const schemaPath = path.join(managerRoot, "contracts", "adapter-version-catalog.schema.json");
const registryPath = path.join(managerRoot, "registry", "adapter-versions.json");
const generatorPath = path.join(managerRoot, "scripts", "generate-adapter-version-catalog.mjs");
const publishedMetadata = Object.freeze({
  channel: "stable",
  sequence: 1,
  publishedAt: "2026-07-20T15:33:54Z",
  expiresAt: "2027-01-16T15:33:54Z",
  keyId: "cc-theme-adapter-root-2026-07",
  revokedSha256: [],
});

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function withTempDirectory(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cc-theme-adapter-catalog-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeSyntheticWorkspace(root, {
  mismatchAdapter,
  codexAdmissionStatus = "verified",
} = {}) {
  await writeJson(path.join(root, "app", "package.json"), { name: "cc-theme", version: "0.1.0" });
  await writeJson(path.join(root, "app", "packages", "contracts", "unified-theme-v1.schema.json"), {
    properties: { schemaVersion: { const: 1 } },
  });
  for (const adapterId of canonicalAdapterIds) {
    const adapterRoot = path.join(root, "adapters", adapterId);
    await mkdir(path.join(adapterRoot, "contracts"), { recursive: true });
    const adapterVersion = "0.1.0";
    const adapterReleaseRevision = 1;
    const assetIdentity = `${adapterId}-${adapterVersion}-r${adapterReleaseRevision}-macos-arm64`;
    await writeFile(path.join(adapterRoot, "VERSION"), `${adapterVersion}\n`, "utf8");
    await writeJson(path.join(adapterRoot, "package.json"), {
      name: adapterId,
      version: mismatchAdapter === adapterId ? "0.2.0" : "0.1.0",
      ccThemeAdapter: {
        adapterId,
        adapterVersion,
        adapterReleaseRevision,
        platform: "macos",
        architecture: "arm64",
      },
    });
    const evidence = `compatibility/chatgpt-macos/${adapterVersion}/ui-surface-catalog.json`;
    await writeJson(path.join(adapterRoot, "contracts", "adapter-capability.json"), {
      adapterId,
      adapterVersion,
      adapterReleaseRevision,
      capabilityVersion: adapterId === "mac-codex" ? "2.0.0" : 1,
      availability: "available",
      available: true,
      runtimeApplyAvailable: true,
      compatibility: adapterId === "mac-codex" ? {
        surfaceEvidenceIsGate: true,
        currentEvidence: {
          clientVersion: adapterVersion,
          clientBuild: "1",
          surfaceCatalogId: `chatgpt-macos-${adapterVersion}`,
          surfaceCatalogVersion: 1,
        },
      } : { verifiedClientVersions: [adapterVersion] },
    });
    if (adapterId === "mac-codex") {
      await writeJson(path.join(adapterRoot, evidence), {
        kind: "skin.ui-surface-catalog",
        schemaVersion: "1.0.0",
        catalogId: `chatgpt-macos-${adapterVersion}`,
        client: { version: adapterVersion, build: "1" },
        admission: { status: codexAdmissionStatus, failClosed: true },
      });
    }
    const entries = [
      "VERSION",
      "contracts/adapter-capability.json",
      "contracts/adapter-release-manifest.json",
      ...(adapterId === "mac-codex" ? ["PROJECT_MANIFEST.json", evidence] : []),
    ].sort();
    await writeJson(
      path.join(adapterRoot, "contracts", "adapter-release-manifest.json"),
      adapterId === "mac-codex" ? {
        kind: "mac-codex-adapter.release-manifest",
        revision: 1,
        adapterId,
        adapterVersion,
        adapterReleaseRevision,
        os: "macos",
        arch: "arm64",
        assetIdentity,
        artifacts: {
          source: `${assetIdentity}.zip`,
          client: `cc-theme-${assetIdentity}.zip`,
        },
        entries,
      } : {
        kind: adapterId === "mac-doubao"
          ? "mac-doubao-adapter.release-manifest"
          : "workbuddy-adapter.release-manifest",
        revision: 1,
        adapterId,
        adapterVersion,
        adapterReleaseRevision,
        platform: "macos",
        architecture: "arm64",
        assetIdentity,
        entries,
      },
    );
    await writeJson(path.join(adapterRoot, "PROJECT_MANIFEST.json"), {
      adapterId,
      adapterVersion,
      adapterReleaseRevision,
      release: { assetIdentity },
      ...(adapterId === "mac-codex" ? { contracts: { uiEvidenceCatalog: evidence } } : {}),
    });
  }
}

async function writeSyntheticPackage(directory, adapter, mutateSidecar, sourceWorkspace = workspaceRoot) {
  const architecture = "arm64";
  const built = await buildAdapterPackage({
    sourceRoot: path.join(sourceWorkspace, "adapters", adapter.adapterId),
    outputDirectory: directory,
    adapterId: adapter.adapterId,
    architecture,
    minimumManagerVersion: adapter.releases[0].contracts.minimumManagerVersion,
    unifiedThemeSchemaVersion: adapter.releases[0].contracts.unifiedThemeSchemaVersion,
  });
  const sidecar = JSON.parse(await readFile(built.sidecarPath, "utf8"));
  mutateSidecar?.(sidecar);
  sidecar.manifestSha256 = digest(Buffer.from(`${JSON.stringify(sidecar.package, null, 2)}\n`, "utf8"));
  await writeJson(built.sidecarPath, sidecar);
  return built;
}

test("catalog Schema closes every public object and keeps identity, OS, architecture, and contract axes distinct", async () => {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.adapters.items.$ref, "#/$defs/adapter");
  const adapterId = new RegExp(schema.$defs.adapter.properties.adapterId.pattern);
  assert.equal(adapterId.test("mac-codex"), true);
  assert.equal(adapterId.test("mac-future-client"), true);
  assert.equal(adapterId.test("mac-claude-skin"), false);
  assert.equal(schema.$defs.adapter.additionalProperties, false);
  assert.equal(schema.$defs.current.additionalProperties, false);
  assert.equal(schema.$defs.release.additionalProperties, false);
  assert.equal(schema.$defs.contracts.additionalProperties, false);
  assert.equal(schema.$defs.package.additionalProperties, false);
  assert.deepEqual(schema.$defs.package.properties.platform.enum, ["macos", "windows"]);
  assert.deepEqual(schema.$defs.package.properties.architecture.enum, ["arm64", "x86_64", "universal2"]);
  assert.deepEqual(schema.$defs.contracts.required, [
    "minimumManagerVersion",
    "capabilityVersion",
    "unifiedThemeSchemaVersion",
    "adapterPackageSchemaVersion",
  ]);
  assert.equal(new RegExp(schema.$defs.package.properties.downloadUrl.pattern).test("https://github.com/quanzhankeji/cc-theme/releases/download/cc-theme-v0.2.0/mac-codex-26.715.31925-r1-macos-arm64.ccadapter"), true);
  assert.equal(new RegExp(schema.$defs.package.properties.downloadUrl.pattern).test("http://releases.example/a.ccadapter"), false);
});

test("local generation publishes the qualified CodeX source and rejects a separate experimental fixture", async () => {
  const tracked = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(tracked.adapters[0].current.adapterVersion, "26.715.71837");
  assert.equal(tracked.adapters[0].releases[0].contracts.minimumManagerVersion, "0.2.2");

  const generated = await generateAdapterVersionCatalog({ workspaceRoot });
  assert.equal(generated.adapters[0].current.adapterVersion, "26.715.71837");
  assert.equal(generated.adapters[0].releases[0].contracts.minimumManagerVersion, "0.2.2");
  await assert.doesNotReject(
    runCli(["--workspace", workspaceRoot, "--output", registryPath, "--check"]),
  );

  await withTempDirectory(async (root) => {
    const candidateWorkspace = path.join(root, "candidate-workspace");
    await writeSyntheticWorkspace(candidateWorkspace, { codexAdmissionStatus: "experimental" });
    await assert.rejects(
      generateAdapterVersionCatalog({ workspaceRoot: candidateWorkspace }),
      /release Surface qualification is not verified/,
    );
  });

  const generatorSource = await readFile(generatorPath, "utf8");
  assert.equal(/api\.github\.com|octokit|fetch\s*\(/i.test(generatorSource), false);
  assert.deepEqual(
    ["2.0.0-beta.2", "1.9.9", "2.0.0", "2.0.0-beta.11"].sort(compareAdapterVersionsDescending),
    ["2.0.0", "2.0.0-beta.11", "2.0.0-beta.2", "1.9.9"],
  );
});

test("published generation binds exact adjacent package bytes, hashes, manifest digest, OS, and architecture", async () => {
  await withTempDirectory(async (root) => {
    const syntheticWorkspace = path.join(root, "workspace");
    const packageDirectory = path.join(root, "packages");
    await writeSyntheticWorkspace(syntheticWorkspace);
    await mkdir(packageDirectory);
    const local = await generateAdapterVersionCatalog({ workspaceRoot: syntheticWorkspace });
    for (const adapter of local.adapters) {
      await writeSyntheticPackage(packageDirectory, adapter, undefined, syntheticWorkspace);
    }

    const published = await generateAdapterVersionCatalog({
      workspaceRoot: syntheticWorkspace,
      packageDirectory,
      publicationStatus: "published",
      downloadBaseUrl: "https://github.com/quanzhankeji/cc-theme/releases/download/cc-theme-v0.2.0",
      ...publishedMetadata,
    });
    for (const adapter of published.adapters) {
      const packageRecord = adapter.releases[0].packages[0];
      const archive = await readFile(path.join(packageDirectory, packageRecord.assetName));
      assert.equal(packageRecord.platform, "macos");
      assert.equal(packageRecord.architecture, "arm64");
      assert.equal(packageRecord.bytes, archive.byteLength);
      assert.equal(packageRecord.sha256, digest(archive));
      assert.match(packageRecord.manifestSha256, /^[0-9a-f]{64}$/);
      assert.equal(packageRecord.releaseTag, "cc-theme-v0.2.0");
      assert.equal(packageRecord.downloadUrl, `https://github.com/quanzhankeji/cc-theme/releases/download/cc-theme-v0.2.0/${packageRecord.assetName}`);
    }
  });
});

test("published mode requires an HTTPS origin, refuses missing packages, and rejects local Engine version disagreement", async () => {
  await assert.rejects(
    generateAdapterVersionCatalog({ workspaceRoot, publicationStatus: "published" }),
    /requires an HTTPS download base URL/,
  );
  await withTempDirectory(async (root) => {
    await writeSyntheticWorkspace(root);
    await assert.rejects(
      generateAdapterVersionCatalog({
        workspaceRoot: root,
        publicationStatus: "published",
        downloadBaseUrl: "https://github.com/quanzhankeji/cc-theme/releases/download/cc-theme-v0.2.0",
        ...publishedMetadata,
      }),
      /mac-codex has no verified package/,
    );
  });
  await withTempDirectory(async (root) => {
    await writeSyntheticWorkspace(root, { mismatchAdapter: "mac-workbuddy" });
    await assert.rejects(generateAdapterVersionCatalog({ workspaceRoot: root }), /VERSION and package\.json version differ/);
  });
});

test("sidecars fail closed on unknown fields, manifest divergence, and archive tampering", async () => {
  for (const [name, mutate, expected] of [
    ["unknown field", (sidecar) => { sidecar.untrusted = true; }, /unknown fields: untrusted/],
    ["unknown Adapter", (sidecar) => { sidecar.package.adapterId = "win-codex"; }, /manifest digest differs from the archive|package manifest differs from the archive/],
    ["unknown platform", (sidecar) => { sidecar.package.platform = "linux"; }, /manifest digest differs from the archive|package manifest differs from the archive/],
    ["unknown architecture", (sidecar) => { sidecar.package.architecture = "ppc64"; }, /manifest digest differs from the archive|package manifest differs from the archive/],
    ["contract drift", (sidecar) => { sidecar.package.contracts.capabilityVersion = "9.0.0"; }, /manifest digest differs from the archive|package manifest differs from the archive/],
    ["file digest drift", (sidecar) => { sidecar.package.files[0].sha256 = "0".repeat(64); }, /manifest digest differs from the archive|package manifest differs from the archive/],
  ]) {
    await withTempDirectory(async (root) => {
      const syntheticWorkspace = path.join(root, "workspace");
      const packageDirectory = path.join(root, "packages");
      await writeSyntheticWorkspace(syntheticWorkspace);
      await mkdir(packageDirectory);
      const local = await generateAdapterVersionCatalog({ workspaceRoot: syntheticWorkspace });
      await writeSyntheticPackage(packageDirectory, local.adapters[0], mutate, syntheticWorkspace);
      await assert.rejects(
        generateAdapterVersionCatalog({ workspaceRoot: syntheticWorkspace, packageDirectory }),
        expected,
        name,
      );
    });
  }

  await withTempDirectory(async (root) => {
    const syntheticWorkspace = path.join(root, "workspace");
    const packageDirectory = path.join(root, "packages");
    await writeSyntheticWorkspace(syntheticWorkspace);
    await mkdir(packageDirectory);
    const local = await generateAdapterVersionCatalog({ workspaceRoot: syntheticWorkspace });
    const built = await writeSyntheticPackage(packageDirectory, local.adapters[0], undefined, syntheticWorkspace);
    await writeFile(built.archivePath, "tampered archive\n", "utf8");
    await assert.rejects(
      generateAdapterVersionCatalog({ workspaceRoot: syntheticWorkspace, packageDirectory }),
      /byte size differs|SHA-256 differs/,
    );
  });

  await assert.rejects(
    generateAdapterVersionCatalog({ workspaceRoot, downloadBaseUrl: "http://releases.example/" }),
    /must use HTTPS/,
  );
});
