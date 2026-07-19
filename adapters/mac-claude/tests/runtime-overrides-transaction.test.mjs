import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadStyleCatalog } from "../scripts/theme-style-catalog.mjs";
import { loadStyleOverrides, saveStyleOverrides, styleOverrideThemeHash } from "../scripts/theme-style-overrides.mjs";
import { normalizeSkinTheme } from "../scripts/skin-theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(await fs.readFile(path.join(root, "contracts", "runtime-overrides-interface.json"), "utf8"));
assert.equal(contract.baseChangePolicy.silentDrop, false);
assert.equal(contract.baseChangePolicy.silentMigration, false);
assert.equal(contract.persistence.crossProcessCoordination, "single-adapter-file-lock");

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-overrides-transaction-"));
try {
  const overrideRoot = path.join(temporary, "style-overrides");
  const catalog = await loadStyleCatalog();
  const base = normalizeSkinTheme({ kind: "skin.theme", id: "rebase", name: "Base", image: "background.png" });
  await saveStyleOverrides(base, catalog, { "text.primary": "#112233" }, { root: overrideRoot });
  const recordFile = path.join(overrideRoot, "rebase.json");
  const stale = JSON.parse(await fs.readFile(recordFile, "utf8"));
  stale.baseThemeSha256 = "0".repeat(64);
  stale.values["retired.token"] = "#445566";
  await fs.writeFile(recordFile, `${JSON.stringify(stale, null, 2)}\n`, { mode: 0o600 });

  const changed = normalizeSkinTheme({
    kind: "skin.theme", id: "rebase", name: "Updated Base", image: "background.png",
    colors: { text: "#abcdef" },
  });
  const changedEffect = normalizeSkinTheme({
    kind: "skin.theme", id: "rebase", name: "Updated Effect", image: "background.png",
    appearance: { backdropBlurPx: 42 },
  });
  assert.notEqual(styleOverrideThemeHash(base), styleOverrideThemeHash(changedEffect));
  const loaded = await loadStyleOverrides(changed, catalog, { root: overrideRoot });
  assert.equal(loaded.status, "rebased-with-quarantine");
  assert.deepEqual(loaded.values, { "text.primary": "#112233" });
  assert.deepEqual(loaded.quarantinedTokenIds, ["retired.token"]);
  assert.equal((await fs.stat(loaded.quarantineFile)).mode & 0o777, 0o600);
  const quarantine = JSON.parse(await fs.readFile(loaded.quarantineFile, "utf8"));
  assert.equal(quarantine.applied, false);
  assert.equal(quarantine.diagnosticCode, "local-overrides-quarantined");
  const replayed = await loadStyleOverrides(changed, catalog, { root: overrideRoot });
  assert.equal(replayed.status, "loaded");
  assert.deepEqual(replayed.values, { "text.primary": "#112233" });

  const writes = await Promise.all([
    saveStyleOverrides(changed, catalog, { "text.primary": "#111111" }, { root: overrideRoot }),
    saveStyleOverrides(changed, catalog, { "text.primary": "#222222" }, { root: overrideRoot }),
    saveStyleOverrides(changed, catalog, { "text.primary": "#333333" }, { root: overrideRoot }),
  ]);
  assert.equal(writes.length, 3);
  const final = await loadStyleOverrides(changed, catalog, { root: overrideRoot });
  assert(["#111111", "#222222", "#333333"].includes(final.values["text.primary"]));
  const sameBaseCorrupt = JSON.parse(await fs.readFile(recordFile, "utf8"));
  sameBaseCorrupt.values["retired.same-base-token"] = "https://example.invalid/unsafe.css";
  await fs.writeFile(recordFile, `${JSON.stringify(sameBaseCorrupt, null, 2)}\n`, { mode: 0o600 });
  const repaired = await loadStyleOverrides(changed, catalog, { root: overrideRoot });
  assert.equal(repaired.status, "loaded-with-quarantine");
  assert.deepEqual(repaired.quarantinedTokenIds, ["retired.same-base-token"]);
  assert.equal(repaired.values["retired.same-base-token"], undefined);

  const invalidRecord = JSON.parse(await fs.readFile(recordFile, "utf8"));
  invalidRecord.kind = "not-an-override-record";
  await fs.writeFile(recordFile, `${JSON.stringify(invalidRecord, null, 2)}\n`, { mode: 0o600 });
  const invalid = await loadStyleOverrides(changed, catalog, { root: overrideRoot });
  assert.equal(invalid.status, "invalid-record");
  assert.equal(invalid.diagnosticCode, "local-overrides-invalid");
  assert.deepEqual(invalid.values, {});
  await assert.rejects(fs.lstat(path.join(temporary, "transactions", "adapter.lock")), /ENOENT/);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
console.log("runtime-overrides-transaction.test.mjs: ok");
