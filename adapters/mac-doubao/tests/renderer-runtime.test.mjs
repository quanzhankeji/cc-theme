import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { runtimeVerificationPass, transferDeferredVideo } from "../scripts/injector.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8");
const skinCss = await fs.readFile(path.join(root, "assets", "skin.css"), "utf8");
const surfaceCatalog = JSON.parse(await fs.readFile(
  path.join(root, "compatibility", "doubao-macos", "2.19.9", "ui-surface-catalog.json"),
  "utf8",
));
const createRuntime = vm.runInNewContext(`(${source})`);

test("verified structural surfaces expose the theme media without taking control paint ownership", () => {
  assert.match(skinCss, /data-cc-theme-doubao-role="main-surface"/);
  assert.match(skinCss, /data-cc-theme-doubao-role="sidebar-inner"/);
  assert.match(skinCss, /data-cc-theme-doubao-role="header-surface"/);
  assert.doesNotMatch(skinCss, /\[data-cc-theme-doubao-role="composer"\] > div:first-child/);
  assert.doesNotMatch(skinCss, /\[data-cc-theme-doubao-role="composer"\]::after/);
});

test("adaptive and system palettes preserve native icons, type, interaction states, and overlays", () => {
  assert.doesNotMatch(skinCss, /:where\(#chat-route-main\) \*/);
  assert.doesNotMatch(skinCss, /:where\(#flow_chat_sidebar\) \*/);
  assert.doesNotMatch(skinCss, /:where\(svg, path\)/);
  assert.doesNotMatch(skinCss, /fill:\s*currentColor\s*!important/);
  assert.doesNotMatch(skinCss, /stroke:\s*currentColor\s*!important/);
  assert.doesNotMatch(skinCss, /\[data-cc-theme-doubao-role="create-action"\][\s\S]*?>\s*:first-child\s*>\s*svg/);
  assert.doesNotMatch(skinCss, /\[data-cc-theme-doubao-role="overlay-surface"\]\s*\{/);
  assert.doesNotMatch(skinCss, /transition:\s*color 140ms/);
});

test("host light and dark appearances own coherent native text and control palettes", () => {
  assert.match(skinCss, /data-cc-theme-doubao-appearance="light"/);
  assert.match(skinCss, /data-cc-theme-doubao-appearance="dark"/);
  assert.doesNotMatch(skinCss, /data-cc-theme-doubao-palette-strategy="custom"/);
  assert.match(skinCss, /palette-strategy="adaptive"[\s\S]*?color-mix\(in srgb,[^;]*--cc-doubao-theme-sidebar-surface/);
  assert.match(skinCss, /palette-strategy="adaptive"[\s\S]*?color-mix\(in srgb,[^;]*--cc-doubao-theme-header-surface/);
  assert.doesNotMatch(skinCss, /--dbx-/);
  assert.doesNotMatch(skinCss, /--s-color-/);
  assert.doesNotMatch(skinCss, /html\[data-cc-theme-doubao-version\],\s*html\[data-cc-theme-doubao-version\] body\s*\{[^}]*color:/);
  assert.doesNotMatch(skinCss, /font-family:\s*var\(--cc-doubao-font-(?:ui|display|code)\)/);
});

test("composer, suggestions, and focus indicators remain native-owned", () => {
  assert.doesNotMatch(skinCss, /\[data-cc-theme-doubao-role="composer"\][^{]*\{[^}]*box-shadow:/);
  assert.doesNotMatch(skinCss, /\[data-cc-theme-doubao-role="composer"\]:focus-within/);
  assert.doesNotMatch(skinCss, /\[data-cc-theme-doubao-role="composer-input"\][^{]*\{[^}]*caret-color:/);
  assert.doesNotMatch(skinCss, /\[data-cc-theme-doubao-role="suggestion"\][^{]*\{[^}]*border:/);
  assert.doesNotMatch(skinCss, /\[data-cc-theme-doubao-role="suggestion"\][^{]*\{[^}]*backdrop-filter:/);
  assert.doesNotMatch(skinCss, /:focus-visible\s*\{/);
  assert.match(skinCss, /data-cc-theme-doubao-role="content-link"/);
  assert.doesNotMatch(skinCss, /html\[data-cc-theme-doubao-version\]\s+a\s*\{/);
});

test("home greeting reveal mask stays native but cannot overflow onto the themed canvas", () => {
  const rule = skinCss.match(
    /html\[data-cc-theme-doubao-version\]\s+\[data-cc-theme-doubao-role="home-title"\]\s*\{([^}]*)\}/,
  );
  assert.ok(rule, "the themed home-title boundary must be explicit");
  assert.match(rule[1], /overflow:\s*clip\s*!important/);
  assert.doesNotMatch(rule[1], /animation|transform|opacity|display/);
  assert.doesNotMatch(
    skinCss,
    /\[data-cc-theme-doubao-role="home-title"\]::(?:before|after)/,
    "the Adapter must not replace Doubao's native greeting animation",
  );
});

test("surface evidence records the native greeting animation with bounded overflow", () => {
  assert.ok(surfaceCatalog.surface.verifiedConsumers.includes(
    "native-home-greeting-reveal-motion-with-bounded-mask",
  ));
});

function element(tagName = "div") {
  const attributes = new Map();
  const children = [];
  const properties = new Map();
  return {
    tagName: tagName.toUpperCase(),
    id: "",
    attributes,
    children,
    parentNode: null,
    textContent: "",
    muted: false,
    defaultMuted: false,
    loop: false,
    playsInline: false,
    autoplay: false,
    preload: "",
    paused: true,
    readyState: tagName.toLowerCase() === "video" ? 4 : 0,
    currentTime: 0,
    src: "",
    error: null,
    style: {
      backgroundImage: "",
      backgroundPosition: "",
      getPropertyValue(name) { return properties.get(name)?.value ?? ""; },
      getPropertyPriority(name) { return properties.get(name)?.priority ?? ""; },
      setProperty(name, value, priority = "") { properties.set(name, { value, priority }); },
      removeProperty(name) { properties.delete(name); },
    },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    append(node) { node.parentNode = this; children.push(node); },
    prepend(node) { node.parentNode = this; children.unshift(node); },
    querySelector(selector) {
      if (selector === "video") return children.find((node) => node.tagName === "VIDEO") ?? null;
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
    play() { this.paused = false; this.currentTime = 0.2; return Promise.resolve(); },
    pause() { this.paused = true; },
    load() {},
    remove() {
      if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    },
  };
}

function fixture() {
  const html = element("html");
  const head = element("head");
  const body = element("body");
  const shell = element();
  const sidebar = element("nav");
  const composer = element();
  const right = element("aside");
  const ids = new Map();
  const selectors = new Map([
    ['[data-testid="chat-route-layout"]', shell],
    ['[data-testid="chat_route_layout_leftside_nav"]', sidebar],
    ['[data-testid="chat_input"]', composer],
    ['[data-testid="samantha_layout_right_side"]', right],
  ]);
  const document = {
    documentElement: html,
    head,
    body,
    hidden: false,
    createElement: element,
    getElementById(id) { return ids.get(id) ?? null; },
    querySelector(selector) {
      const value = selectors.get(selector);
      return Array.isArray(value) ? value[0] ?? null : value ?? null;
    },
    querySelectorAll(selector) {
      const value = selectors.get(selector);
      if (Array.isArray(value)) return value;
      return value ? [value] : [];
    },
  };
  const originalAppend = head.append.bind(head);
  head.append = (node) => { if (node.id) ids.set(node.id, node); originalAppend(node); };
  const originalPrepend = body.prepend.bind(body);
  body.prepend = (node) => { if (node.id) ids.set(node.id, node); originalPrepend(node); };
  for (const node of [shell, sidebar, composer, right]) node.setAttribute("data-native", "preserved");
  return { document, html, head, body, shell, sidebar, composer, right, ids, selectors };
}

test("fixed Doubao runtime applies owned roles and fully restores them", () => {
  const view = fixture();
  view.html.style.setProperty("--cc-doubao-text", "native", "important");
  const runtime = createRuntime({
    document: view.document,
    location: { protocol: "chrome:", host: "doubao-chat" },
  });

  const applied = runtime.apply({
    version: "2.19.9-r1",
    generation: "0123456789abcdef",
    documentIdentity: "c".repeat(64),
    styleText: "[data-cc-theme-doubao-role] { color: var(--cc-doubao-text); }",
    variables: { "--cc-doubao-text": "#E9EEF7", "--cc-doubao-panel": "rgba(16, 21, 31, .8)" },
    backgroundUrl: "data:image/webp;base64,UklGRg==",
    backgroundPosition: "50% 50%",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(applied)), {
    applied: true,
    roles: 4,
    version: "2.19.9-r1",
    generation: "0123456789abcdef",
    lifecycle: {
      observer: false,
      reconcileTimer: false,
      reconcileInterval: false,
      visibilityListener: false,
      reducedMotionListener: false,
      videoFrameCallback: false,
      objectUrlCount: 0,
    },
    documentIdentity: "c".repeat(64),
    hostAppearance: "light",
    appearance: "light",
    paletteStrategy: "system",
  });
  assert.equal(view.sidebar.getAttribute("data-cc-theme-doubao-role"), "sidebar");
  assert.equal(view.composer.getAttribute("data-cc-theme-doubao-role"), "composer");
  assert.equal(view.html.style.getPropertyValue("--cc-doubao-text"), "#E9EEF7");
  assert.equal(view.html.getAttribute("data-cc-theme-doubao-generation"), "0123456789abcdef");
  assert.equal(view.html.getAttribute("data-cc-theme-doubao-host-appearance"), "light");
  assert.equal(view.html.getAttribute("data-cc-theme-doubao-appearance"), "light");
  assert.equal(view.html.getAttribute("data-cc-theme-doubao-palette-strategy"), "system");
  assert.equal(view.ids.get("cc-theme-doubao-style").getAttribute("data-cc-theme-doubao-generation"), "0123456789abcdef");
  assert.equal(view.ids.get("cc-theme-doubao-background").getAttribute("data-cc-theme-doubao-generation"), "0123456789abcdef");
  assert.equal(view.ids.get("cc-theme-doubao-background").style.backgroundPosition, "50% 50%");

  assert.throws(() => runtime.apply({ version: "invalid" }), /payload is invalid/);
  assert.equal(runtime.inspect().generation, "0123456789abcdef");
  assert.equal(view.ids.get("cc-theme-doubao-background").parentNode, view.body);

  const removed = runtime.remove();
  assert.deepEqual(JSON.parse(JSON.stringify(removed)), {
    applied: false,
    roles: 0,
    version: null,
    generation: null,
    lifecycle: {
      observer: false,
      reconcileTimer: false,
      reconcileInterval: false,
      visibilityListener: false,
      reducedMotionListener: false,
      videoFrameCallback: false,
      objectUrlCount: 0,
    },
  });
  assert.equal(view.sidebar.getAttribute("data-cc-theme-doubao-role"), null);
  assert.equal(view.sidebar.getAttribute("data-native"), "preserved");
  assert.deepEqual(view.html.style.getPropertyValue("--cc-doubao-text"), "native");
  assert.equal(view.html.style.getPropertyPriority("--cc-doubao-text"), "important");
  assert.equal(view.html.getAttribute("data-cc-theme-doubao-generation"), null);
  assert.equal(view.html.getAttribute("data-cc-theme-doubao-host-appearance"), null);
  assert.equal(view.html.getAttribute("data-cc-theme-doubao-appearance"), null);
  assert.equal(view.html.getAttribute("data-cc-theme-doubao-palette-strategy"), null);
  assert.equal(view.ids.get("cc-theme-doubao-background").parentNode, null);
});

test("deferred video source reaches playing state and is fully disposed", async () => {
  const view = fixture();
  const revoked = [];
  const runtime = createRuntime({
    document: view.document,
    location: { protocol: "chrome:", host: "doubao-chat" },
    URL: { revokeObjectURL(value) { revoked.push(value); } },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
  });

  const applied = runtime.apply({
    version: "2.19.9-r2",
    generation: "fedcba9876543210",
    documentIdentity: "d".repeat(64),
    styleText: "#cc-theme-doubao-background-video { object-fit: cover; }",
    variables: { "--cc-doubao-text": "#E9EEF7" },
    backgroundUrl: "data:image/webp;base64,UklGRg==",
    backgroundPosition: "50% 50%",
    videoExpected: true,
    videoPosterMode: "image",
    videoScrimOpacity: 0.34,
    videoPosition: "40% 60%",
  });
  assert.equal(applied.videoPlaybackState, "loading");

  const playing = await runtime.setVideoSource("blob:doubao-video", "fedcba9876543210");
  const layer = view.ids.get("cc-theme-doubao-background");
  const video = layer.querySelector("video");
  assert.equal(playing.videoPlaybackState, "playing");
  assert.equal(playing.videoFrameReady, true);
  assert.equal(video.muted, true);
  assert.equal(video.defaultMuted, true);
  assert.equal(video.loop, true);
  assert.equal(video.playsInline, true);
  assert.equal(video.style.backgroundPosition, "");
  assert.equal(video.style.objectPosition, "40% 60%");

  runtime.remove();
  assert.equal(video.paused, true);
  assert.deepEqual(revoked, ["blob:doubao-video"]);
  assert.equal(layer.parentNode, null);
});

test("removal cancels a pending decoded-frame callback without reviving stale video state", async () => {
  const view = fixture();
  let video;
  let cancelledFrame = null;
  let clearedTimer = null;
  let markFrameRequested;
  const frameRequested = new Promise((resolve) => { markFrameRequested = resolve; });
  const createElement = view.document.createElement;
  view.document.createElement = (tagName) => {
    const node = createElement(tagName);
    if (tagName === "video") {
      video = node;
      node.requestVideoFrameCallback = () => { markFrameRequested(); return 73; };
      node.cancelVideoFrameCallback = (id) => { cancelledFrame = id; };
    }
    return node;
  };
  const runtime = createRuntime({
    document: view.document,
    location: { protocol: "chrome:", host: "doubao-chat" },
    URL: { revokeObjectURL() {} },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    setTimeout() { return 91; },
    clearTimeout(id) { clearedTimer = id; },
    setInterval() { return 92; },
    clearInterval() {},
  });
  runtime.apply({
    version: "2.19.9-r2",
    generation: "abababababababab",
    documentIdentity: "9".repeat(64),
    styleText: "#cc-theme-doubao-background-video { object-fit: cover; }",
    variables: { "--cc-doubao-text": "#E9EEF7" },
    backgroundUrl: "data:image/webp;base64,UklGRg==",
    backgroundPosition: "50% 50%",
    videoExpected: true,
    videoPosterMode: "image",
    videoScrimOpacity: 0.2,
    videoPosition: "50% 50%",
  });

  const pending = runtime.setVideoSource("blob:pending-video", "abababababababab");
  await frameRequested;
  runtime.remove();
  const settled = await pending;

  assert.equal(video.paused, true);
  assert.equal(cancelledFrame, 73);
  assert.equal(clearedTimer, 91);
  assert.equal(settled.applied, false);
  assert.equal(runtime.inspect().videoPlaybackState, undefined);
});

test("deferred video transfer commits one generation-bound renderer Blob", async () => {
  const view = fixture();
  const runtime = createRuntime({
    document: view.document,
    location: { protocol: "chrome:", host: "doubao-chat" },
    URL: globalThis.URL,
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
  });
  runtime.apply({
    version: "2.19.9-r2",
    generation: "1234567890abcdef",
    documentIdentity: "e".repeat(64),
    styleText: "#cc-theme-doubao-background-video { object-fit: cover; }",
    variables: { "--cc-doubao-text": "#E9EEF7" },
    backgroundUrl: "data:image/webp;base64,UklGRg==",
    backgroundPosition: "50% 50%",
    videoExpected: true,
    videoPosterMode: "image",
    videoScrimOpacity: 0.2,
    videoPosition: "50% 50%",
  });
  const context = vm.createContext({ Blob, URL, Uint8Array, atob });
  context.__CC_THEME_DOUBAO_RUNTIME__ = runtime;
  const session = {
    evaluate(expression) { return Promise.resolve(vm.runInContext(expression, context)); },
    documentIdentity() { return Promise.resolve("e".repeat(64)); },
  };
  const bytes = Buffer.from("000000186674797069736f6d0000000069736f6d6d703432", "hex");

  const transferred = await transferDeferredVideo(session, {
    bytes,
    mimeType: "video/mp4",
  }, { generation: "1234567890abcdef", documentIdentity: "e".repeat(64) });

  assert.deepEqual(transferred, { transferred: true, bytes: bytes.length });
  assert.equal(runtime.inspect().videoPlaybackState, "playing");
  runtime.remove();
});

test("deferred video transfer cannot commit after its runtime generation is removed", async () => {
  const view = fixture();
  const runtime = createRuntime({
    document: view.document,
    location: { protocol: "chrome:", host: "doubao-chat" },
    URL: globalThis.URL,
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
  });
  runtime.apply({
    version: "2.19.9-r2",
    generation: "aaaaaaaaaaaaaaaa",
    documentIdentity: "f".repeat(64),
    styleText: "#cc-theme-doubao-background-video { object-fit: cover; }",
    variables: { "--cc-doubao-text": "#E9EEF7" },
    backgroundUrl: "data:image/webp;base64,UklGRg==",
    backgroundPosition: "50% 50%",
    videoExpected: true,
    videoPosterMode: "image",
    videoScrimOpacity: 0.2,
    videoPosition: "50% 50%",
  });
  const context = vm.createContext({ Blob, URL, Uint8Array, atob });
  context.__CC_THEME_DOUBAO_RUNTIME__ = runtime;
  let evaluations = 0;
  const session = {
    documentIdentity() { return Promise.resolve("f".repeat(64)); },
    async evaluate(expression) {
      const result = await vm.runInContext(expression, context);
      evaluations += 1;
      if (evaluations === 2) runtime.remove();
      return result;
    },
  };
  const bytes = Buffer.from("000000186674797069736f6d0000000069736f6d6d703432", "hex");

  await assert.rejects(
    () => transferDeferredVideo(session, { bytes, mimeType: "video/mp4" }, {
      generation: "aaaaaaaaaaaaaaaa", documentIdentity: "f".repeat(64),
    }),
    /rejected|superseded/i,
  );
  assert.equal(context.__CC_THEME_DOUBAO_VIDEO_TRANSFER__, undefined);
});

test("surface reconciliation marks new route and portal roles without leaking observers", () => {
  const view = fixture();
  let observerCallback = null;
  let disconnected = false;
  class MutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  }
  const runtime = createRuntime({
    document: view.document,
    location: { protocol: "chrome:", host: "doubao-chat" },
    MutationObserver,
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
  });
  runtime.apply({
    version: "2.19.9-r2",
    generation: "bbbbbbbbbbbbbbbb",
    documentIdentity: "1".repeat(64),
    styleText: "[data-cc-theme-doubao-role] { color: var(--cc-doubao-text); }",
    variables: { "--cc-doubao-text": "#E9EEF7" },
    backgroundUrl: "data:image/webp;base64,UklGRg==",
    backgroundPosition: "50% 50%",
  });
  const userMessage = element();
  const assistantMessage = element();
  const overlay = element();
  const homeTitle = element();
  const unlabelledComposerButton = element("button");
  const activeSidebarItem = element("a");
  const contentLink = element("a");
  activeSidebarItem.className = "chat-row e2e-test-active";
  view.selectors.set('[data-testid="send_message"]', [userMessage]);
  view.selectors.set('[data-testid="receive_message"]', [assistantMessage]);
  view.selectors.set(':is([role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"], [role="status"], [role="alert"])', [overlay]);
  view.selectors.set('[data-testid="flow_chat_guidance_page"] > div:first-child > div:nth-child(2)', [homeTitle]);
  view.selectors.set(':is([data-testid="upload_file_button"], [data-testid^="skill_bar_button_"], [data-testid="asr_btn"], [data-testid="chat_input"] button)', [unlabelledComposerButton]);
  view.selectors.set('[data-testid="chat_list_thread_item"]', [activeSidebarItem]);
  view.selectors.set(':is([data-testid="receive_message"] a, [data-testid="ref-content-wrapper"] a, [data-testid="doc_card"] a)', [contentLink]);

  observerCallback([{ type: "childList" }]);

  assert.equal(userMessage.getAttribute("data-cc-theme-doubao-role"), "user-message");
  assert.equal(assistantMessage.getAttribute("data-cc-theme-doubao-role"), "assistant-message");
  assert.equal(overlay.getAttribute("data-cc-theme-doubao-role"), "overlay-surface");
  assert.equal(homeTitle.getAttribute("data-cc-theme-doubao-role"), "home-title");
  assert.equal(unlabelledComposerButton.getAttribute("data-cc-theme-doubao-role"), "composer-action");
  assert.equal(activeSidebarItem.getAttribute("data-cc-theme-doubao-state"), "selected");
  assert.equal(contentLink.getAttribute("data-cc-theme-doubao-role"), "content-link");
  assert.equal(runtime.inspect().roles, 11);
  runtime.remove();
  assert.equal(userMessage.getAttribute("data-cc-theme-doubao-role"), null);
  assert.equal(assistantMessage.getAttribute("data-cc-theme-doubao-role"), null);
  assert.equal(overlay.getAttribute("data-cc-theme-doubao-role"), null);
  assert.equal(homeTitle.getAttribute("data-cc-theme-doubao-role"), null);
  assert.equal(unlabelledComposerButton.getAttribute("data-cc-theme-doubao-role"), null);
  assert.equal(activeSidebarItem.getAttribute("data-cc-theme-doubao-state"), null);
  assert.equal(contentLink.getAttribute("data-cc-theme-doubao-role"), null);
  assert.equal(disconnected, true);
});

test("host appearance changes reconcile without replacing the runtime generation", () => {
  const view = fixture();
  view.html.setAttribute("data-theme", "light");
  let observerCallback = null;
  class MutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    disconnect() {}
  }
  const runtime = createRuntime({
    document: view.document,
    location: { protocol: "chrome:", host: "doubao-chat" },
    MutationObserver,
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
  });
  runtime.apply({
    version: "2.19.9-r2",
    generation: "cdcdcdcdcdcdcdcd",
    documentIdentity: "8".repeat(64),
    styleText: "[data-cc-theme-doubao-role] { color: var(--cc-doubao-text); }",
    variables: { "--cc-doubao-text": "#E9EEF7" },
    backgroundUrl: "data:image/webp;base64,UklGRg==",
    backgroundPosition: "50% 50%",
  });
  assert.equal(runtime.inspect().appearance, "light");

  view.html.setAttribute("data-theme", "dark");
  observerCallback([{ type: "attributes", attributeName: "data-theme" }]);

  assert.equal(runtime.inspect().appearance, "dark");
  assert.equal(runtime.inspect().generation, "cdcdcdcdcdcdcdcd");
  assert.equal(view.html.getAttribute("data-cc-theme-doubao-host-appearance"), "dark");
  runtime.remove();
});

test("runtime verification requires an actual decoded frame while honoring explicit motion fallback", () => {
  const state = {
    applied: true,
    generation: "0123456789abcdef",
    styleGeneration: "0123456789abcdef",
    backgroundGeneration: "0123456789abcdef",
    documentIdentity: "a".repeat(64),
    roles: 12,
    styleCount: 1,
    backgroundCount: 1,
    ownedVariables: 30,
    videoExpected: true,
    videoCount: 1,
    videoScrimCount: 1,
    videoSourceReady: true,
    videoErrorCode: 0,
    videoReadyState: 4,
    videoPlaybackState: "loading",
    videoFrameReady: false,
    documentHidden: false,
    videoAttributes: { muted: true, defaultMuted: true, loop: true, playsInline: true },
  };
  assert.equal(runtimeVerificationPass(state), false);
  assert.equal(runtimeVerificationPass({ ...state, videoPlaybackState: "playing", videoFrameReady: true }), true);
  assert.equal(runtimeVerificationPass({ ...state, videoPlaybackState: "reduced-motion" }), true);
  assert.equal(runtimeVerificationPass({ ...state, videoPlaybackState: "error", videoErrorCode: 4 }), false);
});
