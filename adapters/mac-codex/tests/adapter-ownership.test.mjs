import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectOwnership } from "../scripts/distribution-ownership.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = await inspectOwnership(root);
assert.equal(repository.allowed, true, JSON.stringify(repository.violations));
const fixtureEntries = await fs.readdir(path.join(root, "tests", "fixtures"));
assert.deepEqual(fixtureEntries.sort(), ["README.md", "bridge-theme.json", "neutral-v2-atlas.webp"]);
assert((await fs.stat(path.join(root, "tests", "fixtures", "neutral-v2-atlas.webp"))).size <= 1024,
  "the neutral binary fixture must remain tiny and test-only");
const read = (relative) => fs.readFile(path.join(root, relative), "utf8");
const [installer, common, doctor, injector, renderer, starter, launcher] = await Promise.all([
  "scripts/install-skin-macos.sh",
  "scripts/common-macos.sh",
  "scripts/doctor-macos.sh",
  "scripts/injector.mjs",
  "assets/renderer-inject.js",
  "scripts/start-skin-macos.sh",
  "scripts/launcher-app-macos.sh",
].map(read));
assert.equal(installer.includes("seed_bundled_presets"), false);
assert.equal(common.includes("seed_bundled_presets"), false);
assert.equal(doctor.includes("PROJECT_ROOT/presets"), false);
assert.match(injector, /require an explicit external --theme-dir/);
assert.equal(renderer.includes("__THEME_LIBRARY_JSON__"), false);
assert.equal(renderer.includes("data-theme-library-id"), false);
assert.equal(launcher.includes("--icon"), false);
assert(starter.indexOf('No externally supplied theme is active') < starter.indexOf('launch_codex_with_cdp'),
  "empty-state start must fail before launching or mutating Codex");

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-adapter-ownership-"));
try {
  const fixedAssets = path.join(temporary, "assets");
  await fs.mkdir(fixedAssets, { recursive: true });
  await fs.writeFile(path.join(fixedAssets, "renderer.js"), "export const adapterOwned = true;\n");
  await fs.writeFile(path.join(fixedAssets, "skin.css"), ":root { --adapter-owned: 1; }\n");
  assert.equal((await inspectOwnership(temporary, { distribution: true })).allowed, true,
    "fixed Adapter renderer assets are not theme content");

  const productionDirectory = path.join(temporary, ["pre", "sets"].join(""), "sample");
  await fs.mkdir(productionDirectory, { recursive: true });
  await fs.writeFile(path.join(productionDirectory, "theme.json"), "{}\n");
  let denied = await inspectOwnership(temporary, { distribution: true });
  assert.equal(denied.allowed, false);
  assert(denied.violations.some((item) => item.code === "production-theme-directory"));

  await fs.rm(path.join(temporary, ["pre", "sets"].join("")), { recursive: true, force: true });
  await fs.writeFile(path.join(temporary, "background.mp4"), "not-media");
  denied = await inspectOwnership(temporary, { distribution: true });
  assert(denied.violations.some((item) => item.code === "theme-media-owned-by-adapter"));

  await fs.rm(path.join(temporary, "background.mp4"));
  await fs.writeFile(path.join(temporary, "identity.txt"), ["x", "txg"].join(""));
  denied = await inspectOwnership(temporary, { distribution: true });
  assert(denied.violations.some((item) => item.code === "known-production-theme-identity"));

  await fs.rm(path.join(temporary, "identity.txt"));
  await fs.mkdir(path.join(temporary, "tests", "fixtures"), { recursive: true });
  await fs.writeFile(path.join(temporary, "tests", "fixtures", "neutral.webp"), "test-only");
  denied = await inspectOwnership(temporary, { distribution: true });
  assert(denied.violations.some((item) => item.code === "test-content-in-distribution"));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("PASS: repository and distributions reject production themes while allowing fixed Adapter assets.");
