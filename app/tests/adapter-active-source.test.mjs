import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const managerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(managerRoot, "..");
const registryModule = pathToFileURL(path.join(managerRoot, "packages/adapter-sdk/adapter-registry.mjs")).href;

test("the compiler registry loads only the selected Adapter from its activated content root", async (t) => {
  const selectedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-selected-adapter-"));
  t.after(() => fs.rm(selectedRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(selectedRoot, "contracts"), { recursive: true });
  await fs.mkdir(path.join(selectedRoot, "scripts"), { recursive: true });
  await fs.writeFile(path.join(selectedRoot, "contracts/adapter-capability.json"), JSON.stringify({
    adapterId: "mac-workbuddy",
    displayName: "Activated WorkBuddy Adapter",
    availability: "available",
    capabilityVersion: "9.9.9",
    runtimeApplyAvailable: true,
    sharedCoreDecisions: [],
    targetProfile: {},
    localRuntimeOverrides: { editableTokens: [] },
  }));
  await fs.writeFile(
    path.join(selectedRoot, "scripts/workbuddy-theme-projection.mjs"),
    "export const projectThemeFamilyAdapter = () => ({ source: 'activated-content-store' });\n",
  );
  const script = `
    const module = await import(${JSON.stringify(registryModule)});
    const registry = module.loadAdapterRegistry();
    const capability = module.capabilityFor('mac-workbuddy', registry);
    const projector = await module.loadAdapterProjector(capability);
    process.stdout.write(JSON.stringify({
      displayName: capability.displayName,
      result: projector({}),
    }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      CC_THEME_ADAPTER_SOURCE_ROOT: path.join(workspaceRoot, "adapters"),
      CC_THEME_SELECTED_ADAPTER_ID: "mac-workbuddy",
      CC_THEME_SELECTED_ADAPTER_ROOT: selectedRoot,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    displayName: "Activated WorkBuddy Adapter",
    result: { source: "activated-content-store" },
  });
});
