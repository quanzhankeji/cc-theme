import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeSkinTheme } from "../scripts/skin-theme.mjs";
import { loadThemeStyleCatalog } from "../scripts/theme-style-catalog.mjs";
import { loadUiSurfaceCatalog } from "../scripts/ui-surface-catalog.mjs";
import {
  loadThemeRuntimeSettings,
  themeRuntimeBaseHash,
  themeRuntimeControlFingerprint,
  validateThemeRuntimeSettings,
} from "../scripts/theme-runtime-settings.mjs";
import { readSyntheticTheme } from "./helpers/synthetic-theme.mjs";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-settings-migration-"));

try {
  const fixture = await readSyntheticTheme();
  const uiCatalog = await loadUiSurfaceCatalog();
  const catalog = await loadThemeStyleCatalog(uiCatalog.runtimeRoles);
  const controls = new Map(catalog.settingsControls.map((control) => [control.id, control]));
  const record = (theme, values) => ({
    kind: "theme.runtime-settings",
    schemaVersion: 2,
    themeId: theme.id,
    baseThemeSha256: themeRuntimeBaseHash(theme),
    tokenFingerprints: Object.fromEntries([
      ["palette.strategy", themeRuntimeControlFingerprint(controls.get("palette.strategy"))],
      ["background.presentation", themeRuntimeControlFingerprint(controls.get("background.presentation"))],
      ...Object.keys(values).map((id) => [id, controls.has(id)
        ? themeRuntimeControlFingerprint(controls.get(id)) : "0".repeat(64)]),
    ]),
    state: { themeId: theme.id, paletteStrategy: "custom", backgroundPresentation: "enabled", values },
    quarantine: [],
    updatedAt: "2026-07-19T00:00:00.000Z",
  });

  const matching = normalizeSkinTheme({ ...fixture, id: "legacy_same", name: "Legacy same" });
  await fs.writeFile(path.join(temporary, `${matching.id}.json`), `${JSON.stringify(record(matching, {
    "media.artX": 22, "media.videoX": 22, "media.artY": 64, "media.videoY": 64,
    "media.radiusScale": 1.2,
  }), null, 2)}\n`, { mode: 0o600 });
  const migrated = await loadThemeRuntimeSettings(matching, catalog, { root: temporary });
  assert.equal(migrated.status, "migrated");
  assert.deepEqual(migrated.state.values, {
    "media.backgroundPosition": { xPercent: 22, yPercent: 64 },
  });
  assert(migrated.diagnostics.some(({ code }) => code === "runtime-background-position-migrated"));
  assert(migrated.diagnostics.some(({ code }) => code === "obsolete-runtime-setting-removed"));
  const rewritten = JSON.parse(await fs.readFile(path.join(temporary, `${matching.id}.json`), "utf8"));
  assert.deepEqual(rewritten.state.values, migrated.state.values);
  assert.deepEqual(Object.keys(rewritten.tokenFingerprints).sort(), [
    "background.presentation", "media.backgroundPosition", "palette.strategy",
  ]);

  const conflicting = normalizeSkinTheme({ ...fixture, id: "legacy_conflict", name: "Legacy conflict" });
  await fs.writeFile(path.join(temporary, `${conflicting.id}.json`), `${JSON.stringify(record(conflicting, {
    "media.backgroundPosition": { xPercent: 35, yPercent: 45 },
    "media.artX": 10, "media.videoX": 20, "media.artY": 30, "media.videoY": 40,
  }), null, 2)}\n`, { mode: 0o600 });
  const quarantined = await loadThemeRuntimeSettings(conflicting, catalog, { root: temporary });
  assert.equal(quarantined.status, "quarantined");
  assert.deepEqual(quarantined.state.values["media.backgroundPosition"], { xPercent: 35, yPercent: 45 },
    "a legacy conflict overwrote the canonical last-known-good position");
  assert(quarantined.diagnostics.some(({ code }) => code === "runtime-background-position-conflict"));
  assert(quarantined.quarantine.some(({ code }) => code === "legacy-background-position-conflict"));
  const conflictRewritten = JSON.parse(await fs.readFile(path.join(temporary, `${conflicting.id}.json`), "utf8"));
  assert.deepEqual(Object.keys(conflictRewritten.state.values), ["media.backgroundPosition"]);

  const normalized = validateThemeRuntimeSettings({
    themeId: matching.id,
    paletteStrategy: "custom",
    backgroundPresentation: "enabled",
    values: { "media.backgroundPosition": { xPercent: 12, yPercent: 88 } },
  }, matching, catalog);
  assert.deepEqual(normalized.values["media.backgroundPosition"], { xPercent: 12, yPercent: 88 });
  assert.throws(() => validateThemeRuntimeSettings({
    ...normalized,
    values: { "media.backgroundPosition": { xPercent: -1, yPercent: 88 } },
  }, matching, catalog), /position/i);

  console.log("PASS: split image/video positions migrate once to one canonical override, conflicts preserve last-known-good with visible quarantine, and obsolete radius values stop writing.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
