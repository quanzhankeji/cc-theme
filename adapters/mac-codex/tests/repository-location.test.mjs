import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relative) => JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));

const [packageManifest, projectManifest, capability, targetProfile, skinTheme] = await Promise.all([
  readJson("package.json"),
  readJson("PROJECT_MANIFEST.json"),
  readJson("contracts/adapter-capability.json"),
  readJson("contracts/target-profile.schema.json"),
  readJson("contracts/skin-theme.schema.json"),
]);

assert.equal(packageManifest.repository.directory, "adapters/mac-codex");
assert(packageManifest.files.includes("CONTEXT.md"));
assert.equal(projectManifest.kind, "mac-codex.repository");
assert.equal(capability.adapterId, "mac-codex");
assert.equal(targetProfile.properties.adapterId.const, "mac-codex");
assert.equal(
  targetProfile.$id,
  "https://raw.githubusercontent.com/quanzhankeji/cc-theme/main/adapters/mac-codex/contracts/target-profile.schema.json",
);
assert.equal(
  skinTheme.$id,
  "https://raw.githubusercontent.com/quanzhankeji/cc-theme/main/adapters/mac-codex/contracts/skin-theme.schema.json",
);

for (const relative of [
  "README.md",
  "CONTEXT.md",
  "CHANGELOG.md",
  "MIGRATION.md",
  "docs/ARCHITECTURE.md",
  "docs/CC-THEME-IMPORT.zh-CN.md",
  "docs/USAGE.zh-CN.md",
]) {
  const document = await fs.readFile(path.join(root, relative), "utf8");
  const formerSiblingPath = ["..", "theme-packages", ""].join("/");
  assert.equal(document.includes(formerSiblingPath), false, `${relative} retains the former sibling-directory assumption`);
}

const context = await fs.readFile(path.join(root, "CONTEXT.md"), "utf8");
assert.match(context, /adapters\/mac-codex/);
assert.match(context, /Stable Adapter and Capability identity: `mac-codex`/);
assert.match(context, /Installed engine directory: `\.mac-codex`/);

const common = await fs.readFile(path.join(root, "scripts/common-macos.sh"), "utf8");
assert.match(common, /adapter-release\.mjs/,
  "installed Engine assembly must follow the machine-readable release manifest");
assert.equal(common.includes("README.md CLIENT_DEPLOY_PROMPT.md CHANGELOG.md CONTEXT.md MIGRATION.md"), false,
  "repository documentation must not be a second installed-Engine allowlist");

const formerRepositoryPaths = [
  ["codexskin", "mac-codex"].join("/"),
  ["..", "mac-app"].join("/"),
  ["..", "..", "mac-app"].join("/"),
  ["..", "theme-packages"].join("/"),
];
const textExtensions = new Set([".command", ".css", ".json", ".md", ".mjs", ".js", ".sh", ".txt"]);
const pending = [root];
while (pending.length) {
  const directory = pending.pop();
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === "release") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) pending.push(absolute);
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name))) {
      const body = await fs.readFile(absolute, "utf8");
      for (const former of formerRepositoryPaths) {
        assert.equal(body.includes(former), false, `${path.relative(root, absolute)} retains former path ${former}`);
      }
    }
  }
}

for (const forbidden of ["presets", "themes", "theme-sources"]) {
  await assert.rejects(fs.access(path.join(root, forbidden)), undefined, `${forbidden} must remain outside the Adapter source module`);
}

console.log("PASS: relocated Mac Codex metadata and docs use the monorepo path while preserving the stable Adapter identity.");
