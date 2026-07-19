({ catalog, readHostLocale }) => {
  const supported = Array.isArray(catalog?.locales) ? [...catalog.locales] : [];
  const fallbackLocale = supported.includes(catalog?.fallback?.unknownLocale)
    ? catalog.fallback.unknownLocale
    : supported.includes(catalog?.defaultLocale) ? catalog.defaultLocale : supported[0];

  const normalize = (record) => {
    const raw = typeof record?.value === "string" ? record.value.replaceAll("_", "-").slice(0, 35) : "";
    const normalized = raw.toLowerCase();
    for (const locale of supported) {
      const metadata = catalog.localeMetadata?.[locale];
      if (metadata?.aliases?.some((alias) => alias.replaceAll("_", "-").toLowerCase() === normalized)) {
        return { locale, source: record?.source ?? "host-default", diagnostic: null };
      }
    }
    const language = normalized.split("-")[0];
    const ranged = supported.find((locale) => catalog.localeMetadata?.[locale]?.languageRange === language);
    if (ranged) return { locale: ranged, source: record?.source ?? "host-default", diagnostic: null };
    return {
      locale: fallbackLocale,
      source: record?.source ?? "host-default",
      diagnostic: catalog?.fallback?.diagnosticCode || "host-locale-fallback",
    };
  };

  let snapshot = normalize(readHostLocale());
  const refresh = () => {
    const next = normalize(readHostLocale());
    const changed = next.locale !== snapshot.locale ||
      next.source !== snapshot.source || next.diagnostic !== snapshot.diagnostic;
    snapshot = next;
    return changed;
  };
  const metadata = () => catalog.localeMetadata?.[snapshot.locale] ?? {};
  const format = (value) => typeof value === "number"
    ? new Intl.NumberFormat(metadata().numberFormat || snapshot.locale).format(value)
    : String(value);
  const message = (key, replacements = {}) => {
    const translations = catalog.messages?.[key];
    const localeIndex = supported.indexOf(snapshot.locale);
    const fallbackIndex = supported.indexOf(fallbackLocale);
    let output = Array.isArray(translations)
      ? translations[localeIndex] || translations[fallbackIndex] || ""
      : "";
    for (const [name, value] of Object.entries(replacements)) {
      output = output.replaceAll(`{${name}}`, format(value));
    }
    return output;
  };
  const inspect = () => ({ ...snapshot });

  return {
    refresh,
    locale: () => snapshot.locale,
    metadata,
    message,
    inspect,
  };
}
