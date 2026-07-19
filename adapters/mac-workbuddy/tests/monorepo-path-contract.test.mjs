import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const adapterRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = path.resolve(adapterRoot, "..", "..");
const packageName = ["mac", "workbuddy"].join("-");
const adapterId = packageName;
const sourceDirectory = `adapters/${packageName}`;

async function readJson(relative) {
  return JSON.parse(await fs.readFile(path.join(adapterRoot, relative), "utf8"));
}

async function walk(relative = "") {
  const files = [];
  for (const entry of await fs.readdir(path.join(adapterRoot, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (["release", ".git", "node_modules"].includes(entry.name)) continue;
      files.push(...await walk(next));
    } else if (entry.isFile()) {
      files.push(next);
    }
  }
  return files;
}

const packageDocument = await readJson("package.json");
const themeSchema = await readJson("contracts/skin-theme.schema.json");
const capability = await readJson("contracts/adapter-capability.json");
const packageContract = await readJson("contracts/cc-theme-package.json");
const releaseManifest = await readJson("contracts/adapter-release-manifest.json");
const projectManifest = await readJson("PROJECT_MANIFEST.json");

assert.equal(await fs.realpath(adapterRoot), await fs.realpath(path.join(monorepoRoot, sourceDirectory)));
await assert.rejects(fs.access(path.join(monorepoRoot, packageName)), { code: "ENOENT" },
  "the removed top-level Adapter directory must not return as a second source tree");

assert.equal(packageDocument.repository.directory, sourceDirectory);
assert.equal(themeSchema.$id,
  `https://raw.githubusercontent.com/quanzhankeji/cc-theme/main/${sourceDirectory}/contracts/skin-theme.schema.json`);
assert.equal(capability.adapterId, adapterId);
assert.equal(packageContract.target.adapterId, adapterId);
assert.equal(packageContract.target.targetPath, "targets/macos-workbuddy/theme.json");
assert.equal(releaseManifest.kind, "workbuddy-adapter.release-manifest");
assert.equal(projectManifest.adapterId, adapterId);
assert.equal(projectManifest.release.publicationStatus, "unpublished-development");
assert.equal(projectManifest.release.overwritePolicy, "replace-unpublished-development-revision");
assert.ok(releaseManifest.entries.every((entry) => !path.isAbsolute(entry) && !entry.startsWith("..")),
  "release allowlist entries must remain Adapter-relative");

const sourceRelease = await fs.readFile(path.join(adapterRoot, "scripts/build-release.sh"), "utf8");
const clientRelease = await fs.readFile(path.join(adapterRoot, "scripts/build-client-release.sh"), "utf8");
assert.match(sourceRelease, /release-identity\.mjs" --field sourceArchive/);
assert.match(clientRelease, /release-identity\.mjs" --field clientArchive/);
assert.match(sourceRelease, /cannot be overwritten/);
assert.match(clientRelease, /cannot be overwritten/);
assert.match(clientRelease, /ENGINE="\$CLIENT_ROOT\/\.mac-workbuddy"/,
  "the stable package-internal runtime directory must not be renamed during source relocation");

const forbiddenFragments = [
  `/codexskin/${packageName}/`,
  `/main/${packageName}/`,
  `"directory": "${packageName}"`,
  ["..", "mac-app"].join("/"),
];
for (const relative of await walk()) {
  if (relative === path.join("tests", path.basename(fileURLToPath(import.meta.url)))) continue;
  const contents = (await fs.readFile(path.join(adapterRoot, relative))).toString("utf8");
  for (const fragment of forbiddenFragments) {
    assert.equal(contents.includes(fragment), false,
      `stale pre-migration repository path remains in ${relative}: ${fragment}`);
  }
}

for (const relative of ["README.md", "CONTEXT.md", "docs/ARCHITECTURE.md"]) {
  const contents = await fs.readFile(path.join(adapterRoot, relative), "utf8");
  assert.match(contents, /adapters\/mac-workbuddy/);
  assert.match(contents, /\.mac-workbuddy/);
}

console.log("PASS: monorepo source location, stable Adapter identity, release names, and package-internal runtime directory are consistent after relocation.");
