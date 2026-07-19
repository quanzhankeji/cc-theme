import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ADAPTER_TRANSACTION_KIND = "cc-theme.adapter-transaction";

export function defaultAdapterTransactionRoot(home = process.env.HOME) {
  if (typeof home !== "string" || !path.isAbsolute(home)) throw new Error("A valid HOME directory is required");
  return path.join(home, "Library", "Application Support", "CCTheme", "claude", "transactions");
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function lockOwner(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return null;
    const owner = JSON.parse(await fs.readFile(file, "utf8"));
    return owner && typeof owner === "object" ? { owner, stat } : null;
  } catch (error) {
    if (["ENOENT", "EACCES", "SyntaxError"].includes(error?.code) || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function withAdapterTransaction(operation, callback, options = {}) {
  if (typeof operation !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(operation)) {
    throw new Error("Adapter transaction operation is invalid");
  }
  if (typeof callback !== "function") throw new Error("Adapter transaction callback is required");
  const root = options.root ?? defaultAdapterTransactionRoot(options.home);
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 8000;
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Adapter transaction root is unsafe");
  await fs.chmod(root, 0o700);
  const lock = path.join(root, "adapter.lock");
  const started = Date.now();
  let handle = null;
  const nonce = randomBytes(12).toString("hex");
  while (!handle) {
    try {
      handle = await fs.open(lock, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({
        kind: ADAPTER_TRANSACTION_KIND,
        operation,
        pid: process.pid,
        nonce,
        startedAt: new Date().toISOString(),
      })}\n`);
      await handle.sync();
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await lockOwner(lock);
      const stale = existing && Date.now() - existing.stat.mtimeMs > 30000
        && !processIsAlive(existing.owner.pid);
      if (stale) await fs.rm(lock, { force: true });
      if (Date.now() - started >= timeoutMs) throw new Error("Adapter transaction is busy");
      await delay(25);
    }
  }
  try {
    return await callback({ operation, root });
  } finally {
    await handle.close().catch(() => {});
    const existing = await lockOwner(lock).catch(() => null);
    if (existing?.owner?.nonce === nonce && existing.owner.pid === process.pid) {
      await fs.rm(lock, { force: true }).catch(() => {});
    }
  }
}

async function runTrustedCommand(operation, command, args) {
  if (!path.isAbsolute(command)) throw new Error("Adapter transaction command must be absolute");
  return withAdapterTransaction(operation, () => new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, CC_THEME_ADAPTER_TRANSACTION_HELD: "1" },
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Adapter transaction command ended by ${signal}`));
      else resolve(code ?? 1);
    });
  }));
}

async function main() {
  if (process.argv[2] !== "--run") {
    throw new Error("Usage: adapter-transaction.mjs --run <operation> -- <absolute-command> [args...]");
  }
  const operation = process.argv[3];
  const separator = process.argv.indexOf("--", 4);
  if (separator < 0 || !process.argv[separator + 1]) throw new Error("Adapter transaction command is missing");
  const code = await runTrustedCommand(operation, process.argv[separator + 1], process.argv.slice(separator + 2));
  process.exitCode = code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`CC Theme: ${error.message}`);
    process.exitCode = 1;
  });
}
