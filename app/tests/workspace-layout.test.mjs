import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { managerRoot, runtimeRoot } from "./support/runtime-interface.mjs";
import { findWorkspaceRoot, managerLayout } from "../scripts/workspace-layout.mjs";

test("Manager finds the marked workspace from nested JS paths without fixed parent counting", async () => {
  const layout = await managerLayout(path.join(managerRoot, "tests", "support"));
  assert.equal(await findWorkspaceRoot(path.join(managerRoot, "src-tauri", "src")), layout.workspaceRoot);
  assert.equal(layout.managerRoot, managerRoot);
  assert.equal(path.join(layout.workspaceRoot, "app"), managerRoot);
});

test("staged runtime uses only registered macOS Adapter Engines and stable package interfaces", async () => {
  const registry = JSON.parse(await readFile(path.join(runtimeRoot, "capabilities", "registry.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(runtimeRoot, "artifact-manifest.json"), "utf8"));
  assert.deepEqual(
    registry.adapters.map(({ capabilityFile }) => capabilityFile.split("/")[0]),
    ["mac-codex", "mac-workbuddy"],
  );
  assert.ok(manifest.entries.some(({ path: file }) => file === "theme-core/compiler.mjs"));
  assert.ok(manifest.entries.some(({ path: file }) => file === "adapter-sdk/adapter-registry.mjs"));
  assert.ok(manifest.entries.some(({ path: file }) => file === "adapters/mac-workbuddy/scripts/workbuddy-theme-projection.mjs"));
  for (const { path: file } of manifest.entries) {
    const lower = file.toLowerCase();
    assert.equal(lower.includes("theme-sources"), false, file);
    assert.equal(lower.includes("/presets/"), false, file);
    assert.equal(lower.startsWith("adapters/win-"), false, file);
    assert.equal(/\.(?:cctheme|gif|jpe?g|mov|mp4|png|webm|webp)$/.test(lower), false, file);
  }
});

test("Tauri packages the staged Interface without repository-relative Adapter paths", async () => {
  const config = JSON.parse(await readFile(path.join(managerRoot, "src-tauri", "tauri.conf.json"), "utf8"));
  for (const source of Object.keys(config.bundle.resources)) {
    assert.equal(source.includes("../../"), false, source);
    assert.equal(source.includes("mac-app"), false, source);
    assert.equal(source.includes("mac-codex"), false, source);
    assert.equal(source.includes("mac-claude"), false, source);
    assert.equal(source.includes("mac-workbuddy"), false, source);
  }
  assert.equal(config.bundle.resources["../.runtime-resources/adapters"], "adapters");
});

test("the public macOS application and runtime identity are consistently CC Theme", async () => {
  const [config, launcher, backend, translations] = await Promise.all([
    readFile(path.join(managerRoot, "src-tauri", "tauri.conf.json"), "utf8").then(JSON.parse),
    readFile(path.join(managerRoot, "scripts", "build_and_run.sh"), "utf8"),
    readFile(path.join(managerRoot, "src-tauri", "src", "lib.rs"), "utf8"),
    readFile(path.join(managerRoot, "src", "i18n.ts"), "utf8"),
  ]);
  assert.equal(config.productName, "CC Theme");
  assert.equal(config.app.windows[0].title, "CC Theme");
  assert.equal(config.identifier, "com.quanzhankeji.cc-theme");
  assert.match(launcher, /APP_NAME="CC Theme"/);
  assert.match(launcher, /PROCESS_NAME="cc-theme"/);
  assert.match(backend, /\.tooltip\("CC Theme"\)/);
  assert.doesNotMatch(translations, /Close CC Theme Manager|关闭 CC Theme Manager/);
});

test("cached Node is fully verified before it can be reused or executed", async () => {
  const source = await readFile(path.join(managerRoot, "scripts", "prepare-node-runtime.sh"), "utf8");
  const hashGate = source.indexOf('shasum -a 256 "$node"');
  const signatureGate = source.indexOf('codesign --verify --strict "$node"');
  const executionGate = source.indexOf('$node --version');
  assert.ok(hashGate >= 0 && signatureGate > hashGate && executionGate > signatureGate);
  assert.equal((source.match(/if \[ -x "\$RUNTIME_ROOT\/bin\/node" \]/g) ?? []).length, 1);
  assert.match(
    source,
    /if \[ -x "\$RUNTIME_ROOT\/bin\/node" \] &&[\s\S]*?validate_runtime "\$RUNTIME_ROOT\/bin\/node"; then[\s\S]*?exit 0[\s\S]*?fi[\s\S]*?rm -rf "\$RUNTIME_ROOT"/,
  );
});
