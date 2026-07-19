export const SKIN_THEME_KIND = "skin.theme";
export const SKIN_DOCUMENT_KIND = "skin.document";
export const SKIN_PACKAGE_KIND = "skin.package";
export const CC_THEME_FILE_EXTENSION = ".cctheme";
export const CC_THEME_MIME_TYPE = "application/vnd.cc-theme.theme+zip";
export const CC_THEME_CONTAINER = "zip";
export const MAC_WORKBUDDY_ADAPTER_ID = "mac-workbuddy";
export const MAC_WORKBUDDY_CONTRACT = SKIN_THEME_KIND;
export const MAC_WORKBUDDY_TARGET_PATH = "targets/macos-workbuddy/theme.json";

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
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

function optionalMediaName(value, field, label) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim() !== value || pathLike(value)) {
    throw new Error(`${label} ${field} must be a file in the theme directory`);
  }
  return value;
}

function pathLike(value) {
  return value.includes("/") || value.includes("\\") || value === "." || value === "..";
}

const RIPPLE_KEYS = new Set(["type", "intensity", "radiusPx", "quality", "scrimOpacity"]);
const DIRECTIONAL_KEYS = new Set([
  "type", "atlas", "directions", "columns", "rows", "firstDirectionDegrees", "idleFrame", "origin", "scrimOpacity",
]);
const TOP_LEVEL_KEYS = new Set([
  "kind", "id", "name", "image", "backgroundVideo", "interactiveBackground",
  "colors", "semanticColors", "fonts", "appearance",
]);
const COLOR_KEYS = new Set([
  "background", "panel", "panelAlt", "accent", "accentAlt", "secondary", "highlight", "text", "muted", "line",
]);
const SEMANTIC_COLOR_KEYS = new Set([
  "surfaceBase", "surfaceRaised", "surfaceElevated", "surfaceMuted", "textStrong", "textSecondary", "textDisabled",
  "iconPrimary", "iconMuted", "placeholder", "borderSubtle", "borderDefault", "divider", "action", "actionHover",
  "actionPressed", "actionForeground", "hoverSurface", "pressedSurface", "selectedSurface", "focusRing", "link",
  "sidebarSurface", "headerSurface", "mainScrimStart", "mainScrimMid", "mainScrimEnd", "composerSurface",
  "overlayScrim", "detailScrim", "shadowColor", "danger", "controlTrack", "controlTrackActive", "controlThumb",
]);
const FONT_KEYS = new Set(["ui", "display", "code"]);
const APPEARANCE_KEYS = new Set([
  "paletteStrategy", "shellMode", "backgroundPosition", "backgroundVideoPosterMode",
  "backgroundScrimOpacity", "backdropBlurPx", "backdropSaturation", "radiusScale",
]);

function rejectUnsupportedKeys(value, allowed, label) {
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key));
  if (unsupported.length) throw new Error(`${label} has unsupported fields: ${unsupported.join(", ")}`);
}

function requiredNumber(value, fallback, minimum, maximum, label) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a number from ${minimum} to ${maximum}`);
  }
  return value;
}

function requiredInteger(value, fallback, minimum, maximum, label) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function normalizePosition(value, fallback, label) {
  if (value === undefined) return fallback;
  const position = plainObject(value);
  if (!position) throw new Error(`${label} must be an object`);
  rejectUnsupportedKeys(position, new Set(["xPercent", "yPercent"]), label);
  if (!Object.hasOwn(position, "xPercent") || !Object.hasOwn(position, "yPercent")) {
    throw new Error(`${label} requires xPercent and yPercent`);
  }
  return {
    xPercent: requiredNumber(position.xPercent, 50, 0, 100, `${label}.xPercent`),
    yPercent: requiredNumber(position.yPercent, 50, 0, 100, `${label}.yPercent`),
  };
}

export function normalizeInteractiveBackground(value, backgroundVideo = null, label = "Theme config") {
  if (value === undefined || value === null) return null;
  if (backgroundVideo) throw new Error(`${label} interactiveBackground must not be combined with backgroundVideo`);
  const config = plainObject(value);
  if (!config) throw new Error(`${label} interactiveBackground must be an object`);
  if (config.type === "ripple") {
    rejectUnsupportedKeys(config, RIPPLE_KEYS, `${label} interactiveBackground`);
    if (config.quality !== undefined && !["auto", "low", "high"].includes(config.quality)) {
      throw new Error(`${label} interactiveBackground.quality must be auto, low, or high`);
    }
    return {
      type: "ripple",
      intensity: requiredNumber(config.intensity, 0.35, 0, 1, `${label} interactiveBackground.intensity`),
      radiusPx: requiredNumber(config.radiusPx, 24, 8, 96, `${label} interactiveBackground.radiusPx`),
      quality: config.quality ?? "auto",
      scrimOpacity: requiredNumber(config.scrimOpacity, 0.16, 0, 0.8, `${label} interactiveBackground.scrimOpacity`),
    };
  }
  if (config.type !== "directional") {
    throw new Error(`${label} interactiveBackground.type must be ripple or directional`);
  }
  rejectUnsupportedKeys(config, DIRECTIONAL_KEYS, `${label} interactiveBackground`);
  if (typeof config.atlas !== "string" || !/^[A-Za-z0-9_.-]+\.webp$/.test(config.atlas)) {
    throw new Error(`${label} interactiveBackground.atlas must be a local static WebP filename`);
  }
  if (![8, 16, 32].includes(config.directions)) {
    throw new Error(`${label} interactiveBackground.directions must be 8, 16, or 32`);
  }
  const columns = requiredInteger(config.columns, null, 1, 8, `${label} interactiveBackground.columns`);
  const rows = requiredInteger(config.rows, null, 1, 8, `${label} interactiveBackground.rows`);
  if (columns === null || rows === null || columns * rows !== config.directions) {
    throw new Error(`${label} interactiveBackground columns × rows must equal directions`);
  }
  const idleFrame = requiredInteger(config.idleFrame, 0, 0, 31, `${label} interactiveBackground.idleFrame`);
  if (idleFrame >= config.directions) {
    throw new Error(`${label} interactiveBackground.idleFrame must be smaller than directions`);
  }
  return {
    type: "directional",
    atlas: config.atlas,
    directions: config.directions,
    columns,
    rows,
    firstDirectionDegrees: requiredNumber(
      config.firstDirectionDegrees,
      -90,
      -180,
      180,
      `${label} interactiveBackground.firstDirectionDegrees`,
    ),
    idleFrame,
    origin: normalizePosition(
      config.origin,
      { xPercent: 50, yPercent: 50 },
      `${label} interactiveBackground.origin`,
    ),
    scrimOpacity: requiredNumber(config.scrimOpacity, 0.16, 0, 0.8, `${label} interactiveBackground.scrimOpacity`),
  };
}

export function themeMediaNames(value, label = "Theme config") {
  const theme = assertSkinThemeIdentity(value, label);
  const names = [theme.image];
  if (theme.backgroundVideo) names.push(optionalMediaName(theme.backgroundVideo, "backgroundVideo", label));
  const interactive = normalizeInteractiveBackground(theme.interactiveBackground, theme.backgroundVideo, label);
  if (interactive?.type === "directional") names.push(interactive.atlas);
  return [...new Set(names)];
}

export function assertSkinThemeIdentity(value, label = "Theme config") {
  const theme = plainObject(value);
  if (!theme || theme.kind !== SKIN_THEME_KIND) {
    throw new Error(`${label} must use the ${SKIN_THEME_KIND} contract`);
  }
  rejectUnsupportedKeys(theme, TOP_LEVEL_KEYS, label);
  if (Object.hasOwn(theme, "schemaVersion")) {
    throw new Error(`${label} must not use a numbered theme schema`);
  }
  if (typeof theme.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(theme.id)) {
    throw new Error(`${label} id may contain only letters, numbers, underscores, and hyphens`);
  }
  if (typeof theme.image !== "string" || !theme.image.trim()) {
    throw new Error(`${label} requires a theme image`);
  }
  if (theme.image.trim() !== theme.image || theme.image.includes("/") || theme.image.includes("\\")) {
    throw new Error(`${label} image must be a file in the theme directory`);
  }
  return theme;
}

export function normalizeSkinTheme(value, label = "Theme config") {
  const raw = assertSkinThemeIdentity(value, label);
  const rawColors = plainObject(raw.colors) ?? {};
  const semantic = plainObject(raw.semanticColors) ?? {};
  const fonts = plainObject(raw.fonts) ?? {};
  const appearance = raw.appearance === undefined ? {} : plainObject(raw.appearance);
  if (!appearance) throw new Error(`${label} has an invalid appearance field`);
  rejectUnsupportedKeys(rawColors, COLOR_KEYS, `${label} colors`);
  rejectUnsupportedKeys(semantic, SEMANTIC_COLOR_KEYS, `${label} semanticColors`);
  rejectUnsupportedKeys(fonts, FONT_KEYS, `${label} fonts`);
  rejectUnsupportedKeys(appearance, APPEARANCE_KEYS, `${label} appearance`);
  const paletteStrategy = appearance.paletteStrategy ?? "custom";
  if (!["system", "adaptive", "custom"].includes(paletteStrategy)) {
    throw new Error(`${label} appearance.paletteStrategy must be system, adaptive, or custom`);
  }
  const shellMode = appearance.shellMode ?? "auto";
  if (shellMode !== "auto") {
    throw new Error(`${label} appearance.shellMode must be auto because WorkBuddy host appearance is authoritative`);
  }
  const backgroundVideo = optionalMediaName(raw.backgroundVideo, "backgroundVideo", label);
  const interactiveBackground = normalizeInteractiveBackground(raw.interactiveBackground, backgroundVideo, label);
  const backgroundVideoPosterMode = appearance.backgroundVideoPosterMode ?? "image";
  if (!["none", "image"].includes(backgroundVideoPosterMode)) {
    throw new Error(`${label} appearance.backgroundVideoPosterMode must be none or image`);
  }
  if (!backgroundVideo && Object.hasOwn(appearance, "backgroundVideoPosterMode")) {
    throw new Error(`${label} appearance.backgroundVideoPosterMode requires backgroundVideo`);
  }

  return {
    kind: SKIN_THEME_KIND,
    adapter: MAC_WORKBUDDY_ADAPTER_ID,
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : "WorkBuddy Skin",
    image: raw.image,
    ...(backgroundVideo ? { backgroundVideo } : {}),
    ...(interactiveBackground ? { interactiveBackground } : {}),
    backgroundRenderMode: interactiveBackground?.type ?? "media",
    paletteStrategy,
    shellMode,
    colors: {
      background: color(rawColors.background, "#071116"),
      panel: color(rawColors.panel, "#0b1a20"),
      panelAlt: color(rawColors.panelAlt, "#10272c"),
      accent: color(rawColors.accent, "#7cff46"),
      accentAlt: color(rawColors.accentAlt, "#b8ff3d"),
      secondary: color(rawColors.secondary, "#36d7e8"),
      highlight: color(rawColors.highlight, "#642a8c"),
      text: color(rawColors.text, "#e9fff1"),
      muted: color(rawColors.muted, "#9ebdb3"),
      line: color(rawColors.line, "rgba(124, 255, 70, .28)"),
    },
    semanticColors: {
      surfaceBase: color(semantic.surfaceBase, rawColors.panel || "rgba(11, 26, 32, .84)"),
      surfaceRaised: color(semantic.surfaceRaised, rawColors.panelAlt || "rgba(16, 39, 44, .90)"),
      surfaceElevated: color(semantic.surfaceElevated, rawColors.panelAlt || "rgba(16, 39, 44, .96)"),
      surfaceMuted: color(semantic.surfaceMuted, "rgba(255, 255, 255, .08)"),
      textStrong: color(semantic.textStrong, rawColors.text || "#e9fff1"),
      textSecondary: color(semantic.textSecondary, rawColors.muted || "#9ebdb3"),
      textDisabled: color(semantic.textDisabled, "rgba(158, 189, 179, .58)"),
      iconPrimary: color(semantic.iconPrimary, rawColors.text || "#e9fff1"),
      iconMuted: color(semantic.iconMuted, rawColors.muted || "#9ebdb3"),
      placeholder: color(semantic.placeholder, rawColors.muted || "#9ebdb3"),
      borderSubtle: color(semantic.borderSubtle, rawColors.line || "rgba(124, 255, 70, .18)"),
      borderDefault: color(semantic.borderDefault, rawColors.line || "rgba(124, 255, 70, .28)"),
      divider: color(semantic.divider, rawColors.line || "rgba(124, 255, 70, .18)"),
      action: color(semantic.action, rawColors.highlight || rawColors.accent || "#7cff46"),
      actionHover: color(semantic.actionHover, rawColors.secondary || "#36d7e8"),
      actionPressed: color(semantic.actionPressed, rawColors.highlight || "#642a8c"),
      actionForeground: color(semantic.actionForeground, rawColors.text || "#e9fff1"),
      hoverSurface: color(semantic.hoverSurface, "rgba(124, 255, 70, .12)"),
      pressedSurface: color(semantic.pressedSurface, "rgba(124, 255, 70, .18)"),
      selectedSurface: color(semantic.selectedSurface, "rgba(100, 42, 140, .54)"),
      focusRing: color(semantic.focusRing, rawColors.accent || "#7cff46"),
      link: color(semantic.link, rawColors.secondary || "#36d7e8"),
      sidebarSurface: color(semantic.sidebarSurface, "rgba(7, 20, 25, .82)"),
      headerSurface: color(semantic.headerSurface, "rgba(8, 21, 27, .76)"),
      mainScrimStart: color(semantic.mainScrimStart, "rgba(4, 10, 17, .86)"),
      mainScrimMid: color(semantic.mainScrimMid, "rgba(6, 17, 24, .58)"),
      mainScrimEnd: color(semantic.mainScrimEnd, "rgba(8, 18, 25, .70)"),
      composerSurface: color(semantic.composerSurface, "rgba(8, 27, 30, .92)"),
      overlayScrim: color(semantic.overlayScrim, "rgba(0, 0, 0, .60)"),
      detailScrim: color(semantic.detailScrim, "rgba(0, 0, 0, .34)"),
      shadowColor: color(semantic.shadowColor, "#000000"),
      danger: color(semantic.danger, "#F64041"),
      controlTrack: color(semantic.controlTrack, "rgba(158, 189, 179, .30)"),
      controlTrackActive: color(semantic.controlTrackActive, semantic.action || rawColors.highlight || rawColors.accent || "#7cff46"),
      controlThumb: color(semantic.controlThumb, "#FFFFFF"),
    },
    fonts: {
      ui: fontList(fonts.ui, ["system-ui", "sans-serif"]),
      display: fontList(fonts.display, ["system-ui", "sans-serif"]),
      code: fontList(fonts.code, ["Menlo", "monospace"]),
    },
    appearance: {
      paletteStrategy,
      backgroundPosition: {
        xPercent: boundedNumber(appearance.backgroundPosition?.xPercent, 50, 0, 100),
        yPercent: boundedNumber(appearance.backgroundPosition?.yPercent, 50, 0, 100),
      },
      ...(backgroundVideo ? {
        backgroundVideoPosterMode,
      } : {}),
      backdropBlurPx: boundedNumber(appearance.backdropBlurPx, 18, 0, 48),
      backdropSaturation: boundedNumber(appearance.backdropSaturation, 1, 0.5, 1.5),
      radiusScale: boundedNumber(appearance.radiusScale, 1, 0.75, 1.5),
      backgroundScrimOpacity: boundedNumber(appearance.backgroundScrimOpacity, 1, 0, 1),
    },
  };
}
