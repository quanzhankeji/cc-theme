import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadUiSurfaceCatalog, validateUiSurfaceCatalog } from "../scripts/ui-surface-catalog.mjs";
import { readSyntheticTheme } from "./helpers/synthetic-theme.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TEST_DIR, "..");
const [catalog, renderer, interpreter, css, styleCatalog, locales, theme] = await Promise.all([
  loadUiSurfaceCatalog(),
  fs.readFile(path.join(ROOT, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(ROOT, "assets", "ui-interpreter.js"), "utf8"),
  fs.readFile(path.join(ROOT, "assets", "skin.css"), "utf8"),
  fs.readFile(path.join(ROOT, "contracts", "theme-style-catalog.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(ROOT, "contracts", "theme-settings-locales.json"), "utf8").then(JSON.parse),
  readSyntheticTheme(),
]);

assert.deepEqual(validateUiSurfaceCatalog(catalog), []);
assert.match(renderer, /const CATALOG = __WORKBUDDY_SKIN_CATALOG_JSON__;/);
assert.match(renderer, /const VIDEO_URL = __WORKBUDDY_SKIN_VIDEO_JSON__;/);
assert.match(renderer, /const createUiInterpreter = __WORKBUDDY_SKIN_UI_INTERPRETER_FACTORY__;/);
assert.match(renderer, /const createThemeSettingsLocale = __WORKBUDDY_SKIN_THEME_SETTINGS_LOCALE_FACTORY__;/);
assert.match(renderer, /uiInterpreter\.reconcileRoles\(\)/);
assert.match(interpreter, /for \(const rule of config\?\.roles/);
assert.match(renderer, /const isWorkBuddy = \(\) => uiInterpreter\.matchesBootstrapHost\(\)/,
  "the early payload must delegate renderer identity admission to the versioned UI Interpreter");
assert.match(interpreter, /location\?\.protocol !== "file:"/,
  "bootstrap admission must remain limited to WorkBuddy's local renderer");
assert.match(interpreter, /decodeURIComponent\(location\.pathname\)\.endsWith\(identity\.rendererPathSuffix\)/,
  "bootstrap admission must require the cataloged WorkBuddy renderer path");
assert.match(interpreter, /typeof current === "string" && current && current !== value/,
  "populated host identity facts must fail closed when they disagree with the catalog");
assert.match(interpreter, /const matchesHost = \(\) => matchesHostIdentity\(\)/,
  "full reconciliation must retain the strict dataset and Surface selector gate");
assert.match(interpreter, /const previousStyles = new Map\(\)/);
assert.match(interpreter, /previous\.priority/);
assert.match(renderer, /prefers-reduced-motion: reduce/);
assert.match(renderer, /backgroundVideo\.addEventListener\("playing", \(\) => \{[\s\S]*?syncVideoPlayback\(\);/,
  "late playing events must re-enter the Reduced Motion-aware playback state machine");
assert.match(renderer, /settings\.paletteStrategy === "system"/);
assert.match(renderer, /workbuddySkinPalette/);
assert.match(renderer, /nativeShellMode/);
assert.match(renderer, /getComputedStyle\(root\)\.getPropertyValue\(name\)/);
assert.match(renderer, /uiInterpreter\.applyStyleSources\(styleSourcesForSettings\(currentThemeSettings/);
assert.doesNotMatch(renderer, /const nativeVariable/);
assert.match(renderer, /const VIDEO_TOGGLE_ID = "workbuddy-skin-video-toggle"/);
assert.equal(catalog.runtimeInterpreter.anchors.videoToggle.selectors[0], ":scope > .task-header-btn");
assert.doesNotMatch(renderer, /流转|帮助与反馈|\.task-topbar-actions|\.settings-navigation/);
assert.match(renderer, /previousVideoUserPaused/);
assert.match(renderer, /videoMotionOverride/);
assert.match(renderer, /previousVideoDisabled/);
assert.match(renderer, /videoDisabled = presentation === "disabled"/);
assert.match(renderer, /current === "enabled" \? "paused" : current === "paused" \? "disabled" : "enabled"/);
assert.match(renderer, /workbuddySkinVideoState = "disabled"/);
assert.match(renderer, /flowAction\.parentElement\.insertBefore\(videoToggle, flowAction\)/);
assert.match(renderer, /setInterval\(scheduleReconcile, 1000\)/);
assert.match(renderer, /clearInterval\(reconcileInterval\)/);
assert.match(renderer, /settingsMessage\("enableVideoAria"\)/);
assert.match(renderer, /settingsMessage\("disableVideoAria"\)/);
assert.equal(locales.messages.enableVideoAria.length, locales.locales.length);
assert.match(css, /#workbuddy-skin-background-video/);
assert.match(css, /#workbuddy-skin-video-toggle/);
assert.match(css, /data-workbuddy-skin-video-state="disabled"/);
assert.match(
  css,
  /workbuddy-skin:not\(\[data-workbuddy-skin-video-state="disabled"\]\)[\s\S]*?\[data-workbuddy-skin-role\^="page-"\]/,
);
assert.match(css, /data-workbuddy-skin-palette="system"/);
assert.match(css,
  /not\(\[data-workbuddy-skin-palette="system"\]\)[^\{]*not\(\[data-workbuddy-skin-video-state="disabled"\]\)[^\{]*data-workbuddy-skin-role="scene-tab"[^\{]*\.wb-scene-tabs__pill--active:active\s*\{[^}]*var\(--wbs-action-pressed\)/,
  "captured active scene tabs must consume actionPressed only outside native system and disabled states");
assert.match(css,
  /not\(\[data-workbuddy-skin-palette="system"\]\)[^\{]*not\(\[data-workbuddy-skin-video-state="disabled"\]\)[^\{]*data-workbuddy-skin-role="account-plan-action"[^\{]*:active\s*\{[^}]*var\(--wbs-action-pressed\)/,
  "account primary-action pressed paint must preserve native system and disabled states");
assert.match(css, /data-workbuddy-skin-role="project-hero-media"/);
assert.doesNotMatch(css, /\.daily-checkin-actions\s+:is\(button, span\)/);
assert.match(css, /\.daily-checkin-btn-primary :is\(span, div, p, strong, svg\)/);
assert.match(css, /\.daily-checkin-btn-secondary :is\(span, div, p, strong, svg\)/);
assert.match(css, /workbuddy-skin:not\(\[data-workbuddy-skin-palette="system"\]\)/);

const nativePopupMarkers = [
  "data-workbuddy-skin-role=\"overlay-",
  "data-workbuddy-skin-role=\"account-",
  "data-workbuddy-skin-role=\"miniprogram-",
  "daily-checkin",
  "data-floating-ui-portal",
];
for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selector = rule[1];
  const declarations = rule[2];
  if (!nativePopupMarkers.some((marker) => selector.includes(marker))) continue;
  if (!/(?:background|color|border|box-shadow|text-fill-color|backdrop-filter)\s*:/.test(declarations)) continue;
  assert.match(
    selector,
    /workbuddy-skin:not\(\[data-workbuddy-skin-palette="system"\]\)/,
    `system palette popup appearance must remain native: ${selector.trim()}`,
  );
  assert.match(
    selector,
    /:not\(\[data-workbuddy-skin-video-state="disabled"\]\)/,
    `disabled media popup appearance must remain native: ${selector.trim()}`,
  );
}

const projectRole = catalog.runtimeRoles.find(({ role }) => role === "page-project");
assert.ok(projectRole);
assert.ok(projectRole.selectors.includes(".workbuddy-collab:not(.workbuddy-collab--portal)"));
assert.ok(!projectRole.selectors.includes(".workbuddy-collab"));

const catalogRoles = new Set(catalog.runtimeRoles.map(({ role }) => role));
assert.ok(catalogRoles.has("overlay-transfer-scrim"));
assert.ok(catalogRoles.has("overlay-transfer-modal"));
const styledRoles = new Set(
  [...css.matchAll(/\[data-workbuddy-skin-role="([^"]+)"\]/g)].map((match) => match[1]),
);
const criticalStyledRoles = [
  "sidebar",
  "sidebar-brand",
  "sidebar-nav-row",
  "sidebar-nav-item",
  "sidebar-nav-actions",
  "sidebar-nav-action",
  "topbar",
  "topbar-actions",
  "flow-action",
  "video-playback-control",
  "page-home",
  "page-assistant",
  "page-chat",
  "page-project",
  "page-expert",
  "page-automation",
  "page-automation-editor",
  "page-inspiration",
  "page-files",
  "page-external-resource",
  "quick-action",
  "project-card",
  "project-template-card",
  "project-hero-media",
  "expert-scene-card",
  "expert-card",
  "automation-template-card",
  "artifact-card",
  "markdown-table-wrapper",
  "markdown-table",
  "markdown-table-header-cell",
  "markdown-table-body-cell",
  "inspiration-card",
  "skill-detail",
  "composer",
  "composer-slot",
  "composer-input",
  "composer-toolbar",
  "composer-footer",
  "detail-panel",
  "detail-panel-surface",
  "detail-panel-header",
  "detail-panel-tab",
  "detail-panel-navigation",
  "detail-panel-body",
  "detail-panel-empty",
  "detail-sidebar",
  "overlay-scrim",
  "overlay-detail-scrim",
  "overlay-search-modal",
  "overlay-settings-modal",
  "overlay-create-modal",
  "overlay-expert-modal",
  "overlay-detail-modal",
  "overlay-popover",
  "overlay-account",
  "account-menu-header",
  "account-menu-copy-action",
  "account-menu-item",
  "account-menu-label",
  "account-menu-value",
  "account-menu-subtitle",
  "account-menu-icon",
  "account-menu-divider",
  "account-plan-action",
  "account-theme-switcher",
  "account-theme-thumb",
  "account-theme-option",
  "overlay-collaboration",
  "overlay-qr",
  "miniprogram-heading",
  "miniprogram-description",
  "miniprogram-footer",
  "miniprogram-footer-text",
  "miniprogram-toggle",
  "miniprogram-toggle-track",
  "miniprogram-qr-canvas",
  "overlay-listbox",
];

for (const role of criticalStyledRoles) {
  assert.ok(catalogRoles.has(role), `critical role is missing from the catalog: ${role}`);
  assert.ok(styledRoles.has(role), `critical role is missing from the stylesheet: ${role}`);
}

for (const declaration of css.matchAll(/box-shadow:\s*([^;]+);/g)) {
  assert.match(declaration[1], /var\(--wbs-shadow-|none/, `box-shadow must use the elevation contract: ${declaration[1]}`);
}

for (const key of [
  "surfaceMuted",
  "textSecondary",
  "textDisabled",
  "iconPrimary",
  "iconMuted",
  "divider",
  "overlayScrim",
  "detailScrim",
  "shadowColor",
  "danger",
  "controlTrack",
  "controlTrackActive",
  "controlThumb",
]) {
  assert.equal(typeof theme.semanticColors[key], "string", `theme semantic color is missing: ${key}`);
}
const configuredVariables = new Set(styleCatalog.bindings.map((binding) => binding.cssVariable));
for (const variable of [
  "--wbs-surface-muted",
  "--wbs-text-secondary",
  "--wbs-text-disabled",
  "--wbs-icon",
  "--wbs-icon-muted",
  "--wbs-divider",
  "--wbs-control-track",
  "--wbs-control-track-active",
  "--wbs-control-thumb",
  "--wbs-overlay-scrim",
  "--wbs-detail-scrim",
  "--wbs-shadow-popover",
  "--wbs-shadow-modal",
  "--wbs-shadow-detail",
  "--wbs-table-border",
]) {
  assert.ok(configuredVariables.has(variable), `style catalog binding is missing: ${variable}`);
}

console.log("surface-role-contract.test.mjs: ok");
