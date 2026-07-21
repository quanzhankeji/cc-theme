#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANAGED_PATHS = Object.freeze([
  ".cc-theme-workspace.json",
  "adapter-sdk",
  "adapters",
  "capabilities",
  "contracts",
  "runtime-attestation.json",
  "theme-core",
]);
const EXPECTED_ADAPTER_IDS = Object.freeze(["mac-codex", "mac-doubao", "mac-workbuddy"]);
const FORBIDDEN_DIRECTORIES = new Set(["fixtures", "presets", "tests", "theme-sources", "themes"]);
const FORBIDDEN_MEDIA = /\.(?:cctheme|gif|jpe?g|mov|mp4|png|webm|webp)$/i;

function lexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message) {
  throw new Error(`Packaged runtime verification: ${message}`);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) fail(`${label} fields are not closed`);
  return value;
}

async function readJson(filename, label) {
  let value;
  try {
    value = JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    fail(`${label} is unreadable: ${error.message}`);
  }
  return value;
}

async function sha256File(filename) {
  return createHash("sha256").update(await fs.readFile(filename)).digest("hex");
}

async function listFiles(root, relative = "") {
  const result = [];
  for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) fail(`managed runtime contains a symbolic link: ${child}`);
    if (entry.isDirectory()) result.push(...await listFiles(root, child));
    else if (entry.isFile()) result.push(child);
    else fail(`managed runtime contains a non-regular entry: ${child}`);
  }
  return result;
}

async function collectManagedFiles(root) {
  const files = [];
  for (const relative of MANAGED_PATHS) {
    const target = path.join(root, relative);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) fail(`managed runtime path is a symbolic link: ${relative}`);
    if (stat.isDirectory()) files.push(...(await listFiles(root, relative)));
    else if (stat.isFile()) files.push(relative);
    else fail(`managed runtime path is not regular: ${relative}`);
  }
  return files.sort(lexical);
}

function expectedAttestation(baseline) {
  return {
    kind: "cc-theme.manager-runtime-attestation",
    schemaVersion: 1,
    managerVersion: baseline.managerVersion,
    profile: baseline.profile,
    adapters: baseline.adapters.map(({ adapterId, adapterVersion, adapterReleaseRevision, assetIdentity, source }) => ({
      adapterId,
      adapterVersion,
      adapterReleaseRevision,
      assetIdentity,
      source,
    })),
  };
}

export async function verifyRuntimeResources(resourceRoot, baselineFile, managerVersion) {
  const root = path.resolve(resourceRoot);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("resource root must be a non-symlink directory");
  const [baseline, attestation, manifest] = await Promise.all([
    readJson(path.resolve(baselineFile), "transition baseline"),
    readJson(path.join(root, "runtime-attestation.json"), "runtime attestation"),
    readJson(path.join(root, "artifact-manifest.json"), "artifact manifest"),
  ]);
  exactKeys(baseline, ["kind", "schemaVersion", "managerVersion", "profile", "adapters"], "transition baseline");
  if (baseline.managerVersion !== managerVersion || baseline.profile !== "transition-baseline") fail("transition baseline does not match the requested Manager");
  if (JSON.stringify(attestation) !== JSON.stringify(expectedAttestation(baseline))) fail("runtime attestation differs from the exact transition baseline");
  exactKeys(manifest, ["kind", "schemaVersion", "managerVersion", "profile", "attestationSha256", "entries"], "artifact manifest");
  if (
    manifest.kind !== "cc-theme.manager-runtime-resources" || manifest.schemaVersion !== 2 ||
    manifest.managerVersion !== managerVersion || manifest.profile !== "transition-baseline"
  ) fail("artifact manifest identity is invalid");
  const attestationSha256 = await sha256File(path.join(root, "runtime-attestation.json"));
  if (manifest.attestationSha256 !== attestationSha256) fail("artifact manifest does not bind the runtime attestation");
  if (!Array.isArray(manifest.entries)) fail("artifact manifest entries must be an array");
  const manifestPaths = manifest.entries.map(({ path: entryPath }) => entryPath);
  if (JSON.stringify(manifestPaths) !== JSON.stringify([...manifestPaths].sort(lexical)) || new Set(manifestPaths).size !== manifestPaths.length) {
    fail("artifact manifest entries must be sorted and unique");
  }
  const managedFiles = await collectManagedFiles(root);
  if (JSON.stringify(manifestPaths) !== JSON.stringify(managedFiles)) fail("artifact manifest does not close the managed runtime file set");
  for (const entry of manifest.entries) {
    exactKeys(entry, ["path", "bytes", "sha256"], `artifact entry ${entry.path}`);
    const filename = path.resolve(root, entry.path);
    const relative = path.relative(root, filename);
    if (relative.startsWith("..") || path.isAbsolute(relative)) fail(`artifact entry escapes the runtime root: ${entry.path}`);
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.bytes || await sha256File(filename) !== entry.sha256) {
      fail(`artifact entry bytes or SHA-256 differ: ${entry.path}`);
    }
  }
  const adapterEntries = await fs.readdir(path.join(root, "adapters"), { withFileTypes: true });
  if (JSON.stringify(adapterEntries.map(({ name }) => name).sort()) !== JSON.stringify([...EXPECTED_ADAPTER_IDS])) {
    fail("packaged runtime does not contain exactly the three transition Adapters");
  }
  for (const entry of adapterEntries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail(`Adapter runtime is not a regular directory: ${entry.name}`);
  }
  for (const relative of await listFiles(path.join(root, "adapters"))) {
    const lower = relative.toLowerCase();
    const segments = lower.split(path.sep);
    if (segments.some((segment) => FORBIDDEN_DIRECTORIES.has(segment)) || FORBIDDEN_MEDIA.test(lower)) {
      fail(`Adapter runtime contains forbidden theme or media content: ${relative}`);
    }
    if (lower.includes("mac-claude") || lower.includes("win-codex") || lower.includes("win-workbuddy") || lower.includes("win-claude")) {
      fail(`Adapter runtime contains an excluded target: ${relative}`);
    }
  }
  for (const expected of baseline.adapters) {
    const release = await readJson(
      path.join(root, "adapters", expected.adapterId, "contracts", "adapter-release-manifest.json"),
      `${expected.adapterId} release manifest`,
    );
    if (
      release.adapterId !== expected.adapterId || release.adapterVersion !== expected.adapterVersion ||
      release.adapterReleaseRevision !== expected.adapterReleaseRevision || release.assetIdentity !== expected.assetIdentity
    ) fail(`${expected.adapterId} staged Engine identity differs from the transition baseline`);
  }
  return { managerVersion, profile: manifest.profile, attestationSha256, entries: manifest.entries.length };
}

async function main() {
  const [resourceRoot, baselineFile, managerVersion] = process.argv.slice(2);
  if (!resourceRoot || !baselineFile || !managerVersion) fail("usage: verify-runtime-resources.mjs <Resources> <baseline.json> <manager-version>");
  process.stdout.write(`${JSON.stringify({ ok: true, ...await verifyRuntimeResources(resourceRoot, baselineFile, managerVersion) })}\n`);
}

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
