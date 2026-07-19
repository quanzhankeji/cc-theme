import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClaudeLocaleCatalog, validateClaudeLocaleCatalog } from "./claude-locale-catalog.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const THEME_EDITOR_LOCALES_PATH = path.join(here, "..", "contracts", "theme-editor-locales.json");
export const THEME_EDITOR_LOCALES_KIND = "theme.editor-locales";

const REQUIRED_MESSAGES = [
  "navigationLabel", "pageTitle", "editorAria", "closeEditor", "currentTheme", "backgroundEffect", "invalidValue",
  "restore", "restoreItem", "chooseColor", "localOnly", "resetAll",
  "backendUnavailable", "saving", "saved", "saveFailed",
  "overridesRebased", "overridesQuarantined", "overridesInvalid",
  "staticImage", "visualDisabled", "videoPlaying", "videoPaused", "videoLoading", "videoRetry",
  "videoReducedMotion", "motionFallbackNotice", "motionFallbackPlaying", "motionFallbackPaused",
  "motionFallbackLoading", "motionFallbackRetry", "motionFallbackReducedMotion", "rippleUnavailable",
  "directionalUnavailable", "reduceMotionRipple", "reduceMotionDirectional", "rippleEnabled",
  "directionalEnabled", "defaultDirection",
  "themeLoadFailed", "currentThemePreserved", "groupItemCount", "localeFallback",
  "themeRuntimeFailureDetail",
];

const REQUIRED_MESSAGE_PLACEHOLDERS = {
  currentTheme: ["theme"],
  restoreItem: ["label"],
  chooseColor: ["label"],
  overridesQuarantined: ["count"],
  groupItemCount: ["count"],
  localeFallback: ["locale"],
};

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

function validateTranslations(value, localeCount, label, key) {
  if (!Array.isArray(value) || value.length !== localeCount ||
      value.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 320 || entry === key)) {
    throw new Error(`${label} must contain one bounded translation per locale`);
  }
}

export function validateThemeEditorLocales(value, styleCatalog, localeCatalogValue, label = "Theme editor locales") {
  const contract = plainObject(value);
  if (!contract || contract.kind !== THEME_EDITOR_LOCALES_KIND) throw new Error(`${label} has an invalid identity`);
  if (contract.schemaVersion !== "2.0.0" || contract.localeCatalog !== "claude.locale-catalog/1.0.0") {
    throw new Error(`${label} is not bound to the supported Claude locale catalog`);
  }
  const localeCatalog = validateClaudeLocaleCatalog(localeCatalogValue, `${label} Claude locale catalog`);
  if (!Array.isArray(contract.locales) || contract.locales.length < 2 ||
      new Set(contract.locales).size !== contract.locales.length ||
      contract.locales.some((locale) => typeof locale !== "string" || !/^[a-z]{2}(?:-(?:[A-Z]{2}|\d{3}))$/.test(locale))) {
    throw new Error(`${label} has invalid or duplicate locale ids`);
  }
  if (contract.locales.join("\0") !== localeCatalog.locales.join("\0")) {
    throw new Error(`${label} locales must exactly match the Claude locale catalog`);
  }
  if (!contract.locales.includes(contract.defaultLocale)) throw new Error(`${label} defaultLocale is unsupported`);
  if (contract.defaultLocale !== localeCatalog.defaultLocale) throw new Error(`${label} defaultLocale differs from Claude`);
  const localeCount = contract.locales.length;

  exactKeys(contract.messages, REQUIRED_MESSAGES, `${label} messages`);
  for (const [key, translations] of Object.entries(contract.messages)) {
    validateTranslations(translations, localeCount, `${label} message ${key}`, key);
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
    validateTranslations(translations, localeCount, `${label} group ${id}`, id);
  }
  for (const [id, translations] of Object.entries(contract.tokenLabels)) {
    validateTranslations(translations, localeCount, `${label} token ${id}`, id);
  }
  return contract;
}

export async function loadThemeEditorLocales(styleCatalog, file = THEME_EDITOR_LOCALES_PATH) {
  const localeCatalog = await loadClaudeLocaleCatalog();
  return validateThemeEditorLocales(JSON.parse(await fs.readFile(file, "utf8")), styleCatalog, localeCatalog);
}
