import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriRoot = path.join(root, "src-tauri");
const tauriConfig = JSON.parse(await readFile(path.join(tauriRoot, "tauri.conf.json"), "utf8"));
const resources = tauriConfig.bundle.resources;

test("release bundle contains Adapter engines but no production themes or preset media", () => {
  assert.ok(Object.values(resources).some((destination) => destination === "adapters" || destination.startsWith("adapters/")));
  for (const [source, destination] of Object.entries(resources)) {
    const normalizedSource = source.replaceAll("\\", "/").toLowerCase();
    const normalizedDestination = destination.replaceAll("\\", "/").toLowerCase();
    assert.equal(normalizedSource.includes("/presets/"), false, source);
    assert.equal(normalizedSource.includes("bootstrap/themes"), false, source);
    assert.equal(normalizedSource.includes("theme-sources"), false, source);
    assert.equal(normalizedDestination.startsWith("themes/"), false, destination);
    for (const forbidden of ["background.mp4", "background.jpg", "background.png", "unified-theme.json", "family.json"]) {
      assert.equal(normalizedDestination.endsWith(forbidden), false, destination);
    }
  }
});
