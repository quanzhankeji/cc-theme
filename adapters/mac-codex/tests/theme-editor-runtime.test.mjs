import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [renderer, css, injector, locales, uiSurfaceCatalog] = await Promise.all([
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "assets", "skin.css"), "utf8"),
  fs.readFile(path.join(root, "scripts", "injector.mjs"), "utf8"),
  fs.readFile(path.join(root, "contracts", "theme-editor-locales.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "compatibility", "chatgpt-macos", "26.715.61943", "ui-surface-catalog.json"), "utf8").then(JSON.parse),
]);

for (const placeholder of [
  "__THEME_STYLE_CATALOG_JSON__",
  "__THEME_EDITOR_LOCALES_JSON__",
  "__THEME_STYLE_OVERRIDES_JSON__",
  "__THEME_RUNTIME_PREFERENCES_JSON__",
  "__THEME_OVERRIDE_STATE_JSON__",
  "__THEME_STYLE_EDITOR_NONCE_JSON__",
  "__THEME_STYLE_EDITOR_BINDING_JSON__",
]) assert(renderer.includes(placeholder), `Renderer is missing ${placeholder}`);

// Dedicated Settings page and native-adjacent navigation parity.
assert(renderer.includes('const THEME_SETTINGS_NAV_ID = "cc-theme-settings-nav-item"'));
assert(renderer.includes('const THEME_SETTINGS_SLUG = "cc-theme"'));
assert(renderer.includes('const SETTINGS_APPEARANCE_SELECTOR = \'[data-settings-panel-slug="appearance"]\''));
assert(renderer.includes("const captureNativeNavPresentation = (node) =>"));
assert(renderer.includes("const applyNativeNavPresentation = (node, presentation) =>"));
assert(renderer.includes("part.getAttribute(name) !== value"));
assert(renderer.includes("const adjacentInactiveNativeNav = (anchor) =>"));
assert(renderer.includes('"aria-current", "aria-selected", "aria-disabled", "data-state", "tabindex"'));
assert(renderer.includes("navItem = inactiveReference.cloneNode(true)"));
assert(renderer.includes("applyThemeNavIdentity(navItem)"));
assert(renderer.includes('navItem.setAttribute("data-settings-panel-slug", THEME_SETTINGS_SLUG)'));
assert(!renderer.includes('navItem.removeAttribute("data-settings-panel-slug")'));
assert(renderer.includes('navItem.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"))'));
assert(renderer.includes('appearanceNavItem.parentElement.insertBefore(navItem, appearanceNavItem.nextSibling)'));
assert(renderer.includes('event.key !== "Enter" && event.key !== " "'));
assert(renderer.includes('nativeTarget.id === THEME_SETTINGS_NAV_ID'));
assert(renderer.includes('applyNativeNavPresentation(nativeTarget, selectedPresentation)'));
assert(renderer.includes('page.id = THEME_SETTINGS_PAGE_ID'));
assert(renderer.includes('editor.dataset.themeEditorPlacementBoundary = "dedicated-settings-page"'));
assert(renderer.includes('child.setAttribute("data-theme-page-native-hidden", "true")'));
assert(renderer.includes("restoreNativeSettingsContent()"));
assert(!renderer.includes('classList.add("hover:bg-token-list-hover-background")'));
assert(!renderer.includes('classList.remove("text-token-list-active-selection-foreground")'));
assert(!css.includes('#cc-theme-settings-nav-item[aria-current="page"]'));
assert(!css.includes('[data-skin-role="settings-nav-item"]:not(#cc-theme-settings-nav-item)'),
  "the CC Theme entry must share the adjacent native Settings state rules");

// Catalog-driven accordion/color UI remains complete and has no save action.
assert(renderer.includes('headingTitle.textContent = formatEditorMessage("pageTitle") || "cc-theme"'));
assert(renderer.includes('label.replaceChildren(document.createTextNode(formatEditorMessage("settingsNavLabel") || "cc-theme"))'));
assert(renderer.includes('editor.setAttribute("dir", EDITOR_LOCALE_STATE.direction)'));
assert(renderer.includes('formatEditorMessage("editValue"'));
assert(renderer.includes("formatEditorNumber(tokens.length)"));
assert(renderer.includes('groupSection.className = "cc-theme-style-editor-group"'));
assert(renderer.includes('const groupSection = document.createElement("details")'));
assert(renderer.includes('body.querySelectorAll("details.cc-theme-style-editor-group[open]")'));
assert(!renderer.includes("groupSection.open = true"));
assert(renderer.includes('colorPicker.type = "color"'));
assert(renderer.includes('colorPicker.addEventListener("input"'));
assert(renderer.includes('localizedGroupLabel(group)'));
assert(renderer.includes('localizedTokenLabel(token)'));
assert(!renderer.includes("cc-theme-style-editor-save"));
assert(!css.includes("cc-theme-style-editor-save"));
for (const removedMessage of ["saveLocal", "previewUnsaved", "saving", "saved", "saveFailed"]) {
  assert(!Object.hasOwn(locales.messages, removedMessage));
}

// WYSIWYG preview, debounced persistence, latest-write-wins and rollback.
assert(renderer.includes('const STYLE_EDITOR_SYNC_KEY = "__CC_THEME_APPLY_PERSISTED_OVERRIDES__"'));
assert(renderer.includes("const commitEditorDraft = () =>"));
assert(renderer.includes("applyStyleOverrides(document.documentElement, editorDraft)"));
assert(renderer.includes("styleEditorDebounceTimer = setTimeout(send, 160)"));
assert(renderer.includes("writeVersion: write.version"));
assert(renderer.includes("runtimePreferences: write.runtimePreferences"));
assert(renderer.includes("baseValues: write.baseValues"));
assert(renderer.includes("baseRuntimePreferences: write.baseRuntimePreferences"));
assert(renderer.includes('editorRuntimePreferences["background.presentation"]'));
assert(renderer.includes("if (pendingStyleEditorRequest)"));
assert(renderer.includes("queuedStyleEditorWrite.version < write.version"));
assert(renderer.includes("restoreLastPersistedStyleOverrides()"));
assert(renderer.includes("flushStyleOverridePersistence()"));
assert(renderer.includes("const rerenderLocalizedThemeUi = () =>"));
assert(renderer.includes("runtime.editorLocaleDiagnostic = EDITOR_LOCALE_STATE.diagnostic"));
const localizedRerender = renderer.match(/const rerenderLocalizedThemeUi = \(\) => \{[\s\S]*?\n  \};/)?.[0] || "";
assert(localizedRerender.includes('editor.setAttribute("lang", EDITOR_LOCALE)'));
assert(localizedRerender.includes('groupSection.querySelectorAll("[data-theme-style-token]")'));
assert(localizedRerender.includes('setStyleEditorStatus(status.message, status.state)'));
assert(!localizedRerender.includes("disposeThemeEditorUi()"));
assert(!localizedRerender.includes("flushStyleOverridePersistence()"));
assert(!localizedRerender.includes("THEME_SETTINGS_PAGE_ID)?.remove()"));
assert(renderer.includes("groupSection.dataset.themeStyleGroup = group.id"));
assert(renderer.includes('setStyleEditorStatus(formatEditorMessage("persistenceFailed"), "error")'));
assert(renderer.includes('setStyleEditorStatus(formatEditorMessage("changesApplied"), "success")'));
const dispose = renderer.match(/const disposeThemeEditorUi = \(\) => \{[\s\S]*?\n  \};/)?.[0] || "";
assert(dispose.includes("flushStyleOverridePersistence()"));
assert(!dispose.includes("pendingStyleEditorRequest = null"));
assert(!dispose.includes("delete window[STYLE_EDITOR_RESULT_KEY]"));
assert(!dispose.includes("clearTimeout(styleEditorRequestTimer)"));

// Runtime failure remains visible and style writes stay nonce/theme bound.
assert(renderer.includes('const THEME_RUNTIME_RESULT_KEY = "__CC_THEME_RUNTIME_RESULT__"'));
assert(renderer.includes('runtimeNotice.setAttribute("role", "alert")'));
assert(renderer.includes('formatEditorMessage("themeLoadFailed")'));
assert(injector.includes('const STYLE_EDITOR_BINDING = "__ccThemePersistStyleOverrides"'));
assert(injector.includes("async function replaceRuntimeBinding(session, name)"));
assert(injector.includes('session.send("Runtime.removeBinding", { name })'));
assert(injector.includes("await replaceRuntimeBinding(session, STYLE_EDITOR_BINDING)"));
assert(injector.includes('message?.nonce !== current.editorNonce'));
assert(injector.includes('message?.themeId !== current.theme.id'));
assert(injector.includes("styleWriteCoordinator.submit(theme.id"));
assert(injector.includes("transactStyleOverrides(theme, catalog, {"));
assert(injector.includes('source: "local-editor"'));
assert(injector.includes("runtimePreferences: message.runtimePreferences"));
assert(injector.includes("baseValues: message.baseValues"));
assert(injector.includes("broadcastPersistedStyleOverrides"));
assert(injector.includes("queuePayloadRefresh({ applySessions: false, preserveEditorNonce: true })"));

const editorCss = css.match(/#cc-theme-style-editor \{([\s\S]*?)\n\}/)?.[1] || "";
assert(editorCss.includes("position: fixed"));
assert(editorCss.includes("pointer-events: auto"));
const settingsEditorCss = css.match(/#cc-theme-style-editor\[data-theme-editor-placement="settings"\] \{([\s\S]*?)\n\}/)?.[1] || "";
assert(settingsEditorCss.includes("position: relative"));
assert(settingsEditorCss.includes("background: transparent"));
assert(settingsEditorCss.includes("box-shadow: none"));
assert(css.includes('.cc-theme-style-editor-group[open] > summary::after'));
assert(css.includes('#cc-theme-style-editor-status[data-state="success"]'));
assert(css.includes('#cc-theme-runtime-notice[data-state="error"]'));
assert(css.includes('#cc-theme-style-editor .cc-theme-locale-notice'));
assert(css.includes('#cc-theme-style-editor[dir="rtl"] .cc-theme-style-editor-group > summary::after'));
assert(css.includes("overflow-wrap: anywhere"));
assert(renderer.includes('formatEditorMessage("localOverridesAdjusted")'));

const themeEditorTarget = uiSurfaceCatalog.surfaceTargets.find((target) =>
  target.targetId === "target.settings-theme-page");
assert.equal(themeEditorTarget?.primarySelector, "[data-settings-panel-slug='appearance']");
assert.equal(themeEditorTarget?.ownedNavigation, "#cc-theme-settings-nav-item");
assert.deepEqual(themeEditorTarget?.mirroredStateAttributes,
  ["class", "style", "aria-current", "aria-selected", "aria-disabled", "data-state", "tabindex"]);
assert.equal(themeEditorTarget?.evidencePolicy, "current-evidence-required");

assert(!injector.includes('Page.setBypassCSP", { enabled: true'));
assert(!renderer.includes("Open Skin theme settings"));
console.log("theme-editor-runtime.test.mjs: ok");
