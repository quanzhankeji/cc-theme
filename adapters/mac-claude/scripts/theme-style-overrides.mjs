import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { validateStyleOverrideValues } from "./theme-style-catalog.mjs";
import { defaultAdapterTransactionRoot, withAdapterTransaction } from "./adapter-transaction.mjs";

export const STYLE_OVERRIDE_KIND = "theme.runtime-style-overrides";
export const STYLE_OVERRIDE_QUARANTINE_KIND = "theme.runtime-style-overrides-quarantine";
export const MAX_STYLE_OVERRIDE_BYTES = 64 * 1024;
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);

export function defaultStyleOverrideRoot(home = process.env.HOME) {
  if (typeof home !== "string" || !path.isAbsolute(home)) throw new Error("A valid HOME directory is required");
  return path.join(home, "Library", "Application Support", "CCTheme", "claude", "style-overrides");
}

function transactionRootForOverrideRoot(root, options) {
  if (options.transactionRoot) return options.transactionRoot;
  if (options.root) return path.join(path.dirname(root), "transactions");
  return defaultAdapterTransactionRoot(options.home);
}

export function validateRuntimePreferences(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Runtime preferences must be an object");
  }
  const allowed = new Set(["backgroundPresentation", "interactiveEffectEnabled"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Unknown runtime preference: ${key}`);
  }
  const preferences = {};
  if (value.backgroundPresentation !== undefined) {
    if (!["playing", "paused", "disabled"].includes(value.backgroundPresentation)) {
      throw new Error("Invalid background presentation preference");
    }
    preferences.backgroundPresentation = value.backgroundPresentation;
  }
  if (value.interactiveEffectEnabled !== undefined) {
    if (typeof value.interactiveEffectEnabled !== "boolean") {
      throw new Error("Invalid interactive effect preference");
    }
    preferences.interactiveEffectEnabled = value.interactiveEffectEnabled;
  }
  return preferences;
}

export function styleOverrideThemeHash(theme) {
  const styleBase = {
    kind: theme.kind,
    id: theme.id,
    shellMode: theme.shellMode,
    paletteMode: theme.art?.paletteMode,
    explicitColorKeys: theme.explicitColorKeys,
    explicitSemanticColorKeys: theme.explicitSemanticColorKeys,
    resolvedPalettes: theme.resolvedPalettes,
    colors: theme.colors,
    semanticColors: theme.semanticColors,
    fonts: theme.fonts,
    appearance: {
      backdropBlurPx: theme.appearance?.backdropBlurPx,
      backdropSaturation: theme.appearance?.backdropSaturation,
      backgroundVideoScrimOpacity: theme.appearance?.backgroundVideoScrimOpacity,
    },
    interactiveBackground: theme.interactiveBackground ? {
      type: theme.interactiveBackground.type,
      scrimOpacity: theme.interactiveBackground.scrimOpacity,
    } : null,
  };
  return createHash("sha256").update(JSON.stringify(styleBase)).digest("hex");
}

function legacyStyleOverrideThemeHash(theme) {
  return createHash("sha256").update(JSON.stringify(theme)).digest("hex");
}

function fileNameForTheme(themeId) {
  if (typeof themeId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(themeId)) throw new Error("Invalid style override theme id");
  return `${themeId}.json`;
}

async function ensurePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Style override directory is unsafe: ${directory}`);
  await fs.chmod(directory, 0o700);
}

async function readBoundedJson(file, label) {
  let handle;
  try {
    handle = await fs.open(file, OPEN_FLAGS);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code === "ELOOP") throw new Error(`${label} must not be a symbolic link`);
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_STYLE_OVERRIDE_BYTES) throw new Error(`${label} is not a bounded regular file`);
    const bytes = await handle.readFile();
    if (bytes.length > MAX_STYLE_OVERRIDE_BYTES) throw new Error(`${label} is too large`);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    await handle.close();
  }
}

function partitionOverrideValues(values, catalog) {
  const compatible = {};
  const incompatible = {};
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return { compatible, incompatible: { "$record.values": { reason: "not-an-object" } } };
  }
  for (const [id, value] of Object.entries(values)) {
    try {
      Object.assign(compatible, validateStyleOverrideValues({ [id]: value }, catalog, `Saved style override ${id}`));
    } catch (error) {
      incompatible[id] = { reason: String(error.message).slice(0, 300), value };
    }
  }
  return { compatible, incompatible };
}

async function writeQuarantine(root, theme, previousHash, incompatible) {
  if (!Object.keys(incompatible).length) return null;
  const directory = path.join(path.dirname(root), "style-overrides-quarantine", theme.id);
  await ensurePrivateDirectory(directory);
  const nextHash = styleOverrideThemeHash(theme);
  const name = `${String(previousHash || "unknown").slice(0, 16)}-to-${nextHash.slice(0, 16)}.json`;
  const file = path.join(directory, name);
  const record = {
    kind: STYLE_OVERRIDE_QUARANTINE_KIND,
    themeId: theme.id,
    previousBaseThemeSha256: typeof previousHash === "string" ? previousHash : null,
    nextBaseThemeSha256: nextHash,
    incompatible,
    applied: false,
    diagnosticCode: "local-overrides-quarantined",
    createdAt: new Date().toISOString(),
  };
  const temporary = path.join(directory, `.${name}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    try { await fs.rename(temporary, file); } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    await fs.chmod(file, 0o600).catch(() => {});
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
  return file;
}

async function saveStyleOverridesUnlocked(theme, catalog, values, options = {}) {
  const normalized = validateStyleOverrideValues(values, catalog);
  const preferences = validateRuntimePreferences(options.preferences ?? {});
  const root = options.root ?? defaultStyleOverrideRoot(options.home);
  await ensurePrivateDirectory(root);
  const file = path.join(root, fileNameForTheme(theme.id));
  try {
    const existing = await fs.lstat(file);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error("Style override destination is not a regular file");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const record = {
    kind: STYLE_OVERRIDE_KIND,
    schemaVersion: 2,
    themeId: theme.id,
    baseThemeSha256: styleOverrideThemeHash(theme),
    values: normalized,
    preferences,
    updatedAt: new Date().toISOString(),
  };
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
  if (bytes.length > MAX_STYLE_OVERRIDE_BYTES) throw new Error("Style override record is too large");
  const temporary = path.join(root, `.${fileNameForTheme(theme.id)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600);
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
  return { file, values: normalized, preferences, record };
}

export async function loadStyleOverrides(theme, catalog, options = {}) {
  const root = options.root ?? defaultStyleOverrideRoot(options.home);
  const file = path.join(root, fileNameForTheme(theme.id));
  const currentHash = styleOverrideThemeHash(theme);
  const hashes = [currentHash, legacyStyleOverrideThemeHash(theme)];
  const inspect = (record) => {
    if (!record) return { status: "absent", values: {}, preferences: {}, file };
    if (record.kind !== STYLE_OVERRIDE_KIND || record.themeId !== theme.id) {
      return { status: "invalid-record", values: {}, preferences: {}, diagnosticCode: "local-overrides-invalid", file };
    }
    const partitioned = partitionOverrideValues(record.values, catalog);
    let preferences = {};
    try {
      preferences = validateRuntimePreferences(record.preferences ?? {});
    } catch (error) {
      partitioned.incompatible["$record.preferences"] = { reason: String(error.message).slice(0, 300) };
    }
    const quarantinedTokenIds = Object.keys(partitioned.incompatible);
    const baseMatches = hashes.includes(record.baseThemeSha256);
    if (baseMatches && quarantinedTokenIds.length === 0) {
      return { values: partitioned.compatible, preferences, status: "loaded", diagnosticCode: null, file };
    }
    return {
      values: partitioned.compatible,
      preferences,
      status: "repair-required",
      record,
      baseMatches,
      incompatible: partitioned.incompatible,
      quarantinedTokenIds,
      file,
    };
  };

  const initial = inspect(await readBoundedJson(file, "Style override record"));
  if (initial.status !== "repair-required") return initial;
  return withAdapterTransaction("rebase-local-overrides", async () => {
    // Another Manager/editor process may have committed while this caller was
    // waiting for the lock. Re-read inside the transaction so stale state can
    // never overwrite the newer serialized commit.
    const current = inspect(await readBoundedJson(file, "Style override record"));
    if (current.status !== "repair-required") return current;
    const quarantineFile = await writeQuarantine(root, theme, current.record.baseThemeSha256, current.incompatible);
    await saveStyleOverridesUnlocked(theme, catalog, current.values, { ...options, root, preferences: current.preferences });
    const quarantined = current.quarantinedTokenIds.length > 0;
    return {
      values: current.values,
      preferences: current.preferences,
      status: current.baseMatches
        ? "loaded-with-quarantine"
        : quarantined ? "rebased-with-quarantine" : "rebased",
      diagnosticCode: quarantined ? "local-overrides-quarantined" : "local-overrides-rebased",
      quarantinedTokenIds: current.quarantinedTokenIds,
      quarantineFile,
      file,
    };
  }, { root: transactionRootForOverrideRoot(root, options) });
}

export async function saveStyleOverrides(theme, catalog, values, options = {}) {
  const overrideRoot = options.root ?? defaultStyleOverrideRoot(options.home);
  const transactionRoot = transactionRootForOverrideRoot(overrideRoot, options);
  return withAdapterTransaction("save-local-overrides", () =>
    saveStyleOverridesUnlocked(theme, catalog, values, options), { root: transactionRoot });
}
