(() => {
  "use strict";

  const CSS_TEXT = __WORKBUDDY_SKIN_CSS_JSON__;
  const ART_URL = __WORKBUDDY_SKIN_ART_JSON__;
  const VIDEO_URL = __WORKBUDDY_SKIN_VIDEO_JSON__;
  const INITIAL_INTERACTIVE_ATLAS_URL = __WORKBUDDY_SKIN_INTERACTIVE_ATLAS_JSON__;
  const createBackgroundEffect = __WORKBUDDY_SKIN_BACKGROUND_EFFECT_FACTORY__;
  const createUiInterpreter = __WORKBUDDY_SKIN_UI_INTERPRETER_FACTORY__;
  const createThemeSettingsSession = __WORKBUDDY_SKIN_THEME_SETTINGS_SESSION_FACTORY__;
  const createThemeSettingsLocale = __WORKBUDDY_SKIN_THEME_SETTINGS_LOCALE_FACTORY__;
  const createThemeSettingsColor = __WORKBUDDY_SKIN_THEME_SETTINGS_COLOR_FACTORY__;
  const THEME = __WORKBUDDY_SKIN_THEME_JSON__;
  const CATALOG = __WORKBUDDY_SKIN_CATALOG_JSON__;
  const STYLE_CATALOG = __WORKBUDDY_SKIN_STYLE_CATALOG_JSON__;
  const SETTINGS_LOCALES = __WORKBUDDY_SKIN_SETTINGS_LOCALES_JSON__;
  const INITIAL_THEME_SETTINGS = __WORKBUDDY_SKIN_THEME_SETTINGS_STATE_JSON__;
  const INITIAL_THEME_SETTINGS_DIAGNOSTICS = __WORKBUDDY_SKIN_THEME_SETTINGS_DIAGNOSTICS_JSON__;
  const THEME_SETTINGS_NONCE = __WORKBUDDY_SKIN_THEME_SETTINGS_NONCE_JSON__;
  const THEME_SETTINGS_BINDING = __WORKBUDDY_SKIN_THEME_SETTINGS_BINDING_JSON__;
  const VERSION = __WORKBUDDY_SKIN_VERSION_JSON__;
  const REVISION = __WORKBUDDY_SKIN_REVISION_JSON__;
  const STATE_KEY = "__WORKBUDDY_SKIN_STATE__";
  const STYLE_ID = "workbuddy-skin-style";
  const BACKGROUND_ID = "workbuddy-skin-background";
  const VIDEO_TOGGLE_ID = "workbuddy-skin-video-toggle";
  const INTERACTIVE_LAYER_ID = "workbuddy-skin-interactive-layer";
  const THEME_SETTINGS_NAV_ID = "workbuddy-cc-theme-settings-nav";
  const THEME_SETTINGS_PANEL_ID = "workbuddy-cc-theme-settings-panel";
  const GENERATION_COUNT_KEY = "__WORKBUDDY_SKIN_GENERATION_COUNT__";
  const THEME_SETTINGS_RESULT_KEY = "__WORKBUDDY_CC_THEME_SETTINGS_RESULT__";
  const DEFERRED_INTERACTIVE_ATLAS_SOURCE = "workbuddy-skin:deferred-interactive-atlas";
  const sceneStaticMotionPolicy = THEME.presentation?.fallbackPolicy?.reducedMotion === "static";
  const root = document.documentElement;
  const ROLE_ATTRIBUTE = CATALOG.interpreter?.roleAttribute || "data-workbuddy-skin-role";
  const uiInterpreter = createUiInterpreter({
    document,
    root,
    config: CATALOG.interpreter,
    styleCatalog: STYLE_CATALOG,
    roleAttribute: ROLE_ATTRIBUTE,
  });

  const settingsLocale = createThemeSettingsLocale({
    catalog: SETTINGS_LOCALES,
    readHostLocale: () => uiInterpreter.readHostLocale(),
  });
  const refreshSettingsLocaleSnapshot = () => settingsLocale.refresh();
  const resolveSettingsLocale = () => settingsLocale.locale();
  const settingsLocaleMetadata = () => settingsLocale.metadata();
  const settingsMessage = (key, replacements = {}) => settingsLocale.message(key, replacements);
  const themeSettingsColor = createThemeSettingsColor();

  const isWorkBuddy = () => uiInterpreter.matchesBootstrapHost();

  if (!isWorkBuddy()) return { installed: false, reason: "workbuddy-shell-not-found" };
  window.__WORKBUDDY_SKIN_DISABLED__ = false;

  const previous = window[STATE_KEY];
  if (previous?.revision === REVISION && previous?.videoUrl === VIDEO_URL) {
    previous.enforceSceneReducedMotion?.();
    previous.reconcile?.();
    return previous.inspect?.() ?? { installed: true, version: VERSION, revision: REVISION };
  }
  const persistedBackgroundPresentation = INITIAL_THEME_SETTINGS.backgroundPresentation;
  const samePreviousTheme = previous?.themeId === String(THEME.id);
  const previousVideoUserPaused = samePreviousTheme
    ? previous?.videoUserPaused === true : persistedBackgroundPresentation === "paused";
  const previousVideoMotionOverride = previous?.videoMotionOverride === true;
  const previousVideoDisabled = samePreviousTheme
    ? previous?.videoDisabled === true : persistedBackgroundPresentation === "disabled";
  const previousInteractiveEffectEnabled = samePreviousTheme
    ? previous?.interactiveEffectEnabled !== false : persistedBackgroundPresentation === "enabled";
  const previousThemeSettingsActive = previous?.themeSettingsActive === true;
  previous?.cleanup?.();
  const generationInstalledAt = performance.now();
  const generationInstalledEpochMs = Date.now();
  const generationInstallCount = Number(window[GENERATION_COUNT_KEY] ?? 0) + 1;
  window[GENERATION_COUNT_KEY] = generationInstallCount;

  const fontCss = (families) => families.map((family) => {
    if (["serif", "sans-serif", "monospace", "system-ui"].includes(family)) return family;
    return `"${family.replaceAll("\\", "").replaceAll('"', "")}"`;
  }).join(", ");
  const interactiveBackground = THEME.interactiveBackground &&
    ["ripple", "directional"].includes(THEME.interactiveBackground.type)
    ? THEME.interactiveBackground : null;
  const backgroundRenderMode = interactiveBackground?.type ?? "media";
  const interactiveEnabled = Boolean(interactiveBackground);
  let activePaletteStrategy = INITIAL_THEME_SETTINGS.paletteStrategy;
  const nativeShellMode = () => document.body?.classList.contains("dark")
    || document.body?.classList.contains("cb-dark")
    || document.body?.classList.contains("vscode-dark") ? "dark" : "light";
  const nativeMode = nativeShellMode();
  const fallbackForMode = (mode) => mode === "dark" ? {
    canvas: "#1E1E1E",
    surface: "#242424",
    sidebar: "#202020",
    text: "rgba(255, 255, 255, .90)",
    textSecondary: "rgba(255, 255, 255, .70)",
    textMuted: "rgba(255, 255, 255, .50)",
    textDisabled: "rgba(255, 255, 255, .30)",
    borderWeak: "rgba(255, 255, 255, .10)",
    border: "rgba(255, 255, 255, .16)",
    selected: "rgba(255, 255, 255, .12)",
    link: "#72B7F2",
    danger: "#FF777D",
  } : {
    canvas: "#FAFAFA",
    surface: "#FFFFFF",
    sidebar: "#F2F2F2",
    text: "rgba(0, 0, 0, .90)",
    textSecondary: "rgba(0, 0, 0, .70)",
    textMuted: "rgba(0, 0, 0, .50)",
    textDisabled: "rgba(0, 0, 0, .30)",
    borderWeak: "rgba(0, 0, 0, .08)",
    border: "rgba(0, 0, 0, .14)",
    selected: "rgba(0, 0, 0, .08)",
    link: "#1470B4",
    danger: "#F64041",
  };
  const nativeColor = (name, fallbackValue) =>
    getComputedStyle(root).getPropertyValue(name).trim() || fallbackValue;
  const nativeMix = (name, fallbackValue, opacity) =>
    `color-mix(in srgb, ${nativeColor(name, fallbackValue)} ${opacity}%, transparent)`;
  const paletteFromTheme = (theme) => ({
    background: theme.colors.background,
    panel: theme.colors.panel,
    panelAlt: theme.colors.panelAlt,
    accent: theme.colors.accent,
    accentAlt: theme.colors.accentAlt,
    secondary: theme.colors.secondary,
    highlight: theme.colors.highlight,
    text: theme.colors.text,
    textStrong: theme.semanticColors.textStrong,
    textSecondary: theme.semanticColors.textSecondary,
    textMuted: theme.colors.muted,
    textDisabled: theme.semanticColors.textDisabled,
    icon: theme.semanticColors.iconPrimary,
    iconMuted: theme.semanticColors.iconMuted,
    placeholder: theme.semanticColors.placeholder,
    line: theme.colors.line,
    borderSubtle: theme.semanticColors.borderSubtle,
    border: theme.semanticColors.borderDefault,
    surface: theme.semanticColors.surfaceBase,
    surfaceRaised: theme.semanticColors.surfaceRaised,
    surfaceElevated: theme.semanticColors.surfaceElevated,
    surfaceMuted: theme.semanticColors.surfaceMuted,
    action: theme.semanticColors.action,
    actionHover: theme.semanticColors.actionHover,
    actionPressed: theme.semanticColors.actionPressed,
    actionForeground: theme.semanticColors.actionForeground,
    hover: theme.semanticColors.hoverSurface,
    pressed: theme.semanticColors.pressedSurface,
    selected: theme.semanticColors.selectedSurface,
    focus: theme.semanticColors.focusRing,
    link: theme.semanticColors.link,
    sidebar: theme.semanticColors.sidebarSurface,
    header: theme.semanticColors.headerSurface,
    mainScrimStart: theme.semanticColors.mainScrimStart,
    mainScrimMid: theme.semanticColors.mainScrimMid,
    mainScrimEnd: theme.semanticColors.mainScrimEnd,
    composer: theme.semanticColors.composerSurface,
    overlayScrim: theme.semanticColors.overlayScrim,
    detailScrim: theme.semanticColors.detailScrim,
    shadowColor: theme.semanticColors.shadowColor,
    danger: theme.semanticColors.danger,
    divider: theme.semanticColors.divider,
    controlTrack: theme.semanticColors.controlTrack,
    controlTrackActive: theme.semanticColors.controlTrackActive,
    controlThumb: theme.semanticColors.controlThumb,
  });
  const customPaletteFor = (mode) => paletteFromTheme(THEME.appearanceVariants?.[mode] ?? THEME);
  const customPalette = customPaletteFor(nativeMode);
  const systemPaletteFor = (mode) => {
    const fallback = fallbackForMode(mode);
    return {
    background: nativeColor("--wb-home-bg-primary", fallback.canvas),
    panel: nativeMix("--wb-bg-primary", fallback.surface, 28),
    panelAlt: nativeMix("--wb-bg-secondary", fallback.surface, 48),
    accent: nativeColor("--wb-color-text-primary", fallback.text),
    accentAlt: nativeColor("--wb-color-text-secondary", fallback.textSecondary),
    secondary: nativeColor("--wb-color-text-secondary", fallback.textSecondary),
    highlight: nativeColor("--wb-bg-active", fallback.selected),
    text: nativeColor("--wb-color-text-primary", fallback.text),
    textStrong: nativeColor("--wb-color-text-primary", fallback.text),
    textSecondary: nativeColor("--wb-color-text-secondary", fallback.textSecondary),
    textMuted: nativeColor("--wb-color-text-tertiary", fallback.textMuted),
    textDisabled: fallback.textDisabled,
    icon: nativeColor("--wb-color-text-primary", fallback.text),
    iconMuted: nativeColor("--wb-color-text-secondary", fallback.textSecondary),
    placeholder: nativeColor("--wb-color-text-tertiary", fallback.textMuted),
    line: nativeColor("--wb-border-default", fallback.borderWeak),
    borderSubtle: nativeColor("--wb-border-weak", fallback.borderWeak),
    border: nativeColor("--wb-border-default", fallback.border),
    surface: nativeMix("--wb-bg-primary", fallback.surface, 28),
    surfaceRaised: nativeMix("--wb-bg-secondary", fallback.surface, 52),
    surfaceElevated: nativeMix("--wb-bg-primary", fallback.surface, 78),
    surfaceMuted: nativeMix("--wb-bg-active", fallback.selected, 54),
    action: nativeColor("--wb-color-text-primary", fallback.text),
    actionHover: nativeColor("--wb-color-text-secondary", fallback.textSecondary),
    actionPressed: nativeColor("--wb-color-text-primary", fallback.text),
    actionForeground: nativeColor("--wb-bg-primary", fallback.surface),
    hover: nativeColor("--wb-bg-hover", fallback.selected),
    pressed: nativeColor("--wb-bg-active", fallback.selected),
    selected: nativeColor("--wb-bg-active", fallback.selected),
    focus: nativeColor("--wb-border-strong", fallback.textSecondary),
    link: fallback.link,
    sidebar: nativeMix("--wb-sidebar-bg", fallback.sidebar, 56),
    header: nativeMix("--wb-bg-primary", fallback.surface, 48),
    mainScrimStart: "transparent",
    mainScrimMid: "transparent",
    mainScrimEnd: "transparent",
    composer: nativeMix("--wb-bg-primary", fallback.surface, 68),
    overlayScrim: mode === "dark" ? "rgba(0, 0, 0, .36)" : "rgba(0, 0, 0, .24)",
    detailScrim: mode === "dark" ? "rgba(0, 0, 0, .26)" : "rgba(0, 0, 0, .16)",
    shadowColor: "#000000",
    danger: fallback.danger,
    divider: nativeColor("--wb-border-default", fallback.borderWeak),
    controlTrack: nativeColor("--wb-bg-active", fallback.selected),
    controlTrackActive: nativeColor("--wb-color-text-primary", fallback.text),
    controlThumb: nativeColor("--wb-bg-primary", fallback.surface),
    };
  };
  const baseLayout = {
      fontUi: fontCss(THEME.fonts.ui),
      fontDisplay: fontCss(THEME.fonts.display),
      fontCode: fontCss(THEME.fonts.code),
      backgroundX: `${THEME.appearance.backgroundPosition.xPercent}%`,
      backgroundY: `${THEME.appearance.backgroundPosition.yPercent}%`,
      blur: `${THEME.appearance.backdropBlurPx}px`,
      saturation: String(THEME.appearance.backdropSaturation),
      radiusScale: String(THEME.appearance.radiusScale),
      interactiveScrim: String(Math.min(0.8, Math.max(0, Number(interactiveBackground?.scrimOpacity) || 0))),
      backgroundScrimOpacity: String(THEME.appearance.backgroundScrimOpacity),
      videoControlSize: "32px",
  };
  const customHostBridge = {
      homePrimary: "transparent",
      homeSecondary: "var(--wbs-surface)",
      sidebarBackground: "var(--wbs-sidebar)",
      backgroundPrimary: "var(--wbs-surface)",
      backgroundSecondary: "var(--wbs-surface-raised)",
      backgroundTertiary: "var(--wbs-surface-muted)",
      backgroundHover: "var(--wbs-hover)",
      backgroundActive: "var(--wbs-selected)",
      textPrimary: "var(--wbs-text)",
      textSecondary: "var(--wbs-text-secondary)",
      textTertiary: "var(--wbs-muted)",
      borderDefault: "var(--wbs-border-subtle)",
      borderWeak: "var(--wbs-border-subtle)",
      borderStrong: "var(--wbs-border)",
      shadowPopover: "var(--wbs-shadow-popover)",
      shadowInput: "var(--wbs-shadow-input)",
      cbTextPrimary: "var(--wbs-text)",
      cbTextTertiary: "var(--wbs-muted)",
      cbPanelBorder: "var(--wbs-border-subtle)",
      cbMainBackground: "transparent",
      cbMainBorder: "var(--wbs-border)",
      cbMainShadow: "var(--wbs-shadow-input)",
      cbPopoverBackground: "var(--wbs-surface-elevated)",
      cbPopoverBorder: "var(--wbs-border-subtle)",
      cbPopoverShadow: "var(--wbs-shadow-popover)",
  };
  const settingsControls = Array.isArray(STYLE_CATALOG.settingsControls) ? STYLE_CATALOG.settingsControls : [];
  const settingsControlsById = new Map(settingsControls.map((control) => [control.id, control]));
  const styleBindingsById = new Map((STYLE_CATALOG.bindings || []).map((binding) => [binding.id, binding]));
  const setSourcePath = (target, dottedPath, value) => {
    const parts = String(dottedPath).split(".");
    let cursor = target;
    for (const part of parts.slice(0, -1)) {
      if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
      cursor = cursor[part];
    }
    cursor[parts.at(-1)] = value;
  };
  const serializeControlValue = (control, value) => {
    if (control.type === "fontList") return fontCss(value);
    if (control.type === "number") return `${value}${control.unit}`;
    return String(value);
  };
  const validateThemeSettingsState = (value) => {
    const state = value && typeof value === "object" && !Array.isArray(value) ? value : null;
    const allowedKeys = new Set(["themeId", "paletteStrategy", "backgroundPresentation", "values"]);
    if (!state || Object.keys(state).some((key) => !allowedKeys.has(key)) || state.themeId !== THEME.id ||
        !["system", "adaptive", "custom"].includes(state.paletteStrategy) ||
        !["enabled", "paused", "disabled"].includes(state.backgroundPresentation) ||
        !state.values || typeof state.values !== "object" || Array.isArray(state.values)) {
      throw new Error("Invalid theme settings state");
    }
    const values = {};
    for (const [id, raw] of Object.entries(state.values)) {
      const control = settingsControlsById.get(id);
      if (!control?.binding && !control?.bindings) throw new Error(`Unknown theme setting: ${id}`);
      if (control.type === "color") {
        const normalized = themeSettingsColor.normalize(raw);
        if (!normalized) throw new Error(`Invalid color: ${id}`);
        values[id] = normalized.value;
      } else if (control.type === "fontList") {
        const families = Array.isArray(raw) ? raw.map((family) => typeof family === "string" ? family.trim() : family) : raw;
        if (!Array.isArray(families) || !families.length || families.length > 8 ||
            families.some((family) => typeof family !== "string" || !/^[\p{L}\p{N} _-]{1,64}$/u.test(family) ||
              !/[\p{L}\p{N}]/u.test(family))) {
          throw new Error(`Invalid font list: ${id}`);
        }
        values[id] = families;
      } else if (control.type === "number") {
        const number = Number(raw);
        if (!Number.isFinite(number) || number < control.minimum || number > control.maximum) {
          throw new Error(`Invalid number: ${id}`);
        }
        values[id] = number;
      } else if (control.type === "position") {
        const position = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
        const xPercent = Number(position?.xPercent);
        const yPercent = Number(position?.yPercent);
        if (!position || Object.keys(position).length !== 2 ||
            ![xPercent, yPercent].every((number) => Number.isFinite(number) &&
              number >= control.minimum && number <= control.maximum)) {
          throw new Error(`Invalid position: ${id}`);
        }
        values[id] = { xPercent, yPercent };
      }
    }
    return {
      themeId: THEME.id,
      paletteStrategy: state.paletteStrategy,
      backgroundPresentation: state.backgroundPresentation,
      values,
    };
  };
  const styleSourcesForSettings = (settings, mode = nativeShellMode()) => {
    const system = settings.paletteStrategy === "system";
    const sources = {
      palette: { ...(system ? systemPaletteFor(mode) : customPaletteFor(mode)) },
      layout: { ...baseLayout },
      host: system ? {} : { ...customHostBridge },
    };
    for (const [id, value] of Object.entries(settings.values)) {
      const control = settingsControlsById.get(id);
      if (!control ||
          (Array.isArray(control.paletteStrategies) && !control.paletteStrategies.includes(settings.paletteStrategy))) continue;
      if (control.type === "position") {
        const axes = ["xPercent", "yPercent"];
        for (const [index, bindingId] of control.bindings.entries()) {
          const binding = styleBindingsById.get(bindingId);
          if (binding?.source) setSourcePath(sources, binding.source, `${value[axes[index]]}${control.unit}`);
        }
        continue;
      }
      const binding = styleBindingsById.get(control.binding);
      if (!binding?.source) continue;
      setSourcePath(sources, binding.source, serializeControlValue(control, value));
    }
    return sources;
  };
  const backgroundPositionForSettings = (settings) =>
    settings.values["media.backgroundPosition"] ?? THEME.appearance.backgroundPosition;
  let currentThemeSettings = validateThemeSettingsState(INITIAL_THEME_SETTINGS);
  const applyThemeSettingsStyles = (settings) => {
    currentThemeSettings = validateThemeSettingsState(settings);
    activePaletteStrategy = currentThemeSettings.paletteStrategy;
    uiInterpreter.applyStyleSources(styleSourcesForSettings(currentThemeSettings), { resetMissing: true });
    root.dataset.workbuddySkinPalette = activePaletteStrategy;
  };

  applyThemeSettingsStyles(currentThemeSettings);
  root.classList.add("workbuddy-skin");
  root.dataset.workbuddySkinVersion = VERSION;
  root.dataset.workbuddySkinTheme = THEME.id;
  const sceneBackdrop = THEME.presentation?.profileId === "immersive-scene-v1"
    ? THEME.presentation.assetSlots["scene.backdrop"] : null;
  let scenePresentationCss = "";
  if (THEME.presentation?.profileId === "immersive-scene-v1") {
    const scene = THEME.presentation.parameters;
    if (sceneBackdrop !== THEME.image) throw new Error("Immersive scene backdrop must bind the theme image");
    const sceneNumber = (value, minimum, maximum, name) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`Invalid immersive scene ${name}`);
      }
      return Number(value.toFixed(3)).toString();
    };
    const textureIntensity = sceneNumber(scene.textureIntensity, 0, 1, "textureIntensity");
    const surfaceOpacity = sceneNumber(scene.surfaceOpacity, 0, 1, "surfaceOpacity");
    const surfacePercent = Number(scene.surfaceOpacity * 100).toFixed(1).replace(/\.0$/, "");
    root.dataset.workbuddySkinPresentation = "immersive-scene-v1";
    root.dataset.workbuddySkinSceneDensity = scene.density;
    root.dataset.workbuddySkinSceneBorderTreatment = scene.borderTreatment;
    root.dataset.workbuddySkinSceneBackdrop = sceneBackdrop;
    root.dataset.workbuddySkinSceneTextureIntensity = textureIntensity;
    root.dataset.workbuddySkinSceneSurfaceOpacity = surfaceOpacity;
    root.dataset.workbuddySkinSceneNavigationTreatment = scene.navigationTreatment;
    root.dataset.workbuddySkinSceneComposerTreatment = scene.composerTreatment;
    root.dataset.workbuddySkinSceneCardTreatment = scene.cardTreatment;
    scenePresentationCss = `html.workbuddy-skin[data-workbuddy-skin-presentation="immersive-scene-v1"] {\n` +
      `  --cc-theme-scene-density-tracking: .01em;\n` +
      `  --cc-theme-scene-etched-line: color-mix(in srgb, #c8a55a 36%, transparent);\n` +
      `  --cc-theme-scene-texture-alpha: ${textureIntensity};\n` +
      `  --cc-theme-scene-content-opacity: ${surfacePercent}%;\n` +
      `  --cc-theme-scene-surface-layer: color-mix(in srgb, var(--wbs-surface-raised) ${surfacePercent}%, transparent);\n` +
      `  --cc-theme-scene-navigation-frame: color-mix(in srgb, #c8a55a 44%, transparent);\n` +
      `  --cc-theme-scene-composer-anchor: linear-gradient(90deg, color-mix(in srgb, #c8a55a 18%, transparent), transparent 42%);\n` +
      `  --cc-theme-scene-card-elevation: linear-gradient(140deg, rgba(200, 165, 90, var(--cc-theme-scene-texture-alpha)), transparent 38%);\n` +
      `}`;
  } else {
    delete root.dataset.workbuddySkinPresentation;
    delete root.dataset.workbuddySkinSceneDensity;
    delete root.dataset.workbuddySkinSceneBorderTreatment;
    delete root.dataset.workbuddySkinSceneBackdrop;
    delete root.dataset.workbuddySkinSceneTextureIntensity;
    delete root.dataset.workbuddySkinSceneSurfaceOpacity;
    delete root.dataset.workbuddySkinSceneNavigationTreatment;
    delete root.dataset.workbuddySkinSceneComposerTreatment;
    delete root.dataset.workbuddySkinSceneCardTreatment;
  }
  root.dataset.workbuddySkinMode = THEME.shellMode;
  root.dataset.workbuddySkinPalette = activePaletteStrategy;
  root.dataset.workbuddySkinNativeMode = nativeMode;
  root.dataset.workbuddySkinBackgroundMode = backgroundRenderMode;
  root.dataset.workbuddySkinVideo = VIDEO_URL ? "enabled" : "disabled";
  root.dataset.workbuddySkinVideoState = VIDEO_URL
    ? previousVideoDisabled ? "disabled" : previousVideoUserPaused ? "paused" : "loading"
    : interactiveEnabled ? "enabled" : "unavailable";
  if (interactiveEnabled) root.dataset.workbuddySkinInteractiveState = "loading";

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.dataset.workbuddySkinOwned = "true";
  style.textContent = CSS_TEXT;
  (document.head || root).append(style);
  if (scenePresentationCss) {
    const presentationStyle = document.createElement("style");
    presentationStyle.dataset.workbuddySkinOwned = "true";
    presentationStyle.dataset.workbuddySkinPresentation = "immersive-scene-v1";
    presentationStyle.textContent = scenePresentationCss;
    (document.head || root).append(presentationStyle);
  }

  const background = document.createElement("div");
  background.id = BACKGROUND_ID;
  background.dataset.workbuddySkinOwned = "true";
  background.setAttribute("aria-hidden", "true");
  const artwork = document.createElement("img");
  artwork.id = "workbuddy-skin-background-art";
  artwork.alt = "";
  artwork.draggable = false;
  artwork.src = ART_URL;
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  let backgroundVideo = null;
  let videoFirstFrameMs = null;
  let videoPlayingMs = null;
  let videoToggle = null;
  let videoUserPaused = previousVideoUserPaused;
  let videoMotionOverride = sceneStaticMotionPolicy ? false : previousVideoMotionOverride;
  let videoDisabled = previousVideoDisabled;
  let videoPlaybackEpoch = 0;
  let videoTransport = VIDEO_URL ? "rejected" : "none";
  let videoTransportDiagnostic = null;
  let videoObjectUrl = null;
  let videoFallbackStarted = false;
  const videoFallbackAbortController = new AbortController();
  let interactiveLayer = null;
  let interactiveController = null;
  let interactiveAtlasUrl = INITIAL_INTERACTIVE_ATLAS_URL !== DEFERRED_INTERACTIVE_ATLAS_SOURCE
    ? INITIAL_INTERACTIVE_ATLAS_URL : null;
  let interactiveEffectEnabled = previousInteractiveEffectEnabled;
  let interactiveFatalFallback = false;
  let interactiveRuntimeState = interactiveEnabled ? "loading" : null;
  let themeSettingsActive = previousThemeSettingsActive;
  let themeSettingsSession = null;
  let applyBackgroundPresentation = () => {};
  let refreshThemeSettingsControls = () => {};
  let tryThemeSettingsUpdate = () => false;
  let lastNativeSettingsNav = null;
  let updateThemeSettingsBackgroundControl = () => {};
  const reducedMotionActive = () => motionPreference.matches && (sceneStaticMotionPolicy || !videoMotionOverride);
  const trustedVideoResource = (() => {
    if (!VIDEO_URL) return null;
    try {
      const parsed = new URL(VIDEO_URL);
      const port = Number(parsed.port);
      const version = /^(\d{1,10})-(\d{1,16})$/.exec(parsed.searchParams.get("v") ?? "");
      const size = Number(version?.[1]);
      return parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" &&
        Number.isInteger(port) && port >= 1024 && port <= 65535 &&
        /^\/[a-f0-9]{48}\/background\.mp4$/.test(parsed.pathname) &&
        Number.isSafeInteger(size) && size >= 16 && size <= 536870912 && version
        ? { url: parsed.href, size } : null;
    } catch {
      return null;
    }
  })();
  const trustedVideoUrl = trustedVideoResource?.url ?? null;
  if (trustedVideoUrl) videoTransport = "loopback-range";

  const updateVideoStateObject = () => {
    const state = window[STATE_KEY];
    if (!state) return;
    state.videoUserPaused = videoUserPaused;
    state.videoMotionOverride = videoMotionOverride;
    state.videoDisabled = videoDisabled;
  };

  const updateVideoToggle = () => {
    const toggle = videoToggle || document.getElementById(VIDEO_TOGGLE_ID);
    if (!toggle) return;
    if (interactiveEnabled) {
      const active = interactiveRuntimeState === "enabled";
      const failed = interactiveRuntimeState === "fallback";
      const reduced = motionPreference.matches;
      const toggleState = active ? "playing" : failed ? "error" : "paused";
      toggle.dataset.playbackState = toggleState;
      toggle.setAttribute("aria-pressed", active ? "true" : "false");
      toggle.disabled = failed;
      const label = failed ? settingsMessage("interactiveUnavailableAria") :
        reduced ? settingsMessage("interactiveReducedAria") :
        interactiveEffectEnabled ? settingsMessage("pauseInteractiveAria") : settingsMessage("enableInteractiveAria");
      toggle.setAttribute("aria-label", label);
      toggle.setAttribute("title", label);
      const iconPath = toggle.querySelector("path");
      if (iconPath) iconPath.setAttribute("d", active
        ? "M7 5h4v14H7zM13 5h4v14h-4z"
        : "M8 5v14l11-7Z");
      updateThemeSettingsBackgroundControl();
      return;
    }
    const state = backgroundVideo?.dataset.playbackState || "paused";
    const active = state === "playing" || state === "loading";
    const reduced = state === "reduced-motion";
    const disabled = state === "disabled";
    const failed = state === "error";
    toggle.dataset.playbackState = state;
    toggle.setAttribute("aria-pressed", active ? "true" : "false");
    toggle.disabled = failed || !backgroundVideo;
    const label = failed ? settingsMessage("videoUnavailableAria") :
      disabled ? settingsMessage("enableVideoAria") :
      reduced ? settingsMessage("videoReducedAria") :
      active ? settingsMessage("pauseVideoAria") : settingsMessage("disableVideoAria");
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
    const iconPath = toggle.querySelector("path");
    if (iconPath) iconPath.setAttribute("d", active
      ? "M7 5h4v14H7zM13 5h4v14h-4z"
      : state === "paused"
        ? "M4.27 3 21 19.73 19.73 21l-3-3H5a2 2 0 0 1-2-2V6c0-.3.07-.58.18-.83L3 5l1.27-2ZM5 7.27V16h9.73L5 7.27ZM21 7v10l-4-4V8l4-4v3ZM7.27 4H17v9.73L7.27 4Z"
        : "M8 5v14l11-7Z");
    updateThemeSettingsBackgroundControl();
  };

  const findFlowAction = () => {
    const node = uiInterpreter.anchor("videoToggle");
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const computed = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && computed.display !== "none" && computed.visibility !== "hidden"
      ? node : null;
  };

  const cycleBackgroundPresentation = () => {
    if (!backgroundVideo && !interactiveEnabled) return;
    const current = currentThemeSettings.backgroundPresentation;
    const next = current === "enabled" ? "paused" : current === "paused" ? "disabled" : "enabled";
    if (themeSettingsSession) tryThemeSettingsUpdate({ backgroundPresentation: next }, { immediate: true });
    else applyBackgroundPresentation(next);
  };

  const ensureVideoToggle = () => {
    const flowAction = findFlowAction();
    if ((!VIDEO_URL && !interactiveEnabled) || !flowAction) {
      videoToggle?.remove();
      videoToggle = null;
      return;
    }
    if (!videoToggle) {
      videoToggle = document.createElement("button");
      videoToggle.id = VIDEO_TOGGLE_ID;
      videoToggle.type = "button";
      videoToggle.dataset.workbuddySkinOwned = "true";
      uiInterpreter.markRole(videoToggle, "video-playback-control");
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      icon.setAttribute("fill", "currentColor");
      icon.append(document.createElementNS("http://www.w3.org/2000/svg", "path"));
      videoToggle.append(icon);
      videoToggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        cycleBackgroundPresentation();
      });
    }
    if (videoToggle.className !== flowAction.className) videoToggle.className = flowAction.className;
    const flowRect = flowAction.getBoundingClientRect();
    uiInterpreter.setStyleValue("media.videoControlSize", `${Math.round(flowRect.width)}px`);
    if (videoToggle.parentElement !== flowAction.parentElement || videoToggle.nextElementSibling !== flowAction) {
      flowAction.parentElement.insertBefore(videoToggle, flowAction);
    }
    updateVideoToggle();
  };

  const syncVideoPlayback = () => {
    if (!backgroundVideo) return;
    const playbackEpoch = ++videoPlaybackEpoch;
    if (videoDisabled) {
      backgroundVideo.pause();
      backgroundVideo.hidden = true;
      backgroundVideo.dataset.playbackState = "disabled";
      root.dataset.workbuddySkinVideoState = "disabled";
      updateVideoToggle();
      return;
    }
    backgroundVideo.hidden = false;
    const reduced = reducedMotionActive();
    const shouldPlay = !document.hidden && !videoUserPaused && !reduced;
    if (!shouldPlay) {
      backgroundVideo.pause();
      backgroundVideo.dataset.playbackState = reduced ? "reduced-motion" : "paused";
      root.dataset.workbuddySkinVideoState = backgroundVideo.dataset.playbackState;
      updateVideoToggle();
      return;
    }
    if (!backgroundVideo.paused && !backgroundVideo.ended) {
      backgroundVideo.dataset.playbackState = "playing";
      root.dataset.workbuddySkinVideoState = "playing";
      updateVideoToggle();
      return;
    }
    backgroundVideo.dataset.playbackState = "loading";
    root.dataset.workbuddySkinVideoState = "loading";
    updateVideoToggle();
    Promise.resolve(backgroundVideo.play()).then(() => {
      if (playbackEpoch !== videoPlaybackEpoch) return;
      backgroundVideo.dataset.playbackState = "playing";
      root.dataset.workbuddySkinVideoState = "playing";
      updateVideoToggle();
    }).catch(() => {
      if (playbackEpoch !== videoPlaybackEpoch) return;
      backgroundVideo.dataset.playbackState = "paused";
      root.dataset.workbuddySkinVideoState = "paused";
      updateVideoToggle();
    });
  };
  const handleMotionPreferenceChange = () => {
    videoMotionOverride = false;
    updateVideoStateObject();
    syncVideoPlayback();
    interactiveController?.setEnabled?.(interactiveEffectEnabled);
    syncInteractivePresentation();
  };
  const failVideoPlayback = () => {
    if (!backgroundVideo) return;
    backgroundVideo.dataset.ready = "false";
    backgroundVideo.dataset.playbackState = "error";
    root.dataset.workbuddySkinVideoState = "error";
    updateVideoToggle();
  };
  const startTrustedBlobFallback = async () => {
    if (!backgroundVideo || !trustedVideoResource || videoFallbackStarted) return;
    videoFallbackStarted = true;
    videoTransport = "blob-fallback";
    videoTransportDiagnostic = "direct-media-source-unsupported";
    backgroundVideo.dataset.ready = "false";
    backgroundVideo.dataset.playbackState = "loading";
    root.dataset.workbuddySkinVideoState = "loading";
    try {
      const response = await fetch(trustedVideoResource.url, {
        cache: "no-store",
        credentials: "omit",
        signal: videoFallbackAbortController.signal,
      });
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      const contentLength = Number(response.headers.get("content-length"));
      if (!response.ok || contentType !== "video/mp4" || contentLength !== trustedVideoResource.size) {
        throw new Error("trusted-video-response-invalid");
      }
      const blob = await response.blob();
      if (blob.size !== trustedVideoResource.size || blob.type !== "video/mp4") {
        throw new Error("trusted-video-blob-invalid");
      }
      videoObjectUrl = URL.createObjectURL(blob);
      backgroundVideo.src = videoObjectUrl;
      backgroundVideo.load();
      syncVideoPlayback();
    } catch {
      if (!videoFallbackAbortController.signal.aborted) failVideoPlayback();
    }
  };
  if (trustedVideoUrl) {
    backgroundVideo = document.createElement("video");
    backgroundVideo.id = "workbuddy-skin-background-video";
    backgroundVideo.muted = true;
    backgroundVideo.defaultMuted = true;
    backgroundVideo.loop = true;
    backgroundVideo.playsInline = true;
    backgroundVideo.autoplay = !motionPreference.matches && !document.hidden && !videoUserPaused && !videoDisabled;
    backgroundVideo.controls = false;
    backgroundVideo.preload = "auto";
    backgroundVideo.crossOrigin = "anonymous";
    backgroundVideo.poster = THEME.appearance.backgroundVideoPosterMode === "image" ? ART_URL : "";
    backgroundVideo.tabIndex = -1;
    backgroundVideo.setAttribute("muted", "");
    backgroundVideo.setAttribute("loop", "");
    backgroundVideo.setAttribute("playsinline", "");
    backgroundVideo.setAttribute("disablepictureinpicture", "");
    backgroundVideo.dataset.playbackState = videoDisabled ? "disabled" :
      reducedMotionActive()
        ? "reduced-motion" : videoUserPaused ? "paused" : "loading";
    backgroundVideo.hidden = videoDisabled;
    backgroundVideo.addEventListener("loadeddata", () => {
      if (videoFirstFrameMs === null) videoFirstFrameMs = Number((performance.now() - generationInstalledAt).toFixed(3));
      backgroundVideo.dataset.ready = "true";
      syncVideoPlayback();
    });
    backgroundVideo.addEventListener("playing", () => {
      if (videoPlayingMs === null) videoPlayingMs = Number((performance.now() - generationInstalledAt).toFixed(3));
      backgroundVideo.dataset.ready = "true";
      // Re-enter the single playback state machine so a late `playing` event
      // cannot override Reduced Motion, visibility, pause, or disabled state.
      syncVideoPlayback();
    });
    backgroundVideo.addEventListener("error", () => {
      if (!videoFallbackStarted && backgroundVideo?.src === trustedVideoUrl) {
        void startTrustedBlobFallback();
        return;
      }
      failVideoPlayback();
    });
    document.addEventListener("visibilitychange", syncVideoPlayback);
    motionPreference.addEventListener?.("change", handleMotionPreferenceChange);
  }

  const syncInteractivePresentation = () => {
    if (!interactiveEnabled) return;
    const inspected = interactiveController?.inspect?.() || {};
    if (interactiveFatalFallback || inspected.fallback) interactiveRuntimeState = "fallback";
    else if (!inspected.ready) interactiveRuntimeState = "loading";
    else if (!interactiveEffectEnabled || inspected.active !== true || motionPreference.matches || document.hidden) {
      interactiveRuntimeState = "static";
    } else interactiveRuntimeState = "enabled";
    root.dataset.workbuddySkinInteractiveState = interactiveRuntimeState;
    if (interactiveLayer) {
      const hideStaticRipple = backgroundRenderMode === "ripple" && interactiveRuntimeState === "static";
      interactiveLayer.hidden = interactiveRuntimeState === "fallback" ||
        interactiveRuntimeState === "loading" || hideStaticRipple;
      interactiveLayer.dataset.workbuddySkinInteractiveState = interactiveRuntimeState;
    }
    const state = window[STATE_KEY];
    if (state) {
      state.interactiveController = interactiveController;
      state.interactiveEffectEnabled = interactiveEffectEnabled;
      state.interactiveRuntimeState = interactiveRuntimeState;
      state.interactiveAtlasUrl = interactiveAtlasUrl;
    }
    updateVideoToggle();
  };

  const ensureInteractiveLayer = () => {
    if (!interactiveEnabled) return;
    if (!interactiveLayer) {
      interactiveLayer = document.createElement("div");
      interactiveLayer.id = INTERACTIVE_LAYER_ID;
      interactiveLayer.dataset.workbuddySkinOwned = "true";
      interactiveLayer.setAttribute("aria-hidden", "true");
      background.append(interactiveLayer);
    }
    const sourceUrl = backgroundRenderMode === "ripple" ? ART_URL : interactiveAtlasUrl;
    if (!interactiveController && sourceUrl) {
      try {
        interactiveController = createBackgroundEffect({
          mode: backgroundRenderMode,
          layer: interactiveLayer,
          sourceUrl,
          config: interactiveBackground,
          position: backgroundPositionForSettings(currentThemeSettings),
          motionMediaQuery: motionPreference,
          onStateChange: syncInteractivePresentation,
          onFallback: () => {
            interactiveFatalFallback = true;
            syncInteractivePresentation();
          },
        });
        interactiveController.setEnabled(interactiveEffectEnabled);
      } catch {
        interactiveController?.dispose?.();
        interactiveController = null;
        interactiveFatalFallback = true;
      }
    }
    syncInteractivePresentation();
  };

  const setDeferredInteractiveAtlasSource = (source, themeId) => {
    if (backgroundRenderMode !== "directional" || themeId !== String(THEME.id) ||
        typeof source !== "string" || !source.startsWith("blob:")) {
      if (typeof source === "string" && source.startsWith("blob:")) URL.revokeObjectURL(source);
      return false;
    }
    if (interactiveAtlasUrl?.startsWith("blob:") && interactiveAtlasUrl !== source) {
      URL.revokeObjectURL(interactiveAtlasUrl);
    }
    interactiveController?.dispose?.();
    interactiveController = null;
    interactiveFatalFallback = false;
    interactiveAtlasUrl = source;
    ensureInteractiveLayer();
    return interactiveController?.inspect?.().fallback !== true;
  };

  const scrim = document.createElement("div");
  scrim.id = "workbuddy-skin-background-scrim";
  background.append(artwork);
  if (backgroundVideo) background.append(backgroundVideo);
  ensureInteractiveLayer();
  background.append(scrim);
  document.body.prepend(background);
  if (backgroundVideo) {
    // Electron's media pipeline may reject a direct network source before the
    // element is connected. Attach first, then start the trusted Range load.
    backgroundVideo.src = trustedVideoUrl;
    backgroundVideo.load();
  }
  syncVideoPlayback();

  applyBackgroundPresentation = (presentation) => {
    if (interactiveEnabled) {
      interactiveEffectEnabled = presentation === "enabled";
      root.dataset.workbuddySkinVideoState = presentation === "disabled" ? "disabled" : presentation;
      interactiveController?.setEnabled?.(interactiveEffectEnabled);
      syncInteractivePresentation();
      return;
    }
    if (!backgroundVideo) return;
    videoDisabled = presentation === "disabled";
    videoUserPaused = presentation === "paused";
    videoMotionOverride = false;
    updateVideoStateObject();
    syncVideoPlayback();
  };

  const pendingThemeSettingsRequests = new Map();
  const persistThemeSettings = (state, context) => new Promise((resolve, reject) => {
    if (typeof window[THEME_SETTINGS_BINDING] !== "function") {
      reject(new Error("Theme settings service is unavailable"));
      return;
    }
    const requestId = `${Date.now().toString(36)}_${context.revision.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      pendingThemeSettingsRequests.delete(requestId);
      reject(new Error("Theme settings persistence timed out"));
    }, 8000);
    pendingThemeSettingsRequests.set(requestId, { resolve, reject, timer, revision: context.revision });
    window[THEME_SETTINGS_BINDING](JSON.stringify({
      requestId,
      nonce: THEME_SETTINGS_NONCE,
      themeId: String(THEME.id),
      revision: context.revision,
      state,
    }));
  });
  window[THEME_SETTINGS_RESULT_KEY] = (requestId, result) => {
    const pending = pendingThemeSettingsRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingThemeSettingsRequests.delete(requestId);
    if (!result?.ok || result.revision !== pending.revision) {
      pending.reject(new Error(result?.message || result?.code || "Theme settings update failed"));
      return;
    }
    pending.resolve({ state: result.state });
  };
  themeSettingsSession = createThemeSettingsSession({
    initialState: currentThemeSettings,
    debounceMs: 180,
    validate: validateThemeSettingsState,
    preview: (state) => {
      applyThemeSettingsStyles(state);
      interactiveController?.setPosition?.(backgroundPositionForSettings(state));
      applyBackgroundPresentation(state.backgroundPresentation);
      refreshThemeSettingsControls();
    },
    persist: persistThemeSettings,
    status: (event) => {
      if (event.state === "saving") themeSettingsStatus("updateApplying", {}, "busy");
      else if (event.state === "saved") themeSettingsStatus("updateApplied", {}, "success");
      else if (event.state === "error") themeSettingsStatus("updateRolledBack", {}, "error");
      else if (event.state === "dirty") themeSettingsStatus("updatePending", {}, "busy");
    },
  });
  tryThemeSettingsUpdate = (patch, options = {}) => {
    try {
      const result = themeSettingsSession.update(patch, options);
      if (result === false) {
        refreshThemeSettingsControls(true);
        return false;
      }
      return true;
    } catch {
      refreshThemeSettingsControls(true);
      themeSettingsStatus("updateRolledBack", {}, "error");
      return false;
    }
  };
  applyBackgroundPresentation(currentThemeSettings.backgroundPresentation);

  const markRole = (node, role) => uiInterpreter.markRole(node, role);

  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const computed = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && computed.display !== "none" && computed.visibility !== "hidden";
  };

  const findComposer = (editor) => {
    const known = uiInterpreter.closest("composerKnownRoot", editor);
    if (known) return known;
    const stop = uiInterpreter.closest("composerStop", editor);
    const editorRect = editor.getBoundingClientRect();
    let node = editor.parentElement;
    let candidate = null;
    while (node && node !== stop) {
      const rect = node.getBoundingClientRect();
      const computed = getComputedStyle(node);
      const radius = Number.parseFloat(computed.borderTopLeftRadius) || 0;
      const paintsSurface = computed.backgroundColor !== "rgba(0, 0, 0, 0)" || computed.backgroundImage !== "none";
      if (paintsSurface && radius >= 12 && rect.height >= 80 && rect.height <= 220 && rect.width >= editorRect.width * .8) {
        candidate = node;
      }
      node = node.parentElement;
    }
    return candidate;
  };

  const reconcileComposers = () => {
    const editors = uiInterpreter.select("composerEditors") ?? [];
    for (const editor of editors) {
      if (!visible(editor)) continue;
      const composer = findComposer(editor);
      if (!composer) continue;
      markRole(composer, "composer");
      markRole(editor, "composer-input");
      markRole(uiInterpreter.select("composerToolbar", composer), "composer-toolbar");
      const footer = uiInterpreter.select("composerFooter", composer);
      if (footer) markRole(footer, "composer-footer");

      let surface = editor.parentElement;
      while (surface && surface !== composer) {
        const computed = getComputedStyle(surface);
        const rect = surface.getBoundingClientRect();
        if (computed.backgroundColor !== "rgba(0, 0, 0, 0)" && rect.width >= composer.clientWidth * .75) {
          markRole(surface, "composer-main-area");
          break;
        }
        surface = surface.parentElement;
      }
    }
  };

  let settingsNavigationListenerTarget = null;
  const initialRuntimeDiagnosticCodes = new Set(
    (INITIAL_THEME_SETTINGS_DIAGNOSTICS.diagnostics ?? []).map(({ code }) => code),
  );
  let themeSettingsStatusModel = initialRuntimeDiagnosticCodes.has("runtime-background-position-conflict")
    ? { key: "backgroundPositionMigrationConflict", replacements: {}, state: "warning" }
    : initialRuntimeDiagnosticCodes.has("runtime-background-position-migrated")
      ? { key: "backgroundPositionMigrated", replacements: {}, state: "success" }
      : INITIAL_THEME_SETTINGS_DIAGNOSTICS.quarantineCount > 0
        ? { key: "overridesQuarantined", replacements: { count: INITIAL_THEME_SETTINGS_DIAGNOSTICS.quarantineCount }, state: "warning" }
        : INITIAL_THEME_SETTINGS_DIAGNOSTICS.status === "rebased"
          ? { key: "overridesRebased", replacements: {}, state: "idle" }
          : { key: "settingsReady", replacements: {}, state: "idle" };
  const themeSettingsStatus = (key, replacements = {}, state = "idle") => {
    themeSettingsStatusModel = { key, replacements: { ...replacements }, state };
    const status = document.querySelector(`#${THEME_SETTINGS_PANEL_ID} [data-cc-theme-status]`);
    if (!status) return;
    status.textContent = settingsMessage(key, replacements);
    status.dataset.state = state;
  };

  updateThemeSettingsBackgroundControl = () => {
    const panel = document.getElementById(THEME_SETTINGS_PANEL_ID);
    const status = panel?.querySelector("[data-cc-theme-background-status]");
    const button = panel?.querySelector("[data-cc-theme-background-action]");
    if (!status || !button) return;
    const syncActionLabel = () => {
      button.setAttribute("aria-label", button.textContent);
      button.title = button.textContent;
    };
    if (currentThemeSettings.backgroundPresentation === "disabled") {
      status.textContent = settingsMessage("visualsDisabled");
      button.textContent = settingsMessage("enable");
      button.disabled = false;
      syncActionLabel();
      return;
    }
    if (interactiveEnabled) {
      const mode = backgroundRenderMode === "ripple"
        ? settingsMessage("rippleBackground") : settingsMessage("directionalBackground");
      const reduced = motionPreference.matches;
      status.textContent = `${mode} · ${reduced ? settingsMessage("reduceMotionStatic") :
        interactiveRuntimeState === "enabled" ? settingsMessage("running") : settingsMessage("paused")}`;
      button.textContent = interactiveEffectEnabled ? settingsMessage("pause") : settingsMessage("enable");
      button.disabled = interactiveRuntimeState === "fallback";
      syncActionLabel();
      return;
    }
    if (!backgroundVideo) {
      status.textContent = settingsMessage("staticImage");
      button.textContent = settingsMessage("notSwitchable");
      button.disabled = true;
      syncActionLabel();
      return;
    }
    const state = backgroundVideo.dataset.playbackState || "paused";
    status.textContent = state === "disabled" ? settingsMessage("visualsDisabled") :
      state === "playing" || state === "loading" ? settingsMessage("videoPlaying") :
        state === "reduced-motion" ? settingsMessage("videoReduced") :
          state === "error" ? settingsMessage("videoUnavailable") : settingsMessage("videoPaused");
    button.textContent = state === "disabled" ? settingsMessage("enable") :
      state === "playing" || state === "loading" ? settingsMessage("pause") : settingsMessage("disable");
    button.disabled = state === "error";
    syncActionLabel();
  };

  const readObjectPath = (value, dottedPath) => String(dottedPath || "").split(".")
    .reduce((current, key) => current?.[key], value);
  const baseControlValue = (control) => {
    const fromTheme = control.themePath ? readObjectPath(THEME, control.themePath) : undefined;
    if (fromTheme !== undefined) return structuredClone(fromTheme);
    const binding = styleBindingsById.get(control.binding);
    const sources = { palette: customPalette, layout: baseLayout, host: customHostBridge };
    const sourceValue = binding?.source ? readObjectPath(sources, binding.source) : undefined;
    if (control.type === "number") return Number.parseFloat(sourceValue) || 0;
    return sourceValue;
  };
  const controlValue = (control, state = themeSettingsSession?.snapshot?.().draft ?? currentThemeSettings) =>
    Object.hasOwn(state.values, control.id) ? state.values[control.id] : baseControlValue(control);
  const updateControl = (control, value, options = {}) => {
    const snapshot = themeSettingsSession.snapshot();
    tryThemeSettingsUpdate({ values: { ...snapshot.draft.values, [control.id]: value } }, options);
  };
  const resetControl = (control) => {
    const snapshot = themeSettingsSession.snapshot();
    const values = { ...snapshot.draft.values };
    delete values[control.id];
    tryThemeSettingsUpdate({ values }, { immediate: true });
  };

  refreshThemeSettingsControls = (force = false) => {
    const panel = document.getElementById(THEME_SETTINGS_PANEL_ID);
    const snapshot = themeSettingsSession?.snapshot?.();
    if (!panel || !snapshot) return;
    const strategy = snapshot.draft.paletteStrategy;
    const paletteSelect = panel.querySelector('[data-cc-theme-palette-strategy]');
    if (paletteSelect && paletteSelect.value !== strategy) paletteSelect.value = strategy;
    const currentMeta = panel.querySelector('[data-cc-theme-current-meta]');
    const paletteLabel = strategy === "system" ? settingsMessage("paletteSystem") :
      strategy === "adaptive" ? settingsMessage("paletteAdaptive") : settingsMessage("paletteCustom");
    if (currentMeta) currentMeta.textContent = `${THEME.id} · ${paletteLabel}`;
    for (const input of panel.querySelectorAll('[data-cc-theme-control]')) {
      const control = settingsControlsById.get(input.dataset.ccThemeControl);
      if (!control) continue;
      const value = controlValue(control, snapshot.draft);
      const normalizedColor = control.type === "color" ? themeSettingsColor.normalize(value) : null;
      const next = control.type === "fontList" ? value.join(", ") :
        control.type === "color" ? normalizedColor?.value ?? String(value) : String(value);
      if ((force || document.activeElement !== input) && input.value !== next) input.value = next;
      const disabled = Array.isArray(control.paletteStrategies) && !control.paletteStrategies.includes(strategy);
      input.disabled = disabled;
      if (control.type === "color") {
        const picker = input.parentElement?.querySelector("[data-cc-theme-color-picker]");
        if (picker && normalizedColor && picker.value !== normalizedColor.picker) picker.value = normalizedColor.picker;
        if (picker) picker.disabled = disabled;
        input.dataset.ccThemeLastValid = normalizedColor?.value ?? String(value);
        if (force || document.activeElement !== input) {
          input.removeAttribute("aria-invalid");
          const error = input.parentElement?.querySelector("[data-cc-theme-field-error]");
          if (error) error.hidden = true;
        }
      }
    }
    for (const editor of panel.querySelectorAll("[data-cc-theme-position-control]")) {
      const control = settingsControlsById.get(editor.dataset.ccThemePositionControl);
      if (!control) continue;
      const value = controlValue(control, snapshot.draft);
      const disabled = Array.isArray(control.paletteStrategies) && !control.paletteStrategies.includes(strategy);
      for (const input of editor.querySelectorAll("[data-cc-theme-position-axis]")) {
        const next = String(value[input.dataset.ccThemePositionAxis]);
        if ((force || document.activeElement !== input) && input.value !== next) input.value = next;
        input.disabled = disabled;
        const output = input.parentElement?.querySelector("[data-cc-theme-position-output]");
        if (output) output.textContent = `${next}%`;
      }
    }
    updateThemeSettingsBackgroundControl();
  };

  const createAppearanceSettings = () => {
    const section = document.createElement("section");
    section.className = "cc-theme-settings-appearance";
    const heading = document.createElement("h3");
    heading.textContent = settingsMessage("settingsAppearance");
    section.append(heading);

    const paletteRow = document.createElement("label");
    paletteRow.className = "cc-theme-settings-control";
    const paletteLabel = document.createElement("span");
    paletteLabel.textContent = settingsMessage("controlPalette");
    const paletteSelect = document.createElement("select");
    paletteSelect.dataset.ccThemePaletteStrategy = "true";
    for (const [value, key] of [["system", "paletteSystem"], ["adaptive", "paletteAdaptive"], ["custom", "paletteCustom"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = settingsMessage(key);
      paletteSelect.append(option);
    }
    paletteSelect.value = currentThemeSettings.paletteStrategy;
    paletteSelect.addEventListener("change", () => {
      tryThemeSettingsUpdate({ paletteStrategy: paletteSelect.value }, { immediate: true });
    });
    paletteRow.append(paletteLabel, paletteSelect);
    section.append(paletteRow);

    const groupLabels = {
      color: "groupColor",
      typography: "groupTypography",
      opacity: "groupOpacity",
      background: "groupBackground",
    };
    for (const [group, labelKey] of Object.entries(groupLabels)) {
      const controls = settingsControls.filter((control) => (control.binding || control.bindings) && control.group === group &&
        !(control.id === "media.interactiveScrim" && !interactiveEnabled));
      if (!controls.length) continue;
      const details = document.createElement("details");
      details.className = "cc-theme-settings-group";
      details.dataset.ccThemeGroup = group;
      const summary = document.createElement("summary");
      summary.textContent = settingsMessage(labelKey);
      const rows = document.createElement("div");
      for (const control of controls) {
        const composite = ["color", "position"].includes(control.type);
        const row = document.createElement(composite ? "div" : "label");
        row.className = "cc-theme-settings-control";
        const name = document.createElement("span");
        name.textContent = settingsMessage(control.labelKey);
        name.id = `cc-theme-control-label-${control.id.replaceAll(".", "-")}`;
        const controlsBox = document.createElement("span");
        if (composite) {
          controlsBox.setAttribute("role", "group");
          controlsBox.setAttribute("aria-labelledby", name.id);
        }
        let input = null;
        if (control.type === "color") {
          controlsBox.classList.add("cc-theme-settings-color-controls");
          const picker = document.createElement("input");
          picker.type = "color";
          picker.dataset.ccThemeColorPicker = control.id;
          picker.setAttribute("aria-label", settingsMessage("colorPickerAria", {
            control: settingsMessage(control.labelKey),
          }));
          const textInput = document.createElement("input");
          input = textInput;
          textInput.type = "text";
          textInput.dataset.ccThemeControl = control.id;
          textInput.dataset.ccThemeColorValue = "true";
          textInput.spellcheck = false;
          textInput.autocomplete = "off";
          textInput.placeholder = settingsMessage("colorValuePlaceholder");
          textInput.setAttribute("aria-label", settingsMessage("colorValueAria", {
            control: settingsMessage(control.labelKey),
          }));
          const error = document.createElement("small");
          error.id = `cc-theme-control-error-${control.id.replaceAll(".", "-")}`;
          error.className = "cc-theme-settings-field-error";
          error.dataset.ccThemeFieldError = "true";
          error.hidden = true;
          error.setAttribute("role", "alert");
          textInput.setAttribute("aria-describedby", error.id);
          const setColorError = (invalid) => {
            if (invalid) {
              textInput.setAttribute("aria-invalid", "true");
              error.textContent = settingsMessage("colorValueInvalid", {
                control: settingsMessage(control.labelKey),
              });
              error.hidden = false;
            } else {
              textInput.removeAttribute("aria-invalid");
              error.hidden = true;
            }
          };
          const restoreLastColor = () => {
            const normalized = themeSettingsColor.normalize(controlValue(control));
            if (!normalized) return;
            textInput.value = normalized.value;
            textInput.dataset.ccThemeLastValid = normalized.value;
            picker.value = normalized.picker;
            setColorError(false);
          };
          const commitTextColor = () => {
            const normalized = themeSettingsColor.normalize(textInput.value);
            if (!normalized) {
              setColorError(true);
              return false;
            }
            textInput.value = normalized.value;
            textInput.dataset.ccThemeLastValid = normalized.value;
            picker.value = normalized.picker;
            setColorError(false);
            updateControl(control, normalized.value);
            return true;
          };
          textInput.addEventListener("input", commitTextColor);
          textInput.addEventListener("blur", () => {
            if (!themeSettingsColor.normalize(textInput.value)) setColorError(true);
          });
          textInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitTextColor();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              restoreLastColor();
            }
          });
          picker.addEventListener("input", () => {
            const normalized = themeSettingsColor.normalize(picker.value);
            if (!normalized) return;
            textInput.value = normalized.value;
            textInput.dataset.ccThemeLastValid = normalized.value;
            setColorError(false);
            updateControl(control, normalized.value);
          });
          controlsBox.append(picker, textInput, error);
        } else if (control.type === "number") {
          input = document.createElement("input");
          input.dataset.ccThemeControl = control.id;
          input.type = "range";
          input.min = String(control.minimum);
          input.max = String(control.maximum);
          input.step = String(control.step);
          input.addEventListener("input", () => updateControl(control, Number(input.value)));
          controlsBox.append(input);
        } else if (control.type === "position") {
          controlsBox.classList.add("cc-theme-settings-position-controls");
          controlsBox.dataset.ccThemePositionControl = control.id;
          const positionInputs = {};
          for (const [axis, messageKey, shortLabel] of [
            ["xPercent", "backgroundPositionXAria", "X"],
            ["yPercent", "backgroundPositionYAria", "Y"],
          ]) {
            const axisBox = document.createElement("span");
            axisBox.className = "cc-theme-settings-position-axis";
            const axisLabel = document.createElement("span");
            axisLabel.textContent = shortLabel;
            axisLabel.setAttribute("aria-hidden", "true");
            const axisInput = document.createElement("input");
            axisInput.type = "range";
            axisInput.min = String(control.minimum);
            axisInput.max = String(control.maximum);
            axisInput.step = String(control.step);
            axisInput.dataset.ccThemePositionAxis = axis;
            axisInput.setAttribute("aria-label", settingsMessage(messageKey));
            const axisOutput = document.createElement("output");
            axisOutput.dataset.ccThemePositionOutput = axis;
            axisOutput.setAttribute("aria-hidden", "true");
            positionInputs[axis] = axisInput;
            axisBox.append(axisLabel, axisInput, axisOutput);
            controlsBox.append(axisBox);
          }
          const restoreLastPosition = () => {
            const value = controlValue(control);
            for (const axis of ["xPercent", "yPercent"]) {
              positionInputs[axis].value = String(value[axis]);
              positionInputs[axis].parentElement.querySelector("[data-cc-theme-position-output]").textContent = `${value[axis]}%`;
            }
          };
          const commitPosition = () => {
            const value = {
              xPercent: Number(positionInputs.xPercent.value),
              yPercent: Number(positionInputs.yPercent.value),
            };
            for (const axis of ["xPercent", "yPercent"]) {
              positionInputs[axis].parentElement.querySelector("[data-cc-theme-position-output]").textContent = `${value[axis]}%`;
            }
            updateControl(control, value);
            return true;
          };
          for (const axisInput of Object.values(positionInputs)) {
            axisInput.addEventListener("input", commitPosition);
            axisInput.addEventListener("keydown", (event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                restoreLastPosition();
              }
            });
          }
        } else {
          input = document.createElement("input");
          input.dataset.ccThemeControl = control.id;
          input.type = "text";
          input.spellcheck = false;
          input.autocomplete = "off";
          input.addEventListener("input", () => {
            const families = input.value.split(",").map((family) => family.trim()).filter(Boolean);
            if (families.length) updateControl(control, families);
          });
          controlsBox.append(input);
        }
        const reset = document.createElement("button");
        reset.type = "button";
        reset.textContent = settingsMessage("restoreDefault");
        reset.setAttribute("aria-label", settingsMessage("restoreControlAria", {
          control: settingsMessage(control.labelKey),
        }));
        reset.title = settingsMessage("restoreControlAria", { control: settingsMessage(control.labelKey) });
        reset.addEventListener("click", (event) => {
          event.preventDefault();
          resetControl(control);
        });
        controlsBox.append(reset);
        row.append(name, controlsBox);
        rows.append(row);
      }
      details.append(summary, rows);
      section.append(details);
    }
    return section;
  };

  const createThemeSettingsPanel = () => {
    const panel = document.createElement("section");
    panel.id = THEME_SETTINGS_PANEL_ID;
    panel.className = "cc-theme-settings-panel";
    panel.dataset.workbuddySkinOwned = "true";
    panel.lang = resolveSettingsLocale();
    panel.dir = settingsLocaleMetadata().direction || "ltr";
    panel.hidden = true;
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", settingsMessage("settingsAria"));

    const header = document.createElement("header");
    const title = document.createElement("h2");
    title.textContent = settingsMessage("pageTitle");
    const introduction = document.createElement("p");
    introduction.textContent = settingsMessage("settingsIntro");
    header.append(title, introduction);

    const current = document.createElement("section");
    current.className = "cc-theme-settings-card cc-theme-settings-current";
    const currentCopy = document.createElement("div");
    const currentLabel = document.createElement("span");
    currentLabel.textContent = settingsMessage("currentTheme");
    const currentName = document.createElement("strong");
    currentName.textContent = THEME.name || THEME.id;
    const currentMeta = document.createElement("small");
    currentMeta.dataset.ccThemeCurrentMeta = "true";
    const paletteLabel = currentThemeSettings.paletteStrategy === "system" ? settingsMessage("paletteSystem") :
      currentThemeSettings.paletteStrategy === "adaptive" ? settingsMessage("paletteAdaptive") : settingsMessage("paletteCustom");
    currentMeta.textContent = `${THEME.id} · ${paletteLabel}`;
    currentCopy.append(currentLabel, currentName, currentMeta);
    const currentMark = document.createElement("span");
    currentMark.className = "cc-theme-settings-current-mark";
    currentMark.textContent = settingsMessage("activeTheme");
    current.append(currentCopy, currentMark);

    const backgroundSection = document.createElement("section");
    backgroundSection.className = "cc-theme-settings-card cc-theme-settings-background";
    const backgroundCopy = document.createElement("div");
    const backgroundLabel = document.createElement("strong");
    backgroundLabel.textContent = settingsMessage("backgroundEffect");
    const backgroundStatus = document.createElement("small");
    backgroundStatus.dataset.ccThemeBackgroundStatus = "true";
    backgroundCopy.append(backgroundLabel, backgroundStatus);
    const backgroundAction = document.createElement("button");
    backgroundAction.type = "button";
    backgroundAction.dataset.ccThemeBackgroundAction = "true";
    backgroundAction.addEventListener("click", cycleBackgroundPresentation);
    backgroundSection.append(backgroundCopy, backgroundAction);

    const appearanceSection = createAppearanceSettings();

    const status = document.createElement("p");
    status.className = "cc-theme-settings-status";
    status.dataset.ccThemeStatus = "true";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = settingsMessage(themeSettingsStatusModel.key, themeSettingsStatusModel.replacements);
    status.dataset.state = themeSettingsStatusModel.state;
    panel.append(header, current, backgroundSection, appearanceSection, status);
    queueMicrotask(refreshThemeSettingsControls);
    return panel;
  };

  const themeSettingsMount = () => uiInterpreter.resolveMount("themeSettings");

  const setThemeSettingsActive = (active) => {
    const mount = themeSettingsMount();
    const { navigation, content, nativePanel, navigationItems = [] } = mount?.nodes ?? {};
    const activeClass = mount?.definition?.presentation?.navigationActiveClass;
    const themeNav = document.getElementById(THEME_SETTINGS_NAV_ID);
    const themePanel = document.getElementById(THEME_SETTINGS_PANEL_ID);
    if (!navigation || !content || !nativePanel || !themeNav || !themePanel || !activeClass) return false;
    themeSettingsActive = active;
    if (active) {
      const nativeActive = navigationItems.find((item) => item !== themeNav && item.classList.contains(activeClass));
      if (nativeActive) lastNativeSettingsNav = nativeActive;
      navigationItems.forEach((item) => item.classList.remove(activeClass));
      themeNav.classList.add(activeClass);
      themeNav.setAttribute("aria-current", "page");
      nativePanel.hidden = true;
      themePanel.hidden = false;
      updateThemeSettingsBackgroundControl();
    } else {
      themeNav.classList.remove(activeClass);
      themeNav.removeAttribute("aria-current");
      themePanel.hidden = true;
      nativePanel.hidden = false;
      if (lastNativeSettingsNav?.isConnected) {
        lastNativeSettingsNav.classList.add(activeClass);
      }
    }
    const state = window[STATE_KEY];
    if (state) state.themeSettingsActive = themeSettingsActive;
    return true;
  };

  const handleNativeSettingsNavigation = (event) => {
    const mount = themeSettingsMount();
    const item = mount?.nodes?.navigationItems?.find((candidate) =>
      candidate === event.target || candidate.contains(event.target));
    if (!item || item.id === THEME_SETTINGS_NAV_ID) return;
    lastNativeSettingsNav = item;
    setThemeSettingsActive(false);
  };

  const ensureThemeSettings = () => {
    const mount = themeSettingsMount();
    const { navigation, content, nativePanel } = mount?.nodes ?? {};
    const presentation = mount?.definition?.presentation;
    if (!navigation || !content || !nativePanel || !presentation) {
      if (settingsNavigationListenerTarget) {
        settingsNavigationListenerTarget.removeEventListener("click", handleNativeSettingsNavigation, true);
        settingsNavigationListenerTarget = null;
      }
      return false;
    }
    if (settingsNavigationListenerTarget !== navigation) {
      settingsNavigationListenerTarget?.removeEventListener("click", handleNativeSettingsNavigation, true);
      navigation.addEventListener("click", handleNativeSettingsNavigation, true);
      settingsNavigationListenerTarget = navigation;
    }
    let themeNav = document.getElementById(THEME_SETTINGS_NAV_ID);
    if (!themeNav) {
      themeNav = document.createElement("button");
      themeNav.id = THEME_SETTINGS_NAV_ID;
      themeNav.type = "button";
      themeNav.className = presentation.navigationItemClass;
      themeNav.dataset.workbuddySkinOwned = "true";
      uiInterpreter.adoptAdjacentPresentation("themeSettings", "navigationItem", themeNav);
      const icon = document.createElement("span");
      icon.className = presentation.navigationIconClass;
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 6.5h10M17 6.5h3M4 12h3m3 0h10M4 17.5h8m3 0h5M14 4v5M7 9.5v5M12 15v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      const label = document.createElement("span");
      label.className = presentation.navigationLabelClass;
      label.textContent = settingsMessage("navigationTitle");
      themeNav.append(icon, label);
      themeNav.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setThemeSettingsActive(true);
      });
      if (!uiInterpreter.insert("themeSettings", "navigationItem", themeNav)) {
        themeNav.remove();
        return false;
      }
    }
    const navigationLabel = themeNav.querySelector(`.${presentation.navigationLabelClass}`);
    const localizedNavigationTitle = settingsMessage("navigationTitle");
    if (navigationLabel && navigationLabel.textContent !== localizedNavigationTitle) {
      navigationLabel.textContent = localizedNavigationTitle;
    }
    if (themeNav.getAttribute("aria-label") !== localizedNavigationTitle) {
      themeNav.setAttribute("aria-label", localizedNavigationTitle);
    }
    let themePanel = document.getElementById(THEME_SETTINGS_PANEL_ID);
    let openGroups = [];
    if (themePanel && themePanel.lang !== resolveSettingsLocale()) {
      openGroups = [...themePanel.querySelectorAll("details[data-cc-theme-group][open]")]
        .map((details) => details.dataset.ccThemeGroup).filter(Boolean);
      themePanel.remove();
      themePanel = null;
    }
    if (!themePanel) {
      themePanel = createThemeSettingsPanel();
      if (!uiInterpreter.insert("themeSettings", "ownedPanel", themePanel)) {
        themePanel.remove();
        return false;
      }
      for (const group of openGroups) {
        themePanel.querySelector(`details[data-cc-theme-group="${group}"]`)?.setAttribute("open", "");
      }
    }
    const activeClass = presentation.navigationActiveClass;
    if (themeSettingsActive) {
      const alreadyActive = !themePanel.hidden && nativePanel.hidden &&
        themeNav.classList.contains(activeClass);
      if (!alreadyActive) setThemeSettingsActive(true);
    } else if (!themePanel.hidden || nativePanel.hidden ||
        themeNav.classList.contains(activeClass)) {
      setThemeSettingsActive(false);
    }
    return true;
  };

  const disposeThemeSettings = () => {
    settingsNavigationListenerTarget?.removeEventListener("click", handleNativeSettingsNavigation, true);
    settingsNavigationListenerTarget = null;
    const mount = themeSettingsMount();
    const nativePanel = mount?.nodes?.nativePanel;
    const activeClass = mount?.definition?.presentation?.navigationActiveClass;
    if (nativePanel) nativePanel.hidden = false;
    if (lastNativeSettingsNav?.isConnected && activeClass) {
      lastNativeSettingsNav.classList.add(activeClass);
    }
    document.getElementById(THEME_SETTINGS_NAV_ID)?.remove();
    document.getElementById(THEME_SETTINGS_PANEL_ID)?.remove();
    delete window[THEME_SETTINGS_RESULT_KEY];
  };

  let reconcileScheduled = false;
  let reconciliationActive = true;
  const reconcile = () => {
    reconcileScheduled = false;
    if (!reconciliationActive) return;
    refreshSettingsLocaleSnapshot();
    uiInterpreter.reconcileRoles();
    reconcileComposers();
    ensureVideoToggle();
    ensureThemeSettings();
  };
  const scheduleReconcile = () => {
    if (reconcileScheduled || !reconciliationActive) return;
    reconcileScheduled = true;
    queueMicrotask(reconcile);
  };
  reconcile();
  const observer = new MutationObserver(scheduleReconcile);
  observer.observe(document.body, { childList: true, subtree: true });
  const reconcileInterval = setInterval(scheduleReconcile, 1000);
  const handleHostLocaleSignal = () => {
    if (refreshSettingsLocaleSnapshot()) scheduleReconcile();
  };
  const settingsLocaleObserver = new MutationObserver(handleHostLocaleSignal);
  settingsLocaleObserver.observe(document.body, {
    attributes: true,
    attributeFilter: [CATALOG.interpreter?.localeAuthority?.bodyAttribute || "lang"],
  });
  const settingsLocaleInterval = setInterval(() => {
    if (themeSettingsMount()) handleHostLocaleSignal();
  }, 250);
  window.addEventListener("storage", handleHostLocaleSignal);
  const syncNativeMode = () => {
    const mode = nativeShellMode();
    root.dataset.workbuddySkinNativeMode = mode;
    // A variant-aware presentation has an explicit palette for each host
    // appearance. Reapply its bounded variables when WorkBuddy switches
    // Light/Dark, even when the selected strategy is adaptive or custom.
    if (activePaletteStrategy === "system" || THEME.appearanceVariants) {
      uiInterpreter.applyStyleSources(styleSourcesForSettings(currentThemeSettings, mode), { resetMissing: true });
    }
  };
  const nativeThemeObserver = new MutationObserver(syncNativeMode);
  nativeThemeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  const inspect = () => {
    const box = (role) => {
      const node = document.querySelector(`[${ROLE_ATTRIBUTE}="${role}"]`);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const computed = getComputedStyle(node);
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: rect.width > 0 && rect.height > 0 && computed.display !== "none" && computed.visibility !== "hidden",
      };
    };
    const roleCounts = {};
    for (const node of document.querySelectorAll(`[${ROLE_ATTRIBUTE}]`)) {
      const role = node.getAttribute(ROLE_ATTRIBUTE);
      roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    }
    return {
      installed: root.classList.contains("workbuddy-skin"),
      version: VERSION,
      revision: REVISION,
      themeId: THEME.id,
      paletteStrategy: activePaletteStrategy,
      themeSettings: themeSettingsSession?.snapshot?.() ?? null,
      nativeShellMode: nativeShellMode(),
      stylePresent: Boolean(document.getElementById(STYLE_ID)),
      backgroundPresent: Boolean(document.getElementById(BACKGROUND_ID)),
      backgroundRenderMode,
      interactiveEnabled,
      interactiveEffectEnabled,
      interactiveRuntimeState,
      interactiveLayerPresent: Boolean(document.getElementById(INTERACTIVE_LAYER_ID)),
      interactiveCanvasPresent: Boolean(interactiveLayer?.querySelector("canvas")),
      interactivePointerEvents: interactiveLayer ? getComputedStyle(interactiveLayer).pointerEvents : null,
      interactive: interactiveController?.inspect?.() ?? null,
      videoEnabled: Boolean(VIDEO_URL),
      videoTransport,
      videoTransportDiagnostic,
      videoPresent: Boolean(backgroundVideo),
      videoReady: backgroundVideo?.dataset.ready === "true",
      videoPlaybackState: backgroundVideo?.dataset.playbackState ?? null,
      videoErrorCode: backgroundVideo?.error?.code ?? null,
      videoNetworkState: backgroundVideo?.networkState ?? null,
      videoReadyState: backgroundVideo?.readyState ?? null,
      videoUserPaused,
      videoDisabled,
      documentHidden: document.hidden,
      reducedMotion: reducedMotionActive(),
      generationInstallCount,
      generationTimingsMs: {
        installed: 0,
        installedBeforeInspect: Math.max(0, Date.now() - generationInstalledEpochMs),
        firstFrame: videoFirstFrameMs,
        playing: videoPlayingMs,
      },
      videoTogglePresent: Boolean(document.getElementById(VIDEO_TOGGLE_ID)),
      themeSettingsNavPresent: Boolean(document.getElementById(THEME_SETTINGS_NAV_ID)),
      themeSettingsPanelPresent: Boolean(document.getElementById(THEME_SETTINGS_PANEL_ID)),
      themeSettingsActive,
      settingsLocale: resolveSettingsLocale(),
      settingsLocaleSource: settingsLocale.inspect().source,
      settingsLocaleDiagnostic: settingsLocale.inspect().diagnostic,
      uiInterpreter: uiInterpreter.inspect(),
      shell: box("shell"),
      sidebar: box("sidebar"),
      main: box("main"),
      composer: box("composer"),
      markedRoles: document.querySelectorAll(`[${ROLE_ATTRIBUTE}]`).length,
      roleCounts,
      catalogTargetVersion: CATALOG.targetVersion,
    };
  };

  const cleanup = () => {
    reconciliationActive = false;
    reconcileScheduled = false;
    observer.disconnect();
    clearInterval(reconcileInterval);
    settingsLocaleObserver.disconnect();
    clearInterval(settingsLocaleInterval);
    window.removeEventListener("storage", handleHostLocaleSignal);
    nativeThemeObserver?.disconnect();
    document.removeEventListener("visibilitychange", syncVideoPlayback);
    motionPreference.removeEventListener?.("change", handleMotionPreferenceChange);
    videoPlaybackEpoch += 1;
    videoFallbackAbortController.abort();
    interactiveController?.dispose?.();
    interactiveController = null;
    themeSettingsSession?.dispose?.();
    themeSettingsSession = null;
    for (const pending of pendingThemeSettingsRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Theme settings session was cleaned up"));
    }
    pendingThemeSettingsRequests.clear();
    disposeThemeSettings();
    if (backgroundVideo) {
      backgroundVideo.pause();
      backgroundVideo.removeAttribute("src");
      backgroundVideo.load();
    }
    if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    if (interactiveAtlasUrl?.startsWith("blob:")) URL.revokeObjectURL(interactiveAtlasUrl);
    uiInterpreter.cleanupRoles();
    document.querySelectorAll(`[${ROLE_ATTRIBUTE}]`).forEach((node) => node.removeAttribute(ROLE_ATTRIBUTE));
    document.querySelectorAll('[data-workbuddy-skin-owned="true"]').forEach((node) => node.remove());
    root.classList.remove("workbuddy-skin");
    delete root.dataset.workbuddySkinVersion;
    delete root.dataset.workbuddySkinTheme;
    delete root.dataset.workbuddySkinPresentation;
    delete root.dataset.workbuddySkinSceneDensity;
    delete root.dataset.workbuddySkinSceneBorderTreatment;
    delete root.dataset.workbuddySkinSceneBackdrop;
    delete root.dataset.workbuddySkinSceneTextureIntensity;
    delete root.dataset.workbuddySkinSceneSurfaceOpacity;
    delete root.dataset.workbuddySkinSceneNavigationTreatment;
    delete root.dataset.workbuddySkinSceneComposerTreatment;
    delete root.dataset.workbuddySkinSceneCardTreatment;
    delete root.dataset.workbuddySkinMode;
    delete root.dataset.workbuddySkinPalette;
    delete root.dataset.workbuddySkinNativeMode;
    delete root.dataset.workbuddySkinBackgroundMode;
    delete root.dataset.workbuddySkinInteractiveState;
    delete root.dataset.workbuddySkinVideo;
    delete root.dataset.workbuddySkinVideoState;
    uiInterpreter.restoreStyles();
    delete window[STATE_KEY];
    return true;
  };

  window[STATE_KEY] = {
    version: VERSION,
    revision: REVISION,
    themeId: THEME.id,
    paletteStrategy: activePaletteStrategy,
    videoUrl: VIDEO_URL,
    videoUserPaused,
    videoMotionOverride,
    videoDisabled,
    backgroundRenderMode,
    interactiveEnabled,
    interactiveEffectEnabled,
    interactiveRuntimeState,
    interactiveController,
    interactiveAtlasUrl,
    enforceSceneReducedMotion: () => {
      if (!sceneStaticMotionPolicy) return false;
      videoMotionOverride = false;
      updateVideoStateObject();
      syncVideoPlayback();
      return true;
    },
    themeSettingsActive,
    themeSettingsSession,
    setDeferredInteractiveAtlasSource,
    reconcile,
    inspect,
    cleanup,
  };
  return inspect();
})()
