import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const THEME_SETTINGS_LOCALES_PATH = path.join(here, "..", "contracts", "theme-settings-locales.json");
export const THEME_SETTINGS_LOCALES_KIND = "theme.settings-locales";

const REQUIRED_PLACEHOLDERS = {
  overridesQuarantined: ["count"],
  restoreControlAria: ["control"],
};

const plainObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;

export function validateThemeSettingsLocales(value, label = "Theme Settings Locales") {
  const contract = plainObject(value);
  if (!contract || contract.kind !== THEME_SETTINGS_LOCALES_KIND ||
      contract.schemaVersion !== 2 || contract.catalogVersion !== 3 ||
      contract.adapter !== "mac-workbuddy" || contract.adapterVersion !== "5.2.6" ||
      contract.adapterReleaseRevision !== 1) {
    throw new Error(`${label} has an invalid identity`);
  }
  if (!Array.isArray(contract.locales) || contract.locales.length < 2 ||
      new Set(contract.locales).size !== contract.locales.length ||
      contract.locales.some((locale) => typeof locale !== "string" || !/^[a-z]{2}-[A-Z]{2}$/.test(locale))) {
    throw new Error(`${label} has invalid or duplicate locale ids`);
  }
  if (!contract.locales.includes(contract.defaultLocale)) throw new Error(`${label} defaultLocale is unsupported`);
  if (contract.host?.application !== "WorkBuddy" || contract.host?.version !== "5.2.6" ||
      contract.host?.effectiveLocaleSource !== "runtimeInterpreter.localeAuthority" ||
      contract.host?.switchBehavior !== "immediate") {
    throw new Error(`${label} has an invalid WorkBuddy locale authority declaration`);
  }
  const localeMetadata = plainObject(contract.localeMetadata);
  if (!localeMetadata || Object.keys(localeMetadata).length !== contract.locales.length ||
      Object.keys(localeMetadata).some((locale) => !contract.locales.includes(locale))) {
    throw new Error(`${label} localeMetadata must exactly match locales`);
  }
  const aliases = new Set();
  for (const locale of contract.locales) {
    const metadata = plainObject(localeMetadata[locale]);
    if (!metadata || !["ltr", "rtl"].includes(metadata.direction) ||
        typeof metadata.numberFormat !== "string" || !metadata.numberFormat ||
        typeof metadata.languageRange !== "string" || !/^[a-z]{2,3}$/.test(metadata.languageRange) ||
        !Array.isArray(metadata.aliases) || !metadata.aliases.length) {
      throw new Error(`${label} locale ${locale} has invalid metadata`);
    }
    for (const alias of metadata.aliases) {
      const normalized = typeof alias === "string" ? alias.replaceAll("_", "-").toLowerCase() : "";
      if (!normalized || normalized.length > 35 || aliases.has(normalized)) {
        throw new Error(`${label} has an invalid or duplicate locale alias`);
      }
      aliases.add(normalized);
    }
  }
  if (contract.fallback?.unknownLocale !== contract.defaultLocale ||
      !/^[a-z][a-z0-9-]{1,63}$/.test(contract.fallback?.diagnosticCode ?? "")) {
    throw new Error(`${label} has an invalid bounded fallback declaration`);
  }
  const messages = plainObject(contract.messages);
  if (!messages || !Object.keys(messages).length) throw new Error(`${label} requires messages`);
  for (const [key, translations] of Object.entries(messages)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(key) || !Array.isArray(translations) ||
        translations.length !== contract.locales.length ||
        translations.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 320)) {
      throw new Error(`${label} message ${key} must contain one bounded translation per locale`);
    }
    for (const placeholder of REQUIRED_PLACEHOLDERS[key] ?? []) {
      if (translations.some((translation) => !translation.includes(`{${placeholder}}`))) {
        throw new Error(`${label} message ${key} must preserve {${placeholder}} in every locale`);
      }
    }
  }
  for (const key of Object.keys(REQUIRED_PLACEHOLDERS)) {
    if (!Object.hasOwn(messages, key)) throw new Error(`${label} is missing required message ${key}`);
  }
  return contract;
}

export async function loadThemeSettingsLocales(file = THEME_SETTINGS_LOCALES_PATH) {
  return validateThemeSettingsLocales(JSON.parse(await fs.readFile(file, "utf8")));
}
