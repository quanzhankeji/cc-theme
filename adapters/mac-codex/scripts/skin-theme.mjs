import { normalizeThemePetReference } from "./skin-pet.mjs";

export const SKIN_THEME_KIND = "skin.theme";
export const SKIN_DOCUMENT_KIND = "skin.document";
export const SKIN_PACKAGE_KIND = "skin.package";
export const CC_THEME_FILE_EXTENSION = ".cctheme";
export const CC_THEME_MIME_TYPE = "application/vnd.cc-theme.theme+zip";
export const CC_THEME_CONTAINER = "zip";
export const MAC_CODEX_ADAPTER_ID = "mac-codex";
export const MAC_CODEX_CONTRACT = SKIN_THEME_KIND;
export const MAC_CODEX_TARGET_PATH = "targets/macos/theme.json";

const TOP_LEVEL_KEYS = new Set([
  "kind", "id", "name", "brandSubtitle", "tagline", "projectPrefix", "projectLabel",
  "statusText", "quote", "image", "homeHeroImage", "backgroundVideo", "interactiveBackground", "pet", "colors",
  "semanticColors", "fonts", "art", "appearance", "presentation",
]);
const COLOR_KEYS = new Set(["background", "panel", "panelAlt", "accent", "accentAlt", "secondary", "highlight", "text", "muted", "line"]);
const SEMANTIC_COLOR_KEYS = new Set([
  "surfaceBase", "surfaceRaised", "surfaceElevated", "surfaceCode", "textStrong", "placeholder",
  "borderSubtle", "borderDefault", "borderStrong", "action", "actionHover", "actionPressed",
  "actionForeground", "hoverSurface", "pressedSurface", "selectedSurface", "selectedHoverSurface",
  "focusRing", "link", "danger", "success", "warning", "sidebarSurface", "headerSurface",
  "mainScrimStart", "mainScrimMid", "mainScrimEnd", "composerSurface",
]);
const FONT_KEYS = new Set(["ui", "display", "code"]);
const ART_KEYS = new Set(["analysis", "focusX", "focusY", "safeArea", "taskMode", "paletteMode", "adaptivePalette"]);
const APPEARANCE_KEYS = new Set([
  "shellMode", "newTaskLayout", "backgroundVideoPosterMode", "backgroundPosition", "homeHeroPosition",
  "backgroundVideoPosition", "backgroundVideoScrimOpacity", "backdropBlurPx", "backdropSaturation", "radiusScale", "reduceParticles",
]);
const POSITION_KEYS = new Set(["xPercent", "yPercent"]);
const RIPPLE_BACKGROUND_KEYS = new Set(["type", "intensity", "radiusPx", "quality", "scrimOpacity"]);
const DIRECTIONAL_BACKGROUND_KEYS = new Set([
  "type", "atlas", "directions", "columns", "rows", "firstDirectionDegrees",
  "idleFrame", "origin", "scrimOpacity",
]);
const IMMERSIVE_SCENE_SURFACES = new Set(["shell", "navigation", "home", "conversation", "composer", "cards", "overlays"]);

// Target packages are standalone Adapter releases. The Shared Core validates the
// full declaration before projection; this local gate only accepts that fixed,
// inert profile envelope so a release never imports repository source at runtime.
function normalizePresentation(value, label) {
  const presentation = plainObject(value);
  const allowed = new Set(["profileId", "profileVersion", "strictness", "geometryPolicy", "surfaces", "parameters", "assetSlots", "fallbackPolicy"]);
  if (!presentation || Object.keys(presentation).some((key) => !allowed.has(key)) ||
      presentation.profileId !== "immersive-scene-v1" || presentation.profileVersion !== 1 ||
      presentation.strictness !== "exact-required" || presentation.geometryPolicy !== "scene-bounded" ||
      !Array.isArray(presentation.surfaces) || presentation.surfaces.length !== IMMERSIVE_SCENE_SURFACES.size ||
      new Set(presentation.surfaces).size !== IMMERSIVE_SCENE_SURFACES.size ||
      presentation.surfaces.some((surface) => !IMMERSIVE_SCENE_SURFACES.has(surface)) ||
      !plainObject(presentation.parameters) || !plainObject(presentation.assetSlots) || !plainObject(presentation.fallbackPolicy)) {
    throw new Error(`${label} must use the validated immersive-scene-v1 envelope`);
  }
  return structuredClone(presentation);
}

// Themes default to the same neutral light/dark polarity as the host app. The
// surface values remain translucent so a validated image or video can stay
// visible below the application shell. These are runtime defaults, not fields
// copied into theme.json; explicit imported/user colors are merged afterwards.
export const SYSTEM_THEME_PALETTES = Object.freeze({
  light: Object.freeze({
    colors: Object.freeze({
      background: "rgba(255, 255, 255, .12)",
      panel: "rgba(255, 255, 255, .58)",
      panelAlt: "rgba(246, 246, 246, .68)",
      accent: "#007aff",
      accentAlt: "#0a84ff",
      secondary: "#5e5ce6",
      highlight: "#007aff",
      text: "#1d1d1f",
      muted: "#5f6368",
      line: "rgba(60, 60, 67, .22)",
    }),
    semanticColors: Object.freeze({
      surfaceBase: "rgba(255, 255, 255, .68)",
      surfaceRaised: "rgba(255, 255, 255, .76)",
      surfaceElevated: "rgba(255, 255, 255, .9)",
      surfaceCode: "rgba(248, 248, 250, .86)",
      textStrong: "#000000",
      placeholder: "#6e6e73",
      borderSubtle: "rgba(60, 60, 67, .16)",
      borderDefault: "rgba(60, 60, 67, .24)",
      borderStrong: "#007aff",
      action: "#0066cc",
      actionHover: "#005bb5",
      actionPressed: "#004c99",
      actionForeground: "#ffffff",
      hoverSurface: "rgba(0, 122, 255, .1)",
      pressedSurface: "rgba(0, 122, 255, .16)",
      selectedSurface: "rgba(0, 122, 255, .18)",
      selectedHoverSurface: "rgba(0, 122, 255, .25)",
      focusRing: "#007aff",
      link: "#0066cc",
      danger: "#d70015",
      success: "#248a3d",
      warning: "#a05a00",
      sidebarSurface: "rgba(255, 255, 255, .48)",
      headerSurface: "rgba(255, 255, 255, .38)",
      mainScrimStart: "rgba(255, 255, 255, .2)",
      mainScrimMid: "rgba(255, 255, 255, .1)",
      mainScrimEnd: "rgba(255, 255, 255, .03)",
      composerSurface: "rgba(255, 255, 255, .78)",
    }),
  }),
  dark: Object.freeze({
    colors: Object.freeze({
      background: "rgba(0, 0, 0, .12)",
      panel: "rgba(28, 28, 30, .58)",
      panelAlt: "rgba(44, 44, 46, .68)",
      accent: "#0a84ff",
      accentAlt: "#409cff",
      secondary: "#64d2ff",
      highlight: "#5e5ce6",
      text: "#f5f5f7",
      muted: "#a1a1a6",
      line: "rgba(235, 235, 245, .2)",
    }),
    semanticColors: Object.freeze({
      surfaceBase: "rgba(28, 28, 30, .68)",
      surfaceRaised: "rgba(44, 44, 46, .76)",
      surfaceElevated: "rgba(58, 58, 60, .9)",
      surfaceCode: "rgba(18, 18, 20, .86)",
      textStrong: "#ffffff",
      placeholder: "#98989d",
      borderSubtle: "rgba(235, 235, 245, .14)",
      borderDefault: "rgba(235, 235, 245, .22)",
      borderStrong: "#0a84ff",
      action: "#0066cc",
      actionHover: "#007aff",
      actionPressed: "#0055aa",
      actionForeground: "#ffffff",
      hoverSurface: "rgba(10, 132, 255, .14)",
      pressedSurface: "rgba(10, 132, 255, .22)",
      selectedSurface: "rgba(10, 132, 255, .24)",
      selectedHoverSurface: "rgba(10, 132, 255, .32)",
      focusRing: "#0a84ff",
      link: "#64d2ff",
      danger: "#ff6961",
      success: "#30d158",
      warning: "#ffd60a",
      sidebarSurface: "rgba(18, 18, 20, .5)",
      headerSurface: "rgba(18, 18, 20, .4)",
      mainScrimStart: "rgba(0, 0, 0, .22)",
      mainScrimMid: "rgba(0, 0, 0, .11)",
      mainScrimEnd: "rgba(0, 0, 0, .03)",
      composerSurface: "rgba(28, 28, 30, .8)",
    }),
  }),
});

function alphaColor(value, alpha, fallback) {
  if (!/^#[0-9a-f]{6}$/i.test(value ?? "")) return fallback;
  const number = Number.parseInt(value.slice(1), 16);
  return `rgba(${number >> 16}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

function resolvedPalette(rawColors, rawSemanticColors, shell) {
  const base = SYSTEM_THEME_PALETTES[shell];
  const colors = { ...base.colors };
  for (const key of COLOR_KEYS) {
    if (Object.hasOwn(rawColors, key)) colors[key] = color(rawColors[key], colors[key]);
  }
  const semanticColors = { ...base.semanticColors };
  const derives = {
    surfaceBase: ["panel"],
    surfaceRaised: ["panelAlt"],
    surfaceElevated: ["panelAlt"],
    surfaceCode: ["background"],
    textStrong: ["text"],
    placeholder: ["muted"],
    borderSubtle: ["line"],
    borderDefault: ["line"],
    borderStrong: ["accent"],
    action: ["accent"],
    actionHover: ["accentAlt", "secondary"],
    actionPressed: ["highlight", "accent"],
    focusRing: ["accent"],
    link: ["secondary", "accent"],
  };
  for (const [semanticName, colorNames] of Object.entries(derives)) {
    const source = colorNames.find((name) => Object.hasOwn(rawColors, name));
    if (source) semanticColors[semanticName] = colors[source];
  }
  if (Object.hasOwn(rawColors, "highlight")) {
    semanticColors.selectedSurface = alphaColor(colors.highlight, 0.2, semanticColors.selectedSurface);
    semanticColors.selectedHoverSurface = alphaColor(colors.highlight, 0.3, semanticColors.selectedHoverSurface);
  }
  for (const key of SEMANTIC_COLOR_KEYS) {
    if (Object.hasOwn(rawSemanticColors, key)) {
      semanticColors[key] = color(rawSemanticColors[key], semanticColors[key]);
    }
  }
  return { colors, semanticColors };
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function assertAllowedObject(value, keys, name, label, optional = true) {
  if (value === undefined && optional) return null;
  const object = plainObject(value);
  if (!object) throw new Error(`${label} has an invalid ${name} field`);
  const unknown = Object.keys(object).filter((key) => !keys.has(key));
  if (unknown.length) throw new Error(`${label} ${name} contains unsupported fields: ${unknown.join(", ")}`);
  return object;
}

function text(value, fallback, max) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function color(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) || /^rgba?\([0-9., %]+\)$/i.test(normalized)
    ? normalized
    : fallback;
}

function boundedNumber(value, fallback, minimum, maximum) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function fontList(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const result = value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => /^[\p{L}\p{N} ._-]{1,80}$/u.test(item))
    .slice(0, 8);
  return result.length ? result : fallback;
}

function choice(value, name, choices, fallback, label) {
  const normalized = value ?? fallback;
  if (!choices.includes(normalized)) throw new Error(`${label} ${name} is invalid`);
  return normalized;
}

function unit(value, name, label) {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} ${name} must be a number from 0 to 1`);
  }
  return value;
}

function optionalMediaName(value, name, label) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} has an invalid optional ${name} field`);
  return value.trim();
}

function configuredNumber(value, fallback, minimum, maximum, name, label) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} ${name} must be a number from ${minimum} to ${maximum}`);
  }
  return value;
}

function configuredInteger(value, fallback, minimum, maximum, name, label) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} ${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function normalizeInteractiveBackground(value, backgroundVideo, label) {
  if (value === undefined || value === null) return null;
  const raw = plainObject(value);
  if (!raw) throw new Error(`${label} has an invalid interactiveBackground field`);
  if (backgroundVideo) throw new Error(`${label} interactiveBackground must not be combined with backgroundVideo`);

  if (raw.type === "ripple") {
    assertAllowedObject(raw, RIPPLE_BACKGROUND_KEYS, "interactiveBackground", label, false);
    return {
      type: "ripple",
      intensity: configuredNumber(raw.intensity, 0.35, 0, 1, "interactiveBackground.intensity", label),
      radiusPx: configuredNumber(raw.radiusPx, 24, 8, 96, "interactiveBackground.radiusPx", label),
      quality: choice(raw.quality, "interactiveBackground.quality", ["auto", "low", "high"], "auto", label),
      scrimOpacity: configuredNumber(raw.scrimOpacity, 0.16, 0, 0.8, "interactiveBackground.scrimOpacity", label),
    };
  }

  if (raw.type === "directional") {
    assertAllowedObject(raw, DIRECTIONAL_BACKGROUND_KEYS, "interactiveBackground", label, false);
    if (typeof raw.atlas !== "string" || !/^[A-Za-z0-9_.-]+\.webp$/i.test(raw.atlas)) {
      throw new Error(`${label} interactiveBackground.atlas must be a local static WebP filename`);
    }
    if (![8, 16, 32].includes(raw.directions)) {
      throw new Error(`${label} interactiveBackground.directions must be 8, 16, or 32`);
    }
    const columns = configuredInteger(raw.columns, null, 1, 8, "interactiveBackground.columns", label);
    const rows = configuredInteger(raw.rows, null, 1, 8, "interactiveBackground.rows", label);
    if (columns * rows !== raw.directions) {
      throw new Error(`${label} interactiveBackground columns × rows must equal directions`);
    }
    const idleFrame = configuredInteger(raw.idleFrame, 0, 0, raw.directions - 1, "interactiveBackground.idleFrame", label);
    const origin = raw.origin === undefined ? {}
      : assertAllowedObject(raw.origin, POSITION_KEYS, "interactiveBackground.origin", label, false);
    return {
      type: "directional",
      atlas: raw.atlas,
      directions: raw.directions,
      columns,
      rows,
      firstDirectionDegrees: configuredNumber(raw.firstDirectionDegrees, -90, -180, 180, "interactiveBackground.firstDirectionDegrees", label),
      idleFrame,
      origin: {
        xPercent: configuredNumber(origin.xPercent, 50, 0, 100, "interactiveBackground.origin.xPercent", label),
        yPercent: configuredNumber(origin.yPercent, 50, 0, 100, "interactiveBackground.origin.yPercent", label),
      },
      scrimOpacity: configuredNumber(raw.scrimOpacity, 0.16, 0, 0.8, "interactiveBackground.scrimOpacity", label),
    };
  }

  throw new Error(`${label} interactiveBackground.type must be ripple or directional`);
}

export function assertSkinThemeIdentity(value, label = "Theme config") {
  const theme = plainObject(value);
  if (!theme || theme.kind !== SKIN_THEME_KIND) {
    throw new Error(`${label} must use the ${SKIN_THEME_KIND} contract`);
  }
  if (Object.hasOwn(theme, "schemaVersion")) {
    throw new Error(`${label} must not use a numbered theme schema`);
  }
  const unknown = Object.keys(theme).filter((key) => !TOP_LEVEL_KEYS.has(key));
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}`);
  if (typeof theme.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(theme.id)) {
    throw new Error(`${label} id may contain only letters, numbers, underscores, and hyphens`);
  }
  if (typeof theme.image !== "string" || !theme.image.trim()) {
    throw new Error(`${label} requires a theme image`);
  }
  assertAllowedObject(theme.colors, COLOR_KEYS, "colors", label);
  assertAllowedObject(theme.semanticColors, SEMANTIC_COLOR_KEYS, "semanticColors", label);
  assertAllowedObject(theme.fonts, FONT_KEYS, "fonts", label);
  assertAllowedObject(theme.art, ART_KEYS, "art", label);
  const appearance = typeof theme.appearance === "string" ? null
    : assertAllowedObject(theme.appearance, APPEARANCE_KEYS, "appearance", label);
  if (appearance) {
    for (const position of ["backgroundPosition", "homeHeroPosition", "backgroundVideoPosition"]) {
      assertAllowedObject(appearance[position], POSITION_KEYS, `appearance.${position}`, label);
    }
  }
  normalizeInteractiveBackground(theme.interactiveBackground, theme.backgroundVideo, label);
  normalizeThemePetReference(theme.pet, theme.id, label);
  if (theme.presentation !== undefined) normalizePresentation(theme.presentation, `${label} presentation`);
  return theme;
}

export function themeMediaNames(value, label = "Theme config") {
  const theme = assertSkinThemeIdentity(value, label);
  const interactiveBackground = normalizeInteractiveBackground(theme.interactiveBackground, theme.backgroundVideo, label);
  return [
    theme.image.trim(),
    optionalMediaName(theme.homeHeroImage, "homeHeroImage", label),
    optionalMediaName(theme.backgroundVideo, "backgroundVideo", label),
    interactiveBackground?.type === "directional" ? interactiveBackground.atlas : null,
  ].filter(Boolean);
}

export function normalizeSkinTheme(value, label = "Theme config") {
  const raw = assertSkinThemeIdentity(value, label);
  const pet = normalizeThemePetReference(raw.pet, raw.id, label);
  const rawAppearance = raw.appearance === undefined ? {}
    : typeof raw.appearance === "string" ? {}
      : plainObject(raw.appearance);
  if (!rawAppearance) throw new Error(`${label} has an invalid appearance field`);
  const shellMode = typeof raw.appearance === "string" ? raw.appearance : rawAppearance.shellMode ?? "auto";
  if (!["auto", "light", "dark"].includes(shellMode)) {
    throw new Error(`${label} appearance shell mode must be auto, light, or dark`);
  }
  const rawArt = raw.art === undefined ? {} : plainObject(raw.art);
  if (!rawArt) throw new Error(`${label} has an invalid art field`);
  const homeHeroImage = optionalMediaName(raw.homeHeroImage, "homeHeroImage", label);
  const backgroundVideo = optionalMediaName(raw.backgroundVideo, "backgroundVideo", label);
  const interactiveBackground = normalizeInteractiveBackground(raw.interactiveBackground, backgroundVideo, label);
  const presentation = raw.presentation === undefined ? null : normalizePresentation(raw.presentation, `${label} presentation`);
  const configuredVideoPosterMode = rawAppearance.backgroundVideoPosterMode;
  if (configuredVideoPosterMode !== undefined && !["none", "image"].includes(configuredVideoPosterMode)) {
    throw new Error(`${label} appearance.backgroundVideoPosterMode must be "none" or "image"`);
  }
  if (configuredVideoPosterMode !== undefined && !backgroundVideo) {
    throw new Error(`${label} appearance.backgroundVideoPosterMode requires backgroundVideo`);
  }
  const configuredVideoScrimOpacity = rawAppearance.backgroundVideoScrimOpacity;
  if (configuredVideoScrimOpacity !== undefined &&
      (typeof configuredVideoScrimOpacity !== "number" || !Number.isFinite(configuredVideoScrimOpacity) ||
        configuredVideoScrimOpacity < 0 || configuredVideoScrimOpacity > 0.8)) {
    throw new Error(`${label} appearance.backgroundVideoScrimOpacity must be a number from 0 to 0.8`);
  }
  if (configuredVideoScrimOpacity !== undefined && !backgroundVideo) {
    throw new Error(`${label} appearance.backgroundVideoScrimOpacity requires backgroundVideo`);
  }
  const configuredNewTaskLayout = rawAppearance.newTaskLayout;
  if (configuredNewTaskLayout !== undefined && !["cards", "banner"].includes(configuredNewTaskLayout)) {
    throw new Error(`${label} appearance.newTaskLayout must be "cards" or "banner"`);
  }
  const newTaskLayout = configuredNewTaskLayout ?? (homeHeroImage ? "banner" : "cards");
  const rawColors = plainObject(raw.colors) ?? {};
  const rawSemanticColors = plainObject(raw.semanticColors) ?? {};
  const rawFonts = plainObject(raw.fonts) ?? {};
  const explicitColorKeys = Object.keys(rawColors).filter((key) => [
    "background", "panel", "panelAlt", "accent", "accentAlt", "secondary",
    "highlight", "text", "muted", "line",
  ].includes(key));
  const explicitSemanticColorKeys = Object.keys(rawSemanticColors).filter((key) => SEMANTIC_COLOR_KEYS.has(key));
  const configuredPaletteMode = rawArt.paletteMode;
  if (configuredPaletteMode !== undefined && !["system", "media"].includes(configuredPaletteMode)) {
    throw new Error(`${label} art.paletteMode must be system or media`);
  }
  if (configuredPaletteMode === "system" && rawArt.adaptivePalette === true) {
    throw new Error(`${label} art.paletteMode system conflicts with adaptivePalette true`);
  }
  const paletteMode = configuredPaletteMode ?? (rawArt.adaptivePalette === true || typeof raw.appearance === "string"
    ? "media" : "system");
  const resolvedPalettes = {
    light: resolvedPalette(rawColors, rawSemanticColors, "light"),
    dark: resolvedPalette(rawColors, rawSemanticColors, "dark"),
  };

  return {
    kind: SKIN_THEME_KIND,
    id: raw.id,
    name: text(raw.name, "CC Theme", 80),
    brandSubtitle: text(raw.brandSubtitle, "CC THEME", 80),
    tagline: text(raw.tagline, "Make something wonderful.", 160),
    projectPrefix: text(raw.projectPrefix, "选择项目 · ", 80),
    projectLabel: text(raw.projectLabel, "◉  选择项目", 80),
    statusText: text(raw.statusText, "SKIN ONLINE", 80),
    quote: text(raw.quote, "MAKE SOMETHING WONDERFUL", 80),
    image: raw.image.trim(),
    ...(homeHeroImage ? { homeHeroImage } : {}),
    ...(backgroundVideo ? { backgroundVideo } : {}),
    ...(interactiveBackground ? { interactiveBackground } : {}),
    ...(presentation ? { presentation } : {}),
    ...(pet ? { pet: {
      manifest: pet.manifest,
      spritesheet: pet.spritesheet,
      installPolicy: pet.installPolicy,
      selectionPolicy: pet.selectionPolicy,
    } } : {}),
    themeBridgeEnabled: true,
    backgroundRenderMode: interactiveBackground?.type ?? "media",
    shellMode,
    explicitColorKeys,
    explicitSemanticColorKeys,
    resolvedPalettes,
    colors: {
      ...resolvedPalettes.dark.colors,
    },
    semanticColors: {
      ...resolvedPalettes.dark.semanticColors,
    },
    fonts: {
      ui: fontList(rawFonts.ui, ["system-ui", "sans-serif"]),
      display: fontList(rawFonts.display, ["system-ui", "sans-serif"]),
      code: fontList(rawFonts.code, ["Menlo", "monospace"]),
    },
    art: {
      analysis: choice(rawArt.analysis, "art.analysis", ["auto", "off"], "auto", label),
      focusX: unit(rawArt.focusX, "art.focusX", label),
      focusY: unit(rawArt.focusY, "art.focusY", label),
      safeArea: choice(rawArt.safeArea, "art.safeArea", ["auto", "left", "right", "center", "none"], "auto", label),
      taskMode: choice(rawArt.taskMode, "art.taskMode", ["auto", "ambient", "banner", "off"], "auto", label),
      paletteMode,
      // Internal compatibility signal for older renderer/test integrations.
      adaptivePalette: paletteMode === "media",
    },
    appearance: {
      newTaskLayout,
      ...(backgroundVideo ? { backgroundVideoPosterMode: configuredVideoPosterMode ?? "none" } : {}),
      ...(backgroundVideo ? { backgroundVideoScrimOpacity: configuredVideoScrimOpacity ?? 0.16 } : {}),
      backgroundPositionExplicit: Object.hasOwn(rawAppearance, "backgroundPosition"),
      homeHeroPositionExplicit: Object.hasOwn(rawAppearance, "homeHeroPosition"),
      backgroundVideoPositionExplicit: Object.hasOwn(rawAppearance, "backgroundVideoPosition"),
      backgroundPosition: {
        xPercent: boundedNumber(rawAppearance.backgroundPosition?.xPercent, 70, 0, 100),
        yPercent: boundedNumber(rawAppearance.backgroundPosition?.yPercent, 50, 0, 100),
      },
      homeHeroPosition: {
        xPercent: boundedNumber(rawAppearance.homeHeroPosition?.xPercent, rawAppearance.backgroundPosition?.xPercent ?? 70, 0, 100),
        yPercent: boundedNumber(rawAppearance.homeHeroPosition?.yPercent, rawAppearance.backgroundPosition?.yPercent ?? 50, 0, 100),
      },
      backgroundVideoPosition: {
        xPercent: boundedNumber(rawAppearance.backgroundVideoPosition?.xPercent, rawAppearance.backgroundPosition?.xPercent ?? 70, 0, 100),
        yPercent: boundedNumber(rawAppearance.backgroundVideoPosition?.yPercent, rawAppearance.backgroundPosition?.yPercent ?? 50, 0, 100),
      },
      backdropBlurPx: boundedNumber(rawAppearance.backdropBlurPx, 18, 0, 48),
      backdropSaturation: boundedNumber(rawAppearance.backdropSaturation, 1, 0.5, 1.5),
      radiusScale: boundedNumber(rawAppearance.radiusScale, 1, 0.75, 1.5),
      reduceParticles: rawAppearance.reduceParticles === true,
    },
  };
}
