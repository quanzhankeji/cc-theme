import path from "node:path";

export const ADAPTER_ID = "mac-doubao";
export const SKIN_THEME_KIND = "skin.theme";

const ROOT_KEYS = new Set([
  "kind", "id", "name", "sourceVersion", "image", "backgroundVideo", "colors", "semanticColors", "fonts", "appearance",
]);
const COLOR_PATTERN = /^(?:#[0-9a-f]{6}|rgba?\([0-9., %]+\))$/i;
const COLOR_KEYS = new Set(["text", "muted"]);
const SEMANTIC_COLOR_KEYS = new Set([
  "surfaceBase", "surfaceRaised", "surfaceElevated", "surfaceCode", "textStrong", "placeholder",
  "borderSubtle", "borderDefault", "action", "actionHover", "actionPressed",
  "actionForeground", "hoverSurface", "pressedSurface", "selectedSurface", "selectedHoverSurface",
  "focusRing", "link", "sidebarSurface", "headerSurface",
  "mainScrimStart", "mainScrimMid", "mainScrimEnd", "composerSurface",
]);
const FONT_KEYS = new Set(["ui", "display", "code"]);
const APPEARANCE_KEYS = new Set([
  "paletteStrategy", "backdropBlurPx", "backdropSaturation", "backgroundPosition",
  "backgroundVideoPosterMode", "backgroundVideoScrimOpacity", "backgroundVideoPosition",
]);

const plainObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;

function objectWithKeys(value, keys, label, optional = false) {
  if (value === undefined && optional) return {};
  const object = plainObject(value);
  if (!object) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(object).filter((key) => !keys.has(key));
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}`);
  return object;
}

function localFile(value, extensions, label) {
  if (typeof value !== "string" || value.length < 5 || value.length > 255 || path.basename(value) !== value ||
      value.includes(":") || value.includes("\\") || value.includes("..") ||
      !extensions.some((extension) => value.toLowerCase().endsWith(extension))) {
    throw new Error(`${label} must be a safe package-local file`);
  }
  return value;
}

function colors(value, keys, label) {
  const result = objectWithKeys(value, keys, label, true);
  for (const [key, color] of Object.entries(result)) {
    if (typeof color !== "string" || color.length > 48 || !COLOR_PATTERN.test(color)) {
      throw new Error(`${label}.${key} is invalid`);
    }
  }
  return result;
}

function fonts(value) {
  const result = objectWithKeys(value, FONT_KEYS, "Theme fonts", true);
  for (const [key, families] of Object.entries(result)) {
    if (!Array.isArray(families) || !families.length || families.length > 8 ||
        new Set(families).size !== families.length ||
        families.some((family) => typeof family !== "string" || !/^[^:/\\\u0000-\u001f]{1,80}$/.test(family))) {
      throw new Error(`Theme fonts.${key} is invalid`);
    }
  }
  return result;
}

function position(value, label) {
  const result = objectWithKeys(value, new Set(["xPercent", "yPercent"]), label);
  if (![result.xPercent, result.yPercent].every((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 100)) {
    throw new Error(`${label} must contain percentages from 0 to 100`);
  }
  return result;
}

function appearance(value) {
  const result = objectWithKeys(value, APPEARANCE_KEYS, "Theme appearance", true);
  if (result.paletteStrategy !== undefined && !["system", "adaptive"].includes(result.paletteStrategy)) {
    throw new Error("Theme appearance.paletteStrategy is invalid");
  }
  for (const [key, minimum, maximum] of [
    ["backdropBlurPx", 0, 48], ["backdropSaturation", 0.5, 1.5],
  ]) {
    if (result[key] !== undefined && (!Number.isFinite(result[key]) || result[key] < minimum || result[key] > maximum)) {
      throw new Error(`Theme appearance.${key} is invalid`);
    }
  }
  if (result.backgroundPosition !== undefined) position(result.backgroundPosition, "Theme appearance.backgroundPosition");
  if (result.backgroundVideoPosition !== undefined) position(result.backgroundVideoPosition, "Theme appearance.backgroundVideoPosition");
  if (result.backgroundVideoPosterMode !== undefined && !["none", "image"].includes(result.backgroundVideoPosterMode)) {
    throw new Error("Theme appearance.backgroundVideoPosterMode is invalid");
  }
  if (result.backgroundVideoScrimOpacity !== undefined &&
      (!Number.isFinite(result.backgroundVideoScrimOpacity) || result.backgroundVideoScrimOpacity < 0 || result.backgroundVideoScrimOpacity > 0.8)) {
    throw new Error("Theme appearance.backgroundVideoScrimOpacity is invalid");
  }
  return result;
}

export function normalizeSkinTheme(value, label = "Doubao theme") {
  const theme = objectWithKeys(value, ROOT_KEYS, label);
  if (theme.kind !== SKIN_THEME_KIND || typeof theme.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(theme.id) ||
      typeof theme.name !== "string" || !theme.name.trim() || theme.name.length > 80 ||
      typeof theme.sourceVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(theme.sourceVersion)) {
    throw new Error(`${label} has an invalid identity`);
  }
  localFile(theme.image, [".png", ".jpg", ".jpeg", ".webp"], `${label} image`);
  if (theme.backgroundVideo !== undefined) {
    localFile(theme.backgroundVideo, [".mp4"], `${label} backgroundVideo`);
  }
  const themeColors = colors(theme.colors, COLOR_KEYS, `${label} colors`);
  for (const key of COLOR_KEYS) {
    if (!Object.hasOwn(themeColors, key)) throw new Error(`${label} colors requires ${key}`);
  }
  const semanticColors = colors(theme.semanticColors, SEMANTIC_COLOR_KEYS, `${label} semanticColors`);
  for (const key of ["surfaceBase", "action", "actionForeground", "focusRing"]) {
    if (!Object.hasOwn(semanticColors, key)) throw new Error(`${label} semanticColors requires ${key}`);
  }
  fonts(theme.fonts);
  const themeAppearance = appearance(theme.appearance);
  if (!theme.backgroundVideo && [
    "backgroundVideoPosterMode", "backgroundVideoScrimOpacity", "backgroundVideoPosition",
  ].some((key) => themeAppearance[key] !== undefined)) {
    throw new Error(`${label} video appearance requires backgroundVideo`);
  }
  const normalized = structuredClone(theme);
  normalized.appearance = {
    ...themeAppearance,
    paletteStrategy: themeAppearance.paletteStrategy ?? "system",
  };
  return normalized;
}
