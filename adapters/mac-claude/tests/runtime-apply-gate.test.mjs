import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const names = [
  "common-macos.sh", "start-skin-macos.sh", "verify-skin-macos.sh",
  "apply-cc-theme-macos.sh", "install-skin-macos.sh",
  "detect-claude-macos.sh", "doctor-macos.sh",
];
const sources = Object.fromEntries(await Promise.all(names.map(async (name) => [
  name, await fs.readFile(path.join(root, "scripts", name), "utf8"),
])));
assert(sources["common-macos.sh"].includes("availability.runtimeApplyAvailable"));
assert(sources["common-macos.sh"].includes("CLAUDE_CDP_AUTH"));
for (const name of names.slice(1, 5)) {
  assert(sources[name].includes("require_runtime_apply_available"), `${name} does not fail closed on unavailable runtime apply`);
}
for (const name of ["detect-claude-macos.sh", "doctor-macos.sh"]) {
  assert(sources[name].includes("managerApplyAllowed"), `${name} does not report the Manager gate`);
  assert(sources[name].includes("managerSelectionScope"), `${name} does not scope Manager availability to this Adapter`);
}
assert.equal(sources["start-skin-macos.sh"].includes("CLAUDE_CDP_AUTH="), false);
assert.equal(sources["common-macos.sh"].includes("CLAUDE_CDP_AUTH="), false);
console.log("runtime-apply-gate.test.mjs: ok");
