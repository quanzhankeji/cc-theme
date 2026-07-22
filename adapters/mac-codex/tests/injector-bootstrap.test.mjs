import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { earlyPayloadFor } from "../scripts/injector.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const injectorPath = path.resolve(here, "../scripts/injector.mjs");
const source = await fs.readFile(injectorPath, "utf8");

function createFixture() {
  const observers = [];
  const timers = new Map();
  let nextTimer = 1;
  const markers = { shell: false, sidebar: false };
  const context = {
    window: { installs: [] },
    document: {
      documentElement: {},
      querySelector(selector) {
        if (selector === "[data-app-shell-main-content-layout], main.main-surface") return markers.shell ? {} : null;
        if (selector === ".app-shell-left-panel") return markers.sidebar ? {} : null;
        return null;
      },
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.connected = true; observers.push(this); }
      observe() {}
      disconnect() { this.connected = false; }
    },
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  return { context, markers, observers };
}

const guarded = createFixture();
vm.runInNewContext(earlyPayloadFor('window.installs.push("guarded")', "guarded"), guarded.context);
assert.deepEqual(guarded.context.window.installs, []);
guarded.markers.shell = true;
guarded.observers[0].callback([]);
assert.deepEqual(guarded.context.window.installs, [], "A shell without the Codex sidebar must remain untouched.");

const generations = createFixture();
vm.runInNewContext(earlyPayloadFor('window.installs.push("old")', "old"), generations.context);
vm.runInNewContext(earlyPayloadFor('window.installs.push("new")', "new"), generations.context);
generations.markers.shell = true;
generations.markers.sidebar = true;
for (const observer of generations.observers) observer.callback([]);
assert.deepEqual(generations.context.window.installs, ["new"]);
assert.equal(generations.context.window.__CC_THEME_EARLY_APPLIED__, "new");

const nonceGeneration = createFixture();
nonceGeneration.markers.shell = true;
nonceGeneration.markers.sidebar = true;
vm.runInNewContext(earlyPayloadFor('window.installs.push("session-a")', "same-revision:nonce-a"), nonceGeneration.context);
vm.runInNewContext(earlyPayloadFor('window.installs.push("session-b")', "same-revision:nonce-b"), nonceGeneration.context);
assert.deepEqual(nonceGeneration.context.window.installs, ["session-a", "session-b"],
  "A new editor nonce must force reinjection even when Theme content revision is unchanged.");
assert.equal(nonceGeneration.context.window.__CC_THEME_EARLY_APPLIED__, "same-revision:nonce-b");

const discoveryStart = source.indexOf("record.earlyScriptId = await registerEarly");
const probeStart = source.indexOf("const probe = await waitForCodexProbe", discoveryStart);
assert.ok(discoveryStart >= 0 && probeStart > discoveryStart);
assert.match(source, /Page\.addScriptToEvaluateOnNewDocument/);
assert.match(source, /Page\.removeScriptToEvaluateOnNewDocument/);
assert.match(source, /createDocumentGenerationReconciler\(\{/);
assert.match(source, /if \(existing\) \{[\s\S]*await runSessionGeneration\(existing, current\)/,
  "Target polling must reconcile the current document instead of relying only on Page.loadEventFired.");
assert.match(source, /const payloadGenerationFor = \(loaded\) => `\$\{loaded\.revision\}:\$\{loaded\.editorNonce\}`/);
assert.match(source, /const generationFor = \(loaded\) => `\$\{options\.runtimeGeneration\}:\$\{payloadGenerationFor\(loaded\)\}`/);
assert.match(source, /\[data-app-shell-main-content-layout\], main\.main-surface/,
  "Current structural shell evidence must precede the retained class fallback.");
assert.match(source, /sidebar: Boolean\(document\.querySelector\('\.app-shell-left-panel'\)\)/,
  "Renderer discovery must not require the current sidebar to be an aside element.");
assert.match(source, /semanticStyleEvidence\.pass/,
  "Runtime verification must gate success on semantic style consumption.");
assert.match(source, /semantic-host-alias-mismatch/);
assert.match(source, /semantic-display-consumer-mismatch/);
assert.match(source, /semantic-surface-consumer-mismatch/);
assert.match(source, /semantic-background-position-mismatch/);
assert.match(source, /const nativeMovingBackgroundHomePass = \(result\.videoEnabled \|\| result\.interactiveEnabled\)/,
  "Moving backgrounds must verify native Home geometry without imposing a demo card count.");
assert.doesNotMatch(source, /result\.visibleCardCount === 4/,
  "Current Home verification must not retain the removed four-demo-card assumption.");
assert.match(source,
  /const cardsHomePass = result\.newTaskLayout === 'cards' && result\.homePresent &&\s*result\.heading\?\.visible && result\.composer\?\.visible && !result\.hero/,
  "The static cards profile must verify stable Home geometry even when the host renders zero suggestion cards.");

const css = await fs.readFile(path.resolve(here, "../assets/skin.css"), "utf8");
assert.doesNotMatch(css, /aside\.app-shell-left-panel/,
  "Current sidebar paint must support the non-aside host element.");
assert.match(css,
  /\[data-app-shell-main-content-layout\][^{]*:where\(h1, h2, h3, \[role="heading"\]\)[^{]*\{[^}]*color: var\(--skin-text-strong\)/s,
  "Visible host headings must consume Shared Core strong text without changing native metrics.");
assert.match(css,
  /\[data-skin-role="home-heading"\][^{]*\{[^}]*font-family: var\(--skin-font-display\)/s,
  "The verified Home display surface must consume the Shared Core display font.");

console.log("PASS: early injection and semantic verification use current structural evidence.");
