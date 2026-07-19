import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createClaudeLocaleRuntime } from "../scripts/claude-locale-runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.resolve(here, "../assets/renderer-inject.js");
let source = await fs.readFile(rendererPath, "utf8");

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.attrs = new Map();
    this.children = [];
    this.dataset = {};
    this.className = "";
    this.isConnected = true;
    const properties = new Map();
    this.style = {
      getPropertyValue: (name) => properties.get(name) ?? "",
      setProperty: (name, value) => properties.set(name, String(value)),
      removeProperty: (name) => properties.delete(name),
    };
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
    };
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); if (name === "id") this.id = String(value); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(child) { this.children.push(child); child.parentElement = this; register(child); return child; }
  remove() { this.isConnected = false; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  contains() { return false; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; }
}

const nodes = new Map();
function register(node) { if (node.id) nodes.set(node.id, node); }
const root = new FakeElement("html");
const head = new FakeElement("head");
const body = new FakeElement("body");
const canvasPixels = (width, height) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const left = x < width * 0.42;
      const bright = (x + y) % 2 === 0;
      const color = left ? [18, 18, 18] : bright ? [240, 50, 45] : [245, 238, 220];
      data.set([...color, 255], offset);
    }
  }
  return data;
};

const document = {
  documentElement: root,
  head,
  body,
  hidden: false,
  getElementById: (id) => nodes.get(id) ?? null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  createElement(tagName) {
    if (tagName === "canvas") {
      const canvas = new FakeElement("canvas");
      canvas.getContext = () => ({
        drawImage() {},
        getImageData: () => ({ data: canvasPixels(canvas.width, canvas.height) }),
      });
      return canvas;
    }
    return new FakeElement(tagName);
  },
  createElementNS(_namespace, tagName) { return new FakeElement(tagName); },
};

class FakeImage {
  constructor() { this.naturalWidth = 2000; this.naturalHeight = 1000; }
  set src(_value) { queueMicrotask(() => this.onload?.()); }
}
class FakeMutationObserver { observe() {} disconnect() {} }
const media = { matches: false, addEventListener() {}, removeEventListener() {} };
const window = {
  Image: FakeImage,
  matchMedia: () => media,
  addEventListener() {},
  removeEventListener() {},
};

const theme = {
  id: "analysis-test",
  themeBridgeEnabled: true,
  shellMode: "dark",
  artKey: "analysis-test-art",
  artMetadata: { width: 2000, height: 1000, ratio: 2, wide: true, aspect: "wide", taskMode: "ambient" },
  art: { analysis: "auto", safeArea: "auto", taskMode: "auto", paletteMode: "media", adaptivePalette: true },
  appearance: { backgroundPositionExplicit: false, backgroundVideoPosterMode: "none" },
  colors: {},
  explicitColorKeys: [],
};
source = source
  .replace("__SKIN_CSS_JSON__", JSON.stringify("html{}"))
  .replace("__SKIN_ART_JSON__", JSON.stringify("data:image/png;base64,AA=="))
  .replace("__SKIN_HERO_ART_JSON__", "null")
  .replace("__SKIN_VIDEO_JSON__", "null")
  .replace("__SKIN_MOTION_FALLBACK_JSON__", "null")
  .replace("__SKIN_INTERACTIVE_ATLAS_JSON__", "null")
  .replace("__SKIN_BACKGROUND_EFFECT_FACTORY__", "(() => { throw new Error('unused'); })")
  .replace("__SKIN_THEME_JSON__", JSON.stringify(theme))
  .replace("__THEME_STYLE_CATALOG_JSON__", JSON.stringify({ groups: [], tokens: [] }))
  .replace("__THEME_EDITOR_LOCALES_JSON__", JSON.stringify({ defaultLocale: "en-US", locales: ["en-US"], messages: {}, groupLabels: {}, tokenLabels: {} }))
  .replace("__CLAUDE_LOCALE_CATALOG_JSON__", JSON.stringify({
    defaultLocale: "en-US",
    locales: ["en-US"],
    aliases: {},
    directions: { "en-US": "ltr" },
    fallback: { maximumDiagnosticLocaleLength: 35 },
  }))
  .replace("__CLAUDE_UI_ADAPTER_JSON__", JSON.stringify({}))
  .replace("__CLAUDE_UI_INTERPRETER_FACTORY__", `(() => ({
    select: () => null,
    resolveComposer: () => null,
    resolveSettingsMount: () => ({ dialog: null, nav: null, desktopList: null, generalButton: null, nativeContent: null }),
    reconcileRoles: () => ({ composer: null, settings: { dialog: null } }),
    cleanup() {},
  }))`)
  .replace("__CLAUDE_LOCALE_RUNTIME_FACTORY__", createClaudeLocaleRuntime.toString())
  .replace("__THEME_STYLE_OVERRIDES_JSON__", JSON.stringify({}))
  .replace("__THEME_RUNTIME_PREFERENCES_JSON__", JSON.stringify({}))
  .replace("__THEME_STYLE_OVERRIDE_STATE_JSON__", JSON.stringify({ status: "absent", diagnosticCode: null, quarantinedTokenCount: 0 }))
  .replace("__THEME_STYLE_EDITOR_NONCE_JSON__", JSON.stringify("test-nonce"))
  .replace("__THEME_STYLE_EDITOR_BINDING_JSON__", JSON.stringify("__unusedStyleEditorBinding"))
  .replace("__SKIN_VERSION_JSON__", JSON.stringify("test"))
  .replace("__SKIN_STYLE_REVISION_JSON__", JSON.stringify("style-test"));

const context = {
  window,
  document,
  Element: FakeElement,
  MutationObserver: FakeMutationObserver,
  Blob,
  URL: { createObjectURL: () => "blob:analysis", revokeObjectURL() {} },
  atob: (value) => Buffer.from(value, "base64").toString("binary"),
  setTimeout,
  clearTimeout,
  setInterval: () => 1,
  clearInterval() {},
  queueMicrotask,
  getComputedStyle: () => ({
    colorScheme: "dark",
    backgroundColor: "rgb(10, 10, 10)",
    display: "block",
    visibility: "visible",
    cursor: "default",
    borderTopWidth: "0",
  }),
  CSS: { escape: (value) => value },
  innerWidth: 1600,
  innerHeight: 1000,
  console,
};
vm.runInNewContext(source, context);
await new Promise((resolve) => setTimeout(resolve, 260));

assert.equal(root.getAttribute("data-skin-art-ready"), "true");
assert.equal(root.getAttribute("data-skin-art-safe"), "left");
assert.equal(root.getAttribute("data-skin-art-aspect"), "wide");
assert.match(root.style.getPropertyValue("--skin-art-position"), /%/);
assert.notEqual(root.style.getPropertyValue("--skin-green"), "#7cff46");
assert.match(root.style.getPropertyValue("--skin-panel"), /^rgba\(/);
assert.equal(window.__CC_THEME_STATE__.artAnalysis.safeArea, "left");

console.log("PASS: explicitly selected media mode infers focus, safe area, aspect, and a translucent adaptive palette.");
