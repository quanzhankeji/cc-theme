import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { assertSkinThemeIdentity } from "./skin-theme.mjs";
import {
  inspectV2PetAtlas,
  MAX_PET_ATLAS_BYTES,
  MAX_PET_MANIFEST_BYTES,
  normalizeThemePetReference,
  sha256Bytes,
  THEME_PET_MANIFEST_PATH,
  THEME_PET_SPRITESHEET_PATH,
  validateV2PetAtlasFile,
  validatePetManifest,
} from "./skin-pet.mjs";

export const PET_OWNERSHIP_KIND = "skin.pet-ownership";
export const ACTIVE_THEME_KIND = "skin.active-theme";
export const ACTIVE_THEME_FILE = "active-theme.json";
const MAX_THEME_CONFIG_BYTES = 1024 * 1024;
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);

function sameStat(left, right) {
  return left.isFile() && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function readStableFile(filePath, label, maximum) {
  let handle;
  try {
    handle = await fs.open(filePath, OPEN_FLAGS);
  } catch (error) {
    if (error.code === "ELOOP") throw new Error(`${label} must not be a symbolic link`);
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`${label} must be a regular file`);
    if (before.size < 1 || before.size > maximum) throw new Error(`${label} has an invalid file size`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameStat(before, after)) throw new Error(`${label} changed while it was being read`);
    return bytes;
  } finally {
    await handle.close();
  }
}

function decodeJson(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
  if (text.includes("\0")) throw new Error(`${label} contains NUL characters`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function assertContained(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)) return;
  throw new Error(`${label} escapes its allowed root`);
}

async function ensureSafeDirectory(directory, label) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a real directory`);
  await fs.chmod(directory, 0o700);
  return await fs.realpath(directory);
}

async function writeAtomicJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function hashesFor(manifestBytes, spritesheetBytes) {
  return {
    "pet.json": sha256Bytes(manifestBytes),
    "spritesheet.webp": sha256Bytes(spritesheetBytes),
  };
}

async function readExactPetFiles(directory, label) {
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a real directory`);
  const entries = (await fs.readdir(directory)).sort();
  if (entries.length !== 2 || entries[0] !== "pet.json" || entries[1] !== "spritesheet.webp") {
    throw new Error(`${label} must contain exactly pet.json and spritesheet.webp`);
  }
  const manifestBytes = await readStableFile(path.join(directory, "pet.json"), `${label} pet.json`, MAX_PET_MANIFEST_BYTES);
  const spritesheetBytes = await readStableFile(path.join(directory, "spritesheet.webp"), `${label} spritesheet.webp`, MAX_PET_ATLAS_BYTES);
  return { manifestBytes, spritesheetBytes };
}

export async function readThemePetBundle(themeDirectory) {
  const themeRoot = await fs.realpath(themeDirectory);
  const rootStat = await fs.lstat(themeRoot);
  if (!rootStat.isDirectory()) throw new Error("Theme bundle must be a directory");
  const configBytes = await readStableFile(path.join(themeRoot, "theme.json"), "Theme config", MAX_THEME_CONFIG_BYTES);
  const theme = assertSkinThemeIdentity(decodeJson(configBytes, "Theme config"), "Theme config");
  const reference = normalizeThemePetReference(theme.pet, theme.id, "Theme config");
  if (!reference) return { theme, reference: null, bundle: null };

  const petDirectory = path.resolve(themeRoot, "pet");
  assertContained(themeRoot, petDirectory, "Theme pet directory");
  const { manifestBytes, spritesheetBytes } = await readExactPetFiles(petDirectory, "Theme pet directory");
  const manifest = validatePetManifest(
    decodeJson(manifestBytes, "Theme pet manifest"),
    reference.expectedId,
    "Theme pet manifest",
  );
  const atlas = inspectV2PetAtlas(spritesheetBytes, "Theme pet spritesheet");
  return {
    theme,
    reference,
    bundle: { manifest, atlas, manifestBytes, spritesheetBytes, hashes: hashesFor(manifestBytes, spritesheetBytes) },
  };
}

function ownershipPath(recordsRoot, petId) {
  if (!/^skin-[a-z0-9_-]{1,80}$/.test(petId)) throw new Error("Pet id is unsafe");
  const candidate = path.resolve(recordsRoot, `${petId}.json`);
  assertContained(recordsRoot, candidate, "Pet ownership record");
  return candidate;
}

async function readOwnershipRecord(recordsRoot, petId) {
  const file = ownershipPath(recordsRoot, petId);
  try {
    const bytes = await readStableFile(file, "Pet ownership record", MAX_PET_MANIFEST_BYTES);
    const value = decodeJson(bytes, "Pet ownership record");
    if (value?.kind !== PET_OWNERSHIP_KIND || value.petId !== petId || typeof value.themeId !== "string"
      || value.integrity?.algorithm !== "sha256"
      || !/^[a-f0-9]{64}$/.test(value.integrity.files?.["pet.json"] ?? "")
      || !/^[a-f0-9]{64}$/.test(value.integrity.files?.["spritesheet.webp"] ?? "")) return null;
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return null;
  }
}

function recordMatches(record, themeId, hashes) {
  return Boolean(record && record.themeId === themeId
    && record.integrity.files["pet.json"] === hashes["pet.json"]
    && record.integrity.files["spritesheet.webp"] === hashes["spritesheet.webp"]);
}

async function existingDirectoryHashes(directory) {
  try {
    const { manifestBytes, spritesheetBytes } = await readExactPetFiles(directory, "Installed pet directory");
    return hashesFor(manifestBytes, spritesheetBytes);
  } catch {
    return null;
  }
}

function sameHashes(left, right) {
  return Boolean(left && right
    && left["pet.json"] === right["pet.json"]
    && left["spritesheet.webp"] === right["spritesheet.webp"]);
}

function installResult(status, themeId, petId, destination, owned) {
  return {
    status,
    themeId,
    petId,
    destination,
    owned,
    selection: "manual",
    selectionNotice: "Codex currently has no stable public API for selecting a pet automatically; choose this pet in Codex after installation.",
  };
}

export async function installThemePet({ themeDirectory, petsRoot, recordsRoot }) {
  const { theme, bundle } = await readThemePetBundle(themeDirectory);
  if (!bundle) return { status: "absent", themeId: theme.id, owned: false };
  if (!petsRoot || !recordsRoot) throw new Error("A theme pet requires petsRoot and recordsRoot installation destinations");
  const petsDirectory = await ensureSafeDirectory(path.resolve(petsRoot), "Codex pets root");
  const recordsDirectory = await ensureSafeDirectory(path.resolve(recordsRoot), "Pet ownership root");
  const destination = path.resolve(petsDirectory, bundle.manifest.id);
  assertContained(petsDirectory, destination, "Installed pet directory");

  const lockPath = path.join(petsDirectory, `.${bundle.manifest.id}.skin-install.lock`);
  let lock;
  try {
    lock = await fs.open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`Pet installation is already in progress: ${bundle.manifest.id}`);
    throw error;
  }

  let temporary = null;
  try {
    try {
      const stat = await fs.lstat(destination);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Pet id conflict: ${bundle.manifest.id}`);
      const hashes = await existingDirectoryHashes(destination);
      if (!sameHashes(hashes, bundle.hashes)) throw new Error(`Pet id conflict: ${bundle.manifest.id} already exists with different content`);
      const record = await readOwnershipRecord(recordsDirectory, bundle.manifest.id);
      return installResult(
        recordMatches(record, theme.id, bundle.hashes) ? "unchanged" : "existing-identical",
        theme.id,
        bundle.manifest.id,
        destination,
        recordMatches(record, theme.id, bundle.hashes),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    temporary = path.join(petsDirectory, `.${bundle.manifest.id}.installing.${process.pid}.${randomUUID()}`);
    await fs.mkdir(temporary, { mode: 0o700 });
    await fs.writeFile(path.join(temporary, "pet.json"), bundle.manifestBytes, { flag: "wx", mode: 0o600 });
    await fs.writeFile(path.join(temporary, "spritesheet.webp"), bundle.spritesheetBytes, { flag: "wx", mode: 0o600 });
    await validateV2PetAtlasFile(path.join(temporary, "spritesheet.webp"), "Theme pet spritesheet");
    try {
      await fs.rename(temporary, destination);
      temporary = null;
    } catch (error) {
      if (["EEXIST", "ENOTEMPTY"].includes(error.code)) throw new Error(`Pet id conflict: ${bundle.manifest.id}`);
      throw error;
    }

    const record = {
      kind: PET_OWNERSHIP_KIND,
      themeId: theme.id,
      petId: bundle.manifest.id,
      source: { manifest: THEME_PET_MANIFEST_PATH, spritesheet: THEME_PET_SPRITESHEET_PATH },
      integrity: { algorithm: "sha256", files: bundle.hashes },
      createdAt: new Date().toISOString(),
    };
    try {
      await writeAtomicJson(ownershipPath(recordsDirectory, bundle.manifest.id), record);
    } catch (error) {
      const installedHashes = await existingDirectoryHashes(destination);
      if (sameHashes(installedHashes, bundle.hashes)) await fs.rm(destination, { recursive: true, force: true });
      throw error;
    }
    return installResult("installed", theme.id, bundle.manifest.id, destination, true);
  } finally {
    await lock.close().catch(() => {});
    await fs.rm(lockPath, { force: true }).catch(() => {});
    if (temporary) await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}

export async function removeOwnedThemePet({ petId, petsRoot, recordsRoot }) {
  const petsDirectory = path.resolve(petsRoot);
  const recordsDirectory = path.resolve(recordsRoot);
  const record = await readOwnershipRecord(recordsDirectory, petId);
  if (!record) return { status: "unowned", petId, removed: false };
  const destination = path.resolve(petsDirectory, petId);
  assertContained(petsDirectory, destination, "Installed pet directory");
  let stat;
  try {
    stat = await fs.lstat(destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.rm(ownershipPath(recordsDirectory, petId), { force: true });
    return { status: "missing", petId, removed: false };
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return { status: "preserved-modified", petId, removed: false };
  }
  const hashes = await existingDirectoryHashes(destination);
  if (!sameHashes(hashes, record.integrity.files)) {
    return { status: "preserved-modified", petId, removed: false };
  }
  await fs.rm(destination, { recursive: true, force: true });
  await fs.rm(ownershipPath(recordsDirectory, petId), { force: true });
  return { status: "removed", petId, removed: true };
}

export async function writeActiveTheme({ stateRoot, themeId, petResult }) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(themeId)) throw new Error("Active theme id is unsafe");
  const stateDirectory = await ensureSafeDirectory(path.resolve(stateRoot), "Skin runtime state root");
  const pet = petResult?.petId ? {
    id: petResult.petId,
    owned: petResult.owned === true,
    status: petResult.status,
  } : null;
  const value = {
    kind: ACTIVE_THEME_KIND,
    themeId,
    pet,
    updatedAt: new Date().toISOString(),
  };
  await writeAtomicJson(path.join(stateDirectory, ACTIVE_THEME_FILE), value);
  return value;
}

export async function removeActiveThemePet({ stateRoot, petsRoot, recordsRoot }) {
  const activePath = path.join(path.resolve(stateRoot), ACTIVE_THEME_FILE);
  let active;
  try {
    active = decodeJson(await readStableFile(activePath, "Active theme record", MAX_PET_MANIFEST_BYTES), "Active theme record");
  } catch (error) {
    if (error.code === "ENOENT") return { status: "no-active-theme", removed: false };
    throw error;
  }
  let result = { status: "no-owned-pet", removed: false };
  if (active?.kind === ACTIVE_THEME_KIND && active.pet?.owned === true && /^skin-[a-z0-9_-]{1,80}$/.test(active.pet.id ?? "")) {
    result = await removeOwnedThemePet({ petId: active.pet.id, petsRoot, recordsRoot });
  }
  await fs.rm(activePath, { force: true });
  return result;
}

export async function removeAllOwnedThemePets({ petsRoot, recordsRoot }) {
  let entries;
  try {
    entries = await fs.readdir(recordsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const results = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !/^skin-[a-z0-9_-]{1,80}\.json$/.test(entry.name)) continue;
    results.push(await removeOwnedThemePet({ petId: entry.name.slice(0, -5), petsRoot, recordsRoot }));
  }
  return results;
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
  return value;
}

async function main() {
  const command = process.argv[2];
  let result;
  if (command === "install") {
    result = await installThemePet({
      themeDirectory: arg("theme-dir"),
      petsRoot: arg("pets-root"),
      recordsRoot: arg("records-root"),
    });
  } else if (command === "activate") {
    result = await writeActiveTheme({
      stateRoot: arg("state-root"),
      themeId: arg("theme-id"),
      petResult: JSON.parse(arg("pet-result", "{}")),
    });
  } else if (command === "remove-active") {
    result = await removeActiveThemePet({
      stateRoot: arg("state-root"),
      petsRoot: arg("pets-root"),
      recordsRoot: arg("records-root"),
    });
  } else if (command === "remove-owned") {
    result = await removeAllOwnedThemePets({
      petsRoot: arg("pets-root"),
      recordsRoot: arg("records-root"),
    });
  } else {
    throw new Error("Usage: theme-pet-store.mjs <install|activate|remove-active|remove-owned> [options]");
  }
  process.stdout.write(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
