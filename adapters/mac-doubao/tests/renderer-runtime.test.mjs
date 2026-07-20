import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8");
const skinCss = await fs.readFile(path.join(root, "assets", "skin.css"), "utf8");
const createRuntime = vm.runInNewContext(`(${source})`);

test("verified inner Doubao surfaces cannot cover the owned theme paint", () => {
  assert.match(skinCss, /#chat-route-main > main/);
  assert.match(skinCss, /#flow_chat_sidebar/);
  assert.match(skinCss, /\[data-cc-theme-doubao-role="composer"\] > div:first-child/);
  assert.match(skinCss, /\[data-testid="onboarding_sug_item"\]/);
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
    createElement: element,
    getElementById(id) { return ids.get(id) ?? null; },
    querySelector(selector) { return selectors.get(selector) ?? null; },
  };
  const originalAppend = head.append.bind(head);
  head.append = (node) => { if (node.id) ids.set(node.id, node); originalAppend(node); };
  const originalPrepend = body.prepend.bind(body);
  body.prepend = (node) => { if (node.id) ids.set(node.id, node); originalPrepend(node); };
  for (const node of [shell, sidebar, composer, right]) node.setAttribute("data-native", "preserved");
  return { document, html, head, body, shell, sidebar, composer, right, ids };
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
  });
  assert.equal(view.sidebar.getAttribute("data-cc-theme-doubao-role"), "sidebar");
  assert.equal(view.composer.getAttribute("data-cc-theme-doubao-role"), "composer");
  assert.equal(view.html.style.getPropertyValue("--cc-doubao-text"), "#E9EEF7");
  assert.equal(view.html.getAttribute("data-cc-theme-doubao-generation"), "0123456789abcdef");
  assert.equal(view.ids.get("cc-theme-doubao-style").getAttribute("data-cc-theme-doubao-generation"), "0123456789abcdef");
  assert.equal(view.ids.get("cc-theme-doubao-background").getAttribute("data-cc-theme-doubao-generation"), "0123456789abcdef");
  assert.equal(view.ids.get("cc-theme-doubao-background").style.backgroundPosition, "50% 50%");

  const removed = runtime.remove();
  assert.deepEqual(JSON.parse(JSON.stringify(removed)), { applied: false, roles: 0, version: null, generation: null });
  assert.equal(view.sidebar.getAttribute("data-cc-theme-doubao-role"), null);
  assert.equal(view.sidebar.getAttribute("data-native"), "preserved");
  assert.deepEqual(view.html.style.getPropertyValue("--cc-doubao-text"), "native");
  assert.equal(view.html.style.getPropertyPriority("--cc-doubao-text"), "important");
  assert.equal(view.html.getAttribute("data-cc-theme-doubao-generation"), null);
  assert.equal(view.ids.get("cc-theme-doubao-background").parentNode, null);
});
