import crypto, { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";

const LOCK_TIMEOUT_MS = 8_000;
const STALE_LOCK_MS = 5_000;
const SAFE_THEME_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_SHA256 = /^[a-f0-9]{64}$/;

export function defaultAdapterStateRoot(home = os.homedir()) {
  return path.join(home, "Library", "Application Support", "mac-workbuddy");
}

function assertThemeId(themeId) {
  if (typeof themeId !== "string" || !SAFE_THEME_ID.test(themeId)) throw new Error("Invalid adapter transaction theme id");
  return themeId;
}

async function ensurePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Adapter transaction directory is unsafe");
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

async function atomicPrivateJson(file, value) {
  const directory = path.dirname(file);
  await ensurePrivateDirectory(directory);
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
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
}

async function readBaseRecord(file) {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 8 * 1024) {
    throw new Error("Adapter transaction base record is unsafe");
  }
  const record = JSON.parse(await fs.readFile(file, "utf8"));
  if (record?.kind !== "cc-theme.adapter-base" || record.schemaVersion !== 1 ||
      !SAFE_THEME_ID.test(record.themeId ?? "") || !SAFE_SHA256.test(record.baseThemeSha256 ?? "")) {
    throw new Error("Adapter transaction base record is invalid");
  }
  return record;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function lockOwnerAlive(lockDirectory) {
  try {
    const ownerFile = path.join(lockDirectory, "owner");
    const stat = await fs.lstat(ownerFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 3 || stat.size > 160) return true;
    const pid = Number.parseInt((await fs.readFile(ownerFile, "utf8")).split(":", 1)[0], 10);
    if (!Number.isSafeInteger(pid) || pid < 1) return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code !== "ESRCH";
    }
  } catch (error) {
    return error.code === "ENOENT";
  }
}

async function acquireLock(lockDirectory, timeoutMs) {
  const startedAt = Date.now();
  while (true) {
    try {
      await fs.mkdir(lockDirectory, { mode: 0o700 });
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const stat = await fs.lstat(lockDirectory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Adapter transaction lock is unsafe");
        if (Date.now() - stat.mtimeMs > STALE_LOCK_MS && !(await lockOwnerAlive(lockDirectory))) {
          await fs.rm(lockDirectory, { recursive: true, force: true });
          continue;
        }
      } catch (inspectError) {
        if (inspectError.code === "ENOENT") continue;
        throw inspectError;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        const timeout = new Error("Timed out waiting for the WorkBuddy adapter transaction");
        timeout.code = "ADAPTER_TRANSACTION_TIMEOUT";
        throw timeout;
      }
      await delay(20 + Math.floor(Math.random() * 20));
    }
  }
}

export async function withAdapterTransaction(themeId, {
  root = defaultAdapterStateRoot(),
  timeoutMs = LOCK_TIMEOUT_MS,
} = {}, operation) {
  assertThemeId(themeId);
  if (typeof operation !== "function") throw new Error("Adapter transaction requires an operation");
  const transactionRoot = path.join(path.resolve(root), "transactions");
  await ensurePrivateDirectory(transactionRoot);
  const lockDirectory = path.join(transactionRoot, `${themeId}.lock`);
  const baseFile = path.join(transactionRoot, `${themeId}.base.json`);
  await acquireLock(lockDirectory, timeoutMs);
  const owner = crypto.randomUUID();
  await fs.writeFile(path.join(lockDirectory, "owner"), `${process.pid}:${owner}\n`, { flag: "wx", mode: 0o600 });
  try {
    return await operation({
      themeId,
      root: path.resolve(root),
      async readBase() {
        const record = await readBaseRecord(baseFile);
        if (record && record.themeId !== themeId) throw new Error("Adapter transaction base theme id mismatch");
        return record;
      },
      async writeBase(baseThemeSha256) {
        if (!SAFE_SHA256.test(baseThemeSha256 ?? "")) throw new Error("Invalid adapter base theme hash");
        const record = {
          kind: "cc-theme.adapter-base",
          schemaVersion: 1,
          themeId,
          baseThemeSha256,
          updatedAt: new Date().toISOString(),
        };
        await atomicPrivateJson(baseFile, record);
        return record;
      },
    });
  } finally {
    await fs.rm(lockDirectory, { recursive: true, force: true });
  }
}
