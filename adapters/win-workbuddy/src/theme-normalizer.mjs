const TOP_LEVEL_KEYS = new Set([
  "kind", "schemaVersion", "adapterId", "id", "name", "sourceVersion",
  "colors", "fonts", "appearance", "background", "accessibility",
]);

export const COLOR_KEYS = Object.freeze([
  "surfaceBase", "surfaceRaised", "surfaceElevated", "surfaceCode", "text", "textStrong",
  "textMuted", "placeholder", "borderSubtle", "borderDefault", "borderStrong", "action",
  "actionHover", "actionPressed", "actionForeground", "hoverSurface", "pressedSurface",
  "selectedSurface", "selectedHoverSurface", "focusRing", "link", "danger", "success",
  "warning", "sidebarSurface", "headerSurface", "mainScrimStart", "mainScrimMid",
  "mainScrimEnd", "composerSurface",
]);

const REQUIRED_COLORS = ["surfaceBase", "text", "textMuted", "action", "actionForeground", "focusRing"];
const FONT_KEYS = new Set(["ui", "display", "code"]);
const APPEARANCE_KEYS = new Set([
  "paletteStrategy", "shellMode", "backdropBlurPx", "backdropSaturation", "radiusScale",
  "backgroundPosition",
]);
const ACCESSIBILITY_KEYS = new Set(["reducedMotion", "preserveSystemFocusRing"]);
const BACKGROUND_KEYS = Object.freeze({
  media: new Set(["mode", "image", "video", "posterMode", "scrimOpacity", "position"]),
  ripple: new Set(["mode", "image", "intensity", "radiusPx", "quality", "scrimOpacity", "position"]),
  directional: new Set([
    "mode", "image", "atlas", "directions", "columns", "rows", "firstDirectionDegrees",
    "idleFrame", "origin", "scrimOpacity", "position",
  ]),
});

const FORBIDDEN_KEY = /(css|javascript|script|html|shader|selector|command|url|uri|path|environment|argument)/i;
const FORBIDDEN_STRING = /(?:^[A-Za-z][A-Za-z0-9+.-]*:\/\/|^[A-Za-z]:[\\/]|^\\\\|^\/|(?:^|[\\/])\.\.(?:[\\/]|$)|\$\{|\$\(|%[A-Za-z_][A-Za-z0-9_]*%|\bBearer\s+[A-Za-z0-9._~-]+|<\/?[A-Za-z][^>]*>|\burl\s*\(|\bexpression\s*\(|@import\b|\bjavascript\s*:|\bvoid\s+main\s*\(|\bfunction\s*\(|=>|`)/i;
const COLOR = /^(#[0-9A-Fa-f]{6}|rgba?\([0-9., %]+\))$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/;
const LOCAL_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp)$/i;
const LOCAL_VIDEO = /^[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/i;
const STATIC_WEBP = /^[A-Za-z0-9][A-Za-z0-9._-]*\.webp$/i;
const SAFE_FONT = /^[\p{L}\p{N} ._-]{1,80}$/u;

function fail(code) {
  throw new Error(code);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function requireObject(value, code) {
  if (!isPlainObject(value)) fail(code);
}

function rejectUnknownKeys(value, allowed, code = "theme-field-unknown") {
  requireObject(value, "theme-object-invalid");
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEY.test(key)) fail("theme-executable-field-forbidden");
    if (!allowed.has(key)) fail(code);
  }
}

function scanForbidden(value) {
  if (typeof value === "string" && FORBIDDEN_STRING.test(value)) fail("theme-executable-value-forbidden");
  if (Array.isArray(value)) {
    for (const entry of value) scanForbidden(entry);
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) fail("theme-executable-field-forbidden");
      scanForbidden(entry);
    }
  }
}

export function assertThemePayloadSafe(value) {
  scanForbidden(value);
  return true;
}

function requireString(value, minimum, maximum, code) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) fail(code);
}

function requireNumber(value, minimum, maximum, code) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail(code);
}

function validatePosition(value, code = "theme-position-invalid") {
  rejectUnknownKeys(value, new Set(["xPercent", "yPercent"]));
  if (Object.keys(value).length !== 2) fail(code);
  requireNumber(value.xPercent, 0, 100, code);
  requireNumber(value.yPercent, 0, 100, code);
}

function validateColors(colors) {
  rejectUnknownKeys(colors, new Set(COLOR_KEYS));
  for (const required of REQUIRED_COLORS) if (!(required in colors)) fail("theme-required-color-missing");
  for (const value of Object.values(colors)) {
    if (typeof value !== "string" || value.length > 48 || !COLOR.test(value)) fail("theme-color-invalid");
  }
}

function validateFonts(fonts) {
  rejectUnknownKeys(fonts, FONT_KEYS);
  for (const list of Object.values(fonts)) {
    if (!Array.isArray(list) || list.length < 1 || list.length > 8 || new Set(list).size !== list.length) {
      fail("theme-font-list-invalid");
    }
    for (const font of list) {
      requireString(font, 1, 80, "theme-font-invalid");
      if (!SAFE_FONT.test(font)) fail("theme-font-invalid");
    }
  }
}

function validateAppearance(appearance) {
  rejectUnknownKeys(appearance, APPEARANCE_KEYS);
  if (!new Set(["system", "adaptive", "custom"]).has(appearance.paletteStrategy)) {
    fail("theme-palette-strategy-invalid");
  }
  if (appearance.shellMode !== undefined && !new Set(["auto", "light", "dark"]).has(appearance.shellMode)) {
    fail("theme-shell-mode-invalid");
  }
  if (appearance.backdropBlurPx !== undefined) requireNumber(appearance.backdropBlurPx, 0, 48, "theme-blur-invalid");
  if (appearance.backdropSaturation !== undefined) requireNumber(appearance.backdropSaturation, 0.5, 1.5, "theme-saturation-invalid");
  if (appearance.radiusScale !== undefined) requireNumber(appearance.radiusScale, 0.75, 1.5, "theme-radius-invalid");
  if (appearance.backgroundPosition !== undefined) validatePosition(appearance.backgroundPosition);
}

function validateBackground(background) {
  requireObject(background, "theme-background-invalid");
  const allowed = BACKGROUND_KEYS[background.mode];
  if (!allowed) fail("theme-background-mode-invalid");
  rejectUnknownKeys(background, allowed);
  if (!LOCAL_IMAGE.test(background.image ?? "")) fail("theme-background-image-invalid");
  if (background.scrimOpacity !== undefined) requireNumber(background.scrimOpacity, 0, 0.8, "theme-scrim-invalid");
  if (background.position !== undefined) validatePosition(background.position);

  if (background.mode === "media") {
    if (background.video !== undefined && !LOCAL_VIDEO.test(background.video)) fail("theme-background-video-invalid");
    if (background.posterMode !== undefined && !new Set(["none", "image"]).has(background.posterMode)) {
      fail("theme-poster-mode-invalid");
    }
  }
  if (background.mode === "ripple") {
    if (background.intensity !== undefined) requireNumber(background.intensity, 0, 1, "theme-ripple-intensity-invalid");
    if (background.radiusPx !== undefined) requireNumber(background.radiusPx, 8, 96, "theme-ripple-radius-invalid");
    if (background.quality !== undefined && !new Set(["auto", "low", "high"]).has(background.quality)) {
      fail("theme-ripple-quality-invalid");
    }
  }
  if (background.mode === "directional") {
    if (!STATIC_WEBP.test(background.atlas ?? "")) fail("theme-directional-atlas-invalid");
    if (!new Set([8, 16, 32]).has(background.directions)) fail("theme-directional-count-invalid");
    for (const key of ["columns", "rows"]) {
      if (!Number.isInteger(background[key]) || background[key] < 1 || background[key] > 8) {
        fail("theme-directional-grid-invalid");
      }
    }
    if (background.columns * background.rows !== background.directions) fail("theme-directional-grid-invalid");
    if (background.firstDirectionDegrees !== undefined) requireNumber(background.firstDirectionDegrees, -180, 180, "theme-direction-invalid");
    if (background.idleFrame !== undefined && (!Number.isInteger(background.idleFrame) || background.idleFrame < 0 || background.idleFrame >= background.directions)) {
      fail("theme-idle-frame-invalid");
    }
    if (background.origin !== undefined) validatePosition(background.origin);
  }
}

function validateAccessibility(accessibility) {
  rejectUnknownKeys(accessibility, ACCESSIBILITY_KEYS);
  if (accessibility.reducedMotion !== "static") fail("theme-reduced-motion-invalid");
  if (accessibility.preserveSystemFocusRing !== undefined && typeof accessibility.preserveSystemFocusRing !== "boolean") {
    fail("theme-focus-ring-invalid");
  }
}

export function normalizeTheme(input) {
  requireObject(input, "theme-invalid");
  scanForbidden(input);
  rejectUnknownKeys(input, TOP_LEVEL_KEYS);
  if (input.kind !== "skin.theme" || input.schemaVersion !== 1 || input.adapterId !== "win-workbuddy-skin") {
    fail("theme-identity-invalid");
  }
  if (!SAFE_ID.test(input.id ?? "")) fail("theme-id-invalid");
  requireString(input.name, 1, 80, "theme-name-invalid");
  if (typeof input.sourceVersion !== "string" || input.sourceVersion.length > 40 || !VERSION.test(input.sourceVersion)) {
    fail("theme-version-invalid");
  }
  validateColors(input.colors);
  validateFonts(input.fonts);
  validateAppearance(input.appearance);
  validateBackground(input.background);
  validateAccessibility(input.accessibility);
  return structuredClone(input);
}

export function validateRuntimeValue(tokenId, value) {
  scanForbidden(value);
  if (tokenId === "palette.strategy") {
    if (!new Set(["system", "adaptive", "custom"]).has(value)) fail("settings-value-invalid");
    return cloneRuntimeValue(value);
  }
  if (tokenId === "background.presentation") {
    if (!new Set(["enabled", "paused", "disabled"]).has(value)) fail("settings-value-invalid");
    return cloneRuntimeValue(value);
  }
  if (tokenId.startsWith("color.")) {
    if (typeof value !== "string" || !COLOR.test(value)) fail("settings-value-invalid");
    return value;
  }
  if (tokenId.startsWith("font.")) {
    const wrapper = { value };
    validateFonts({ ui: wrapper.value });
    return cloneRuntimeValue(value);
  }
  const numeric = {
    "appearance.backdropBlurPx": [0, 48],
    "appearance.backdropSaturation": [0.5, 1.5],
    "appearance.radiusScale": [0.75, 1.5],
  }[tokenId];
  if (numeric) {
    requireNumber(value, numeric[0], numeric[1], "settings-value-invalid");
    return value;
  }
  fail("settings-token-unsupported");
}

function cloneRuntimeValue(value) {
  scanForbidden(value);
  return structuredClone(value);
}
