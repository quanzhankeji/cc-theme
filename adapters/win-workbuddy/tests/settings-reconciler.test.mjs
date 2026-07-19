import test from "node:test";
import assert from "node:assert/strict";
import { SettingsReconciler, settingsStateFingerprint } from "../src/settings-reconciler.mjs";

function scheduler() {
  const queue = [];
  return {
    schedule: (callback) => queue.push(callback),
    drain: () => { while (queue.length) queue.shift()(); },
    size: () => queue.length,
  };
}

test("same stable Settings state causes zero DOM writes and no reschedule", () => {
  const desired = { locale: "zh-CN", selected: true, themeId: "xtxg" };
  let actual = structuredClone(desired);
  let writes = 0;
  const tasks = scheduler();
  const reconciler = new SettingsReconciler({
    inspect: () => actual,
    reconcile: () => { writes += 1; return { changed: true, writeCount: 1 }; },
    schedule: tasks.schedule,
  });
  assert.equal(reconciler.setDesired(desired).scheduled, true);
  tasks.drain();
  assert.equal(writes, 0);
  assert.equal(reconciler.snapshot().totalWrites, 0);
  assert.equal(reconciler.setDesired({ themeId: "xtxg", selected: true, locale: "zh-CN" }).scheduled, false);
  assert.equal(tasks.size(), 0);
});

test("MutationObserver re-entry coalesces and converges within the pass limit", () => {
  let actual = { row: false, panel: false };
  const tasks = scheduler();
  let reconciler;
  reconciler = new SettingsReconciler({
    inspect: () => actual,
    reconcile: (desired) => {
      if (!actual.row) actual = { ...actual, row: true };
      else actual = structuredClone(desired);
      reconciler.notifyMutation();
      reconciler.notifyMutation();
      return { changed: true, writeCount: 1 };
    },
    schedule: tasks.schedule,
    maxPasses: 4,
  });
  reconciler.setDesired({ row: true, panel: true });
  tasks.drain();
  assert.deepEqual(actual, { row: true, panel: true });
  assert.equal(reconciler.snapshot().totalWrites, 2);
  assert.equal(reconciler.snapshot().lastPassCount, 3);
  assert.equal(tasks.size(), 0);
});

test("non-converging observer loop fails closed after a bounded number of passes", () => {
  let actual = { parity: 0 };
  const tasks = scheduler();
  const reconciler = new SettingsReconciler({
    inspect: () => actual,
    reconcile: () => {
      actual = { parity: actual.parity === 0 ? 1 : 0 };
      return { changed: true, writeCount: 1 };
    },
    schedule: tasks.schedule,
    maxPasses: 3,
  });
  reconciler.setDesired({ parity: 2 });
  assert.throws(() => tasks.drain(), /settings-reconciler-did-not-converge/);
  assert.equal(reconciler.snapshot().lastPassCount, 3);
  assert.equal(reconciler.snapshot().totalWrites, 3);
});

test("Settings fingerprint is deterministic across object key order", () => {
  assert.equal(
    settingsStateFingerprint({ b: [2, 1], a: { y: true, x: false } }),
    settingsStateFingerprint({ a: { x: false, y: true }, b: [2, 1] }),
  );
});
