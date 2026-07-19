import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSkinTheme } from "../scripts/skin-theme.mjs";
import { loadThemeStyleCatalog } from "../scripts/theme-style-catalog.mjs";
import { loadUiSurfaceCatalog } from "../scripts/ui-surface-catalog.mjs";
import {
  defaultThemeRuntimeSettings,
  loadThemeRuntimeSettings,
  saveThemeRuntimeSettings,
  validateThemeRuntimeSettings,
} from "../scripts/theme-runtime-settings.mjs";
import { readSyntheticTheme } from "./helpers/synthetic-theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-settings-persistence-"));

try {
  const fixture = await readSyntheticTheme();
  const alpha = normalizeSkinTheme({ ...fixture, id: "alpha", name: "Alpha" });
  const beta = normalizeSkinTheme({ ...fixture, id: "beta", name: "Beta" });
  const uiCatalog = await loadUiSurfaceCatalog();
  const catalog = await loadThemeStyleCatalog(uiCatalog.runtimeRoles);

  const absent = await loadThemeRuntimeSettings(alpha, catalog, { root: temporary });
  assert.equal(absent.status, "absent");
  assert.deepEqual(absent.state, defaultThemeRuntimeSettings(alpha));

  const alphaState = validateThemeRuntimeSettings({
    themeId: "alpha",
    paletteStrategy: "custom",
    backgroundPresentation: "paused",
    values: {
      "interaction.accent": "#123456",
      "typography.ui": ["Inter", "sans-serif"],
      "media.blur": 12,
    },
  }, alpha, catalog);
  await saveThemeRuntimeSettings(alpha, catalog, alphaState, { root: temporary });
  const afterRestart = await loadThemeRuntimeSettings(alpha, catalog, { root: temporary });
  assert.equal(afterRestart.status, "loaded");
  assert.deepEqual(afterRestart.state, alphaState, "a restarted renderer did not recover the last successful state");

  const betaState = {
    ...defaultThemeRuntimeSettings(beta),
    paletteStrategy: "adaptive",
    values: { "media.backgroundPosition": { xPercent: 18, yPercent: 72 } },
  };
  await saveThemeRuntimeSettings(beta, catalog, betaState, { root: temporary });
  assert.deepEqual((await loadThemeRuntimeSettings(alpha, catalog, { root: temporary })).state, alphaState,
    "saving another theme contaminated the previous theme settings");
  assert.deepEqual((await loadThemeRuntimeSettings(beta, catalog, { root: temporary })).state, betaState);

  const changedBase = normalizeSkinTheme({
    ...fixture,
    id: "alpha",
    name: "Alpha",
    appearance: { ...fixture.appearance, backdropBlurPx: 47 },
  });
  const rebased = await loadThemeRuntimeSettings(changedBase, catalog, { root: temporary });
  assert.equal(rebased.status, "rebased");
  assert.deepEqual(rebased.state, { ...alphaState, themeId: changedBase.id },
    "compatible stable-token settings were not preserved across a base theme update");
  assert.ok(rebased.diagnostics.some((diagnostic) => diagnostic.code === "runtime-overrides-rebased"));

  await fs.writeFile(path.join(temporary, "alpha.json"), "{broken-json", { mode: 0o600 });
  const corrupted = await loadThemeRuntimeSettings(alpha, catalog, { root: temporary });
  assert.equal(corrupted.status, "invalid");
  assert.deepEqual(corrupted.state, defaultThemeRuntimeSettings(alpha));

  await fs.rm(path.join(temporary, "alpha.json"));
  await fs.symlink(path.join(temporary, "beta.json"), path.join(temporary, "alpha.json"));
  const linked = await loadThemeRuntimeSettings(alpha, catalog, { root: temporary });
  assert.equal(linked.status, "invalid");
  assert.deepEqual(linked.state, defaultThemeRuntimeSettings(alpha));
  await assert.rejects(saveThemeRuntimeSettings(alpha, catalog, alphaState, { root: temporary }), /unsafe|symbolic/i);

  assert.throws(() => validateThemeRuntimeSettings({
    ...alphaState,
    values: { selector: "body", css: "*{}", js: "alert(1)" },
  }, alpha, catalog), /unknown control/);

  console.log("PASS: WorkBuddy settings persist privately per theme, rebase compatible stable tokens, reject corrupt/symlink state, and expose no selector or executable channel.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
