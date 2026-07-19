import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [localeSource, settingsSource, catalog, renderer] = await Promise.all([
  fs.readFile(path.join(root, "assets", "theme-settings-locale.js"), "utf8"),
  fs.readFile(path.join(root, "assets", "theme-settings-session.js"), "utf8"),
  fs.readFile(path.join(root, "contracts", "theme-settings-locales.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
]);
const createLocale = vm.runInNewContext(localeSource, { Intl });
const createSettingsSession = vm.runInNewContext(settingsSource, {
  clearTimeout,
  setTimeout,
  structuredClone,
});
assert.equal(typeof createLocale, "function");
assert.doesNotMatch(localeSource, /\b(?:document|navigator|localStorage|textContent|innerText)\b/,
  "the locale runtime must not infer language from DOM text, system language, or its own storage");

let hostLocale = { value: "zh-CN", source: "host-storage" };
const locale = createLocale({ catalog, readHostLocale: () => hostLocale });
assert.equal(locale.locale(), "zh-CN");
assert.equal(locale.message("settingsIntro"), catalog.messages.settingsIntro[0]);
assert.equal(locale.message("missingKey"), "", "missing translations must not leak a naked key into the UI");
assert.equal(JSON.stringify(locale.inspect()), JSON.stringify({
  locale: "zh-CN", source: "host-storage", diagnostic: null,
}));

hostLocale = { value: "en_US", source: "host-storage" };
assert.equal(locale.refresh(), true);
assert.equal(locale.locale(), "en-US");
assert.equal(locale.message("settingsIntro"), catalog.messages.settingsIntro[1]);
assert.match(locale.message("overridesQuarantined", { count: 1234 }), /1,234/);
assert.equal(locale.refresh(), false);

hostLocale = { value: "zh-Hant", source: "host-body-attribute" };
assert.equal(locale.refresh(), true);
assert.equal(JSON.stringify(locale.inspect()), JSON.stringify({
  locale: "zh-CN", source: "host-body-attribute", diagnostic: null,
}),
  "WorkBuddy's own zh-* normalization must resolve to its only selectable Chinese locale");

hostLocale = { value: "pt-BR", source: "host-storage" };
assert.equal(locale.refresh(), true);
assert.equal(JSON.stringify(locale.inspect()), JSON.stringify({
  locale: "zh-CN",
  source: "host-storage",
  diagnostic: "host-locale-fallback",
}));

const initialSettings = {
  themeId: "fixture-theme",
  paletteStrategy: "system",
  backgroundPresentation: "enabled",
  values: {},
};
let persisted = structuredClone(initialSettings);
const session = createSettingsSession({
  initialState: initialSettings,
  debounceMs: 20,
  validate: (value) => structuredClone(value),
  preview: () => {},
  persist: async (value) => { persisted = structuredClone(value); },
  status: () => {},
});
session.update({ values: { "interaction.accent": "#123456" } });
assert.equal(session.snapshot().pending, true);
hostLocale = { value: "en-US", source: "host-storage" };
locale.refresh();
assert.equal(session.snapshot().pending, true, "locale refresh cancelled an unrelated pending settings write");
assert.equal(session.snapshot().draft.values["interaction.accent"], "#123456");
await session.flush();
assert.equal(persisted.values["interaction.accent"], "#123456",
  "a safe pending write was lost while the host locale changed");
session.dispose();

assert.match(renderer, /themePanel && themePanel\.lang !== resolveSettingsLocale\(\)/);
assert.match(renderer, /themeSettingsStatusModel/,
  "status feedback must remain semantic so a locale refresh can translate it atomically");
assert.doesNotMatch(renderer, /document\.documentElement\?\.lang|navigator\?\.language/);

console.log("PASS: WorkBuddy host locale aliases, bounded fallback, atomic relocalization, and pending autosave preservation are enforced.");
