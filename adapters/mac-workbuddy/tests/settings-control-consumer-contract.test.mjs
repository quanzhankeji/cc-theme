import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [catalog, capability, locales, css, renderer, uiCatalog] = await Promise.all([
  fs.readFile(path.join(root, "contracts", "theme-style-catalog.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "contracts", "adapter-capability.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "contracts", "theme-settings-locales.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "assets", "skin.css"), "utf8"),
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "compatibility", "workbuddy-macos", "5.2.6", "ui-surface-catalog.json"), "utf8").then(JSON.parse),
]);

const expectedEditable = [
  "palette.strategy", "background.presentation",
  "foundation.surfaceBase", "foundation.surfaceRaised", "foundation.surfaceElevated",
  "text.primary", "text.secondary", "interaction.accent", "border.default",
  "typography.ui", "typography.display", "typography.code",
  "media.interactiveScrim", "media.backgroundScrimOpacity", "media.backgroundPosition",
  "media.blur", "media.saturation",
];
assert.deepEqual(capability.localRuntimeOverrides.editableTokens, expectedEditable);
const controlIds = new Set(catalog.settingsControls.map(({ id }) => id));
for (const id of expectedEditable) assert(controlIds.has(id), `capability exposes a missing Settings control: ${id}`);
for (const removed of ["media.radiusScale", "media.artX", "media.artY", "media.videoX", "media.videoY"]) {
  assert.equal(controlIds.has(removed), false, `obsolete Settings control remains: ${removed}`);
  assert.equal(capability.localRuntimeOverrides.editableTokens.includes(removed), false, `obsolete override remains writable: ${removed}`);
  assert.doesNotMatch(renderer, new RegExp(`data-cc-theme-control=["']${removed.replaceAll(".", "\\.")}`));
}
for (const removedLocale of ["controlRadiusScale", "controlBackgroundX", "controlBackgroundY", "controlVideoX", "controlVideoY"]) {
  assert.equal(Object.hasOwn(locales.messages, removedLocale), false, `obsolete locale key remains: ${removedLocale}`);
}

const roleIds = new Set(uiCatalog.runtimeRoles.map(({ role }) => role));
const bindingById = new Map(catalog.bindings.map((binding) => [binding.id, binding]));
for (const control of catalog.settingsControls.filter((item) => item.binding || item.bindings)) {
  const bindingIds = control.bindings ?? [control.binding];
  for (const id of bindingIds) {
    const binding = bindingById.get(id);
    assert(binding, `${control.id} points to missing binding ${id}`);
    assert(binding.roles.every((role) => roleIds.has(role)), `${control.id} has an unverified Surface role`);
    assert(css.includes(binding.cssVariable), `${control.id} has no renderer/CSS consumer for ${binding.cssVariable}`);
  }
}

const position = catalog.settingsControls.find(({ id }) => id === "media.backgroundPosition");
assert.deepEqual(position.bindings, ["media.backgroundX", "media.backgroundY"]);
assert.equal(position.type, "position");
assert.equal(position.themePath, "appearance.backgroundPosition");
assert.match(renderer, /axisInput\.type = "range"/,
  "the unified background position must retain native draggable range controls");
assert.doesNotMatch(renderer, /axisInput\.type = "number"/);
assert.equal(capability.sharedCore.fields.find(({ source }) => source === "background.position").target,
  "appearance.backgroundPosition");
assert.equal(capability.targetProfile.fields.some(({ id }) => id === "backgroundVideoPosition"), false,
  "a second video-only position write path remains public");
assert.equal(locales.messages[position.labelKey][0], "背景位置");
assert.equal(locales.messages[position.labelKey][1], "Background position");
assert.match(css, /#workbuddy-skin-background-art[\s\S]*?object-position: var\(--wbs-background-x\) var\(--wbs-background-y\)/);
assert.match(css, /#workbuddy-skin-background-video[\s\S]*?object-position: var\(--wbs-background-x\) var\(--wbs-background-y\)/);
assert.doesNotMatch(css, /--wbs-(?:art|video)-[xy]/);
assert.match(renderer, /interactiveController\?\.setPosition\?\.\(backgroundPositionForSettings/,
  "the canonical override must also update interactive/static fallback rendering");

console.log("PASS: every published WorkBuddy Settings field has a validated override, normalizer, paint consumer, and trusted Surface; obsolete radius and split-position controls are absent.");
