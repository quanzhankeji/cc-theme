import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadClaudeLocaleCatalog,
  resolveClaudeEditorLocale,
} from "../scripts/claude-locale-catalog.mjs";
import { createClaudeLocaleRuntime } from "../scripts/claude-locale-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [catalog, renderer] = await Promise.all([
  loadClaudeLocaleCatalog(),
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
]);

for (const locale of catalog.locales) {
  assert.deepEqual(resolveClaudeEditorLocale(catalog, locale), {
    locale,
    direction: "ltr",
    diagnosticCode: null,
    requested: locale,
  });
}
assert.equal(resolveClaudeEditorLocale(catalog, "pt_BR").locale, "pt-BR");
assert.equal(resolveClaudeEditorLocale(catalog, "es_419").locale, "es-419");
assert.equal(resolveClaudeEditorLocale(catalog, "in-ID").locale, "id-ID");
assert.equal(resolveClaudeEditorLocale(catalog, "fr").diagnosticCode, "host-locale-alias-normalized");
assert.deepEqual(resolveClaudeEditorLocale(catalog, "ar-SA"), {
  locale: "en-US",
  direction: "ltr",
  diagnosticCode: "unsupported-host-locale-fallback",
  requested: "ar-SA",
});
assert.equal(resolveClaudeEditorLocale(catalog, "x".repeat(200)).requested.length, 35);

let localeListener = null;
let unsubscribeCount = 0;
const snapshots = [];
const pendingWrite = { draft: { "text.primary": "#112233" }, revision: 9, queued: true };
const runtime = createClaudeLocaleRuntime({
  catalog,
  bridge: {
    async getInitialLocale() { return { locale: "hi-IN", messages: { ignored: true } }; },
    onLocaleChanged(listener) {
      localeListener = listener;
      return () => { unsubscribeCount += 1; };
    },
    requestLocaleChange() { throw new Error("Adapter must never call the host locale writer"); },
  },
  onChange: (snapshot) => snapshots.push(snapshot),
});
await runtime.start();
assert.equal(runtime.inspect().locale, "hi-IN");
assert.equal(runtime.inspect().source, "getInitialLocale");
localeListener("es-419", { ignored: true });
assert.equal(runtime.inspect().locale, "es-419");
assert.equal(runtime.inspect().source, "onLocaleChanged");
localeListener("ar-SA", {});
assert.equal(runtime.inspect().locale, "en-US");
assert.equal(runtime.inspect().diagnosticCode, "unsupported-host-locale-fallback");
assert.equal(runtime.inspect().diagnosticInput, "ar-SA");
assert.deepEqual(pendingWrite, { draft: { "text.primary": "#112233" }, revision: 9, queued: true });
assert(snapshots.length >= 3);
assert.equal(runtime.dispose(), true);
assert.equal(runtime.dispose(), false);
assert.equal(unsubscribeCount, 1);
const disposedSnapshot = runtime.inspect();
localeListener("de-DE", {});
assert.deepEqual(runtime.inspect(), disposedSnapshot);

let resolveInitial;
let raceListener;
const raceRuntime = createClaudeLocaleRuntime({
  catalog,
  bridge: {
    getInitialLocale: () => new Promise((resolve) => { resolveInitial = resolve; }),
    onLocaleChanged(listener) { raceListener = listener; return () => {}; },
  },
});
const raceStart = raceRuntime.start();
raceListener("id-ID", {});
resolveInitial({ locale: "fr-FR", messages: {} });
await raceStart;
assert.equal(raceRuntime.inspect().locale, "id-ID", "stale initial locale overwrote a newer event");
raceRuntime.dispose();

const unavailableRuntime = createClaudeLocaleRuntime({ catalog, bridge: null });
await unavailableRuntime.start();
assert.equal(unavailableRuntime.inspect().locale, "en-US");
assert.equal(unavailableRuntime.inspect().diagnosticCode, "host-locale-bridge-unavailable");

for (const required of [
  'createClaudeLocaleRuntime({',
  'bridge: globalThis["claude.hybrid"]?.DesktopIntl',
  'void localeRuntime.start()',
  'applyEditorLocaleToUi();',
  'runtime.localeDiagnosticCode = LOCALE_DIAGNOSTIC_CODE',
  'state?.localeRuntime?.dispose?.()',
  'styleEditorStatusState.messageKey',
  'data-theme-group-count',
]) assert(renderer.includes(required), `Runtime locale contract is missing: ${required}`);

for (const forbidden of [
  "navigator.language",
  "navigator?.language",
  'attributeName === "lang"',
  "result?.message ||",
]) assert.equal(renderer.includes(forbidden), false, `Forbidden locale behavior remains: ${forbidden}`);

const localeCallback = renderer.match(/onChange: \(snapshot\) => \{([\s\S]*?)\n    \},\n  \}\);/)?.[1] || "";
const localeUiRefresh = renderer.match(/\n  applyEditorLocaleToUi = \(\) => \{\n    const ownedRoots([\s\S]*?)\n  \};\n\n  const syncVideoPlayback/)?.[1] || "";
assert(localeCallback.length > 100, "Could not isolate the locale event callback");
assert(localeUiRefresh.length > 100, "Could not isolate the in-place locale UI refresh");
for (const forbidden of [
  "editorDraft =", "editorRevision =", "queuedStylePersistence =",
  "flushStyleEditorPersistence", "disposeThemeEditorUi", ".remove()", "replaceChildren",
]) {
  assert.equal(localeCallback.includes(forbidden), false, `Locale event mutates pending editor state: ${forbidden}`);
  assert.equal(localeUiRefresh.includes(forbidden), false, `Locale UI refresh rebuilds or mutates pending state: ${forbidden}`);
}

console.log("claude-locale-runtime.test.mjs: ok");
