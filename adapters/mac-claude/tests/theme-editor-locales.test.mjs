import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadStyleCatalog } from "../scripts/theme-style-catalog.mjs";
import {
  loadThemeEditorLocales,
  validateThemeEditorLocales,
} from "../scripts/theme-editor-locales.mjs";
import { loadClaudeLocaleCatalog, validateClaudeLocaleCatalog } from "../scripts/claude-locale-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [catalog, localeCatalog, locales, renderer, injector, manifest] = await Promise.all([
  loadStyleCatalog(),
  loadClaudeLocaleCatalog(),
  loadStyleCatalog().then((styleCatalog) => loadThemeEditorLocales(styleCatalog)),
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "scripts", "injector.mjs"), "utf8"),
  fs.readFile(path.join(root, "PROJECT_MANIFEST.json"), "utf8").then(JSON.parse),
]);

assert.equal(locales.kind, "theme.editor-locales");
assert.equal(locales.schemaVersion, "2.0.0");
assert.equal(locales.defaultLocale, "en-US");
assert.deepEqual(locales.locales, [
  "en-US", "fr-FR", "de-DE", "hi-IN", "id-ID", "it-IT",
  "ja-JP", "ko-KR", "pt-BR", "es-419", "es-ES",
]);
assert.deepEqual(locales.locales, localeCatalog.locales);
assert.equal(localeCatalog.authority.global, "claude.hybrid.DesktopIntl");
assert.equal(localeCatalog.authority.adapterMayRequestLocaleChange, false);
assert.equal(localeCatalog.authority.systemLocaleIsAdapterAuthority, false);
assert.equal(localeCatalog.changeLifecycle, "immediate");
assert.equal(localeCatalog.evidence.resourceKeyCountPerLocale, 466);
assert.equal(Object.keys(localeCatalog.directions).length, localeCatalog.locales.length);
assert.equal(locales.messages.overridesInvalid.length, locales.locales.length);
assert.equal(locales.messages.motionFallbackNotice.length, locales.locales.length);
for (const key of [
  "motionFallbackPlaying", "motionFallbackPaused", "motionFallbackLoading",
  "motionFallbackRetry", "motionFallbackReducedMotion",
]) {
  assert.equal(locales.messages[key].length, locales.locales.length);
}
assert.equal(Object.keys(locales.groupLabels).length, catalog.groups.length);
assert.equal(Object.keys(locales.tokenLabels).length, catalog.tokens.length);
for (const translations of [
  ...Object.values(locales.messages),
  ...Object.values(locales.groupLabels),
  ...Object.values(locales.tokenLabels),
]) {
  assert.equal(translations.length, locales.locales.length);
  assert(translations.every((translation) => typeof translation === "string" && translation.trim()));
}
const brandOnlyKeys = new Set(["navigationLabel", "pageTitle"]);
for (const [sectionName, table] of Object.entries({
  messages: locales.messages,
  groupLabels: locales.groupLabels,
  tokenLabels: locales.tokenLabels,
})) {
  for (const [key, translations] of Object.entries(table)) {
    translations.forEach((translation, index) => {
      assert.notEqual(translation, key, `${sectionName}.${key} exposed a raw key`);
      if (index > 0 && !brandOnlyKeys.has(key)) {
        assert.notEqual(translation, translations[0], `${sectionName}.${key} silently fell back to English`);
      }
    });
  }
}

assert.equal(manifest.contracts.editorLocales, "contracts/theme-editor-locales.json");
assert.equal(manifest.contracts.editorLocalesValidator, "scripts/theme-editor-locales.mjs");
assert.equal(manifest.contracts.claudeLocaleCatalog, "contracts/claude-locale-catalog.json");
assert.equal(manifest.contracts.claudeLocaleCatalogValidator, "scripts/claude-locale-catalog.mjs");
assert(renderer.includes('createClaudeLocaleRuntime({'));
assert(renderer.includes('bridge: globalThis["claude.hybrid"]?.DesktopIntl'));
assert(renderer.includes('void localeRuntime.start()'));
assert(renderer.includes('state?.localeRuntime?.dispose?.()'));
assert(renderer.includes('applyEditorLocaleToUi = () =>'));
assert(renderer.includes('new Intl.NumberFormat(EDITOR_LOCALE)'));
assert(renderer.includes('setAttribute("dir", EDITOR_LOCALE_DIRECTION)'));
assert(renderer.includes('"unsupported-host-locale-fallback"'));
assert.equal(renderer.includes("navigator?.language"), false);
assert.equal(renderer.includes("document.documentElement?.lang"), false);
assert.equal(renderer.includes("requestLocaleChange"), false);
assert.equal(renderer.includes('mutation.attributeName === "lang"'), false);
assert(renderer.includes('formatEditorMessage("currentTheme"'));
assert(renderer.includes('? "overridesInvalid"'));
assert(renderer.includes('motionFallbackEnabled ? "motionFallbackPlaying" : "videoPlaying"'));
assert(renderer.includes('motionFallbackEnabled ? "motionFallbackPaused" : "videoPaused"'));
assert(renderer.includes('motionFallbackEnabled ? "motionFallbackLoading" : "videoLoading"'));
assert(renderer.includes('motionFallbackEnabled ? "motionFallbackRetry" : "videoRetry"'));
assert(renderer.includes('motionFallbackEnabled ? "motionFallbackReducedMotion" : "videoReducedMotion"'));
assert(renderer.includes('formatEditorMessage("motionFallbackNotice"'));
assert(renderer.includes('localizedTokenLabel(token)'));
assert(renderer.includes('formatEditorMessage("localeFallback"'));
assert(renderer.includes('formatEditorMessage("themeRuntimeFailureDetail"'));
assert.equal(renderer.includes("result?.message ||"), false);
assert.equal(renderer.includes('`${name.textContent} (${token.id})`'), false);
assert(injector.includes('loadThemeEditorLocales(styleCatalog)'));
assert(injector.includes('loadClaudeLocaleCatalog()'));
assert(injector.includes('.replace("__THEME_EDITOR_LOCALES_JSON__", JSON.stringify(editorLocales))'));
assert(injector.includes('.replace("__CLAUDE_LOCALE_CATALOG_JSON__", JSON.stringify(claudeLocaleCatalog))'));
assert(injector.includes('.replace("__CLAUDE_LOCALE_RUNTIME_FACTORY__", createClaudeLocaleRuntime.toString())'));
assert(injector.includes('name === "theme-editor-locales.json"'));
assert(injector.includes('name === "claude-locale-catalog.json"'));

const invalid = structuredClone(locales);
delete invalid.tokenLabels[catalog.tokens[0].id];
assert.throws(() => validateThemeEditorLocales(invalid, catalog, localeCatalog), /keys must exactly match/);

const invalidLength = structuredClone(locales);
invalidLength.messages.saved.pop();
assert.throws(() => validateThemeEditorLocales(invalidLength, catalog, localeCatalog), /one bounded translation per locale/);

const missingPlaceholder = structuredClone(locales);
missingPlaceholder.messages.chooseColor[1] = "选择颜色";
assert.throws(() => validateThemeEditorLocales(missingPlaceholder, catalog, localeCatalog), /must preserve \{label\}/);

const mismatchedCatalog = structuredClone(localeCatalog);
[mismatchedCatalog.locales[9], mismatchedCatalog.locales[10]] = [
  mismatchedCatalog.locales[10], mismatchedCatalog.locales[9],
];
assert.throws(() => validateThemeEditorLocales(locales, catalog, mismatchedCatalog), /locales must exactly match/);

const invalidCatalog = structuredClone(localeCatalog);
invalidCatalog.authority.systemLocaleIsAdapterAuthority = true;
assert.throws(() => validateClaudeLocaleCatalog(invalidCatalog), /effective-locale authority/);

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "theme-editor-locales-"));
await fs.writeFile(path.join(temporary, "locales.json"), JSON.stringify(locales));
assert.equal((await loadThemeEditorLocales(catalog, path.join(temporary, "locales.json"))).locales.length, 11);
await fs.rm(temporary, { recursive: true, force: true });

console.log("theme-editor-locales.test.mjs: ok");
