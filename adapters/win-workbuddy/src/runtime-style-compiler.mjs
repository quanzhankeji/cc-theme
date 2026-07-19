const EXPECTED_SELECTORS = Object.freeze({
  shell: ["body"],
  root: ["#root"],
  menubar: [".codebuddy-menubar"],
  teams: [".teams-container"],
  sidebar: [".conversation-sidebar", ".conversation-list"],
  "main-grid-wrapper": ["._gridView_48kdk_9 > ._gridViewItem_48kdk_14:has(> .teams-content-wrapper)"],
  "main-grid-content": [".teams-content-wrapper", ".teams-main-content"],
  "main-welcome": [".main-content.main-content--welcome"],
  chat: [".chat-container"],
  home: [".wb-home-page", ".wb-home-header"],
  composer: [".wb-home-composer", ".wb-home-composer__chips"],
  "growth-plan": [".growth-plan-entry"],
  "scene-tabs": [".wb-scene-tabs"],
});

const EXPECTED_BINDINGS = Object.freeze([
  ["shell-color", "colors.surfaceBase", ["shell"], "exact", null],
  ["background-image", "background.image", ["shell"], "exact", null],
  ["background-video", "background.video", [], "unsupported", "background-video-runtime-unsupported"],
  ["menubar-surface", "colors.surfaceRaised", ["menubar"], "approximate", "raised-surface-over-background"],
  ["sidebar-surface", "colors.surfaceRaised", ["sidebar"], "approximate", "raised-surface-over-background"],
  ["main-background", "background.image", ["teams", "main-grid-wrapper", "main-grid-content", "main-welcome", "chat", "home"], "approximate", "transparent-host-surfaces-over-fixed-background"],
  ["composer-surface", "colors.surfaceRaised", ["composer", "growth-plan", "scene-tabs"], "approximate", "verified-container-only"],
  ["text", "colors.text", ["menubar", "sidebar", "composer", "growth-plan", "scene-tabs"], "approximate", "raised-container-inheritance-host-specificity-may-win"],
  ["font-ui", "fonts.ui", ["shell", "root"], "approximate", "windows-font-fallback-may-apply"],
  ["focus-ring", "colors.focusRing", [], "unsupported", "native-focus-selector-not-yet-observed"],
  ["active-conversation", "colors.action", [], "unsupported", "active-conversation-selector-not-yet-observed"],
  ["active-scene-pill", "colors.action", [], "unsupported", "active-scene-selector-not-yet-observed"],
  ["settings-entry", "settings", [], "unsupported", "settings-surface-not-yet-observed"],
]);

function fail(code) {
  throw new Error(code);
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function assertProofRuntimeCatalogs(surfaceCatalog, styleCatalog) {
  if (surfaceCatalog?.kind !== "ui.surface-catalog"
    || surfaceCatalog.catalogVersion !== 1
    || surfaceCatalog.application !== "workbuddy"
    || surfaceCatalog.platform !== "windows"
    || surfaceCatalog.clientVersion !== "5.2.6"
    || surfaceCatalog.verificationStatus !== "partial-live-verified"
    || surfaceCatalog.scope !== "proof-runtime-only") fail("surface-catalog-proof-invalid");
  if (surfaceCatalog.transport?.verificationStatus !== "proof-verified"
    || surfaceCatalog.transport?.localOnly !== true
    || surfaceCatalog.transport?.domRollbackVerified !== true
    || surfaceCatalog.transport?.listenerCleanupVerified !== false) fail("surface-catalog-transport-invalid");

  const roles = new Map(surfaceCatalog.roles?.map((role) => [role.id, role]));
  if (roles.size !== Object.keys(EXPECTED_SELECTORS).length) fail("surface-catalog-role-set-invalid");
  for (const [role, selectors] of Object.entries(EXPECTED_SELECTORS)) {
    if (!sameArray(roles.get(role)?.selectors, selectors)) fail("surface-catalog-selector-mismatch");
  }

  if (styleCatalog?.kind !== "theme.style-catalog"
    || styleCatalog.catalogVersion !== 2
    || styleCatalog.verificationStatus !== "partial-live-verified"
    || styleCatalog.scope !== "proof-runtime-only"
    || styleCatalog.selectorPolicy !== "surface-catalog-role-indirection-only") fail("style-catalog-proof-invalid");
  const knownRoles = new Set(Object.keys(EXPECTED_SELECTORS));
  if (!Array.isArray(styleCatalog.bindings) || styleCatalog.bindings.length !== EXPECTED_BINDINGS.length) {
    fail("style-catalog-binding-set-invalid");
  }
  for (const [index, binding] of styleCatalog.bindings.entries()) {
    for (const role of binding.roles ?? []) if (!knownRoles.has(role)) fail("style-catalog-role-unknown");
    if (!new Set(["exact", "approximate", "unsupported"]).has(binding.decision)) fail("style-catalog-decision-invalid");
    if (binding.decision === "unsupported" && !binding.diagnostic) fail("style-catalog-diagnostic-missing");
    const [id, source, roles, decision, diagnostic] = EXPECTED_BINDINGS[index];
    if (binding.id !== id || binding.source !== source || !sameArray(binding.roles, roles)
      || binding.decision !== decision || (binding.diagnostic ?? null) !== diagnostic) {
      fail("style-catalog-binding-mismatch");
    }
  }
  return true;
}

function selectors(surfaceCatalog, ...roleIds) {
  const roleMap = new Map(surfaceCatalog.roles.map((role) => [role.id, role.selectors]));
  return roleIds.flatMap((role) => roleMap.get(role)).join(",\n");
}

function cssFontList(fonts) {
  if (!Array.isArray(fonts) || fonts.length === 0) return "system-ui";
  return fonts.map((font) => `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(", ");
}

export function compileProofRuntimeStyle(theme, surfaceCatalog, styleCatalog, markerId) {
  assertProofRuntimeCatalogs(surfaceCatalog, styleCatalog);
  if (markerId !== "cc-theme-win-runtime-marker") fail("runtime-marker-id-invalid");
  if (theme.appearance.paletteStrategy !== "custom") {
    fail(`${theme.appearance.paletteStrategy}-palette-runtime-unverified`);
  }
  if (theme.background.mode !== "media") fail("background-mode-runtime-unverified");
  if (theme.background.video && theme.background.posterMode !== "image") fail("background-video-poster-required");

  const colors = theme.colors;
  const raised = colors.surfaceRaised ?? colors.surfaceBase;
  const uiFont = cssFontList(theme.fonts.ui);
  const blur = theme.appearance.backdropBlurPx ?? 0;
  const saturation = theme.appearance.backdropSaturation ?? 1;
  const radius = Math.round(12 * (theme.appearance.radiusScale ?? 1));
  const shell = selectors(surfaceCatalog, "shell");
  const root = selectors(surfaceCatalog, "root");
  const raisedContainers = selectors(surfaceCatalog, "menubar", "sidebar", "composer", "growth-plan", "scene-tabs");
  const transparentContainers = selectors(surfaceCatalog, "teams", "main-grid-wrapper", "main-grid-content", "main-welcome", "chat", "home");
  const allContainers = selectors(surfaceCatalog, "teams", "sidebar", "main-grid-wrapper", "main-grid-content", "main-welcome", "chat", "home", "composer", "growth-plan", "scene-tabs");
  const radiusContainers = selectors(surfaceCatalog, "composer", "growth-plan", "scene-tabs");

  const css = `
${shell} {
  background-color: ${colors.surfaceBase} !important;
  font-family: ${uiFont} !important;
}
${root} {
  position: relative !important;
  z-index: 1 !important;
  min-height: 100% !important;
  background: transparent !important;
  font-family: ${uiFont} !important;
}
${raisedContainers} {
  background-color: ${raised} !important;
  color: ${colors.text} !important;
  backdrop-filter: blur(${blur}px) saturate(${saturation}) !important;
}
${transparentContainers} {
  background: transparent !important;
}
${allContainers} {
  border-color: rgba(142, 177, 255, 0.28) !important;
}
${radiusContainers} {
  border-radius: ${radius}px !important;
}
#${markerId} {
  position: fixed; top: 42px; right: 14px; z-index: 2147483647;
  padding: 7px 11px; border: 1px solid ${colors.action}; border-radius: 999px;
  color: ${colors.actionForeground}; background: ${raised};
  font: 600 12px/1.2 ${uiFont}; box-shadow: 0 8px 24px rgba(0,0,0,.28);
  pointer-events: none; backdrop-filter: blur(${Math.max(8, blur)}px);
}
`;
  const warnings = [
    ...styleCatalog.bindings
      .filter((binding) => binding.decision !== "exact")
      .map((binding) => binding.diagnostic)
      .filter(Boolean),
    ...(theme.background.video ? ["background-video-runtime-unsupported"] : []),
  ];
  return { css, warnings: [...new Set(warnings)] };
}

export function proofSelectorAllowlist() {
  return structuredClone(EXPECTED_SELECTORS);
}
