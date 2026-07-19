import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLatestWriteCoordinator } from "../scripts/latest-write-coordinator.mjs";
import { loadStyleCatalog } from "../scripts/theme-style-catalog.mjs";
import { loadStyleOverrides, saveStyleOverrides } from "../scripts/theme-style-overrides.mjs";
import { normalizeSkinTheme } from "../scripts/skin-theme.mjs";

const coordinator = createLatestWriteCoordinator();
let releaseFirst;
let markStarted;
const started = new Promise((resolve) => { markStarted = resolve; });
const first = coordinator.submit("theme-a", async () => {
  markStarted();
  await new Promise((resolve) => { releaseFirst = resolve; });
  return "first";
});
await started;
const second = coordinator.submit("theme-a", async () => "second");
releaseFirst();
assert.deepEqual(await first, { receipt: 1, superseded: true, value: "first" });
assert.deepEqual(await second, { receipt: 2, superseded: false, value: "second" });

let markFailureStarted;
const failureStarted = new Promise((resolve) => { markFailureStarted = resolve; });
const failed = coordinator.submit("theme-a", async () => {
  markFailureStarted();
  throw new Error("disk failed");
});
await failureStarted;
const recovered = coordinator.submit("theme-a", async () => "recovered");
await assert.rejects(failed, /disk failed/);
assert.equal((await recovered).value, "recovered");

const [catalog, temporary] = await Promise.all([
  loadStyleCatalog(),
  fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-wysiwyg-")),
]);
try {
  const root = path.join(temporary, "overrides");
  const themeA = normalizeSkinTheme({ kind: "skin.theme", id: "theme-a", name: "A", image: "background.png" });
  const themeB = normalizeSkinTheme({ kind: "skin.theme", id: "theme-b", name: "B", image: "background.png" });
  const writes = createLatestWriteCoordinator();
  const persist = (theme, values, runtimePreferences = {}) => writes.submit(theme.id, () =>
    saveStyleOverrides(theme, catalog, values, { root, runtimePreferences }));
  await persist(themeA, { "text.primary": "#112233" });
  await persist(themeA, { "text.primary": "#223344", "foundation.surfaceBase": "rgba(1, 2, 3, 0.4)" }, {
    "background.presentation": "paused",
  });
  await persist(themeB, { "text.primary": "#abcdef" }, { "background.presentation": "disabled" });
  assert.deepEqual((await loadStyleOverrides(themeA, catalog, { root })).values, {
    "text.primary": "#223344", "foundation.surfaceBase": "rgba(1, 2, 3, 0.4)",
  });
  assert.deepEqual((await loadStyleOverrides(themeB, catalog, { root })).values, { "text.primary": "#abcdef" });
  assert.deepEqual((await loadStyleOverrides(themeA, catalog, { root })).runtimePreferences, {
    "background.presentation": "paused",
  });
  assert.deepEqual((await loadStyleOverrides(themeB, catalog, { root })).runtimePreferences, {
    "background.presentation": "disabled",
  });

  await assert.rejects(persist(themeA, { "text.primary": "not-a-color" }), /local CSS color/);
  assert.deepEqual((await loadStyleOverrides(themeA, catalog, { root })).values, {
    "text.primary": "#223344", "foundation.surfaceBase": "rgba(1, 2, 3, 0.4)",
  });
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("theme-editor-wysiwyg.test.mjs: ok");
