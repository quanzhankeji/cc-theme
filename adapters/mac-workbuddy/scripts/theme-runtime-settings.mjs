import crypto, { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateThemeSettingValues } from "./theme-style-catalog.mjs";
import { withAdapterTransaction } from "./adapter-transaction.mjs";

export const THEME_RUNTIME_SETTINGS_KIND = "theme.runtime-settings";
export const THEME_RUNTIME_SETTINGS_VERSION = 2;
export const MAX_THEME_RUNTIME_SETTINGS_BYTES = 64 * 1024;
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
const PALETTE_STRATEGIES = new Set(["system", "adaptive", "custom"]);
const BACKGROUND_PRESENTATIONS = new Set(["enabled", "paused", "disabled"]);
const LEGACY_BACKGROUND_POSITION_TOKENS = Object.freeze({
  xPercent: ["media.artX", "media.videoX"],
  yPercent: ["media.artY", "media.videoY"],
});
const OBSOLETE_RUNTIME_TOKENS = new Set(["media.radiusScale"]);

const plainObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;

export function defaultThemeRuntimeSettingsRoot(home = os.homedir()) {
  return path.join(home, "Library", "Application Support", "mac-workbuddy", "settings");
}

export function themeRuntimeBaseHash(theme) {
  return crypto.createHash("sha256").update(JSON.stringify({
    kind: theme.kind,
    adapter: theme.adapter,
    id: theme.id,
    colors: theme.colors,
    semanticColors: theme.semanticColors,
    fonts: theme.fonts,
    appearance: theme.appearance,
    interactiveBackground: theme.interactiveBackground ?? null,
    backgroundVideo: theme.backgroundVideo ?? null,
  })).digest("hex");
}

export function themeRuntimeControlFingerprint(control) {
  return crypto.createHash("sha256").update(JSON.stringify({
    id: control.id,
    type: control.type,
    binding: control.binding ?? null,
    themePath: control.themePath ?? null,
    minimum: control.minimum ?? null,
    maximum: control.maximum ?? null,
    step: control.step ?? null,
    unit: control.unit ?? null,
    options: control.options ?? null,
    paletteStrategies: control.paletteStrategies ?? null,
  })).digest("hex");
}

function fileName(themeId) {
  if (typeof themeId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(themeId)) {
    throw new Error("Invalid runtime settings theme id");
  }
  return `${themeId}.json`;
}

export function defaultThemeRuntimeSettings(theme) {
  return {
    themeId: theme.id,
    paletteStrategy: theme.paletteStrategy,
    backgroundPresentation: "enabled",
    values: {},
  };
}

export function validateThemeRuntimeSettings(value, theme, catalog, label = "Theme runtime settings") {
  const state = plainObject(value);
  if (!state || state.themeId !== theme.id) throw new Error(`${label} has an invalid theme id`);
  if (!PALETTE_STRATEGIES.has(state.paletteStrategy)) throw new Error(`${label} has an invalid palette strategy`);
  if (!BACKGROUND_PRESENTATIONS.has(state.backgroundPresentation)) {
    throw new Error(`${label} has an invalid background presentation`);
  }
  return {
    themeId: theme.id,
    paletteStrategy: state.paletteStrategy,
    backgroundPresentation: state.backgroundPresentation,
    values: validateThemeSettingValues(state.values ?? {}, catalog, `${label}.values`),
  };
}

async function readBoundedJson(file) {
  let handle;
  try {
    handle = await fs.open(file, OPEN_FLAGS);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code === "ELOOP") throw new Error("Runtime settings must not be a symbolic link");
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 2 || before.size > MAX_THEME_RUNTIME_SETTINGS_BYTES) {
      throw new Error("Runtime settings are not a bounded regular file");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error("Runtime settings changed while being read");
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    await handle.close();
  }
}

async function ensurePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Runtime settings directory is unsafe");
  await fs.chmod(directory, 0o700);
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, fsConstants.O_RDONLY);
    await handle.sync();
  } finally {
    await handle?.close().catch(() => {});
  }
}

function quarantinedValue(tokenId, value, code) {
  return {
    tokenId,
    code,
    valueSha256: crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  };
}

function normalizeQuarantine(entries) {
  const normalized = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries.slice(0, 128) : []) {
    if (!plainObject(entry) || typeof entry.tokenId !== "string" || !/^[a-z][A-Za-z0-9.-]{0,79}$/.test(entry.tokenId) ||
        typeof entry.code !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(entry.code) ||
        !/^[a-f0-9]{64}$/.test(entry.valueSha256 ?? "")) continue;
    const key = `${entry.tokenId}:${entry.code}:${entry.valueSha256}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ tokenId: entry.tokenId, code: entry.code, valueSha256: entry.valueSha256 });
  }
  return normalized;
}

function exactRecordKeys(value, allowed, required, label) {
  const object = plainObject(value);
  if (!object || Object.keys(object).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(object, key))) {
    throw new Error(`${label} has an invalid structure`);
  }
  return object;
}

function validateSavedRecord(record, theme) {
  const common = ["kind", "schemaVersion", "themeId", "baseThemeSha256", "state", "updatedAt"];
  const required = record?.schemaVersion === 2
    ? [...common, "tokenFingerprints", "quarantine"] : common;
  const allowed = required;
  exactRecordKeys(record, allowed, required, "Runtime settings record");
  if (record.kind !== THEME_RUNTIME_SETTINGS_KIND || ![1, THEME_RUNTIME_SETTINGS_VERSION].includes(record.schemaVersion) ||
      record.themeId !== theme.id || !/^[a-f0-9]{64}$/.test(record.baseThemeSha256 ?? "") ||
      typeof record.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.updatedAt) ||
      Number.isNaN(Date.parse(record.updatedAt)) || new Date(record.updatedAt).toISOString() !== record.updatedAt) {
    throw new Error("Runtime settings record has an invalid identity");
  }
  const state = exactRecordKeys(record.state,
    ["themeId", "paletteStrategy", "backgroundPresentation", "values"],
    ["themeId", "paletteStrategy", "backgroundPresentation", "values"],
    "Runtime settings state");
  if (state.themeId !== theme.id || !PALETTE_STRATEGIES.has(state.paletteStrategy) ||
      !BACKGROUND_PRESENTATIONS.has(state.backgroundPresentation) || !plainObject(state.values)) {
    throw new Error("Runtime settings state is invalid");
  }
  if (record.schemaVersion === 2) {
    const fingerprints = plainObject(record.tokenFingerprints);
    if (!fingerprints || Object.entries(fingerprints).some(([tokenId, fingerprint]) =>
      !/^[a-z][A-Za-z0-9.-]{0,79}$/.test(tokenId) || !/^[a-f0-9]{64}$/.test(fingerprint ?? ""))) {
      throw new Error("Runtime settings token fingerprints are invalid");
    }
    const quarantine = normalizeQuarantine(record.quarantine);
    if (!Array.isArray(record.quarantine) || record.quarantine.length > 128 || quarantine.length !== record.quarantine.length) {
      throw new Error("Runtime settings quarantine is invalid");
    }
  }
  return record;
}

function reconcileRuntimeSettings(record, theme, catalog) {
  const defaults = defaultThemeRuntimeSettings(theme);
  const state = plainObject(record.state) ?? {};
  const quarantine = [];
  const diagnostics = [];
  const result = { ...defaults, values: {} };
  if (PALETTE_STRATEGIES.has(state.paletteStrategy)) result.paletteStrategy = state.paletteStrategy;
  else if (state.paletteStrategy !== undefined) quarantine.push(quarantinedValue("palette.strategy", state.paletteStrategy, "invalid-palette-strategy"));
  if (BACKGROUND_PRESENTATIONS.has(state.backgroundPresentation)) result.backgroundPresentation = state.backgroundPresentation;
  else if (state.backgroundPresentation !== undefined) quarantine.push(quarantinedValue("background.presentation", state.backgroundPresentation, "invalid-background-presentation"));

  const controls = new Map((catalog.settingsControls ?? [])
    .filter((control) => control.binding || control.bindings)
    .map((control) => [control.id, control]));
  const stateControls = new Map((catalog.settingsControls ?? []).map((control) => [control.id, control]));
  const savedValues = plainObject(state.values);
  if (!savedValues && state.values !== undefined) {
    quarantine.push(quarantinedValue("values", state.values, "invalid-values-object"));
  }
  const effectiveValues = { ...(savedValues ?? {}) };
  const migratedTokenIds = new Set();
  let migrationPerformed = false;
  let obsoleteRemoved = 0;
  for (const tokenId of OBSOLETE_RUNTIME_TOKENS) {
    if (!Object.hasOwn(effectiveValues, tokenId)) continue;
    delete effectiveValues[tokenId];
    migrationPerformed = true;
    obsoleteRemoved += 1;
  }

  const legacyPositionEntries = Object.values(LEGACY_BACKGROUND_POSITION_TOKENS)
    .flat().filter((tokenId) => Object.hasOwn(effectiveValues, tokenId));
  if (legacyPositionEntries.length) {
    migrationPerformed = true;
    let canonicalPosition = null;
    if (Object.hasOwn(effectiveValues, "media.backgroundPosition")) {
      try {
        canonicalPosition = validateThemeSettingValues({
          "media.backgroundPosition": effectiveValues["media.backgroundPosition"],
        }, catalog, "Saved runtime settings.values")["media.backgroundPosition"];
      } catch {}
    }
    const migratedPosition = canonicalPosition ? { ...canonicalPosition } : {
      xPercent: Number(theme.appearance?.backgroundPosition?.xPercent ?? 50),
      yPercent: Number(theme.appearance?.backgroundPosition?.yPercent ?? 50),
    };
    let hasMigratedCoordinate = false;
    let conflict = false;
    for (const [axis, tokenIds] of Object.entries(LEGACY_BACKGROUND_POSITION_TOKENS)) {
      const entries = tokenIds.filter((tokenId) => Object.hasOwn(effectiveValues, tokenId))
        .map((tokenId) => ({ tokenId, raw: effectiveValues[tokenId], value: Number(effectiveValues[tokenId]) }));
      if (!entries.length) continue;
      const same = entries.every(({ value }) => Number.isFinite(value) && value >= 0 && value <= 100 &&
        value === entries[0].value);
      const compatibleWithCanonical = !canonicalPosition || (same && canonicalPosition[axis] === entries[0].value);
      if (!same || !compatibleWithCanonical) {
        conflict = true;
        for (const { tokenId, raw } of entries) {
          quarantine.push(quarantinedValue(tokenId, raw, "legacy-background-position-conflict"));
        }
      } else if (!canonicalPosition) {
        migratedPosition[axis] = entries[0].value;
        hasMigratedCoordinate = true;
      }
    }
    for (const tokenId of legacyPositionEntries) delete effectiveValues[tokenId];
    if (!conflict && !canonicalPosition && hasMigratedCoordinate) {
      effectiveValues["media.backgroundPosition"] = migratedPosition;
      migratedTokenIds.add("media.backgroundPosition");
    }
    diagnostics.push({
      code: conflict ? "runtime-background-position-conflict" : "runtime-background-position-migrated",
      severity: conflict ? "warning" : "info",
      count: legacyPositionEntries.length,
    });
  }
  if (obsoleteRemoved) {
    diagnostics.push({ code: "obsolete-runtime-setting-removed", severity: "info", count: obsoleteRemoved });
  }
  const fingerprints = plainObject(record.tokenFingerprints) ?? {};
  if (record.schemaVersion === 2 && fingerprints["palette.strategy"] !== themeRuntimeControlFingerprint(stateControls.get("palette.strategy"))) {
    quarantine.push(quarantinedValue("palette.strategy", state.paletteStrategy, "control-contract-changed"));
    result.paletteStrategy = defaults.paletteStrategy;
  }
  if (record.schemaVersion === 2 && fingerprints["background.presentation"] !== themeRuntimeControlFingerprint(stateControls.get("background.presentation"))) {
    quarantine.push(quarantinedValue("background.presentation", state.backgroundPresentation, "control-contract-changed"));
    result.backgroundPresentation = defaults.backgroundPresentation;
  }
  for (const [tokenId, raw] of Object.entries(effectiveValues)) {
    const control = controls.get(tokenId);
    if (!control) {
      quarantine.push(quarantinedValue(tokenId, raw, "token-removed"));
      continue;
    }
    if (record.schemaVersion === 2 && !migratedTokenIds.has(tokenId) &&
        fingerprints[tokenId] !== themeRuntimeControlFingerprint(control)) {
      quarantine.push(quarantinedValue(tokenId, raw, "control-contract-changed"));
      continue;
    }
    try {
      result.values[tokenId] = validateThemeSettingValues({ [tokenId]: raw }, catalog, "Saved runtime settings.values")[tokenId];
    } catch {
      quarantine.push(quarantinedValue(tokenId, raw, "value-no-longer-valid"));
    }
  }
  quarantine.push(...normalizeQuarantine(record.quarantine));
  const finalQuarantine = normalizeQuarantine(quarantine);
  if (record.baseThemeSha256 !== themeRuntimeBaseHash(theme)) {
    diagnostics.push({ code: "runtime-overrides-rebased", severity: "info", count: Object.keys(result.values).length });
  }
  if (finalQuarantine.length) {
    diagnostics.push({ code: "runtime-overrides-quarantined", severity: "warning", count: finalQuarantine.length });
  }
  return { state: result, quarantine: finalQuarantine, diagnostics, migrationPerformed };
}

export async function loadThemeRuntimeSettings(theme, catalog, { root = defaultThemeRuntimeSettingsRoot() } = {}) {
  const file = path.join(path.resolve(root), fileName(theme.id));
  let record;
  try {
    record = await readBoundedJson(file);
  } catch {
    return { state: defaultThemeRuntimeSettings(theme), status: "invalid", file };
  }
  if (!record) return { state: defaultThemeRuntimeSettings(theme), status: "absent", file };
  try {
    validateSavedRecord(record, theme);
    const reconciled = reconcileRuntimeSettings(record, theme, catalog);
    const baseChanged = record.baseThemeSha256 !== themeRuntimeBaseHash(theme) || record.schemaVersion === 1;
    if (reconciled.migrationPerformed) {
      await saveThemeRuntimeSettings(theme, catalog, reconciled.state, {
        root,
        quarantine: reconciled.quarantine,
      });
    }
    return {
      ...reconciled,
      status: reconciled.quarantine.length ? "quarantined" :
        reconciled.migrationPerformed ? "migrated" : baseChanged ? "rebased" : "loaded",
      file,
      recordVersion: record.schemaVersion,
    };
  } catch {
    return { state: defaultThemeRuntimeSettings(theme), status: "invalid", file, diagnostics: [], quarantine: [] };
  }
}

export async function saveThemeRuntimeSettings(theme, catalog, value, {
  root = defaultThemeRuntimeSettingsRoot(),
  transactionRoot = path.basename(path.resolve(root)) === "settings" ? path.dirname(path.resolve(root)) : path.resolve(root),
  quarantine = null,
} = {}) {
  const state = validateThemeRuntimeSettings(value, theme, catalog);
  const directory = path.resolve(root);
  const file = path.join(directory, fileName(theme.id));
  return withAdapterTransaction(theme.id, { root: transactionRoot }, async (transaction) => {
    await ensurePrivateDirectory(directory);
    const baseThemeSha256 = themeRuntimeBaseHash(theme);
    const currentBase = await transaction.readBase();
    if (currentBase && currentBase.baseThemeSha256 !== baseThemeSha256) {
      const stale = new Error("The WorkBuddy theme changed before these settings could be saved");
      stale.code = "ADAPTER_THEME_BASE_STALE";
      throw stale;
    }
    if (!currentBase) await transaction.writeBase(baseThemeSha256);
    let existing = null;
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Runtime settings destination is unsafe");
      existing = await readBoundedJson(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const controls = new Map((catalog.settingsControls ?? []).map((control) => [control.id, control]));
    const tokenFingerprints = Object.fromEntries(["palette.strategy", "background.presentation", ...Object.keys(state.values)].map((tokenId) => [
      tokenId,
      themeRuntimeControlFingerprint(controls.get(tokenId)),
    ]));
    const preservedQuarantine = normalizeQuarantine(quarantine ?? existing?.quarantine);
    const record = {
      kind: THEME_RUNTIME_SETTINGS_KIND,
      schemaVersion: THEME_RUNTIME_SETTINGS_VERSION,
      themeId: theme.id,
      baseThemeSha256,
      tokenFingerprints,
      state,
      quarantine: preservedQuarantine,
      updatedAt: new Date().toISOString(),
    };
    const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    if (bytes.length > MAX_THEME_RUNTIME_SETTINGS_BYTES) throw new Error("Runtime settings record is too large");
    const temporary = path.join(directory, `.${fileName(theme.id)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporary, file);
      await fs.chmod(file, 0o600);
      await syncDirectory(directory);
    } finally {
      await handle?.close().catch(() => {});
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
    return { file, state, record };
  });
}
