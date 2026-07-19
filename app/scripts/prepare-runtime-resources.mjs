import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

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

async function artifactManifest(stageRoot) {
  const files = (await listFiles(stageRoot)).filter((relative) => !relative.startsWith(`test-kit${path.sep}`));
  const entries = [];
  for (const relative of files) {
    if (relative === "artifact-manifest.json") continue;
    const file = path.join(stageRoot, relative);
    const stat = await fs.stat(file);
    entries.push({ path: relative.split(path.sep).join("/"), bytes: stat.size, sha256: await sha256File(file) });
  }
  return { kind: "cc-theme.manager-runtime-resources", schemaVersion: 1, entries };
}

async function cleanTransientRuntimeResources(managerRoot) {
  for (const entry of await fs.readdir(managerRoot, { withFileTypes: true })) {
    if (!entry.name.startsWith(".runtime-resources-stage-") && !entry.name.startsWith(".runtime-resources-backup-")) continue;
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`Unsafe transient runtime resource: ${entry.name}`);
    await fs.rm(path.join(managerRoot, entry.name), { recursive: true });
  }
}

export async function prepareRuntimeResources() {
  const layout = await managerLayout(here);
  await cleanTransientRuntimeResources(layout.managerRoot);
  const config = await readJson(path.join(layout.managerRoot, "config", "adapter-engines.json"));
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
  for (const descriptor of config.adapters) {
    const destination = path.join(stageRoot, "adapters", descriptor.bundleDirectory);
    if (descriptor.source.kind === "release-archive") await extractReleaseArchive(layout.workspaceRoot, destination, descriptor);
    else if (descriptor.source.kind === "release-builder") await buildReleaseEngine(layout.workspaceRoot, destination, descriptor);
    else throw new Error(`Unknown Adapter Engine source kind: ${descriptor.source.kind}`);
    await assertEngineBoundary(destination);
  }
  await verifyRegistry(stageRoot, registry);
  await fs.writeFile(path.join(stageRoot, "artifact-manifest.json"), `${JSON.stringify(await artifactManifest(stageRoot), null, 2)}\n`, { mode: 0o600 });
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
