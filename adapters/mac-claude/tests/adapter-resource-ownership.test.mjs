import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await fs.readFile(path.join(root, "PROJECT_MANIFEST.json"), "utf8"));
const ownership = JSON.parse(await fs.readFile(path.join(root, "contracts", "adapter-resource-ownership.json"), "utf8"));

for (const productionThemeDirectory of ["presets", "themes", "theme-sources", "generator", "skills"]) {
  await assert.rejects(
    fs.access(path.join(root, productionThemeDirectory)),
    (error) => error?.code === "ENOENT",
    `Adapter repository must not own production ${productionThemeDirectory}`,
  );
}

assert.equal(manifest.bundledPreset, undefined, "Adapter manifest must not publish a bundled preset");
assert.equal(manifest.themeLibrary, undefined, "Adapter manifest must not manage a production theme library");
assert.equal(manifest.entrypoints.themeLibrary, undefined, "Adapter must not expose a theme-library scanner");
for (const extension of [".mov", ".webm", ".m4v", ".avif", ".bmp", ".zip", ".tar", ".wasm", ".bin", ".glsl", ".wgsl"]) {
  assert(ownership.release.forbiddenExtensions.includes(extension), `Release ownership must forbid ${extension}`);
}
assert.deepEqual(
  ownership.release.allowedExtensions,
  ["", ".css", ".js", ".json", ".md", ".mjs", ".sh", ".txt"],
  "Adapter release file types must be a closed allowlist",
);

const knownPresetIds = [
  ["xt", "xg"].join(""),
  String.fromCodePoint(0x7ebf, 0x6761, 0x5c0f, 0x72d7),
  ["WO", "LP"].join(""),
  ["mac", "claude", "skin"].join("-"),
];
const sourceExtensions = new Set([".js", ".json", ".md", ".mjs", ".sh", ".yaml"]);

async function sourceFiles(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (["release", "runtime"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(absolute));
    else if (sourceExtensions.has(path.extname(entry.name))) result.push(absolute);
  }
  return result;
}

for (const file of await sourceFiles(root)) {
  const text = await fs.readFile(file, "utf8");
  const normalized = text.toLocaleLowerCase("en-US");
  for (const id of knownPresetIds) {
    assert.equal(normalized.includes(id.toLocaleLowerCase("en-US")), false, `Known production preset identity remains in ${path.relative(root, file)}`);
  }
}

console.log("PASS: the Adapter repository has no production preset directory or library ownership metadata.");
