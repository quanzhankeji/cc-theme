((cssText, artDataUrl, heroArtDataUrl, videoDataUrl, motionFallbackDataUrl, interactiveAtlasDataUrl, themeConfig, styleCatalogConfig, editorLocalesConfig, claudeLocaleCatalogConfig, uiAdapterConfig, createUiInterpreter, createClaudeLocaleRuntime, initialStyleOverrides, initialRuntimePreferences, initialStyleOverrideState, styleEditorNonce, styleEditorBinding, createBackgroundEffect) => {
  const STATE_KEY = "__CC_THEME_STATE__";
  const DISABLED_KEY = "__CC_THEME_DISABLED__";
  const STYLE_ID = "cc-theme-style";
  const VIDEO_LAYER_ID = "cc-theme-video-layer";
  const MOTION_FALLBACK_ID = "cc-theme-motion-fallback";
  const STYLE_EDITOR_ID = "cc-theme-style-editor";
  const STYLE_EDITOR_STATUS_ID = "cc-theme-style-editor-status";
  const STYLE_EDITOR_RESULT_KEY = "__CC_THEME_EDITOR_RESULT__";
  const THEME_RUNTIME_RESULT_KEY = "__CC_THEME_RUNTIME_RESULT__";
  const THEME_SETTINGS_NAV_ID = "cc-theme-settings-nav-item";
  const THEME_SETTINGS_PAGE_ID = "cc-theme-settings-page";
  const INTERACTIVE_LAYER_ID = "cc-theme-interactive-layer";
  const INTERACTIVE_MODE_ATTR = "data-skin-background-mode";
  const INTERACTIVE_STATE_ATTR = "data-skin-interactive-state";
  const DEFERRED_VIDEO_SOURCE = "cc-theme:deferred-video";
  const DEFERRED_MOTION_FALLBACK_SOURCE = "cc-theme:deferred-motion-fallback";
  const DEFERRED_INTERACTIVE_ATLAS_SOURCE = "cc-theme:deferred-interactive-atlas";
  const SHELL_ATTR = "data-skin-shell";
  const SURFACE_CONTEXT_ATTR = "data-skin-surface-context";
  const VIDEO_ATTR = "data-skin-video";
  const VIDEO_PLAYBACK_ATTR = "data-skin-video-playback";
  const VIDEO_POSTER_ATTR = "data-skin-video-poster";
  const ART_ATTRS = [
    "data-skin-art-wide", "data-skin-art-safe", "data-skin-task-mode",
    "data-skin-art-safe-area", "data-skin-art-task-mode", "data-skin-art-aspect",
    "data-skin-art-ready",
  ];
  const VERSION = __SKIN_VERSION_JSON__;
  const STYLE_REVISION = __SKIN_STYLE_REVISION_JSON__;
  const THEME = themeConfig && typeof themeConfig === "object" ? themeConfig : {};
  const STYLE_CATALOG = styleCatalogConfig && typeof styleCatalogConfig === "object" ? styleCatalogConfig : { groups: [], tokens: [] };
  const EDITOR_LOCALES = editorLocalesConfig && typeof editorLocalesConfig === "object"
    ? editorLocalesConfig : { defaultLocale: "en-US", locales: ["en-US"], messages: {}, groupLabels: {}, tokenLabels: {} };
  const CLAUDE_LOCALE_CATALOG = claudeLocaleCatalogConfig && typeof claudeLocaleCatalogConfig === "object"
    ? claudeLocaleCatalogConfig : {
      defaultLocale: "en-US",
      locales: ["en-US"],
      aliases: {},
      directions: { "en-US": "ltr" },
      fallback: { maximumDiagnosticLocaleLength: 35 },
    };
  const STYLE_TOKENS = Array.isArray(STYLE_CATALOG.tokens) ? STYLE_CATALOG.tokens.filter((token) =>
    token && typeof token.id === "string" && typeof token.cssVariable === "string") : [];
  const UI_ADAPTER = uiAdapterConfig && typeof uiAdapterConfig === "object" ? uiAdapterConfig : {};
  const uiInterpreter = createUiInterpreter({
    document,
    root: document.documentElement,
    config: UI_ADAPTER,
    roleAttribute: UI_ADAPTER.roleAttribute || "data-skin-role",
    markerValue: VERSION,
  });
  const supportedEditorLocales = Array.isArray(EDITOR_LOCALES.locales)
    ? EDITOR_LOCALES.locales : ["en-US"];
  const defaultEditorLocale = supportedEditorLocales.includes(CLAUDE_LOCALE_CATALOG.defaultLocale)
    ? CLAUDE_LOCALE_CATALOG.defaultLocale : supportedEditorLocales[0] || "en-US";
  let HOST_EFFECTIVE_LOCALE = null;
  let EDITOR_LOCALE = defaultEditorLocale;
  let EDITOR_LOCALE_INDEX = Math.max(0, supportedEditorLocales.indexOf(EDITOR_LOCALE));
  let EDITOR_LOCALE_DIRECTION = CLAUDE_LOCALE_CATALOG.directions?.[EDITOR_LOCALE] || "ltr";
  let LOCALE_DIAGNOSTIC_CODE = "host-locale-pending";
  let LOCALE_DIAGNOSTIC_INPUT = "";
  let applyEditorLocaleToUi = () => {};
  const localeRuntime = createClaudeLocaleRuntime({
    catalog: CLAUDE_LOCALE_CATALOG,
    bridge: globalThis["claude.hybrid"]?.DesktopIntl,
    onChange: (snapshot) => {
      if (window[DISABLED_KEY]) return;
      HOST_EFFECTIVE_LOCALE = snapshot.hostEffectiveLocale;
      EDITOR_LOCALE = snapshot.locale;
      EDITOR_LOCALE_DIRECTION = snapshot.direction;
      LOCALE_DIAGNOSTIC_CODE = snapshot.diagnosticCode;
      LOCALE_DIAGNOSTIC_INPUT = snapshot.diagnosticInput;
      EDITOR_LOCALE_INDEX = Math.max(0, supportedEditorLocales.indexOf(EDITOR_LOCALE));
      const runtime = window[STATE_KEY];
      if (runtime) {
        runtime.hostEffectiveLocale = HOST_EFFECTIVE_LOCALE;
        runtime.editorLocale = EDITOR_LOCALE;
        runtime.localeDirection = EDITOR_LOCALE_DIRECTION;
        runtime.localeDiagnosticCode = LOCALE_DIAGNOSTIC_CODE;
        runtime.localeSource = snapshot.source;
      }
      applyEditorLocaleToUi();
    },
  });
  const localizedEditorValue = (table, key, fallback = "") => {
    const values = table?.[key];
    if (!Array.isArray(values)) return fallback;
    const current = values[EDITOR_LOCALE_INDEX];
    if (typeof current === "string" && current) return current;
    const defaultIndex = Math.max(0, supportedEditorLocales.indexOf(defaultEditorLocale));
    return typeof values[defaultIndex] === "string" ? values[defaultIndex] : fallback;
  };
  const formatEditorMessage = (key, replacements = {}) => {
    let message = localizedEditorValue(EDITOR_LOCALES.messages, key);
    for (const [name, value] of Object.entries(replacements)) message = message.replaceAll(`{${name}}`, String(value));
    return message;
  };
  const localizedGroupLabel = (group) => localizedEditorValue(EDITOR_LOCALES.groupLabels, group.id);
  const localizedTokenLabel = (token) => localizedEditorValue(EDITOR_LOCALES.tokenLabels, token.id);
  const localizedNumber = (value) => {
    try { return new Intl.NumberFormat(EDITOR_LOCALE).format(value); } catch { return String(value); }
  };
  let styleOverrides = initialStyleOverrides && typeof initialStyleOverrides === "object" && !Array.isArray(initialStyleOverrides)
    ? { ...initialStyleOverrides } : {};
  let editorDraft = { ...styleOverrides };
  const STYLE_OVERRIDE_STATE = initialStyleOverrideState && typeof initialStyleOverrideState === "object"
    ? initialStyleOverrideState : { status: "absent", diagnosticCode: null, quarantinedTokenCount: 0 };
  const ART = THEME.art && typeof THEME.art === "object" ? THEME.art : {};
  const ART_METADATA = THEME.artMetadata && typeof THEME.artMetadata === "object"
    ? THEME.artMetadata : null;
  const ANALYSIS_CACHE_KEY = "__CC_THEME_ANALYSIS_CACHE__";
  const BRIDGE_ENABLED = THEME.themeBridgeEnabled === true;
  const VIDEO_POSTER_MODE = THEME.appearance?.backgroundVideoPosterMode === "image" ? "image" : "none";
  const VIDEO_SCRIM_OPACITY = Math.min(0.8, Math.max(0,
    Number(THEME.appearance?.backgroundVideoScrimOpacity) || 0));
  const INTERACTIVE = THEME.interactiveBackground &&
    ["ripple", "directional"].includes(THEME.interactiveBackground.type)
    ? THEME.interactiveBackground : null;
  const BACKGROUND_RENDER_MODE = INTERACTIVE?.type || "media";
  const INTERACTIVE_SCRIM_OPACITY = Math.min(0.8, Math.max(0,
    Number(INTERACTIVE?.scrimOpacity) || 0));
  const NATIVE_THEME_VARIABLES = [
    "--bg-000", "--bg-100", "--bg-200", "--bg-300", "--bg-400", "--bg-500",
    "--text-000", "--text-100", "--text-200", "--text-300", "--text-400", "--text-500",
    "--border-100", "--border-200", "--border-300", "--border-400",
    "--accent-000", "--accent-100", "--accent-200", "--accent-900", "--accent-brand",
    "--brand-000", "--brand-100", "--brand-200",
    "--font-ui", "--font-user-message", "--font-claude-response",
  ];
  const THEME_VARIABLES = [
    "--skin-bg", "--skin-panel", "--skin-panel-2", "--skin-green", "--skin-lime",
    "--skin-cyan", "--skin-purple", "--skin-text", "--skin-muted", "--skin-line",
    "--skin-surface-base", "--skin-surface-raised", "--skin-surface-elevated", "--skin-surface-code",
    "--skin-text-strong", "--skin-placeholder", "--skin-border-subtle", "--skin-border-default",
    "--skin-border-strong", "--skin-action", "--skin-action-hover", "--skin-action-pressed",
    "--skin-action-foreground", "--skin-hover-surface", "--skin-pressed-surface",
    "--skin-selected-surface", "--skin-selected-hover-surface", "--skin-focus-ring", "--skin-link",
    "--skin-danger", "--skin-success", "--skin-warning", "--skin-sidebar-surface",
    "--skin-header-surface", "--skin-main-scrim-start", "--skin-main-scrim-mid",
    "--skin-main-scrim-end", "--skin-composer-surface", "--skin-font-ui", "--skin-font-display",
    "--skin-font-code", "--skin-art-position", "--skin-hero-position", "--skin-video-position", "--skin-backdrop-blur", "--skin-backdrop-saturation",
    "--skin-video-scrim-color", "--skin-video-scrim-opacity", "--skin-interactive-scrim-opacity",
    "--skin-art-focus-x", "--skin-art-focus-y",
    "--skin-focus-x", "--skin-focus-y",
    "--skin-radius-scale", "--skin-radius-control", "--skin-radius-card", "--skin-radius-panel",
    "--skin-motion-duration",
    "--skin-active-art",
    "--skin-native-canvas", "--skin-native-sidebar",
    ...NATIVE_THEME_VARIABLES,
  ];
  window[DISABLED_KEY] = false;

  const existingAnalysisCache = window[ANALYSIS_CACHE_KEY];
  const analysisCache = existingAnalysisCache && typeof existingAnalysisCache.get === "function"
    && typeof existingAnalysisCache.set === "function" ? existingAnalysisCache : new Map();
  window[ANALYSIS_CACHE_KEY] = analysisCache;
  let artAnalysis = ART.analysis !== "off" && typeof THEME.artKey === "string"
    ? analysisCache.get(THEME.artKey) ?? null : null;
  let analysisTimer = null;
  const installToken = {};

  const previous = window[STATE_KEY];
  const previousThemeSettingsPageActive = previous?.themeSettingsPageActive === true;
  const previousStyleEditorStatus = previous?.styleEditorStatus &&
    typeof previous.styleEditorStatus.messageKey === "string"
    ? { ...previous.styleEditorStatus } : null;
  const previousEditorDraft = previous?.themeId === String(THEME.id || "custom") &&
    previous?.editorDraft && typeof previous.editorDraft === "object" && !Array.isArray(previous.editorDraft)
    ? { ...previous.editorDraft } : null;
  if (previousEditorDraft) editorDraft = previousEditorDraft;
  const ROOT_STYLE_VARIABLES = [...new Set([
    "--skin-art", "--skin-hero-art", ...THEME_VARIABLES,
  ])];
  // Preserve the host's inline values exactly. Most Claude theme tokens come
  // from stylesheets, so an empty entry means removing our inline override and
  // allowing the official cascade to become authoritative again.
  const rootStyleSnapshot = previous?.rootStyleSnapshot && typeof previous.rootStyleSnapshot === "object"
    ? previous.rootStyleSnapshot
    : Object.fromEntries(ROOT_STYLE_VARIABLES.map((name) => {
      if (previous) return [name, { value: "", priority: "" }];
      const root = document.documentElement;
      return [name, {
        value: root?.style.getPropertyValue(name) || "",
        priority: root?.style.getPropertyPriority?.(name) || "",
      }];
    }));
  const previousVideoUserPaused = previous?.videoUserPaused === true;
  const persistedBackgroundPresentation = ["playing", "paused", "disabled"]
    .includes(initialRuntimePreferences?.backgroundPresentation)
    ? initialRuntimePreferences.backgroundPresentation : "playing";
  const previousVideoPlaybackPreference = ["playing", "paused", "disabled"]
    .includes(previous?.videoPlaybackPreference)
    ? previous.videoPlaybackPreference
    : previousVideoUserPaused ? "paused" : persistedBackgroundPresentation;
  const previousRuntimeIssue = previous?.runtimeIssue && typeof previous.runtimeIssue === "object"
    ? { ...previous.runtimeIssue } : null;
  const previousInteractiveEffectEnabled = previous?.themeId === (THEME.id || "custom") &&
    previous?.backgroundRenderMode === BACKGROUND_RENDER_MODE
    ? previous.interactiveEffectEnabled !== false
    : initialRuntimePreferences?.interactiveEffectEnabled !== false;
  if (previous?.observer) previous.observer.disconnect();
  if (previous?.timer) clearInterval(previous.timer);
  if (previous?.scheduler?.timeout) clearTimeout(previous.scheduler.timeout);
  if (previous?.analysisTimer) clearTimeout(previous.analysisTimer);
  if (previous?.resizeHandler) window.removeEventListener("resize", previous.resizeHandler);
  previous?.localeRuntime?.dispose?.();
  if (previous?.mediaHandler && previous?.mediaQuery) {
    try { previous.mediaQuery.removeEventListener("change", previous.mediaHandler); } catch {}
  }
  if (previous?.motionMediaHandler && previous?.motionMediaQuery) {
    try { previous.motionMediaQuery.removeEventListener("change", previous.motionMediaHandler); } catch {}
  }
  if (previous?.visibilityHandler) document.removeEventListener("visibilitychange", previous.visibilityHandler);
  if (previous?.styleEditorOutsideHandler) document.removeEventListener("pointerdown", previous.styleEditorOutsideHandler, true);
  if (previous?.styleEditorKeyHandler) document.removeEventListener("keydown", previous.styleEditorKeyHandler, true);
  if (previous?.settingsNavNode && previous?.settingsNavClickHandler) {
    previous.settingsNavNode.removeEventListener("click", previous.settingsNavClickHandler, true);
  }
  previous?.uiInterpreter?.cleanup?.();
  previous?.restoreThemeSettingsPage?.();
  if (previous?.styleEditorRequestTimer) clearTimeout(previous.styleEditorRequestTimer);
  if (previous?.stylePersistenceDebounceTimer) clearTimeout(previous.stylePersistenceDebounceTimer);
  for (const request of previous?.stylePersistenceRequests?.values?.() || []) clearTimeout(request.timeout);
  if (previous?.styleEditorResultHandler && window[STYLE_EDITOR_RESULT_KEY] === previous.styleEditorResultHandler) {
    delete window[STYLE_EDITOR_RESULT_KEY];
  }
  if (previous?.runtimeResultHandler && window[THEME_RUNTIME_RESULT_KEY] === previous.runtimeResultHandler) {
    delete window[THEME_RUNTIME_RESULT_KEY];
  }
  previous?.interactiveController?.dispose?.();
  const previousVideo = document.getElementById(VIDEO_LAYER_ID)?.querySelector("video");
  if (previousVideo) {
    try {
      previousVideo.pause();
      previousVideo.removeAttribute("src");
      previousVideo.load();
    } catch {}
  }
  document.getElementById(VIDEO_LAYER_ID)?.remove();
  document.getElementById(INTERACTIVE_LAYER_ID)?.remove();
  document.getElementById(STYLE_EDITOR_ID)?.remove();
  document.getElementById(THEME_SETTINGS_NAV_ID)?.remove();
  document.getElementById(THEME_SETTINGS_PAGE_ID)?.remove();
  // Migrate layout tokens written by older bridge revisions back to the exact
  // host snapshot. They are intentionally no longer part of the active theme
  // variable set because even a radius token causes a visible enable/disable
  // geometry change on the native Composer.
  for (const name of ["--claude-corner-radius-scale"]) {
    const original = previous?.rootStyleSnapshot?.[name];
    if (!previous || !document.documentElement) continue;
    if (original?.value) {
      document.documentElement.style.setProperty(name, original.value, original.priority || "");
    } else {
      document.documentElement.style.removeProperty(name);
    }
  }
  if (previous?.videoArtUrl?.startsWith("blob:")) URL.revokeObjectURL(previous.videoArtUrl);
  if (previous?.motionFallbackUrl?.startsWith("blob:")) URL.revokeObjectURL(previous.motionFallbackUrl);
  if (previous?.interactiveAtlasUrl?.startsWith("blob:")) URL.revokeObjectURL(previous.interactiveAtlasUrl);
  if (previous?.heroArtUrl && previous.heroArtUrl !== previous.artUrl) URL.revokeObjectURL(previous.heroArtUrl);
  if (previous?.artUrl) URL.revokeObjectURL(previous.artUrl);

  const objectUrlFromDataUrl = (dataUrl) => {
    const comma = dataUrl.indexOf(",");
    const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] || "image/png";
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  };
  const artUrl = objectUrlFromDataUrl(artDataUrl);
  const heroArtUrl = heroArtDataUrl ? objectUrlFromDataUrl(heroArtDataUrl) : artUrl;
  const videoEnabled = Boolean(videoDataUrl);
  let videoArtUrl = videoDataUrl && videoDataUrl !== DEFERRED_VIDEO_SOURCE
    ? videoDataUrl.startsWith("data:") ? objectUrlFromDataUrl(videoDataUrl) : videoDataUrl
    : null;
  const motionFallbackEnabled = Boolean(motionFallbackDataUrl);
  let motionFallbackUrl = motionFallbackDataUrl &&
    motionFallbackDataUrl !== DEFERRED_MOTION_FALLBACK_SOURCE
    ? motionFallbackDataUrl.startsWith("data:")
      ? objectUrlFromDataUrl(motionFallbackDataUrl) : motionFallbackDataUrl
    : null;
  const staticArtworkEnabled = !videoEnabled || VIDEO_POSTER_MODE === "image";
  const interactiveEnabled = Boolean(INTERACTIVE);
  let interactiveAtlasUrl = interactiveAtlasDataUrl &&
    interactiveAtlasDataUrl !== DEFERRED_INTERACTIVE_ATLAS_SOURCE
    ? interactiveAtlasDataUrl.startsWith("data:")
      ? objectUrlFromDataUrl(interactiveAtlasDataUrl) : interactiveAtlasDataUrl
    : null;
  let interactiveEffectEnabled = previousInteractiveEffectEnabled;
  let interactiveController = null;
  let interactiveRuntimeState = interactiveEnabled ? "loading" : "none";
  let interactiveFatalFallback = false;
  let videoPlaybackPreference = previousVideoPlaybackPreference;
  let videoUserPaused = videoPlaybackPreference !== "playing";
  let videoPlaybackEpoch = 0;
  let motionMediaQuery = null;
  try { motionMediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch {}
  motionMediaQuery ||= { matches: false, addEventListener() {}, removeEventListener() {} };

  const genericFontFamilies = new Set([
    "serif", "sans-serif", "monospace", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace",
  ]);
  const fontStack = (families, fallback) => {
    if (!Array.isArray(families) || !families.length) return fallback;
    return families.map((family) => genericFontFamilies.has(family) ? family : JSON.stringify(family)).join(", ");
  };

  const setStyleProperty = (root, name, value) => {
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  };

  const restoreRootStyleSnapshot = () => {
    const root = document.documentElement;
    if (!root) return;
    for (const name of ROOT_STYLE_VARIABLES) {
      const original = rootStyleSnapshot[name];
      if (original?.value) root.style.setProperty(name, original.value, original.priority || "");
      else root.style.removeProperty(name);
    }
  };

  const restoreNativeAppearance = () => {
    const root = document.documentElement;
    if (!root) return;
    root.classList.remove("cc-theme");
    root.removeAttribute(SHELL_ATTR);
    root.removeAttribute("data-skin-theme-bridge");
    root.removeAttribute("data-skin-theme-id");
    root.removeAttribute(SURFACE_CONTEXT_ATTR);
    root.removeAttribute(INTERACTIVE_MODE_ATTR);
    root.removeAttribute(INTERACTIVE_STATE_ATTR);
    for (const name of ART_ATTRS) root.removeAttribute(name);
    restoreRootStyleSnapshot();
    document.querySelectorAll("[data-skin-marker]").forEach((node) => {
      node.removeAttribute("data-skin-role");
      node.removeAttribute("data-skin-marker");
      node.removeAttribute("data-skin-overlay-kind");
    });
  };

  const setAttribute = (root, name, value) => {
    const normalized = String(value);
    if (root.getAttribute(name) !== normalized) root.setAttribute(name, normalized);
  };

  const parseRgb = (value) => {
    if (!value || value === "transparent") return null;
    const hex = String(value).trim().match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      const number = Number.parseInt(hex[1], 16);
      return { r: number >> 16, g: (number >> 8) & 255, b: number & 255 };
    }
    const m = String(value).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (!m) return null;
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const rgbToHex = ({ r, g, b }) => `#${[r, g, b]
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;

  const rgbToHsl = ({ r, g, b }) => {
    const values = [r, g, b].map((value) => value / 255);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const lightness = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: lightness };
    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue;
    if (max === values[0]) hue = (values[1] - values[2]) / delta + (values[1] < values[2] ? 6 : 0);
    else if (max === values[1]) hue = (values[2] - values[0]) / delta + 2;
    else hue = (values[0] - values[1]) / delta + 4;
    return { h: hue * 60, s: saturation, l: lightness };
  };

  const hslToRgb = ({ h, s, l }) => {
    const hue = ((h % 360) + 360) % 360 / 360;
    if (s === 0) {
      const neutral = Math.round(l * 255);
      return { r: neutral, g: neutral, b: neutral };
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (offset) => {
      let t = hue + offset;
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return { r: channel(1 / 3) * 255, g: channel(0) * 255, b: channel(-1 / 3) * 255 };
  };

  const luminance = ({ r, g, b }) => {
    const lin = [r, g, b].map((c) => {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };

  /** Detect Claude app light/dark shell for CSS branching. */
  const detectShellMode = () => {
    const root = document.documentElement;
    const body = document.body;
    const cls = `${root.className || ""} ${body?.className || ""}`.toLowerCase();

    if (/\b(dark|theme-dark|appearance-dark)\b/.test(cls)) return "dark";
    if (/\b(light|theme-light|appearance-light)\b/.test(cls)) return "light";

    const dataTheme = (
      root.getAttribute("data-mode") ||
      root.getAttribute("data-theme") ||
      root.getAttribute("data-appearance") ||
      root.getAttribute("data-color-mode") ||
      body?.getAttribute("data-theme") ||
      body?.getAttribute("data-appearance") ||
      ""
    ).toLowerCase();
    if (dataTheme.includes("dark")) return "dark";
    if (dataTheme.includes("light")) return "light";

    try {
      const cs = getComputedStyle(root).colorScheme || "";
      if (cs.includes("dark") && !cs.includes("light")) return "dark";
      if (cs.includes("light") && !cs.includes("dark")) return "light";
    } catch {}

    // Background luminance of main surfaces
    const samples = [
      body,
      document.querySelector("main.dframe-content"),
      document.querySelector("[role=region].dframe-pane-primary"),
      document.querySelector("aside.dframe-sidebar"),
    ].filter(Boolean);
    let votesLight = 0;
    let votesDark = 0;
    for (const el of samples) {
      try {
        const rgb = parseRgb(getComputedStyle(el).backgroundColor);
        if (!rgb) continue;
        const L = luminance(rgb);
        if (L >= 0.55) votesLight += 1;
        else if (L <= 0.25) votesDark += 1;
      } catch {}
    }
    if (votesLight > votesDark) return "light";
    if (votesDark > votesLight) return "dark";

    try {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    } catch {}
    return "light";
  };

  const makeAdaptivePalette = (sample, shell) => {
    const source = sample || { r: 108, g: 126, b: 136 };
    const hsl = rgbToHsl(source);
    const hue = hsl.s < 0.12 ? 214 : hsl.h;
    const saturation = clamp(hsl.s, 0.38, 0.72);
    const accent = hslToRgb({ h: hue, s: saturation, l: shell === "light" ? 0.42 : 0.66 });
    const accentAlt = hslToRgb({ h: hue + 12, s: saturation * 0.82, l: shell === "light" ? 0.52 : 0.73 });
    const secondary = hslToRgb({ h: hue - 24, s: saturation * 0.64, l: shell === "light" ? 0.56 : 0.62 });
    const highlight = hslToRgb({ h: hue + 24, s: saturation * 0.76, l: shell === "light" ? 0.36 : 0.58 });
    const neutral = (lightness, chroma = 0.08) => rgbToHex(hslToRgb({ h: hue, s: chroma, l: lightness }));
    const neutralAlpha = (lightness, chroma, alpha) => {
      const value = hslToRgb({ h: hue, s: chroma, l: lightness });
      return `rgba(${Math.round(value.r)}, ${Math.round(value.g)}, ${Math.round(value.b)}, ${alpha})`;
    };
    return shell === "light" ? {
      background: neutralAlpha(0.965, 0.07, 0.12),
      panel: neutralAlpha(0.987, 0.035, 0.58),
      panelAlt: neutralAlpha(0.945, 0.09, 0.68),
      accent: rgbToHex(accent),
      accentAlt: rgbToHex(accentAlt),
      secondary: rgbToHex(secondary),
      highlight: rgbToHex(highlight),
      text: neutral(0.13, 0.10),
      muted: neutral(0.42, 0.08),
      line: `rgba(${Math.round(accent.r)}, ${Math.round(accent.g)}, ${Math.round(accent.b)}, .24)`,
    } : {
      background: neutralAlpha(0.055, 0.045, 0.12),
      panel: neutralAlpha(0.085, 0.04, 0.58),
      panelAlt: neutralAlpha(0.125, 0.05, 0.68),
      accent: rgbToHex(accent),
      accentAlt: rgbToHex(accentAlt),
      secondary: rgbToHex(secondary),
      highlight: rgbToHex(highlight),
      text: neutral(0.93, 0.025),
      muted: neutral(0.69, 0.03),
      line: `rgba(${Math.round(accent.r)}, ${Math.round(accent.g)}, ${Math.round(accent.b)}, .28)`,
    };
  };

  const resolvedShellMode = () => {
    if (THEME.shellMode === "light" || THEME.shellMode === "dark") return THEME.shellMode;
    return detectShellMode();
  };

  // In system mode, inherit Claude's current light/dark text, action and status
  // colors. Native surface colors are not copied into the translucent media
  // bridge; they are captured separately for the explicit media-disabled state.
  // Remove our prior inline mappings synchronously while reading so an app
  // appearance change can be observed without restarting the injector.
  const captureNativeSystemPalette = (root) => {
    if (!root?.style || typeof getComputedStyle !== "function") {
      return { colors: {}, semanticColors: {}, surfaces: {} };
    }
    const previous = new Map();
    for (const name of NATIVE_THEME_VARIABLES) {
      const value = root.style.getPropertyValue(name);
      if (value) previous.set(name, value);
      root.style.removeProperty(name);
    }
    let computed;
    try {
      computed = getComputedStyle(root);
    } catch {}
    const read = (...names) => {
      for (const name of names) {
        const computedValue = String(computed?.getPropertyValue?.(name) || "").trim();
        if (computedValue && !computedValue.includes("--skin-")) {
          return /^(?:--bg|--text|--border|--accent|--brand)-/.test(name)
            ? `hsl(${computedValue})` : computedValue;
        }
        const inlineValue = String(previous.get(name) || "").trim();
        if (inlineValue && !inlineValue.includes("--skin-")) {
          return /^(?:--bg|--text|--border|--accent|--brand)-/.test(name)
            ? `hsl(${inlineValue})` : inlineValue;
        }
      }
      return undefined;
    };
    const compact = (values) => Object.fromEntries(
      Object.entries(values).filter(([, value]) => typeof value === "string" && value),
    );
    const colors = compact({
      accent: read("--accent-100", "--brand-100"),
      accentAlt: read("--accent-200", "--brand-200"),
      secondary: read("--accent-000", "--brand-000"),
      highlight: read("--accent-brand", "--brand-200"),
      text: read("--text-100", "--text-000"),
      muted: read("--text-400", "--text-300"),
      line: read("--border-200", "--border-100"),
    });
    const semanticColors = compact({
      textStrong: read("--text-000", "--text-100"),
      placeholder: read("--text-500", "--text-400"),
      borderSubtle: read("--border-100"),
      borderDefault: read("--border-200"),
      borderStrong: read("--border-400", "--border-300"),
      action: read("--accent-100", "--brand-100"),
      actionHover: read("--accent-200", "--brand-200"),
      actionPressed: read("--accent-000", "--brand-000"),
      actionForeground: read("--bg-000"),
      focusRing: read("--accent-100"),
      link: read("--accent-100"),
    });
    const surfaces = compact({
      canvas: read("--bg-100", "--bg-000"),
      sidebar: read("--bg-200", "--bg-100"),
    });
    for (const [name, value] of previous) root.style.setProperty(name, value);
    return { colors, semanticColors, surfaces };
  };

  const applyArtAnalysis = (root) => {
    const profile = artAnalysis || ART_METADATA;
    const inferredSafe = profile?.safeArea || "center";
    const safeArea = ART.safeArea && ART.safeArea !== "auto" ? ART.safeArea : inferredSafe;
    const canonicalSafe = ["left", "right", "center", "none"].includes(safeArea)
      ? safeArea : "center";
    const focusX = typeof ART.focusX === "number" ? ART.focusX
      : profile?.focusX ?? (safeArea === "left" ? 0.72 : safeArea === "right" ? 0.28 : 0.5);
    const focusY = typeof ART.focusY === "number" ? ART.focusY : profile?.focusY ?? 0.5;
    const taskMode = ART.taskMode && ART.taskMode !== "auto"
      ? ART.taskMode : profile?.taskMode || "ambient";
    const focusXValue = `${(clamp(focusX, 0, 1) * 100).toFixed(2)}%`;
    const focusYValue = `${(clamp(focusY, 0, 1) * 100).toFixed(2)}%`;

    setAttribute(root, "data-skin-art-wide", profile?.wide ? "true" : "false");
    setAttribute(root, "data-skin-art-safe", canonicalSafe);
    setAttribute(root, "data-skin-task-mode", taskMode);
    setAttribute(root, "data-skin-art-safe-area", safeArea);
    setAttribute(root, "data-skin-art-task-mode", taskMode);
    setAttribute(root, "data-skin-art-aspect", profile?.aspect || "unknown");
    setAttribute(root, "data-skin-art-ready", artAnalysis ? "true" : "false");
    setStyleProperty(root, "--skin-art-focus-x", focusXValue);
    setStyleProperty(root, "--skin-art-focus-y", focusYValue);
    setStyleProperty(root, "--skin-focus-x", focusXValue);
    setStyleProperty(root, "--skin-focus-y", focusYValue);
    if (!THEME.appearance?.backgroundPositionExplicit && !videoEnabled) {
      setStyleProperty(root, "--skin-art-position", `${focusXValue} ${focusYValue}`);
    }
  };

  const analyzeArt = () => new Promise((resolve) => {
    if (ART.analysis === "off" || typeof window.Image !== "function" || !document?.createElement) {
      resolve(null);
      return;
    }
    const image = new window.Image();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (analysisTimer) clearTimeout(analysisTimer);
      analysisTimer = null;
      resolve(value);
    };
    analysisTimer = setTimeout(() => finish(null), 6000);
    image.onerror = () => finish(null);
    image.onload = () => {
      try {
        const ratio = image.naturalWidth / image.naturalHeight;
        if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("Invalid image dimensions");
        const maxDimension = 96;
        const width = Math.max(16, Math.round(ratio >= 1 ? maxDimension : maxDimension * ratio));
        const height = Math.max(16, Math.round(ratio >= 1 ? maxDimension / ratio : maxDimension));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext?.("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable");
        context.drawImage(image, 0, 0, width, height);
        const data = context.getImageData(0, 0, width, height).data;
        const samples = new Array(width * height);
        const bins = Array.from({ length: 24 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
        let lightTotal = 0;
        let count = 0;

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 4;
            if (data[offset + 3] < 32) continue;
            const rgb = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
            const light = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
            const hsl = rgbToHsl(rgb);
            samples[y * width + x] = { light, saturation: hsl.s };
            lightTotal += light;
            count += 1;
            if (hsl.s >= 0.16 && hsl.l >= 0.16 && hsl.l <= 0.86) {
              const bin = bins[Math.min(23, Math.floor(hsl.h / 15))];
              const weight = hsl.s * (1 - Math.abs(hsl.l - 0.52) * 0.85);
              bin.weight += weight;
              bin.r += rgb.r * weight;
              bin.g += rgb.g * weight;
              bin.b += rgb.b * weight;
            }
          }
        }
        if (!count) throw new Error("Image has no visible pixels");
        const brightness = lightTotal / count;
        const information = (start, end) => {
          let total = 0;
          let totalSquared = 0;
          let edges = 0;
          let edgeCount = 0;
          let pixels = 0;
          for (let y = 0; y < height; y += 1) {
            for (let x = start; x < end; x += 1) {
              const sample = samples[y * width + x];
              if (!sample) continue;
              total += sample.light;
              totalSquared += sample.light * sample.light;
              pixels += 1;
              const previousSample = x > start ? samples[y * width + x - 1] : null;
              const above = y > 0 ? samples[(y - 1) * width + x] : null;
              if (previousSample) { edges += Math.abs(sample.light - previousSample.light); edgeCount += 1; }
              if (above) { edges += Math.abs(sample.light - above.light); edgeCount += 1; }
            }
          }
          const mean = pixels ? total / pixels : 0;
          const variance = pixels ? Math.max(0, totalSquared / pixels - mean * mean) : 1;
          return Math.sqrt(variance) * 0.58 + (edgeCount ? edges / edgeCount : 1) * 0.42;
        };
        const zoneWidth = Math.max(1, Math.floor(width * 0.38));
        const leftInformation = information(0, zoneWidth);
        const rightInformation = information(width - zoneWidth, width);
        let safeArea = "center";
        if (leftInformation < rightInformation * 0.86) safeArea = "left";
        else if (rightInformation < leftInformation * 0.86) safeArea = "right";

        let saliencyTotal = 0;
        let saliencyX = 0;
        let saliencyY = 0;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const sample = samples[y * width + x];
            if (!sample) continue;
            const previousSample = x > 0 ? samples[y * width + x - 1] : null;
            const above = y > 0 ? samples[(y - 1) * width + x] : null;
            const edge = (previousSample ? Math.abs(sample.light - previousSample.light) : 0)
              + (above ? Math.abs(sample.light - above.light) : 0);
            const weight = 0.01 + Math.abs(sample.light - brightness) * 0.48
              + sample.saturation * 0.34 + edge * 0.28;
            saliencyTotal += weight;
            saliencyX += (x + 0.5) / width * weight;
            saliencyY += (y + 0.5) / height * weight;
          }
        }
        let focusX = saliencyTotal ? saliencyX / saliencyTotal : 0.5;
        let focusY = saliencyTotal ? saliencyY / saliencyTotal : 0.5;
        if (safeArea === "left") focusX = Math.max(0.64, focusX);
        if (safeArea === "right") focusX = Math.min(0.36, focusX);
        focusX = clamp(focusX, 0.12, 0.88);
        focusY = clamp(focusY, 0.18, 0.82);

        const accentBin = bins.reduce((best, candidate) => candidate.weight > best.weight ? candidate : best, bins[0]);
        const accentRgb = accentBin.weight > 0 ? {
          r: accentBin.r / accentBin.weight,
          g: accentBin.g / accentBin.weight,
          b: accentBin.b / accentBin.weight,
        } : null;
        const aspect = ratio >= 2.25 ? "ultrawide" : ratio >= 1.45 ? "wide"
          : ratio >= 1.08 ? "landscape" : ratio >= 0.9 ? "square" : "portrait";
        finish({
          width: image.naturalWidth,
          height: image.naturalHeight,
          ratio,
          wide: ratio >= 1.75,
          aspect,
          brightness,
          safeArea,
          focusX,
          focusY,
          taskMode: ratio >= 2.25 ? "banner" : "ambient",
          accentRgb,
        });
      } catch {
        finish(null);
      }
    };
    image.src = artUrl;
  });

  const applyTheme = (root, shell) => {
    const colors = THEME.colors || {};
    const explicit = new Set(Array.isArray(THEME.explicitColorKeys) ? THEME.explicitColorKeys : []);
    const explicitSemantic = new Set(Array.isArray(THEME.explicitSemanticColorKeys) ? THEME.explicitSemanticColorKeys : []);
    const adaptive = makeAdaptivePalette(artAnalysis?.accentRgb, shell);
    const paletteMode = ART.paletteMode === "media" || (ART.paletteMode === undefined && ART.adaptivePalette === true)
      ? "media" : "system";
    const adaptiveEnabled = paletteMode === "media" && Boolean(artAnalysis);
    const nativeSystemPalette = paletteMode === "system"
      ? captureNativeSystemPalette(root) : { colors: {}, semanticColors: {}, surfaces: {} };
    const resolvedPalette = THEME.resolvedPalettes?.[shell] || {};
    const fallbackColors = resolvedPalette.colors || (shell === "light" ? {
      background: "rgba(255, 255, 255, .12)", panel: "rgba(255, 255, 255, .58)", panelAlt: "rgba(246, 246, 246, .68)",
      accent: "#007aff", accentAlt: "#0a84ff", secondary: "#5e5ce6",
      highlight: "#007aff", text: "#1d1d1f", muted: "#5f6368",
      line: "rgba(60, 60, 67, .22)",
    } : {
      background: "rgba(0, 0, 0, .12)", panel: "rgba(28, 28, 30, .58)", panelAlt: "rgba(44, 44, 46, .68)",
      accent: "#0a84ff", accentAlt: "#409cff", secondary: "#64d2ff",
      highlight: "#5e5ce6", text: "#f5f5f7", muted: "#a1a1a6",
      line: "rgba(235, 235, 245, .2)",
    });
    // The normalized theme carries a dark compatibility palette in THEME.colors
    // even when no color was explicitly authored. Likewise, Claude can expose
    // stale dark native tokens for one render pass after switching to light.
    // System mode therefore treats the shell-specific resolved palette as the
    // source of truth; only explicitly authored colors or media mode may replace
    // it. Native surfaces remain useful for the media-disabled solid canvas.
    const defaults = fallbackColors;
    const pick = (name) => explicit.has(name) && typeof colors[name] === "string"
      ? colors[name] : adaptiveEnabled ? adaptive[name] : defaults[name];
    const variables = {
      "--skin-bg": pick("background"),
      "--skin-panel": pick("panel"),
      "--skin-panel-2": pick("panelAlt"),
      "--skin-green": pick("accent"),
      "--skin-lime": pick("accentAlt") || pick("accent"),
      "--skin-cyan": pick("secondary"),
      "--skin-purple": pick("highlight"),
      "--skin-text": pick("text"),
      "--skin-muted": pick("muted"),
      "--skin-line": pick("line"),
      "--skin-native-canvas": nativeSystemPalette.surfaces.canvas ||
        (shell === "light" ? "#ffffff" : "#1c1c1e"),
      "--skin-native-sidebar": nativeSystemPalette.surfaces.sidebar ||
        (shell === "light" ? "#f5f5f7" : "#242426"),
    };

    if (BRIDGE_ENABLED) {
      const semantic = THEME.semanticColors || {};
      const systemSemantic = resolvedPalette.semanticColors || {};
      const adaptiveSemantic = adaptiveEnabled ? {
        surfaceBase: variables["--skin-panel"],
        surfaceRaised: variables["--skin-panel-2"],
        surfaceElevated: `color-mix(in srgb, ${variables["--skin-panel-2"]} 88%, ${variables["--skin-text"]} 12%)`,
        surfaceCode: `color-mix(in srgb, ${variables["--skin-bg"]} 88%, ${variables["--skin-panel"]})`,
        textStrong: variables["--skin-text"],
        placeholder: variables["--skin-muted"],
        borderSubtle: variables["--skin-line"],
        borderDefault: variables["--skin-line"],
        borderStrong: variables["--skin-green"],
        action: variables["--skin-green"],
        actionHover: variables["--skin-lime"],
        actionPressed: variables["--skin-purple"],
        focusRing: variables["--skin-green"],
        link: variables["--skin-cyan"],
        sidebarSurface: `color-mix(in srgb, ${variables["--skin-panel"]} 82%, transparent)`,
        headerSurface: `color-mix(in srgb, ${variables["--skin-panel"]} 68%, transparent)`,
        composerSurface: `color-mix(in srgb, ${variables["--skin-panel-2"]} 88%, transparent)`,
      } : {};
      const semanticDefaults = { ...systemSemantic, ...adaptiveSemantic };
      const semanticPick = (name, fallback) => explicitSemantic.has(name) && typeof semantic[name] === "string"
        ? semantic[name] : semanticDefaults[name] || fallback;
      const appearance = THEME.appearance || {};
      const position = appearance.backgroundPosition || { xPercent: 70, yPercent: 50 };
      const videoPosition = appearance.backgroundVideoPosition || position;
      const radiusScale = appearance.radiusScale ?? 1;
      Object.assign(variables, {
        "--skin-surface-base": semanticPick("surfaceBase", variables["--skin-panel"]),
        "--skin-surface-raised": semanticPick("surfaceRaised", variables["--skin-panel-2"]),
        "--skin-surface-elevated": semanticPick("surfaceElevated", variables["--skin-panel-2"]),
        "--skin-surface-code": semanticPick("surfaceCode", variables["--skin-bg"]),
        "--skin-text-strong": semanticPick("textStrong", variables["--skin-text"]),
        "--skin-placeholder": semanticPick("placeholder", variables["--skin-muted"]),
        "--skin-border-subtle": semanticPick("borderSubtle", variables["--skin-line"]),
        "--skin-border-default": semanticPick("borderDefault", variables["--skin-line"]),
        "--skin-border-strong": semanticPick("borderStrong", variables["--skin-green"]),
        "--skin-action": semanticPick("action", variables["--skin-green"]),
        "--skin-action-hover": semanticPick("actionHover", variables["--skin-cyan"]),
        "--skin-action-pressed": semanticPick("actionPressed", variables["--skin-purple"]),
        "--skin-action-foreground": semanticPick("actionForeground", variables["--skin-text"]),
        "--skin-hover-surface": semanticPick("hoverSurface", "rgba(10, 132, 255, .14)"),
        "--skin-pressed-surface": semanticPick("pressedSurface", "rgba(10, 132, 255, .22)"),
        "--skin-selected-surface": semanticPick("selectedSurface", "rgba(10, 132, 255, .24)"),
        "--skin-selected-hover-surface": semanticPick("selectedHoverSurface", "rgba(10, 132, 255, .32)"),
        "--skin-focus-ring": semanticPick("focusRing", variables["--skin-green"]),
        "--skin-link": semanticPick("link", variables["--skin-cyan"]),
        "--skin-danger": semanticPick("danger", "#ff6961"),
        "--skin-success": semanticPick("success", "#30d158"),
        "--skin-warning": semanticPick("warning", "#ffd60a"),
        "--skin-sidebar-surface": semanticPick("sidebarSurface", "rgba(18, 18, 20, .5)"),
        "--skin-header-surface": semanticPick("headerSurface", "rgba(18, 18, 20, .4)"),
        "--skin-main-scrim-start": semanticPick("mainScrimStart", "rgba(0, 0, 0, .22)"),
        "--skin-main-scrim-mid": semanticPick("mainScrimMid", "rgba(0, 0, 0, .11)"),
        "--skin-main-scrim-end": semanticPick("mainScrimEnd", "rgba(0, 0, 0, .03)"),
        "--skin-composer-surface": semanticPick("composerSurface", "rgba(28, 28, 30, .8)"),
        "--skin-font-ui": fontStack(THEME.fonts?.ui, "system-ui, sans-serif"),
        "--skin-font-display": fontStack(THEME.fonts?.display, "system-ui, sans-serif"),
        "--skin-font-code": fontStack(THEME.fonts?.code, "Menlo, monospace"),
        "--skin-art-position": `${position.xPercent}% ${position.yPercent}%`,
        "--skin-hero-position": `${appearance.homeHeroPosition?.xPercent ?? position.xPercent}% ${appearance.homeHeroPosition?.yPercent ?? position.yPercent}%`,
        "--skin-video-position": `${videoPosition.xPercent}% ${videoPosition.yPercent}%`,
        "--skin-video-scrim-color": shell === "light" ? "#ffffff" : "#000000",
        "--skin-video-scrim-opacity": String(VIDEO_SCRIM_OPACITY),
        "--skin-backdrop-blur": `${appearance.backdropBlurPx ?? 18}px`,
        "--skin-backdrop-saturation": String(appearance.backdropSaturation ?? 1),
        "--skin-radius-scale": String(radiusScale),
        "--skin-radius-control": `${Math.round(8 * radiusScale * 100) / 100}px`,
        "--skin-radius-card": `${Math.round(14 * radiusScale * 100) / 100}px`,
        "--skin-radius-panel": `${Math.round(16 * radiusScale * 100) / 100}px`,
        "--skin-motion-duration": "150ms",
        // Claude's --bg-*, --text-* and --accent-* variables contain HSL
        // channel triples rather than complete CSS colors. The adapter keeps
        // those host variables native and maps portable --skin-* values onto
        // verified semantic surfaces in skin.css.
      });
    }

    for (const [name, value] of Object.entries(variables)) {
      if (typeof value === "string" && value) {
        root.style.setProperty(name, value);
        if (!THEME_VARIABLES.includes(name)) THEME_VARIABLES.push(name);
      }
    }
  };

  const editorValueIsValid = (token, value) => {
    if (token.type === "color") {
      return typeof value === "string" && /^(?:#[0-9A-Fa-f]{6}|rgba?\([0-9., %]+\))$/.test(value.trim());
    }
    if (token.type === "fontList") {
      return Array.isArray(value) && value.length >= 1 && value.length <= 8 &&
        value.every((item) => typeof item === "string" && /^[\p{L}\p{N} ._-]{1,80}$/u.test(item.trim()));
    }
    return token.type === "number" && Number.isFinite(value) &&
      value >= token.minimum && value <= token.maximum;
  };

  const editorCssValue = (token, value) => token.type === "fontList" ? value.join(", ")
    : token.type === "number" ? `${value}${token.unit || ""}` : value;

  const applyStyleOverrides = (root, values = editorDraft) => {
    if (!root) return;
    for (const token of STYLE_TOKENS) {
      if (!Object.hasOwn(values, token.id) || !editorValueIsValid(token, values[token.id])) continue;
      root.style.setProperty(token.cssVariable, editorCssValue(token, values[token.id]));
    }
  };

  const themeVisualsAreDisabled = () => videoEnabled && videoPlaybackPreference === "disabled";

  // The dedicated settings page is owned by this adapter and must not change
  // typography, radii or spacing when the host theme is bypassed. In that
  // state the host root is restored completely, while a private copy of the
  // semantic presentation variables stays scoped to our page only.
  const syncOwnedThemeSettingsPresentation = (values = editorDraft) => {
    const page = document.getElementById(THEME_SETTINGS_PAGE_ID);
    if (!page) return;
    const disabled = themeVisualsAreDisabled();
    page.dataset.themeVisualPresentation = disabled ? "native" : "theme";
    for (const name of THEME_VARIABLES) page.style.removeProperty(name);
    if (!disabled) return;
    applyTheme(page, resolvedShellMode());
    applyStyleOverrides(page, values);
  };

  const previewStyleOverrides = () => {
    if (themeVisualsAreDisabled()) {
      syncOwnedThemeSettingsPresentation();
      return;
    }
    applyStyleOverrides(document.documentElement);
  };

  const existingStyle = document.getElementById(STYLE_ID);
  if (existingStyle) {
    existingStyle.textContent = cssText;
    existingStyle.dataset.skinVersion = VERSION;
  }

  const getVideoElement = () => document.getElementById(VIDEO_LAYER_ID)?.querySelector("video") || null;
  const getMotionFallbackElement = () => document.getElementById(MOTION_FALLBACK_ID);

  const cancelVideoFrameConfirmation = (video) => {
    if (!video) return;
    if (video.__ccThemeFrameCallbackId != null && typeof video.cancelVideoFrameCallback === "function") {
      try { video.cancelVideoFrameCallback(video.__ccThemeFrameCallbackId); } catch {}
    }
    if (video.__ccThemeFrameFallbackTimer) clearTimeout(video.__ccThemeFrameFallbackTimer);
    if (video.__ccThemePauseRetryTimer) clearTimeout(video.__ccThemePauseRetryTimer);
    delete video.__ccThemeFrameCallbackId;
    delete video.__ccThemeFrameFallbackTimer;
    delete video.__ccThemePauseRetryTimer;
  };

  const confirmVideoFrame = (video, playbackEpoch) => {
    if (!video) return;
    cancelVideoFrameConfirmation(video);
    const confirm = () => {
      delete video.__ccThemeFrameCallbackId;
      delete video.__ccThemeFrameFallbackTimer;
      if (playbackEpoch !== videoPlaybackEpoch || videoPlaybackPreference !== "playing") return;
      video.dataset.skinPlaybackState = !video.paused && video.readyState >= 2 ? "playing" : "loading";
      updateStyleEditorEffectControl();
    };
    if (typeof video.requestVideoFrameCallback === "function") {
      video.__ccThemeFrameCallbackId = video.requestVideoFrameCallback(confirm);
      return;
    }
    const startingTime = video.currentTime;
    video.__ccThemeFrameFallbackTimer = setTimeout(() => {
      if (video.currentTime > startingTime && !video.paused) confirm();
      else {
        delete video.__ccThemeFrameFallbackTimer;
        if (playbackEpoch === videoPlaybackEpoch && videoPlaybackPreference === "playing") {
          video.dataset.skinPlaybackState = "loading";
          updateStyleEditorEffectControl();
        }
      }
    }, 180);
  };

  const disposeOwnedVideoLayer = (layer) => {
    videoPlaybackEpoch += 1;
    const video = layer?.querySelector("video");
    if (video) {
      try {
        cancelVideoFrameConfirmation(video);
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {}
    }
    layer?.remove();
  };

  const persistVideoPlaybackPreference = () => {
    videoUserPaused = videoPlaybackPreference !== "playing";
    const state = window[STATE_KEY];
    if (!state) return;
    state.videoPlaybackPreference = videoPlaybackPreference;
    state.videoUserPaused = videoUserPaused;
    state.skinAppearanceActive = videoPlaybackPreference !== "disabled";
  };

  const applyVideoPresentationState = () => {
    if (!videoEnabled) return;
    const root = document.documentElement;
    const layer = document.getElementById(VIDEO_LAYER_ID);
    const disabled = videoPlaybackPreference === "disabled";
    root?.setAttribute(VIDEO_ATTR, disabled ? "disabled" : "enabled");
    root?.setAttribute(VIDEO_PLAYBACK_ATTR, videoPlaybackPreference);
    if (layer) {
      if (disabled) layer.setAttribute("hidden", "");
      else layer.removeAttribute("hidden");
      layer.dataset.skinPlaybackPreference = videoPlaybackPreference;
    }
    // Disabled means a full visual bypass, not a Skin-colored approximation of
    // the native client. Keep only the hidden media node and native-looking
    // toggle so the state remains reversible.
    if (disabled) {
      restoreNativeAppearance();
      syncOwnedThemeSettingsPresentation();
    } else {
      syncOwnedThemeSettingsPresentation();
      root?.style.setProperty("--skin-active-art", staticArtworkEnabled ? `url("${artUrl}")` : "none");
      root?.style.setProperty("--skin-hero-art", heroArtDataUrl
        ? `url("${heroArtUrl}")`
        : staticArtworkEnabled ? `url("${artUrl}")` : "none");
    }
    persistVideoPlaybackPreference();
  };

  let styleEditorOutsideHandler = null;
  let styleEditorKeyHandler = null;
  let pendingStyleEditorRequest = null;
  let styleEditorRequestTimer = null;
  let stylePersistenceDebounceTimer = null;
  let queuedStylePersistence = null;
  let editorRevision = previous?.themeId === String(THEME.id || "custom") &&
    Number.isSafeInteger(previous?.editorRevision) ? previous.editorRevision : 0;
  let persistedEditorRevision = previous?.themeId === String(THEME.id || "custom") &&
    Number.isSafeInteger(previous?.persistedEditorRevision)
    ? previous.persistedEditorRevision : editorRevision;
  const stylePersistenceRequests = new Map();
  const stylePersistenceWaiters = new Map();
  let themeSettingsPageActive = previousThemeSettingsPageActive;
  let settingsNavNode = null;
  let settingsNavClickHandler = null;
  let previousNativeSettingsNav = null;
  let previousNativeSettingsNavClass = "";
  let previousNativeSettingsNavState = null;
  let styleEditorStatusState = previousStyleEditorStatus;
  let runtimeIssue = previousRuntimeIssue;

  const setStyleEditorStatus = (messageKey = "localOnly", state = "idle", replacements = {}) => {
    const message = formatEditorMessage(messageKey, replacements);
    styleEditorStatusState = { messageKey, replacements: { ...replacements }, state };
    const runtime = window[STATE_KEY];
    if (runtime) runtime.styleEditorStatus = { ...styleEditorStatusState };
    const status = document.getElementById(STYLE_EDITOR_STATUS_ID);
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  };

  const renderThemeRuntimeIssue = () => {
    const notice = document.getElementById("cc-theme-runtime-notice");
    if (!notice) return;
    notice.hidden = !runtimeIssue;
    notice.dataset.state = runtimeIssue ? "error" : "idle";
    const title = notice.querySelector("strong");
    const detail = notice.querySelector("span");
    if (title) title.textContent = formatEditorMessage("themeLoadFailed");
    if (detail) detail.textContent = formatEditorMessage("themeRuntimeFailureDetail");
    if (runtimeIssue?.diagnosticCode) notice.dataset.diagnosticCode = runtimeIssue.diagnosticCode;
    else delete notice.dataset.diagnosticCode;
  };

  const setThemeRuntimeIssue = (issue = null) => {
    runtimeIssue = issue && typeof issue === "object" ? {
      diagnosticCode: String(issue.code || issue.stage || "theme-load-failed")
        .toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 80) || "theme-load-failed",
    } : null;
    const runtime = window[STATE_KEY];
    if (runtime) runtime.runtimeIssue = runtimeIssue ? { ...runtimeIssue } : null;
    renderThemeRuntimeIssue();
    if (runtimeIssue) setStyleEditorStatus("themeLoadFailed", "error");
  };
  const themeRuntimeResultHandler = (result) => {
    if (result?.ok) {
      setThemeRuntimeIssue(null);
      return;
    }
    setThemeRuntimeIssue(result);
  };
  window[THEME_RUNTIME_RESULT_KEY] = themeRuntimeResultHandler;

  const persistEditorDraft = () => {
    const runtime = window[STATE_KEY];
    if (runtime) {
      runtime.editorDraft = { ...editorDraft };
      runtime.editorRevision = editorRevision;
      runtime.persistedEditorRevision = persistedEditorRevision;
    }
  };

  const runtimePreferencesSnapshot = () => ({
    backgroundPresentation: videoPlaybackPreference,
    interactiveEffectEnabled,
  });

  const settleStylePersistence = (revision, ok) => {
    const waiters = stylePersistenceWaiters.get(revision) || [];
    stylePersistenceWaiters.delete(revision);
    for (const resolve of waiters) resolve(ok);
  };

  const restoreLastValidEditorState = (result = null) => {
    const values = result?.values && typeof result.values === "object" && !Array.isArray(result.values)
      ? result.values : styleOverrides;
    const preferences = result?.preferences && typeof result.preferences === "object"
      ? result.preferences : runtimePreferencesSnapshot();
    styleOverrides = { ...values };
    editorDraft = { ...styleOverrides };
    if (["playing", "paused", "disabled"].includes(preferences.backgroundPresentation)) {
      videoPlaybackPreference = preferences.backgroundPresentation;
    }
    if (typeof preferences.interactiveEffectEnabled === "boolean") {
      interactiveEffectEnabled = preferences.interactiveEffectEnabled;
      interactiveController?.setEnabled?.(interactiveEffectEnabled);
    }
    persistVideoPlaybackPreference();
    if (themeVisualsAreDisabled()) {
      restoreNativeAppearance();
      syncOwnedThemeSettingsPresentation(styleOverrides);
    } else {
      applyTheme(document.documentElement, resolvedShellMode());
      applyStyleOverrides(document.documentElement, styleOverrides);
    }
    syncVideoPlayback();
    requestAnimationFrame(() => {
      refreshStyleEditorInputs();
      updateStyleEditorEffectControl();
    });
    persistEditorDraft();
  };

  const dispatchStylePersistence = (entry) => {
    if (!entry || entry.revision !== editorRevision) return false;
    queuedStylePersistence = null;
    if (stylePersistenceDebounceTimer) clearTimeout(stylePersistenceDebounceTimer);
    stylePersistenceDebounceTimer = null;
    if (typeof window[styleEditorBinding] !== "function") {
      restoreLastValidEditorState();
      setStyleEditorStatus("backendUnavailable", "error");
      settleStylePersistence(entry.revision, false);
      return false;
    }
    const requestId = `r${entry.revision}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    pendingStyleEditorRequest = requestId;
    const timeout = setTimeout(() => {
      const request = stylePersistenceRequests.get(requestId);
      if (!request) return;
      stylePersistenceRequests.delete(requestId);
      if (request.revision !== editorRevision) return;
      pendingStyleEditorRequest = null;
      restoreLastValidEditorState();
      setStyleEditorStatus("backendUnavailable", "error");
      settleStylePersistence(request.revision, false);
    }, 8000);
    stylePersistenceRequests.set(requestId, { ...entry, timeout });
    styleEditorRequestTimer = timeout;
    const runtime = window[STATE_KEY];
    if (runtime) {
      runtime.styleEditorRequestTimer = timeout;
      runtime.stylePersistenceDebounceTimer = null;
    }
    try {
      window[styleEditorBinding](JSON.stringify({
        requestId,
        revision: entry.revision,
        nonce: styleEditorNonce,
        themeId: String(THEME.id || "custom"),
        values: entry.values,
        preferences: entry.preferences,
      }));
      return true;
    } catch {
      clearTimeout(timeout);
      stylePersistenceRequests.delete(requestId);
      pendingStyleEditorRequest = null;
      restoreLastValidEditorState();
      setStyleEditorStatus("backendUnavailable", "error");
      settleStylePersistence(entry.revision, false);
      return false;
    }
  };

  const queueStylePersistence = ({ immediate = false } = {}) => {
    editorRevision += 1;
    const entry = {
      revision: editorRevision,
      values: structuredClone(editorDraft),
      preferences: runtimePreferencesSnapshot(),
    };
    queuedStylePersistence = entry;
    persistEditorDraft();
    setStyleEditorStatus("saving", "saving");
    if (stylePersistenceDebounceTimer) clearTimeout(stylePersistenceDebounceTimer);
    if (immediate) return dispatchStylePersistence(entry);
    stylePersistenceDebounceTimer = setTimeout(() => dispatchStylePersistence(entry), 180);
    const runtime = window[STATE_KEY];
    if (runtime) runtime.stylePersistenceDebounceTimer = stylePersistenceDebounceTimer;
    return true;
  };

  const flushStyleEditorPersistence = (timeoutMs = 9000) => {
    if (queuedStylePersistence) dispatchStylePersistence(queuedStylePersistence);
    if (persistedEditorRevision >= editorRevision) return Promise.resolve(true);
    return new Promise((resolve) => {
      const revision = editorRevision;
      const list = stylePersistenceWaiters.get(revision) || [];
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve(ok);
      };
      list.push(finish);
      stylePersistenceWaiters.set(revision, list);
      const deadline = setTimeout(() => finish(false), timeoutMs);
    });
  };

  const styleEditorInputValue = (token) => {
    const value = editorDraft[token.id];
    if (editorValueIsValid(token, value)) return token.type === "fontList" ? value.join(", ") : value;
    if (token.type === "fontList" || token.type === "number") {
      const [section, key] = String(token.themePath || "").split(".");
      const themeValue = THEME[section]?.[key];
      if (editorValueIsValid(token, themeValue)) {
        return token.type === "fontList" ? themeValue.join(", ") : themeValue;
      }
    }
    const pageValue = document.getElementById(THEME_SETTINGS_PAGE_ID)
      ?.style.getPropertyValue(token.cssVariable).trim() || "";
    const cssValue = pageValue ||
      document.documentElement?.style.getPropertyValue(token.cssVariable).trim() || "";
    return token.type === "number" ? Number.parseFloat(cssValue) : cssValue;
  };

  const colorPickerHexValue = (value) => {
    const trimmed = String(value || "").trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed.toLowerCase();
    const match = trimmed.match(/^rgba?\(([^)]+)\)$/i);
    if (!match) return "#000000";
    const channels = match[1].split(",").slice(0, 3).map((part) => {
      const raw = part.trim();
      const number = Number.parseFloat(raw);
      if (!Number.isFinite(number)) return 0;
      return Math.max(0, Math.min(255, Math.round(raw.endsWith("%") ? number * 2.55 : number)));
    });
    return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  };

  const refreshStyleEditorColorPicker = (input, token) => {
    const picker = input.parentElement?.querySelector(".cc-theme-style-editor-color-picker");
    if (!picker || token.type !== "color") return;
    picker.value = colorPickerHexValue(input.value);
  };

  const refreshStyleEditorInputs = () => {
    const editor = document.getElementById(STYLE_EDITOR_ID);
    if (!editor) return;
    for (const input of editor.querySelectorAll("[data-theme-style-token]")) {
      const token = STYLE_TOKENS.find((item) => item.id === input.dataset.themeStyleToken);
      if (token) {
        input.value = styleEditorInputValue(token);
        refreshStyleEditorColorPicker(input, token);
      }
    }
  };

  const styleEditorEffectLabel = () => {
    if (interactiveEnabled) {
      const inspected = interactiveController?.inspect?.() || {};
      if (inspected.fallback) return formatEditorMessage(
        BACKGROUND_RENDER_MODE === "ripple" ? "rippleUnavailable" : "directionalUnavailable",
      );
      if (motionMediaQuery.matches) return formatEditorMessage(
        BACKGROUND_RENDER_MODE === "ripple" ? "reduceMotionRipple" : "reduceMotionDirectional",
      );
      return BACKGROUND_RENDER_MODE === "ripple"
        ? formatEditorMessage(interactiveEffectEnabled ? "rippleEnabled" : "staticImage")
        : formatEditorMessage(interactiveEffectEnabled ? "directionalEnabled" : "defaultDirection");
    }
    if (!videoEnabled) return formatEditorMessage("staticImage");
    if (videoPlaybackPreference === "disabled") return formatEditorMessage("visualDisabled");
    if (videoPlaybackPreference === "paused") return formatEditorMessage(
      motionFallbackEnabled ? "motionFallbackPaused" : "videoPaused",
    );
    const runtimeState = getMotionFallbackElement()?.dataset.skinPlaybackState ||
      getVideoElement()?.dataset.skinPlaybackState || "loading";
    if (runtimeState === "playing") return formatEditorMessage(
      motionFallbackEnabled ? "motionFallbackPlaying" : "videoPlaying",
    );
    if (runtimeState === "loading") return formatEditorMessage(
      motionFallbackEnabled ? "motionFallbackLoading" : "videoLoading",
    );
    if (runtimeState === "reduced-motion") return formatEditorMessage(
      motionFallbackEnabled ? "motionFallbackReducedMotion" : "videoReducedMotion",
    );
    if (runtimeState === "play-blocked" || runtimeState === "error") {
      return formatEditorMessage(motionFallbackEnabled ? "motionFallbackRetry" : "videoRetry");
    }
    return formatEditorMessage(motionFallbackEnabled ? "motionFallbackPaused" : "videoPaused");
  };

  const updateStyleEditorEffectControl = () => {
    const button = document.querySelector(`#${STYLE_EDITOR_ID} [data-theme-editor-effect]`);
    if (!button) return;
    button.textContent = styleEditorEffectLabel();
    button.disabled = !videoEnabled && !interactiveEnabled;
  };

  const cycleBackgroundPresentation = () => {
    if (interactiveEnabled) {
      interactiveEffectEnabled = !interactiveEffectEnabled;
      interactiveController?.setEnabled?.(interactiveEffectEnabled);
      const state = window[STATE_KEY];
      if (state) state.interactiveEffectEnabled = interactiveEffectEnabled;
      ensure();
      updateStyleEditorEffectControl();
      queueStylePersistence();
      return;
    }
    const video = getVideoElement();
    if (!video) return;
    if (videoPlaybackPreference === "playing") {
      videoPlaybackPreference = "paused";
    } else if (videoPlaybackPreference === "paused") {
      videoPlaybackPreference = "disabled";
    } else {
      videoPlaybackPreference = "playing";
    }
    persistVideoPlaybackPreference();
    ensure();
    updateStyleEditorEffectControl();
    queueStylePersistence();
  };

  const closeStyleEditor = () => {
    const editor = document.getElementById(STYLE_EDITOR_ID);
    if (!editor || editor.hidden) return;
    void flushStyleEditorPersistence();
    editor.hidden = true;
  };

  const ensureStyleEditor = (mount = document.body, placement = "popover") => {
    let editor = document.getElementById(STYLE_EDITOR_ID);
    if (editor) {
      editor.dataset.themeEditorPlacement = placement;
      editor.setAttribute("role", placement === "settings" ? "region" : "dialog");
      if (placement === "settings") editor.removeAttribute("aria-modal");
      else editor.setAttribute("aria-modal", "false");
      if (editor.parentElement !== mount) mount.appendChild(editor);
      editor.hidden = placement === "popover";
      return editor;
    }
    editor = document.createElement("section");
    editor.id = STYLE_EDITOR_ID;
    editor.hidden = placement === "popover";
    editor.dataset.themeEditorPlacement = placement;
    editor.setAttribute("role", placement === "settings" ? "region" : "dialog");
    if (placement !== "settings") editor.setAttribute("aria-modal", "false");
    editor.setAttribute("aria-label", formatEditorMessage("editorAria"));
    editor.setAttribute("lang", EDITOR_LOCALE);
    editor.setAttribute("dir", EDITOR_LOCALE_DIRECTION);
    editor.setAttribute("data-theme-i18n-aria", "editorAria");
    editor.setAttribute("data-skin-owned", "style-editor");
    editor.setAttribute("data-theme-owned", "theme-editor");

    const header = document.createElement("header");
    const heading = document.createElement("div");
    const headingTitle = document.createElement("h2");
    headingTitle.textContent = formatEditorMessage("pageTitle");
    headingTitle.setAttribute("data-theme-i18n", "pageTitle");
    const headingTheme = document.createElement("small");
    headingTheme.textContent = formatEditorMessage("currentTheme", {
      theme: String(THEME.name || THEME.id || "CC Theme"),
    });
    headingTheme.setAttribute("data-theme-i18n", "currentTheme");
    headingTheme.dataset.themeI18nTheme = String(THEME.name || THEME.id || "CC Theme");
    heading.append(headingTitle, headingTheme);
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", formatEditorMessage("closeEditor"));
    close.setAttribute("data-theme-i18n-aria", "closeEditor");
    close.textContent = "×";
    close.addEventListener("click", () => closeStyleEditor(true));
    header.append(heading, close);
    editor.appendChild(header);

    const runtimeNotice = document.createElement("div");
    runtimeNotice.id = "cc-theme-runtime-notice";
    runtimeNotice.setAttribute("role", "alert");
    runtimeNotice.hidden = true;
    runtimeNotice.dataset.state = "idle";
    runtimeNotice.append(document.createElement("strong"), document.createElement("span"));
    editor.appendChild(runtimeNotice);
    renderThemeRuntimeIssue();

    if (motionFallbackEnabled) {
      const mediaNotice = document.createElement("div");
      mediaNotice.id = "cc-theme-media-notice";
      mediaNotice.setAttribute("role", "status");
      mediaNotice.dataset.state = "warning";
      mediaNotice.dataset.diagnosticCode = "video-media-policy-animated-image-fallback";
      mediaNotice.dataset.themeI18n = "motionFallbackNotice";
      mediaNotice.textContent = formatEditorMessage("motionFallbackNotice");
      editor.appendChild(mediaNotice);
    }

    const localeNotice = document.createElement("div");
    localeNotice.id = "cc-theme-locale-notice";
    localeNotice.setAttribute("role", "status");
    localeNotice.hidden = true;
    editor.appendChild(localeNotice);

    const effectRow = document.createElement("div");
    effectRow.className = "cc-theme-style-editor-effect";
    const effectLabel = document.createElement("span");
    effectLabel.textContent = formatEditorMessage("backgroundEffect");
    effectLabel.setAttribute("data-theme-i18n", "backgroundEffect");
    const effectButton = document.createElement("button");
    effectButton.type = "button";
    effectButton.dataset.themeEditorEffect = "1";
    effectButton.addEventListener("click", cycleBackgroundPresentation);
    effectRow.append(effectLabel, effectButton);
    editor.appendChild(effectRow);

    const body = document.createElement("div");
    body.className = "cc-theme-style-editor-body";
    const groups = Array.isArray(STYLE_CATALOG.groups) ? STYLE_CATALOG.groups : [];
    groups.forEach((group) => {
      const tokens = STYLE_TOKENS.filter((token) => token.group === group.id);
      if (!tokens.length) return;
      const groupSection = document.createElement("details");
      groupSection.className = "cc-theme-style-editor-group";
      const groupHeading = document.createElement("summary");
      const groupLabel = document.createElement("span");
      groupLabel.textContent = localizedGroupLabel(group);
      groupLabel.dataset.themeGroupLabel = group.id;
      const groupCount = document.createElement("span");
      groupCount.className = "cc-theme-style-editor-group-count";
      groupCount.textContent = localizedNumber(tokens.length);
      groupCount.dataset.themeGroupCount = String(tokens.length);
      groupCount.setAttribute("aria-label", formatEditorMessage("groupItemCount", {
        count: localizedNumber(tokens.length),
      }));
      groupHeading.append(groupLabel, groupCount);
      const groupRows = document.createElement("div");
      groupRows.className = "cc-theme-style-editor-group-rows";
      groupSection.append(groupHeading, groupRows);
      groupSection.addEventListener("toggle", () => {
        if (!groupSection.open) return;
        body.querySelectorAll("details.cc-theme-style-editor-group[open]").forEach((other) => {
          if (other !== groupSection) other.open = false;
        });
      });
      for (const token of tokens) {
        const row = document.createElement("label");
        row.className = "cc-theme-style-editor-row";
        const name = document.createElement("span");
        name.textContent = localizedTokenLabel(token);
        name.dataset.themeTokenLabel = token.id;
        const input = document.createElement("input");
        input.type = token.type === "number" ? "number" : "text";
        if (token.type === "number") {
          input.min = String(token.minimum);
          input.max = String(token.maximum);
          input.step = String(token.step);
        }
        input.spellcheck = false;
        input.autocomplete = "off";
        input.dataset.themeStyleToken = token.id;
        input.setAttribute("aria-label", name.textContent);
        const commitInputValue = () => {
          const raw = input.value.trim();
          const next = token.type === "fontList" ? raw.split(",").map((item) => item.trim()).filter(Boolean)
            : token.type === "number" ? Number(raw) : raw;
          if (!editorValueIsValid(token, next)) {
            input.setAttribute("aria-invalid", "true");
            setStyleEditorStatus("invalidValue", "error");
            return;
          }
          input.removeAttribute("aria-invalid");
          editorDraft[token.id] = next;
          persistEditorDraft();
          previewStyleOverrides();
          queueStylePersistence();
        };
        input.addEventListener("input", () => {
          refreshStyleEditorColorPicker(input, token);
          commitInputValue();
        });
        const reset = document.createElement("button");
        reset.type = "button";
        reset.textContent = formatEditorMessage("restore");
        reset.dataset.themeResetToken = token.id;
        reset.setAttribute("aria-label", formatEditorMessage("restoreItem", { label: name.textContent }));
        reset.addEventListener("click", (event) => {
          event.preventDefault();
          delete editorDraft[token.id];
          persistEditorDraft();
          ensure();
          requestAnimationFrame(() => {
            input.value = styleEditorInputValue(token);
            refreshStyleEditorColorPicker(input, token);
          });
          queueStylePersistence();
        });
        const controls = document.createElement("span");
        if (token.type === "color") {
          const colorPicker = document.createElement("input");
          colorPicker.type = "color";
          colorPicker.className = "cc-theme-style-editor-color-picker";
          colorPicker.dataset.themeColorPickerFor = token.id;
          colorPicker.setAttribute("aria-label", formatEditorMessage("chooseColor", { label: name.textContent }));
          colorPicker.dataset.themeChooseColorToken = token.id;
          colorPicker.addEventListener("input", () => {
            input.value = colorPicker.value;
            commitInputValue();
          });
          controls.append(colorPicker);
        }
        controls.append(input, reset);
        row.append(name, controls);
        groupRows.appendChild(row);
      }
      body.appendChild(groupSection);
    });
    editor.appendChild(body);

    const footer = document.createElement("footer");
    const status = document.createElement("span");
    status.id = STYLE_EDITOR_STATUS_ID;
    status.setAttribute("role", "status");
    status.textContent = formatEditorMessage("localOnly");
    const actions = document.createElement("span");
    const resetAll = document.createElement("button");
    resetAll.type = "button";
    resetAll.textContent = formatEditorMessage("resetAll");
    resetAll.setAttribute("data-theme-i18n", "resetAll");
    resetAll.addEventListener("click", () => {
      editorDraft = {};
      persistEditorDraft();
      ensure();
      requestAnimationFrame(refreshStyleEditorInputs);
      queueStylePersistence({ immediate: true });
    });
    actions.append(resetAll);
    footer.append(status, actions);
    editor.appendChild(footer);
    mount.appendChild(editor);

    window[STYLE_EDITOR_RESULT_KEY] = (requestId, result) => {
      const request = stylePersistenceRequests.get(requestId);
      if (!request) return;
      clearTimeout(request.timeout);
      stylePersistenceRequests.delete(requestId);
      if (requestId === pendingStyleEditorRequest) pendingStyleEditorRequest = null;
      if (styleEditorRequestTimer === request.timeout) styleEditorRequestTimer = null;
      const runtime = window[STATE_KEY];
      if (runtime) runtime.styleEditorRequestTimer = null;
      if (request.revision !== editorRevision || result?.superseded) return;
      if (result?.ok) {
        styleOverrides = result.values && typeof result.values === "object"
          ? { ...result.values } : { ...request.values };
        editorDraft = { ...styleOverrides };
        persistedEditorRevision = request.revision;
        const state = window[STATE_KEY];
        if (state) {
          state.styleOverrides = { ...styleOverrides };
          state.editorDraft = { ...editorDraft };
          state.persistedEditorRevision = persistedEditorRevision;
        }
        persistEditorDraft();
        setStyleEditorStatus("saved", "success");
        settleStylePersistence(request.revision, true);
      } else {
        restoreLastValidEditorState(result);
        setStyleEditorStatus("saveFailed", "error");
        settleStylePersistence(request.revision, false);
      }
    };
    styleEditorOutsideHandler = (event) => {
      if (editor.dataset.themeEditorPlacement !== "popover" || editor.hidden ||
          editor.contains(event.target)) return;
      closeStyleEditor(true);
    };
    styleEditorKeyHandler = (event) => {
      if (editor.dataset.themeEditorPlacement === "popover" && event.key === "Escape" && !editor.hidden) {
        event.preventDefault();
        closeStyleEditor(true);
      }
    };
    document.addEventListener("pointerdown", styleEditorOutsideHandler, true);
    document.addEventListener("keydown", styleEditorKeyHandler, true);
    const state = window[STATE_KEY];
    if (state) {
      state.styleEditorOutsideHandler = styleEditorOutsideHandler;
      state.styleEditorKeyHandler = styleEditorKeyHandler;
      state.styleEditorResultHandler = window[STYLE_EDITOR_RESULT_KEY];
      state.runtimeResultHandler = themeRuntimeResultHandler;
    }
    updateStyleEditorEffectControl();
    return editor;
  };

  const toggleStyleEditor = () => {
    const editor = ensureStyleEditor(document.body, "popover");
    if (!editor.hidden) {
      closeStyleEditor(true);
      return;
    }
    editorDraft = { ...styleOverrides };
    ensure();
    refreshStyleEditorInputs();
    updateStyleEditorEffectControl();
    setStyleEditorStatus("localOnly");
    editor.hidden = false;
    editor.querySelector("button, input, summary")?.focus({ preventScroll: true });
  };

  const disposeThemeEditorUi = (restoreDraft = true) => {
    const editor = document.getElementById(STYLE_EDITOR_ID);
    if (!editor) return;
    void flushStyleEditorPersistence();
    if (restoreDraft) {
      editorDraft = { ...styleOverrides };
      if (!(videoEnabled && videoPlaybackPreference === "disabled")) {
        applyTheme(document.documentElement, resolvedShellMode());
        applyStyleOverrides(document.documentElement);
      }
    }
    editor.remove();
    if (styleEditorOutsideHandler) document.removeEventListener("pointerdown", styleEditorOutsideHandler, true);
    if (styleEditorKeyHandler) document.removeEventListener("keydown", styleEditorKeyHandler, true);
    styleEditorOutsideHandler = null;
    styleEditorKeyHandler = null;
    const state = window[STATE_KEY];
    if (state) {
      state.styleEditorOutsideHandler = null;
      state.styleEditorKeyHandler = null;
    }
  };

  const restoreNativeSettingsContent = () => {
    document.querySelectorAll('[data-theme-page-native-hidden="true"]').forEach((node) => {
      node.hidden = false;
      node.removeAttribute("data-theme-page-native-hidden");
    });
  };

  const resolveClaudeSettings = () => uiInterpreter.resolveSettingsMount();

  const deactivateThemeSettingsPage = ({ restoreNativeSelection = false, removeEditor = true } = {}) => {
    themeSettingsPageActive = false;
    document.documentElement?.removeAttribute("data-theme-settings-page");
    const navItem = document.getElementById(THEME_SETTINGS_NAV_ID);
    if (navItem) {
      navItem.removeAttribute("aria-current");
      navItem.removeAttribute("data-state");
      if (navItem.dataset.themeInactiveClass) navItem.className = navItem.dataset.themeInactiveClass;
    }
    restoreNativeSettingsContent();
    document.getElementById(THEME_SETTINGS_PAGE_ID)?.remove();
    if (removeEditor) disposeThemeEditorUi(false);
    if (restoreNativeSelection && previousNativeSettingsNav?.isConnected) {
      previousNativeSettingsNav.setAttribute("aria-current", "page");
      if (previousNativeSettingsNavClass) previousNativeSettingsNav.className = previousNativeSettingsNavClass;
      if (previousNativeSettingsNavState === null) previousNativeSettingsNav.removeAttribute("data-state");
      else previousNativeSettingsNav.setAttribute("data-state", previousNativeSettingsNavState);
    }
    previousNativeSettingsNav = null;
    previousNativeSettingsNavClass = "";
    previousNativeSettingsNavState = null;
    const runtime = window[STATE_KEY];
    if (runtime) runtime.themeSettingsPageActive = false;
  };

  const restoreThemeSettingsPage = () => {
    deactivateThemeSettingsPage({ restoreNativeSelection: true, removeEditor: true });
    if (settingsNavNode && settingsNavClickHandler) {
      settingsNavNode.removeEventListener("click", settingsNavClickHandler, true);
    }
    settingsNavNode = null;
    settingsNavClickHandler = null;
    document.getElementById(THEME_SETTINGS_NAV_ID)?.remove();
    const runtime = window[STATE_KEY];
    if (runtime) {
      runtime.settingsNavNode = null;
      runtime.settingsNavClickHandler = null;
    }
  };

  const activateThemeSettingsPage = (navItem) => {
    const { dialog, nav, nativeContent } = resolveClaudeSettings();
    if (!dialog || !nav || !nativeContent || !navItem || !document.body?.contains(nativeContent)) return false;
    if (!themeSettingsPageActive) {
      const activeClass = navItem.dataset.themeActiveClass || "";
      const nativeSelectedButtons = [...nav.querySelectorAll('button:not(#cc-theme-settings-nav-item)')]
        .filter((button) => button.getAttribute("aria-current") === "page" ||
          button.getAttribute("data-state") === "active" ||
          (activeClass && button.className === activeClass));
      previousNativeSettingsNav = nativeSelectedButtons[0] || null;
      previousNativeSettingsNavClass = previousNativeSettingsNav?.className || "";
      previousNativeSettingsNavState = previousNativeSettingsNav?.getAttribute("data-state") ?? null;
      for (const button of nativeSelectedButtons) {
        button.removeAttribute("aria-current");
        button.removeAttribute("data-state");
        if (navItem.dataset.themeInactiveClass) button.className = navItem.dataset.themeInactiveClass;
      }
    }
    themeSettingsPageActive = true;
    document.documentElement?.setAttribute("data-theme-settings-page", "active");
    navItem.setAttribute("aria-current", "page");
    navItem.setAttribute("data-state", "active");
    if (navItem.dataset.themeActiveClass) navItem.className = navItem.dataset.themeActiveClass;

    let page = document.getElementById(THEME_SETTINGS_PAGE_ID);
    const newlyMounted = !page || page.parentElement !== dialog;
    if (newlyMounted) {
      page?.remove();
      page = document.createElement("div");
      page.id = THEME_SETTINGS_PAGE_ID;
      page.className = nativeContent.className || "flex min-h-0 min-w-0 flex-1 flex-col bg-surface-2";
      page.setAttribute("data-theme-owned", "settings-page");
      page.setAttribute("data-skin-role", "settings-content");
      page.setAttribute("lang", EDITOR_LOCALE);
      page.setAttribute("dir", EDITOR_LOCALE_DIRECTION);

      const header = document.createElement("div");
      header.className = "cc-theme-settings-page-header";
      header.setAttribute("data-theme-owned", "settings-page-header");
      const heading = document.createElement("h1");
      heading.textContent = formatEditorMessage("pageTitle");
      heading.setAttribute("data-theme-i18n", "pageTitle");
      header.appendChild(heading);
      const nativeClose = uiInterpreter.select("settingsClose", nativeContent);
      if (nativeClose) {
        const close = nativeClose.cloneNode(true);
        close.removeAttribute("id");
        close.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
        for (const attribute of ["aria-controls", "aria-describedby", "aria-labelledby", "form"]) {
          close.removeAttribute(attribute);
        }
        close.setAttribute("aria-label", formatEditorMessage("closeEditor"));
        close.setAttribute("data-theme-i18n-aria", "closeEditor");
        close.addEventListener("click", () => nativeClose.click());
        header.appendChild(close);
      }
      page.appendChild(header);

      const nativeScroller = [...nativeContent.children].find((child) =>
        child.className?.includes?.("overflow-y-auto")) || null;
      const scroll = document.createElement("div");
      scroll.className = nativeScroller?.className ||
        "relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-xl pb-lg pt-2";
      scroll.setAttribute("data-theme-owned", "settings-page-scroll");
      const main = document.createElement("main");
      main.className = "flex flex-col";
      const frame = document.createElement("div");
      frame.className = "cc-theme-settings-page-frame";
      frame.setAttribute("data-theme-owned", "settings-page-content");
      main.appendChild(frame);
      scroll.appendChild(main);
      page.appendChild(scroll);
      dialog.appendChild(page);
      const editor = ensureStyleEditor(frame, "settings");
      editor.dataset.themeEditorPlacementBoundary = "dedicated-settings-page";
      editor.hidden = false;
      refreshStyleEditorInputs();
      const status = styleEditorStatusState || {
        messageKey: STYLE_OVERRIDE_STATE.diagnosticCode === "local-overrides-quarantined"
          ? "overridesQuarantined"
          : STYLE_OVERRIDE_STATE.diagnosticCode === "local-overrides-rebased"
            ? "overridesRebased"
            : STYLE_OVERRIDE_STATE.diagnosticCode === "local-overrides-invalid"
              ? "overridesInvalid" : "localOnly",
        replacements: STYLE_OVERRIDE_STATE.diagnosticCode === "local-overrides-quarantined"
          ? { count: localizedNumber(STYLE_OVERRIDE_STATE.quarantinedTokenCount || 0) } : {},
        state: STYLE_OVERRIDE_STATE.diagnosticCode ? "warning" : "idle",
      };
      setStyleEditorStatus(status.messageKey, status.state, status.replacements || {});
    }
    syncOwnedThemeSettingsPresentation();
    nativeContent.hidden = true;
    nativeContent.setAttribute("data-theme-page-native-hidden", "true");
    page.hidden = false;
    updateStyleEditorEffectControl();
    const runtime = window[STATE_KEY];
    if (runtime) runtime.themeSettingsPageActive = true;
    return true;
  };

  const ensureThemeSettingsPage = () => {
    const { nav, desktopList, generalButton } = resolveClaudeSettings();
    const generalListItem = generalButton?.closest("li");
    if (!nav || !desktopList || !generalButton || !generalListItem) {
      restoreThemeSettingsPage();
      return false;
    }
    let navItem = document.getElementById(THEME_SETTINGS_NAV_ID);
    if (!navItem) {
      const listItem = generalListItem.cloneNode(true);
      navItem = listItem.querySelector(":scope > button");
      if (!navItem) return false;
      listItem.removeAttribute("id");
      listItem.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
      navItem.id = THEME_SETTINGS_NAV_ID;
      for (const attribute of ["aria-controls", "aria-describedby", "aria-labelledby", "form"]) {
        navItem.removeAttribute(attribute);
      }
      navItem.removeAttribute("data-skin-role");
      navItem.removeAttribute("data-skin-marker");
      navItem.removeAttribute("aria-current");
      navItem.removeAttribute("data-state");
      navItem.setAttribute("data-theme-owned", "settings-nav-item");
      navItem.setAttribute("aria-label", formatEditorMessage("navigationLabel"));
      navItem.setAttribute("lang", EDITOR_LOCALE);
      navItem.setAttribute("dir", EDITOR_LOCALE_DIRECTION);
      navItem.setAttribute("data-theme-i18n-aria", "navigationLabel");
      listItem.setAttribute("data-theme-owned", "settings-nav-list-item");
      const activeButton = nav.querySelector(
        'button[aria-current="page"]:not(#cc-theme-settings-nav-item), ' +
        'button[data-state="active"]:not(#cc-theme-settings-nav-item)',
      );
      const inactiveButton = [...desktopList.querySelectorAll(':scope > li > button')]
        .find((button) => button !== generalButton && !button.hasAttribute("aria-current"));
      navItem.dataset.themeActiveClass = activeButton?.className ||
        uiAdapterConfig.settingsMount?.activeButtonClasses || generalButton.className;
      navItem.dataset.themeInactiveClass = !generalButton.hasAttribute("aria-current")
        ? generalButton.className
        : inactiveButton?.className || uiAdapterConfig.settingsMount?.inactiveButtonClasses || generalButton.className;
      navItem.className = navItem.dataset.themeInactiveClass;
      const label = navItem.querySelector("span:last-child");
      if (label) {
        label.textContent = formatEditorMessage("navigationLabel");
        label.setAttribute("data-theme-i18n", "navigationLabel");
      }
      const iconHost = navItem.querySelector("span:first-child");
      if (iconHost) {
        iconHost.replaceChildren(document.createTextNode("C"));
        iconHost.setAttribute("aria-hidden", "true");
      }
      navItem.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        activateThemeSettingsPage(navItem);
      });
      generalListItem.parentElement.insertBefore(listItem, generalListItem.nextSibling);
    }
    const navListItem = navItem.closest("li");
    if (navListItem?.parentElement !== desktopList || navListItem.previousElementSibling !== generalListItem) {
      desktopList.insertBefore(navListItem, generalListItem.nextSibling);
    }
    if (settingsNavNode !== nav) {
      if (settingsNavNode && settingsNavClickHandler) {
        settingsNavNode.removeEventListener("click", settingsNavClickHandler, true);
      }
      settingsNavNode = nav;
      settingsNavClickHandler = (event) => {
        const button = event.target.closest?.("button");
        if (!themeSettingsPageActive || !button || button.id === THEME_SETTINGS_NAV_ID) return;
        deactivateThemeSettingsPage({ restoreNativeSelection: false, removeEditor: true });
      };
      settingsNavNode?.addEventListener("click", settingsNavClickHandler, true);
    }
    if (themeSettingsPageActive) {
      activateThemeSettingsPage(navItem);
    }
    const runtime = window[STATE_KEY];
    if (runtime) {
      runtime.settingsNavNode = settingsNavNode;
      runtime.settingsNavClickHandler = settingsNavClickHandler;
    }
    applyEditorLocaleToUi();
    return true;
  };

  applyEditorLocaleToUi = () => {
    const ownedRoots = [
      document.getElementById(THEME_SETTINGS_NAV_ID),
      document.getElementById(THEME_SETTINGS_PAGE_ID),
      document.getElementById(STYLE_EDITOR_ID),
    ].filter(Boolean);
    for (const root of ownedRoots) {
      root.setAttribute("lang", EDITOR_LOCALE);
      root.setAttribute("dir", EDITOR_LOCALE_DIRECTION);
      root.dataset.themeEffectiveLocale = EDITOR_LOCALE;
      if (LOCALE_DIAGNOSTIC_CODE) root.dataset.themeLocaleDiagnostic = LOCALE_DIAGNOSTIC_CODE;
      else delete root.dataset.themeLocaleDiagnostic;
    }
    for (const node of document.querySelectorAll("[data-theme-i18n]")) {
      const key = node.dataset.themeI18n;
      const replacements = key === "currentTheme"
        ? { theme: node.dataset.themeI18nTheme || String(THEME.name || THEME.id || "CC Theme") }
        : {};
      node.textContent = formatEditorMessage(key, replacements);
    }
    for (const node of document.querySelectorAll("[data-theme-i18n-aria]")) {
      node.setAttribute("aria-label", formatEditorMessage(node.dataset.themeI18nAria));
    }
    for (const label of document.querySelectorAll("[data-theme-group-label]")) {
      const group = STYLE_CATALOG.groups?.find?.((item) => item.id === label.dataset.themeGroupLabel);
      if (group) label.textContent = localizedGroupLabel(group);
    }
    for (const count of document.querySelectorAll("[data-theme-group-count]")) {
      const formatted = localizedNumber(Number(count.dataset.themeGroupCount) || 0);
      count.textContent = formatted;
      count.setAttribute("aria-label", formatEditorMessage("groupItemCount", { count: formatted }));
    }
    for (const name of document.querySelectorAll("[data-theme-token-label]")) {
      const token = STYLE_TOKENS.find((item) => item.id === name.dataset.themeTokenLabel);
      if (!token) continue;
      const label = localizedTokenLabel(token);
      name.textContent = label;
      const row = name.closest("label");
      row?.querySelector("[data-theme-style-token]")?.setAttribute("aria-label", label);
      const reset = row?.querySelector("[data-theme-reset-token]");
      if (reset) {
        reset.textContent = formatEditorMessage("restore");
        reset.setAttribute("aria-label", formatEditorMessage("restoreItem", { label }));
      }
      row?.querySelector("[data-theme-choose-color-token]")?.setAttribute(
        "aria-label", formatEditorMessage("chooseColor", { label }),
      );
    }
    const localeNotice = document.getElementById("cc-theme-locale-notice");
    if (localeNotice) {
      const showFallback = ["unsupported-host-locale-fallback", "host-locale-bridge-unavailable"]
        .includes(LOCALE_DIAGNOSTIC_CODE);
      localeNotice.hidden = !showFallback;
      localeNotice.textContent = showFallback
        ? formatEditorMessage("localeFallback", { locale: LOCALE_DIAGNOSTIC_INPUT || "unknown" }) : "";
      localeNotice.dataset.diagnosticCode = showFallback ? LOCALE_DIAGNOSTIC_CODE : "none";
    }
    if (styleEditorStatusState?.messageKey) {
      setStyleEditorStatus(
        styleEditorStatusState.messageKey,
        styleEditorStatusState.state,
        styleEditorStatusState.replacements || {},
      );
    }
    renderThemeRuntimeIssue();
    updateStyleEditorEffectControl();
  };

  const syncVideoPlayback = () => {
    const video = getVideoElement();
    const motionFallback = getMotionFallbackElement();
    if (!video && !motionFallback) return;
    const playbackEpoch = ++videoPlaybackEpoch;
    applyVideoPresentationState();
    if (motionFallback) {
      cancelVideoFrameConfirmation(video);
      video?.pause();
      if (video) video.hidden = true;
      const reduced = motionMediaQuery.matches;
      const shouldAnimate = !document.hidden && videoPlaybackPreference === "playing" && !reduced;
      motionFallback.hidden = !shouldAnimate;
      motionFallback.dataset.skinPlaybackState = motionFallback.dataset.skinMediaError === "true"
        ? "error" : !motionFallback.complete || motionFallback.naturalWidth < 1
          ? "loading" : videoPlaybackPreference === "disabled"
            ? "disabled" : reduced ? "reduced-motion" : shouldAnimate ? "playing" : "paused";
      updateStyleEditorEffectControl();
      return;
    }
    if (videoPlaybackPreference === "disabled") {
      cancelVideoFrameConfirmation(video);
      video.pause();
      video.dataset.skinPlaybackState = "disabled";
      updateStyleEditorEffectControl();
      return;
    }
    if (!videoArtUrl) {
      cancelVideoFrameConfirmation(video);
      video.pause();
      video.dataset.skinPlaybackState = "loading";
      updateStyleEditorEffectControl();
      return;
    }
    const reduced = motionMediaQuery.matches;
    const shouldPlay = !document.hidden && videoPlaybackPreference === "playing" && !reduced;
    if (!shouldPlay) {
      cancelVideoFrameConfirmation(video);
      video.pause();
      video.dataset.skinPlaybackState = reduced ? "reduced-motion" : "paused";
      updateStyleEditorEffectControl();
      return;
    }
    if (!video.paused && !video.ended) {
      if (video.dataset.skinPlaybackState === "playing") {
        updateStyleEditorEffectControl();
        return;
      }
      video.dataset.skinPlaybackState = "loading";
      updateStyleEditorEffectControl();
      confirmVideoFrame(video, playbackEpoch);
      return;
    }
    video.dataset.skinPlaybackState = "loading";
    updateStyleEditorEffectControl();
    Promise.resolve(video.play()).then(() => {
      if (playbackEpoch !== videoPlaybackEpoch) return;
      video.dataset.skinPlaybackState = "loading";
      updateStyleEditorEffectControl();
      confirmVideoFrame(video, playbackEpoch);
    }).catch(() => {
      if (playbackEpoch !== videoPlaybackEpoch) return;
      video.dataset.skinPlaybackState = "play-blocked";
      updateStyleEditorEffectControl();
    });
  };

  const ensureVideoLayer = () => {
    const root = document.documentElement;
    let layer = document.getElementById(VIDEO_LAYER_ID);
    if (!videoEnabled || !document.body) {
      disposeOwnedVideoLayer(layer);
      root?.removeAttribute(VIDEO_ATTR);
      root?.removeAttribute(VIDEO_PLAYBACK_ATTR);
      root?.removeAttribute(VIDEO_POSTER_ATTR);
      return;
    }
    root?.setAttribute(VIDEO_ATTR, videoPlaybackPreference === "disabled" ? "disabled" : "enabled");
    root?.setAttribute(VIDEO_PLAYBACK_ATTR, videoPlaybackPreference);
    root.setAttribute(VIDEO_POSTER_ATTR, VIDEO_POSTER_MODE);
    if (!layer || layer.parentElement !== document.body || layer.dataset.skinVersion !== VERSION) {
      disposeOwnedVideoLayer(layer);
      layer = document.createElement("div");
      layer.id = VIDEO_LAYER_ID;
      layer.dataset.skinVersion = VERSION;
      layer.setAttribute("aria-hidden", "true");
      const video = document.createElement("video");
      video.setAttribute("data-skin-owned", "background-video");
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = !motionMediaQuery.matches;
      if (document.hidden) video.autoplay = false;
      if (videoPlaybackPreference !== "playing") video.autoplay = false;
      video.controls = false;
      video.preload = VIDEO_POSTER_MODE === "image" ? "metadata" : "auto";
      if (VIDEO_POSTER_MODE === "image") video.poster = artUrl;
      if (videoArtUrl && !motionFallbackEnabled) video.src = videoArtUrl;
      video.tabIndex = -1;
      video.setAttribute("muted", "");
      video.setAttribute("loop", "");
      video.setAttribute("playsinline", "");
      video.setAttribute("disablepictureinpicture", "");
      video.dataset.skinPlaybackState = videoArtUrl
        ? motionMediaQuery.matches ? "reduced-motion" : "paused"
        : "loading";
      for (const eventName of ["play", "playing"]) {
        video.addEventListener(eventName, () => {
          if (videoPlaybackPreference !== "playing") {
            video.pause();
            video.dataset.skinPlaybackState = videoPlaybackPreference;
            updateStyleEditorEffectControl();
            return;
          }
          video.dataset.skinPlaybackState = "loading";
          updateStyleEditorEffectControl();
          confirmVideoFrame(video, videoPlaybackEpoch);
        });
      }
      video.addEventListener("pause", () => {
        cancelVideoFrameConfirmation(video);
        video.dataset.skinPlaybackState = videoPlaybackPreference === "playing"
          ? video.readyState < 2 ? "loading" : "paused"
          : videoPlaybackPreference;
        updateStyleEditorEffectControl();
        if (videoPlaybackPreference === "playing" && !document.hidden &&
            !motionMediaQuery.matches) {
          video.__ccThemePauseRetryTimer = setTimeout(() => {
            delete video.__ccThemePauseRetryTimer;
            if (video.paused && videoPlaybackPreference === "playing" && !document.hidden) syncVideoPlayback();
          }, 180);
        }
      });
      for (const eventName of ["waiting", "stalled", "emptied"]) {
        video.addEventListener(eventName, () => {
          if (videoPlaybackPreference !== "playing") return;
          cancelVideoFrameConfirmation(video);
          video.dataset.skinPlaybackState = "loading";
          updateStyleEditorEffectControl();
        });
      }
      for (const eventName of ["loadeddata", "canplay"]) {
        video.addEventListener(eventName, () => {
          if (videoPlaybackPreference === "playing" && !document.hidden) syncVideoPlayback();
        });
      }
      video.addEventListener("timeupdate", () => {
        if (videoPlaybackPreference !== "playing" || video.paused) return;
        video.dataset.skinPlaybackState = "playing";
        updateStyleEditorEffectControl();
      });
      video.addEventListener("error", () => {
        video.dataset.skinPlaybackState = "error";
        updateStyleEditorEffectControl();
      });
      layer.appendChild(video);
      document.body.appendChild(layer);
    }
    const video = layer.querySelector("video");
    let motionFallback = layer.querySelector(`#${MOTION_FALLBACK_ID}`);
    if (motionFallbackUrl) {
      if (!motionFallback) {
        motionFallback = document.createElement("img");
        motionFallback.id = MOTION_FALLBACK_ID;
        motionFallback.alt = "";
        motionFallback.setAttribute("aria-hidden", "true");
        motionFallback.setAttribute("data-skin-owned", "background-motion-fallback");
        motionFallback.dataset.skinPlaybackState = "loading";
        motionFallback.addEventListener("load", () => {
          delete motionFallback.dataset.skinMediaError;
          syncVideoPlayback();
        });
        motionFallback.addEventListener("error", () => {
          motionFallback.dataset.skinMediaError = "true";
          motionFallback.dataset.skinPlaybackState = "error";
          updateStyleEditorEffectControl();
        });
        layer.appendChild(motionFallback);
      }
      if (motionFallback.src !== motionFallbackUrl) motionFallback.src = motionFallbackUrl;
      if (video) video.hidden = true;
    } else {
      motionFallback?.remove();
      if (video) video.hidden = false;
    }
    syncVideoPlayback();
  };

  const setDeferredVideoSource = (source, themeId) => {
    const expectedThemeId = String(THEME.id || "custom");
    if (!videoEnabled || themeId !== expectedThemeId || typeof source !== "string" || !source.startsWith("blob:")) {
      if (typeof source === "string" && source.startsWith("blob:")) URL.revokeObjectURL(source);
      return false;
    }
    if (videoArtUrl?.startsWith("blob:") && videoArtUrl !== source) URL.revokeObjectURL(videoArtUrl);
    videoArtUrl = source;
    const state = window[STATE_KEY];
    if (state) state.videoArtUrl = source;
    const video = getVideoElement();
    if (video) {
      video.pause();
      video.src = source;
      video.dataset.skinPlaybackState = "loading";
      video.load();
    }
    ensureVideoLayer();
    return true;
  };

  const setDeferredMotionFallbackSource = (source, themeId) => {
    const expectedThemeId = String(THEME.id || "custom");
    if (!motionFallbackEnabled || themeId !== expectedThemeId ||
        typeof source !== "string" || !source.startsWith("blob:")) {
      if (typeof source === "string" && source.startsWith("blob:")) URL.revokeObjectURL(source);
      return false;
    }
    if (motionFallbackUrl?.startsWith("blob:") && motionFallbackUrl !== source) {
      URL.revokeObjectURL(motionFallbackUrl);
    }
    motionFallbackUrl = source;
    const state = window[STATE_KEY];
    if (state) state.motionFallbackUrl = source;
    getMotionFallbackElement()?.remove();
    ensureVideoLayer();
    return true;
  };

  const syncInteractivePresentation = () => {
    const root = document.documentElement;
    const layer = document.getElementById(INTERACTIVE_LAYER_ID);
    if (!interactiveEnabled) {
      root?.removeAttribute(INTERACTIVE_MODE_ATTR);
      root?.removeAttribute(INTERACTIVE_STATE_ATTR);
      layer?.remove();
      return;
    }
    const inspected = interactiveController?.inspect?.() || {};
    if (interactiveFatalFallback || inspected.fallback) interactiveRuntimeState = "fallback";
    else if (!inspected.ready) interactiveRuntimeState = "loading";
    else if (!interactiveEffectEnabled || inspected.active !== true || motionMediaQuery.matches || document.hidden) {
      interactiveRuntimeState = "static";
    } else interactiveRuntimeState = "enabled";
    root?.setAttribute(INTERACTIVE_MODE_ATTR, BACKGROUND_RENDER_MODE);
    root?.setAttribute(INTERACTIVE_STATE_ATTR, interactiveRuntimeState);
    if (layer) {
      const hideRippleStatic = BACKGROUND_RENDER_MODE === "ripple" && interactiveRuntimeState !== "enabled";
      layer.hidden = interactiveRuntimeState === "fallback" || interactiveRuntimeState === "loading" || hideRippleStatic;
      layer.dataset.skinInteractiveState = interactiveRuntimeState;
    }
    const state = window[STATE_KEY];
    if (state) {
      state.interactiveRuntimeState = interactiveRuntimeState;
      state.interactiveController = interactiveController;
      state.interactiveEffectEnabled = interactiveEffectEnabled;
    }
    updateStyleEditorEffectControl();
  };

  const ensureInteractiveLayer = () => {
    const root = document.documentElement;
    let layer = document.getElementById(INTERACTIVE_LAYER_ID);
    if (!interactiveEnabled || !document.body) {
      interactiveController?.dispose?.();
      interactiveController = null;
      layer?.remove();
      root?.removeAttribute(INTERACTIVE_MODE_ATTR);
      root?.removeAttribute(INTERACTIVE_STATE_ATTR);
      return;
    }
    if (!layer || layer.parentElement !== document.body || layer.dataset.skinVersion !== VERSION) {
      interactiveController?.dispose?.();
      interactiveController = null;
      layer?.remove();
      layer = document.createElement("div");
      layer.id = INTERACTIVE_LAYER_ID;
      layer.dataset.skinVersion = VERSION;
      layer.setAttribute("aria-hidden", "true");
      document.body.appendChild(layer);
    }
    const sourceUrl = BACKGROUND_RENDER_MODE === "ripple" ? artUrl : interactiveAtlasUrl;
    if (!interactiveController && sourceUrl) {
      try {
        interactiveController = createBackgroundEffect({
          mode: BACKGROUND_RENDER_MODE,
          layer,
          sourceUrl,
          config: INTERACTIVE,
          position: THEME.appearance?.backgroundPosition || { xPercent: 50, yPercent: 50 },
          motionMediaQuery,
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
        interactiveRuntimeState = "fallback";
      }
    }
    root?.style.setProperty("--skin-interactive-scrim-opacity", String(INTERACTIVE_SCRIM_OPACITY));
    syncInteractivePresentation();
  };

  const setDeferredInteractiveAtlasSource = (source, themeId) => {
    const expectedThemeId = String(THEME.id || "custom");
    if (BACKGROUND_RENDER_MODE !== "directional" || themeId !== expectedThemeId ||
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
    const state = window[STATE_KEY];
    if (state) state.interactiveAtlasUrl = source;
    ensureInteractiveLayer();
    return interactiveController?.inspect?.().fallback !== true;
  };

  const ensure = () => {
    if (window[DISABLED_KEY]) return;
    const root = document.documentElement;
    if (!root) return;
    const shell = resolvedShellMode();

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || root).appendChild(style);
    }
    if (style.dataset.skinStyleRevision !== STYLE_REVISION) {
      style.textContent = cssText;
      style.dataset.skinVersion = VERSION;
      style.dataset.skinStyleRevision = STYLE_REVISION;
    }

    if (videoEnabled && videoPlaybackPreference === "disabled") {
      restoreNativeAppearance();
      ensureVideoLayer();
      ensureThemeSettingsPage();
      syncOwnedThemeSettingsPresentation();
      return;
    }

    root.classList.add("cc-theme");
    root.setAttribute(SHELL_ATTR, shell);
    if (BRIDGE_ENABLED) {
      root.setAttribute("data-skin-theme-bridge", "1");
      root.setAttribute("data-skin-theme-id", String(THEME.id || "custom"));
    } else {
      root.removeAttribute("data-skin-theme-bridge");
      root.removeAttribute("data-skin-theme-id");
      root.removeAttribute(SURFACE_CONTEXT_ATTR);
      document.querySelectorAll("[data-skin-marker]").forEach((node) => {
        node.removeAttribute("data-skin-role");
        node.removeAttribute("data-skin-marker");
        node.removeAttribute("data-skin-overlay-kind");
      });
    }
    root.style.setProperty("--skin-art", `url("${artUrl}")`);
    root.style.setProperty("--skin-active-art", staticArtworkEnabled ? `url("${artUrl}")` : "none");
    root.style.setProperty("--skin-hero-art", heroArtDataUrl
      ? `url("${heroArtUrl}")`
      : staticArtworkEnabled ? `url("${artUrl}")` : "none");
    applyTheme(root, shell);
    applyStyleOverrides(root);
    applyArtAnalysis(root);
    ensureInteractiveLayer();

    // Claude Desktop has its own versioned UI Interpreter. Theme packages only
    // provide semantic values; every host selector and mount rule stays inside
    // the verified Claude adapter and its Surface Catalog.
    const shellMain = uiInterpreter.select("main");
    const primaryPane = uiInterpreter.select("primaryPane");
    const chatInput = uiInterpreter.select("composerInput");

    ensureThemeSettingsPage();
    const reconciled = BRIDGE_ENABLED
      ? uiInterpreter.reconcileRoles()
      : { composer: uiInterpreter.resolveComposer(chatInput, primaryPane), settings: resolveClaudeSettings() };
    const composer = reconciled.composer;
    const settingsDialog = reconciled.settings?.dialog || null;
    const surfaceContext = settingsDialog ? "settings"
      : primaryPane?.querySelector("article") ? "conversation" : "home";

    if (BRIDGE_ENABLED) {
      root.setAttribute(SURFACE_CONTEXT_ATTR, surfaceContext);
    }

    ensureVideoLayer();
  };

  const cleanup = () => {
    window[DISABLED_KEY] = true;
    videoPlaybackEpoch += 1;
    const state = window[STATE_KEY];
    const video = document.getElementById(VIDEO_LAYER_ID)?.querySelector("video");
    if (video) {
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {}
    }
    restoreNativeAppearance();
    document.documentElement?.removeAttribute(VIDEO_ATTR);
    document.documentElement?.removeAttribute(VIDEO_PLAYBACK_ATTR);
    document.documentElement?.removeAttribute(VIDEO_POSTER_ATTR);
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(VIDEO_LAYER_ID)?.remove();
    interactiveController?.dispose?.();
    interactiveController = null;
    document.getElementById(INTERACTIVE_LAYER_ID)?.remove();
    restoreThemeSettingsPage();
    document.getElementById(STYLE_EDITOR_ID)?.remove();
    document.getElementById(THEME_SETTINGS_NAV_ID)?.remove();
    document.getElementById(THEME_SETTINGS_PAGE_ID)?.remove();
    uiInterpreter.cleanup();
    state?.observer?.disconnect();
    if (state?.timer) clearInterval(state.timer);
    if (state?.scheduler?.timeout) clearTimeout(state.scheduler.timeout);
    if (analysisTimer) clearTimeout(analysisTimer);
    if (state?.resizeHandler) window.removeEventListener("resize", state.resizeHandler);
    state?.localeRuntime?.dispose?.();
    if (state?.mediaHandler && state?.mediaQuery) {
      try { state.mediaQuery.removeEventListener("change", state.mediaHandler); } catch {}
    }
    if (state?.motionMediaHandler && state?.motionMediaQuery) {
      try { state.motionMediaQuery.removeEventListener("change", state.motionMediaHandler); } catch {}
    }
    if (state?.visibilityHandler) document.removeEventListener("visibilitychange", state.visibilityHandler);
    if (state?.styleEditorOutsideHandler) document.removeEventListener("pointerdown", state.styleEditorOutsideHandler, true);
    if (state?.styleEditorKeyHandler) document.removeEventListener("keydown", state.styleEditorKeyHandler, true);
    if (state?.settingsNavNode && state?.settingsNavClickHandler) {
      state.settingsNavNode.removeEventListener("click", state.settingsNavClickHandler, true);
    }
    if (state?.styleEditorRequestTimer) clearTimeout(state.styleEditorRequestTimer);
    if (state?.stylePersistenceDebounceTimer) clearTimeout(state.stylePersistenceDebounceTimer);
    for (const request of state?.stylePersistenceRequests?.values?.() || []) clearTimeout(request.timeout);
    if (state?.styleEditorResultHandler && window[STYLE_EDITOR_RESULT_KEY] === state.styleEditorResultHandler) {
      delete window[STYLE_EDITOR_RESULT_KEY];
    }
    if (state?.runtimeResultHandler && window[THEME_RUNTIME_RESULT_KEY] === state.runtimeResultHandler) {
      delete window[THEME_RUNTIME_RESULT_KEY];
    }
    if (state?.videoArtUrl?.startsWith("blob:")) URL.revokeObjectURL(state.videoArtUrl);
    if (state?.motionFallbackUrl?.startsWith("blob:")) URL.revokeObjectURL(state.motionFallbackUrl);
    if (state?.interactiveAtlasUrl?.startsWith("blob:")) URL.revokeObjectURL(state.interactiveAtlasUrl);
    if (state?.heroArtUrl && state.heroArtUrl !== state.artUrl) URL.revokeObjectURL(state.heroArtUrl);
    if (state?.artUrl) URL.revokeObjectURL(state.artUrl);
    delete window[STATE_KEY];
    return true;
  };

  const scheduler = { timeout: null };
  const scheduleEnsure = () => {
    if (scheduler.timeout) clearTimeout(scheduler.timeout);
    scheduler.timeout = setTimeout(() => {
      scheduler.timeout = null;
      ensure();
    }, 180);
  };
  const containsSettingsRouteSignal = (node) => node instanceof Element && (
    node.matches('[role="dialog"], nav.flex.w-48.shrink-0.flex-col, #cc-theme-settings-nav-item') ||
    node.querySelector('[role="dialog"] > nav.flex.w-48.shrink-0.flex-col, #cc-theme-settings-nav-item')
  );
  const observer = new MutationObserver((mutations) => {
    // Settings replaces the complete app shell in one React commit. Waiting
    // for the general 180ms debounce lets the native opaque shell paint before
    // semantic Settings roles are applied, which appears as a route flash.
    // Mark Settings additions/removals in the same pre-paint mutation phase;
    // ordinary high-frequency DOM activity keeps the conservative debounce.
    const settingsRouteChanged = mutations.some((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].some(containsSettingsRouteSignal));
    if (settingsRouteChanged) {
      if (scheduler.timeout) {
        clearTimeout(scheduler.timeout);
        scheduler.timeout = null;
      }
      ensure();
      return;
    }
    scheduleEnsure();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-mode", "data-theme", "data-appearance", "data-color-mode"],
  });
  const timer = setInterval(ensure, 4000);
  const resizeHandler = scheduleEnsure;
  window.addEventListener("resize", resizeHandler, { passive: true });

  let mediaQuery = null;
  let mediaHandler = null;
  try {
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaHandler = () => scheduleEnsure();
    mediaQuery.addEventListener("change", mediaHandler);
  } catch {}

  const motionMediaHandler = () => {
    syncVideoPlayback();
    interactiveController?.setEnabled?.(interactiveEffectEnabled);
    syncInteractivePresentation();
  };
  motionMediaQuery.addEventListener("change", motionMediaHandler);
  const visibilityHandler = () => syncVideoPlayback();
  document.addEventListener("visibilitychange", visibilityHandler);
  void localeRuntime.start();

  window[STATE_KEY] = {
    ensure,
    cleanup,
    observer,
    timer,
    scheduler,
    resizeHandler,
    mediaQuery,
    mediaHandler,
    motionMediaQuery,
    motionMediaHandler,
    visibilityHandler,
    localeRuntime,
    hostEffectiveLocale: HOST_EFFECTIVE_LOCALE,
    editorLocale: EDITOR_LOCALE,
    localeDirection: EDITOR_LOCALE_DIRECTION,
    localeDiagnosticCode: LOCALE_DIAGNOSTIC_CODE,
    localeSource: "initializing",
    styleEditorOutsideHandler,
    styleEditorKeyHandler,
    styleEditorResultHandler: window[STYLE_EDITOR_RESULT_KEY],
    runtimeResultHandler: themeRuntimeResultHandler,
    styleEditorRequestTimer,
    stylePersistenceDebounceTimer,
    stylePersistenceRequests,
    uiInterpreter,
    editorRevision,
    persistedEditorRevision,
    styleEditorStatus: styleEditorStatusState,
    runtimeIssue: runtimeIssue ? { ...runtimeIssue } : null,
    editorDraft: { ...editorDraft },
    themeSettingsPageActive,
    settingsNavNode,
    settingsNavClickHandler,
    restoreThemeSettingsPage,
    styleOverrides: { ...styleOverrides },
    artUrl,
    heroArtUrl,
    videoArtUrl,
    videoEnabled,
    motionFallbackUrl,
    motionFallbackEnabled,
    motionFallbackDiagnosticCode: motionFallbackEnabled
      ? "video-media-policy-animated-image-fallback" : null,
    backgroundRenderMode: BACKGROUND_RENDER_MODE,
    interactiveAtlasUrl,
    interactiveEnabled,
    interactiveEffectEnabled,
    interactiveRuntimeState,
    interactiveController,
    interactiveScrimOpacity: INTERACTIVE_SCRIM_OPACITY,
    videoPosterMode: VIDEO_POSTER_MODE,
    videoScrimOpacity: VIDEO_SCRIM_OPACITY,
    videoPlaybackPreference,
    videoUserPaused,
    skinAppearanceActive: !videoEnabled || videoPlaybackPreference !== "disabled",
    rootStyleSnapshot,
    version: VERSION,
    themeId: THEME.id || "custom",
    detectShellMode,
    resolvedShellMode,
    artAnalysis,
    analysisTimer,
    installToken,
    setDeferredVideoSource,
    setDeferredMotionFallbackSource,
    setDeferredInteractiveAtlasSource,
  };
  ensure();
  if (!artAnalysis && ART.analysis !== "off") {
    const analysisPromise = analyzeArt();
    window[STATE_KEY].analysisTimer = analysisTimer;
    analysisPromise.then((result) => {
      const state = window[STATE_KEY];
      if (!result || state?.installToken !== installToken || window[DISABLED_KEY]) return;
      artAnalysis = result;
      if (typeof THEME.artKey === "string") analysisCache.set(THEME.artKey, result);
      state.artAnalysis = result;
      state.analysisTimer = null;
      scheduleEnsure();
    }).catch(() => {});
  }
  return {
    installed: true,
    version: VERSION,
    themeId: THEME.id || "custom",
    shell: resolvedShellMode(),
    videoEnabled,
    motionFallbackEnabled,
    motionFallbackDiagnosticCode: motionFallbackEnabled
      ? "video-media-policy-animated-image-fallback" : null,
    videoPosterMode: VIDEO_POSTER_MODE,
    backgroundRenderMode: BACKGROUND_RENDER_MODE,
    interactiveEnabled,
    interactiveRuntimeState,
  };
})(
  __SKIN_CSS_JSON__,
  __SKIN_ART_JSON__,
  __SKIN_HERO_ART_JSON__,
  __SKIN_VIDEO_JSON__,
  __SKIN_MOTION_FALLBACK_JSON__,
  __SKIN_INTERACTIVE_ATLAS_JSON__,
  __SKIN_THEME_JSON__,
  __THEME_STYLE_CATALOG_JSON__,
  __THEME_EDITOR_LOCALES_JSON__,
  __CLAUDE_LOCALE_CATALOG_JSON__,
  __CLAUDE_UI_ADAPTER_JSON__,
  __CLAUDE_UI_INTERPRETER_FACTORY__,
  __CLAUDE_LOCALE_RUNTIME_FACTORY__,
  __THEME_STYLE_OVERRIDES_JSON__,
  __THEME_RUNTIME_PREFERENCES_JSON__,
  __THEME_STYLE_OVERRIDE_STATE_JSON__,
  __THEME_STYLE_EDITOR_NONCE_JSON__,
  __THEME_STYLE_EDITOR_BINDING_JSON__,
  __SKIN_BACKGROUND_EFFECT_FACTORY__
)
