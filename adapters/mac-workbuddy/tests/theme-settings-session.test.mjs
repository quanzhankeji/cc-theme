import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const factorySource = await fs.readFile(path.join(root, "assets", "theme-settings-session.js"), "utf8");
const create = vm.runInNewContext(factorySource, { structuredClone, setTimeout, clearTimeout, AbortController });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const previews = [];
const writes = [];
let fail = false;
const session = create({
  initialState: { color: "#111111", opacity: 0.4 },
  validate(value) {
    assert.match(value.color, /^#[0-9a-f]{6}$/i);
    assert(value.opacity >= 0 && value.opacity <= 1);
    return value;
  },
  preview(value, metadata) { previews.push({ value, metadata }); },
  async persist(value, metadata) {
    await wait(12);
    if (fail) throw new Error("disk rejected");
    writes.push({ value, metadata });
    return { state: value };
  },
  debounceMs: 8,
});

session.update("color", "#222222");
assert.equal(previews.at(-1).value.color, "#222222", "preview must be synchronous");
session.update("color", "#333333");
session.update("opacity", 0.7);
await session.flush();
assert.equal(writes.length, 1, "rapid inputs must coalesce");
assert.deepEqual(writes[0].value, { color: "#333333", opacity: 0.7 });
assert.deepEqual(session.snapshot().committed, { color: "#333333", opacity: 0.7 });

session.update("color", "#444444", { immediate: true });
session.update("color", "#555555");
await session.flush();
assert.deepEqual(writes.at(-1).value, { color: "#555555", opacity: 0.7 });
assert.deepEqual(session.snapshot().committed, { color: "#555555", opacity: 0.7 });

fail = true;
session.update("opacity", 0.9);
await session.flush();
assert.deepEqual(session.snapshot().draft, { color: "#555555", opacity: 0.7 });
assert.equal(previews.at(-1).metadata.reason, "rollback");

fail = false;
await session.replaceBase({ color: "#abcdef", opacity: 0.2 });
assert.deepEqual(session.snapshot().draft, { color: "#abcdef", opacity: 0.2 });
session.update("opacity", 0.3);
session.dispose();
await wait(20);
assert.equal(session.snapshot().disposed, true);
assert.equal(writes.at(-1).value.color, "#555555", "dispose must cancel a pending cross-theme write");

console.log("PASS: WYSIWYG settings preview synchronously, persist with debounce and latest-write-wins, rollback failures, and isolate theme replacement.");
