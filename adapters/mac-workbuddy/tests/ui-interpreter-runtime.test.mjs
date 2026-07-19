import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const factorySource = await fs.readFile(path.join(rootPath, "assets", "ui-interpreter.js"), "utf8");
const createUiInterpreter = Function(`return (${factorySource})`)();

const node = (queries = {}) => ({
  attributes: new Map(),
  isConnected: true,
  querySelector(selector) { return queries[selector]?.[0] ?? null; },
  querySelectorAll(selector) { return queries[selector] ?? []; },
  getAttribute(name) { return this.attributes.get(name) ?? null; },
  setAttribute(name, value) { this.attributes.set(name, value); },
  removeAttribute(name) { this.attributes.delete(name); },
});

const roleNode = node();
const helpNode = node();
const navigation = node({ ".item": [helpNode] });
navigation.lastElementChild = helpNode;
navigation.insertBefore = (inserted, before) => { navigation.inserted = { inserted, before }; };
const nativePanel = node();
const content = node({ ":scope > .native": [nativePanel] });
content.append = (inserted) => { content.appended = inserted; };
const modal = node({ ".navigation": [navigation], ".content": [content] });
const document = node({
  ".shell": [roleNode],
  ".modal": [modal],
  ".anchor": [helpNode],
});
document.body = node();
document.body.dataset = { applicationName: "workbuddy", productVersion: "5.2.6" };
document.defaultView = { localStorage: { getItem: (key) => key === "HOST_LOCALE" ? "en-US" : null } };

const styleValues = new Map([["--wbs-background", { value: "native", priority: "important" }]]);
const root = {
  style: {
    getPropertyValue(name) { return styleValues.get(name)?.value ?? ""; },
    getPropertyPriority(name) { return styleValues.get(name)?.priority ?? ""; },
    setProperty(name, value, priority = "") { styleValues.set(name, { value, priority }); },
    removeProperty(name) { styleValues.delete(name); },
  },
};

const config = {
  identity: { bodyDataset: { applicationName: "workbuddy", productVersion: "5.2.6" }, requiredSelectors: [".shell"] },
  localeAuthority: { storageKey: "HOST_LOCALE", bodyAttribute: "lang", defaultLocale: "zh-CN" },
  roles: [{ role: "shell", selectors: [".shell"], cardinality: "one" }],
  anchors: { action: { selectors: [".anchor"], selection: "first" } },
  mounts: {
    settings: {
      nodes: [
        { id: "root", within: "document", selectors: [".modal"], cardinality: "zero-or-one" },
        { id: "navigation", within: "root", selectors: [".navigation"], cardinality: "zero-or-one" },
        { id: "content", within: "root", selectors: [".content"], cardinality: "zero-or-one" },
        { id: "nativePanel", within: "content", selectors: [":scope > .native"], cardinality: "zero-or-one" }
      ],
      insertions: {
        navigationItem: { parent: "navigation", mode: "before-last" },
        ownedPanel: { parent: "content", mode: "append" }
      }
    }
  },
};
const styleCatalog = {
  bindings: [
    { id: "foundation.background", cssVariable: "--wbs-background", source: "palette.background" },
    { id: "interaction.motion", cssVariable: "--wbs-motion-fast", value: "140ms" }
  ],
};

const interpreter = createUiInterpreter({
  document,
  root,
  config,
  styleCatalog,
  roleAttribute: "data-workbuddy-skin-role",
});
assert.equal(interpreter.matchesHost(), true);
assert.equal(interpreter.matchesBootstrapHost(), true);
assert.deepEqual(interpreter.readHostLocale(), { value: "en-US", source: "host-storage" });
interpreter.reconcileRoles();
assert.equal(roleNode.getAttribute("data-workbuddy-skin-role"), "shell");
assert.equal(interpreter.anchor("action"), helpNode);

const ownedNavigation = node();
assert.equal(interpreter.insert("settings", "navigationItem", ownedNavigation), true);
assert.deepEqual(navigation.inserted, { inserted: ownedNavigation, before: helpNode });
const ownedPanel = node();
assert.equal(interpreter.insert("settings", "ownedPanel", ownedPanel), true);
assert.equal(content.appended, ownedPanel);

interpreter.applyStyleSources({ palette: { background: "#123456" } });
assert.equal(styleValues.get("--wbs-background").value, "#123456");
assert.equal(styleValues.get("--wbs-motion-fast").value, "140ms");
interpreter.cleanupRoles();
assert.equal(roleNode.getAttribute("data-workbuddy-skin-role"), null);
interpreter.restoreStyles();
assert.deepEqual(styleValues.get("--wbs-background"), { value: "native", priority: "important" });
assert.equal(styleValues.has("--wbs-motion-fast"), false);

console.log("ui-interpreter-runtime.test.mjs: verified host matching, DOM interpretation, style binding, and restoration");
