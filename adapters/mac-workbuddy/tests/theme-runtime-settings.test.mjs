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
  themeRuntimeBaseHash,
} from "../scripts/theme-runtime-settings.mjs";
import { withAdapterTransaction } from "../scripts/adapter-transaction.mjs";
import { readSyntheticTheme } from "./helpers/synthetic-theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-runtime-settings-"));
try {
  const raw = await readSyntheticTheme();
  const theme = normalizeSkinTheme(raw);
  const uiCatalog = await loadUiSurfaceCatalog();
  const catalog = await loadThemeStyleCatalog(uiCatalog.runtimeRoles);
  const initial = defaultThemeRuntimeSettings(theme);
  assert.equal(initial.themeId, theme.id);
  const value = validateThemeRuntimeSettings({
    ...initial,
    paletteStrategy: "custom",
    backgroundPresentation: "paused",
    values: {
      "interaction.accent": "#123456",
      "typography.ui": ["Inter", "sans-serif"],
      "media.blur": 24,
    },
  }, theme, catalog);
  await saveThemeRuntimeSettings(theme, catalog, value, { root: temporary });
  const loaded = await loadThemeRuntimeSettings(theme, catalog, { root: temporary });
  assert.equal(loaded.status, "loaded");
  assert.deepEqual(loaded.state, value);
  const recordFile = path.join(temporary, `${theme.id}.json`);
  const record = JSON.parse(await fs.readFile(recordFile, "utf8"));
  assert.equal(record.schemaVersion, 2);
  assert.match(record.tokenFingerprints["palette.strategy"], /^[a-f0-9]{64}$/);
  assert.match(record.tokenFingerprints["background.presentation"], /^[a-f0-9]{64}$/);
  assert.match(record.tokenFingerprints["interaction.accent"], /^[a-f0-9]{64}$/);
  for (const mutate of [
    (draft) => { delete draft.tokenFingerprints; },
    (draft) => { delete draft.quarantine; },
    (draft) => { delete draft.updatedAt; },
    (draft) => { draft.updatedAt = "not-a-date"; },
    (draft) => { draft.selector = "body"; },
  ]) {
    const invalidRecord = structuredClone(record);
    mutate(invalidRecord);
    await fs.writeFile(recordFile, `${JSON.stringify(invalidRecord)}\n`, { mode: 0o600 });
    assert.equal((await loadThemeRuntimeSettings(theme, catalog, { root: temporary })).status, "invalid",
      "runtime settings reader accepted a record that violates the v2 machine schema");
  }
  await fs.writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  const legacyTheme = { ...structuredClone(theme), id: "legacy_runtime" };
  const legacyState = { ...value, themeId: legacyTheme.id };
  await fs.writeFile(path.join(temporary, `${legacyTheme.id}.json`), `${JSON.stringify({
    kind: "theme.runtime-settings",
    schemaVersion: 1,
    themeId: legacyTheme.id,
    baseThemeSha256: themeRuntimeBaseHash(legacyTheme),
    state: legacyState,
    updatedAt: new Date().toISOString(),
  })}\n`, { mode: 0o600 });
  const legacyLoaded = await loadThemeRuntimeSettings(legacyTheme, catalog, { root: temporary });
  assert.equal(legacyLoaded.status, "rebased");
  assert.deepEqual(legacyLoaded.state, legacyState, "runtime settings v1 backward-read lost valid allowlisted values");

  const updatedTheme = structuredClone(theme);
  updatedTheme.colors.accent = "#654321";
  await withAdapterTransaction(theme.id, { root: temporary }, (transaction) =>
    transaction.writeBase(themeRuntimeBaseHash(updatedTheme)));
  const rebased = await loadThemeRuntimeSettings(updatedTheme, catalog, { root: temporary });
  assert.equal(rebased.status, "rebased");
  assert.deepEqual(rebased.state, value, "compatible stable-token overrides must survive a base theme update");
  assert.equal(rebased.diagnostics[0].code, "runtime-overrides-rebased");
  await assert.rejects(
    saveThemeRuntimeSettings(theme, catalog, value, { root: temporary }),
    (error) => error?.code === "ADAPTER_THEME_BASE_STALE",
    "an older renderer must not overwrite settings after Manager applies a new base",
  );
  await saveThemeRuntimeSettings(updatedTheme, catalog, value, { root: temporary });

  const incompatibleRecord = JSON.parse(await fs.readFile(recordFile, "utf8"));
  incompatibleRecord.tokenFingerprints["interaction.accent"] = "0".repeat(64);
  incompatibleRecord.state.values["removed.selector"] = "body";
  incompatibleRecord.tokenFingerprints["removed.selector"] = "1".repeat(64);
  await fs.writeFile(recordFile, `${JSON.stringify(incompatibleRecord, null, 2)}\n`);
  const quarantined = await loadThemeRuntimeSettings(updatedTheme, catalog, { root: temporary });
  assert.equal(quarantined.status, "quarantined");
  assert.equal(quarantined.state.values["interaction.accent"], undefined);
  assert.equal(quarantined.state.values["media.blur"], 24);
  assert.deepEqual(new Set(quarantined.quarantine.map((entry) => entry.code)),
    new Set(["control-contract-changed", "token-removed"]));
  assert.ok(quarantined.quarantine.every((entry) => !Object.hasOwn(entry, "value")),
    "quarantine diagnostics must not echo untrusted values");
  assert.throws(() => validateThemeRuntimeSettings({ ...value, values: { selector: "body" } }, theme, catalog), /unknown control/);
  assert.throws(() => validateThemeRuntimeSettings({ ...value, values: { "media.blur": 99 } }, theme, catalog), /outside/);
  assert.equal((await fs.stat(recordFile)).mode & 0o077, 0);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("PASS: validated WorkBuddy WYSIWYG settings persist atomically per theme without selector or executable channels.");
