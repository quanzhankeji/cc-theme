import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [renderer, interpreter, session, locales, styleCatalog] = await Promise.all([
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "assets", "ui-interpreter.js"), "utf8"),
  fs.readFile(path.join(root, "assets", "theme-settings-session.js"), "utf8"),
  fs.readFile(path.join(root, "contracts", "theme-settings-locales.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "contracts", "theme-style-catalog.json"), "utf8").then(JSON.parse),
]);

const marker = "__WORKBUDDY_SKIN_THEME_SETTINGS_SESSION_FACTORY__";
assert.equal(renderer.split(marker).length - 1, 1, "the fixed live-session factory marker must be injected exactly once");
assert.match(renderer, /uiInterpreter\.applyStyleSources\(/,
  "accepted live edits must project through the fixed UI Interpreter");
assert.doesNotMatch(renderer, /(?:document\.documentElement|root)\.style\.(?:setProperty|removeProperty)/,
  "Settings must not bypass the UI Interpreter with direct root style writes");
assert.doesNotMatch(session, /(?:["'](?:selector|css|js|cssText|innerHTML|scriptSource)["']|\.(?:selector|cssText|innerHTML|scriptSource)\b)/i,
  "the live-session state must not accept arbitrary selector, CSS, HTML, or script fields");

const localeKeys = Object.keys(locales.messages);
for (const forbiddenKey of ["save", "saveChanges", "saving", "saved", "saveFailed"]) {
  assert.equal(localeKeys.includes(forbiddenKey), false, `obsolete Save translation key remains: ${forbiddenKey}`);
}
for (const requiredKey of ["updateApplying", "updateApplied", "updateRolledBack"]) {
  assert.equal(locales.messages[requiredKey]?.length, locales.locales.length,
    `missing host-language autosave status: ${requiredKey}`);
  assert.match(renderer, new RegExp(`themeSettingsStatus\\(["']${requiredKey}["']`),
    `renderer never publishes the localized ${requiredKey} status`);
}
for (const [key, translations] of Object.entries(locales.messages)) {
  assert.equal(translations.length, locales.locales.length, `${key} is inconsistent across WorkBuddy locales`);
  assert(translations.every((translation) => typeof translation === "string" && translation.trim()),
    `${key} contains an empty translation`);
}

const panelStart = renderer.indexOf("const createThemeSettingsPanel = () =>");
const panelEnd = renderer.indexOf("const themeSettingsMount = () =>", panelStart);
assert(panelStart >= 0 && panelEnd > panelStart, "could not isolate the Settings panel builder");
const panelBuilder = renderer.slice(panelStart, panelEnd);
for (const obsoleteSavePath of [
  /saveButton/i,
  /data-cc-theme-save/i,
  /settingsMessage\(["']save(?:Changes)?["']\)/i,
  /requestTheme(?:Library)?Action\(["']save["']\)/i,
]) assert.doesNotMatch(panelBuilder, obsoleteSavePath, "an obsolete Save interaction remains in Settings");

assert(Array.isArray(styleCatalog.settingsControls) && styleCatalog.settingsControls.length > 0,
  "Theme Style Catalog must publish the allowlisted WYSIWYG control projection");
const controlGroups = new Set(styleCatalog.settingsControls.map((control) => control.group));
for (const group of ["theme", "color", "typography", "opacity", "palette", "background"]) {
  assert(controlGroups.has(group), `Settings omits an allowed control group: ${group}`);
}
const bindingIds = new Set(styleCatalog.bindings.map((binding) => binding.id));
const allowedControlTypes = new Set(["theme", "select", "backgroundState", "color", "fontList", "number", "position", "toggle"]);
for (const control of styleCatalog.settingsControls) {
  assert.match(control.id, /^[A-Za-z][A-Za-z0-9._-]{0,79}$/);
  assert.match(control.source, /^(?:theme|style|runtime)(?:\.[A-Za-z][A-Za-z0-9]*)+$/,
    `${control.id} has no bounded theme source path`);
  assert(allowedControlTypes.has(control.type), `${control.id} uses an unrecognized control type`);
  assert.equal(locales.messages[control.labelKey]?.length, locales.locales.length,
    `${control.id} has no complete host-language label`);
  if (control.binding) assert(bindingIds.has(control.binding), `${control.id} references an unknown Style Catalog binding`);
  if (control.type === "number") {
    assert(Number.isFinite(control.minimum) && Number.isFinite(control.maximum) && control.minimum < control.maximum,
      `${control.id} has no bounded numeric range`);
    assert(Number.isFinite(control.step) && control.step > 0, `${control.id} has no positive numeric step`);
  }
  if (control.type === "select" || control.type === "backgroundState") {
    assert(Array.isArray(control.options) && control.options.length > 0 && control.options.length <= 32,
      `${control.id} has no bounded option allowlist`);
  }
  assert(!Object.hasOwn(control, "selector"), `${control.id} leaks a selector into the catalog projection`);
  assert(!Object.hasOwn(control, "css"), `${control.id} opens an arbitrary CSS channel`);
  assert(!Object.hasOwn(control, "js"), `${control.id} opens an arbitrary script channel`);
}

assert.match(interpreter, /applyStyleSources/);
assert.match(interpreter, /restoreStyles/);
assert.doesNotMatch(panelBuilder, /\.style\.(?:setProperty|removeProperty)\(/,
  "the Settings panel directly writes style values");

console.log("PASS: WorkBuddy CC Theme is catalog-driven, fully localized, immediate, and has no Save-button path.");
