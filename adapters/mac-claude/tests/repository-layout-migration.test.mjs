import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relative) => JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
const packageJson = await readJson("package.json");
const manifest = await readJson("PROJECT_MANIFEST.json");
const capability = await readJson("contracts/adapter-capability.json");

assert.equal(packageJson.repository.directory, "adapters/mac-claude");
assert.equal(packageJson.name, "mac-claude", "stable package/Adapter identity must not change with the workspace path");
assert.equal(manifest.kind, "mac-claude.repository");
assert.equal(manifest.client.runtimeApplyAvailable, false);
assert.equal(capability.adapterId, "mac-claude");
assert.equal(capability.availability.runtimeApplyAvailable, false);

for (const schemaName of ["skin-theme.schema.json", "claude-target-profile.schema.json"]) {
  const schema = await readJson(`contracts/${schemaName}`);
  assert.equal(
    schema.$id,
    `https://raw.githubusercontent.com/quanzhankeji/cc-theme/main/adapters/mac-claude/contracts/${schemaName}`,
  );
}

const textualExtensions = new Set([".json", ".md", ".mjs", ".sh"]);
const oldWorkspacePath = ["/codexskin", "/mac-claude"].join("");
const oldGithubPath = ["/main", "/mac-claude/"].join("");
const adapterDirectoryName = ["mac", "claude"].join("-");
const oldRepositoryTestPath = new RegExp(`(?<!adapters/)${adapterDirectoryName}/tests/`);
const retiredManagerDirectory = ["mac", "app"].join("-");

async function files(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (["release", "runtime"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(absolute));
    else if (textualExtensions.has(path.extname(entry.name))) result.push(absolute);
  }
  return result;
}

for (const file of await files(root)) {
  const source = await fs.readFile(file, "utf8");
  const relative = path.relative(root, file);
  assert.equal(source.includes(oldWorkspacePath), false, `Old absolute workspace path remains in ${relative}`);
  assert.equal(source.includes(oldGithubPath), false, `Old GitHub repository path remains in ${relative}`);
  assert.equal(oldRepositoryTestPath.test(source), false, `Old repository-relative test path remains in ${relative}`);
  assert.equal(source.includes(retiredManagerDirectory), false, `Retired Manager Module path remains in ${relative}`);
}

console.log("repository-layout-migration.test.mjs: ok");
