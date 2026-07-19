import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [renderer, interpreter, injector, css, catalog, locales] = await Promise.all([
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "assets", "ui-interpreter.js"), "utf8"),
  fs.readFile(path.join(root, "scripts", "injector.mjs"), "utf8"),
  fs.readFile(path.join(root, "assets", "skin.css"), "utf8"),
  fs.readFile(path.join(root, "compatibility", "workbuddy-macos", "5.2.6", "ui-surface-catalog.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "contracts", "theme-settings-locales.json"), "utf8").then(JSON.parse),
]);

for (const marker of [
  "__WORKBUDDY_SKIN_UI_INTERPRETER_FACTORY__",
  "__WORKBUDDY_SKIN_STYLE_CATALOG_JSON__",
  "__WORKBUDDY_SKIN_SETTINGS_LOCALES_JSON__",
  "__WORKBUDDY_SKIN_THEME_SETTINGS_LOCALE_FACTORY__",
  "__WORKBUDDY_SKIN_THEME_SETTINGS_DIAGNOSTICS_JSON__",
]) assert.equal(renderer.split(marker).length - 1, 1, `renderer marker must be unique: ${marker}`);

assert.match(renderer, /const THEME_SETTINGS_NAV_ID = "workbuddy-cc-theme-settings-nav"/);
assert.match(renderer, /uiInterpreter\.resolveMount\("themeSettings"\)/);
assert.match(renderer, /uiInterpreter\.insert\("themeSettings", "navigationItem", themeNav\)/);
assert.match(renderer, /uiInterpreter\.insert\("themeSettings", "ownedPanel", themePanel\)/);
assert.match(interpreter, /const resolveMount = \(name\) =>/);
assert.match(renderer, /label\.textContent = settingsMessage\("navigationTitle"\)/);
assert.match(renderer, /navigationLabel && navigationLabel\.textContent !== localizedNavigationTitle/,
  "Settings reconciliation must not rewrite an unchanged label and trigger its own MutationObserver forever");
assert.match(renderer, /themeNav\.getAttribute\("aria-label"\) !== localizedNavigationTitle/,
  "Settings reconciliation must be mutation-stable for accessibility attributes");
assert.match(renderer, /nativePanel\.hidden = true/);
assert.match(renderer, /nativePanel\.hidden = false/);
assert.match(renderer, /disposeThemeSettings\(\)/);
assert.doesNotMatch(renderer, /THEME_LIBRARY|themeLibrary|data-cc-theme-library/);
assert.doesNotMatch(injector, /theme-library|themeLibrary|selectCcThemePackages|importCcThemePackages/);
assert.equal(locales.messages.settingsReady.length, locales.locales.length);
assert.equal(locales.messages.overridesRebased.length, locales.locales.length);
assert.equal(locales.messages.overridesQuarantined.length, locales.locales.length);
assert.match(renderer, /\{ key: "settingsReady", replacements: \{\}, state: "idle" \}/);
assert.doesNotMatch(renderer, /[\u3400-\u9fff]/u);
assert.doesNotMatch(renderer, /requestThemeLibraryAction|renderThemeLibrary/);

assert.match(injector, /Runtime\.addBinding/);
assert.match(injector, /installThemeSettingsBinding\(session, \(\) => current\);/);
assert.doesNotMatch(injector, /installThemeSettingsBinding\(session, \(\) => current, queuePayloadRefresh\)/,
  "autosave must not rotate the live renderer nonce between consecutive controls");
assert.match(injector, /Page\.loadEventFired[\s\S]*?refreshChain = refreshChain\.then\(async \(\) => \{[\s\S]*?await refresh\(\)/,
  "renderer reload must rebuild the payload from the latest persisted settings before reinjection");
assert.match(injector, /message\?\.nonce !== current\.themeSettingsNonce/);

assert.match(css, /#workbuddy-cc-theme-settings-panel/);
assert.match(css, /#workbuddy-cc-theme-settings-nav/);
assert.doesNotMatch(css, /\.settings-modal__panel\s*\{[\s\S]*?width:/);
assert(catalog.domHierarchy.some((node) => node.id === "cc-theme-settings-panel" && node.ownership === "skin-owned"));
assert(catalog.runtimeRoles.some((role) => role.role === "settings-navigation"));
assert(catalog.pageFamilies.find((page) => page.id === "settings").states.includes("cc-theme-editor"));
assert.equal(catalog.runtimeInterpreter.mounts.themeSettings.insertions.navigationItem.mode, "before-last");
assert.equal(catalog.runtimeInterpreter.mounts.themeSettings.presentation.navigationActiveClass,
  "settings-navigation__item--active");

console.log("theme-settings-runtime.test.mjs: verified native Settings placement, trusted bindings, cleanup, and catalog coverage");
