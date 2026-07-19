import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withAdapterTransaction } from "../scripts/adapter-transaction.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-adapter-transaction-"));
try {
  const events = [];
  const first = withAdapterTransaction("theme", { root }, async (transaction) => {
    events.push("first-start");
    await new Promise((resolve) => setTimeout(resolve, 80));
    await transaction.writeBase("a".repeat(64));
    events.push("first-end");
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = withAdapterTransaction("theme", { root }, async (transaction) => {
    events.push("second-start");
    assert.equal((await transaction.readBase()).baseThemeSha256, "a".repeat(64));
    events.push("second-end");
  });
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second-start", "second-end"]);
  const transactionFiles = await fs.readdir(path.join(root, "transactions"));
  assert.deepEqual(transactionFiles, ["theme.base.json"]);
  assert.equal((await fs.stat(path.join(root, "transactions", "theme.base.json"))).mode & 0o077, 0);

  const abandoned = path.join(root, "transactions", "abandoned.lock");
  await fs.mkdir(abandoned, { mode: 0o700 });
  await fs.writeFile(path.join(abandoned, "owner"), `999999:${crypto.randomUUID()}\n`, { mode: 0o600 });
  const old = new Date(Date.now() - 10_000);
  await fs.utimes(abandoned, old, old);
  await withAdapterTransaction("abandoned", { root }, async () => {});
  assert.equal((await fs.readdir(path.join(root, "transactions"))).includes("abandoned.lock"), false,
    "an abandoned lock owned by a dead process was not recovered");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log("PASS: Manager apply and WorkBuddy Settings share an exclusive, atomic per-theme transaction seam.");
