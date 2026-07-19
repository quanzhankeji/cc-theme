import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await fs.readFile(path.join(root, "assets", "theme-settings-session.js"), "utf8");
const createThemeSettingsSession = vm.runInNewContext(source, {
  clearTimeout,
  setTimeout,
  structuredClone,
});

assert.equal(typeof createThemeSettingsSession, "function", "the fixed settings session must evaluate to a factory");
assert.doesNotMatch(source, /\b(?:document|HTMLElement|querySelector|MutationObserver)\b/,
  "the settings session must remain independent from WorkBuddy DOM landmarks");
assert.doesNotMatch(source, /(?:["'](?:selector|css|js|cssText|innerHTML|scriptSource)["']|\.(?:selector|cssText|innerHTML|scriptSource)\b)/i,
  "the settings session must not create a selector, arbitrary CSS, or script channel");

const clone = (value) => structuredClone(value);
const waitUntil = async (predicate, message) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(message);
};

function stateOf(snapshot, key) {
  assert(snapshot && typeof snapshot === "object", "snapshot() must return a bounded state object");
  assert(Object.hasOwn(snapshot, key), `snapshot() is missing ${key}`);
  return clone(snapshot[key]);
}

function createHarness(initialState, overrides = {}) {
  const previews = [];
  const snapshotsInPreview = [];
  const writes = [];
  const statuses = [];
  const disk = { value: clone(initialState) };
  let activeWrites = 0;
  let maximumConcurrentWrites = 0;
  let session;
  session = createThemeSettingsSession({
    initialState: clone(initialState),
    debounceMs: 8,
    validate(next) {
      assert.equal(typeof next.themeId, "string");
      assert(!Object.hasOwn(next, "selector"));
      assert(!Object.hasOwn(next, "css"));
      assert(!Object.hasOwn(next, "js"));
      if (overrides.validate) return clone(overrides.validate(next));
      return clone(next);
    },
    preview(next, context) {
      previews.push({ state: clone(next), context: clone(context ?? null) });
      snapshotsInPreview.push(clone(session?.snapshot?.().draft ?? null));
    },
    async persist(next, context) {
      activeWrites += 1;
      maximumConcurrentWrites = Math.max(maximumConcurrentWrites, activeWrites);
      writes.push({ state: clone(next), context: clone(context ?? null) });
      try {
        if (overrides.persist) await overrides.persist(next, context, disk);
        else disk.value = clone(next);
      } finally {
        activeWrites -= 1;
      }
    },
    status(event) {
      statuses.push(clone(event));
    },
  });
  return { disk, maximumConcurrentWrites: () => maximumConcurrentWrites, previews, session, snapshotsInPreview, statuses, writes };
}

const initial = {
  themeId: "alpha",
  paletteStrategy: "system",
  accent: "#3366ff",
  fontUi: "system-ui",
  panelOpacity: 0.62,
  backgroundMode: "media",
};

// Every accepted control change must preview synchronously and persist without a Save action.
{
  const harness = createHarness(initial);
  const result = harness.session.update({ accent: "#ff3366" });
  assert.equal(harness.previews.at(-1).state.accent, "#ff3366", "color did not preview immediately");
  assert.equal(harness.snapshotsInPreview.at(-1).accent, "#ff3366",
    "a renderer refresh during preview observed the previous draft");
  assert.equal(harness.writes.length, 0, "a high-frequency change persisted before the debounce boundary");
  await harness.session.flush();
  assert.equal(harness.disk.value.accent, "#ff3366");
  assert.equal(stateOf(harness.session.snapshot(), "draft").accent, "#ff3366");
  assert.equal(stateOf(harness.session.snapshot(), "committed").accent, "#ff3366");
  assert.notEqual(result, false, "an accepted update must not report rejection");
  harness.session.dispose();
}

// Synchronous allowlist failures are non-blocking and leave all three states at the last valid value.
{
  const harness = createHarness(initial, {
    validate(next) {
      if (!/^#[0-9a-f]{6}$/i.test(next.accent)) throw new Error("invalid accent");
      return next;
    },
  });
  let result;
  assert.doesNotThrow(() => { result = harness.session.update({ accent: "arbitrary-css" }); },
    "a rejected UI value escaped as an uncaught event-handler exception");
  assert.equal(result, false, "a rejected update must report a bounded failure");
  assert.deepEqual(stateOf(harness.session.snapshot(), "draft"), initial);
  assert.deepEqual(stateOf(harness.session.snapshot(), "committed"), initial);
  assert.deepEqual(harness.disk.value, initial);
  assert(harness.statuses.some((event) => event?.state === "error" || event?.status === "error"),
    "a validation failure must publish a localized non-blocking error state");
  harness.session.dispose();
}

// Rapid input must be serialized and latest-write-wins even when an older disk write is in flight.
{
  let releaseFirst;
  const firstWrite = new Promise((resolve) => { releaseFirst = resolve; });
  let persistCalls = 0;
  const harness = createHarness(initial, {
    async persist(next, _context, disk) {
      persistCalls += 1;
      if (persistCalls === 1) await firstWrite;
      disk.value = clone(next);
    },
  });
  harness.session.update({ panelOpacity: 0.31 });
  const draining = harness.session.flush();
  await waitUntil(() => harness.writes.length === 1, "the first persistence did not start");
  harness.session.update({ panelOpacity: 0.74 });
  assert.equal(harness.previews.at(-1).state.panelOpacity, 0.74);
  releaseFirst();
  await draining;
  await harness.session.flush();
  assert.equal(harness.disk.value.panelOpacity, 0.74, "an older write overwrote the latest input");
  assert.equal(harness.maximumConcurrentWrites(), 1, "settings writes must be serialized");
  assert.ok(harness.writes.length >= 2, "the update made during an in-flight write was lost");
  const revisions = harness.writes.map(({ context }) => context?.revision).filter(Number.isFinite);
  assert.equal(new Set(revisions).size, revisions.length, "persistence revisions must be unique");
  assert.deepEqual(revisions, [...revisions].sort((left, right) => left - right),
    "persistence revisions must increase monotonically");
  harness.session.dispose();
}

// Cross-control edits must converge into one coherent draft instead of resetting sibling values.
{
  const harness = createHarness(initial);
  harness.session.update({ accent: "#00aa88" });
  harness.session.update({ fontUi: "Inter" });
  harness.session.update({ backgroundMode: "ripple" });
  await harness.session.flush();
  assert.equal(harness.disk.value.accent, "#00aa88");
  assert.equal(harness.disk.value.fontUi, "Inter");
  assert.equal(harness.disk.value.backgroundMode, "ripple");
  assert.equal(harness.disk.value.panelOpacity, initial.panelOpacity);
  harness.session.dispose();
}

// Failed validation/persistence must restore renderer, memory, and disk to the last valid state.
{
  let shouldFail = true;
  const harness = createHarness(initial, {
    async persist(next, _context, disk) {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("simulated atomic write failure");
      }
      disk.value = clone(next);
    },
  });
  harness.session.update({ accent: "#ff0000" });
  await harness.session.flush().catch(() => undefined);
  assert.deepEqual(harness.disk.value, initial, "disk changed after a failed write");
  assert.deepEqual(stateOf(harness.session.snapshot(), "draft"), initial, "memory did not roll back");
  assert.deepEqual(stateOf(harness.session.snapshot(), "committed"), initial, "last valid state was corrupted");
  assert.deepEqual(harness.previews.at(-1).state, initial, "renderer preview did not roll back");
  assert(harness.statuses.some((event) => event?.state === "error" || event?.status === "error"),
    "a failed update must publish a non-blocking error status");
  harness.session.dispose();
}

// Theme/palette replacement must settle or cancel prior work and cannot leak the old draft.
{
  const harness = createHarness(initial);
  harness.session.update({ accent: "#f0f000", fontUi: "Old Theme Font" });
  const beta = {
    themeId: "beta",
    paletteStrategy: "adaptive",
    accent: "#112233",
    fontUi: "Beta Font",
    panelOpacity: 0.48,
    backgroundMode: "directional",
  };
  await harness.session.replaceBase(clone(beta));
  assert.deepEqual(stateOf(harness.session.snapshot(), "draft"), beta);
  assert.deepEqual(harness.previews.at(-1).state, beta, "new theme was not projected immediately");
  harness.session.update({ paletteStrategy: "custom", accent: "#abcdef" });
  await harness.session.flush();
  assert.equal(harness.disk.value.themeId, "beta");
  assert.equal(harness.disk.value.paletteStrategy, "custom");
  assert.equal(harness.disk.value.accent, "#abcdef");
  assert.notEqual(harness.disk.value.fontUi, "Old Theme Font", "old theme state contaminated the new theme");
  harness.session.dispose();
}

// A new renderer session and a re-entered Settings view must see the last committed state.
{
  const first = createHarness(initial);
  first.session.update({ accent: "#765432", panelOpacity: 0.81 });
  await first.session.flush();
  const persisted = clone(first.disk.value);
  first.session.dispose();

  const reloaded = createHarness(persisted);
  assert.deepEqual(stateOf(reloaded.session.snapshot(), "draft"), persisted,
    "renderer reload did not start from persisted settings");
  const beforeLeaving = reloaded.session.snapshot();
  await Promise.resolve();
  assert.deepEqual(stateOf(reloaded.session.snapshot(), "draft"), stateOf(beforeLeaving, "draft"),
    "leaving and re-entering Settings reset the current values");
  reloaded.session.dispose();
}

// Disposal cancels pending debounced writes; cleanup owns restoration through the UI Interpreter.
{
  const harness = createHarness(initial);
  harness.session.update({ accent: "#010101" });
  harness.session.dispose();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(harness.writes.length, 0, "a disposed Settings session wrote after pause/restore cleanup");
}

console.log("PASS: CC Theme Settings previews immediately, autosaves with LWW, rolls back atomically, isolates themes, and reloads persisted state.");
