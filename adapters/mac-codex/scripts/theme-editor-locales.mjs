import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const THEME_EDITOR_LOCALES_PATH = path.join(here, "..", "contracts", "theme-editor-locales.json");
export const THEME_EDITOR_LOCALES_KIND = "theme.editor-locales";

const REQUIRED_MESSAGES = [
  "settingsNavLabel", "pageTitle", "openThemeSettingsStatus", "editorAria", "closeEditor",
  "editValue", "localeFallbackNotice",
  "currentTheme", "backgroundEffect", "invalidValue",
  "restore", "restoreItem", "chooseColor", "localOnly", "resetAll", "backendUnavailable",
  "applyingChanges", "changesApplied", "persistenceFailed",
  "staticImage", "visualDisabled", "videoPlaying", "videoPaused", "videoLoading", "videoRetry",
  "videoReducedMotion", "rippleUnavailable",
  "directionalUnavailable", "reduceMotionRipple", "reduceMotionDirectional", "rippleEnabled",
  "directionalEnabled", "defaultDirection",
  "themeLoadFailed", "currentThemePreserved",
  "localOverridesNotice", "localOverridesAdjusted",
];

const REQUIRED_MESSAGE_PLACEHOLDERS = {
  currentTheme: ["theme"],
  restoreItem: ["label"],
  chooseColor: ["label"],
  editValue: ["label"],
  openThemeSettingsStatus: ["status"],
};

const EXPECTED_AUTHORITY = "document.documentElement.lang";
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/;

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function exactKeys(value, expected, label) {
  const keys = Object.keys(plainObject(value) ?? {}).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} keys must exactly match the catalog`);
  }
}

function validateTranslations(value, localeCount, label) {
  if (!Array.isArray(value) || value.length !== localeCount ||
      value.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 240)) {
    throw new Error(`${label} must contain one bounded translation per locale`);
  }
}

export function resolveThemeEditorLocale(rawLocale, contract, hostDirection = "") {
  const supported = Array.isArray(contract?.locales) ? contract.locales : [];
  const defaultLocale = supported.includes(contract?.defaultLocale)
    ? contract.defaultLocale : supported[0] || "en-US";
  const raw = String(rawLocale || "").trim().replaceAll("_", "-");
  const lower = raw.toLowerCase();
  const exact = supported.find((locale) => locale.toLowerCase() === lower);
  const alias = contract?.aliases?.[lower];
  const languageFallback = contract?.fallbackByLanguage?.[lower.split("-")[0]];
  const locale = exact || (supported.includes(alias) ? alias : null) ||
    (supported.includes(languageFallback) ? languageFallback : null) || defaultLocale;
  const diagnostic = raw && !exact && !alias && !languageFallback
    ? String(contract?.authority?.fallbackDiagnostic || "host-locale-fallback") : null;
  const normalizedDirection = String(hostDirection || "").toLowerCase();
  const direction = normalizedDirection === "rtl" || normalizedDirection === "ltr"
    ? normalizedDirection
    : (contract?.rtlLocales?.includes(locale) ? "rtl" : "ltr");
  return { locale, diagnostic, direction };
}

export function validateThemeEditorLocales(value, styleCatalog, label = "Theme editor locales") {
  const contract = plainObject(value);
  if (!contract || contract.kind !== THEME_EDITOR_LOCALES_KIND) throw new Error(`${label} has an invalid identity`);
  if (contract.adapterId !== "mac-codex" || !Number.isSafeInteger(contract.revision) || contract.revision < 1) {
    throw new Error(`${label} has invalid adapter metadata`);
  }
  if (!Array.isArray(contract.locales) || contract.locales.length < 2 ||
      new Set(contract.locales).size !== contract.locales.length ||
      contract.locales.some((locale) => typeof locale !== "string" || !LOCALE_PATTERN.test(locale))) {
    throw new Error(`${label} has invalid or duplicate locale ids`);
  }
  if (!contract.locales.includes(contract.defaultLocale)) throw new Error(`${label} defaultLocale is unsupported`);
  const authority = plainObject(contract.authority);
  if (authority?.source !== EXPECTED_AUTHORITY || authority.persistLocale !== false ||
      authority.inferFromContent !== false || authority.fallbackDiagnostic !== "host-locale-fallback") {
    throw new Error(`${label} has an invalid locale authority policy`);
  }
  if (!plainObject(contract.sourceEvidence) || contract.sourceEvidence?.kind !== "host-settings-resources" ||
      contract.sourceEvidence?.bundleResource !== "Resources/app.asar" ||
      contract.sourceEvidence?.settingsChunkPattern !== "webview/assets/*settings-page*.js" ||
      contract.sourceEvidence?.localeResourcePattern !== "native-menu-locales/<locale>.json" ||
      !Array.isArray(contract.sourceEvidence?.declaredLocales) ||
      contract.sourceEvidence.declaredLocales.length !== contract.locales.length ||
      contract.sourceEvidence.declaredLocales.some((locale, index) => locale !== contract.locales[index])) {
    throw new Error(`${label} source evidence must exactly match the translated locale catalog`);
  }
  if (!plainObject(contract.aliases) || Object.entries(contract.aliases).some(([alias, locale]) =>
    !alias.trim() || typeof locale !== "string" || !contract.locales.includes(locale))) {
    throw new Error(`${label} has invalid locale aliases`);
  }
  if (!plainObject(contract.fallbackByLanguage) || Object.entries(contract.fallbackByLanguage).some(([language, locale]) =>
    !/^[a-z]{2,3}$/.test(language) || typeof locale !== "string" || !contract.locales.includes(locale))) {
    throw new Error(`${label} has invalid host fallback mappings`);
  }
  if (!Array.isArray(contract.rtlLocales) || new Set(contract.rtlLocales).size !== contract.rtlLocales.length ||
      contract.rtlLocales.some((locale) => !contract.locales.includes(locale))) {
    throw new Error(`${label} has invalid RTL locale metadata`);
  }
  const localeCount = contract.locales.length;

  exactKeys(contract.messages, REQUIRED_MESSAGES, `${label} messages`);
  for (const [key, translations] of Object.entries(contract.messages)) {
    validateTranslations(translations, localeCount, `${label} message ${key}`);
    for (const placeholder of REQUIRED_MESSAGE_PLACEHOLDERS[key] ?? []) {
      if (translations.some((translation) => !translation.includes(`{${placeholder}}`))) {
        throw new Error(`${label} message ${key} must preserve {${placeholder}} in every locale`);
      }
    }
  }

  const groupIds = (styleCatalog?.groups ?? []).map((group) => group.id);
  const tokenIds = (styleCatalog?.tokens ?? []).map((token) => token.id);
  exactKeys(contract.groupLabels, groupIds, `${label} groupLabels`);
  exactKeys(contract.tokenLabels, tokenIds, `${label} tokenLabels`);
  for (const [id, translations] of Object.entries(contract.groupLabels)) {
    validateTranslations(translations, localeCount, `${label} group ${id}`);
  }
  for (const [id, translations] of Object.entries(contract.tokenLabels)) {
    validateTranslations(translations, localeCount, `${label} token ${id}`);
  }
  return contract;
}

export async function loadThemeEditorLocales(styleCatalog, file = THEME_EDITOR_LOCALES_PATH) {
  return validateThemeEditorLocales(JSON.parse(await fs.readFile(file, "utf8")), styleCatalog);
}
