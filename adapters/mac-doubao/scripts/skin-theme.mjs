import path from "node:path";

export const ADAPTER_ID = "mac-doubao";
export const SKIN_THEME_KIND = "skin.theme";

const ROOT_KEYS = new Set([
  "kind", "id", "name", "sourceVersion", "image", "backgroundVideo", "colors", "semanticColors", "appearanceVariants", "fonts", "appearance", "presentation",
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
const IMMERSIVE_SCENE_SURFACES = new Set(["shell", "navigation", "home", "conversation", "composer", "cards", "overlays"]);
const IMMERSIVE_SCENE_PRESENTATION_KEYS = new Set([
  "profileId", "profileVersion", "strictness", "geometryPolicy", "surfaces", "parameters", "assetSlots", "fallbackPolicy",
]);
const IMMERSIVE_SCENE_PARAMETER_KEYS = new Set([
  "density", "borderTreatment", "textureIntensity", "surfaceOpacity", "navigationTreatment", "composerTreatment", "cardTreatment",
]);
const IMMERSIVE_SCENE_ASSET_SLOT_KEYS = new Set(["scene.backdrop"]);
const IMMERSIVE_SCENE_FALLBACK_KEYS = new Set(["unsupportedSurface", "reducedMotion"]);

const plainObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;

// Adapter releases are standalone. Shared Core owns detailed validation before
// projection; this release-local gate admits only the fixed inert envelope.
function normalizePresentation(value, label) {
  const presentation = plainObject(value);
  if (!presentation || Object.keys(presentation).some((key) => !IMMERSIVE_SCENE_PRESENTATION_KEYS.has(key)) ||
      presentation.profileId !== "immersive-scene-v1" || presentation.profileVersion !== 1 ||
      presentation.strictness !== "exact-required" || presentation.geometryPolicy !== "scene-bounded" ||
      !Array.isArray(presentation.surfaces) || presentation.surfaces.length !== IMMERSIVE_SCENE_SURFACES.size ||
      new Set(presentation.surfaces).size !== IMMERSIVE_SCENE_SURFACES.size ||
      presentation.surfaces.some((surface) => !IMMERSIVE_SCENE_SURFACES.has(surface)) ||
      !plainObject(presentation.parameters) || !plainObject(presentation.assetSlots) || !plainObject(presentation.fallbackPolicy)) {
    throw new Error(`${label} must use the validated immersive-scene-v1 envelope`);
  }
  const parameters = objectWithKeys(presentation.parameters, IMMERSIVE_SCENE_PARAMETER_KEYS, `${label} parameters`);
  const assetSlots = objectWithKeys(presentation.assetSlots, IMMERSIVE_SCENE_ASSET_SLOT_KEYS, `${label} assetSlots`);
  const fallbackPolicy = objectWithKeys(presentation.fallbackPolicy, IMMERSIVE_SCENE_FALLBACK_KEYS, `${label} fallbackPolicy`);
  for (const key of IMMERSIVE_SCENE_PARAMETER_KEYS) {
    if (!Object.hasOwn(parameters, key)) throw new Error(`${label} parameters requires ${key}`);
  }
  if (parameters.density !== "comfortable" || parameters.borderTreatment !== "etched" ||
      parameters.navigationTreatment !== "framed" || parameters.composerTreatment !== "anchored" ||
      parameters.cardTreatment !== "elevated" || !Number.isFinite(parameters.textureIntensity) ||
      parameters.textureIntensity < 0 || parameters.textureIntensity > 1 ||
      !Number.isFinite(parameters.surfaceOpacity) || parameters.surfaceOpacity < 0 || parameters.surfaceOpacity > 1 ||
      !Object.hasOwn(assetSlots, "scene.backdrop") ||
      localFile(assetSlots["scene.backdrop"], [".png", ".jpg", ".jpeg", ".webp"], `${label} assetSlots.scene.backdrop`) !== assetSlots["scene.backdrop"] ||
      fallbackPolicy.unsupportedSurface !== "block" || fallbackPolicy.reducedMotion !== "static") {
    throw new Error(`${label} must use the validated immersive-scene-v1 values`);
  }
  return structuredClone(presentation);
}

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

function appearanceVariants(value) {
  if (value === undefined) return null;
  const variants = objectWithKeys(value, new Set(["light", "dark"]), "Theme appearanceVariants");
  const normalized = {};
  for (const mode of ["light", "dark"]) {
    const variant = objectWithKeys(variants[mode], new Set(["colors", "semanticColors"]), `Theme appearanceVariants.${mode}`);
    const variantColors = colors(variant.colors, COLOR_KEYS, `Theme appearanceVariants.${mode}.colors`);
    const variantSemantic = colors(variant.semanticColors, SEMANTIC_COLOR_KEYS, `Theme appearanceVariants.${mode}.semanticColors`);
    for (const key of COLOR_KEYS) {
      if (!Object.hasOwn(variantColors, key)) throw new Error(`Theme appearanceVariants.${mode}.colors requires ${key}`);
    }
    for (const key of ["surfaceBase", "surfaceRaised", "action", "actionForeground", "focusRing", "sidebarSurface", "headerSurface", "mainScrimStart", "mainScrimMid", "mainScrimEnd"]) {
      if (!Object.hasOwn(variantSemantic, key)) throw new Error(`Theme appearanceVariants.${mode}.semanticColors requires ${key}`);
    }
    normalized[mode] = { colors: variantColors, semanticColors: variantSemantic };
  }
  return normalized;
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
  const normalizedAppearanceVariants = appearanceVariants(theme.appearanceVariants);
  const themeAppearance = appearance(theme.appearance);
  const presentation = theme.presentation === undefined ? null : normalizePresentation(theme.presentation, `${label} presentation`);
  if (!theme.backgroundVideo && [
    "backgroundVideoPosterMode", "backgroundVideoScrimOpacity", "backgroundVideoPosition",
  ].some((key) => themeAppearance[key] !== undefined)) {
    throw new Error(`${label} video appearance requires backgroundVideo`);
  }
  const normalized = structuredClone(theme);
  if (presentation) normalized.presentation = presentation;
  if (normalizedAppearanceVariants) normalized.appearanceVariants = normalizedAppearanceVariants;
  normalized.appearance = {
    ...themeAppearance,
    paletteStrategy: themeAppearance.paletteStrategy ?? "system",
  };
  return normalized;
}
