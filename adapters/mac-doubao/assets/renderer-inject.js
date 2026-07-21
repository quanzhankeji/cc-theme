function createDoubaoSkinRuntime(options = {}) {

  const document = options.document ?? globalThis.document;
  const location = options.location ?? globalThis.location;
  const URL = options.URL ?? globalThis.URL;
  const matchMedia = options.matchMedia ?? globalThis.matchMedia?.bind(globalThis);
  const MutationObserver = options.MutationObserver ?? globalThis.MutationObserver;
  const setTimeout = options.setTimeout ?? globalThis.setTimeout?.bind(globalThis);
  const clearTimeout = options.clearTimeout ?? globalThis.clearTimeout?.bind(globalThis);
  const setInterval = options.setInterval ?? globalThis.setInterval?.bind(globalThis);
  const clearInterval = options.clearInterval ?? globalThis.clearInterval?.bind(globalThis);
  const ROLE_ATTRIBUTE = "data-cc-theme-doubao-role";
  const ROOT_ATTRIBUTE = "data-cc-theme-doubao-version";
  const GENERATION_ATTRIBUTE = "data-cc-theme-doubao-generation";
  const CONTEXT_ATTRIBUTE = "data-cc-theme-doubao-surface-context";
  const HOST_APPEARANCE_ATTRIBUTE = "data-cc-theme-doubao-host-appearance";
  const APPEARANCE_ATTRIBUTE = "data-cc-theme-doubao-appearance";
  const PALETTE_STRATEGY_ATTRIBUTE = "data-cc-theme-doubao-palette-strategy";
  const STATE_ATTRIBUTE = "data-cc-theme-doubao-state";
  const STYLE_ID = "cc-theme-doubao-style";
  const BACKGROUND_ID = "cc-theme-doubao-background";
  const VIDEO_ID = "cc-theme-doubao-background-video";
  const VIDEO_SCRIM_ID = "cc-theme-doubao-video-scrim";
  const ROLE_SELECTORS = Object.freeze([
    ["shell", '[data-testid="chat-route-layout"]', true, false],
    ["sidebar", '[data-testid="chat_route_layout_leftside_nav"]', true, false],
    ["composer", '[data-testid="chat_input"]', true, false],
    ["main-surface", "#chat-route-main > main", false, false],
    ["sidebar-inner", "#flow_chat_sidebar", false, false],
    ["home-surface", '[data-testid="flow_chat_guidance_page"]', false, false],
    ["home-title", '[data-testid="flow_chat_guidance_page"] > div:first-child > div:nth-child(2)', false, false],
    ["chat-list", '[data-testid="chat_list_wrapper"]', false, false],
    ["sidebar-item", '[data-testid="chat_list_thread_item"]', false, true],
    ["sidebar-action", ':is([data-testid="create_office_task_button"], [data-testid="app-open-website"], [data-testid="sidebar-skills"], [data-testid="ai_space_nav_button"], [data-testid="sidebar-section-item"], [data-testid="view_all_chats_button"])', false, true],
    ["sidebar-footer", '[data-testid="sidebar_bottom"]', false, false],
    ["header-surface", "#chat-route-main > main > div:first-child > div:first-child", false, false],
    ["header-title", '[data-testid="editable_conversation_name"]', false, false],
    ["header-action", ':is([data-testid="chat_header_avatar_button"], [data-testid="siderbar_close_btn"], [data-testid="chat_header_voice_icon_button"], [data-testid="open-in-launcher-btn"])', false, true],
    ["composer-input", '[data-testid="chat_input_input"]', false, false],
    ["suggestion", '[data-testid="onboarding_sug_item"]', false, true],
    ["message-list", '[data-testid="message-list"]', false, false],
    ["message", '[data-testid="message-block-container"]', false, true],
    ["user-message", '[data-testid="send_message"]', false, true],
    ["assistant-message", '[data-testid="receive_message"]', false, true],
    ["assistant-content", '[data-testid="receive_message"] [data-testid="message_content"]', false, true],
    ["user-content", '[data-testid="send_message"] [data-testid="message_text_content"]', false, true],
    ["message-actions", '[data-testid="message_action_bar"]', false, true],
    ["message-action", '[data-testid="message_action_bar"] button', false, true],
    ["reference-card", '[data-testid="ref-content-wrapper"]', false, true],
    ["document-card", '[data-testid="doc_card"]', false, true],
    ["content-link", ':is([data-testid="receive_message"] a, [data-testid="ref-content-wrapper"] a, [data-testid="doc_card"] a)', false, true],
    ["followup-suggestion", '[data-testid="suggest_message_item"]', false, true],
    ["composer-toolbar", '[data-testid="guidance-skill-bar"]', false, false],
    ["composer-action", ':is([data-testid="upload_file_button"], [data-testid^="skill_bar_button_"], [data-testid="asr_btn"], [data-testid="chat_input"] button)', false, true],
    ["scroll-action", '[data-testid="to-bottom-button"]', false, false],
    ["muted-text", '[data-testid="conversation_header_tip_text"]', false, true],
    ["create-action", '[data-testid="create_conversation_button"]', false, true],
    ["right-side", '[data-testid="samantha_layout_right_side"]', false, false],
    ["overlay-surface", ':is([role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"], [role="status"], [role="alert"])', false, true],
  ]);
  let roleState = new Map();
  let selectedState = new Map();
  let variableState = new Map();
  let previousRootAttribute = null;
  let previousGenerationAttribute = null;
  let previousContextAttribute = null;
  let previousHostAppearanceAttribute = null;
  let previousAppearanceAttribute = null;
  let previousPaletteStrategyAttribute = null;
  let styleNode = null;
  let backgroundNode = null;
  let currentVersion = null;
  let currentGeneration = null;
  let currentDocumentIdentity = null;
  let currentHostAppearance = null;
  let currentPaletteStrategy = null;
  let videoNode = null;
  let videoScrimNode = null;
  let videoExpected = false;
  let videoPlaybackState = null;
  let videoSourceUrl = null;
  let videoFrameReady = false;
  let videoFrameCallbackId = null;
  let videoFrameTimer = null;
  let videoFrameCancel = null;
  let videoEventListeners = [];
  let reducedMotionQuery = null;
  let visibilityListener = null;
  let reducedMotionListener = null;
  let observer = null;
  let reconcileTimer = null;
  let reconcileInterval = null;
  let appearanceQuery = null;
  let appearanceListener = null;

  const inspect = () => {
    const state = {
      applied: currentVersion !== null,
      roles: roleState.size,
      version: currentVersion,
      generation: currentGeneration,
      lifecycle: {
        observer: observer !== null,
        reconcileTimer: reconcileTimer !== null,
        reconcileInterval: reconcileInterval !== null,
        visibilityListener: visibilityListener !== null,
        reducedMotionListener: reducedMotionListener !== null,
        videoFrameCallback: videoFrameCallbackId !== null,
        objectUrlCount: videoSourceUrl ? 1 : 0,
      },
      ...(currentDocumentIdentity ? { documentIdentity: currentDocumentIdentity } : {}),
      ...(currentHostAppearance ? {
        hostAppearance: currentHostAppearance,
        appearance: currentHostAppearance,
      } : {}),
      ...(currentPaletteStrategy ? { paletteStrategy: currentPaletteStrategy } : {}),
    };
    if (!videoExpected) return state;
    return {
      ...state,
      videoExpected: true,
      videoPlaybackState,
      videoSourceReady: Boolean(videoSourceUrl && videoNode?.src),
      videoReadyState: Number(videoNode?.readyState ?? 0),
      videoPaused: Boolean(videoNode?.paused),
      videoFrameReady,
    };
  };

  const assertHost = () => {
    if (!document?.documentElement || !document?.head || !document?.body) {
      throw new Error("Doubao document is not ready");
    }
    if (!location || !["chrome:", "doubao:"].includes(location.protocol) || location.host !== "doubao-chat") {
      throw new Error("Renderer is not the trusted Doubao chat surface");
    }
    for (const [, selector, required] of ROLE_SELECTORS) {
      if (required && !document.querySelector(selector)) {
        throw new Error(`Required Doubao surface is unavailable: ${selector}`);
      }
    }
  };

  const restoreVariables = () => {
    for (const [name, previous] of variableState) {
      if (previous.present) {
        document.documentElement.style.setProperty(name, previous.value, previous.priority);
      } else {
        document.documentElement.style.removeProperty(name);
      }
    }
    variableState = new Map();
  };

  const restoreRole = (node, previous) => {
    if (previous === null) node.removeAttribute(ROLE_ATTRIBUTE);
    else node.setAttribute(ROLE_ATTRIBUTE, previous);
  };

  const restoreSelectedState = (node, previous) => {
    if (previous === null) node.removeAttribute(STATE_ATTRIBUTE);
    else node.setAttribute(STATE_ATTRIBUTE, previous);
  };

  const hostAppearance = () => {
    const root = document.documentElement;
    const body = document.body;
    for (const value of [
      root.getAttribute("data-theme-mode"), root.getAttribute("data-theme"),
      root.getAttribute("theme-mode"), root.getAttribute("theme"),
      body?.getAttribute?.("data-theme-mode"), body?.getAttribute?.("data-theme"),
      body?.getAttribute?.("theme-mode"), body?.getAttribute?.("theme"),
    ]) {
      const normalized = String(value ?? "").toLowerCase();
      if (normalized.includes("dark")) return "dark";
      if (normalized.includes("light")) return "light";
    }
    const className = `${root.getAttribute("class") ?? ""} ${body?.getAttribute?.("class") ?? ""}`.toLowerCase();
    if (/\b(?:theme-|appearance-)?dark\b/.test(className)) return "dark";
    if (/\b(?:theme-|appearance-)?light\b/.test(className)) return "light";
    return appearanceQuery?.matches ? "dark" : "light";
  };

  const reconcileAppearance = () => {
    const next = hostAppearance();
    currentHostAppearance = next;
    if (document.documentElement.getAttribute(HOST_APPEARANCE_ATTRIBUTE) !== next) {
      document.documentElement.setAttribute(HOST_APPEARANCE_ATTRIBUTE, next);
    }
    if (document.documentElement.getAttribute(APPEARANCE_ATTRIBUTE) !== next) {
      document.documentElement.setAttribute(APPEARANCE_ATTRIBUTE, next);
    }
  };

  const reconcileRoles = () => {
    const desired = new Map();
    for (const [role, selector, , multiple] of ROLE_SELECTORS) {
      const nodes = multiple
        ? Array.from(document.querySelectorAll?.(selector) ?? [])
        : [document.querySelector(selector)].filter(Boolean);
      for (const node of nodes) if (!desired.has(node)) desired.set(node, role);
    }
    for (const [node, previous] of roleState) {
      if (desired.has(node)) continue;
      restoreRole(node, previous);
      roleState.delete(node);
    }
    for (const [node, role] of desired) {
      if (!roleState.has(node)) roleState.set(node, node.getAttribute(ROLE_ATTRIBUTE));
      if (node.getAttribute(ROLE_ATTRIBUTE) !== role) node.setAttribute(ROLE_ATTRIBUTE, role);
    }
    const selected = new Map();
    for (const [node] of roleState) {
      if (node.getAttribute(ROLE_ATTRIBUTE) !== "sidebar-item") continue;
      const className = String(node.getAttribute("class") ?? node.className ?? "");
      const active = node.getAttribute("aria-current") === "page" ||
        node.getAttribute("aria-selected") === "true" ||
        node.getAttribute("data-state") === "active" ||
        /(?:^|\s)e2e-test-active(?:\s|$)/.test(className);
      if (active) selected.set(node, "selected");
    }
    for (const [node, previous] of selectedState) {
      if (selected.has(node)) continue;
      restoreSelectedState(node, previous);
      selectedState.delete(node);
    }
    for (const [node, state] of selected) {
      if (!selectedState.has(node)) selectedState.set(node, node.getAttribute(STATE_ATTRIBUTE));
      if (node.getAttribute(STATE_ATTRIBUTE) !== state) node.setAttribute(STATE_ATTRIBUTE, state);
    }
    const context = document.querySelector('[data-testid="message-list"]') ? "chat" :
      document.querySelector('[data-testid="flow_chat_guidance_page"]') ? "home" : "shell";
    if (document.documentElement.getAttribute(CONTEXT_ATTRIBUTE) !== context) {
      document.documentElement.setAttribute(CONTEXT_ATTRIBUTE, context);
    }
    reconcileAppearance();
  };

  const scheduleReconcile = () => {
    if (!setTimeout || reconcileTimer !== null) return;
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      if (currentVersion !== null) reconcileRoles();
    }, 120);
  };

  const stopReconciliation = () => {
    observer?.disconnect?.();
    observer = null;
    if (reconcileTimer !== null) clearTimeout?.(reconcileTimer);
    if (reconcileInterval !== null) clearInterval?.(reconcileInterval);
    reconcileTimer = null;
    reconcileInterval = null;
    if (appearanceListener) appearanceQuery?.removeEventListener?.("change", appearanceListener);
    appearanceListener = null;
    appearanceQuery = null;
  };

  const disposeVideo = () => {
    if (visibilityListener) document.removeEventListener?.("visibilitychange", visibilityListener);
    if (reducedMotionListener) reducedMotionQuery?.removeEventListener?.("change", reducedMotionListener);
    visibilityListener = null;
    reducedMotionListener = null;
    if (videoNode) {
      if (videoFrameCallbackId !== null) {
        try { videoNode.cancelVideoFrameCallback?.(videoFrameCallbackId); } catch {}
      }
      for (const [type, listener] of videoEventListeners) {
        videoNode.removeEventListener?.(type, listener);
      }
      try {
        videoNode.pause();
        videoNode.removeAttribute("src");
        videoNode.src = "";
        videoNode.load();
      } catch {}
    }
    videoFrameCancel?.();
    if (videoFrameTimer !== null) clearTimeout?.(videoFrameTimer);
    videoFrameCallbackId = null;
    videoFrameTimer = null;
    videoFrameCancel = null;
    videoEventListeners = [];
    if (videoSourceUrl) {
      try { URL?.revokeObjectURL?.(videoSourceUrl); } catch {}
    }
    videoSourceUrl = null;
    videoNode = null;
    videoScrimNode = null;
    videoExpected = false;
    videoPlaybackState = null;
    videoFrameReady = false;
    reducedMotionQuery = null;
  };

  const remove = () => {
    stopReconciliation();
    for (const [node, previous] of roleState) restoreRole(node, previous);
    roleState = new Map();
    for (const [node, previous] of selectedState) restoreSelectedState(node, previous);
    selectedState = new Map();
    restoreVariables();
    disposeVideo();
    styleNode?.remove();
    backgroundNode?.remove();
    styleNode = null;
    backgroundNode = null;
    if (currentVersion !== null) {
      if (previousRootAttribute === null) document.documentElement.removeAttribute(ROOT_ATTRIBUTE);
      else document.documentElement.setAttribute(ROOT_ATTRIBUTE, previousRootAttribute);
      if (previousGenerationAttribute === null) document.documentElement.removeAttribute(GENERATION_ATTRIBUTE);
      else document.documentElement.setAttribute(GENERATION_ATTRIBUTE, previousGenerationAttribute);
      if (previousContextAttribute === null) document.documentElement.removeAttribute(CONTEXT_ATTRIBUTE);
      else document.documentElement.setAttribute(CONTEXT_ATTRIBUTE, previousContextAttribute);
      if (previousHostAppearanceAttribute === null) document.documentElement.removeAttribute(HOST_APPEARANCE_ATTRIBUTE);
      else document.documentElement.setAttribute(HOST_APPEARANCE_ATTRIBUTE, previousHostAppearanceAttribute);
      if (previousAppearanceAttribute === null) document.documentElement.removeAttribute(APPEARANCE_ATTRIBUTE);
      else document.documentElement.setAttribute(APPEARANCE_ATTRIBUTE, previousAppearanceAttribute);
      if (previousPaletteStrategyAttribute === null) document.documentElement.removeAttribute(PALETTE_STRATEGY_ATTRIBUTE);
      else document.documentElement.setAttribute(PALETTE_STRATEGY_ATTRIBUTE, previousPaletteStrategyAttribute);
    }
    previousRootAttribute = null;
    previousGenerationAttribute = null;
    previousContextAttribute = null;
    previousHostAppearanceAttribute = null;
    previousAppearanceAttribute = null;
    previousPaletteStrategyAttribute = null;
    currentVersion = null;
    currentGeneration = null;
    currentDocumentIdentity = null;
    currentHostAppearance = null;
    currentPaletteStrategy = null;
    return inspect();
  };

  const apply = (payload) => {
    assertHost();
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        typeof payload.version !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(payload.version) ||
        typeof payload.generation !== "string" || !/^[0-9a-f]{16}$/.test(payload.generation) ||
        typeof payload.documentIdentity !== "string" || !/^[0-9a-f]{64}$/.test(payload.documentIdentity) ||
        typeof payload.styleText !== "string" || !payload.styleText || payload.styleText.length > 256 * 1024 ||
        typeof payload.backgroundUrl !== "string" || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(payload.backgroundUrl) ||
        typeof payload.backgroundPosition !== "string" || !/^\d+(?:\.\d+)?% \d+(?:\.\d+)?%$/.test(payload.backgroundPosition)) {
      throw new Error("Doubao runtime payload is invalid");
    }
    if (payload.videoExpected !== undefined && typeof payload.videoExpected !== "boolean") {
      throw new Error("Doubao runtime video expectation is invalid");
    }
    const paletteStrategy = payload.paletteStrategy ?? "system";
    if (!["system", "adaptive"].includes(paletteStrategy)) {
      throw new Error("Doubao runtime palette strategy is invalid");
    }
    if (payload.videoExpected &&
        (!['none', 'image'].includes(payload.videoPosterMode) ||
         !Number.isFinite(payload.videoScrimOpacity) || payload.videoScrimOpacity < 0 || payload.videoScrimOpacity > 0.8 ||
         typeof payload.videoPosition !== "string" || !/^\d+(?:\.\d+)?% \d+(?:\.\d+)?%$/.test(payload.videoPosition))) {
      throw new Error("Doubao runtime video presentation is invalid");
    }
    const variables = payload.variables;
    if (!variables || typeof variables !== "object" || Array.isArray(variables) || Object.keys(variables).length > 80) {
      throw new Error("Doubao runtime variables are invalid");
    }
    for (const [name, value] of Object.entries(variables)) {
      if (!/^--cc-doubao-[a-z0-9-]{1,80}$/.test(name) || typeof value !== "string" || !value || value.length > 256 || /[;{}<>]/.test(value)) {
        throw new Error(`Doubao runtime variable is invalid: ${name}`);
      }
    }
    remove();

    previousRootAttribute = document.documentElement.getAttribute(ROOT_ATTRIBUTE);
    previousGenerationAttribute = document.documentElement.getAttribute(GENERATION_ATTRIBUTE);
    previousContextAttribute = document.documentElement.getAttribute(CONTEXT_ATTRIBUTE);
    previousHostAppearanceAttribute = document.documentElement.getAttribute(HOST_APPEARANCE_ATTRIBUTE);
    previousAppearanceAttribute = document.documentElement.getAttribute(APPEARANCE_ATTRIBUTE);
    previousPaletteStrategyAttribute = document.documentElement.getAttribute(PALETTE_STRATEGY_ATTRIBUTE);
    appearanceQuery = matchMedia?.("(prefers-color-scheme: dark)") ?? null;
    appearanceListener = scheduleReconcile;
    appearanceQuery?.addEventListener?.("change", appearanceListener);
    reconcileRoles();
    for (const [name, value] of Object.entries(variables)) {
      const previousValue = document.documentElement.style.getPropertyValue(name);
      const previousPriority = document.documentElement.style.getPropertyPriority(name);
      variableState.set(name, {
        present: previousValue !== "" || previousPriority !== "",
        value: previousValue,
        priority: previousPriority,
      });
      document.documentElement.style.setProperty(name, value);
    }

    styleNode = document.createElement("style");
    styleNode.id = STYLE_ID;
    styleNode.setAttribute(GENERATION_ATTRIBUTE, payload.generation);
    styleNode.textContent = payload.styleText;
    document.head.append(styleNode);
    backgroundNode = document.createElement("div");
    backgroundNode.id = BACKGROUND_ID;
    backgroundNode.setAttribute(GENERATION_ATTRIBUTE, payload.generation);
    backgroundNode.setAttribute("aria-hidden", "true");
    backgroundNode.style.backgroundImage = `url("${payload.backgroundUrl}")`;
    backgroundNode.style.backgroundPosition = payload.backgroundPosition;
    if (payload.videoExpected) {
      videoExpected = true;
      videoPlaybackState = "loading";
      videoFrameReady = false;
      videoNode = document.createElement("video");
      videoNode.id = VIDEO_ID;
      videoNode.muted = true;
      videoNode.defaultMuted = true;
      videoNode.loop = true;
      videoNode.playsInline = true;
      videoNode.autoplay = false;
      videoNode.preload = payload.videoPosterMode === "image" ? "metadata" : "auto";
      videoNode.setAttribute("muted", "");
      videoNode.setAttribute("loop", "");
      videoNode.setAttribute("playsinline", "");
      if (payload.videoPosterMode === "image") videoNode.poster = payload.backgroundUrl;
      videoNode.style.objectPosition = payload.videoPosition;
      const onVideoError = () => {
        if (videoNode && currentGeneration === payload.generation) {
          videoFrameReady = false;
          videoPlaybackState = "error";
        }
      };
      const onVideoWaiting = () => {
        if (videoNode && currentGeneration === payload.generation) {
          videoFrameReady = false;
          videoPlaybackState = "loading";
        }
      };
      videoEventListeners = [["error", onVideoError], ["waiting", onVideoWaiting]];
      for (const [type, listener] of videoEventListeners) videoNode.addEventListener?.(type, listener);
      backgroundNode.append(videoNode);
      videoScrimNode = document.createElement("div");
      videoScrimNode.id = VIDEO_SCRIM_ID;
      videoScrimNode.setAttribute("aria-hidden", "true");
      videoScrimNode.style.opacity = String(payload.videoScrimOpacity);
      backgroundNode.append(videoScrimNode);
      reducedMotionQuery = matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    }
    document.body.prepend(backgroundNode);
    document.documentElement.setAttribute(ROOT_ATTRIBUTE, payload.version);
    document.documentElement.setAttribute(GENERATION_ATTRIBUTE, payload.generation);
    document.documentElement.setAttribute(PALETTE_STRATEGY_ATTRIBUTE, paletteStrategy);
    currentVersion = payload.version;
    currentGeneration = payload.generation;
    currentDocumentIdentity = payload.documentIdentity;
    currentPaletteStrategy = paletteStrategy;
    reconcileRoles();
    if (typeof MutationObserver === "function") {
      observer = new MutationObserver(scheduleReconcile);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-theme-mode", "data-theme", "theme-mode", "theme", "class"],
      });
    }
    if (setInterval) reconcileInterval = setInterval(() => {
      if (currentVersion !== null) reconcileRoles();
    }, 1500);
    return inspect();
  };

  const confirmVideoFrame = async (video, generation, startingTime) => {
    if (currentGeneration !== generation || video !== videoNode || video.error) return false;
    if (typeof video.requestVideoFrameCallback === "function") {
      return await new Promise((resolve) => {
        let settled = false;
        const deadline = Date.now() + 5000;
        const finish = (value, fromFrame = false) => {
          if (settled) return;
          settled = true;
          if (!fromFrame && videoFrameCallbackId !== null) {
            try { video.cancelVideoFrameCallback?.(videoFrameCallbackId); } catch {}
          }
          if (videoFrameTimer !== null) clearTimeout?.(videoFrameTimer);
          videoFrameTimer = null;
          videoFrameCallbackId = null;
          videoFrameCancel = null;
          resolve(value);
        };
        videoFrameCancel = () => finish(false);
        videoFrameCallbackId = video.requestVideoFrameCallback(() => finish(
          currentGeneration === generation && video === videoNode && !video.paused && !video.error,
          true,
        ));
        const pollProgress = () => {
          if (currentGeneration !== generation || video !== videoNode || video.error || video.paused) {
            finish(false);
            return;
          }
          if (Number(video.readyState) >= 2 && Number(video.currentTime) > startingTime + 0.01) {
            finish(true);
            return;
          }
          if (Date.now() >= deadline || !setTimeout) {
            finish(false);
            return;
          }
          videoFrameTimer = setTimeout(pollProgress, 100);
        };
        videoFrameTimer = setTimeout?.(pollProgress, 100) ?? null;
      });
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (currentGeneration !== generation || video !== videoNode || video.error || video.paused) return false;
      if (Number(video.readyState) >= 2 && Number(video.currentTime) > startingTime) return true;
      if (!setTimeout) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return Number(video.readyState) >= 2 && !video.paused && Number(video.currentTime) > startingTime;
  };

  const playCurrentVideo = async () => {
    if (!videoExpected || !videoNode || !videoSourceUrl) return inspect();
    const generation = currentGeneration;
    const video = videoNode;
    if (reducedMotionQuery?.matches) {
      videoNode.pause();
      videoFrameReady = false;
      videoPlaybackState = "reduced-motion";
      return inspect();
    }
    if (document.hidden) {
      videoNode.pause();
      videoFrameReady = false;
      videoPlaybackState = "paused";
      return inspect();
    }
    const startingTime = Number(videoNode.currentTime) || 0;
    videoPlaybackState = "loading";
    try {
      await video.play();
    } catch {
      if (currentGeneration !== generation || video !== videoNode) return inspect();
      videoFrameReady = false;
      videoPlaybackState = "play-blocked";
      return inspect();
    }
    if (currentGeneration !== generation || video !== videoNode) return inspect();
    if (video.error) {
      videoFrameReady = false;
      videoPlaybackState = "error";
      return inspect();
    }
    const frameReady = await confirmVideoFrame(video, generation, startingTime);
    if (currentGeneration !== generation || video !== videoNode) return inspect();
    videoFrameReady = frameReady;
    videoPlaybackState = videoFrameReady ? "playing" : "loading";
    return inspect();
  };

  const setVideoSource = async (source, generation) => {
    if (!videoExpected || !videoNode || currentGeneration !== generation) {
      throw new Error("Doubao video generation is stale");
    }
    if (typeof source !== "string" || !source.startsWith("blob:")) {
      throw new Error("Doubao video source is invalid");
    }
    if (videoSourceUrl && videoSourceUrl !== source) {
      try { URL?.revokeObjectURL?.(videoSourceUrl); } catch {}
    }
    videoSourceUrl = source;
    videoNode.src = source;
    videoNode.load();
    visibilityListener = () => { void playCurrentVideo(); };
    reducedMotionListener = () => { void playCurrentVideo(); };
    document.addEventListener?.("visibilitychange", visibilityListener);
    reducedMotionQuery?.addEventListener?.("change", reducedMotionListener);
    return playCurrentVideo();
  };

  return Object.freeze({ apply, inspect, remove, setVideoSource });
}
