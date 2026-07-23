((cssText, artDataUrl, heroArtDataUrl, videoDataUrl, interactiveAtlasDataUrl, themeConfig, styleCatalogConfig, editorLocalesConfig, initialStyleOverrides, initialRuntimePreferences, initialOverrideState, styleEditorNonce, styleEditorBinding, createBackgroundEffect) => {
  const STATE_KEY = "__CC_THEME_STATE__";
  const DISABLED_KEY = "__CC_THEME_DISABLED__";
  const STYLE_ID = "cc-theme-style";
  const CHROME_ID = "cc-theme-chrome";
  const VIDEO_LAYER_ID = "cc-theme-video-layer";
  const VIDEO_TOGGLE_WRAPPER_ID = "cc-theme-video-toggle-wrapper";
  const VIDEO_TOGGLE_ID = "cc-theme-video-toggle";
  const STYLE_EDITOR_ID = "cc-theme-style-editor";
  const STYLE_EDITOR_STATUS_ID = "cc-theme-style-editor-status";
  const STYLE_EDITOR_RESULT_KEY = "__CC_THEME_EDITOR_RESULT__";
  const STYLE_EDITOR_SYNC_KEY = "__CC_THEME_APPLY_PERSISTED_OVERRIDES__";
  const THEME_RUNTIME_RESULT_KEY = "__CC_THEME_RUNTIME_RESULT__";
  const THEME_SETTINGS_NAV_ID = "cc-theme-settings-nav-item";
  const THEME_SETTINGS_SLUG = "cc-theme";
  const THEME_SETTINGS_PAGE_ID = "cc-theme-settings-page";
  const SETTINGS_APPEARANCE_SELECTOR = '[data-settings-panel-slug="appearance"]';
  const SETTINGS_THEME_PAGE_PRIMARY = true;
  const VIDEO_TOGGLE_ANCHOR_ATTR = "data-skin-video-control-anchor";
  const INTERACTIVE_LAYER_ID = "cc-theme-interactive-layer";
  const INTERACTIVE_MODE_ATTR = "data-skin-background-mode";
  const INTERACTIVE_STATE_ATTR = "data-skin-interactive-state";
  const SUMMARY_TOGGLE_LABELS = new Set([
    "Toggle pinned summary", "Toggle summary",
    "切换固定摘要", "切换置顶摘要", "切换摘要",
  ]);
  const BOTTOM_PANEL_TOGGLE_LABELS = new Set([
    "Toggle bottom panel", "切换底部面板",
  ]);
  const SIDE_PANEL_TOGGLE_LABELS = new Set([
    "Toggle side panel", "切换侧边面板", "切换侧面板",
  ]);
  const DEFERRED_VIDEO_SOURCE = "cc-theme:deferred-video";
  const DEFERRED_INTERACTIVE_ATLAS_SOURCE = "cc-theme:deferred-interactive-atlas";
  const SHELL_ATTR = "data-skin-shell";
  const HOME_LAYOUT_ATTR = "data-skin-home-layout";
  const SURFACE_CONTEXT_ATTR = "data-skin-surface-context";
  const VIDEO_ATTR = "data-skin-video";
  const VIDEO_PLAYBACK_ATTR = "data-skin-video-playback";
  const VIDEO_POSTER_ATTR = "data-skin-video-poster";
  const APP_MOUNT_ATTR = "data-skin-app-mount";
  const ART_ATTRS = [
    "data-skin-art-wide", "data-skin-art-safe", "data-skin-task-mode",
    "data-skin-art-safe-area", "data-skin-art-task-mode", "data-skin-art-aspect",
    "data-skin-art-ready",
  ];
  const VERSION = __SKIN_VERSION_JSON__;
  const STYLE_REVISION = __SKIN_STYLE_REVISION_JSON__;
  const THEME = themeConfig && typeof themeConfig === "object" ? themeConfig : {};
  const PRESENTATION_PROFILE = THEME.presentation?.profileId === "immersive-scene-v1" ? "immersive-scene-v1" : null;
  const STYLE_CATALOG = styleCatalogConfig && typeof styleCatalogConfig === "object" ? styleCatalogConfig : { groups: [], tokens: [] };
  const EDITOR_LOCALES = editorLocalesConfig && typeof editorLocalesConfig === "object"
    ? editorLocalesConfig : { defaultLocale: "en-US", locales: ["en-US"], aliases: {},
      fallbackByLanguage: {}, rtlLocales: [], messages: {}, groupLabels: {}, tokenLabels: {} };
  const STYLE_TOKENS = Array.isArray(STYLE_CATALOG.tokens) ? STYLE_CATALOG.tokens.filter((token) =>
    token && typeof token.id === "string" && typeof token.cssVariable === "string") : [];
  const RUNTIME_CONTROLS = new Map((Array.isArray(STYLE_CATALOG.runtimeControls)
    ? STYLE_CATALOG.runtimeControls : []).filter((control) => control && typeof control.id === "string" &&
      control.type === "enum" && Array.isArray(control.values)).map((control) => [control.id, control]));
  const normalizeRuntimePreferences = (values) => {
    const normalized = {};
    if (!values || typeof values !== "object" || Array.isArray(values)) return normalized;
    for (const [id, value] of Object.entries(values)) {
      const control = RUNTIME_CONTROLS.get(id);
      if (control?.values.includes(value)) normalized[id] = value;
    }
    return normalized;
  };
  const resolveEditorLocale = () => {
    const supported = Array.isArray(EDITOR_LOCALES.locales) ? EDITOR_LOCALES.locales : ["en-US"];
    const defaultLocale = supported.includes(EDITOR_LOCALES.defaultLocale)
      ? EDITOR_LOCALES.defaultLocale : supported[0] || "en-US";
    // The host's effective document language is the sole authority. Do not
    // drift to macOS/navigator language and never infer locale from UI or user content.
    const raw = String(document.documentElement?.lang || "").trim().replace(/_/g, "-");
    const lower = raw.toLowerCase();
    const exact = supported.find((locale) => locale.toLowerCase() === lower);
    const aliases = EDITOR_LOCALES.aliases && typeof EDITOR_LOCALES.aliases === "object"
      ? EDITOR_LOCALES.aliases : {};
    const alias = aliases[lower];
    const language = lower.split("-")[0];
    const languageFallback = EDITOR_LOCALES.fallbackByLanguage?.[language];
    const locale = exact || (supported.includes(alias) ? alias : null) ||
      (supported.includes(languageFallback) ? languageFallback : null) || defaultLocale;
    const diagnostic = raw && !exact && !alias && !languageFallback
      ? String(EDITOR_LOCALES.authority?.fallbackDiagnostic || "host-locale-fallback")
      : null;
    const hostDirection = String(document.documentElement?.dir || "").toLowerCase();
    const direction = hostDirection === "rtl" || hostDirection === "ltr"
      ? hostDirection
      : (Array.isArray(EDITOR_LOCALES.rtlLocales) && EDITOR_LOCALES.rtlLocales.includes(locale) ? "rtl" : "ltr");
    return { locale, diagnostic, direction };
  };
  let EDITOR_LOCALE_STATE = resolveEditorLocale();
  let EDITOR_LOCALE = EDITOR_LOCALE_STATE.locale;
  let EDITOR_LOCALE_INDEX = Math.max(0, (EDITOR_LOCALES.locales || ["en-US"]).indexOf(EDITOR_LOCALE));
  const EDITOR_DEFAULT_LOCALE_INDEX = Math.max(0,
    (EDITOR_LOCALES.locales || ["en-US"]).indexOf(EDITOR_LOCALES.defaultLocale));
  const refreshEditorLocale = () => {
    const next = resolveEditorLocale();
    if (next.locale === EDITOR_LOCALE_STATE.locale && next.diagnostic === EDITOR_LOCALE_STATE.diagnostic &&
        next.direction === EDITOR_LOCALE_STATE.direction) return false;
    EDITOR_LOCALE_STATE = next;
    EDITOR_LOCALE = next.locale;
    EDITOR_LOCALE_INDEX = Math.max(0, (EDITOR_LOCALES.locales || ["en-US"]).indexOf(EDITOR_LOCALE));
    const runtime = window[STATE_KEY];
    if (runtime) {
      runtime.editorLocale = next.locale;
      runtime.editorLocaleDiagnostic = next.diagnostic;
      runtime.editorLocaleDirection = next.direction;
    }
    return true;
  };
  const localizedEditorValue = (table, key, fallback = key) => {
    const values = table?.[key];
    return Array.isArray(values) && typeof values[EDITOR_LOCALE_INDEX] === "string"
      ? values[EDITOR_LOCALE_INDEX] : fallback;
  };
  const formatEditorMessage = (key, replacements = {}) => {
    const values = EDITOR_LOCALES.messages?.[key];
    const defaultMessage = Array.isArray(values) && typeof values[EDITOR_DEFAULT_LOCALE_INDEX] === "string"
      ? values[EDITOR_DEFAULT_LOCALE_INDEX] : "";
    let message = localizedEditorValue(EDITOR_LOCALES.messages, key, defaultMessage);
    for (const [name, value] of Object.entries(replacements)) message = message.replaceAll(`{${name}}`, String(value));
    return message;
  };
  const formatEditorNumber = (value) => {
    try {
      return new Intl.NumberFormat(EDITOR_LOCALE).format(value);
    } catch {
      return String(value);
    }
  };
  const localizedGroupLabel = (group) => localizedEditorValue(
    EDITOR_LOCALES.groupLabels, group.id, group.labelEn || group.labelZhCN || group.id,
  );
  const localizedTokenLabel = (token) => localizedEditorValue(
    EDITOR_LOCALES.tokenLabels, token.id, token.labelEn || token.labelZhCN || token.id,
  );
  let styleOverrides = initialStyleOverrides && typeof initialStyleOverrides === "object" && !Array.isArray(initialStyleOverrides)
    ? { ...initialStyleOverrides } : {};
  let editorDraft = { ...styleOverrides };
  let lastPersistedStyleOverrides = { ...styleOverrides };
  let runtimePreferences = normalizeRuntimePreferences(initialRuntimePreferences);
  let editorRuntimePreferences = { ...runtimePreferences };
  let lastPersistedRuntimePreferences = { ...runtimePreferences };
  const INITIAL_OVERRIDE_STATE = initialOverrideState && typeof initialOverrideState === "object" && !Array.isArray(initialOverrideState)
    ? initialOverrideState : {};
  const ART = THEME.art && typeof THEME.art === "object" ? THEME.art : {};
  const ART_METADATA = THEME.artMetadata && typeof THEME.artMetadata === "object"
    ? THEME.artMetadata : null;
  const ANALYSIS_CACHE_KEY = "__CC_THEME_ANALYSIS_CACHE__";
  const BRIDGE_ENABLED = THEME.themeBridgeEnabled === true;
  const HOME_LAYOUT = THEME.appearance?.newTaskLayout === "banner" ? "banner" : "cards";
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
    "--color-token-main-surface-primary", "--color-token-side-bar-background", "--color-token-bg-primary",
    "--color-token-bg-secondary", "--color-token-bg-fog", "--color-background-surface", "--color-background-surface-under",
    "--color-background-panel", "--color-background-elevated-primary",
    "--color-background-elevated-primary-opaque", "--color-background-elevated-secondary",
    "--color-background-elevated-secondary-opaque", "--color-background-control",
    "--color-background-control-opaque", "--color-background-editor-opaque", "--color-simple-scrim",
    "--color-background-accent", "--color-background-accent-hover", "--color-background-accent-active",
    "--color-background-button-primary", "--color-background-button-primary-hover",
    "--color-background-button-primary-active", "--color-background-button-primary-inactive",
    "--color-background-button-secondary", "--color-background-button-secondary-hover",
    "--color-background-button-secondary-active", "--color-background-button-secondary-inactive",
    "--color-background-button-tertiary", "--color-background-button-tertiary-hover",
    "--color-background-button-tertiary-active", "--color-background-status-success",
    "--color-background-status-warning", "--color-background-status-error",
    "--color-text-foreground", "--color-text-foreground-secondary", "--color-text-foreground-tertiary",
    "--color-text-accent", "--color-text-on-accent", "--color-text-button-primary",
    "--color-text-button-secondary", "--color-text-button-tertiary", "--color-text-success",
    "--color-text-warning", "--color-text-error", "--color-icon-primary", "--color-icon-secondary",
    "--color-icon-tertiary", "--color-icon-accent", "--color-icon-success", "--color-icon-warning",
    "--color-icon-error", "--color-border", "--color-border-light", "--color-border-heavy",
    "--color-border-focus", "--color-border-error", "--color-border-warning",
    "--color-token-foreground", "--color-token-description-foreground", "--color-token-disabled-foreground",
    "--color-token-icon-foreground", "--color-token-input-background", "--color-token-input-foreground",
    "--color-token-input-placeholder-foreground", "--color-token-input-border",
    "--color-token-dropdown-background", "--color-token-dropdown-foreground", "--color-token-menu-background",
    "--color-token-menu-border", "--color-token-menubar-selection-background",
    "--color-token-menubar-selection-foreground", "--color-token-toolbar-hover-background",
    "--color-token-button-background", "--color-token-button-foreground", "--color-token-button-border",
    "--color-token-button-secondary-hover-background", "--color-token-list-hover-background",
    "--color-token-list-active-selection-background", "--color-token-list-active-selection-foreground",
    "--color-token-list-active-selection-icon-foreground", "--color-token-focus-border",
    "--color-token-list-focus-outline", "--color-token-border", "--color-token-border-default",
    "--color-token-border-light", "--color-token-border-heavy", "--color-token-text-primary",
    "--color-token-text-secondary", "--color-token-text-tertiary", "--color-token-text-link-foreground",
    "--color-token-text-link-active-foreground", "--color-token-text-preformat-foreground",
    "--color-token-text-preformat-background", "--color-token-text-code-block-background",
    "--color-token-editor-background", "--color-token-editor-foreground",
    "--color-token-editor-widget-background", "--color-token-editor-selection-background",
    "--color-token-editor-find-match-background", "--color-token-editor-find-match-highlight-background",
    "--color-token-editor-group-drop-background", "--color-token-editor-group-drop-into-prompt-background",
    "--color-token-editor-group-drop-into-prompt-foreground", "--color-token-terminal-background",
    "--color-token-terminal-foreground", "--color-token-terminal-border",
    "--color-token-scrollbar-slider-background", "--color-token-scrollbar-slider-hover-background",
    "--color-token-scrollbar-slider-active-background", "--color-token-checkbox-background",
    "--color-token-checkbox-foreground", "--color-token-checkbox-border",
    "--color-token-radio-active-foreground", "--color-token-radio-inactive-border",
    "--color-token-badge-background", "--color-token-badge-foreground",
    "--color-token-activity-bar-badge-background", "--color-token-activity-bar-badge-foreground",
    "--color-token-progress-bar-background", "--color-token-charts-blue", "--color-token-charts-green",
    "--color-token-charts-orange", "--color-token-charts-purple", "--color-token-charts-red",
    "--color-token-charts-yellow", "--color-token-input-validation-info-background",
    "--color-token-input-validation-warning-background", "--color-token-input-validation-warning-border",
    "--color-token-input-validation-error-background", "--color-token-input-validation-error-border",
    "--color-token-diff-surface", "--color-token-diff-editor-inserted-line-background",
    "--color-token-diff-editor-removed-line-background", "--color-token-diff-editor-removed-text-background",
    "--color-token-error-foreground", "--color-token-editor-error-foreground",
    "--color-token-editor-warning-foreground", "--oai-wb-surface-primary",
    "--vscode-editor-background", "--vscode-editor-foreground", "--vscode-menu-background",
    "--vscode-menu-foreground", "--vscode-input-background", "--vscode-input-foreground",
    "--vscode-charts-blue", "--vscode-terminal-background", "--vscode-terminal-foreground",
    "--vscode-terminal-border", "--vscode-terminalCursor-foreground",
    "--vscode-terminal-selectionBackground", "--vscode-terminal-inactiveSelectionBackground",
    "--vscode-terminal-findMatchBackground", "--vscode-terminal-findMatchHighlightBackground",
    "--vscode-terminal-hoverHighlightBackground", "--vscode-terminal-dropBackground",
    "--vscode-terminalOverviewRuler-border", "--vscode-terminalOverviewRuler-cursorForeground",
    "--vscode-terminalOverviewRuler-findMatchForeground", "--vscode-terminal-initialHintForeground",
    "--vscode-terminalCommandGuide-foreground", "--vscode-terminal-tab.activeBorder",
    "--vscode-terminal-ansiBlack", "--vscode-terminal-ansiBrightBlack",
    "--vscode-terminal-ansiRed", "--vscode-terminal-ansiBrightRed",
    "--vscode-terminal-ansiGreen", "--vscode-terminal-ansiBrightGreen",
    "--vscode-terminal-ansiYellow", "--vscode-terminal-ansiBrightYellow",
    "--vscode-terminal-ansiBlue", "--vscode-terminal-ansiBrightBlue",
    "--vscode-terminal-ansiMagenta", "--vscode-terminal-ansiBrightMagenta",
    "--vscode-terminal-ansiCyan", "--vscode-terminal-ansiBrightCyan",
    "--vscode-terminal-ansiWhite", "--vscode-terminal-ansiBrightWhite",
    "--vscode-terminalCommandDecoration-defaultBackground",
    "--vscode-terminalCommandDecoration-errorBackground",
    "--vscode-terminalCommandDecoration-successBackground", "--vscode-terminalStickyScrollHover-background",
    "--vscode-panel-background", "--vscode-panel-border", "--vscode-panelTitle-activeForeground",
    "--vscode-panelTitle-inactiveForeground", "--vscode-panelTitle-activeBorder",
    "--vscode-panelStickyScroll-background", "--vscode-panelStickyScroll-shadow",
    "--vscode-panelSectionHeader-background", "--vscode-panelSection-border",
    "--vscode-panelSection-dropBackground", "--vscode-panel-dropBorder", "--vscode-panelInput-border",
    "--vscode-sash-hoverBorder", "--vscode-settings-sashBorder", "--vscode-profiles-sashBorder",
    "--vscode-simpleFindWidget-sashBorder",
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
    "--skin-particles-opacity", "--skin-motion-duration",
    "--skin-name", "--skin-tagline", "--skin-project-prefix",
    "--skin-project-label", "--skin-active-art",
    "--skin-native-canvas", "--skin-native-sidebar",
    "--scene-gold", "--scene-line", "--scene-panel", "--scene-raised", "--scene-texture-tint",
    "--scene-surface-opacity", "--scene-density-inset", "--scene-border-width",
    "--scene-navigation-frame-width", "--scene-composer-frame-width", "--scene-card-frame-width",
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
    typeof previous.styleEditorStatus.message === "string"
    ? { ...previous.styleEditorStatus } : null;
  const previousEditorDraft = previous?.themeId === String(THEME.id || "custom") &&
    previous?.editorDraft && typeof previous.editorDraft === "object" && !Array.isArray(previous.editorDraft)
    ? { ...previous.editorDraft } : null;
  if (previousEditorDraft) editorDraft = previousEditorDraft;
  if (previous?.themeId === String(THEME.id || "custom") && previous?.lastPersistedStyleOverrides &&
      typeof previous.lastPersistedStyleOverrides === "object" && !Array.isArray(previous.lastPersistedStyleOverrides)) {
    lastPersistedStyleOverrides = { ...previous.lastPersistedStyleOverrides };
  }
  if (previous?.themeId === String(THEME.id || "custom")) {
    if (previous?.editorRuntimePreferences && typeof previous.editorRuntimePreferences === "object") {
      editorRuntimePreferences = normalizeRuntimePreferences(previous.editorRuntimePreferences);
      runtimePreferences = { ...editorRuntimePreferences };
    }
    if (previous?.lastPersistedRuntimePreferences && typeof previous.lastPersistedRuntimePreferences === "object") {
      lastPersistedRuntimePreferences = normalizeRuntimePreferences(previous.lastPersistedRuntimePreferences);
    }
  }
  const ROOT_STYLE_VARIABLES = [...new Set([
    "--skin-art", "--skin-hero-art", ...THEME_VARIABLES,
  ])];
  // Preserve the host's inline values exactly. Most Codex theme tokens come
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
  const storedBackgroundPresentation = editorRuntimePreferences["background.presentation"];
  const previousVideoPlaybackPreference = previous?.themeId === String(THEME.id || "custom") &&
    ["playing", "paused", "disabled"].includes(previous?.videoPlaybackPreference)
    ? previous.videoPlaybackPreference
    : ["playing", "paused", "disabled"].includes(storedBackgroundPresentation)
      ? storedBackgroundPresentation : "playing";
  const previousVideoMotionOverride = previous?.videoMotionOverride === true;
  const previousRuntimeIssue = previous?.runtimeIssue && typeof previous.runtimeIssue === "object"
    ? { ...previous.runtimeIssue } : null;
  const previousInteractiveEffectEnabled = previous?.themeId === (THEME.id || "custom") &&
    previous?.backgroundRenderMode === BACKGROUND_RENDER_MODE
    ? previous.interactiveEffectEnabled !== false : storedBackgroundPresentation !== "static";
  if (previous?.observer) previous.observer.disconnect();
  if (previous?.timer) clearInterval(previous.timer);
  if (previous?.scheduler?.timeout) clearTimeout(previous.scheduler.timeout);
  if (previous?.analysisTimer) clearTimeout(previous.analysisTimer);
  if (previous?.resizeHandler) window.removeEventListener("resize", previous.resizeHandler);
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
  previous?.restoreThemeSettingsPage?.();
  if (previous?.styleEditorRequestTimer) clearTimeout(previous.styleEditorRequestTimer);
  if (previous?.styleEditorDebounceTimer) clearTimeout(previous.styleEditorDebounceTimer);
  if (previous?.styleEditorResultHandler && window[STYLE_EDITOR_RESULT_KEY] === previous.styleEditorResultHandler) {
    delete window[STYLE_EDITOR_RESULT_KEY];
  }
  if (previous?.styleEditorSyncHandler && window[STYLE_EDITOR_SYNC_KEY] === previous.styleEditorSyncHandler) {
    delete window[STYLE_EDITOR_SYNC_KEY];
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
  previous?.videoToggleWrapper?.remove();
  previous?.videoToggleAnchor?.removeAttribute?.(VIDEO_TOGGLE_ANCHOR_ATTR);
  document.querySelectorAll(`[${VIDEO_TOGGLE_ANCHOR_ATTR}]`).forEach((node) =>
    node.removeAttribute(VIDEO_TOGGLE_ANCHOR_ATTR));
  document.getElementById(VIDEO_TOGGLE_WRAPPER_ID)?.remove();
  document.getElementById(VIDEO_TOGGLE_ID)?.remove();
  document.getElementById(STYLE_EDITOR_ID)?.remove();
  document.getElementById(THEME_SETTINGS_NAV_ID)?.remove();
  document.getElementById(THEME_SETTINGS_PAGE_ID)?.remove();
  // Migrate layout tokens written by older bridge revisions back to the exact
  // host snapshot. They are intentionally no longer part of the active theme
  // variable set because even a radius token causes a visible enable/disable
  // geometry change on the native Composer.
  for (const name of ["--codex-corner-radius-scale"]) {
    const original = previous?.rootStyleSnapshot?.[name];
    if (!previous || !document.documentElement) continue;
    if (original?.value) {
      document.documentElement.style.setProperty(name, original.value, original.priority || "");
    } else {
      document.documentElement.style.removeProperty(name);
    }
  }
  if (previous?.videoArtUrl?.startsWith("blob:")) URL.revokeObjectURL(previous.videoArtUrl);
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
  let videoMotionOverride = previousVideoMotionOverride;
  let videoPlaybackEpoch = 0;
  let motionMediaQuery = null;
  try { motionMediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch {}
  motionMediaQuery ||= { matches: false, addEventListener() {}, removeEventListener() {} };
  let ownedVideoToggleWrapper = null;
  let ownedVideoToggle = null;
  let ownedVideoToggleAnchor = null;
  let ownedAppMount = previous?.appMount instanceof Element && previous.appMount.isConnected
    ? previous.appMount
    : null;

  const cssString = (value) => JSON.stringify(String(value ?? ""));
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
    root.removeAttribute(HOME_LAYOUT_ATTR);
    root.removeAttribute(SURFACE_CONTEXT_ATTR);
    root.removeAttribute(INTERACTIVE_MODE_ATTR);
    root.removeAttribute(INTERACTIVE_STATE_ATTR);
    root.removeAttribute("data-skin-route");
    root.removeAttribute("data-skin-library-route");
    for (const name of ART_ATTRS) root.removeAttribute(name);
    restoreRootStyleSnapshot();
    ownedAppMount?.removeAttribute(APP_MOUNT_ATTR);
    document.querySelectorAll("[data-skin-marker]").forEach((node) => {
      node.removeAttribute("data-skin-role");
      node.removeAttribute("data-skin-marker");
      node.removeAttribute("data-skin-overlay-kind");
      node.removeAttribute("data-skin-card-index");
    });
    document.querySelectorAll(".skin-home").forEach((node) => node.classList.remove("skin-home"));
    document.querySelectorAll(".skin-home-shell").forEach((node) => node.classList.remove("skin-home-shell"));
    const chrome = document.getElementById(CHROME_ID);
    if (chrome) chrome.hidden = true;
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

  /** Detect Codex app light/dark shell for CSS branching. */
  const detectShellMode = () => {
    const root = document.documentElement;
    const body = document.body;
    const cls = `${root.className || ""} ${body?.className || ""}`.toLowerCase();

    if (/\b(dark|theme-dark|appearance-dark)\b/.test(cls)) return "dark";
    if (/\b(light|theme-light|appearance-light)\b/.test(cls)) return "light";

    const dataTheme = (
      root.getAttribute("data-theme") ||
      root.getAttribute("data-appearance") ||
      root.getAttribute("data-color-mode") ||
      body?.getAttribute("data-theme") ||
      body?.getAttribute("data-appearance") ||
      ""
    ).toLowerCase();
    if (dataTheme.includes("dark")) return "dark";
    if (dataTheme.includes("light")) return "light";

    // Radios in profile menu (if present in DOM)
    const checked = document.querySelector('input[name="appearance-theme"]:checked');
    if (checked) {
      const label = (checked.getAttribute("aria-label") || checked.value || "").toLowerCase();
      if (label.includes("暗") || label.includes("dark")) return "dark";
      if (label.includes("浅") || label.includes("light")) return "light";
      if (label.includes("系统") || label.includes("system")) {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
    }

    try {
      const cs = getComputedStyle(root).colorScheme || "";
      if (cs.includes("dark") && !cs.includes("light")) return "dark";
      if (cs.includes("light") && !cs.includes("dark")) return "light";
    } catch {}

    // Background luminance of main surfaces
    const samples = [
      body,
      document.querySelector('[data-app-shell-main-content-layout]')?.closest("main"),
      document.querySelector("main.main-surface"),
      document.querySelector(".app-shell-left-panel"),
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

  // In system mode, inherit Codex's current light/dark text, action and status
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
        if (computedValue && !computedValue.includes("--skin-")) return computedValue;
        const inlineValue = String(previous.get(name) || "").trim();
        if (inlineValue && !inlineValue.includes("--skin-")) return inlineValue;
      }
      return undefined;
    };
    const compact = (values) => Object.fromEntries(
      Object.entries(values).filter(([, value]) => typeof value === "string" && value),
    );
    const colors = compact({
      accent: read("--color-token-button-background", "--color-background-button-primary", "--color-text-accent"),
      accentAlt: read("--color-background-button-primary-hover", "--color-token-text-link-active-foreground"),
      secondary: read("--color-token-text-link-foreground", "--color-text-accent"),
      highlight: read("--color-border-focus", "--color-token-focus-border"),
      text: read("--color-token-text-primary", "--color-text-foreground", "--color-token-foreground"),
      muted: read("--color-token-text-secondary", "--color-text-foreground-secondary", "--color-token-description-foreground"),
      line: read("--color-token-border-default", "--color-border", "--color-token-border"),
    });
    const semanticColors = compact({
      textStrong: read("--color-token-text-primary", "--color-text-foreground"),
      placeholder: read("--color-token-text-tertiary", "--color-text-foreground-tertiary", "--color-token-input-placeholder-foreground"),
      borderSubtle: read("--color-token-border-light", "--color-border-light"),
      borderDefault: read("--color-token-border-default", "--color-border"),
      borderStrong: read("--color-token-border-heavy", "--color-border-heavy"),
      action: read("--color-token-button-background", "--color-background-button-primary"),
      actionHover: read("--color-background-button-primary-hover", "--color-token-text-link-active-foreground"),
      actionPressed: read("--color-background-button-primary-active", "--color-background-accent-active"),
      actionForeground: read("--color-token-button-foreground", "--color-text-button-primary", "--color-text-on-accent"),
      focusRing: read("--color-token-focus-border", "--color-border-focus"),
      link: read("--color-token-text-link-foreground", "--color-text-accent"),
      danger: read("--color-text-error", "--color-token-error-foreground"),
      success: read("--color-text-success", "--color-icon-success"),
      warning: read("--color-text-warning", "--color-icon-warning"),
    });
    const surfaces = compact({
      canvas: read(
        "--color-token-main-surface-primary", "--color-background-surface",
        "--color-background-elevated-primary-opaque", "--vscode-editor-background",
      ),
      sidebar: read(
        "--color-token-side-bar-background", "--color-background-panel",
        "--color-background-elevated-secondary-opaque",
      ),
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
    const appearanceVariant = THEME.appearanceVariants?.[shell] || null;
    const colors = appearanceVariant?.colors || THEME.colors || {};
    const explicit = new Set(appearanceVariant
      ? Object.keys(appearanceVariant.colors || {})
      : (Array.isArray(THEME.explicitColorKeys) ? THEME.explicitColorKeys : []));
    const explicitSemantic = new Set(appearanceVariant
      ? Object.keys(appearanceVariant.semanticColors || {})
      : (Array.isArray(THEME.explicitSemanticColorKeys) ? THEME.explicitSemanticColorKeys : []));
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
    // even when no color was explicitly authored. Likewise, Codex can expose
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
      const semantic = appearanceVariant?.semanticColors || THEME.semanticColors || {};
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
        "--skin-particles-opacity": appearance.reduceParticles ? "0" : ".24",
        "--skin-motion-duration": "150ms",
        "--color-token-main-surface-primary": "var(--skin-surface-base)",
        "--color-token-bg-primary": "var(--skin-surface-base)",
        "--color-token-bg-secondary": "var(--skin-surface-raised)",
        "--color-token-bg-fog": "var(--skin-surface-raised)",
        "--color-background-surface": "var(--skin-surface-base)",
        "--color-background-surface-under": "var(--skin-bg)",
        "--color-background-panel": "var(--skin-surface-raised)",
        "--color-background-elevated-primary": "var(--skin-surface-elevated)",
        "--color-background-elevated-primary-opaque": "var(--skin-surface-elevated)",
        "--color-background-elevated-secondary": "var(--skin-surface-raised)",
        "--color-background-elevated-secondary-opaque": "var(--skin-surface-raised)",
        "--color-background-control": "var(--skin-surface-raised)",
        "--color-background-control-opaque": "var(--skin-surface-raised)",
        "--color-background-editor-opaque": "var(--skin-surface-code)",
        "--color-simple-scrim": "rgba(0, 0, 0, .62)",
        "--color-background-accent": "var(--skin-selected-surface)",
        "--color-background-accent-hover": "var(--skin-selected-hover-surface)",
        "--color-background-accent-active": "var(--skin-pressed-surface)",
        "--color-background-button-primary": "var(--skin-action)",
        "--color-background-button-primary-hover": "var(--skin-action-hover)",
        "--color-background-button-primary-active": "var(--skin-action-pressed)",
        "--color-background-button-primary-inactive": "color-mix(in srgb, var(--skin-action) 36%, var(--skin-surface-raised))",
        "--color-background-button-secondary": "var(--skin-surface-raised)",
        "--color-background-button-secondary-hover": "var(--skin-hover-surface)",
        "--color-background-button-secondary-active": "var(--skin-pressed-surface)",
        "--color-background-button-secondary-inactive": "color-mix(in srgb, var(--skin-surface-raised) 72%, transparent)",
        "--color-background-button-tertiary": "transparent",
        "--color-background-button-tertiary-hover": "var(--skin-hover-surface)",
        "--color-background-button-tertiary-active": "var(--skin-pressed-surface)",
        "--color-background-status-success": "color-mix(in srgb, var(--skin-success) 16%, var(--skin-surface-raised))",
        "--color-background-status-warning": "color-mix(in srgb, var(--skin-warning) 16%, var(--skin-surface-raised))",
        "--color-background-status-error": "color-mix(in srgb, var(--skin-danger) 16%, var(--skin-surface-raised))",
        "--color-text-foreground": "var(--skin-text)",
        "--color-text-foreground-secondary": "var(--skin-muted)",
        "--color-text-foreground-tertiary": "var(--skin-placeholder)",
        "--color-text-accent": "var(--skin-link)",
        "--color-text-on-accent": "var(--skin-action-foreground)",
        "--color-text-button-primary": "var(--skin-action-foreground)",
        "--color-text-button-secondary": "var(--skin-text-strong)",
        "--color-text-button-tertiary": "var(--skin-muted)",
        "--color-text-success": "var(--skin-success)",
        "--color-text-warning": "var(--skin-warning)",
        "--color-text-error": "var(--skin-danger)",
        "--color-icon-primary": "var(--skin-text)",
        "--color-icon-secondary": "var(--skin-muted)",
        "--color-icon-tertiary": "var(--skin-placeholder)",
        "--color-icon-accent": "var(--skin-focus-ring)",
        "--color-icon-success": "var(--skin-success)",
        "--color-icon-warning": "var(--skin-warning)",
        "--color-icon-error": "var(--skin-danger)",
        "--color-border": "var(--skin-border-default)",
        "--color-border-light": "var(--skin-border-subtle)",
        "--color-border-heavy": "var(--skin-border-strong)",
        "--color-border-focus": "var(--skin-focus-ring)",
        "--color-border-error": "var(--skin-danger)",
        "--color-border-warning": "var(--skin-warning)",
        "--color-token-foreground": "var(--skin-text)",
        "--color-token-description-foreground": "var(--skin-muted)",
        "--color-token-disabled-foreground": "color-mix(in srgb, var(--skin-muted) 52%, transparent)",
        "--color-token-icon-foreground": "var(--skin-text)",
        "--color-token-side-bar-background": "var(--skin-sidebar-surface)",
        "--color-token-input-background": "var(--skin-surface-raised)",
        "--color-token-input-foreground": "var(--skin-text)",
        "--color-token-input-placeholder-foreground": "var(--skin-placeholder)",
        "--color-token-input-border": "var(--skin-border-default)",
        "--color-token-dropdown-background": "var(--skin-surface-elevated)",
        "--color-token-dropdown-foreground": "var(--skin-text)",
        "--color-token-menu-background": "var(--skin-surface-elevated)",
        "--color-token-menu-border": "var(--skin-border-default)",
        "--color-token-menubar-selection-background": "var(--skin-hover-surface)",
        "--color-token-menubar-selection-foreground": "var(--skin-text-strong)",
        "--color-token-toolbar-hover-background": "var(--skin-hover-surface)",
        "--color-token-button-background": "var(--skin-action)",
        "--color-token-button-foreground": "var(--skin-action-foreground)",
        "--color-token-button-border": "var(--skin-border-default)",
        "--color-token-button-secondary-hover-background": "var(--skin-hover-surface)",
        "--color-token-list-hover-background": "var(--skin-hover-surface)",
        "--color-token-list-active-selection-background": "var(--skin-selected-surface)",
        "--color-token-list-active-selection-foreground": "var(--skin-text-strong)",
        "--color-token-list-active-selection-icon-foreground": "var(--skin-focus-ring)",
        "--color-token-focus-border": "var(--skin-focus-ring)",
        "--color-token-list-focus-outline": "var(--skin-focus-ring)",
        "--color-token-border": "var(--skin-border-default)",
        "--color-token-border-default": "var(--skin-border-default)",
        "--color-token-border-light": "var(--skin-border-subtle)",
        "--color-token-border-heavy": "var(--skin-border-strong)",
        "--color-token-text-primary": "var(--skin-text)",
        "--color-token-text-secondary": "var(--skin-muted)",
        "--color-token-text-tertiary": "var(--skin-placeholder)",
        "--color-token-text-link-foreground": "var(--skin-link)",
        "--color-token-text-link-active-foreground": "var(--skin-text-strong)",
        "--color-token-text-preformat-foreground": "var(--skin-text)",
        "--color-token-text-preformat-background": "var(--skin-surface-code)",
        "--color-token-text-code-block-background": "var(--skin-surface-code)",
        "--color-token-editor-background": "var(--skin-surface-code)",
        "--color-token-editor-foreground": "var(--skin-text)",
        "--color-token-editor-widget-background": "var(--skin-surface-elevated)",
        "--color-token-editor-selection-background": "var(--skin-selected-surface)",
        "--color-token-editor-find-match-background": "var(--skin-selected-surface)",
        "--color-token-editor-find-match-highlight-background": "var(--skin-hover-surface)",
        "--color-token-editor-group-drop-background": "var(--skin-selected-surface)",
        "--color-token-editor-group-drop-into-prompt-background": "var(--skin-selected-surface)",
        "--color-token-editor-group-drop-into-prompt-foreground": "var(--skin-text-strong)",
        "--color-token-terminal-background": "var(--skin-surface-code)",
        "--color-token-terminal-foreground": "var(--skin-text)",
        "--color-token-terminal-border": "var(--skin-border-default)",
        "--color-token-scrollbar-slider-background": "color-mix(in srgb, var(--skin-border-default) 62%, transparent)",
        "--color-token-scrollbar-slider-hover-background": "var(--skin-border-default)",
        "--color-token-scrollbar-slider-active-background": "var(--skin-border-strong)",
        "--color-token-checkbox-background": "var(--skin-surface-raised)",
        "--color-token-checkbox-foreground": "var(--skin-text)",
        "--color-token-checkbox-border": "var(--skin-border-default)",
        "--color-token-radio-active-foreground": "var(--skin-focus-ring)",
        "--color-token-radio-inactive-border": "var(--skin-border-default)",
        "--color-token-badge-background": "var(--skin-selected-surface)",
        "--color-token-badge-foreground": "var(--skin-text-strong)",
        "--color-token-activity-bar-badge-background": "var(--skin-action)",
        "--color-token-activity-bar-badge-foreground": "var(--skin-action-foreground)",
        "--color-token-progress-bar-background": "var(--skin-focus-ring)",
        "--color-token-charts-blue": "var(--skin-action)",
        "--color-token-charts-green": "var(--skin-success)",
        "--color-token-charts-orange": "var(--skin-warning)",
        "--color-token-charts-purple": "var(--skin-action-hover)",
        "--color-token-charts-red": "var(--skin-danger)",
        "--color-token-charts-yellow": "var(--skin-warning)",
        "--color-token-input-validation-info-background": "color-mix(in srgb, var(--skin-link) 16%, var(--skin-surface-elevated))",
        "--color-token-input-validation-warning-background": "color-mix(in srgb, var(--skin-warning) 16%, var(--skin-surface-elevated))",
        "--color-token-input-validation-warning-border": "var(--skin-warning)",
        "--color-token-input-validation-error-background": "color-mix(in srgb, var(--skin-danger) 16%, var(--skin-surface-elevated))",
        "--color-token-input-validation-error-border": "var(--skin-danger)",
        "--color-token-diff-editor-inserted-line-background": "color-mix(in srgb, var(--skin-success) 18%, transparent)",
        "--color-token-diff-editor-removed-line-background": "color-mix(in srgb, var(--skin-danger) 18%, transparent)",
        "--color-token-diff-editor-removed-text-background": "color-mix(in srgb, var(--skin-danger) 24%, transparent)",
        "--color-token-diff-surface": "var(--skin-surface-code)",
        "--color-token-error-foreground": "var(--skin-danger)",
        "--color-token-editor-error-foreground": "var(--skin-danger)",
        "--color-token-editor-warning-foreground": "var(--skin-warning)",
        "--vscode-editor-background": "var(--skin-surface-code)",
        "--vscode-editor-foreground": "var(--skin-text)",
        "--vscode-menu-background": "var(--skin-surface-elevated)",
        "--vscode-menu-foreground": "var(--skin-text)",
        "--vscode-input-background": "var(--skin-surface-raised)",
        "--vscode-input-foreground": "var(--skin-text)",
        "--vscode-charts-blue": "var(--skin-action)",
        "--vscode-terminal-background": "var(--skin-surface-code)",
        "--vscode-terminal-foreground": "var(--skin-text)",
        "--vscode-terminal-border": "var(--skin-border-default)",
        "--vscode-terminalCursor-foreground": "var(--skin-text-strong)",
        "--vscode-terminal-selectionBackground": "var(--skin-selected-surface)",
        "--vscode-terminal-inactiveSelectionBackground": "color-mix(in srgb, var(--skin-selected-surface) 68%, transparent)",
        "--vscode-terminal-findMatchBackground": "var(--skin-selected-hover-surface)",
        "--vscode-terminal-findMatchHighlightBackground": "var(--skin-hover-surface)",
        "--vscode-terminal-hoverHighlightBackground": "var(--skin-hover-surface)",
        "--vscode-terminal-dropBackground": "var(--skin-pressed-surface)",
        "--vscode-terminalOverviewRuler-border": "var(--skin-border-default)",
        "--vscode-terminalOverviewRuler-cursorForeground": "var(--skin-text-strong)",
        "--vscode-terminalOverviewRuler-findMatchForeground": "var(--skin-focus-ring)",
        "--vscode-terminal-initialHintForeground": "var(--skin-link)",
        "--vscode-terminalCommandGuide-foreground": "var(--skin-link)",
        "--vscode-terminal-tab.activeBorder": "var(--skin-border-strong)",
        "--vscode-terminal-ansiBlack": "var(--skin-bg)",
        "--vscode-terminal-ansiBrightBlack": "var(--skin-muted)",
        "--vscode-terminal-ansiRed": "var(--skin-danger)",
        "--vscode-terminal-ansiBrightRed": "var(--skin-danger)",
        "--vscode-terminal-ansiGreen": "var(--skin-success)",
        "--vscode-terminal-ansiBrightGreen": "var(--skin-success)",
        "--vscode-terminal-ansiYellow": "var(--skin-warning)",
        "--vscode-terminal-ansiBrightYellow": "var(--skin-warning)",
        "--vscode-terminal-ansiBlue": "var(--skin-link)",
        "--vscode-terminal-ansiBrightBlue": "var(--skin-link)",
        "--vscode-terminal-ansiMagenta": "var(--skin-action-hover)",
        "--vscode-terminal-ansiBrightMagenta": "var(--skin-action-hover)",
        "--vscode-terminal-ansiCyan": "var(--skin-link)",
        "--vscode-terminal-ansiBrightCyan": "var(--skin-link)",
        "--vscode-terminal-ansiWhite": "var(--skin-text)",
        "--vscode-terminal-ansiBrightWhite": "var(--skin-text-strong)",
        "--vscode-terminalCommandDecoration-defaultBackground": "var(--skin-muted)",
        "--vscode-terminalCommandDecoration-errorBackground": "var(--skin-danger)",
        "--vscode-terminalCommandDecoration-successBackground": "var(--skin-success)",
        "--vscode-terminalStickyScrollHover-background": "var(--skin-surface-elevated)",
        "--vscode-panel-background": "var(--skin-surface-raised)",
        "--vscode-panel-border": "var(--skin-border-default)",
        "--vscode-panelTitle-activeForeground": "var(--skin-text-strong)",
        "--vscode-panelTitle-inactiveForeground": "var(--skin-placeholder)",
        "--vscode-panelTitle-activeBorder": "var(--skin-border-strong)",
        "--vscode-panelStickyScroll-background": "var(--skin-surface-elevated)",
        "--vscode-panelStickyScroll-shadow": "var(--skin-border-subtle)",
        "--vscode-panelSectionHeader-background": "var(--skin-surface-elevated)",
        "--vscode-panelSection-border": "var(--skin-border-default)",
        "--vscode-panelSection-dropBackground": "var(--skin-pressed-surface)",
        "--vscode-panel-dropBorder": "var(--skin-border-default)",
        "--vscode-panelInput-border": "var(--skin-border-default)",
        "--vscode-sash-hoverBorder": "var(--skin-focus-ring)",
        "--vscode-settings-sashBorder": "var(--skin-border-default)",
        "--vscode-profiles-sashBorder": "var(--skin-border-default)",
        "--vscode-simpleFindWidget-sashBorder": "var(--skin-border-default)",
        "--oai-wb-surface-primary": "var(--skin-surface-raised)",
      });

      // The immersive recipe is Adapter-owned, while these values come only
      // from the closed Shared Core presentation envelope. Keep the values in
      // CSS custom properties so an owned role can consume every declared
      // semantic parameter without exposing host selectors to a Theme Package.
      if (PRESENTATION_PROFILE === "immersive-scene-v1") {
        const scene = THEME.presentation?.parameters || {};
        const texture = Math.round(Math.min(1, Math.max(0, Number(scene.textureIntensity) || 0)) * 30);
        const requestedOpacity = Number(scene.surfaceOpacity);
        const opacity = Math.round(Math.min(1, Math.max(0, Number.isFinite(requestedOpacity) ? requestedOpacity : .72)) * 100);
        Object.assign(variables, {
          "--scene-gold": "var(--skin-action)",
          "--scene-line": "color-mix(in srgb, var(--scene-gold) 34%, transparent)",
          "--scene-panel": "color-mix(in srgb, var(--skin-panel) var(--scene-surface-opacity), transparent)",
          "--scene-raised": "color-mix(in srgb, var(--skin-panel-2) var(--scene-surface-opacity), transparent)",
          "--scene-texture-tint": `color-mix(in srgb, var(--scene-gold) ${texture}%, transparent)`,
          "--scene-surface-opacity": `${opacity}%`,
          "--scene-density-inset": scene.density === "comfortable" ? "12px" : "0px",
          "--scene-border-width": scene.borderTreatment === "etched" ? "1px" : "0px",
          "--scene-navigation-frame-width": scene.navigationTreatment === "framed" ? "1px" : "0px",
          "--scene-composer-frame-width": scene.composerTreatment === "anchored" ? "1px" : "0px",
          "--scene-card-frame-width": scene.cardTreatment === "elevated" ? "1px" : "0px",
        });
      }
    }

    for (const [name, value] of Object.entries(variables)) {
      if (typeof value === "string" && value) {
        root.style.setProperty(name, value);
        if (!THEME_VARIABLES.includes(name)) THEME_VARIABLES.push(name);
      }
    }
    // Versions before 1.4.3 exposed manifest metadata as New Task generated
    // content. Remove any inline leftovers during hot reapply as well as on a
    // clean launch; the metadata remains available in THEME only.
    root.style.removeProperty("--skin-name");
    root.style.removeProperty("--skin-tagline");
    root.style.setProperty("--skin-project-prefix", cssString(THEME.projectPrefix || "选择项目 · "));
    root.style.setProperty("--skin-project-label", cssString(THEME.projectLabel || "◉  选择项目"));
  };

  const editorValueIsValid = (token, value) => {
    if (token.type === "color") {
      return typeof value === "string" && /^(?:#[0-9A-Fa-f]{6}|rgba?\([0-9., %]+\))$/.test(value.trim());
    }
    return token.type === "fontList" && Array.isArray(value) && value.length >= 1 && value.length <= 8 &&
      value.every((item) => typeof item === "string" && /^[\p{L}\p{N} ._-]{1,80}$/u.test(item.trim()));
  };

  const editorCssValue = (token, value) => token.type === "fontList" ? value.join(", ") : value;

  const applyStyleOverrides = (root, values = editorDraft) => {
    if (!root) return;
    for (const token of STYLE_TOKENS) {
      if (!Object.hasOwn(values, token.id) || !editorValueIsValid(token, values[token.id])) continue;
      root.style.setProperty(token.cssVariable, editorCssValue(token, values[token.id]));
    }
  };

  const existingStyle = document.getElementById(STYLE_ID);
  if (existingStyle) {
    existingStyle.textContent = cssText;
    existingStyle.dataset.skinVersion = VERSION;
  }

  const getVideoElement = () => document.getElementById(VIDEO_LAYER_ID)?.querySelector("video") || null;

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
      updateVideoToggle();
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
          updateVideoToggle();
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
    state.videoMotionOverride = videoMotionOverride;
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
    } else {
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
  let queuedStyleEditorWrite = null;
  let styleEditorRequestTimer = null;
  let styleEditorDebounceTimer = null;
  let editorWriteVersion = Number.isSafeInteger(previous?.editorWriteVersion)
    ? previous.editorWriteVersion : 0;
  let themeSettingsPageActive = previousThemeSettingsPageActive;
  let settingsNavNode = null;
  let settingsNavClickHandler = null;
  let previousNativeSettingsNav = null;
  let previousNativeSettingsNavPresentation = null;
  let inactiveNativeSettingsNavPresentation = null;
  let styleEditorStatusState = previousStyleEditorStatus;
  let runtimeIssue = previousRuntimeIssue;
  if (!runtimeIssue && Array.isArray(INITIAL_OVERRIDE_STATE.diagnostics) && INITIAL_OVERRIDE_STATE.diagnostics.length) {
    runtimeIssue = {
      stage: "runtime-overrides",
      message: formatEditorMessage("localOverridesAdjusted"),
    };
  }

  const setStyleEditorStatus = (message, state = "idle") => {
    styleEditorStatusState = { message, state };
    const runtime = window[STATE_KEY];
    if (runtime) runtime.styleEditorStatus = { ...styleEditorStatusState };
    const status = document.getElementById(STYLE_EDITOR_STATUS_ID);
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  };

  const localizedStyleEditorStatus = () => {
    const state = styleEditorStatusState?.state || "idle";
    const key = state === "saving" ? "applyingChanges"
      : state === "success" ? "changesApplied"
        : state === "error" ? "persistenceFailed" : "localOnly";
    return { message: formatEditorMessage(key), state };
  };

  const renderThemeRuntimeIssue = () => {
    const notice = document.getElementById("cc-theme-runtime-notice");
    if (!notice) return;
    notice.hidden = !runtimeIssue;
    notice.dataset.state = runtimeIssue ? "error" : "idle";
    const title = notice.querySelector("strong");
    const detail = notice.querySelector("span");
    if (title) title.textContent = formatEditorMessage(
      runtimeIssue?.stage === "runtime-overrides" ? "localOverridesNotice" : "themeLoadFailed",
    );
    if (detail) {
      detail.textContent = runtimeIssue?.stage === "runtime-overrides"
        ? formatEditorMessage("localOverridesAdjusted")
        : formatEditorMessage("currentThemePreserved");
    }
  };

  const setThemeRuntimeIssue = (issue = null) => {
    runtimeIssue = issue && typeof issue === "object" ? {
      stage: String(issue.stage || "theme-load").slice(0, 80),
      message: String(issue.message || "").slice(0, 500),
    } : null;
    const runtime = window[STATE_KEY];
    if (runtime) runtime.runtimeIssue = runtimeIssue ? { ...runtimeIssue } : null;
    renderThemeRuntimeIssue();
    if (runtimeIssue) setStyleEditorStatus(formatEditorMessage("themeLoadFailed"), "error");
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
      runtime.editorRuntimePreferences = { ...editorRuntimePreferences };
      runtime.editorWriteVersion = editorWriteVersion;
      runtime.lastPersistedStyleOverrides = { ...lastPersistedStyleOverrides };
      runtime.lastPersistedRuntimePreferences = { ...lastPersistedRuntimePreferences };
    }
  };

  const applyEditorRuntimePreferences = () => {
    const presentation = editorRuntimePreferences["background.presentation"];
    if (videoEnabled) {
      videoPlaybackPreference = ["playing", "paused", "disabled"].includes(presentation)
        ? presentation : "playing";
      videoMotionOverride = false;
      persistVideoPlaybackPreference();
    }
    if (interactiveEnabled) {
      interactiveEffectEnabled = presentation !== "static";
      interactiveController?.setEnabled?.(interactiveEffectEnabled);
    }
  };

  const restoreLastPersistedStyleOverrides = () => {
    editorDraft = { ...lastPersistedStyleOverrides };
    styleOverrides = { ...lastPersistedStyleOverrides };
    editorRuntimePreferences = { ...lastPersistedRuntimePreferences };
    runtimePreferences = { ...lastPersistedRuntimePreferences };
    applyEditorRuntimePreferences();
    persistEditorDraft();
    ensure();
    refreshStyleEditorInputs();
    updateStyleEditorEffectControl();
  };

  const styleEditorInputValue = (token) => {
    const value = editorDraft[token.id];
    if (editorValueIsValid(token, value)) return token.type === "fontList" ? value.join(", ") : value;
    if (token.type === "fontList") {
      const [section, key] = String(token.themePath || "").split(".");
      const themeValue = THEME[section]?.[key];
      if (editorValueIsValid(token, themeValue)) return themeValue.join(", ");
    }
    return document.documentElement?.style.getPropertyValue(token.cssVariable).trim() || "";
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

  const dispatchStyleOverrideWrite = (write) => {
    if (!write || write.themeId !== String(THEME.id || "custom")) return;
    if (pendingStyleEditorRequest) {
      if (!queuedStyleEditorWrite || queuedStyleEditorWrite.version < write.version) queuedStyleEditorWrite = write;
      return;
    }
    if (typeof window[styleEditorBinding] !== "function") {
      queuedStyleEditorWrite = null;
      restoreLastPersistedStyleOverrides();
      setStyleEditorStatus(formatEditorMessage("persistenceFailed"), "error");
      return;
    }
    const requestId = `${Date.now().toString(36)}_${write.version.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    pendingStyleEditorRequest = { requestId, ...write };
    setStyleEditorStatus(formatEditorMessage("applyingChanges"), "saving");
    if (styleEditorRequestTimer) clearTimeout(styleEditorRequestTimer);
    styleEditorRequestTimer = setTimeout(() => {
      if (pendingStyleEditorRequest?.requestId !== requestId) return;
      pendingStyleEditorRequest = null;
      styleEditorRequestTimer = null;
      const next = queuedStyleEditorWrite;
      queuedStyleEditorWrite = null;
      if (next) {
        dispatchStyleOverrideWrite(next);
        return;
      }
      restoreLastPersistedStyleOverrides();
      setStyleEditorStatus(formatEditorMessage("persistenceFailed"), "error");
    }, 6000);
    const runtime = window[STATE_KEY];
    if (runtime) runtime.styleEditorRequestTimer = styleEditorRequestTimer;
    try {
      window[styleEditorBinding](JSON.stringify({
        requestId,
        nonce: styleEditorNonce,
        themeId: write.themeId,
        writeVersion: write.version,
        values: write.values,
        runtimePreferences: write.runtimePreferences,
        baseValues: write.baseValues,
        baseRuntimePreferences: write.baseRuntimePreferences,
      }));
    } catch {
      clearTimeout(styleEditorRequestTimer);
      styleEditorRequestTimer = null;
      pendingStyleEditorRequest = null;
      restoreLastPersistedStyleOverrides();
      setStyleEditorStatus(formatEditorMessage("persistenceFailed"), "error");
    }
  };

  const scheduleStyleOverridePersistence = ({ immediate = false } = {}) => {
    if (styleEditorDebounceTimer) clearTimeout(styleEditorDebounceTimer);
    const write = {
      themeId: String(THEME.id || "custom"),
      version: editorWriteVersion,
      values: { ...editorDraft },
      runtimePreferences: { ...editorRuntimePreferences },
      baseValues: { ...lastPersistedStyleOverrides },
      baseRuntimePreferences: { ...lastPersistedRuntimePreferences },
    };
    const send = () => {
      styleEditorDebounceTimer = null;
      const runtime = window[STATE_KEY];
      if (runtime) runtime.styleEditorDebounceTimer = null;
      dispatchStyleOverrideWrite(write);
    };
    if (immediate) send();
    else {
      styleEditorDebounceTimer = setTimeout(send, 160);
      const runtime = window[STATE_KEY];
      if (runtime) runtime.styleEditorDebounceTimer = styleEditorDebounceTimer;
    }
    setStyleEditorStatus(formatEditorMessage("applyingChanges"), "saving");
  };

  const commitEditorDraft = () => {
    editorWriteVersion += 1;
    persistEditorDraft();
    if (!(videoEnabled && videoPlaybackPreference === "disabled")) {
      applyTheme(document.documentElement, resolvedShellMode());
      applyStyleOverrides(document.documentElement, editorDraft);
    }
    scheduleStyleOverridePersistence();
  };

  const flushStyleOverridePersistence = () => {
    if (!styleEditorDebounceTimer) return;
    clearTimeout(styleEditorDebounceTimer);
    styleEditorDebounceTimer = null;
    dispatchStyleOverrideWrite({
      themeId: String(THEME.id || "custom"),
      version: editorWriteVersion,
      values: { ...editorDraft },
      runtimePreferences: { ...editorRuntimePreferences },
      baseValues: { ...lastPersistedStyleOverrides },
      baseRuntimePreferences: { ...lastPersistedRuntimePreferences },
    });
  };

  window[STYLE_EDITOR_SYNC_KEY] = (themeId, values, persistedRuntimePreferences = {}, overrideState = {}) => {
    if (themeId !== String(THEME.id || "custom") || !values || typeof values !== "object" || Array.isArray(values)) return false;
    const normalized = {};
    for (const token of STYLE_TOKENS) {
      if (!Object.hasOwn(values, token.id)) continue;
      if (!editorValueIsValid(token, values[token.id])) return false;
      normalized[token.id] = values[token.id];
    }
    const normalizedRuntimePreferences = normalizeRuntimePreferences(persistedRuntimePreferences);
    if (Object.keys(normalizedRuntimePreferences).length !== Object.keys(persistedRuntimePreferences).length) return false;
    lastPersistedStyleOverrides = { ...normalized };
    lastPersistedRuntimePreferences = { ...normalizedRuntimePreferences };
    styleOverrides = { ...normalized };
    runtimePreferences = { ...normalizedRuntimePreferences };
    if (Array.isArray(overrideState?.diagnostics) && overrideState.diagnostics.length) {
      setThemeRuntimeIssue({ stage: "runtime-overrides", message: formatEditorMessage("localOverridesAdjusted") });
    } else if (runtimeIssue?.stage === "runtime-overrides") {
      setThemeRuntimeIssue(null);
    }
    if (!pendingStyleEditorRequest && !queuedStyleEditorWrite && !styleEditorDebounceTimer) {
      editorDraft = { ...normalized };
      editorRuntimePreferences = { ...normalizedRuntimePreferences };
      applyEditorRuntimePreferences();
      persistEditorDraft();
      ensure();
      refreshStyleEditorInputs();
      updateStyleEditorEffectControl();
      setStyleEditorStatus(formatEditorMessage("changesApplied"), "success");
    }
    return true;
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
    if (videoPlaybackPreference === "paused") return formatEditorMessage("videoPaused");
    const runtimeState = getVideoElement()?.dataset.skinPlaybackState || "loading";
    if (runtimeState === "playing") return formatEditorMessage("videoPlaying");
    if (runtimeState === "loading") return formatEditorMessage("videoLoading");
    if (runtimeState === "reduced-motion") return formatEditorMessage("videoReducedMotion");
    if (runtimeState === "play-blocked" || runtimeState === "error") {
      return formatEditorMessage("videoRetry");
    }
    return formatEditorMessage("videoPaused");
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
      editorRuntimePreferences["background.presentation"] = interactiveEffectEnabled ? "enabled" : "static";
      interactiveController?.setEnabled?.(interactiveEffectEnabled);
      const state = window[STATE_KEY];
      if (state) state.interactiveEffectEnabled = interactiveEffectEnabled;
      commitEditorDraft();
      ensure();
      updateStyleEditorEffectControl();
      return;
    }
    const video = getVideoElement();
    if (!video) return;
    const runtimeState = video.dataset.skinPlaybackState || "paused";
    if (["reduced-motion", "play-blocked", "error", "paused"].includes(runtimeState) &&
        videoPlaybackPreference === "playing") {
      videoPlaybackPreference = "playing";
      videoMotionOverride = motionMediaQuery.matches;
    } else if (videoPlaybackPreference === "playing") {
      videoPlaybackPreference = "paused";
    } else if (videoPlaybackPreference === "paused") {
      videoPlaybackPreference = "disabled";
      videoMotionOverride = false;
    } else {
      videoPlaybackPreference = "playing";
      videoMotionOverride = motionMediaQuery.matches;
    }
    editorRuntimePreferences["background.presentation"] = videoPlaybackPreference;
    commitEditorDraft();
    persistVideoPlaybackPreference();
    ensure();
    updateStyleEditorEffectControl();
  };

  const closeStyleEditor = () => {
    const editor = document.getElementById(STYLE_EDITOR_ID);
    if (!editor || editor.hidden) return;
    flushStyleOverridePersistence();
    editor.hidden = true;
    ownedVideoToggle?.setAttribute("aria-expanded", "false");
    ownedVideoToggle?.focus({ preventScroll: true });
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
    editor.setAttribute("dir", EDITOR_LOCALE_STATE.direction);
    if (EDITOR_LOCALE_STATE.diagnostic) {
      editor.setAttribute("data-theme-locale-diagnostic", EDITOR_LOCALE_STATE.diagnostic);
    }
    editor.setAttribute("data-skin-owned", "style-editor");
    editor.setAttribute("data-theme-owned", "theme-editor");

    const header = document.createElement("header");
    const heading = document.createElement("div");
    const headingTitle = document.createElement("h2");
    headingTitle.textContent = formatEditorMessage("pageTitle") || "cc-theme";
    const headingTheme = document.createElement("small");
    headingTheme.textContent = formatEditorMessage("currentTheme", {
      theme: String(THEME.name || THEME.id || formatEditorMessage("pageTitle") || "cc-theme"),
    });
    heading.append(headingTitle, headingTheme);
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", formatEditorMessage("closeEditor"));
    close.textContent = "×";
    close.addEventListener("click", closeStyleEditor);
    header.append(heading, close);
    editor.appendChild(header);

    if (EDITOR_LOCALE_STATE.diagnostic) {
      const localeNotice = document.createElement("div");
      localeNotice.className = "cc-theme-locale-notice";
      localeNotice.setAttribute("role", "status");
      localeNotice.dataset.diagnostic = EDITOR_LOCALE_STATE.diagnostic;
      localeNotice.textContent = formatEditorMessage("localeFallbackNotice");
      editor.appendChild(localeNotice);
    }

    const runtimeNotice = document.createElement("div");
    runtimeNotice.id = "cc-theme-runtime-notice";
    runtimeNotice.setAttribute("role", "alert");
    runtimeNotice.hidden = true;
    runtimeNotice.dataset.state = "idle";
    runtimeNotice.append(document.createElement("strong"), document.createElement("span"));
    editor.appendChild(runtimeNotice);
    renderThemeRuntimeIssue();

    const effectRow = document.createElement("div");
    effectRow.className = "cc-theme-style-editor-effect";
    const effectLabel = document.createElement("span");
    effectLabel.textContent = formatEditorMessage("backgroundEffect");
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
      groupSection.dataset.themeStyleGroup = group.id;
      const groupHeading = document.createElement("summary");
      const groupLabel = document.createElement("span");
      groupLabel.textContent = localizedGroupLabel(group);
      const groupCount = document.createElement("span");
      groupCount.className = "cc-theme-style-editor-group-count";
      groupCount.textContent = formatEditorNumber(tokens.length);
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
        const input = document.createElement("input");
        input.type = "text";
        input.spellcheck = false;
        input.autocomplete = "off";
        input.dataset.themeStyleToken = token.id;
        input.setAttribute("aria-label", formatEditorMessage("editValue", { label: name.textContent }));
        input.addEventListener("input", () => {
          refreshStyleEditorColorPicker(input, token);
          commitInputValue(true);
        });
        const commitInputValue = (quietInvalid = false) => {
          const raw = input.value.trim();
          const next = token.type === "fontList" ? raw.split(",").map((item) => item.trim()).filter(Boolean) : raw;
          if (!editorValueIsValid(token, next)) {
            input.setAttribute("aria-invalid", "true");
            if (!quietInvalid) setStyleEditorStatus(formatEditorMessage("invalidValue"), "error");
            return;
          }
          input.removeAttribute("aria-invalid");
          if (JSON.stringify(editorDraft[token.id]) === JSON.stringify(next)) return;
          editorDraft[token.id] = next;
          commitEditorDraft();
        };
        input.addEventListener("change", () => commitInputValue(false));
        const reset = document.createElement("button");
        reset.type = "button";
        reset.textContent = formatEditorMessage("restore");
        reset.setAttribute("aria-label", formatEditorMessage("restoreItem", { label: name.textContent }));
        reset.addEventListener("click", (event) => {
          event.preventDefault();
          if (!Object.hasOwn(editorDraft, token.id)) return;
          delete editorDraft[token.id];
          commitEditorDraft();
          requestAnimationFrame(() => {
            input.value = styleEditorInputValue(token);
            refreshStyleEditorColorPicker(input, token);
          });
        });
        const controls = document.createElement("span");
        if (token.type === "color") {
          const colorPicker = document.createElement("input");
          colorPicker.type = "color";
          colorPicker.className = "cc-theme-style-editor-color-picker";
          colorPicker.dataset.themeColorPickerFor = token.id;
          colorPicker.setAttribute("aria-label", formatEditorMessage("chooseColor", { label: name.textContent }));
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
    resetAll.addEventListener("click", () => {
      editorDraft = {};
      editorRuntimePreferences = {};
      applyEditorRuntimePreferences();
      commitEditorDraft();
      requestAnimationFrame(refreshStyleEditorInputs);
    });
    actions.append(resetAll);
    footer.append(status, actions);
    editor.appendChild(footer);
    mount.appendChild(editor);

    window[STYLE_EDITOR_RESULT_KEY] = (requestId, result) => {
      if (requestId !== pendingStyleEditorRequest?.requestId) return;
      const completed = pendingStyleEditorRequest;
      pendingStyleEditorRequest = null;
      if (styleEditorRequestTimer) clearTimeout(styleEditorRequestTimer);
      styleEditorRequestTimer = null;
      const runtime = window[STATE_KEY];
      if (runtime) runtime.styleEditorRequestTimer = null;
      if (result?.ok && !result.superseded) {
        const persistedValues = result.values && typeof result.values === "object" ? result.values : completed.values;
        const persistedRuntimePreferences = result.runtimePreferences && typeof result.runtimePreferences === "object"
          ? result.runtimePreferences : completed.runtimePreferences;
        lastPersistedStyleOverrides = { ...persistedValues };
        lastPersistedRuntimePreferences = { ...persistedRuntimePreferences };
        styleOverrides = { ...persistedValues };
        runtimePreferences = { ...persistedRuntimePreferences };
        if (runtime) {
          runtime.styleOverrides = { ...styleOverrides };
          runtime.lastPersistedStyleOverrides = { ...lastPersistedStyleOverrides };
          runtime.runtimePreferences = { ...runtimePreferences };
          runtime.lastPersistedRuntimePreferences = { ...lastPersistedRuntimePreferences };
        }
      }
      const next = queuedStyleEditorWrite;
      queuedStyleEditorWrite = null;
      if (next) {
        dispatchStyleOverrideWrite(next);
        return;
      }
      if (!result?.ok || result.superseded) {
        restoreLastPersistedStyleOverrides();
        if (!result?.ok) {
          setStyleEditorStatus(formatEditorMessage("persistenceFailed"), "error");
          return;
        }
      }
      editorDraft = { ...lastPersistedStyleOverrides };
      editorRuntimePreferences = { ...lastPersistedRuntimePreferences };
      applyEditorRuntimePreferences();
      if (!(videoEnabled && videoPlaybackPreference === "disabled")) {
        applyTheme(document.documentElement, resolvedShellMode());
        applyStyleOverrides(document.documentElement, editorDraft);
      }
      persistEditorDraft();
      refreshStyleEditorInputs();
      updateStyleEditorEffectControl();
      setStyleEditorStatus(formatEditorMessage("changesApplied"), "success");
    };
    styleEditorOutsideHandler = (event) => {
      if (editor.dataset.themeEditorPlacement !== "popover" || editor.hidden ||
          editor.contains(event.target) || ownedVideoToggle?.contains(event.target)) return;
      closeStyleEditor();
    };
    styleEditorKeyHandler = (event) => {
      if (editor.dataset.themeEditorPlacement === "popover" && event.key === "Escape" && !editor.hidden) {
        event.preventDefault();
        closeStyleEditor();
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
      closeStyleEditor();
      return;
    }
    ensure();
    refreshStyleEditorInputs();
    updateStyleEditorEffectControl();
    const status = localizedStyleEditorStatus();
    setStyleEditorStatus(status.message, status.state);
    editor.hidden = false;
    ownedVideoToggle?.setAttribute("aria-expanded", "true");
    editor.querySelector("button, input, summary")?.focus({ preventScroll: true });
  };

  const disposeThemeEditorUi = () => {
    // Leaving Settings must not cancel a valid in-flight auto-save. The
    // renderer result handlers deliberately live for the whole injected
    // runtime; only full Theme cleanup is allowed to tear them down.
    flushStyleOverridePersistence();
    const editor = document.getElementById(STYLE_EDITOR_ID);
    editor?.remove();
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

  const resolveThemeSettingsContent = (candidate = null, navigation = null) => {
    if (candidate && document.body?.contains(candidate)) return candidate;
    const anchor = navigation || document.querySelector(SETTINGS_APPEARANCE_SELECTOR);
    const sidebar = anchor?.closest(".app-shell-left-panel") ||
      anchor?.closest('[data-skin-role="settings-sidebar"]');
    const shell = sidebar?.parentElement;
    return shell ? [...shell.children].find((child) => child !== sidebar &&
      (child.matches?.(".main-surface, [data-app-shell-main-content-layout]") ||
        child.querySelector?.(".main-surface, [data-app-shell-main-content-layout]"))) || null : null;
  };

  const NATIVE_NAV_STATE_ATTRIBUTES = [
    "aria-current", "aria-selected", "aria-disabled", "data-state", "tabindex",
  ];
  const captureNativeNavPresentation = (node) => {
    if (!(node instanceof Element)) return null;
    return [node, ...node.querySelectorAll("*")].map((part) => ({
      className: part.getAttribute("class"),
      style: part.getAttribute("style"),
      states: Object.fromEntries(NATIVE_NAV_STATE_ATTRIBUTES.map((name) => [name, part.getAttribute(name)])),
    }));
  };
  const applyNativeNavPresentation = (node, presentation) => {
    if (!(node instanceof Element) || !Array.isArray(presentation)) return;
    const parts = [node, ...node.querySelectorAll("*")];
    const syncAttribute = (part, name, value) => {
      if (value === null || value === undefined) {
        if (part.hasAttribute(name)) part.removeAttribute(name);
      } else if (part.getAttribute(name) !== value) {
        part.setAttribute(name, value);
      }
    };
    for (let index = 0; index < Math.min(parts.length, presentation.length); index += 1) {
      const part = parts[index];
      const snapshot = presentation[index];
      syncAttribute(part, "class", snapshot.className);
      syncAttribute(part, "style", snapshot.style);
      for (const name of NATIVE_NAV_STATE_ATTRIBUTES) {
        syncAttribute(part, name, snapshot.states?.[name]);
      }
    }
  };
  const adjacentInactiveNativeNav = (anchor) => {
    const siblings = anchor?.parentElement ? [...anchor.parentElement.children] : [];
    return siblings.find((item) => item !== anchor && item.id !== THEME_SETTINGS_NAV_ID &&
      item.hasAttribute?.("data-settings-panel-slug") && item.getAttribute("aria-current") !== "page") || null;
  };
  const applyThemeNavIdentity = (navItem) => {
    navItem.id = THEME_SETTINGS_NAV_ID;
    // The host's current Settings CSS keys part of the native entry treatment
    // from this stable structural attribute. Keep the shape, but use our own
    // unique slug and owned event handling rather than copying a native route.
    navItem.setAttribute("data-settings-panel-slug", THEME_SETTINGS_SLUG);
    navItem.setAttribute("data-skin-role", "settings-nav-item");
    navItem.setAttribute("data-skin-marker", "true");
    navItem.removeAttribute("aria-controls");
    navItem.removeAttribute("aria-labelledby");
    navItem.removeAttribute("aria-describedby");
    navItem.removeAttribute("href");
    navItem.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    navItem.setAttribute("data-theme-owned", "settings-nav-item");
    const label = navItem.querySelector(".text-fade-truncate") || navItem.querySelector("span:last-child");
    if (label) {
      label.replaceChildren(document.createTextNode(formatEditorMessage("settingsNavLabel") || "cc-theme"));
      label.setAttribute("data-theme-owned-label", "true");
    }
    navItem.setAttribute("aria-label", formatEditorMessage("settingsNavLabel") || "cc-theme");
    navItem.setAttribute("lang", EDITOR_LOCALE);
    navItem.setAttribute("dir", EDITOR_LOCALE_STATE.direction);
  };

  const deactivateThemeSettingsPage = ({ restoreNativeSelection = false, removeEditor = true } = {}) => {
    themeSettingsPageActive = false;
    document.documentElement?.removeAttribute("data-theme-settings-page");
    const navItem = document.getElementById(THEME_SETTINGS_NAV_ID);
    applyNativeNavPresentation(navItem, inactiveNativeSettingsNavPresentation);
    if (navItem) applyThemeNavIdentity(navItem);
    restoreNativeSettingsContent();
    document.getElementById(THEME_SETTINGS_PAGE_ID)?.remove();
    if (removeEditor) disposeThemeEditorUi();
    if (restoreNativeSelection && previousNativeSettingsNav?.isConnected) {
      applyNativeNavPresentation(previousNativeSettingsNav, previousNativeSettingsNavPresentation);
    }
    previousNativeSettingsNav = null;
    previousNativeSettingsNavPresentation = null;
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

  const activateThemeSettingsPage = (settingsContent, navItem) => {
    if (!settingsContent || !navItem || !document.body?.contains(settingsContent)) return false;
    if (!themeSettingsPageActive) {
      previousNativeSettingsNav = settingsContent.closest('[data-skin-role="settings-shell"]')
        ?.querySelector('[data-settings-panel-slug][aria-current="page"]') ||
        document.querySelector('[data-settings-panel-slug][aria-current="page"]');
      previousNativeSettingsNavPresentation = captureNativeNavPresentation(previousNativeSettingsNav);
      const appearanceNavItem = document.querySelector(SETTINGS_APPEARANCE_SELECTOR);
      const inactiveReference = adjacentInactiveNativeNav(appearanceNavItem);
      inactiveNativeSettingsNavPresentation = captureNativeNavPresentation(inactiveReference || appearanceNavItem);
      applyNativeNavPresentation(previousNativeSettingsNav, inactiveNativeSettingsNavPresentation);
    }
    themeSettingsPageActive = true;
    document.documentElement?.setAttribute("data-theme-settings-page", "active");
    applyNativeNavPresentation(navItem, previousNativeSettingsNavPresentation);
    applyThemeNavIdentity(navItem);

    let page = document.getElementById(THEME_SETTINGS_PAGE_ID);
    const nativeContent = [...settingsContent.children].find((child) =>
      child.id !== THEME_SETTINGS_PAGE_ID && !child.classList.contains("draggable") &&
      (child.className.includes("overflow-y-auto") || child.className.includes("flex-1"))) || null;
    const newlyMounted = !page || page.parentElement !== settingsContent;
    if (newlyMounted) {
      page?.remove();
      page = document.createElement("div");
      page.id = THEME_SETTINGS_PAGE_ID;
      page.className = nativeContent?.className || "scrollbar-stable flex-1 overflow-y-auto p-panel";
      page.setAttribute("data-theme-owned", "settings-page");
      const frame = document.createElement("div");
      frame.className = nativeContent?.firstElementChild?.className ||
        "mx-auto flex w-full max-w-3xl flex-col electron:min-w-[calc(320px*var(--codex-window-zoom))]";
      frame.setAttribute("data-theme-owned", "settings-page-content");
      page.appendChild(frame);
      settingsContent.appendChild(page);
      const editor = ensureStyleEditor(frame, "settings");
      editor.dataset.themeEditorPlacementBoundary = "dedicated-settings-page";
      editor.hidden = false;
      refreshStyleEditorInputs();
      const status = localizedStyleEditorStatus();
      setStyleEditorStatus(status.message, status.state);
    }
    for (const child of [...settingsContent.children]) {
      if (child === page || child.classList.contains("draggable")) continue;
      child.hidden = true;
      child.setAttribute("data-theme-page-native-hidden", "true");
    }
    page.hidden = false;
    updateStyleEditorEffectControl();
    const runtime = window[STATE_KEY];
    if (runtime) runtime.themeSettingsPageActive = true;
    return true;
  };

  const ensureThemeSettingsPage = (settingsContent = null) => {
    const appearanceNavItem = document.querySelector(SETTINGS_APPEARANCE_SELECTOR);
    if (!appearanceNavItem?.parentElement) {
      restoreThemeSettingsPage();
      return false;
    }
    let navItem = document.getElementById(THEME_SETTINGS_NAV_ID);
    if (!navItem) {
      const inactiveReference = adjacentInactiveNativeNav(appearanceNavItem) || appearanceNavItem;
      navItem = inactiveReference.cloneNode(true);
      inactiveNativeSettingsNavPresentation = captureNativeNavPresentation(inactiveReference);
      applyThemeNavIdentity(navItem);
      navItem.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const contentNode = resolveThemeSettingsContent(
          document.querySelector('[data-skin-role="settings-content"]') || settingsContent,
          navItem,
        );
        activateThemeSettingsPage(contentNode, navItem);
      });
      if (!navItem.matches("button, a, input, select, textarea, [role=button]")) {
        navItem.setAttribute("role", "button");
        navItem.tabIndex = 0;
      }
      // The clone intentionally has no native route or native event handler.
      // Own keyboard activation even when the preserved native structure is
      // an anchor/button, otherwise Enter can be swallowed after href removal.
      navItem.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        navItem.click();
      });
    }
    if (navItem.parentElement !== appearanceNavItem.parentElement ||
        navItem.previousElementSibling !== appearanceNavItem) {
      appearanceNavItem.parentElement.insertBefore(navItem, appearanceNavItem.nextSibling);
    }
    const nav = appearanceNavItem.closest("nav");
    if (settingsNavNode !== nav) {
      if (settingsNavNode && settingsNavClickHandler) {
        settingsNavNode.removeEventListener("click", settingsNavClickHandler, true);
      }
      settingsNavNode = nav;
      settingsNavClickHandler = (event) => {
        if (!themeSettingsPageActive) return;
        const nativeTarget = event.target.closest?.("[data-settings-panel-slug]");
        if (!nativeTarget || nativeTarget.id === THEME_SETTINGS_NAV_ID) return;
        const selectedPresentation = previousNativeSettingsNavPresentation;
        deactivateThemeSettingsPage({ restoreNativeSelection: false, removeEditor: true });
        // The host can legitimately skip a selection repaint when the user
        // returns to the route that React already considers current. Restore
        // the native selected snapshot on the item that was actually clicked;
        // a different native route remains free to reconcile it afterwards.
        applyNativeNavPresentation(nativeTarget, selectedPresentation);
      };
      settingsNavNode?.addEventListener("click", settingsNavClickHandler, true);
    }
    if (themeSettingsPageActive) {
      const contentNode = resolveThemeSettingsContent(
        settingsContent || document.querySelector('[data-skin-role="settings-content"]'),
        appearanceNavItem,
      );
      activateThemeSettingsPage(contentNode, navItem);
    }
    const runtime = window[STATE_KEY];
    if (runtime) {
      runtime.settingsNavNode = settingsNavNode;
      runtime.settingsNavClickHandler = settingsNavClickHandler;
    }
    return true;
  };

  const updateVideoToggle = () => {
    const videoToggle = ownedVideoToggle || document.getElementById(VIDEO_TOGGLE_ID);
    if (!videoToggle) return;
    videoToggle.setAttribute("aria-haspopup", "dialog");
    videoToggle.setAttribute("aria-controls", STYLE_EDITOR_ID);
    if (!videoToggle.hasAttribute("aria-expanded")) videoToggle.setAttribute("aria-expanded", "false");
    if (interactiveEnabled) {
      const inspected = interactiveController?.inspect?.() || {};
      const reduced = motionMediaQuery.matches;
      const unavailable = Boolean(inspected.fallback);
      const active = interactiveEffectEnabled && inspected.active === true && !reduced;
      const statusLabel = currentBackgroundEffectLabel();
      videoToggle.dataset.skinPlaybackState = unavailable ? "fallback" : active ? "playing" : "paused";
      videoToggle.setAttribute("aria-pressed", active ? "true" : "false");
      const openLabel = formatEditorMessage("openThemeSettingsStatus", { status: statusLabel });
      videoToggle.setAttribute("aria-label", openLabel);
      videoToggle.setAttribute("title", openLabel);
      videoToggle.disabled = false;
      const iconPath = videoToggle.querySelector("path");
      if (iconPath) iconPath.setAttribute("d", BACKGROUND_RENDER_MODE === "ripple"
        ? active
          ? "M3 8c3-3 6-3 9 0s6 3 9 0v3c-3 3-6 3-9 0s-6-3-9 0V8Zm0 7c3-3 6-3 9 0s6 3 9 0v3c-3 3-6 3-9 0s-6-3-9 0v-3Z"
          : "M4 6h16v12H4V6Zm2 2v8h12V8H6Z"
        : active
          ? "M12 2 8.5 8.5 12 7v4H8l1.5-3.5L3 11l6.5 3.5L8 13h4v4l-3.5-1.5L12 22l3.5-6.5L12 17v-4h4l-1.5 3.5L21 13l-6.5-3.5L16 11h-4V7l3.5 1.5L12 2Z"
          : "M4 6h16v12H4V6Zm2 2v8h12V8H6Z");
      updateStyleEditorEffectControl();
      return;
    }
    const video = getVideoElement();
    if (!videoEnabled) {
      videoToggle.dataset.skinPlaybackState = "static";
      videoToggle.setAttribute("aria-pressed", "false");
      const openLabel = formatEditorMessage("openThemeSettingsStatus", {
        status: formatEditorMessage("staticImage"),
      });
      videoToggle.setAttribute("aria-label", openLabel);
      videoToggle.setAttribute("title", openLabel);
      videoToggle.disabled = false;
      const iconPath = videoToggle.querySelector("path");
      if (iconPath) iconPath.setAttribute("d", "M4 5h16v14H4V5Zm2 2v10h12V7H6Zm1 8 3-3 2 2 2.5-3 2.5 4H7Z");
      updateStyleEditorEffectControl();
      return;
    }
    const state = videoPlaybackPreference === "disabled"
      ? "disabled"
      : video?.dataset.skinPlaybackState || "paused";
    const active = state === "playing" || state === "loading";
    const reduced = state === "reduced-motion";
    const disabled = state === "disabled";
    const playBlocked = state === "play-blocked";
    const failed = state === "error";
    videoToggle.dataset.skinPlaybackState = state;
    const pressedState = disabled ? "mixed" : active ? "true" : "false";
    if (videoToggle.getAttribute("aria-pressed") !== pressedState) {
      videoToggle.setAttribute("aria-pressed", pressedState);
    }
    videoToggle.disabled = false;
    const statusLabel = currentBackgroundEffectLabel();
    const openLabel = formatEditorMessage("openThemeSettingsStatus", { status: statusLabel });
    videoToggle.setAttribute("aria-label", openLabel);
    videoToggle.setAttribute("title", openLabel);
    const iconPath = videoToggle.querySelector("path");
    if (iconPath) iconPath.setAttribute("d",
      active ? "M7 5h4v14H7zM13 5h4v14h-4z" :
        disabled || reduced || playBlocked ? "M8 5v14l11-7Z" :
          "M4 6h4.2l2 2H6v8h8v-4.2l2 2V18H4V6Zm13 3 4-2v10l-4-2v-1.2l2 2V10.2l-2 1V9ZM3.5 2.1 21.9 20.5l-1.4 1.4L2.1 3.5l1.4-1.4Z");
    updateStyleEditorEffectControl();
  };

  const rerenderLocalizedThemeUi = () => {
    const editor = document.getElementById(STYLE_EDITOR_ID);
    const navItem = document.getElementById(THEME_SETTINGS_NAV_ID);
    if (navItem) applyThemeNavIdentity(navItem);
    if (editor) {
      // Locale refresh is deliberately in-place. Replacing the editor would
      // replace its nonce-bound result callbacks while a debounced/in-flight
      // auto-save still owns the old request, allowing a valid draft to hang.
      // Updating only owned text/semantics preserves inputs, focus, drafts,
      // debounce timers and latest-write-wins transaction state.
      editor.setAttribute("aria-label", formatEditorMessage("editorAria"));
      editor.setAttribute("lang", EDITOR_LOCALE);
      editor.setAttribute("dir", EDITOR_LOCALE_STATE.direction);
      if (EDITOR_LOCALE_STATE.diagnostic) {
        editor.setAttribute("data-theme-locale-diagnostic", EDITOR_LOCALE_STATE.diagnostic);
        let localeNotice = editor.querySelector(":scope > .cc-theme-locale-notice");
        if (!localeNotice) {
          localeNotice = document.createElement("div");
          localeNotice.className = "cc-theme-locale-notice";
          localeNotice.setAttribute("role", "status");
          editor.querySelector(":scope > header")?.after(localeNotice);
        }
        localeNotice.dataset.diagnostic = EDITOR_LOCALE_STATE.diagnostic;
        localeNotice.textContent = formatEditorMessage("localeFallbackNotice");
      } else {
        editor.removeAttribute("data-theme-locale-diagnostic");
        editor.querySelector(":scope > .cc-theme-locale-notice")?.remove();
      }
      const header = editor.querySelector(":scope > header");
      const headingTitle = header?.querySelector("h2");
      const headingTheme = header?.querySelector("small");
      const close = header?.querySelector(":scope > button");
      if (headingTitle) headingTitle.textContent = formatEditorMessage("pageTitle") || "cc-theme";
      if (headingTheme) headingTheme.textContent = formatEditorMessage("currentTheme", {
        theme: String(THEME.name || THEME.id || formatEditorMessage("pageTitle") || "cc-theme"),
      });
      close?.setAttribute("aria-label", formatEditorMessage("closeEditor"));
      const effect = editor.querySelector(":scope > .cc-theme-style-editor-effect");
      const effectLabel = effect?.querySelector(":scope > span:first-child");
      if (effectLabel) effectLabel.textContent = formatEditorMessage("backgroundEffect");
      for (const groupSection of editor.querySelectorAll("[data-theme-style-group]")) {
        const group = STYLE_CATALOG.groups?.find((candidate) => candidate?.id === groupSection.dataset.themeStyleGroup);
        const groupLabel = groupSection.querySelector(":scope > summary > span:first-child");
        const tokens = STYLE_TOKENS.filter((token) => token.group === group?.id);
        const groupCount = groupSection.querySelector(":scope > summary > .cc-theme-style-editor-group-count");
        if (group && groupLabel) groupLabel.textContent = localizedGroupLabel(group);
        if (groupCount) groupCount.textContent = formatEditorNumber(tokens.length);
        for (const input of groupSection.querySelectorAll("[data-theme-style-token]")) {
          const token = STYLE_TOKENS.find((candidate) => candidate.id === input.dataset.themeStyleToken);
          const row = input.closest(".cc-theme-style-editor-row");
          const name = row?.querySelector(":scope > span:first-child");
          if (!token || !name) continue;
          name.textContent = localizedTokenLabel(token);
          input.setAttribute("aria-label", formatEditorMessage("editValue", { label: name.textContent }));
          const picker = row.querySelector(".cc-theme-style-editor-color-picker");
          picker?.setAttribute("aria-label", formatEditorMessage("chooseColor", { label: name.textContent }));
          const reset = row.querySelector(":scope > span:last-child > button");
          if (reset) {
            reset.textContent = formatEditorMessage("restore");
            reset.setAttribute("aria-label", formatEditorMessage("restoreItem", { label: name.textContent }));
          }
        }
      }
      const resetAll = editor.querySelector(":scope > footer button");
      if (resetAll) resetAll.textContent = formatEditorMessage("resetAll");
      const status = localizedStyleEditorStatus();
      setStyleEditorStatus(status.message, status.state);
      renderThemeRuntimeIssue();
      updateStyleEditorEffectControl();
    }
    updateVideoToggle();
    const runtime = window[STATE_KEY];
    if (runtime) runtime.editorLocaleDiagnostic = EDITOR_LOCALE_STATE.diagnostic;
  };

  const findVideoActionAnchor = () => {
    const headerSurface = document.querySelector('[data-testid="app-shell-header-context-menu-surface"]');
    const headerShell = headerSurface?.closest("header") || null;
    if (!headerSurface || !headerShell) return null;
    const headerSurfaceRect = headerSurface.getBoundingClientRect();
    const headerRect = headerShell.getBoundingClientRect();
    const isVisibleHeaderButton = (button, bounds = headerRect) => {
      const rect = button?.getBoundingClientRect();
      return !!rect && rect.width > 0 && rect.height > 0 &&
        rect.right > bounds.left && rect.left < bounds.right &&
        rect.bottom > bounds.top && rect.top < bounds.bottom;
    };
    const findActionWrapper = (button, boundary = headerShell) => {
      for (let node = button?.parentElement; node && node !== boundary; node = node.parentElement) {
        const classList = node.classList;
        if (classList?.contains("no-drag") && classList.contains("pointer-events-auto") &&
            classList.contains("flex") && classList.contains("shrink-0") && classList.contains("items-center")) {
          return node;
        }
      }
      return null;
    };

    // The native summary action's parent row moves from the app-wide toolbar
    // into the middle content header when the right Side Panel opens. Follow
    // that row from an absolutely positioned adjacent slot: the Skin control
    // moves with Summary but never covers it or changes the row's measured
    // width, gap, or conversation geometry.
    const summaryButton = [...headerSurface.querySelectorAll('button[aria-label]:not([data-skin-owned])')]
      .findLast((button) => SUMMARY_TOGGLE_LABELS.has(button.getAttribute("aria-label")) &&
        isVisibleHeaderButton(button, headerSurfaceRect)) || null;
    const summaryWrapper = findActionWrapper(summaryButton, headerSurface);
    if (summaryButton && summaryWrapper?.parentElement) {
      return {
        pinnedSummaryButton: summaryButton,
        summaryActionWrapper: summaryWrapper,
        row: summaryWrapper.parentElement,
        anchorKind: "summary-actions",
      };
    }

    const sidePanelButton = [...headerShell.querySelectorAll('button[aria-label]:not([data-skin-owned])')]
      .findLast((button) => {
        const rect = button.getBoundingClientRect();
        return SIDE_PANEL_TOGGLE_LABELS.has(button.getAttribute("aria-label")) &&
          isVisibleHeaderButton(button) && rect.right >= headerRect.right - 48;
      }) || null;
    const sidePanelOpen = sidePanelButton?.getAttribute("aria-pressed") === "true";

    // New Chat has no summary action. While the Side Panel is open, keep the
    // control in the middle header by placing it immediately before that
    // header's rightmost native action. Absolute positioning preserves the
    // native action row's measured width and avoids the Chat / Work switch.
    if (sidePanelOpen) {
      const contentReferenceButton = [...headerSurface.querySelectorAll('button:not([data-skin-owned])')]
        .findLast((button) => isVisibleHeaderButton(button, headerSurfaceRect)) || null;
      const contentReferenceWrapper = findActionWrapper(contentReferenceButton, headerSurface);
      if (contentReferenceButton && contentReferenceWrapper?.parentElement) {
        return {
          pinnedSummaryButton: contentReferenceButton,
          summaryActionWrapper: contentReferenceWrapper,
          row: contentReferenceWrapper.parentElement,
          anchorKind: "header-content-actions",
        };
      }
    }

    const retainedActionButton = ownedVideoToggleAnchor?.querySelector('button:not([data-skin-owned])') || null;
    const retainedActionRect = retainedActionButton?.getBoundingClientRect();
    if (ownedVideoToggleWrapper?.dataset.skinAnchorKind === "header-trailing-actions" &&
        ownedVideoToggleAnchor?.isConnected && headerShell?.contains(ownedVideoToggleAnchor) &&
        retainedActionButton && retainedActionRect.width > 0 && retainedActionRect.height > 0) {
      return {
        pinnedSummaryButton: retainedActionButton,
        summaryActionWrapper: ownedVideoToggleAnchor,
        row: ownedVideoToggleAnchor.parentElement,
        anchorKind: "header-trailing-actions",
      };
    }
    const bottomPanelButton = headerShell
      ? [...headerShell.querySelectorAll('button[aria-label]:not([data-skin-owned])')].findLast((button) => {
          const rect = button.getBoundingClientRect();
          return BOTTOM_PANEL_TOGGLE_LABELS.has(button.getAttribute("aria-label")) &&
            rect.width > 0 && rect.height > 0 &&
            (!headerSurfaceRect || rect.x >= headerSurfaceRect.right - 1) &&
            (!headerRect || rect.right <= headerRect.right + 1);
        }) || null
      : null;
    let bottomPanelWrapper = null;
    for (let node = bottomPanelButton?.parentElement; node && node !== headerShell; node = node.parentElement) {
      const classList = node.classList;
      if (classList?.contains("no-drag") && classList.contains("pointer-events-auto") &&
          classList.contains("flex") && classList.contains("shrink-0") && classList.contains("items-center")) {
        bottomPanelWrapper = node;
        break;
      }
    }
    if (bottomPanelButton && bottomPanelWrapper?.parentElement) {
      return {
        pinnedSummaryButton: bottomPanelButton,
        summaryActionWrapper: bottomPanelWrapper,
        row: bottomPanelWrapper.parentElement,
        anchorKind: "header-trailing-actions",
      };
    }
    const headerSurfaceIndex = headerShell && headerSurface
      ? [...headerShell.children].indexOf(headerSurface)
      : -1;
    // The fixed right-side action region follows the context surface. Choose
    // the last visible button container, not the center Chat / Work overlay,
    // and anchor beside its first native action without expanding the row.
    const trailingActionContainer = headerShell && headerSurfaceIndex >= 0
      ? [...headerShell.children].findLast((node, index) =>
          index > headerSurfaceIndex &&
          !node.classList?.contains("invisible") &&
          node.getBoundingClientRect().width > 0 &&
          node.getBoundingClientRect().height > 0 &&
          node.querySelector('button:not([data-skin-owned])')) || null
      : null;
    const trailingActionRow = trailingActionContainer
      ? [...trailingActionContainer.children].find((node) =>
          node.querySelector('button:not([data-skin-owned])')) || null
      : null;
    if (trailingActionRow) {
      const nativeActionWrappers = [...trailingActionRow.children].filter((wrapper) =>
        !wrapper.hasAttribute("data-skin-owned") &&
        !wrapper.querySelector("[data-skin-owned]") &&
        wrapper.querySelector("button"));
      const referenceWrapper = nativeActionWrappers[0] || null;
      const referenceButton = referenceWrapper?.querySelector("button") || null;
      if (referenceWrapper && referenceButton) {
        return {
          pinnedSummaryButton: referenceButton,
          summaryActionWrapper: referenceWrapper,
          row: trailingActionRow,
          anchorKind: "header-trailing-actions",
        };
      }
    }
    let pinnedSummaryButton = [...document.querySelectorAll("button[aria-label]")]
      .find((button) => SUMMARY_TOGGLE_LABELS.has(button.getAttribute("aria-label"))) || null;
    let fallbackRow = null;
    if (!pinnedSummaryButton && headerSurface) {
      fallbackRow = [...headerSurface.children].find((node) =>
        node.classList?.contains("ms-auto") && node.classList.contains("gap-1.5")) || null;
      const pressedButtons = fallbackRow
        ? [...fallbackRow.querySelectorAll('button[aria-pressed]:not([data-skin-owned])')]
        : [];
      if (pressedButtons.length === 1) pinnedSummaryButton = pressedButtons[0];
    }
    if (!pinnedSummaryButton && fallbackRow) {
      const nativeActionWrappers = [...fallbackRow.children].filter((wrapper) =>
        !wrapper.hasAttribute("data-skin-owned") &&
        !wrapper.querySelector("[data-skin-owned]") &&
        wrapper.querySelector("button"));
      const referenceWrapper = nativeActionWrappers[0] || null;
      const referenceButton = referenceWrapper?.querySelector("button") || null;
      if (referenceWrapper && referenceButton) {
        return {
          pinnedSummaryButton: referenceButton,
          summaryActionWrapper: referenceWrapper,
          row: fallbackRow,
          anchorKind: "header-actions-fallback",
        };
      }
    }
    if (!pinnedSummaryButton) return null;
    let summaryActionWrapper = null;
    for (let node = pinnedSummaryButton.parentElement; node && node !== headerSurface; node = node.parentElement) {
      const classList = node.classList;
      if (classList?.contains("no-drag") && classList.contains("pointer-events-auto") &&
          classList.contains("flex") && classList.contains("shrink-0") && classList.contains("items-center")) {
        summaryActionWrapper = node;
        break;
      }
    }
    const row = summaryActionWrapper?.parentElement || null;
    if (!summaryActionWrapper || !row || (fallbackRow && row !== fallbackRow)) return null;
    return { pinnedSummaryButton, summaryActionWrapper, row, anchorKind: "pinned-summary" };
  };

  const syncVideoPlayback = () => {
    const video = getVideoElement();
    if (!video) return;
    const playbackEpoch = ++videoPlaybackEpoch;
    applyVideoPresentationState();
    if (videoPlaybackPreference === "disabled") {
      cancelVideoFrameConfirmation(video);
      video.pause();
      video.dataset.skinPlaybackState = "disabled";
      updateVideoToggle();
      return;
    }
    if (!videoArtUrl) {
      cancelVideoFrameConfirmation(video);
      video.pause();
      video.dataset.skinPlaybackState = "loading";
      updateVideoToggle();
      return;
    }
    const reduced = motionMediaQuery.matches && !videoMotionOverride;
    const shouldPlay = !document.hidden && videoPlaybackPreference === "playing" && !reduced;
    if (!shouldPlay) {
      cancelVideoFrameConfirmation(video);
      video.pause();
      video.dataset.skinPlaybackState = reduced ? "reduced-motion" : "paused";
      updateVideoToggle();
      return;
    }
    if (!video.paused && !video.ended) {
      if (video.dataset.skinPlaybackState === "playing") {
        updateVideoToggle();
        return;
      }
      video.dataset.skinPlaybackState = "loading";
      updateVideoToggle();
      confirmVideoFrame(video, playbackEpoch);
      return;
    }
    video.dataset.skinPlaybackState = "loading";
    updateVideoToggle();
    Promise.resolve(video.play()).then(() => {
      if (playbackEpoch !== videoPlaybackEpoch) return;
      video.dataset.skinPlaybackState = "loading";
      updateVideoToggle();
      confirmVideoFrame(video, playbackEpoch);
    }).catch(() => {
      if (playbackEpoch !== videoPlaybackEpoch) return;
      video.dataset.skinPlaybackState = "play-blocked";
      updateVideoToggle();
    });
  };

  const ensureVideoToggle = () => {
    if (SETTINGS_THEME_PAGE_PRIMARY) {
      ownedVideoToggleWrapper?.remove();
      document.getElementById(VIDEO_TOGGLE_WRAPPER_ID)?.remove();
      ownedVideoToggleAnchor?.removeAttribute(VIDEO_TOGGLE_ANCHOR_ATTR);
      ownedVideoToggleWrapper = null;
      ownedVideoToggleAnchor = null;
      ownedVideoToggle = null;
      return;
    }
    const anchor = findVideoActionAnchor();
    if (!anchor) {
      ownedVideoToggleWrapper?.remove();
      ownedVideoToggleAnchor?.removeAttribute(VIDEO_TOGGLE_ANCHOR_ATTR);
      ownedVideoToggleAnchor = null;
      return;
    }
    const { pinnedSummaryButton, summaryActionWrapper, row, anchorKind } = anchor;
    const anchorContainer = ["summary-actions", "header-content-actions", "header-trailing-actions"].includes(anchorKind)
      ? summaryActionWrapper
      : row;
    if (ownedVideoToggleAnchor && ownedVideoToggleAnchor !== anchorContainer) {
      ownedVideoToggleAnchor.removeAttribute(VIDEO_TOGGLE_ANCHOR_ATTR);
      ownedVideoToggleAnchor = null;
    }
    if (!ownedVideoToggleWrapper) {
      ownedVideoToggleWrapper = document.createElement("div");
      ownedVideoToggleWrapper.id = VIDEO_TOGGLE_WRAPPER_ID;
      ownedVideoToggleWrapper.setAttribute("data-skin-owned", "video-playback-toggle");
      const state = window[STATE_KEY];
      if (state) state.videoToggleWrapper = ownedVideoToggleWrapper;
    }
    ownedVideoToggleWrapper.dataset.skinAnchorKind = anchorKind;
    if (ownedVideoToggleWrapper.className !== summaryActionWrapper.className) {
      ownedVideoToggleWrapper.className = summaryActionWrapper.className;
    }
    if (!ownedVideoToggle) {
      ownedVideoToggle = document.createElement("button");
      ownedVideoToggle.id = VIDEO_TOGGLE_ID;
      ownedVideoToggle.type = "button";
      ownedVideoToggle.setAttribute("data-skin-owned", "background-media-control");
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      icon.setAttribute("fill", "currentColor");
      const iconPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      icon.appendChild(iconPath);
      ownedVideoToggle.appendChild(icon);
      ownedVideoToggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleStyleEditor();
      });
      ownedVideoToggleWrapper.appendChild(ownedVideoToggle);
    }
    if (ownedVideoToggle.className !== pinnedSummaryButton.className) {
      ownedVideoToggle.className = pinnedSummaryButton.className;
    }
    if (ownedVideoToggle.parentElement !== ownedVideoToggleWrapper) {
      ownedVideoToggleWrapper.appendChild(ownedVideoToggle);
    }
    if (["summary-actions", "header-content-actions", "header-trailing-actions"].includes(anchorKind)) {
      summaryActionWrapper.setAttribute(VIDEO_TOGGLE_ANCHOR_ATTR, anchorKind);
      ownedVideoToggleAnchor = summaryActionWrapper;
      if (ownedVideoToggleWrapper.parentElement !== summaryActionWrapper ||
          ownedVideoToggleWrapper !== summaryActionWrapper.firstElementChild) {
        summaryActionWrapper.insertBefore(ownedVideoToggleWrapper, summaryActionWrapper.firstElementChild);
      }
    } else if (ownedVideoToggleWrapper.parentElement !== row ||
        ownedVideoToggleWrapper.nextElementSibling !== summaryActionWrapper) {
      row.insertBefore(ownedVideoToggleWrapper, summaryActionWrapper);
    }
    updateVideoToggle();
  };

  const ensureVideoLayer = () => {
    const root = document.documentElement;
    let layer = document.getElementById(VIDEO_LAYER_ID);
    if (!videoEnabled || !document.body) {
      disposeOwnedVideoLayer(layer);
      root?.removeAttribute(VIDEO_ATTR);
      root?.removeAttribute(VIDEO_PLAYBACK_ATTR);
      root?.removeAttribute(VIDEO_POSTER_ATTR);
      ensureVideoToggle();
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
      if (videoArtUrl) video.src = videoArtUrl;
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
            updateVideoToggle();
            return;
          }
          video.dataset.skinPlaybackState = "loading";
          updateVideoToggle();
          confirmVideoFrame(video, videoPlaybackEpoch);
        });
      }
      video.addEventListener("pause", () => {
        cancelVideoFrameConfirmation(video);
        video.dataset.skinPlaybackState = videoPlaybackPreference === "playing"
          ? video.readyState < 2 ? "loading" : "paused"
          : videoPlaybackPreference;
        updateVideoToggle();
        if (videoPlaybackPreference === "playing" && !document.hidden &&
            !(motionMediaQuery.matches && !videoMotionOverride)) {
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
          updateVideoToggle();
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
        updateVideoToggle();
      });
      video.addEventListener("error", () => {
        video.dataset.skinPlaybackState = "error";
        updateVideoToggle();
      });
      layer.appendChild(video);
      document.body.appendChild(layer);
    }
    ensureVideoToggle();
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
    updateVideoToggle();
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
    ensureVideoToggle();
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
      return;
    }

    root.classList.add("cc-theme");
    root.setAttribute(SHELL_ATTR, shell);
    if (BRIDGE_ENABLED) {
      root.setAttribute("data-skin-theme-bridge", "1");
      root.setAttribute("data-skin-theme-id", String(THEME.id || "custom"));
      root.setAttribute(HOME_LAYOUT_ATTR, HOME_LAYOUT);
      if (PRESENTATION_PROFILE) root.setAttribute("data-skin-presentation", PRESENTATION_PROFILE);
      else root.removeAttribute("data-skin-presentation");
    } else {
      root.removeAttribute("data-skin-theme-bridge");
      root.removeAttribute("data-skin-theme-id");
      root.removeAttribute("data-skin-presentation");
      root.removeAttribute(HOME_LAYOUT_ATTR);
      root.removeAttribute(SURFACE_CONTEXT_ATTR);
      root.removeAttribute("data-skin-route");
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

    // Codex 26.715 introduced stable main-content data attributes while
    // retaining the older `main-surface` class. Prefer the structural
    // contract and keep the class as a compatibility fallback.
    const mainContentViewport = document.querySelector('[data-app-shell-main-content-layout]');
    const shellMain = mainContentViewport?.closest("main") ||
      document.querySelector("main.main-surface") || document.querySelector("main");
    const homeIndicator = document.querySelector('[data-testid="home-icon"]');
    const homeAmbientSuggestions = document.querySelector('[data-home-ambient-suggestions]');
    const home = homeIndicator?.closest('[role="main"]') ||
      homeAmbientSuggestions?.closest('[role="main"]') ||
      [...document.querySelectorAll('[role="main"]')].find((candidate) =>
        candidate.querySelector('[data-feature="game-source"]') && (
          candidate.querySelector('[data-home-ambient-suggestions]') ||
          candidate.querySelector('.group\\/home-suggestions')
        )) || null;
    // Surface context is independent from the optional New Task layout. Video
    // and interactive backgrounds retain Codex's native geometry, but their
    // Home surfaces still need a lighter paint treatment than long-form task
    // pages. Settings and library routes refine this value below.
    let surfaceContext = home ? "home" : "task";
    // A moving-background theme is a paint treatment, not a replacement New
    // Chat layout. Keep Codex's native Chat / Work geometry so cycling between
    // playing, paused and disabled never resizes the Composer or suggestions.
    const customHomeLayout = Boolean(home) && !videoEnabled && !interactiveEnabled;
    for (const candidate of document.querySelectorAll('[role="main"].skin-home')) {
      if (candidate !== home || !customHomeLayout) candidate.classList.remove("skin-home");
    }
    if (customHomeLayout) home.classList.add("skin-home");

    if (BRIDGE_ENABLED) {
      const mark = (node, role) => {
        if (!node) return;
        if (node.getAttribute("data-skin-role") !== role) node.setAttribute("data-skin-role", role);
        if (node.getAttribute("data-skin-marker") !== VERSION) node.setAttribute("data-skin-marker", VERSION);
      };
      const settingsRouteItem = document.querySelector(".app-shell-left-panel [data-settings-panel-slug]") ||
        document.querySelector("[data-settings-panel-slug]");
      const previousHomeNodes = new Set(document.querySelectorAll('[data-skin-role^="home-"]'));
      // Semantic Home roles are useful even when a moving background keeps the
      // native layout. Geometry rules remain guarded by `.skin-home`; the
      // unguarded role rules below may therefore change paint only.
      const styledHome = home;
      const homeRect = styledHome?.getBoundingClientRect();
      const homeHeading = styledHome?.querySelector('[data-feature="game-source"]') || null;
      const homeIcon = styledHome?.querySelector('[data-testid="home-icon"]') || null;
      const isHomeCard = (card) => {
        const labelId = card.getAttribute("aria-labelledby");
        return Boolean(labelId && card.querySelector(`#${CSS.escape(labelId)}`) && card.querySelector("svg"));
      };
      const homeSuggestions = styledHome?.querySelector('[data-home-ambient-suggestions]') ||
        styledHome?.querySelector('.group\\/home-suggestions') ||
        [...(styledHome?.querySelectorAll("section") || [])].find((section) =>
          [...section.querySelectorAll('button[type="button"][aria-labelledby]')].filter(isHomeCard).length >= 2) || null;
      const homeCards = [...(homeSuggestions?.querySelectorAll('button[type="button"][aria-labelledby]') || [])]
        .filter(isHomeCard);
      let homeSuggestionsGrid = homeCards[0]?.parentElement || null;
      while (homeSuggestionsGrid && homeSuggestionsGrid !== homeSuggestions &&
          !homeCards.every((card) => homeSuggestionsGrid.contains(card))) {
        homeSuggestionsGrid = homeSuggestionsGrid.parentElement;
      }
      const homeHeroSignal = homeHeading || homeIcon;
      let homeHero = null;
      if (HOME_LAYOUT === "banner") {
        for (let node = homeHeroSignal; node && node !== styledHome; node = node.parentElement) {
          const rect = node.getBoundingClientRect();
          if (homeRect && rect.width >= homeRect.width * .72 && rect.height >= 120 && rect.height <= homeRect.height * .62) {
            homeHero = node;
            break;
          }
        }
        homeHero ||= styledHome?.firstElementChild?.firstElementChild?.firstElementChild || null;
      }
      const desiredHomeNodes = new Map();
      const markHome = (node, role) => {
        if (!node) return;
        desiredHomeNodes.set(node, role);
        mark(node, role);
      };
      markHome(homeHero, "home-hero");
      markHome(homeHeading, "home-heading");
      markHome(homeIcon, "home-icon");
      markHome(homeSuggestions, "home-suggestions");
      markHome(homeSuggestionsGrid === homeSuggestions ? null : homeSuggestionsGrid, "home-suggestions-grid");
      homeCards.forEach((card, index) => {
        markHome(card, "home-suggestion-card");
        const cardIndex = String(index + 1);
        if (card.getAttribute("data-skin-card-index") !== cardIndex) card.setAttribute("data-skin-card-index", cardIndex);
        const icon = card.querySelector("svg")?.parentElement || null;
        if (icon && icon !== card) markHome(icon, "home-suggestion-icon");
        const labelId = card.getAttribute("aria-labelledby");
        if (labelId) markHome(card.querySelector(`#${CSS.escape(labelId)}`), "home-suggestion-label");
      });
      for (const node of previousHomeNodes) {
        if (desiredHomeNodes.has(node)) continue;
        node.removeAttribute("data-skin-role");
        node.removeAttribute("data-skin-marker");
        node.removeAttribute("data-skin-card-index");
      }
      const sidebar = document.querySelector("aside.app-shell-left-panel") ||
        document.querySelector(".app-shell-left-panel");
      const header = document.querySelector("header.app-header-tint");
      const composerRoot = document.querySelector('[data-codex-composer-root]') ||
        document.querySelector('[data-codex-composer]');
      const composer = composerRoot?.querySelector(".composer-surface-chrome") ||
        document.querySelector(".composer-surface-chrome") || composerRoot;
      const composerScope = composerRoot || composer;
      const mainTopFade = document.querySelector('[data-app-shell-main-content-top-fade]');
      mark(sidebar, settingsRouteItem ? "settings-sidebar" : "sidebar");
      mark(header, "header");
      mark(mainContentViewport, "main-content");
      mark(mainTopFade, "main-top-fade");
      mark(composerRoot, "composer-root");
      mark(composer, "composer");
      for (const surface of document.querySelectorAll('[data-oai-writing-block-surface]')) {
        mark(surface, "writing-block-surface");
      }
      const sendButton = composerScope ? [...composerScope.querySelectorAll("button")].find((button) =>
        button.classList.contains("bg-token-button-background") ||
        button.classList.contains("electron:bg-token-primary") ||
        button.classList.contains("bg-token-foreground")) : null;
      mark(sendButton, "send-button");
      const modelTrigger = composerScope ? [...composerScope.querySelectorAll("button")].find((button) =>
        button !== sendButton && (
          button.hasAttribute("aria-controls") ||
          ["dialog", "menu", "listbox"].includes(button.getAttribute("aria-haspopup"))
        )) : null;
      mark(modelTrigger, "model-picker");
      for (const overlay of document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"], [role="status"], [role="alert"]')) {
        mark(overlay, "overlay-surface");
        overlay.setAttribute("data-skin-overlay-kind", overlay.getAttribute("role"));
      }
      const controlledId = modelTrigger?.getAttribute("aria-controls");
      if (controlledId) mark(document.getElementById(controlledId), "model-picker-popup");
      for (const slider of document.querySelectorAll('[role="slider"]')) mark(slider, "model-power-slider");

      // ChatGPT's response-start indicator is a compact live status whose
      // only visible child is a pulsing circular dot. The generic overlay
      // treatment must not turn that accessibility wrapper into a painted
      // white card. Identify it from stable ARIA structure and bounded native
      // geometry without depending on localized text or hashed CSS classes.
      const previousResponseWaitingNodes = new Set(
        document.querySelectorAll('[data-skin-role="response-waiting-indicator"]'),
      );
      const currentResponseWaitingNodes = new Set();
      for (const status of document.querySelectorAll('[role="status"][aria-busy="true"]')) {
        const screenReaderLabel = status.querySelector(':scope > .sr-only');
        const pulse = status.querySelector(':scope > [aria-hidden="true"]');
        if (status.tagName !== "SPAN" || !screenReaderLabel || !pulse) continue;
        const statusRect = status.getBoundingClientRect();
        const pulseRect = pulse.getBoundingClientRect();
        const pulseStyle = getComputedStyle(pulse);
        const pulseRadius = parseFloat(pulseStyle.borderTopLeftRadius);
        if (statusRect.width <= 0 || statusRect.width > 96 ||
            statusRect.height <= 0 || statusRect.height > 48 ||
            pulseRect.width < 4 || pulseRect.width > 24 ||
            pulseRect.height < 4 || pulseRect.height > 24 ||
            Math.abs(pulseRect.width - pulseRect.height) > 1 ||
            !Number.isFinite(pulseRadius) || pulseRadius < Math.min(pulseRect.width, pulseRect.height) * .35) continue;
        currentResponseWaitingNodes.add(status);
        mark(status, "response-waiting-indicator");
      }
      for (const node of previousResponseWaitingNodes) {
        if (currentResponseWaitingNodes.has(node) ||
            node.getAttribute("data-skin-role") !== "response-waiting-indicator") continue;
        node.removeAttribute("data-skin-role");
        node.removeAttribute("data-skin-marker");
      }

      // The conversation history rail renders its message preview as a
      // tooltip Portal with a second rounded card inside it. Styling both as
      // generic overlay surfaces compounds their alpha and leaves a square
      // white layer behind the native rounded card. Identify this preview
      // from the semantic jump controls and geometry, then flatten only its
      // outer Portal while retaining one readable translucent card.
      const previousHistoryPreviewNodes = new Set(document.querySelectorAll('[data-skin-role^="history-preview-"]'));
      const currentHistoryPreviewNodes = new Set();
      const markHistoryPreview = (node, role) => {
        if (!node) return;
        currentHistoryPreviewNodes.add(node);
        mark(node, role);
      };
      const isHistoryJumpButton = (button) => {
        const label = button.getAttribute("aria-label") || "";
        return label.startsWith("Jump to user message ") || label.startsWith("跳转到用户消息");
      };
      const historyRail = [...document.querySelectorAll("nav")].find((nav) =>
        [...nav.querySelectorAll("button[aria-label]")].filter(isHistoryJumpButton).length >= 2) || null;
      const historyRailRect = historyRail?.getBoundingClientRect();
      if (historyRailRect?.width > 0 && historyRailRect.height > 0) {
        for (const tooltip of document.querySelectorAll('[role="tooltip"][data-side="right"]')) {
          const tooltipRect = tooltip.getBoundingClientRect();
          if (tooltipRect.width < 240 || tooltipRect.width > 720 || tooltipRect.height < 60 ||
              tooltipRect.left < historyRailRect.left || tooltipRect.left > historyRailRect.right + 24) continue;
          const previewCard = [...tooltip.querySelectorAll("div")].find((node) => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return rect.width >= tooltipRect.width * .9 && rect.height >= tooltipRect.height * .9 &&
              parseFloat(style.borderTopLeftRadius) >= 10 &&
              style.backgroundColor !== "rgba(0, 0, 0, 0)";
          }) || null;
          if (!previewCard) continue;
          markHistoryPreview(tooltip, "history-preview-surface");
          markHistoryPreview(previewCard, "history-preview-card");
        }
      }
      for (const node of previousHistoryPreviewNodes) {
        if (currentHistoryPreviewNodes.has(node)) continue;
        node.removeAttribute("data-skin-role");
        node.removeAttribute("data-skin-marker");
      }

      // Sites, Scheduled and Plugins share a library-style route shell, but
      // Codex does not expose a stable route attribute for them. Derive a
      // small, auditable marker from the active primary navigation item, then
      // mark only their large route canvas and search surface. This keeps the
      // video treatment semantic and avoids global input or layout overrides.
      const previousLibraryNodes = new Set(document.querySelectorAll('[data-skin-role^="library-"]'));
      const currentLibraryNodes = new Set();
      const markLibrary = (node, role) => {
        if (!node) return;
        currentLibraryNodes.add(node);
        mark(node, role);
      };
      const activePrimaryItem = sidebar?.querySelector('[aria-current="page"]') || null;
      const activePrimaryLabel = (activePrimaryItem?.innerText || activePrimaryItem?.textContent || "").trim();
      const libraryRoute = /^(Sites|站点)$/i.test(activePrimaryLabel) ? "sites"
        : /^(Scheduled|Scheduled tasks|计划任务|定时任务)$/i.test(activePrimaryLabel) ? "scheduled"
          : /^(Plugins|插件)$/i.test(activePrimaryLabel) ? "plugins" : null;
      if (libraryRoute && mainContentViewport) {
        surfaceContext = "library";
        root.setAttribute("data-skin-library-route", libraryRoute);
        const routeHeading = [...mainContentViewport.querySelectorAll("h1, [role='heading']")]
          .find((node) => node.getBoundingClientRect().width > 0) || null;
        const routeSearchInput = [...mainContentViewport.querySelectorAll("input")]
          .find((node) => node.getBoundingClientRect().width > 0 &&
            /search|搜索/i.test(node.getAttribute("placeholder") || "")) || null;
        let commonRouteNode = routeHeading;
        while (commonRouteNode && routeSearchInput && !commonRouteNode.contains(routeSearchInput)) {
          commonRouteNode = commonRouteNode.parentElement;
        }
        const viewportRect = mainContentViewport.getBoundingClientRect();
        let libraryShell = null;
        for (let node = commonRouteNode; node && node !== mainContentViewport; node = node.parentElement) {
          const rect = node.getBoundingClientRect();
          if (rect.width >= viewportRect.width * .88 && rect.height >= viewportRect.height * .72) {
            libraryShell = node;
            break;
          }
        }
        libraryShell ||= mainContentViewport.querySelector(".bg-token-main-surface-primary") || commonRouteNode;
        markLibrary(libraryShell, "library-shell");
        markLibrary(routeSearchInput, "library-search-input");
        let librarySearchSurface = null;
        let librarySearchHeader = null;
        for (let node = routeSearchInput?.parentElement; node && node !== libraryShell; node = node.parentElement) {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          const hasPaint = style.backgroundColor !== "rgba(0, 0, 0, 0)" ||
            parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderTopLeftRadius) >= 6;
          if (!librarySearchSurface && hasPaint && parseFloat(style.borderTopWidth) > 0 &&
              rect.width >= 280 && rect.height >= 28 && rect.height <= 72) {
            librarySearchSurface = node;
          }
          if (rect.width >= viewportRect.width * .85 && rect.height >= 32 && rect.height <= 96) {
            librarySearchHeader = node;
          }
        }
        markLibrary(librarySearchHeader, "library-search-header");
        markLibrary(librarySearchSurface, "library-search");
      } else {
        root.removeAttribute("data-skin-library-route");
      }
      for (const node of previousLibraryNodes) {
        if (currentLibraryNodes.has(node)) continue;
        node.removeAttribute("data-skin-role");
        node.removeAttribute("data-skin-marker");
      }

      // Bottom Panel is mounted lazily. Its terminal content owns a nested
      // `.app-theme.electron-light` host that does not inherit the root shell
      // background, so mark the structural layers instead of relying on a
      // generated terminal UUID or translated labels.
      const previousBottomPanelNodes = new Set(document.querySelectorAll('[data-skin-role^="bottom-panel-"]'));
      const currentBottomPanelNodes = new Set();
      const markBottomPanel = (node, role) => {
        if (!node) return;
        currentBottomPanelNodes.add(node);
        mark(node, role);
      };
      const isVisiblePanelNode = (node) => {
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const stableBottomPanelShell = document.querySelector('[data-app-shell-focus-area="bottom-panel"]');
      const bottomPanelSash = stableBottomPanelShell?.querySelector(':scope > [role="separator"]') ||
        [...document.querySelectorAll('[role="separator"]')].find((node) => {
        if (!isVisiblePanelNode(node)) return false;
        const rect = node.getBoundingClientRect();
        return getComputedStyle(node).cursor.includes("row-resize") && rect.width >= innerWidth * .3;
      }) || null;
      const bottomPanelHost = stableBottomPanelShell || bottomPanelSash?.parentElement || null;
      const terminalShell = bottomPanelHost?.querySelector('[data-codex-terminal][data-codex-xterm]') ||
        bottomPanelHost?.querySelector("[id^='terminal-panel-']") || null;
      const terminalTabPanel = stableBottomPanelShell?.querySelector('[data-app-shell-tab-panel-controller="bottom"]') ||
        terminalShell?.closest('[role="tabpanel"]') || null;
      const stableBottomPanelSurface = stableBottomPanelShell?.querySelector('[data-app-shell-tabs="true"]') || null;
      const bottomPanelSurface = stableBottomPanelSurface || terminalTabPanel?.parentElement ||
        bottomPanelSash?.parentElement?.querySelector('[role="tabpanel"]')?.parentElement || null;
      let bottomPanelShell = stableBottomPanelShell || bottomPanelSash?.parentElement || null;
      if (!bottomPanelShell && bottomPanelSurface) {
        const surfaceRect = bottomPanelSurface.getBoundingClientRect();
        for (let node = bottomPanelSurface; node && node !== document.body; node = node.parentElement) {
          const rect = node.getBoundingClientRect();
          if (rect.width >= surfaceRect.width * .94 && rect.height <= innerHeight * .75) bottomPanelShell = node;
        }
      }
      if (bottomPanelShell || terminalShell) {
        const bottomPanelBody = terminalTabPanel || bottomPanelSurface?.querySelector('[role="tabpanel"]') || null;
        const bottomPanelHeader = stableBottomPanelShell?.querySelector('[data-app-shell-tab-strip-controller="bottom"]') ||
          (bottomPanelSurface ? [...bottomPanelSurface.children].find((node) => {
          if (node === bottomPanelBody || !isVisiblePanelNode(node)) return false;
          const rect = node.getBoundingClientRect();
          return rect.height >= 24 && rect.height <= 64;
        }) || null : null);
        const bottomPanelTablist = bottomPanelHeader?.querySelector('[role="tablist"]') || null;
        const bottomPanelTabs = bottomPanelTablist?.querySelectorAll('[role="tab"]') || [];
        const terminal = terminalShell?.querySelector(".xterm") || null;
        const terminalViewport = terminal?.querySelector(".xterm-viewport") || null;
        const terminalScreen = terminal?.querySelector(".xterm-screen") || null;
        const terminalPadding = terminal?.parentElement?.parentElement || null;

        markBottomPanel(bottomPanelShell, "bottom-panel-shell");
        markBottomPanel(bottomPanelSurface, "bottom-panel-surface");
        markBottomPanel(bottomPanelHeader, "bottom-panel-header");
        markBottomPanel(bottomPanelTablist, "bottom-panel-tablist");
        for (const tab of bottomPanelTabs) markBottomPanel(tab, "bottom-panel-tab");
        markBottomPanel(bottomPanelBody, "bottom-panel-body");
        markBottomPanel(bottomPanelSash, "bottom-panel-sash");
        markBottomPanel(terminalShell, "bottom-panel-terminal-shell");
        markBottomPanel(terminalPadding, "bottom-panel-terminal-padding");
        markBottomPanel(terminal, "bottom-panel-terminal");
        markBottomPanel(terminalViewport, "bottom-panel-terminal-viewport");
        markBottomPanel(terminalScreen, "bottom-panel-terminal-screen");
      }
      for (const node of previousBottomPanelNodes) {
        if (currentBottomPanelNodes.has(node)) continue;
        node.removeAttribute("data-skin-role");
        node.removeAttribute("data-skin-marker");
      }

      // Settings is lazy-rendered and localized, so identify it from stable
      // accessibility/route structure instead of translated labels or hashed classes.
      const previousSettingsNodes = new Set(document.querySelectorAll('[data-skin-role^="settings-"]'));
      const currentSettingsNodes = new Set();
      const markSettings = (node, role) => {
        if (!node || node.closest?.(`#${STYLE_EDITOR_ID}`)) return;
        currentSettingsNodes.add(node);
        mark(node, role);
      };
      const settingsItem = settingsRouteItem;
      const settingsNav = settingsItem?.closest("nav[aria-label]") || settingsItem?.closest("nav") || null;
      if (settingsNav) {
        surfaceContext = "settings";
        const isVisible = (node) => {
          if (!node) return false;
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        };
        const directBranch = (ancestor, descendant) => {
          let branch = descendant;
          while (branch?.parentElement && branch.parentElement !== ancestor) branch = branch.parentElement;
          return branch?.parentElement === ancestor ? branch : null;
        };
        const navRect = settingsNav.getBoundingClientRect();
        let settingsSidebar = settingsItem?.closest(".app-shell-left-panel") || null;
        let settingsRoot = settingsSidebar?.parentElement || null;
        const settingsMainSelector = '[data-app-shell-main-content-layout], .main-surface';
        let contentBranch = settingsRoot ? [...settingsRoot.children].find((child) =>
          child !== settingsSidebar && child.querySelector?.(settingsMainSelector)) || null : null;
        let settingsContent = contentBranch?.querySelector(settingsMainSelector) || null;
        for (let candidate = settingsNav.parentElement; candidate && candidate !== document.body; candidate = candidate.parentElement) {
          if (settingsContent) break;
          const rect = candidate.getBoundingClientRect();
          if (rect.width < navRect.width + 280 || rect.height < Math.min(navRect.height * .72, innerHeight * .72)) continue;
          const navBranch = directBranch(candidate, settingsNav);
          const siblings = [...candidate.children].filter((child) => child !== navBranch && isVisible(child));
          contentBranch = siblings
            .filter((child) => child.getBoundingClientRect().width >= 280)
            .sort((left, right) => {
              const a = left.getBoundingClientRect();
              const b = right.getBoundingClientRect();
              return (b.width * b.height) - (a.width * a.height);
            })[0];
          if (!navBranch || !contentBranch) continue;
          settingsRoot = candidate;
          settingsSidebar = navBranch;
          settingsContent = contentBranch.querySelector?.(settingsMainSelector) || contentBranch;
          break;
        }
        settingsRoot ||= settingsNav.parentElement;
        settingsSidebar ||= settingsNav;
        settingsContent ||= [...document.querySelectorAll('[role="tabpanel"], main')]
          .filter((node) => !settingsNav.contains(node) && isVisible(node))
          .sort((left, right) => right.getBoundingClientRect().width - left.getBoundingClientRect().width)[0] || null;

        if (root.getAttribute("data-skin-route") !== "settings") root.setAttribute("data-skin-route", "settings");
        markSettings(settingsRoot, "settings-shell");
        markSettings(settingsSidebar, "settings-sidebar");
        markSettings(settingsNav, "settings-nav");
        markSettings(settingsContent, "settings-content");
        for (const item of settingsNav.querySelectorAll("[data-settings-panel-slug]")) markSettings(item, "settings-nav-item");

        const searchInput = settingsNav.querySelector('input[role="searchbox"]');
        if (searchInput) {
          markSettings(searchInput, "settings-search-input");
          let searchSurface = searchInput.parentElement;
          while (searchSurface && searchSurface !== settingsNav) {
            const rect = searchSurface.getBoundingClientRect();
            const style = getComputedStyle(searchSurface);
            if (rect.width >= navRect.width * .68 && rect.height <= 64 && parseFloat(style.borderTopWidth) > 0) break;
            searchSurface = searchSurface.parentElement;
          }
          if (searchSurface && searchSurface !== settingsNav) markSettings(searchSurface, "settings-search");
        }

        if (settingsContent) {
          for (const section of settingsContent.querySelectorAll("section")) {
            if (!section.closest(`#${STYLE_EDITOR_ID}`)) markSettings(section, "settings-section");
          }
          const controlSelector = [
            '[role="switch"]', '[role="checkbox"]', '[role="radio"]', '[role="radiogroup"]',
            'input:not([role="searchbox"])', 'select', 'textarea', '[role="combobox"]',
            'button[aria-haspopup]',
          ].join(",");
          const settingsControls = [...settingsContent.querySelectorAll(controlSelector)]
            .filter((control) => isVisible(control) && !control.closest(`#${STYLE_EDITOR_ID}`));
          const contentRect = settingsContent.getBoundingClientRect();
          const groupCandidates = [...settingsContent.querySelectorAll("div, section, fieldset")].filter((node) => {
            if (!isVisible(node) || node.closest(`#${STYLE_EDITOR_ID}`) ||
                !settingsControls.some((control) => node.contains(control))) return false;
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            const hasBorder = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
              .some((width) => parseFloat(width) > 0);
            return hasBorder && parseFloat(style.borderTopLeftRadius) >= 8 && rect.width >= Math.min(280, contentRect.width * .48) &&
              rect.height >= 44 && rect.height < contentRect.height * .92;
          });
          for (const group of groupCandidates) {
            markSettings(group, "settings-group");
            for (const child of group.children) {
              if (child.querySelector?.(controlSelector) || child.matches?.(controlSelector)) markSettings(child, "settings-row");
            }
          }

          for (const control of settingsControls) {
            let role = "settings-control";
            const nativeRole = control.getAttribute("role");
            if (nativeRole === "switch") role = "settings-switch";
            else if (nativeRole === "radiogroup") role = "settings-radio-group";
            else if (nativeRole === "radio" || control.matches('input[type="radio"]')) role = "settings-radio";
            else if (nativeRole === "checkbox" || control.matches('input[type="checkbox"]')) role = "settings-checkbox";
            else if (control.matches("select, [role='combobox'], button[aria-haspopup='listbox'], button[aria-haspopup='menu']")) role = "settings-select";
            else if (control.matches("input, textarea")) role = "settings-input";
            markSettings(control, role);

            const group = control.closest('[data-skin-role="settings-group"]');
            let row = null;
            for (let candidate = control.parentElement; candidate && candidate !== group && candidate !== settingsContent; candidate = candidate.parentElement) {
              const rect = candidate.getBoundingClientRect();
              if (rect.width >= Math.min(280, contentRect.width * .46) && rect.height >= 32 && rect.height <= 160) row = candidate;
            }
            if (row) markSettings(row, "settings-row");
            const controlSurface = control.parentElement;
            if (controlSurface && controlSurface !== row && controlSurface !== group &&
                (!controlSurface.hasAttribute("data-skin-role") ||
                  controlSurface.getAttribute("data-skin-role") === "settings-control")) {
              markSettings(controlSurface, "settings-control");
            }
          }
          ensureThemeSettingsPage(settingsContent);
        }
      } else if (root.getAttribute("data-skin-route") === "settings") {
        root.removeAttribute("data-skin-route");
        ensureThemeSettingsPage();
      }
      for (const node of previousSettingsNodes) {
        if (currentSettingsNodes.has(node)) continue;
        node.removeAttribute("data-skin-role");
        node.removeAttribute("data-skin-marker");
      }
      setAttribute(root, SURFACE_CONTEXT_ATTR, surfaceContext);
    }

    const directBodyChild = (node) => {
      if (!(node instanceof Element) || !document.body?.contains(node)) return null;
      let candidate = node;
      while (candidate.parentElement && candidate.parentElement !== document.body) candidate = candidate.parentElement;
      return candidate.parentElement === document.body ? candidate : null;
    };
    const appMountCandidate = directBodyChild(shellMain) ||
      directBodyChild(document.querySelector('[data-skin-role="settings-shell"]')) ||
      directBodyChild(document.querySelector('[data-skin-role="settings-sidebar"]'));
    if (appMountCandidate && appMountCandidate !== ownedAppMount) {
      ownedAppMount?.removeAttribute(APP_MOUNT_ATTR);
      ownedAppMount = appMountCandidate;
    }
    if (ownedAppMount) {
      ownedAppMount.setAttribute(APP_MOUNT_ATTR, VERSION);
      const state = window[STATE_KEY];
      if (state) state.appMount = ownedAppMount;
    }

    ensureVideoLayer();
    if (!shellMain || !document.body) {
      return;
    }
    shellMain.classList.toggle("skin-home-shell", customHomeLayout);
    let chrome = document.getElementById(CHROME_ID);
    if (!chrome || chrome.parentElement !== document.body) {
      chrome?.remove();
      chrome = document.createElement("div");
      chrome.id = CHROME_ID;
      chrome.setAttribute("aria-hidden", "true");
      chrome.innerHTML = `
        <div class="skin-brand">
          <span class="skin-portal-mark">◉</span>
          <span><b></b><small></small></span>
        </div>
        <div class="skin-status"><i></i><span></span></div>
        <div class="skin-quote"></div>
        <div class="skin-particles"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="skin-orbit"></div>`;
      document.body.appendChild(chrome);
    }
    chrome.querySelector(".skin-brand b").textContent = THEME.name || "CC Theme";
    chrome.querySelector(".skin-brand small").textContent = THEME.brandSubtitle || "CC THEME";
    chrome.querySelector(".skin-status span").textContent = THEME.statusText || "SKIN ONLINE";
    chrome.querySelector(".skin-quote").textContent = THEME.quote || "MAKE SOMETHING WONDERFUL";
    const shellBox = shellMain.getBoundingClientRect();
    chrome.style.left = `${Math.round(shellBox.left)}px`;
    chrome.style.top = `${Math.round(shellBox.top)}px`;
    chrome.style.width = `${Math.round(shellBox.width)}px`;
    chrome.style.height = `${Math.round(shellBox.height)}px`;
    chrome.hidden = false;
    chrome.classList.toggle("skin-home-shell", customHomeLayout);
    chrome.dataset.skinShell = shell;
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
    document.documentElement?.removeAttribute("data-skin-route");
    document.documentElement?.removeAttribute("data-skin-presentation");
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CHROME_ID)?.remove();
    document.getElementById(VIDEO_LAYER_ID)?.remove();
    interactiveController?.dispose?.();
    interactiveController = null;
    document.getElementById(INTERACTIVE_LAYER_ID)?.remove();
    ownedVideoToggleWrapper?.remove();
    document.getElementById(VIDEO_TOGGLE_WRAPPER_ID)?.remove();
    document.getElementById(VIDEO_TOGGLE_ID)?.remove();
    restoreThemeSettingsPage();
    document.getElementById(STYLE_EDITOR_ID)?.remove();
    document.getElementById(THEME_SETTINGS_NAV_ID)?.remove();
    document.getElementById(THEME_SETTINGS_PAGE_ID)?.remove();
    state?.observer?.disconnect();
    if (state?.timer) clearInterval(state.timer);
    if (state?.scheduler?.timeout) clearTimeout(state.scheduler.timeout);
    if (analysisTimer) clearTimeout(analysisTimer);
    if (state?.resizeHandler) window.removeEventListener("resize", state.resizeHandler);
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
    if (state?.styleEditorDebounceTimer) clearTimeout(state.styleEditorDebounceTimer);
    if (state?.styleEditorResultHandler && window[STYLE_EDITOR_RESULT_KEY] === state.styleEditorResultHandler) {
      delete window[STYLE_EDITOR_RESULT_KEY];
    }
    if (state?.styleEditorSyncHandler && window[STYLE_EDITOR_SYNC_KEY] === state.styleEditorSyncHandler) {
      delete window[STYLE_EDITOR_SYNC_KEY];
    }
    if (state?.runtimeResultHandler && window[THEME_RUNTIME_RESULT_KEY] === state.runtimeResultHandler) {
      delete window[THEME_RUNTIME_RESULT_KEY];
    }
    if (state?.videoArtUrl?.startsWith("blob:")) URL.revokeObjectURL(state.videoArtUrl);
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
    node.matches("[data-settings-panel-slug]") ||
    node.querySelector("[data-settings-panel-slug]")
  );
  const isResponseWaitingSignal = (status) => status instanceof Element &&
    status.matches('[role="status"][aria-busy="true"]') &&
    Boolean(status.querySelector(':scope > .sr-only')) &&
    Boolean(status.querySelector(':scope > [aria-hidden="true"]'));
  const containsResponseWaitingSignal = (node) => {
    if (!(node instanceof Element)) return false;
    if (isResponseWaitingSignal(node)) return true;
    return [...node.querySelectorAll('[role="status"][aria-busy="true"]')]
      .some(isResponseWaitingSignal);
  };
  const observer = new MutationObserver((mutations) => {
    // Settings replaces the complete app shell in one React commit. Waiting
    // for the general 180ms debounce lets the native opaque shell paint before
    // semantic Settings roles are applied, which appears as a route flash.
    // Mark Settings additions/removals in the same pre-paint mutation phase;
    // ordinary high-frequency DOM activity keeps the conservative debounce.
    const settingsRouteChanged = mutations.some((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].some(containsSettingsRouteSignal));
    const sidePanelStateChanged = mutations.some((mutation) =>
      mutation.type === "attributes" && mutation.attributeName === "aria-pressed" &&
      mutation.target instanceof Element &&
      SIDE_PANEL_TOGGLE_LABELS.has(mutation.target.getAttribute("aria-label")));
    const responseWaitingChanged = mutations.some((mutation) =>
      (mutation.type === "attributes" && mutation.attributeName === "aria-busy" &&
        containsResponseWaitingSignal(mutation.target)) ||
      [...mutation.addedNodes, ...mutation.removedNodes].some(containsResponseWaitingSignal));
    const editorLocaleChanged = mutations.some((mutation) =>
      mutation.type === "attributes" && (mutation.attributeName === "lang" || mutation.attributeName === "dir") &&
      mutation.target === document.documentElement);
    if (editorLocaleChanged && refreshEditorLocale()) {
      if (scheduler.timeout) {
        clearTimeout(scheduler.timeout);
        scheduler.timeout = null;
      }
      rerenderLocalizedThemeUi();
      return;
    }
    if (settingsRouteChanged || sidePanelStateChanged || responseWaitingChanged) {
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
    attributeFilter: ["class", "data-theme", "data-appearance", "data-color-mode", "aria-pressed", "aria-busy", "lang", "dir"],
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
    videoMotionOverride = false;
    const state = window[STATE_KEY];
    if (state) state.videoMotionOverride = false;
    syncVideoPlayback();
    interactiveController?.setEnabled?.(interactiveEffectEnabled);
    syncInteractivePresentation();
  };
  motionMediaQuery.addEventListener("change", motionMediaHandler);
  const visibilityHandler = () => syncVideoPlayback();
  document.addEventListener("visibilitychange", visibilityHandler);

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
    styleEditorOutsideHandler,
    styleEditorKeyHandler,
    styleEditorResultHandler: window[STYLE_EDITOR_RESULT_KEY],
    styleEditorSyncHandler: window[STYLE_EDITOR_SYNC_KEY],
    runtimeResultHandler: themeRuntimeResultHandler,
    styleEditorRequestTimer,
    styleEditorDebounceTimer,
    editorLocale: EDITOR_LOCALE,
    editorLocaleDiagnostic: EDITOR_LOCALE_STATE.diagnostic,
    editorLocaleDirection: EDITOR_LOCALE_STATE.direction,
    styleEditorStatus: styleEditorStatusState,
    runtimeIssue: runtimeIssue ? { ...runtimeIssue } : null,
    editorDraft: { ...editorDraft },
    editorRuntimePreferences: { ...editorRuntimePreferences },
    editorWriteVersion,
    lastPersistedStyleOverrides: { ...lastPersistedStyleOverrides },
    lastPersistedRuntimePreferences: { ...lastPersistedRuntimePreferences },
    runtimePreferences: { ...runtimePreferences },
    themeSettingsPageActive,
    settingsNavNode,
    settingsNavClickHandler,
    restoreThemeSettingsPage,
    styleOverrides: { ...styleOverrides },
    artUrl,
    heroArtUrl,
    videoArtUrl,
    videoEnabled,
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
    videoMotionOverride,
    skinAppearanceActive: !videoEnabled || videoPlaybackPreference !== "disabled",
    rootStyleSnapshot,
    videoToggleWrapper: ownedVideoToggleWrapper,
    videoToggleAnchor: ownedVideoToggleAnchor,
    appMount: ownedAppMount,
    version: VERSION,
    themeId: THEME.id || "custom",
    newTaskLayout: HOME_LAYOUT,
    detectShellMode,
    resolvedShellMode,
    artAnalysis,
    analysisTimer,
    installToken,
    setDeferredVideoSource,
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
  __SKIN_INTERACTIVE_ATLAS_JSON__,
  __SKIN_THEME_JSON__,
  __THEME_STYLE_CATALOG_JSON__,
  __THEME_EDITOR_LOCALES_JSON__,
  __THEME_STYLE_OVERRIDES_JSON__,
  __THEME_RUNTIME_PREFERENCES_JSON__,
  __THEME_OVERRIDE_STATE_JSON__,
  __THEME_STYLE_EDITOR_NONCE_JSON__,
  __THEME_STYLE_EDITOR_BINDING_JSON__,
  __SKIN_BACKGROUND_EFFECT_FACTORY__
)
