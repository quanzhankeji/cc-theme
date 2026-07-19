import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [factorySource, renderer, catalog, locales, css] = await Promise.all([
  fs.readFile(path.join(root, "assets", "theme-settings-color.js"), "utf8"),
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "contracts", "theme-style-catalog.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "contracts", "theme-settings-locales.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "assets", "skin.css"), "utf8"),
]);

const createColorValue = vm.runInNewContext(factorySource);
const colors = createColorValue();
const plain = (value) => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(colors.normalize("#A1B2C3")), { value: "#a1b2c3", picker: "#a1b2c3" });
assert.deepEqual(plain(colors.normalize("rgb(12, 34, 56)")), { value: "rgb(12, 34, 56)", picker: "#0c2238" });
assert.deepEqual(plain(colors.normalize("rgba(12,34,56,.5)")), { value: "rgba(12, 34, 56, 0.5)", picker: "#0c2238" });
assert.deepEqual(plain(colors.normalize("hsl(120, 100%, 25%)")), { value: "hsl(120, 100%, 25%)", picker: "#008000" });
assert.deepEqual(plain(colors.normalize("transparent")), { value: "transparent", picker: "#000000" });
for (const invalid of ["", "#123", "#12345g", "rgb(12, 34)", "rgb(999, 0, 0)", "rgba(1, 2, 3, 2)", "url(x)"]) {
  assert.equal(colors.normalize(invalid), null, `invalid color was accepted: ${invalid}`);
}

const textColorControls = catalog.settingsControls.filter((control) => control.id.startsWith("text.") && control.type === "color");
assert.deepEqual(textColorControls.map(({ id }) => id).sort(), ["text.primary", "text.secondary"]);
for (const control of textColorControls) {
  const binding = catalog.bindings.find(({ id }) => id === control.binding);
  assert(binding, `${control.id} has no Style binding`);
  assert(css.includes(binding.cssVariable), `${control.id} has no CSS consumer`);
}

assert.equal(renderer.split("__WORKBUDDY_SKIN_THEME_SETTINGS_COLOR_FACTORY__").length - 1, 1);
assert.match(renderer, /picker\.type = "color"/);
assert.match(renderer, /textInput\.type = "text"/);
assert.match(renderer, /dataset\.ccThemeColorPicker/);
assert.match(renderer, /dataset\.ccThemeColorValue/);
assert.match(renderer, /textInput\.addEventListener\("input"/);
assert.match(renderer, /picker\.addEventListener\("input"/);
assert.match(renderer, /event\.key === "Enter"/);
assert.match(renderer, /event\.key === "Escape"/);
assert.match(renderer, /setAttribute\("aria-invalid"/);
assert.match(renderer, /setAttribute\("aria-describedby"/);
assert.match(renderer, /settingsMessage\("colorValueInvalid"/);
assert.match(css, /\.cc-theme-settings-field-error/);
assert.match(css, /\[aria-invalid="true"\]/);
for (const key of ["colorPickerAria", "colorValueAria", "colorValuePlaceholder", "colorValueInvalid"]) {
  assert.equal(locales.messages[key]?.length, locales.locales.length, `${key} is not translated for every WorkBuddy locale`);
}

console.log("PASS: every editable WorkBuddy text color has synchronized picker/text controls, bounded normalization, field errors, keyboard recovery, and real paint consumers.");
