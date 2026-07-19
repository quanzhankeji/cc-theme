import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { managerLayout } from "../../scripts/workspace-layout.mjs";

const layout = await managerLayout(path.dirname(fileURLToPath(import.meta.url)));
export const managerRoot = layout.managerRoot;
export const runtimeRoot = path.join(managerRoot, ".runtime-resources");
export const adaptersRoot = path.join(runtimeRoot, "adapters");
export const contractsRoot = path.join(runtimeRoot, "contracts");
export const testKitRoot = path.join(runtimeRoot, "test-kit");

process.env.CC_THEME_REPOSITORY_ROOT = runtimeRoot;
process.env.CC_THEME_ADAPTER_SOURCE_ROOT = adaptersRoot;
process.env.CC_THEME_CAPABILITY_ROOT = path.join(runtimeRoot, "capabilities");

const importRuntime = (relative) => import(pathToFileURL(path.join(runtimeRoot, relative)).href);

export const adapterRegistry = await importRuntime("adapter-sdk/adapter-registry.mjs");
export const compiler = await importRuntime("theme-core/compiler.mjs");
export const runtimeOverrides = await importRuntime("theme-core/runtime-overrides.mjs");
export const registrySource = JSON.parse(await readFile(path.join(runtimeRoot, "capabilities", "registry.json"), "utf8"));

export async function readContract(relative) {
  return JSON.parse(await readFile(path.join(contractsRoot, relative), "utf8"));
}

export async function readFixture(relative) {
  return JSON.parse(await readFile(path.join(testKitRoot, relative), "utf8"));
}

export async function loadAdapterNormalizer(adapterId) {
  const descriptor = registrySource.adapters.find((entry) => entry.capabilityFile.startsWith(`${adapterId}/`));
  if (!descriptor?.normalizerModule || !descriptor.normalizerExport) throw new Error(`Registry normalizer missing for ${adapterId}`);
  const module = await import(pathToFileURL(path.join(adaptersRoot, descriptor.normalizerModule)).href);
  const normalizer = module[descriptor.normalizerExport];
  if (typeof normalizer !== "function") throw new Error(`Registry normalizer export missing for ${adapterId}`);
  return normalizer;
}
