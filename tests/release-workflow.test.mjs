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

test("Adapter-only Release workflow is exact-tagged, manifest-derived, closed, and immutable", async () => {
  const workflow = await read(".github/workflows/adapter-release.yml");

  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|release|pull_request):/m);
  assert.match(workflow, /ref: refs\/tags\/\$\{\{ inputs\.tag \}\}/);
  assert.match(workflow, /cc-theme-v\$\{MANAGER_VERSION\/\/\.\/\\\\\.\}-adapters/);
  assert.match(workflow, /git rev-list -n 1 "\$RELEASE_TAG"/);
  assert.match(workflow, /npm --silent --prefix app run adapter:build/);
  assert.match(workflow, /adapter-release-manifest\.json/);
  assert.match(workflow, /const officialAdapters = \["mac-codex", "mac-doubao", "mac-workbuddy"\]/);
  assert.match(workflow, /expected_codex_sha256:/);
  assert.match(workflow, /EXPECTED_CODEX_SHA256.*\^\[0-9a-f\]\{64\}\$/s);
  assert.match(workflow, /CODEX_SHA256.*EXPECTED_CODEX_SHA256/s);
  assert.match(workflow, /--status development-local/);
  assert.match(workflow, /--verify-tag/);
  assert.match(workflow, /--draft/);
  assert.match(workflow, /\.isDraft/);
  assert.match(workflow, /Unexpected Adapter Release asset/);
  assert.match(workflow, /-eq 3/);
  assert.match(workflow, /gh api --paginate --method GET/);
  assert.match(workflow, /select\(\.draft == false\)/);
  assert.match(workflow, /releases\/assets\/\$\{ASSET_ID\}/);
  assert.match(workflow, /PUBLISHED_SHA256.*BUILT_SHA256/);
  assert.match(workflow, /Cross-Release Adapter identity collision/);
  assert.ok(
    workflow.indexOf("Enforce cross-Release Adapter identity immutability")
      < workflow.indexOf("Upload missing assets without replacing any existing bytes"),
  );
  assert.match(workflow, /PUBLISH_CONFIRMATION.*RELEASE_TAG/);
  assert.match(workflow, /repos\/\$\{GITHUB_REPOSITORY\}\/immutable-releases/);
  assert.match(workflow, /--draft=false/);
  assert.doesNotMatch(workflow, /--clobber/);
  assert.doesNotMatch(workflow, /(?:CC Theme|CC\.Theme).*\.dmg|hdiutil|notari[sz]ation/i);
  assert.doesNotMatch(workflow, /mac-claude|win-(?:codex|workbuddy|claude)/);
  assert.doesNotMatch(workflow, /26\.715\.\d+|mac-doubao-2\.19\.9|mac-workbuddy-5\.2\.6/);
  assert.doesNotMatch(workflow, /secrets\.|private[_ -]?key/i);
});

test("signed Adapter metadata gate uses the three-endpoint public allowlist without rewriting sequence one", async () => {
  const workflow = await read(".github/workflows/adapter-metadata.yml");

  assert.match(workflow, /const officialAdapters = \["mac-codex", "mac-doubao", "mac-workbuddy"\]/);
  assert.match(workflow, /const sequenceOneAdapters = \["mac-codex", "mac-workbuddy"\]/);
  assert.match(workflow, /pointer\.sequence === 1 \? sequenceOneAdapters : officialAdapters/);
  assert.match(workflow, /CC_THEME_ADAPTER_ROOT_PUBLIC_KEY_BASE64/);
  assert.doesNotMatch(workflow, /secrets\.|private[_ -]?key/i);
});

test("CI validates mac-doubao as an independent Adapter job", async () => {
  const workflow = await read(".github/workflows/ci.yml");

  assert.match(workflow, /^  mac-doubao:\n/m);
  assert.match(workflow, /working-directory: adapters\/mac-doubao/);
  assert.doesNotMatch(workflow, /(?:^|\n)\s{2}mac-claude:/);
  assert.doesNotMatch(workflow, /(?:^|\n)\s{2}win-(?:codex|workbuddy|claude):/);
});

test("release runbook keeps sequence two behind the downloadable three-entry Manager", async () => {
  const runbook = await read("docs/ADAPTER_RELEASE_ORDER.md");
  const ownership = await read("docs/OWNERSHIP.md");
  const orderedPhases = [
    "Phase 1 — source-freeze",
    "Phase 2 — adapter-release",
    "Phase 3 — manager-release",
    "Phase 4 — catalog-first",
    "Phase 5 — pointer-second",
  ];

  let previous = -1;
  for (const phase of orderedPhases) {
    const position = runbook.indexOf(phase);
    assert.ok(position > previous, `${phase} must follow the preceding publication phase`);
    previous = position;
  }
  assert.match(runbook, /CC Theme 0\.2\.0 accepts at most two Adapter Catalog entries/);
  assert.match(runbook, /sequence 1\s+last-known-good Catalog/);
  assert.match(runbook, /fresh 0\.2\.0 installation without that last-known-good cache/);
  assert.match(runbook, /bundled Adapter Engines and native client launch\s+remain available/);
  assert.match(runbook, /Stable must remain on sequence 1 until a newer Manager/);
  assert.match(runbook, /public Release URL downloads the exact accepted\s+DMG before changing any stable metadata/);
  assert.match(runbook, /Commit the Catalog and detached signature first/);
  assert.match(runbook, /stable pointer as a second commit/);
  assert.match(runbook, /Offline Ed25519 private key material never enters GitHub Actions/);
  assert.match(runbook, /Claude and Windows remain outside this publication sequence/);
  assert.match(ownership, /ADAPTER_RELEASE_ORDER\.md/);
});
