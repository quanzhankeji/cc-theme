function createDoubaoSkinRuntime(options = {}) {

  const document = options.document ?? globalThis.document;
  const location = options.location ?? globalThis.location;
  const ROLE_ATTRIBUTE = "data-cc-theme-doubao-role";
  const ROOT_ATTRIBUTE = "data-cc-theme-doubao-version";
  const GENERATION_ATTRIBUTE = "data-cc-theme-doubao-generation";
  const STYLE_ID = "cc-theme-doubao-style";
  const BACKGROUND_ID = "cc-theme-doubao-background";
  const ROLE_SELECTORS = Object.freeze([
    ["shell", '[data-testid="chat-route-layout"]', true],
    ["sidebar", '[data-testid="chat_route_layout_leftside_nav"]', true],
    ["composer", '[data-testid="chat_input"]', true],
    ["right-side", '[data-testid="samantha_layout_right_side"]', false],
  ]);
  let roleState = [];
  let variableState = new Map();
  let previousRootAttribute = null;
  let previousGenerationAttribute = null;
  let styleNode = null;
  let backgroundNode = null;
  let currentVersion = null;
  let currentGeneration = null;

  const inspect = () => ({
    applied: currentVersion !== null,
    roles: roleState.length,
    version: currentVersion,
    generation: currentGeneration,
  });

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

  const remove = () => {
    for (const { node, previous } of roleState) {
      if (previous === null) node.removeAttribute(ROLE_ATTRIBUTE);
      else node.setAttribute(ROLE_ATTRIBUTE, previous);
    }
    roleState = [];
    restoreVariables();
    styleNode?.remove();
    backgroundNode?.remove();
    styleNode = null;
    backgroundNode = null;
    if (currentVersion !== null) {
      if (previousRootAttribute === null) document.documentElement.removeAttribute(ROOT_ATTRIBUTE);
      else document.documentElement.setAttribute(ROOT_ATTRIBUTE, previousRootAttribute);
      if (previousGenerationAttribute === null) document.documentElement.removeAttribute(GENERATION_ATTRIBUTE);
      else document.documentElement.setAttribute(GENERATION_ATTRIBUTE, previousGenerationAttribute);
    }
    previousRootAttribute = null;
    previousGenerationAttribute = null;
    currentVersion = null;
    currentGeneration = null;
    return inspect();
  };

  const apply = (payload) => {
    assertHost();
    remove();
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        typeof payload.version !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(payload.version) ||
        typeof payload.generation !== "string" || !/^[0-9a-f]{16}$/.test(payload.generation) ||
        typeof payload.styleText !== "string" || !payload.styleText || payload.styleText.length > 256 * 1024 ||
        typeof payload.backgroundUrl !== "string" || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(payload.backgroundUrl) ||
        typeof payload.backgroundPosition !== "string" || !/^\d+(?:\.\d+)?% \d+(?:\.\d+)?%$/.test(payload.backgroundPosition)) {
      throw new Error("Doubao runtime payload is invalid");
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

    previousRootAttribute = document.documentElement.getAttribute(ROOT_ATTRIBUTE);
    previousGenerationAttribute = document.documentElement.getAttribute(GENERATION_ATTRIBUTE);
    for (const [role, selector] of ROLE_SELECTORS) {
      const node = document.querySelector(selector);
      if (!node) continue;
      roleState.push({ node, previous: node.getAttribute(ROLE_ATTRIBUTE) });
      node.setAttribute(ROLE_ATTRIBUTE, role);
    }
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
    document.body.prepend(backgroundNode);
    document.documentElement.setAttribute(ROOT_ATTRIBUTE, payload.version);
    document.documentElement.setAttribute(GENERATION_ATTRIBUTE, payload.generation);
    currentVersion = payload.version;
    currentGeneration = payload.generation;
    return inspect();
  };

  return Object.freeze({ apply, inspect, remove });
}
