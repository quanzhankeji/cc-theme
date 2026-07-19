import test from "node:test";
import assert from "node:assert/strict";
import { SettingsSession } from "../src/settings-session.mjs";

const initial = { revision: 0, values: { "color.action": "#AA3377" } };

test("settings preview immediately and debounce to the latest revision with no save action", async () => {
  const previews = [];
  const persisted = [];
  const session = new SettingsSession({
    initialState: initial,
    preview: (state) => previews.push(state),
    persist: async (state) => persisted.push(state),
    rollback: async () => {},
    debounceMs: 5,
  });
  session.update("color.action", "#BB4488");
  session.update("color.action", "#CC5599");
  assert.equal(previews.length, 2);
  assert.equal(previews.at(-1).values["color.action"], "#CC5599");
  await session.flush();
  assert.equal(persisted.at(-1).revision, 2);
  assert.equal(persisted.at(-1).values["color.action"], "#CC5599");
  assert.equal(session.snapshot().committed.revision, 2);
});

test("persist failure rolls controls, renderer and state back to the last valid revision", async () => {
  const previews = [];
  const rollbacks = [];
  const session = new SettingsSession({
    initialState: initial,
    preview: (state) => previews.push(state),
    persist: async () => { throw new Error("disk-failed"); },
    rollback: async (state) => rollbacks.push(state),
    debounceMs: 5,
  });
  session.update("color.action", "#FFFFFF");
  await assert.rejects(() => session.flush(), /settings-persist-failed/);
  assert.equal(session.snapshot().current.revision, 0);
  assert.equal(session.snapshot().current.values["color.action"], "#AA3377");
  assert.equal(session.snapshot().revision, 1);
  assert.equal(previews.at(-1).revision, 0);
  assert.equal(rollbacks.length, 1);
  assert.equal(session.update("color.action", "#EEEEEE").revision, 2);
});

test("late writes cannot overwrite a newer revision", async () => {
  const persisted = [];
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const session = new SettingsSession({
    initialState: initial,
    preview: () => {},
    persist: async (state) => {
      calls += 1;
      if (calls === 1) await firstBlocked;
      persisted.push(state);
    },
    rollback: async () => {},
    debounceMs: 0,
  });
  session.update("color.action", "#111111");
  await new Promise((resolve) => setTimeout(resolve, 1));
  session.update("color.action", "#222222");
  releaseFirst();
  await session.flush();
  assert.equal(persisted.at(-1).revision, 2);
  assert.equal(persisted.at(-1).values["color.action"], "#222222");
  assert.equal(session.snapshot().committed.revision, 2);
});

test("preview failure restores state, invokes rollback, and never reuses the failed revision", async () => {
  const rollbacks = [];
  let shouldFail = true;
  const session = new SettingsSession({
    initialState: initial,
    preview: () => { if (shouldFail) throw new Error("renderer-failed"); },
    persist: async () => {},
    rollback: async (state) => rollbacks.push(state),
  });
  assert.throws(() => session.update("color.action", "#FFFFFF"), /settings-preview-failed/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(session.snapshot().current.revision, 0);
  assert.equal(session.snapshot().revision, 1);
  assert.equal(rollbacks.length, 1);
  shouldFail = false;
  assert.equal(session.update("color.action", "#EEEEEE").revision, 2);
});

test("runtime override values reject CSS, HTML, URL and unsupported tokens", () => {
  const session = new SettingsSession({
    initialState: initial,
    preview: () => {},
    persist: async () => {},
    rollback: async () => {},
  });
  assert.throws(() => session.update("font.ui", ["url(evil)"]), /theme-executable-value-forbidden/);
  assert.throws(() => session.update("color.action", "javascript:evil"), /theme-executable-value-forbidden/);
  assert.throws(() => session.update("selector.root", "#root"), /settings-token-unsupported/);
});
