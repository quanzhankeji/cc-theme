import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(root, "scripts", "adapter-transaction.mjs");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-adapter-transaction-"));
const home = path.join(temporary, "home");
const log = path.join(temporary, "order.log");
const worker = path.join(temporary, "worker.mjs");

function run(id) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, "--run", "save-local-overrides", "--", process.execPath, worker, log, id], {
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `worker ${id} failed`)));
  });
}

try {
  await fs.writeFile(worker, `
    import fs from "node:fs/promises";
    const [log, id] = process.argv.slice(2);
    if (process.env.CC_THEME_ADAPTER_TRANSACTION_HELD !== "1") throw new Error("transaction marker missing");
    await fs.appendFile(log, \`start:\${id}\\n\`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await fs.appendFile(log, \`end:\${id}\\n\`);
  `, { mode: 0o600 });
  await Promise.all([run("a"), run("b"), run("c")]);
  const lines = (await fs.readFile(log, "utf8")).trim().split("\n");
  assert.equal(lines.length, 6);
  for (let index = 0; index < lines.length; index += 2) {
    assert.match(lines[index], /^start:[abc]$/);
    assert.equal(lines[index + 1], lines[index].replace("start:", "end:"));
  }
  const lock = path.join(home, "Library", "Application Support", "CCTheme", "claude", "transactions", "adapter.lock");
  await assert.rejects(fs.lstat(lock), (error) => error?.code === "ENOENT");

  const scripts = [
    "install-skin-macos.sh", "apply-cc-theme-macos.sh", "start-skin-macos.sh",
    "pause-skin-macos.sh", "restore-skin-macos.sh",
  ];
  for (const name of scripts) {
    const source = await fs.readFile(path.join(root, "scripts", name), "utf8");
    assert(source.includes("enter_adapter_transaction"), `${name} bypasses the Adapter transaction Seam`);
  }
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("adapter-transaction.test.mjs: ok");
