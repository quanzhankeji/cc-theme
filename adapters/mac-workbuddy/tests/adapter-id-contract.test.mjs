import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assembleAdapterRelease } from "../scripts/adapter-release.mjs";
import { ADAPTER_ID, loadAdapterCapability, validateTargetProfile } from "../scripts/adapter-capability.mjs";
import { operationResult } from "../scripts/operation-result.mjs";
import { MAC_WORKBUDDY_ADAPTER_ID, SKIN_THEME_KIND } from "../scripts/skin-theme.mjs";
import { defaultAdapterStateRoot } from "../scripts/adapter-transaction.mjs";
import { defaultThemeRuntimeSettingsRoot } from "../scripts/theme-runtime-settings.mjs";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalId = ["mac", "workbuddy"].join("-");
const retiredId = `${canonicalId}-skin`;
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-adapter-id-"));

async function readJson(relative) {
  return JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
}

async function walk(directory, relative = "") {
  const files = [];
  for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (["release", ".git", "node_modules"].includes(entry.name)) continue;
      files.push(...await walk(directory, next));
    } else if (entry.isFile()) {
      files.push(next);
    }
  }
  return files;
}

try {
  assert.equal(ADAPTER_ID, canonicalId);
  assert.equal(MAC_WORKBUDDY_ADAPTER_ID, canonicalId);
  assert.equal(SKIN_THEME_KIND, "skin.theme", "the target document kind is private and must remain stable");
  assert.equal((await loadAdapterCapability()).adapterId, canonicalId);
  assert.equal((await readJson("contracts/adapter-capability.schema.json")).properties.adapterId.const, canonicalId);
  assert.equal((await readJson("contracts/target-profile.schema.json")).properties.adapterId.const, canonicalId);
  assert.equal((await readJson("contracts/operation-result.schema.json")).properties.adapter.const, canonicalId);
  assert.equal((await readJson("contracts/cc-theme-package.json")).target.adapterId, canonicalId);
  assert.equal((await readJson("contracts/theme-settings-locales.json")).adapter, canonicalId);
  assert.equal((await readJson("compatibility/workbuddy-macos/5.2.6/ui-surface-catalog.json")).adapter, canonicalId);
  assert.equal(operationResult({ operation: "check", status: "ok", code: "check-ok", message: "ok" }).adapter,
    canonicalId);
  assert.equal(defaultAdapterStateRoot(temporary),
    path.join(temporary, "Library", "Application Support", canonicalId));
  assert.equal(defaultThemeRuntimeSettingsRoot(temporary),
    path.join(temporary, "Library", "Application Support", canonicalId, "settings"));

  assert.throws(() => validateTargetProfile({
    kind: "cc-theme.target-profile",
    schemaVersion: 1,
    adapterId: retiredId,
    values: {},
  }), /invalid identity/, "the retired public id must not be accepted as an alias");

  const css = await fs.readFile(path.join(root, "assets/skin.css"), "utf8");
  assert.match(css, /html\.workbuddy-skin/);
  assert.match(css, /data-workbuddy-skin-role/);

  for (const relative of await walk(root)) {
    if (relative === path.join("tests", path.basename(fileURLToPath(import.meta.url)))) continue;
    const contents = (await fs.readFile(path.join(root, relative))).toString("utf8");
    assert.equal(contents.includes(retiredId), false,
      `retired public Adapter ID remains in source: ${relative}`);
  }

  const releaseRoot = path.join(temporary, "release");
  const releaseFiles = await assembleAdapterRelease(releaseRoot);
  assert(releaseFiles.length > 20);
  for (const relative of releaseFiles) {
    const contents = (await fs.readFile(path.join(releaseRoot, relative))).toString("utf8");
    assert.equal(contents.includes(retiredId), false,
      `retired public Adapter ID remains in the release allowlist output: ${relative}`);
  }

  const migrationHome = path.join(temporary, "migration-home");
  const applicationSupport = path.join(migrationHome, "Library", "Application Support");
  const legacyRoot = path.join(applicationSupport, retiredId);
  const canonicalRoot = path.join(applicationSupport, canonicalId);
  await fs.mkdir(path.join(legacyRoot, "themes", "fixture"), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(legacyRoot, "state.env"), [
    `adapter=${retiredId}`,
    "mode=active",
    "port=9342",
    `theme_dir=${path.join(legacyRoot, "themes", "fixture")}`,
    "project_root=/pre-canonical/source",
    "updated_at=2026-07-19T00:00:00Z",
    "",
  ].join("\n"), { mode: 0o600 });
  await execFile("/bin/bash", ["-c", '. "$1"', "adapter-id-migration",
    path.join(root, "scripts", "common-macos.sh")], { env: { ...process.env, HOME: migrationHome } });
  await assert.rejects(fs.access(legacyRoot), { code: "ENOENT" });
  assert.equal((await fs.stat(canonicalRoot)).mode & 0o077, 0);
  const migratedState = await fs.readFile(path.join(canonicalRoot, "state.env"), "utf8");
  assert.match(migratedState, new RegExp(`^adapter=${canonicalId}$`, "m"));
  assert.match(migratedState, /^mode=paused$/m);
  assert.match(migratedState, new RegExp(`^theme_dir=${canonicalRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/themes/fixture$`, "m"));
  assert.equal(migratedState.includes(retiredId), false);
  assert.equal(await fs.readFile(path.join(canonicalRoot, ".adapter-id-migration-v1"), "utf8"), `${canonicalId}\n`);

  const precedenceHome = path.join(temporary, "precedence-home");
  const precedenceSupport = path.join(precedenceHome, "Library", "Application Support");
  const precedenceLegacy = path.join(precedenceSupport, retiredId);
  const precedenceCanonical = path.join(precedenceSupport, canonicalId);
  await fs.mkdir(precedenceLegacy, { recursive: true, mode: 0o700 });
  await fs.mkdir(precedenceCanonical, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(precedenceLegacy, "legacy-only"), "legacy\n", { mode: 0o600 });
  await fs.writeFile(path.join(precedenceCanonical, "canonical-only"), "canonical\n", { mode: 0o600 });
  await execFile("/bin/bash", ["-c", '. "$1"', "adapter-id-precedence",
    path.join(root, "scripts", "common-macos.sh")], { env: { ...process.env, HOME: precedenceHome } });
  assert.equal(await fs.readFile(path.join(precedenceCanonical, "canonical-only"), "utf8"), "canonical\n");
  assert.equal(await fs.readFile(path.join(precedenceLegacy, "legacy-only"), "utf8"), "legacy\n");

  console.log("PASS: canonical Adapter ID is exclusive across contracts, runtime outputs, persistence, release content, and one-time local-state migration while private skin DOM identifiers remain stable.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
