#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildAdapterPackage, verifyAdapterPackage } from "./adapter-package.mjs";
import { generateAdapterVersionCatalog, serializeCatalog } from "./generate-adapter-version-catalog.mjs";
import { managerLayout } from "./workspace-layout.mjs";

const ADAPTER_IDS = Object.freeze(["mac-codex", "mac-workbuddy"]);
const ARCHITECTURES = new Set(["arm64", "x86_64", "universal2"]);

function fail(message) {
  throw new Error(`Adapter distribution build: ${message}`);
}

function nativeArchitecture() {
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "x64") return "x86_64";
  fail(`unsupported build architecture ${process.arch}`);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function buildAdapterDistribution({
  outputDirectory,
  architecture = nativeArchitecture(),
  publicationStatus = "development-local",
  downloadBaseUrl,
  channel,
  sequence,
  publishedAt,
  expiresAt,
  keyId,
  revokedSha256,
} = {}) {
  if (typeof outputDirectory !== "string" || outputDirectory.length === 0) fail("outputDirectory is required");
  if (!ARCHITECTURES.has(architecture)) fail("architecture is unsupported");
  if (!new Set(["development-local", "published"]).has(publicationStatus)) fail("publicationStatus is invalid");
  if (publicationStatus === "published" && !downloadBaseUrl) fail("published output requires an HTTPS download base URL");

  const layout = await managerLayout(path.dirname(fileURLToPath(import.meta.url)));
  const destination = path.resolve(outputDirectory);
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  let existing = [];
  try {
    const stat = await fs.lstat(destination);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("outputDirectory must be a non-symlink directory");
    existing = await fs.readdir(destination);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existing.length !== 0) fail("outputDirectory must be empty so stale packages cannot enter the catalog");

  const managerPackage = await readJson(path.join(layout.managerRoot, "package.json"));
  const themeSchema = await readJson(path.join(layout.contractsRoot, "unified-theme-v1.schema.json"));
  const unifiedThemeSchemaVersion = themeSchema?.properties?.schemaVersion?.const;
  const staging = await fs.mkdtemp(path.join(path.dirname(destination), `.${path.basename(destination)}.tmp-`));
  try {
    const packages = [];
    for (const adapterId of ADAPTER_IDS) {
      const built = await buildAdapterPackage({
        sourceRoot: path.join(layout.adaptersRoot, adapterId),
        outputDirectory: staging,
        adapterId,
        architecture,
        minimumManagerVersion: managerPackage.version,
        unifiedThemeSchemaVersion,
      });
      const verified = await verifyAdapterPackage(built.archivePath, {
        expectedArchiveSha256: built.sha256,
        expected: {
          adapterId,
          architecture,
          capabilityVersion: built.manifest.contracts.capabilityVersion,
          managerVersion: managerPackage.version,
          platform: "macos",
          unifiedThemeSchemaVersion,
        },
      });
      packages.push({
        adapterId,
        assetName: verified.assetName,
        bytes: verified.bytes,
        sha256: verified.sha256,
        manifestSha256: verified.manifestSha256,
      });
    }

    const catalog = await generateAdapterVersionCatalog({
      workspaceRoot: layout.workspaceRoot,
      packageDirectory: staging,
      publicationStatus,
      downloadBaseUrl,
      channel,
      sequence,
      publishedAt,
      expiresAt,
      keyId,
      revokedSha256,
    });
    await fs.writeFile(path.join(staging, "adapter-versions.json"), serializeCatalog(catalog), { mode: 0o600, flag: "wx" });
    try {
      const current = await fs.readdir(destination);
      if (current.length !== 0) fail("outputDirectory changed while the distribution was built");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await fs.rename(staging, destination);
    return {
      outputDirectory: destination,
      catalogPath: path.join(destination, "adapter-versions.json"),
      catalog,
      packages,
    };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail("options must be --name value pairs");
    const name = key.slice(2);
    if (!new Set(["architecture", "download-base-url", "out", "status", "channel", "sequence", "published-at", "expires-at", "key-id", "revoked-sha256"]).has(name)) fail(`unknown option --${name}`);
    if (Object.hasOwn(options, name)) fail(`duplicate option --${name}`);
    options[name] = value;
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const layout = await managerLayout(path.dirname(fileURLToPath(import.meta.url)));
  const result = await buildAdapterDistribution({
    outputDirectory: options.out ?? path.join(layout.managerRoot, ".adapter-dist"),
    architecture: options.architecture ?? nativeArchitecture(),
    publicationStatus: options.status ?? "development-local",
    downloadBaseUrl: options["download-base-url"],
    channel: options.channel,
    sequence: options.sequence === undefined ? undefined : Number(options.sequence),
    publishedAt: options["published-at"],
    expiresAt: options["expires-at"],
    keyId: options["key-id"],
    revokedSha256: options["revoked-sha256"] ? options["revoked-sha256"].split(",").filter(Boolean) : undefined,
  });
  process.stdout.write(`${JSON.stringify({
    kind: "cc-theme.adapter-distribution-build",
    schemaVersion: 1,
    catalog: path.basename(result.catalogPath),
    packages: result.packages,
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
