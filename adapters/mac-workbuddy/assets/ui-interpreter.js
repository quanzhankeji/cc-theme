({ document, root, config, styleCatalog, roleAttribute }) => {
  const ownedRoleNodes = new Set();
  const previousStyles = new Map();
  const bindings = new Map((styleCatalog?.bindings ?? []).map((binding) => [binding.id, binding]));

  const query = (scope, selectors, many = false) => {
    const source = Array.isArray(selectors) ? selectors : [];
    if (!source.length || !scope) return many ? [] : null;
    try {
      if (many) return [...scope.querySelectorAll(source.join(", "))];
      for (const selector of source) {
        const node = scope.querySelector(selector);
        if (node) return node;
      }
    } catch {
      return many ? [] : null;
    }
    return many ? [] : null;
  };

  const readPath = (source, dottedPath) => {
    if (typeof dottedPath !== "string" || !dottedPath) return undefined;
    return dottedPath.split(".").reduce((value, key) => value?.[key], source);
  };

  const matchesHostIdentity = () => {
    const identity = config?.identity;
    if (!identity || !document.body) return false;
    for (const [name, value] of Object.entries(identity.bodyDataset ?? {})) {
      if (document.body.dataset?.[name] !== value) return false;
    }
    return true;
  };

  const matchesBootstrapHost = () => {
    const identity = config?.identity;
    if (!identity || !document.body) return false;
    if (identity.rendererPathSuffix) {
      try {
        const location = document.location ?? document.defaultView?.location;
        if (location?.protocol !== "file:" ||
            !decodeURIComponent(location.pathname).endsWith(identity.rendererPathSuffix)) return false;
      } catch {
        return false;
      }
    }
    for (const [name, value] of Object.entries(identity.bodyDataset ?? {})) {
      const current = document.body.dataset?.[name];
      if (typeof current === "string" && current && current !== value) return false;
    }
    return true;
  };

  const matchesHost = () => matchesHostIdentity() &&
    (config?.identity?.requiredSelectors ?? []).every((selector) => query(document, [selector]));

  const readHostLocale = () => {
    const authority = config?.localeAuthority;
    if (!authority) return { value: null, source: "unconfigured" };
    try {
      const stored = document.defaultView?.localStorage?.getItem(authority.storageKey);
      if (typeof stored === "string" && stored.trim()) {
        return { value: stored.slice(0, 35), source: "host-storage" };
      }
    } catch {}
    const bodyLocale = document.body?.getAttribute(authority.bodyAttribute);
    if (typeof bodyLocale === "string" && bodyLocale.trim()) {
      return { value: bodyLocale.slice(0, 35), source: "host-body-attribute" };
    }
    return { value: authority.defaultLocale ?? null, source: "host-default" };
  };

  const anchor = (name) => {
    const definition = config?.anchors?.[name];
    if (!definition) return null;
    const scope = definition.withinSelectors
      ? query(document, definition.withinSelectors)
      : document;
    const candidates = query(scope, definition.selectors, true);
    if (!candidates.length) return null;
    return definition.selection === "last" ? candidates.at(-1) : candidates[0];
  };

  const select = (name, scope = document) => {
    const definition = config?.targets?.[name];
    if (!definition) return null;
    return query(scope, definition.selectors, definition.cardinality === "many");
  };

  const closest = (name, node) => {
    const definition = config?.targets?.[name];
    if (!definition || !node?.closest) return null;
    try {
      return node.closest(definition.selectors.join(", "));
    } catch {
      return null;
    }
  };

  const resolveMount = (name) => {
    const definition = config?.mounts?.[name];
    if (!definition || !Array.isArray(definition.nodes)) return null;
    const nodes = {};
    for (const descriptor of definition.nodes) {
      const scope = descriptor.within === "document" ? document : nodes[descriptor.within];
      if (!scope) return null;
      nodes[descriptor.id] = query(scope, descriptor.selectors, descriptor.cardinality === "many");
      if (descriptor.required !== false && (Array.isArray(nodes[descriptor.id])
        ? !nodes[descriptor.id].length
        : !nodes[descriptor.id])) return null;
    }
    return { definition, nodes };
  };

  const insert = (mountName, slotName, node) => {
    const mount = resolveMount(mountName);
    const insertion = mount?.definition?.insertions?.[slotName];
    const parent = insertion ? mount.nodes[insertion.parent] : null;
    if (!parent || !node) return false;
    if (insertion.mode === "before-last") parent.insertBefore(node, parent.lastElementChild);
    else if (insertion.mode === "prepend") parent.prepend(node);
    else parent.append(node);
    return true;
  };

  const adoptAdjacentPresentation = (mountName, slotName, node) => {
    const mount = resolveMount(mountName);
    const insertion = mount?.definition?.insertions?.[slotName];
    const referenceDefinition = mount?.definition?.nativeReference;
    const parent = insertion ? mount.nodes[insertion.parent] : null;
    if (!parent || !node || referenceDefinition?.slot !== slotName) return null;
    const insertionTarget = insertion.mode === "before-last" ? parent.lastElementChild : null;
    const reference = referenceDefinition.relative === "after"
      ? insertionTarget
      : insertionTarget?.previousElementSibling || parent.lastElementChild;
    if (!reference || reference === node) return null;
    if (referenceDefinition.copyClass === true) node.className = reference.className;
    for (const attribute of referenceDefinition.copyAttributes ?? []) {
      const value = reference.getAttribute(attribute);
      if (value === null) node.removeAttribute(attribute);
      else node.setAttribute(attribute, value);
    }
    const activeClass = mount.definition.presentation?.navigationActiveClass;
    if (activeClass) node.classList.remove(activeClass);
    return reference;
  };

  const reconcileRoles = () => {
    for (const rule of config?.roles ?? []) {
      const nodes = rule.cardinality === "many"
        ? query(document, rule.selectors, true)
        : [query(document, rule.selectors)];
      for (const node of nodes) {
        if (!node) continue;
        markRole(node, rule.role);
      }
    }
  };

  const markRole = (node, role) => {
    if (!node || typeof role !== "string" || !role) return false;
    if (node.getAttribute(roleAttribute) !== role) node.setAttribute(roleAttribute, role);
    ownedRoleNodes.add(node);
    return true;
  };

  const rememberStyle = (binding) => {
    if (previousStyles.has(binding.cssVariable)) return;
    previousStyles.set(binding.cssVariable, {
      value: root.style.getPropertyValue(binding.cssVariable),
      priority: root.style.getPropertyPriority(binding.cssVariable),
    });
  };

  const setStyleValue = (id, value) => {
    const binding = bindings.get(id);
    if (!binding || typeof value !== "string" || !value) return false;
    rememberStyle(binding);
    root.style.setProperty(binding.cssVariable, value);
    return true;
  };

  const clearStyleValue = (id) => {
    const binding = bindings.get(id);
    const previous = binding ? previousStyles.get(binding.cssVariable) : null;
    if (!binding || !previous) return false;
    if (previous.value) root.style.setProperty(binding.cssVariable, previous.value, previous.priority);
    else root.style.removeProperty(binding.cssVariable);
    return true;
  };

  const applyStyleSources = (sources, options = {}) => {
    for (const binding of bindings.values()) {
      const value = Object.hasOwn(binding, "value") ? binding.value : readPath(sources, binding.source);
      if (typeof value === "string" && value) setStyleValue(binding.id, value);
      else if (options.resetMissing === true) clearStyleValue(binding.id);
    }
  };

  const restoreStyles = () => {
    for (const [name, previous] of previousStyles) {
      if (previous.value) root.style.setProperty(name, previous.value, previous.priority);
      else root.style.removeProperty(name);
    }
    previousStyles.clear();
  };

  const cleanupRoles = () => {
    for (const node of ownedRoleNodes) {
      if (node.isConnected) node.removeAttribute(roleAttribute);
    }
    ownedRoleNodes.clear();
  };

  const inspect = () => ({
    matchedHost: matchesHost(),
    localeAuthorityConfigured: Boolean(config?.localeAuthority),
    configuredRoles: config?.roles?.length ?? 0,
    markedRoles: ownedRoleNodes.size,
    configuredStyleBindings: bindings.size,
    appliedStyleBindings: previousStyles.size,
  });

  return {
    matchesHost,
    matchesHostIdentity,
    matchesBootstrapHost,
    readHostLocale,
    anchor,
    select,
    closest,
    resolveMount,
    insert,
    adoptAdjacentPresentation,
    markRole,
    reconcileRoles,
    setStyleValue,
    clearStyleValue,
    applyStyleSources,
    restoreStyles,
    cleanupRoles,
    inspect,
  };
}
