import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadThemeSettingsLocales,
  validateThemeSettingsLocales,
} from "../scripts/theme-settings-locales.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [locales, renderer, css, styleCatalog] = await Promise.all([
  loadThemeSettingsLocales(),
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "assets", "skin.css"), "utf8"),
  fs.readFile(path.join(root, "contracts", "theme-style-catalog.json"), "utf8").then(JSON.parse),
]);

assert.equal(locales.kind, "theme.settings-locales");
assert.equal(locales.adapter, "mac-workbuddy");
assert.equal(locales.adapterVersion, locales.host.version);
assert.equal(locales.adapterReleaseRevision, 1);
assert.deepEqual(locales.locales, ["zh-CN", "en-US"]);
assert.equal(locales.defaultLocale, "zh-CN");
assert.equal(locales.host.application, "WorkBuddy");
assert.equal(locales.host.version, "5.2.6");
assert.equal(locales.host.effectiveLocaleSource, "runtimeInterpreter.localeAuthority");
assert.deepEqual(Object.keys(locales.localeMetadata), locales.locales);
for (const translations of Object.values(locales.messages)) {
  assert.equal(translations.length, locales.locales.length);
  assert(translations.every((translation) => translation.trim()));
}
assert.match(renderer, /uiInterpreter\.readHostLocale\(\)/);
assert.doesNotMatch(renderer, /globalThis\.navigator\?\.language|document\.documentElement\?\.lang/);
assert.match(renderer, /settingsLocaleDiagnostic: settingsLocale\.inspect\(\)\.diagnostic/);
assert.match(renderer, /settingsMessage\("settingsIntro"\)/);
assert.match(renderer, /\{ key: "settingsReady", replacements: \{\}, state: "idle" \}/);
assert.doesNotMatch(renderer, /[\u3400-\u9fff]/u);
const rendererKeys = new Set([
  ...renderer.matchAll(/settingsMessage\("([A-Za-z][A-Za-z0-9]*)"/g),
  ...renderer.matchAll(/themeSettingsStatus\("([A-Za-z][A-Za-z0-9]*)"/g),
].map((match) => match[1]));
for (const key of rendererKeys) {
  assert.ok(Object.hasOwn(locales.messages, key), `renderer references missing locale key ${key}`);
}
for (const control of styleCatalog.settingsControls) {
  assert.ok(Object.hasOwn(locales.messages, control.labelKey),
    `Style Catalog control ${control.id} references missing locale key ${control.labelKey}`);
}
assert.match(css, /overflow-wrap:\s*anywhere/,
  "long host-language copy has no bounded wrapping behavior");
assert.match(css, /padding-inline-end:/,
  "Settings layout uses a physical direction instead of host-compatible logical spacing");
assert.match(css, /@media \(max-width: 760px\)/,
  "zoomed or narrow Settings lacks a long-copy layout fallback");

const missingTranslation = structuredClone(locales);
missingTranslation.messages.settingsReady.pop();
assert.throws(() => validateThemeSettingsLocales(missingTranslation), /one bounded translation per locale/);

const missingPlaceholder = structuredClone(locales);
missingPlaceholder.messages.overridesQuarantined[1] = "Incompatible settings were isolated";
assert.throws(() => validateThemeSettingsLocales(missingPlaceholder), /preserve \{count\}/);

console.log("theme-settings-locales.test.mjs: verified WorkBuddy authority, locale resolution, complete translations, and placeholders");
