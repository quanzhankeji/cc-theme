import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_MARKERS = Object.freeze([
  ".cc-theme-workspace.json",
  "app/package.json",
  "app/packages/contracts/unified-theme-v1.schema.json",
  "app/packages/adapter-sdk/adapter-registry.mjs",
  "app/packages/shared-core/compiler.mjs",
  "app/registry/adapter-capabilities.json",
  "adapters",
]);

async function hasWorkspaceMarkers(directory) {
  try {
    await Promise.all(WORKSPACE_MARKERS.map((marker) => access(path.join(directory, marker))));
    return true;
  } catch {
    return false;
  }
}

export async function findWorkspaceRoot(start = path.dirname(fileURLToPath(import.meta.url))) {
  let current = await realpath(start);
  while (true) {
    if (await hasWorkspaceMarkers(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Unable to locate the CC Theme workspace from ${start}`);
}

export async function managerLayout(start) {
  const workspaceRoot = await findWorkspaceRoot(start);
  const managerRoot = path.join(workspaceRoot, "app");
  return Object.freeze({
    workspaceRoot,
    managerRoot,
    adaptersRoot: path.join(workspaceRoot, "adapters"),
    adapterSdkRoot: path.join(managerRoot, "packages", "adapter-sdk"),
    contractsRoot: path.join(managerRoot, "packages", "contracts"),
    sharedCoreRoot: path.join(managerRoot, "packages", "shared-core"),
    testKitRoot: path.join(managerRoot, "packages", "test-kit"),
    registryRoot: path.join(managerRoot, "registry"),
    runtimeResourcesRoot: path.join(managerRoot, ".runtime-resources"),
  });
}
