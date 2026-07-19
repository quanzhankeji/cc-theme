import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [renderer, css, catalog] = await Promise.all([
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "assets", "skin.css"), "utf8"),
  fs.readFile(path.join(root, "compatibility", "workbuddy-macos", "5.2.6", "ui-surface-catalog.json"), "utf8").then(JSON.parse),
]);

const presentation = catalog.runtimeInterpreter.mounts.themeSettings.presentation;
assert.match(presentation.navigationItemClass, /(?:^|\s)settings-navigation__item(?:\s|$)/,
  "CC-Theme navigation must inherit the native WorkBuddy item class");
assert.equal(presentation.navigationIconClass, "settings-navigation__icon");
assert.equal(presentation.navigationLabelClass, "settings-navigation__label");
assert.equal(presentation.navigationActiveClass, "settings-navigation__item--active");
assert.match(renderer, /themeNav\.dataset\.workbuddySkinOwned = "true"/,
  "the inserted entry needs explicit skin ownership for cleanup");
assert.match(renderer, /themeNav\.className = presentation\.navigationItemClass/);
assert.match(renderer, /icon\.className = presentation\.navigationIconClass/);
assert.match(renderer, /label\.className = presentation\.navigationLabelClass/);

const ownedNavBlocks = [...css.matchAll(/([^{}]*#workbuddy-cc-theme-settings-nav[^{}]*)\{([^{}]*)\}/g)]
  .map((match) => ({ selector: match[1], declarations: match[2] }));
assert(ownedNavBlocks.length > 0, "the owned Settings entry has no bounded styling hook");
for (const { selector, declarations } of ownedNavBlocks) {
  if (/\bsvg\b/.test(selector)) continue;
  for (const nativeOwnedProperty of [
    "color", "background", "border", "opacity", "font", "height", "min-height", "max-height",
    "padding", "margin", "line-height", "transform", "filter", "box-shadow", "text-shadow", "transition", "animation",
  ]) {
    assert.doesNotMatch(declarations, new RegExp(`(?:^|;)\\s*${nativeOwnedProperty}(?:-[a-z-]+)?\\s*:`, "i"),
      `CC-Theme navigation overrides native ${nativeOwnedProperty} instead of inheriting light/dark, state, zoom, and motion behavior`);
  }
}

const cleanupStart = renderer.indexOf("const cleanup = () =>");
assert(cleanupStart >= 0);
const cleanup = renderer.slice(cleanupStart);
assert.match(cleanup, /disposeThemeSettings\(\)/);
assert.match(cleanup, /\[data-workbuddy-skin-owned="true"\]/);
assert.match(cleanup, /uiInterpreter\.restoreStyles\(\)/);

console.log("PASS: the owned CC-Theme navigation entry inherits native WorkBuddy visual, interaction, zoom, and Reduce Motion states and is fully cleaned up.");
