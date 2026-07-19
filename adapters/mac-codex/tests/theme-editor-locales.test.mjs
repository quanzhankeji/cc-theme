import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadStyleCatalog } from "../scripts/theme-style-catalog.mjs";
import {
  loadThemeEditorLocales,
  resolveThemeEditorLocale,
  validateThemeEditorLocales,
} from "../scripts/theme-editor-locales.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [catalog, locales, renderer, injector, manifest] = await Promise.all([
  loadStyleCatalog(),
  loadStyleCatalog().then((styleCatalog) => loadThemeEditorLocales(styleCatalog)),
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "scripts", "injector.mjs"), "utf8"),
  fs.readFile(path.join(root, "PROJECT_MANIFEST.json"), "utf8").then(JSON.parse),
]);

assert.equal(locales.kind, "theme.editor-locales");
assert.equal(locales.adapterId, "mac-codex");
assert.equal(locales.defaultLocale, "en-US");
assert.equal(locales.locales.length, 65);
assert.deepEqual(locales.sourceEvidence.declaredLocales, locales.locales);
assert.equal(locales.sourceEvidence.kind, "host-settings-resources");
assert.equal(locales.sourceEvidence.bundleResource, "Resources/app.asar");
assert.equal(locales.sourceEvidence.settingsChunkPattern, "webview/assets/*settings-page*.js");
assert.equal(locales.sourceEvidence.localeResourcePattern, "native-menu-locales/<locale>.json");
assert.equal(locales.authority.source, "document.documentElement.lang");
assert.equal(locales.authority.persistLocale, false);
assert.equal(locales.authority.inferFromContent, false);
assert.deepEqual(locales.rtlLocales, ["ar", "fa", "ur"]);
assert(locales.locales.includes("es-419"));
assert(locales.locales.includes("fr-CA"));
assert(locales.locales.includes("pt-PT"));
assert(locales.locales.includes("zh-HK"));
assert.equal(Object.keys(locales.groupLabels).length, catalog.groups.length);
assert.equal(Object.keys(locales.tokenLabels).length, catalog.tokens.length);
for (const translations of [
  ...Object.values(locales.messages),
  ...Object.values(locales.groupLabels),
  ...Object.values(locales.tokenLabels),
]) {
  assert.equal(translations.length, locales.locales.length);
  assert(translations.every((translation) => typeof translation === "string" && translation.trim()));
  assert(translations.every((translation) => !/[\uE000-\uF8FF\uFFFD]/.test(translation)));
}
for (const [key, translations] of Object.entries({
  ...locales.messages, ...locales.groupLabels, ...locales.tokenLabels,
})) {
  assert(translations.every((translation) => translation !== key), `${key} must never render as a bare locale key`);
}
const allTranslations = [
  ...Object.values(locales.messages),
  ...Object.values(locales.groupLabels),
  ...Object.values(locales.tokenLabels),
];
for (let localeIndex = 1; localeIndex < locales.locales.length; localeIndex += 1) {
  const translatedCount = allTranslations.filter((values) => values[localeIndex] !== values[0]).length;
  assert(translatedCount > allTranslations.length / 2,
    `${locales.locales[localeIndex]} must be a complete translation, not an English fallback page`);
}
assert(locales.messages.settingsNavLabel.every((translation) => translation === "cc-theme"));
assert(locales.messages.pageTitle.every((translation) => translation === "cc-theme"));

for (const locale of locales.locales) {
  assert.deepEqual(resolveThemeEditorLocale(locale, locales).locale, locale);
}
assert.deepEqual(resolveThemeEditorLocale("zh_Hans", locales), {
  locale: "zh-CN", diagnostic: null, direction: "ltr",
});
assert.deepEqual(resolveThemeEditorLocale("zh-Hant", locales), {
  locale: "zh-TW", diagnostic: null, direction: "ltr",
});
assert.deepEqual(resolveThemeEditorLocale("es-MX", locales), {
  locale: "es-419", diagnostic: null, direction: "ltr",
});
assert.deepEqual(resolveThemeEditorLocale("ar", locales), {
  locale: "ar", diagnostic: null, direction: "rtl",
});
assert.deepEqual(resolveThemeEditorLocale("ar", locales, "ltr"), {
  locale: "ar", diagnostic: null, direction: "ltr",
});
assert.deepEqual(resolveThemeEditorLocale("xx-Private", locales), {
  locale: "en-US", diagnostic: "host-locale-fallback", direction: "ltr",
});

assert.equal(manifest.contracts.editorLocales, "contracts/theme-editor-locales.json");
assert.equal(manifest.contracts.editorLocalesValidator, "scripts/theme-editor-locales.mjs");
assert(renderer.includes('const resolveEditorLocale = () =>'));
assert(renderer.includes('document.documentElement?.lang || ""'));
assert(!renderer.includes("navigator?.language"));
assert(renderer.includes('const refreshEditorLocale = () =>'));
assert(renderer.includes('mutation.attributeName === "lang"'));
assert(renderer.includes('mutation.attributeName === "dir"'));
assert(renderer.includes('rerenderLocalizedThemeUi()'));
assert(renderer.includes('formatEditorMessage("settingsNavLabel") || "cc-theme"'));
assert(!renderer.includes('document.createTextNode("settingsNavLabel")'));
assert(!renderer.includes("Open Theme settings."));
assert(renderer.includes('formatEditorMessage("currentTheme"'));
assert(renderer.includes('formatEditorMessage("videoLoading"'));
assert(renderer.includes('formatEditorMessage("videoRetry"'));
assert(renderer.includes('formatEditorMessage("videoReducedMotion"'));
assert(renderer.includes('localizedTokenLabel(token)'));
assert(injector.includes('loadThemeEditorLocales(styleCatalog)'));
assert(injector.includes('.replace("__THEME_EDITOR_LOCALES_JSON__", JSON.stringify(editorLocales))'));
assert(injector.includes('name === "theme-editor-locales.json"'));

const referencedMessageKeys = [...renderer.matchAll(/formatEditorMessage\("([A-Za-z0-9]+)"/g)]
  .map((match) => match[1]);
for (const key of referencedMessageKeys) {
  assert(Object.hasOwn(locales.messages, key), `renderer message ${key} must exist in the locale catalog`);
}

const invalid = structuredClone(locales);
delete invalid.tokenLabels[catalog.tokens[0].id];
assert.throws(() => validateThemeEditorLocales(invalid, catalog), /keys must exactly match/);

const invalidLength = structuredClone(locales);
invalidLength.messages.changesApplied.pop();
assert.throws(() => validateThemeEditorLocales(invalidLength, catalog), /one bounded translation per locale/);

const missingPlaceholder = structuredClone(locales);
missingPlaceholder.messages.chooseColor[1] = "选择颜色";
assert.throws(() => validateThemeEditorLocales(missingPlaceholder, catalog), /must preserve \{label\}/);

const mismatchedEvidence = structuredClone(locales);
mismatchedEvidence.sourceEvidence.declaredLocales.pop();
assert.throws(() => validateThemeEditorLocales(mismatchedEvidence, catalog), /source evidence must exactly match/);

const invalidAlias = structuredClone(locales);
invalidAlias.aliases.test = "not-supported";
assert.throws(() => validateThemeEditorLocales(invalidAlias, catalog), /invalid locale aliases/);

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "theme-editor-locales-"));
await fs.writeFile(path.join(temporary, "locales.json"), JSON.stringify(locales));
assert.equal((await loadThemeEditorLocales(catalog, path.join(temporary, "locales.json"))).locales.length, 65);
await fs.rm(temporary, { recursive: true, force: true });

console.log("theme-editor-locales.test.mjs: ok");
