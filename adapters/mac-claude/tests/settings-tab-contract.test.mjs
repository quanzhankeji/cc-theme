import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [renderer, css, interpreter] = await Promise.all([
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "assets", "skin.css"), "utf8"),
  fs.readFile(path.join(root, "assets", "ui-interpreter.js"), "utf8"),
]);
for (const needle of [
  "const listItem = generalListItem.cloneNode(true)",
  "generalListItem.parentElement.insertBefore(listItem, generalListItem.nextSibling)",
  'iconHost.replaceChildren(document.createTextNode("C"))',
  'listItem.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"))',
  'close.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"))',
  '["aria-controls", "aria-describedby", "aria-labelledby", "form"]',
  'page.id = THEME_SETTINGS_PAGE_ID',
  "dialog.appendChild(page)",
  'nativeContent.setAttribute("data-theme-page-native-hidden", "true")',
  "restoreNativeSettingsContent()",
  "const nativeSelectedButtons = [...nav.querySelectorAll",
  'button.getAttribute("data-state") === "active"',
  "for (const button of nativeSelectedButtons)",
  'button.removeAttribute("aria-current")',
  'button.removeAttribute("data-state")',
  "button.className = navItem.dataset.themeInactiveClass",
  "previousNativeSettingsNavState",
  'const editor = ensureStyleEditor(frame, "settings")',
  "editor.hidden = false",
]) assert(renderer.includes(needle), `Dedicated Settings tab contract is missing: ${needle}`);
assert(renderer.includes("const activeButton = nav.querySelector"));
assert(renderer.includes("uiAdapterConfig.settingsMount?.activeButtonClasses"));
assert(renderer.includes("uiAdapterConfig.settingsMount?.inactiveButtonClasses"));
assert(interpreter.includes('desktopListSelector'));
assert(interpreter.includes('nativeItemCount'));
assert(interpreter.includes('activeListButtonCount === expected'),
  "an active General item must not make the non-Desktop Settings list look like the Desktop app list");
assert.equal(renderer.includes('iconHost.classList.add'), false, "C must retain the exact native icon-container classes");
const iconRule = css.match(/#cc-theme-settings-nav-item > span:first-child \{([\s\S]*?)\n\}/)?.[1] || "";
for (const inherited of ["font-family: inherit", "font-size: inherit", "font-weight: inherit", "color: currentColor"]) {
  assert(iconRule.includes(inherited), `C icon does not inherit adjacent native state: ${inherited}`);
}
for (const forbidden of ["width:", "height:", "padding:", "margin:", "border:", "background:", "transition:", "transform:"]) {
  assert.equal(iconRule.split("\n").some((line) => line.trim().startsWith(forbidden)), false,
    `C icon overrides native geometry/state: ${forbidden}`);
}
assert.equal(css.includes('#cc-theme-settings-nav-item[aria-current="page"]'), false);
assert.equal(css.includes("#cc-theme-settings-nav-item:hover"), false);
console.log("settings-tab-contract.test.mjs: ok");
