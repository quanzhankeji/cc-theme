import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [renderer, injector] = await Promise.all([
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "scripts", "injector.mjs"), "utf8"),
]);
for (const needle of [
  "interactiveController?.dispose?.()",
  'document.getElementById(VIDEO_LAYER_ID)?.remove()',
  'document.getElementById(INTERACTIVE_LAYER_ID)?.remove()',
  "URL.revokeObjectURL",
  "uiInterpreter.cleanup()",
  "restoreThemeSettingsPage()",
  'document.removeEventListener("pointerdown"',
  'document.removeEventListener("keydown"',
  "observer?.disconnect()",
  "delete window[STATE_KEY]",
]) assert(renderer.includes(needle), `Renderer cleanup is missing: ${needle}`);
assert(injector.includes('Runtime.removeBinding", { name: STYLE_EDITOR_BINDING }'));
for (const retired of [
  "THEME_SWITCH_BINDING",
  "__THEME_SWITCH_BINDING_JSON__",
  "__THEME_LIBRARY_JSON__",
]) {
  assert.equal(injector.includes(retired), false, `Injector retains retired theme-library runtime state: ${retired}`);
  assert.equal(renderer.includes(retired), false, `Renderer retains retired theme-library runtime state: ${retired}`);
}
assert(injector.includes('nativeHidden: document.querySelectorAll'));
assert(injector.includes('skinInlineVariables: [...root.style]'));
console.log("cleanup-contract.test.mjs: ok");
