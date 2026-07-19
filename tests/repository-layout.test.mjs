import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);
const SKIP_DIRECTORIES = new Set([".git", ".runtime-cache", ".runtime-resources", "dist", "node_modules", "release", "target"]);
const PRODUCTION_THEME_DIRECTORIES = new Set(["presets", "themes", "theme-sources"]);
const MEDIA = /\.(?:avif|gif|jpe?g|mov|mp4|png|webm|webp)$/i;
const ALLOWED_MEDIA = [
  /^app\/src-tauri\/icons\//,
  /^app\/src\/assets\/client-icons\//,
  /^adapters\/mac-codex\/tests\/fixtures\/neutral-v2-atlas\.webp$/,
];
const FORBIDDEN_GENERATED_PATHS = [
  /(?:^|\/)(?:--check|dist|target|release|staging|payload|installed|installation|cache)(?:\/|$)/i,
  /(?:^|\/)\.(?:runtime-resources|runtime-cache|adapter-dist)(?:[^/]*)(?:\/|$)/i,
  /(?:^|\/)[^/]+\.app(?:\/|$)/i,
  /\.(?:ccadapter|zip|tar|tar\.gz|tgz|7z|dmg|pkg)$/i,
  /\.(?:exe|dll|dylib|so|a|o|rlib|rmeta)$/i,
  /\.(?:sha256|sha256sum)(?:\.txt)?$/i,
  /(?:^|\/)SHA256SUMS(?:\.[^/]*)?$/i,
  /(?:^|\/)(?:artifact-manifest|archive-summary|release-summary)\.[^/]+$/i,
  /\.ccadapter\.manifest\.json$/i,
];

async function readJson(relative) {
  return JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
}

async function exists(relative) {
  try {
    await fs.access(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

async function walk(relative) {
  const output = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) output.push({ path: child, kind: "symlink" });
    else if (entry.isDirectory()) {
      output.push({ path: child, kind: "directory" });
      if (!SKIP_DIRECTORIES.has(entry.name)) output.push(...await walk(child));
    } else if (entry.isFile()) output.push({ path: child, kind: "file" });
  }
  return output;
}

async function isIgnored(relative) {
  try {
    await run("git", ["check-ignore", "--no-index", "--quiet", "--", relative], { cwd: root });
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

async function gitCandidateFiles() {
  const result = await run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root });
  const candidates = result.stdout.split("\0").filter(Boolean);
  const present = [];
  for (const relative of candidates) {
    if (await exists(relative)) present.push(relative);
  }
  return present;
}

test("only the approved Monorepo top-level source layout exists", async () => {
  for (const retired of ["apps", "packages", "registry", "tools", "theme-manager", "mac-app", "mac-codex", "mac-workbuddy", "mac-claude", "win-codex", "win-workbuddy", "win-claude", "contracts", "research"] ) {
    assert.equal(await exists(retired), false, retired);
  }
  for (const required of ["app", "adapters/mac-codex", "adapters/mac-workbuddy", "adapters/mac-claude", "adapters/win-codex", "adapters/win-workbuddy", "adapters/win-claude", "app/packages/shared-core", "app/packages/adapter-sdk", "app/packages/contracts", "app/packages/test-kit", "app/registry", "app/scripts/build_and_run.sh", "docs", "tests"]) {
    assert.equal(await exists(required), true, required);
  }
  assert.deepEqual(await readJson(".cc-theme-workspace.json"), { kind: "cc-theme.workspace", schemaVersion: 1 });
  assert.equal(await exists("package-lock.json"), true, "root package-lock.json");
  assert.equal(await exists("app/package-lock.json"), false, "app/package-lock.json");
});

test("only the neutral theme scaffold is publishable", async () => {
  for (const relative of [
    "themes/README.md",
    "themes/example/family.json",
    "themes/example/unified-theme.json",
    "themes/example/assets/background.webp",
    "themes/tools/pack-theme.mjs",
    "themes/tests/theme-package.test.mjs",
  ]) assert.equal(await isIgnored(relative), false, relative);

  for (const relative of [
    "themes/dist/example-1.0.0.cctheme",
    "themes/wolp/family.json",
    "themes/xtxg/family.json",
    "themes/private/family.json",
  ]) assert.equal(await isIgnored(relative), true, relative);
});

test("Git candidate tree contains source inputs only", async () => {
  const candidates = await gitCandidateFiles();
  for (const relative of candidates) {
    assert.equal(FORBIDDEN_GENERATED_PATHS.some((pattern) => pattern.test(relative)), false, relative);
  }

  for (const relative of [
    "app/.runtime-resources/adapters/mac-codex/adapter.json",
    "app/.runtime-resources-stage-123/adapters/mac-codex/adapter.json",
    "app/.runtime-cache/download.bin",
    "app/.adapter-dist/mac-codex.ccadapter",
    "app/dist/index.js",
    "app/src-tauri/target/release/cc-theme",
    "adapters/mac-codex/release/mac-codex-Source.zip",
    "adapters/mac-workbuddy/--check/PROJECT_MANIFEST.json",
    "adapters/mac-workbuddy/staging/payload/engine.js",
    "local/installed/CC Theme.app/Contents/MacOS/cc-theme",
    "local/cache/mac-codex.ccadapter.manifest.json",
    "local/archive-summary.json",
  ]) assert.equal(await isIgnored(relative), true, relative);

  const catalog = await readJson("app/registry/adapter-versions.json");
  assert.equal(catalog.kind, "cc-theme.adapter-release-catalog");
  assert.equal(catalog.publicationStatus, "development-local");
  for (const adapter of catalog.adapters) {
    const current = adapter.releases.find((release) =>
      release.adapterVersion === adapter.current.adapterVersion &&
      release.adapterReleaseRevision === adapter.current.adapterReleaseRevision);
    assert.ok(current, `${adapter.adapterId} current release`);
    for (const release of adapter.releases) {
      assert.deepEqual(release.packages, [], `${adapter.adapterId}@${release.adapterVersion}-r${release.adapterReleaseRevision}`);
    }
  }
  assert.doesNotMatch(JSON.stringify(catalog), /(?:https?:\/\/|file:\/\/|\.ccadapter|[A-Za-z]:\\|\/Users\/|\/home\/)/i);

  for (const adapterId of ["mac-codex", "mac-claude", "mac-workbuddy"]) {
    const directory = `adapters/${adapterId}`;
    const adapterVersion = (await fs.readFile(path.join(root, directory, "VERSION"), "utf8")).trim();
    const project = await readJson(`${directory}/PROJECT_MANIFEST.json`);
    const release = await readJson(`${directory}/contracts/adapter-release-manifest.json`);
    assert.equal(project.adapterId, adapterId, directory);
    assert.equal(release.adapterId, adapterId, directory);
    assert.equal(project.adapterVersion, adapterVersion, directory);
    assert.equal(release.adapterVersion, adapterVersion, directory);
    assert.equal(project.adapterReleaseRevision, release.adapterReleaseRevision, directory);
    assert.equal(Number.isSafeInteger(release.adapterReleaseRevision), true, directory);
    assert.equal(release.adapterReleaseRevision > 0, true, directory);
  }
});

test("source Modules contain no production themes, production media, or symlinks", async () => {
  const entries = [
    ...await walk("app"),
    ...await walk("adapters"),
  ];
  for (const entry of entries) {
    assert.notEqual(entry.kind, "symlink", entry.path);
    const basename = path.posix.basename(entry.path).toLowerCase();
    if (entry.kind === "directory") assert.equal(PRODUCTION_THEME_DIRECTORIES.has(basename), false, entry.path);
    if (entry.kind === "file" && MEDIA.test(entry.path)) {
      assert.equal(ALLOWED_MEDIA.some((pattern) => pattern.test(entry.path)), true, entry.path);
    }
    assert.equal(entry.path.toLowerCase().endsWith(".cctheme"), false, entry.path);
  }
});

test("catalog stays local and only active Adapter source paths close", async () => {
  const ignore = await fs.readFile(path.join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^\/catalog\/$/m);
  const tracked = await run("git", ["ls-files", "--", "catalog"], { cwd: root });
  const visible = await run("git", ["status", "--porcelain", "--untracked-files=all", "--", "catalog"], { cwd: root });
  assert.equal(tracked.stdout.trim(), "");
  assert.equal(visible.stdout.trim(), "");
  const registry = await readJson("app/registry/adapter-capabilities.json");
  const activeAdapterIds = ["mac-codex", "mac-workbuddy"];
  assert.deepEqual(registry.adapters.map(({ capabilityFile }) => capabilityFile.split("/")[0]), activeAdapterIds);
  for (const descriptor of registry.adapters) {
    for (const key of ["capabilityFile", "styleCatalogFile", "projectorModule", "normalizerModule"]) {
      assert.equal(await exists(path.posix.join("adapters", descriptor[key])), true, `${key}: ${descriptor[key]}`);
    }
  }
  const engineSources = await readJson("app/config/adapter-engines.json");
  const versions = await readJson("app/registry/adapter-versions.json");
  const workspace = await readJson("package.json");
  const ci = await fs.readFile(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.deepEqual(engineSources.adapters.map(({ adapterId }) => adapterId), activeAdapterIds);
  assert.deepEqual(versions.adapters.map(({ adapterId }) => adapterId), activeAdapterIds);
  assert.deepEqual(workspace.workspaces.filter((entry) => entry.startsWith("adapters/mac-")), activeAdapterIds.map((id) => `adapters/${id}`));
  assert.doesNotMatch(ci, /(?:^|\n)\s{2}mac-claude:/);
  for (const value of [registry, engineSources, versions]) assert.doesNotMatch(JSON.stringify(value), /mac-claude/);
  assert.equal(await exists("adapters/mac-claude"), true, "preserved mac-claude source");
});

test("Windows remains paused and outside workspace, Manager resources, CI, and release inputs", async () => {
  const workspace = await readJson("package.json");
  assert.equal(workspace.workspaces.some((entry) => entry.includes("win-")), false);
  for (const adapter of ["win-codex", "win-workbuddy", "win-claude"]) {
    const status = await fs.readFile(path.join(root, "adapters", adapter, "STATUS.md"), "utf8");
    assert.match(status, /paused-by-user/);
  }
  const managerRegistry = JSON.stringify(await readJson("app/registry/adapter-capabilities.json"));
  const engineSources = JSON.stringify(await readJson("app/config/adapter-engines.json"));
  const ci = await fs.readFile(path.join(root, ".github/workflows/ci.yml"), "utf8");
  for (const value of [managerRegistry, engineSources, ci]) assert.doesNotMatch(value, /win-(?:codex|workbuddy|claude)/);
});

test("Tauri consumes staged release-gated runtime resources only", async () => {
  const config = await readJson("app/src-tauri/tauri.conf.json");
  const manager = await readJson("app/package.json");
  const ci = await fs.readFile(path.join(root, ".github/workflows/ci.yml"), "utf8");
  const resources = config.bundle.resources;
  assert.equal(resources["../.runtime-resources/adapters"], "adapters");
  assert.equal(Object.values(resources).includes("test-kit"), false);
  for (const [source, destination] of Object.entries(resources)) {
    assert.equal(source.includes("../../../"), false, source);
    assert.equal(source.includes("adapters/mac-"), false, source);
    assert.equal(destination.startsWith("themes"), false, destination);
  }
  assert.match(manager.scripts["tauri:dev"], /prepare:runtime/);
  assert.match(manager.scripts["tauri:build"], /prepare:runtime/);
  assert.match(ci, /npm --prefix app run prepare:runtime[\s\S]*cargo test --manifest-path app\/src-tauri\/Cargo\.toml/);
});

test("active and preserved Adapter source IDs remain canonical", async () => {
  const facts = [
    ["adapters/mac-codex/contracts/adapter-capability.json", "mac-codex"],
    ["adapters/mac-workbuddy/contracts/adapter-capability.json", "mac-workbuddy"],
    ["adapters/mac-claude/contracts/adapter-capability.json", "mac-claude"],
  ];
  for (const [file, adapterId] of facts) assert.equal((await readJson(file)).adapterId, adapterId, file);
});
