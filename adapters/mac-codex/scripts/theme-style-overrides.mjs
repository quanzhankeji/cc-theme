import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { validateRuntimePreferenceValues, validateStyleOverrideValues } from "./theme-style-catalog.mjs";

export const STYLE_OVERRIDE_KIND = "theme.runtime-style-overrides";
export const MAX_STYLE_OVERRIDE_BYTES = 64 * 1024;
export const STYLE_OVERRIDE_RECORD_REVISION = 2;
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
const TOKEN_ID = /^[A-Za-z][A-Za-z0-9._-]{0,79}$/;

export function defaultStyleOverrideRoot(home = process.env.HOME) {
  if (typeof home !== "string" || !path.isAbsolute(home)) throw new Error("A valid HOME directory is required");
  return path.join(home, "Library", "Application Support", "CCTheme", "style-overrides");
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
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("The Style Override directory is unsafe");
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

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function quarantineEntry(kind, id, value, reason) {
  const safeId = typeof id === "string" && TOKEN_ID.test(id) ? id : "unsafe-token";
  return {
    kind,
    id: safeId,
    ...(safeId === id ? {} : { idSha256: createHash("sha256").update(String(id)).digest("hex") }),
    reason,
    valueSha256: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  };
}

function inheritedQuarantine(value) {
  const entries = Array.isArray(value?.entries) ? value.entries : [];
  return entries.filter((entry) => entry && typeof entry === "object" &&
    ["style-token", "runtime-control"].includes(entry.kind) && TOKEN_ID.test(entry.id ?? "") &&
    typeof entry.reason === "string" && entry.reason.length <= 160 &&
    typeof entry.valueSha256 === "string" && /^[a-f0-9]{64}$/.test(entry.valueSha256))
    .slice(0, 256)
    .map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      ...(typeof entry.idSha256 === "string" && /^[a-f0-9]{64}$/.test(entry.idSha256) ? { idSha256: entry.idSha256 } : {}),
      reason: entry.reason,
      valueSha256: entry.valueSha256,
    }));
}

function splitCompatibleValues(values, catalog, kind) {
  const source = values && typeof values === "object" && !Array.isArray(values) ? values : {};
  const compatible = {};
  const quarantine = [];
  for (const [id, value] of Object.entries(source)) {
    try {
      const normalized = kind === "style-token"
        ? validateStyleOverrideValues({ [id]: value }, catalog, "Saved style override")
        : validateRuntimePreferenceValues({ [id]: value }, catalog, "Saved runtime preference");
      compatible[id] = normalized[id];
    } catch {
      quarantine.push(quarantineEntry(
        kind, id, value,
        kind === "style-token" ? "Token is not compatible with the current Style Catalog" : "Control is not compatible with the current runtime catalog",
      ));
    }
  }
  return { compatible, quarantine };
}

function normalizeLoadedRecord(record, theme, catalog, file) {
  if (!record) return {
    values: {}, runtimePreferences: {}, status: "absent", file, recordRevision: 0,
    transactionRevision: 0, quarantine: { entries: [] }, diagnostics: [],
  };
  if (record.kind !== STYLE_OVERRIDE_KIND || record.themeId !== theme.id) {
    throw new Error("Style override record has an invalid identity");
  }
  const style = splitCompatibleValues(record.values, catalog, "style-token");
  const runtime = splitCompatibleValues(record.runtimePreferences, catalog, "runtime-control");
  const entries = [...inheritedQuarantine(record.quarantine), ...style.quarantine, ...runtime.quarantine]
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.kind === entry.kind && candidate.id === entry.id && candidate.valueSha256 === entry.valueSha256) === index)
    .slice(0, 256);
  const currentHash = styleOverrideThemeHash(theme);
  const baseMatches = [currentHash, legacyStyleOverrideThemeHash(theme)].includes(record.baseThemeSha256);
  const rebased = !baseMatches;
  const quarantined = entries.length > 0;
  const diagnostics = [];
  if (rebased) diagnostics.push({
    code: "base-rebased",
    message: `Preserved ${Object.keys(style.compatible).length + Object.keys(runtime.compatible).length} compatible local overrides after the base Theme changed.`,
  });
  if (quarantined) diagnostics.push({
    code: "overrides-quarantined",
    message: `${entries.length} incompatible local override value${entries.length === 1 ? " was" : "s were"} isolated and not applied.`,
  });
  return {
    values: style.compatible,
    runtimePreferences: runtime.compatible,
    status: quarantined ? (rebased ? "rebased-with-quarantine" : "quarantined") : (rebased ? "rebased" : "loaded"),
    file,
    recordRevision: Number.isSafeInteger(record.recordRevision) ? record.recordRevision : 1,
    transactionRevision: Number.isSafeInteger(record.transactionRevision) && record.transactionRevision >= 0 ? record.transactionRevision : 0,
    quarantine: { entries, ...(rebased ? { sourceBaseThemeSha256: record.baseThemeSha256 } : {}) },
    diagnostics,
  };
}

async function atomicWriteRecord(root, file, record) {
  try {
    const existing = await fs.lstat(file);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("Style override destination is not a regular file");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
  if (bytes.length > MAX_STYLE_OVERRIDE_BYTES) throw new Error("Style override record is too large");
  const temporary = path.join(root, `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
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
}

async function acquireTransactionLock(root, themeId, options = {}) {
  const lock = path.join(root, `.${fileNameForTheme(themeId)}.transaction-lock`);
  const deadline = Date.now() + (options.timeoutMs ?? 5000);
  while (true) {
    try {
      await fs.mkdir(lock, { mode: 0o700 });
      try {
        await fs.writeFile(path.join(lock, "owner.json"), `${JSON.stringify({ pid: process.pid, createdAt: Date.now() })}\n`, { mode: 0o600 });
      } catch (error) {
        await fs.rm(lock, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      return async () => fs.rm(lock, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(await fs.readFile(path.join(lock, "owner.json"), "utf8"));
        const age = Date.now() - Number(owner.createdAt || 0);
        let alive = true;
        try { process.kill(Number(owner.pid), 0); } catch (signalError) { alive = signalError.code !== "ESRCH"; }
        if (!alive && age > 30000) {
          await fs.rm(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        // A second writer can observe the short interval between mkdir and the
        // owner record. Waiting is safer than treating that as a stale lock.
      }
      if (Date.now() >= deadline) throw new Error("Runtime override transaction is busy");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

export async function loadStyleOverrides(theme, catalog, options = {}) {
  const root = options.root ?? defaultStyleOverrideRoot(options.home);
  const file = path.join(root, fileNameForTheme(theme.id));
  const record = await readBoundedJson(file, "Style override record");
  return normalizeLoadedRecord(record, theme, catalog, file);
}

export async function saveStyleOverrides(theme, catalog, values, options = {}) {
  const normalized = validateStyleOverrideValues(values, catalog);
  const runtimePreferences = validateRuntimePreferenceValues(options.runtimePreferences ?? {}, catalog);
  const root = options.root ?? defaultStyleOverrideRoot(options.home);
  await ensurePrivateDirectory(root);
  const file = path.join(root, fileNameForTheme(theme.id));
  const release = await acquireTransactionLock(root, theme.id, options);
  try {
    const current = normalizeLoadedRecord(await readBoundedJson(file, "Style override record"), theme, catalog, file);
    const record = {
      kind: STYLE_OVERRIDE_KIND,
      recordRevision: STYLE_OVERRIDE_RECORD_REVISION,
      transactionRevision: current.transactionRevision + 1,
      themeId: theme.id,
      baseThemeSha256: styleOverrideThemeHash(theme),
      values: normalized,
      runtimePreferences,
      quarantine: options.quarantine ?? current.quarantine,
      updatedAt: new Date().toISOString(),
    };
    await atomicWriteRecord(root, file, record);
    return { file, values: normalized, runtimePreferences, quarantine: record.quarantine, record };
  } finally {
    await release();
  }
}

export async function transactStyleOverrides(theme, catalog, mutation, options = {}) {
  const input = mutation && typeof mutation === "object" && !Array.isArray(mutation) ? mutation : null;
  if (!input) throw new Error("Runtime override mutation must be an object");
  const desiredValues = validateStyleOverrideValues(input.values ?? {}, catalog, "Runtime override mutation values");
  const desiredRuntime = validateRuntimePreferenceValues(input.runtimePreferences ?? {}, catalog, "Runtime override mutation preferences");
  const baseValues = validateStyleOverrideValues(input.baseValues ?? {}, catalog, "Runtime override mutation base values");
  const baseRuntime = validateRuntimePreferenceValues(input.baseRuntimePreferences ?? {}, catalog, "Runtime override mutation base preferences");
  const root = options.root ?? defaultStyleOverrideRoot(options.home);
  await ensurePrivateDirectory(root);
  const file = path.join(root, fileNameForTheme(theme.id));
  const release = await acquireTransactionLock(root, theme.id, options);
  try {
    const current = normalizeLoadedRecord(await readBoundedJson(file, "Style override record"), theme, catalog, file);
    const values = { ...current.values };
    const runtimePreferences = { ...current.runtimePreferences };
    const conflicts = [];
    const merge = (base, desired, active, kind) => {
      for (const id of new Set([...Object.keys(base), ...Object.keys(desired)])) {
        if (Object.hasOwn(base, id) === Object.hasOwn(desired, id) && sameValue(base[id], desired[id])) continue;
        if ((Object.hasOwn(active, id) !== Object.hasOwn(base, id)) || !sameValue(active[id], base[id])) {
          conflicts.push({ kind, id, resolution: "serialized-current-mutation-won" });
        }
        if (Object.hasOwn(desired, id)) active[id] = desired[id];
        else delete active[id];
      }
    };
    merge(baseValues, desiredValues, values, "style-token");
    merge(baseRuntime, desiredRuntime, runtimePreferences, "runtime-control");
    const record = {
      kind: STYLE_OVERRIDE_KIND,
      recordRevision: STYLE_OVERRIDE_RECORD_REVISION,
      transactionRevision: current.transactionRevision + 1,
      themeId: theme.id,
      baseThemeSha256: styleOverrideThemeHash(theme),
      values,
      runtimePreferences,
      quarantine: current.quarantine,
      updatedAt: new Date().toISOString(),
      lastWriter: ["local-editor", "cc-theme-manager"].includes(input.source) ? input.source : "adapter",
    };
    await atomicWriteRecord(root, file, record);
    return {
      file,
      values,
      runtimePreferences,
      quarantine: record.quarantine,
      status: current.status,
      diagnostics: current.diagnostics,
      conflicts,
      transactionRevision: record.transactionRevision,
      record,
    };
  } finally {
    await release();
  }
}
