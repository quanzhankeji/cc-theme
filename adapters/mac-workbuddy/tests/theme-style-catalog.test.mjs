import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUiSurfaceCatalog } from "../scripts/ui-surface-catalog.mjs";
import { loadThemeStyleCatalog, validateThemeStyleCatalog } from "../scripts/theme-style-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiCatalog = await loadUiSurfaceCatalog();
const [styleCatalog, css, renderer, capability] = await Promise.all([
  loadThemeStyleCatalog(uiCatalog.runtimeRoles),
  fs.readFile(path.join(root, "assets", "skin.css"), "utf8"),
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "contracts", "adapter-capability.json"), "utf8").then(JSON.parse),
]);

assert.equal(styleCatalog.kind, "theme.style-catalog");
assert.equal(styleCatalog.adapterId, "mac-workbuddy");
assert.equal(styleCatalog.adapterVersion, uiCatalog.target.version);
assert.equal(styleCatalog.adapterReleaseRevision, 2);
assert.equal(styleCatalog.geometryPolicy, "native");
const configuredVariables = new Set(styleCatalog.bindings.map((binding) => binding.cssVariable));
const usedVariables = new Set([...css.matchAll(/--wbs-[a-z0-9-]+/g)].map((match) => match[0]));
for (const variable of usedVariables) {
  assert(configuredVariables.has(variable), `CSS variable is not interpreted by the Style Catalog: ${variable}`);
}

const exactTargetSources = new Map(Object.entries({
  "semanticColors.surfaceBase": "palette.surface",
  "semanticColors.surfaceRaised": "palette.surfaceRaised",
  "semanticColors.surfaceElevated": "palette.surfaceElevated",
  "colors.text": "palette.text",
  "semanticColors.textStrong": "palette.textStrong",
  "colors.muted": "palette.textMuted",
  "semanticColors.placeholder": "palette.placeholder",
  "semanticColors.borderSubtle": "palette.borderSubtle",
  "semanticColors.borderDefault": "palette.border",
  "semanticColors.action": "palette.action",
  "semanticColors.actionHover": "palette.actionHover",
  "semanticColors.actionPressed": "palette.actionPressed",
  "semanticColors.actionForeground": "palette.actionForeground",
  "semanticColors.hoverSurface": "palette.hover",
  "semanticColors.pressedSurface": "palette.pressed",
  "semanticColors.selectedSurface": "palette.selected",
  "semanticColors.focusRing": "palette.focus",
  "semanticColors.link": "palette.link",
  "semanticColors.danger": "palette.danger",
  "semanticColors.sidebarSurface": "palette.sidebar",
  "semanticColors.headerSurface": "palette.header",
  "semanticColors.mainScrimStart": "palette.mainScrimStart",
  "semanticColors.mainScrimMid": "palette.mainScrimMid",
  "semanticColors.mainScrimEnd": "palette.mainScrimEnd",
  "semanticColors.composerSurface": "palette.composer",
  "fonts.ui": "layout.fontUi",
  "fonts.display": "layout.fontDisplay",
  "fonts.code": "layout.fontCode",
  "appearance.backdropBlurPx": "layout.blur",
  "appearance.backdropSaturation": "layout.saturation",
  "appearance.radiusScale": "layout.radiusScale",
}));
for (const field of capability.sharedCore.fields.filter((item) => item.decision === "exact")) {
  const source = exactTargetSources.get(field.target);
  if (!source) continue;
  const bindings = styleCatalog.bindings.filter((binding) => binding.source === source);
  assert(bindings.length > 0, `exact Shared Core paint token has no Style binding: ${field.source}`);
  for (const binding of bindings) {
    assert(usedVariables.has(binding.cssVariable),
      `exact Shared Core paint token has no CSS consumer: ${field.source} -> ${binding.cssVariable}`);
  }
}
assert.match(renderer, /uiInterpreter\.applyStyleSources\(styleSourcesForSettings\(currentThemeSettings/);
assert.doesNotMatch(renderer, /root\.style\.(?:setProperty|removeProperty)/);

const unknownRole = structuredClone(styleCatalog);
unknownRole.bindings[0].roles = ["not-a-runtime-role"];
assert.throws(() => validateThemeStyleCatalog(unknownRole, uiCatalog.runtimeRoles), /unknown runtime role/);

const executableValue = structuredClone(styleCatalog);
const fixed = executableValue.bindings.find((binding) => Object.hasOwn(binding, "value"));
fixed.value = "url(https://example.com/a.png)";
assert.throws(() => validateThemeStyleCatalog(executableValue, uiCatalog.runtimeRoles), /unsafe fixed value/);

console.log("theme-style-catalog.test.mjs: verified paint bindings, role linkage, and native geometry policy");
