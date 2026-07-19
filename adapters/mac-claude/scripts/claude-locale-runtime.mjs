export function createClaudeLocaleRuntime({ catalog, bridge, onChange } = {}) {
  const locales = Array.isArray(catalog?.locales) && catalog.locales.length
    ? [...catalog.locales] : ["en-US"];
  const defaultLocale = locales.includes(catalog?.defaultLocale) ? catalog.defaultLocale : locales[0];
  const directions = catalog?.directions && typeof catalog.directions === "object"
    ? catalog.directions : { [defaultLocale]: "ltr" };
  const maximumDiagnosticLocaleLength = Number.isInteger(catalog?.fallback?.maximumDiagnosticLocaleLength)
    ? catalog.fallback.maximumDiagnosticLocaleLength : 35;
  const fallbackDiagnosticCode = typeof catalog?.fallback?.diagnosticCode === "string"
    ? catalog.fallback.diagnosticCode : "unsupported-host-locale-fallback";
  const aliases = Object.entries(catalog?.aliases || {}).map(([alias, locale]) => [
    alias.replace(/_/g, "-").toLowerCase(), locale,
  ]);
  const boundedLocale = (value) => String(value || "").trim().slice(0, maximumDiagnosticLocaleLength);
  const resolve = (hostLocale) => {
    const requested = boundedLocale(hostLocale);
    const normalized = requested.replace(/_/g, "-").toLowerCase();
    const exact = locales.find((locale) => locale.toLowerCase() === normalized);
    if (exact) return { locale: exact, requested, diagnosticCode: null };
    const alias = aliases.find(([candidate]) => candidate === normalized)?.[1];
    if (alias && locales.includes(alias)) {
      return { locale: alias, requested, diagnosticCode: "host-locale-alias-normalized" };
    }
    return {
      locale: defaultLocale,
      requested: requested || "unknown",
      diagnosticCode: fallbackDiagnosticCode,
    };
  };

  let snapshot = {
    hostEffectiveLocale: null,
    locale: defaultLocale,
    direction: directions[defaultLocale] || "ltr",
    diagnosticCode: "host-locale-pending",
    diagnosticInput: "",
    source: "initializing",
  };
  let unsubscribe = null;
  let eventSeen = false;
  let disposed = false;
  let startPromise = null;

  const publish = (next) => {
    if (disposed) return false;
    const changed = Object.keys(next).some((key) => next[key] !== snapshot[key]);
    snapshot = Object.freeze({ ...snapshot, ...next });
    if (changed && typeof onChange === "function") onChange(snapshot);
    return changed;
  };
  const accept = (hostLocale, source) => {
    const resolution = resolve(hostLocale);
    publish({
      hostEffectiveLocale: boundedLocale(hostLocale) || null,
      locale: resolution.locale,
      direction: directions[resolution.locale] || "ltr",
      diagnosticCode: resolution.diagnosticCode,
      diagnosticInput: resolution.requested,
      source,
    });
    return snapshot;
  };
  const unavailable = () => publish({
    hostEffectiveLocale: null,
    locale: defaultLocale,
    direction: directions[defaultLocale] || "ltr",
    diagnosticCode: "host-locale-bridge-unavailable",
    diagnosticInput: "unavailable",
    source: "fallback",
  });

  const start = () => {
    if (startPromise) return startPromise;
    if (!bridge || typeof bridge.getInitialLocale !== "function" ||
        typeof bridge.onLocaleChanged !== "function") {
      unavailable();
      startPromise = Promise.resolve(snapshot);
      return startPromise;
    }
    try {
      unsubscribe = bridge.onLocaleChanged((locale) => {
        if (disposed) return;
        eventSeen = true;
        accept(locale, "onLocaleChanged");
      });
      startPromise = Promise.resolve(bridge.getInitialLocale()).then((result) => {
        if (!disposed && !eventSeen) accept(result?.locale, "getInitialLocale");
        return snapshot;
      }).catch(() => {
        if (!disposed && !eventSeen) unavailable();
        return snapshot;
      });
    } catch {
      unavailable();
      startPromise = Promise.resolve(snapshot);
    }
    return startPromise;
  };
  const dispose = () => {
    if (disposed) return false;
    disposed = true;
    if (typeof unsubscribe === "function") {
      try { unsubscribe(); } catch {}
    }
    unsubscribe = null;
    return true;
  };

  return {
    start,
    accept,
    dispose,
    inspect: () => ({ ...snapshot }),
  };
}
