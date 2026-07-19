import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeSkinTheme } from "../scripts/skin-theme.mjs";
import { executeRuntimeOverrideRequest } from "../scripts/runtime-override-transaction.mjs";
import { loadStyleCatalog } from "../scripts/theme-style-catalog.mjs";
import {
  loadStyleOverrides,
  styleOverrideThemeHash,
  transactStyleOverrides,
} from "../scripts/theme-style-overrides.mjs";

const [catalog, temporary] = await Promise.all([
  loadStyleCatalog(),
  fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-override-transaction-")),
]);

try {
  const root = path.join(temporary, "state");
  const theme = normalizeSkinTheme({ kind: "skin.theme", id: "transaction-theme", name: "Transaction", image: "background.webp" });
  const initial = await transactStyleOverrides(theme, catalog, {
    source: "local-editor",
    baseValues: {},
    values: { "text.primary": "#111111" },
    baseRuntimePreferences: {},
    runtimePreferences: {},
  }, { root });
  assert.equal(initial.transactionRevision, 1);

  const sharedBase = { ...initial.values };
  const [manager, editor] = await Promise.all([
    transactStyleOverrides(theme, catalog, {
      source: "cc-theme-manager",
      baseValues: sharedBase,
      values: { ...sharedBase, "text.strong": "#222222" },
      baseRuntimePreferences: {},
      runtimePreferences: { "background.presentation": "paused" },
    }, { root }),
    transactStyleOverrides(theme, catalog, {
      source: "local-editor",
      baseValues: sharedBase,
      values: { "text.primary": "#333333" },
      baseRuntimePreferences: {},
      runtimePreferences: {},
    }, { root }),
  ]);
  assert.notEqual(manager.transactionRevision, editor.transactionRevision);
  const merged = await loadStyleOverrides(theme, catalog, { root });
  assert.deepEqual(merged.values, { "text.primary": "#333333", "text.strong": "#222222" });
  assert.deepEqual(merged.runtimePreferences, { "background.presentation": "paused" });

  const sameBase = { ...merged.values };
  const sameToken = await Promise.all([
    transactStyleOverrides(theme, catalog, {
      source: "local-editor", baseValues: sameBase, values: { ...sameBase, "text.primary": "#444444" },
      baseRuntimePreferences: merged.runtimePreferences, runtimePreferences: merged.runtimePreferences,
    }, { root }),
    transactStyleOverrides(theme, catalog, {
      source: "cc-theme-manager", baseValues: sameBase, values: { ...sameBase, "text.primary": "#555555" },
      baseRuntimePreferences: merged.runtimePreferences, runtimePreferences: merged.runtimePreferences,
    }, { root }),
  ]);
  assert(sameToken.some((result) => result.conflicts.some((item) => item.id === "text.primary")));
  assert(["#444444", "#555555"].includes((await loadStyleOverrides(theme, catalog, { root })).values["text.primary"]));

  const interfaceThemeDir = path.join(temporary, "interface-theme");
  await fs.mkdir(interfaceThemeDir);
  await fs.writeFile(path.join(interfaceThemeDir, "theme.json"), `${JSON.stringify({
    kind: "skin.theme", id: "interface-theme", name: "Interface", image: "background.webp",
  }, null, 2)}\n`);
  const interfaceResult = await executeRuntimeOverrideRequest({
    kind: "cc-theme.runtime-override-request",
    adapterId: "mac-codex",
    operation: "mutate",
    themeDir: interfaceThemeDir,
    source: "cc-theme-manager",
    baseValues: {},
    values: { "text.primary": "#123456" },
    baseRuntimePreferences: {},
    runtimePreferences: { "background.presentation": "paused" },
  }, { root });
  assert.equal(interfaceResult.status, "success");
  assert.equal(interfaceResult.values["text.primary"], "#123456");
  assert.equal(interfaceResult.runtimePreferences["background.presentation"], "paused");

  const rejectedWrite = await executeRuntimeOverrideRequest({
    kind: "cc-theme.runtime-override-request",
    adapterId: "mac-codex",
    operation: "mutate",
    themeDir: interfaceThemeDir,
    source: "cc-theme-manager",
    baseValues: interfaceResult.values,
    values: { ...interfaceResult.values, "text.primary": "url(file:///tmp/not-a-color)" },
    baseRuntimePreferences: interfaceResult.runtimePreferences,
    runtimePreferences: interfaceResult.runtimePreferences,
  }, { root });
  assert.equal(rejectedWrite.status, "failed");
  const afterRejectedWrite = await executeRuntimeOverrideRequest({
    kind: "cc-theme.runtime-override-request",
    adapterId: "mac-codex",
    operation: "inspect",
    themeDir: interfaceThemeDir,
  }, { root });
  assert.equal(afterRejectedWrite.status, "success");
  assert.equal(afterRejectedWrite.values["text.primary"], "#123456");

  const linkedThemeDir = path.join(temporary, "linked-interface-theme");
  await fs.symlink(interfaceThemeDir, linkedThemeDir);
  const linkedResult = await executeRuntimeOverrideRequest({
    kind: "cc-theme.runtime-override-request",
    adapterId: "mac-codex",
    operation: "inspect",
    themeDir: linkedThemeDir,
  }, { root });
  assert.equal(linkedResult.status, "failed");
  assert.match(linkedResult.message, /real local directory/);

  const file = path.join(root, `${theme.id}.json`);
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  raw.baseThemeSha256 = styleOverrideThemeHash(theme);
  raw.values["retired.token"] = "javascript:ignored";
  raw.runtimePreferences["retired.control"] = "on";
  await fs.writeFile(file, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  const quarantined = await loadStyleOverrides(theme, catalog, { root });
  assert.equal(quarantined.status, "quarantined");
  assert.equal(quarantined.quarantine.entries.length, 2);
  assert.equal(JSON.stringify(quarantined.quarantine).includes("javascript:ignored"), false);
  assert(quarantined.diagnostics.some((item) => item.code === "overrides-quarantined"));

  const changedTheme = normalizeSkinTheme({ kind: "skin.theme", id: theme.id, name: theme.name, image: theme.image, colors: { text: "#abcdef" } });
  const rebased = await loadStyleOverrides(changedTheme, catalog, { root });
  assert.equal(rebased.status, "rebased-with-quarantine");
  assert(Object.keys(rebased.values).length >= 2);
  assert(rebased.diagnostics.some((item) => item.code === "base-rebased"));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("runtime-override-transaction.test.mjs: ok");
