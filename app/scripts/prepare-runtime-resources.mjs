import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { verifyAdapterPackage } from "./adapter-package.mjs";
import { managerLayout } from "./workspace-layout.mjs";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const FORBIDDEN_DIRECTORIES = new Set(["presets", "themes", "theme-sources", "fixtures", "tests"]);
const FORBIDDEN_THEME_EXTENSIONS = new Set([".cctheme", ".gif", ".jpeg", ".jpg", ".mov", ".mp4", ".png", ".webm", ".webp"]);
const SAFE_ARCHIVE_ENTRY = /^[A-Za-z0-9._+ -]+(?:\/[A-Za-z0-9._+ -]+)*\/?$/;
const RUNTIME_PACKAGE_FILES = Object.freeze({
  "adapter-sdk": ["adapter-registry.mjs", "workspace-root.mjs", "package.json"],
  "theme-core": ["cli.mjs", "compiler.mjs", "runtime-overrides.mjs", "package.json"],
});
const TRANSITION_PROFILE = "transition-baseline";

function contained(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) return;
  throw new Error(`${label} escaped its trusted root`);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function sha256File(file) {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} fields are not closed`);
  return value;
}

async function listFiles(root, relative = "") {
  const result = [];
  for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Runtime resource must not be a symbolic link: ${child}`);
    if (entry.isDirectory()) result.push(...await listFiles(root, child));
    else if (entry.isFile()) result.push(child);
    else throw new Error(`Runtime resource must be a regular file: ${child}`);
  }
  return result;
}

async function assertEngineBoundary(engineRoot) {
  for (const relative of await listFiles(engineRoot)) {
    const segments = relative.split(path.sep).map((segment) => segment.toLowerCase());
    const forbiddenDirectory = segments.find((segment) => FORBIDDEN_DIRECTORIES.has(segment));
    if (forbiddenDirectory) throw new Error(`Adapter Engine contains forbidden directory ${forbiddenDirectory}: ${relative}`);
    const extension = path.extname(relative).toLowerCase();
    if (FORBIDDEN_THEME_EXTENSIONS.has(extension) || path.basename(relative).toLowerCase() === "theme.json") {
      throw new Error(`Adapter Engine contains production theme content: ${relative}`);
    }
  }
}

async function copyRuntimePackage(sourceRoot, destination, packageName) {
  await fs.mkdir(destination, { recursive: true });
  for (const relative of RUNTIME_PACKAGE_FILES[packageName]) {
    const source = path.join(sourceRoot, relative);
    const metadata = await fs.lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`${packageName} runtime file must be a regular file: ${relative}`);
    }
    await fs.copyFile(source, path.join(destination, relative));
  }
}

async function extractReleaseArchive(workspaceRoot, destination, descriptor) {
  const archive = path.resolve(workspaceRoot, descriptor.source.workspacePath);
  contained(workspaceRoot, archive, "Adapter release archive");
  if (await sha256File(archive) !== descriptor.source.sha256) throw new Error(`${descriptor.adapterId} release archive SHA-256 mismatch`);
  const { stdout } = await execute("/usr/bin/unzip", ["-Z1", archive], { maxBuffer: 8 * 1024 * 1024 });
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  if (!entries.length) throw new Error(`${descriptor.adapterId} release archive is empty`);
  const prefix = `${descriptor.source.archiveRoot}/`;
  for (const entry of entries) {
    if (!SAFE_ARCHIVE_ENTRY.test(entry) || !entry.startsWith(prefix) || entry.includes("/../") || entry.startsWith("/")) {
      throw new Error(`${descriptor.adapterId} release archive contains an unsafe entry`);
    }
  }
  const temporary = `${destination}.archive-${process.pid}`;
  await fs.rm(temporary, { recursive: true, force: true });
  await fs.mkdir(temporary, { recursive: true });
  await execute("/usr/bin/unzip", ["-q", archive, "-d", temporary], { maxBuffer: 8 * 1024 * 1024 });
  const archiveRoot = path.join(temporary, descriptor.source.archiveRoot);
  await fs.rename(archiveRoot, destination);
  await fs.rm(temporary, { recursive: true, force: true });
}

async function buildReleaseEngine(workspaceRoot, destination, descriptor) {
  const builder = path.resolve(workspaceRoot, descriptor.source.workspaceModule);
  const manifest = path.resolve(workspaceRoot, descriptor.source.releaseManifest);
  contained(workspaceRoot, builder, "Adapter release builder");
  contained(workspaceRoot, manifest, "Adapter release manifest");
  await fs.access(manifest);
  await execute(process.execPath, [builder, destination], { cwd: path.dirname(builder), maxBuffer: 8 * 1024 * 1024 });
}

function validateTransitionBaseline(value, managerVersion) {
  exactKeys(value, ["kind", "schemaVersion", "managerVersion", "profile", "adapters"], "transition baseline");
  if (value.kind !== "cc-theme.manager-runtime-profile" || value.schemaVersion !== 1) throw new Error("Transition baseline kind or schemaVersion is invalid");
  if (value.managerVersion !== managerVersion || value.profile !== TRANSITION_PROFILE) throw new Error("Transition baseline Manager identity is invalid");
  if (!Array.isArray(value.adapters) || value.adapters.length !== 3) throw new Error("Transition baseline must contain exactly three Adapters");
  const expectedIds = ["mac-codex", "mac-doubao", "mac-workbuddy"];
  if (JSON.stringify(value.adapters.map(({ adapterId }) => adapterId)) !== JSON.stringify(expectedIds)) {
    throw new Error("Transition baseline Adapter IDs or order are invalid");
  }
  for (const adapter of value.adapters) {
    exactKeys(adapter, ["adapterId", "adapterVersion", "adapterReleaseRevision", "assetIdentity", "source"], `${adapter.adapterId} transition Adapter`);
    exactKeys(adapter.source, ["kind", "capabilityVersion", "releaseTag", "downloadUrl", "bytes", "archiveSha256", "manifestSha256"], `${adapter.adapterId} transition source`);
    if (adapter.source.kind !== "github-release-asset") throw new Error(`${adapter.adapterId} transition source kind is invalid`);
    if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(adapter.source.capabilityVersion)) {
      throw new Error(`${adapter.adapterId} transition capabilityVersion is invalid`);
    }
    const expectedIdentity = `${adapter.adapterId}-${adapter.adapterVersion}-r${adapter.adapterReleaseRevision}-macos-arm64`;
    if (adapter.assetIdentity !== expectedIdentity) throw new Error(`${adapter.adapterId} transition asset identity is invalid`);
    const url = new URL(adapter.source.downloadUrl);
    const expectedPath = `/quanzhankeji/cc-theme/releases/download/${adapter.source.releaseTag}/${adapter.assetIdentity}.ccadapter`;
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== expectedPath || url.search || url.hash || url.username || url.password) {
      throw new Error(`${adapter.adapterId} transition URL is not an exact official Release asset`);
    }
    if (!Number.isSafeInteger(adapter.source.bytes) || adapter.source.bytes < 1 || adapter.source.bytes > 64 * 1024 * 1024) {
      throw new Error(`${adapter.adapterId} transition byte length is invalid`);
    }
    if (!/^[0-9a-f]{64}$/.test(adapter.source.archiveSha256) || !/^[0-9a-f]{64}$/.test(adapter.source.manifestSha256)) {
      throw new Error(`${adapter.adapterId} transition digest is invalid`);
    }
  }
  return value;
}

async function curlDownload(url, destination) {
  await execute("/usr/bin/curl", [
    "--fail", "--silent", "--show-error", "--location",
    "--proto", "=https", "--proto-redir", "=https", "--max-redirs", "5",
    "--connect-timeout", "15", "--max-time", "120",
    "--output", destination, url,
  ], { maxBuffer: 1024 * 1024 });
}

export async function downloadTransitionPackage(cacheRoot, descriptor, managerVersion, { download = curlDownload } = {}) {
  await fs.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  const archive = path.join(cacheRoot, `${descriptor.assetIdentity}.ccadapter`);
  let validCache = false;
  try {
    const stat = await fs.lstat(archive);
    validCache = stat.isFile() && !stat.isSymbolicLink() && stat.size === descriptor.source.bytes && await sha256File(archive) === descriptor.source.archiveSha256;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!validCache) {
    await fs.rm(archive, { force: true });
    const temporary = `${archive}.tmp-${process.pid}`;
    await fs.rm(temporary, { force: true });
    try {
      await download(descriptor.source.downloadUrl, temporary);
      const stat = await fs.lstat(temporary);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== descriptor.source.bytes) throw new Error(`${descriptor.adapterId} downloaded byte length differs from the transition baseline`);
      if (await sha256File(temporary) !== descriptor.source.archiveSha256) throw new Error(`${descriptor.adapterId} downloaded archive SHA-256 differs from the transition baseline`);
      await fs.rename(temporary, archive);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  const verified = await verifyAdapterPackage(archive, {
    expectedArchiveSha256: descriptor.source.archiveSha256,
    expected: {
      adapterId: descriptor.adapterId,
      architecture: "arm64",
      capabilityVersion: descriptor.source.capabilityVersion,
      managerVersion,
      platform: "macos",
      unifiedThemeSchemaVersion: 1,
    },
  });
  if (verified.bytes !== descriptor.source.bytes || verified.manifestSha256 !== descriptor.source.manifestSha256) {
    throw new Error(`${descriptor.adapterId} verified package provenance differs from the transition baseline`);
  }
  if (
    verified.manifest.adapterVersion !== descriptor.adapterVersion ||
    verified.manifest.adapterReleaseRevision !== descriptor.adapterReleaseRevision ||
    verified.manifest.assetIdentity !== descriptor.assetIdentity
  ) throw new Error(`${descriptor.adapterId} verified package identity differs from the transition baseline`);
  return { archive, verified };
}

async function extractVerifiedPackage(destination, archive) {
  const temporary = `${destination}.package-${process.pid}`;
  await fs.rm(temporary, { recursive: true, force: true });
  await fs.mkdir(temporary, { recursive: true });
  try {
    await execute("/usr/bin/unzip", ["-q", archive, "-d", temporary], { maxBuffer: 8 * 1024 * 1024 });
    await fs.rename(path.join(temporary, "payload"), destination);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function verifyRegistry(stageRoot, registry) {
  const adaptersRoot = path.join(stageRoot, "adapters");
  for (const descriptor of registry.adapters) {
    for (const key of ["capabilityFile", "styleCatalogFile", "projectorModule", "normalizerModule"]) {
      const file = path.resolve(adaptersRoot, descriptor[key]);
      contained(adaptersRoot, file, `Registry ${key}`);
      await fs.access(file);
    }
    if (descriptor.projectionFile) await fs.access(path.resolve(adaptersRoot, descriptor.projectionFile));
  }
}

async function artifactManifest(stageRoot, attestation) {
  const files = (await listFiles(stageRoot)).filter((relative) => !relative.startsWith(`test-kit${path.sep}`));
  const entries = [];
  for (const relative of files) {
    if (relative === "artifact-manifest.json") continue;
    const file = path.join(stageRoot, relative);
    const stat = await fs.stat(file);
    entries.push({ path: relative.split(path.sep).join("/"), bytes: stat.size, sha256: await sha256File(file) });
  }
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return {
    kind: "cc-theme.manager-runtime-resources",
    schemaVersion: 2,
    managerVersion: attestation.managerVersion,
    profile: attestation.profile,
    attestationSha256: await sha256File(path.join(stageRoot, "runtime-attestation.json")),
    entries,
  };
}

async function cleanTransientRuntimeResources(managerRoot) {
  for (const entry of await fs.readdir(managerRoot, { withFileTypes: true })) {
    if (!entry.name.startsWith(".runtime-resources-stage-") && !entry.name.startsWith(".runtime-resources-backup-")) continue;
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`Unsafe transient runtime resource: ${entry.name}`);
    await fs.rm(path.join(managerRoot, entry.name), { recursive: true });
  }
}

export async function prepareRuntimeResources({ profile = process.env.CC_THEME_RUNTIME_PROFILE ?? "source-build" } = {}) {
  const layout = await managerLayout(here);
  await cleanTransientRuntimeResources(layout.managerRoot);
  const config = await readJson(path.join(layout.managerRoot, "config", "adapter-engines.json"));
  const managerPackage = await readJson(path.join(layout.managerRoot, "package.json"));
  const transition = profile === TRANSITION_PROFILE
    ? validateTransitionBaseline(
      await readJson(path.join(layout.managerRoot, "config", "transition-baseline.json")),
      managerPackage.version,
    )
    : undefined;
  if (!transition && profile !== "source-build") throw new Error(`Unknown runtime profile: ${profile}`);
  const registryFile = path.join(layout.registryRoot, "adapter-capabilities.json");
  const sourceRegistry = await readJson(registryFile);
  if (config.kind !== "cc-theme.manager-adapter-engine-sources" || config.schemaVersion !== 1 || !Array.isArray(config.adapters)) {
    throw new Error("Manager Adapter Engine source config is invalid");
  }
  if (sourceRegistry.kind !== "cc-theme.adapter-capability-registry" || sourceRegistry.schemaVersion !== 1 || !Array.isArray(sourceRegistry.adapters)) {
    throw new Error("Manager capability registry is invalid");
  }
  const engineByDirectory = new Map(config.adapters.map((descriptor) => [descriptor.bundleDirectory, descriptor]));
  const registry = {
    ...sourceRegistry,
    adapters: sourceRegistry.adapters.map((descriptor) => {
      const engine = engineByDirectory.get(descriptor.outputDirectory);
      if (!engine) throw new Error(`Registered Adapter has no Engine source: ${descriptor.outputDirectory}`);
      return {
        ...descriptor,
        normalizerModule: engine.normalizerModule,
        normalizerExport: engine.normalizerExport,
      };
    }),
  };
  const stageRoot = path.join(layout.managerRoot, `.runtime-resources-stage-${process.pid}`);
  await fs.rm(stageRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(stageRoot, "adapters"), { recursive: true });
  await copyRuntimePackage(layout.adapterSdkRoot, path.join(stageRoot, "adapter-sdk"), "adapter-sdk");
  await copyRuntimePackage(layout.sharedCoreRoot, path.join(stageRoot, "theme-core"), "theme-core");
  await fs.cp(layout.contractsRoot, path.join(stageRoot, "contracts"), { recursive: true, errorOnExist: true });
  await fs.cp(layout.testKitRoot, path.join(stageRoot, "test-kit"), { recursive: true, errorOnExist: true });
  await fs.writeFile(
    path.join(stageRoot, ".cc-theme-workspace.json"),
    `${JSON.stringify({ kind: "cc-theme.workspace", schemaVersion: 1 })}\n`,
    { mode: 0o600 },
  );
  await fs.mkdir(path.join(stageRoot, "capabilities"), { recursive: true });
  await fs.writeFile(
    path.join(stageRoot, "capabilities", "registry.json"),
    `${JSON.stringify(registry, null, 2)}\n`,
    { mode: 0o600 },
  );
  const attestedAdapters = [];
  for (const descriptor of config.adapters) {
    const destination = path.join(stageRoot, "adapters", descriptor.bundleDirectory);
    if (transition) {
      const baseline = transition.adapters.find(({ adapterId }) => adapterId === descriptor.adapterId);
      const { archive, verified } = await downloadTransitionPackage(
        path.join(layout.managerRoot, ".runtime-cache", "transition-baseline"),
        baseline,
        managerPackage.version,
      );
      await extractVerifiedPackage(destination, archive);
      attestedAdapters.push({
        adapterId: verified.manifest.adapterId,
        adapterVersion: verified.manifest.adapterVersion,
        adapterReleaseRevision: verified.manifest.adapterReleaseRevision,
        assetIdentity: verified.manifest.assetIdentity,
        source: baseline.source,
      });
    } else {
      if (descriptor.source.kind === "release-archive") await extractReleaseArchive(layout.workspaceRoot, destination, descriptor);
      else if (descriptor.source.kind === "release-builder") await buildReleaseEngine(layout.workspaceRoot, destination, descriptor);
      else throw new Error(`Unknown Adapter Engine source kind: ${descriptor.source.kind}`);
      const release = await readJson(path.join(destination, "contracts", "adapter-release-manifest.json"));
      attestedAdapters.push({
        adapterId: release.adapterId,
        adapterVersion: release.adapterVersion,
        adapterReleaseRevision: release.adapterReleaseRevision,
        assetIdentity: release.assetIdentity,
        source: { kind: "workspace-source" },
      });
    }
    await assertEngineBoundary(destination);
  }
  await verifyRegistry(stageRoot, registry);
  const attestation = {
    kind: "cc-theme.manager-runtime-attestation",
    schemaVersion: 1,
    managerVersion: managerPackage.version,
    profile,
    adapters: attestedAdapters,
  };
  await fs.writeFile(path.join(stageRoot, "runtime-attestation.json"), `${JSON.stringify(attestation, null, 2)}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(stageRoot, "artifact-manifest.json"), `${JSON.stringify(await artifactManifest(stageRoot, attestation), null, 2)}\n`, { mode: 0o600 });
  const backup = path.join(layout.managerRoot, `.runtime-resources-backup-${process.pid}`);
  await fs.rm(backup, { recursive: true, force: true });
  try {
    await fs.rename(layout.runtimeResourcesRoot, backup);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.rename(stageRoot, layout.runtimeResourcesRoot);
  await fs.rm(backup, { recursive: true, force: true });
  return layout.runtimeResourcesRoot;
}

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  prepareRuntimeResources()
    .then((root) => process.stdout.write(`Runtime resources prepared: ${root}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
