import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relative) {
  return fs.readFile(path.join(root, relative), "utf8");
}

test("application release versions remain aligned", async () => {
  const workspace = JSON.parse(await read("package.json"));
  const manager = JSON.parse(await read("app/package.json"));
  const tauri = JSON.parse(await read("app/src-tauri/tauri.conf.json"));
  const cargo = await read("app/src-tauri/Cargo.toml");
  const registry = JSON.parse(await read("app/registry/adapter-versions.json"));

  assert.equal(workspace.version, "0.2.0");
  assert.equal(manager.version, workspace.version);
  assert.equal(tauri.version, workspace.version);
  assert.match(cargo, new RegExp(`^version = "${workspace.version.replaceAll(".", "\\.")}"$`, "m"));
  for (const adapter of registry.adapters) {
    for (const release of adapter.releases) {
      assert.equal(release.contracts.minimumManagerVersion, workspace.version);
    }
  }
});

test("formal Release workflow is manual, tag-pinned, non-overwriting, and exact", async () => {
  const workflow = await read(".github/workflows/release.yml");

  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|release|pull_request):/m);
  assert.match(workflow, /ref: refs\/tags\/\$\{\{ inputs\.tag \}\}/);
  assert.match(workflow, /EXPECTED_TAG="cc-theme-v\$\{VERSION\}"/);
  assert.match(workflow, /CC\.Theme_\$\{VERSION\}_aarch64\.dmg/);
  assert.match(workflow, /GitHub normalizes spaces/);
  assert.match(workflow, /git rev-list -n 1 "\$RELEASE_TAG"/);
  assert.match(workflow, /npm --prefix app run adapter:build/);
  assert.match(workflow, /mac-codex-26\.715\.31925-r1-macos-arm64\.ccadapter/);
  assert.match(workflow, /mac-workbuddy-5\.2\.6-r1-macos-arm64\.ccadapter/);
  assert.match(workflow, /hdiutil verify/);
  assert.match(workflow, /xcrun stapler validate/);
  assert.match(workflow, /-eq 2/);
  assert.match(workflow, /APPLICATIONS_LINK="\$MOUNT_POINT\/Applications"/);
  assert.match(workflow, /readlink "\$APPLICATIONS_LINK"/);
  assert.match(workflow, /== "\/Applications"/);
  assert.match(workflow, /codesign --verify --deep --strict/);
  assert.match(workflow, /TeamIdentifier/);
  assert.match(workflow, /wc -l < "\$FINAL_FILE"/);
  assert.doesNotMatch(workflow, /--clobber/);
  assert.doesNotMatch(workflow, /\bmapfile\b/);
  assert.doesNotMatch(workflow, /mac-claude|win-(?:codex|workbuddy|claude)/);
  assert.match(workflow, /The Release remains a draft/);
});
