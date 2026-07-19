({ document, root, config, roleAttribute = "data-skin-role", markerValue = "mac-claude" }) => {
  const ownedRoleNodes = new Set();

  const query = (selectors, scope = document, many = false) => {
    const list = Array.isArray(selectors) ? selectors : [];
    if (!scope || !list.length) return many ? [] : null;
    try {
      if (many) return [...scope.querySelectorAll(list.join(", "))];
      for (const selector of list) {
        const node = scope.querySelector(selector);
        if (node) return node;
      }
    } catch {
      return many ? [] : null;
    }
    return many ? [] : null;
  };

  const select = (id, scope = document) => {
    const target = config?.targets?.[id];
    if (!target) return null;
    return query(target.selectors, scope, target.cardinality === "many");
  };

  const matchesHost = () => (config?.identity?.alternatives || []).some((selectors) =>
    selectors.every((selector) => query([selector])));

  const markRole = (node, role, variant = null) => {
    if (!node || node.closest?.("#cc-theme-style-editor")) return false;
    node.setAttribute(roleAttribute, role);
    node.setAttribute("data-skin-marker", markerValue);
    if (variant) node.setAttribute("data-skin-overlay-kind", variant);
    else node.removeAttribute("data-skin-overlay-kind");
    ownedRoleNodes.add(node);
    return true;
  };

  const resolveSettingsMount = () => {
    const dialog = select("settingsDialog");
    const nav = dialog ? select("settingsNav", dialog) : null;
    const selector = config?.settingsMount?.desktopListSelector || "ul.flex.flex-col.gap-px";
    const expected = Number(config?.settingsMount?.nativeItemCount || 3);
    const existingItem = document.getElementById("cc-theme-settings-nav-item");
    let desktopList = existingItem?.closest("ul") || null;
    if (!desktopList && nav) {
      const active = nav.querySelector('button[aria-current="page"]');
      const activeList = active?.closest("ul") || null;
      const activeListButtonCount = activeList?.querySelectorAll(":scope > li > button").length || 0;
      if (activeList && activeListButtonCount === expected &&
          active === activeList.querySelector(":scope > li:first-child > button")) {
        desktopList = activeList;
      }
    }
    if (!desktopList && nav) {
      desktopList = [...nav.querySelectorAll(selector)].find((list) =>
        list.querySelectorAll(":scope > li > button").length === expected) || null;
    }
    const generalButton = desktopList?.querySelector(":scope > li:first-child > button") || null;
    const nativeContent = dialog ? [...dialog.children].find((child) =>
      child !== nav && child.id !== "cc-theme-settings-page") || null : null;
    return { dialog, nav, desktopList, generalButton, nativeContent };
  };

  const resolveComposer = (input, boundary) => {
    if (!input) return null;
    let fallback = input.parentElement;
    for (let node = input.parentElement; node && node !== boundary && node !== document.body; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      let style;
      try { style = getComputedStyle(node); } catch {}
      const radius = parseFloat(style?.borderTopLeftRadius || "0");
      const bordered = [style?.borderTopWidth, style?.borderRightWidth, style?.borderBottomWidth, style?.borderLeftWidth]
        .some((width) => parseFloat(width || "0") > 0);
      if (rect.width >= 280 && rect.height >= 48 && rect.height <= 260 && (bordered || radius >= 12)) {
        fallback = node;
      }
    }
    return fallback;
  };

  const reconcileRoles = () => {
    const current = new Set();
    const mark = (node, role, variant = null) => {
      if (markRole(node, role, variant)) current.add(node);
    };
    for (const rule of config?.roles || []) {
      const nodes = rule.cardinality === "many"
        ? query(rule.selectors, document, true)
        : [query(rule.selectors)];
      for (const node of nodes) if (node) mark(node, rule.role, rule.variant || null);
    }
    const primary = select("primaryPane");
    const input = select("composerInput");
    const composer = resolveComposer(input, primary);
    mark(composer, "composer");
    mark(composer?.querySelector('button[type="submit"]'), "send-button");
    const settings = resolveSettingsMount();
    if (settings.dialog) {
      mark(settings.dialog, "settings-shell");
      mark(settings.nav, "settings-sidebar");
      mark(settings.nativeContent, "settings-content");
      for (const button of settings.nav?.querySelectorAll("button") || []) mark(button, "settings-nav-item");
    }
    for (const node of ownedRoleNodes) {
      if (current.has(node)) continue;
      if (node.isConnected) {
        node.removeAttribute(roleAttribute);
        node.removeAttribute("data-skin-marker");
        node.removeAttribute("data-skin-overlay-kind");
      }
      ownedRoleNodes.delete(node);
    }
    return { composer, settings };
  };

  const cleanup = () => {
    for (const node of ownedRoleNodes) {
      if (!node.isConnected) continue;
      node.removeAttribute(roleAttribute);
      node.removeAttribute("data-skin-marker");
      node.removeAttribute("data-skin-overlay-kind");
    }
    ownedRoleNodes.clear();
  };

  const inspect = () => ({
    matchedHost: matchesHost(),
    configuredRoles: config?.roles?.length || 0,
    markedRoles: ownedRoleNodes.size,
    settingsMount: Boolean(resolveSettingsMount().dialog),
  });

  return {
    matchesHost,
    select,
    markRole,
    resolveComposer,
    resolveSettingsMount,
    reconcileRoles,
    cleanup,
    inspect,
  };
}
