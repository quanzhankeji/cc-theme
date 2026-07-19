import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLAUDE_LOCALE_CATALOG_PATH = path.join(here, "..", "contracts", "claude-locale-catalog.json");
export const CLAUDE_LOCALE_CATALOG_KIND = "claude.locale-catalog";

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function validateClaudeLocaleCatalog(value, label = "Claude locale catalog") {
  const catalog = plainObject(value);
  if (!catalog || catalog.kind !== CLAUDE_LOCALE_CATALOG_KIND || catalog.adapterId !== "mac-claude") {
    throw new Error(`${label} has an invalid identity`);
  }
  if (!Array.isArray(catalog.locales) || catalog.locales.length < 2 ||
      new Set(catalog.locales).size !== catalog.locales.length ||
      catalog.locales.some((locale) => typeof locale !== "string" || !/^[a-z]{2}(?:-(?:[A-Z]{2}|\d{3}))$/.test(locale))) {
    throw new Error(`${label} has invalid or duplicate BCP 47 locale ids`);
  }
  if (!catalog.locales.includes(catalog.defaultLocale)) throw new Error(`${label} defaultLocale is unsupported`);
  const authority = plainObject(catalog.authority);
  if (authority?.global !== "claude.hybrid.DesktopIntl" ||
      authority.initialMethod !== "getInitialLocale" ||
      authority.changeEventMethod !== "onLocaleChanged" ||
      authority.adapterMayRequestLocaleChange !== false ||
      authority.systemLocaleIsAdapterAuthority !== false ||
      authority.domTextMayIdentifyLocale !== false ||
      authority.conversationContentMayIdentifyLocale !== false) {
    throw new Error(`${label} does not preserve Claude effective-locale authority`);
  }
  if (catalog.changeLifecycle !== "immediate") throw new Error(`${label} has an unsupported lifecycle`);
  const directions = plainObject(catalog.directions);
  if (!directions || Object.keys(directions).sort().join("\0") !== [...catalog.locales].sort().join("\0") ||
      Object.values(directions).some((direction) => !["ltr", "rtl"].includes(direction))) {
    throw new Error(`${label} directions must exactly cover all declared locales`);
  }
  const aliases = plainObject(catalog.aliases);
  if (!aliases || Object.entries(aliases).some(([alias, locale]) =>
    !/^[A-Za-z]{2,3}(?:[-_](?:[A-Za-z]{2}|\d{3}))?$/.test(alias) || !catalog.locales.includes(locale))) {
    throw new Error(`${label} has an invalid alias map`);
  }
  if (catalog.fallback?.diagnosticCode !== "unsupported-host-locale-fallback" ||
      catalog.fallback?.pageAtomic !== true ||
      !Number.isInteger(catalog.fallback?.maximumDiagnosticLocaleLength)) {
    throw new Error(`${label} has an invalid fallback contract`);
  }
  return catalog;
}

export async function loadClaudeLocaleCatalog(file = CLAUDE_LOCALE_CATALOG_PATH) {
  return validateClaudeLocaleCatalog(JSON.parse(await fs.readFile(file, "utf8")));
}

export function resolveClaudeEditorLocale(catalogValue, hostLocale) {
  const catalog = validateClaudeLocaleCatalog(catalogValue);
  const requested = String(hostLocale || "").trim().slice(0, catalog.fallback.maximumDiagnosticLocaleLength);
  const normalized = requested.replace(/_/g, "-").toLowerCase();
  const exact = catalog.locales.find((locale) => locale.toLowerCase() === normalized);
  if (exact) return { locale: exact, direction: catalog.directions[exact], diagnosticCode: null, requested };
  const aliases = Object.entries(catalog.aliases).map(([alias, locale]) => [
    alias.replace(/_/g, "-").toLowerCase(), locale,
  ]);
  const alias = aliases.find(([candidate]) => candidate === normalized)?.[1];
  if (alias) {
    return {
      locale: alias,
      direction: catalog.directions[alias],
      diagnosticCode: "host-locale-alias-normalized",
      requested,
    };
  }
  return {
    locale: catalog.defaultLocale,
    direction: catalog.directions[catalog.defaultLocale],
    diagnosticCode: catalog.fallback.diagnosticCode,
    requested: requested || "unknown",
  };
}
