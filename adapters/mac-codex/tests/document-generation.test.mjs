import assert from "node:assert/strict";

import { createDocumentGenerationCoordinator } from "../scripts/document-generation.mjs";

const coordinator = createDocumentGenerationCoordinator();
let runs = 0;
let releaseShared;
const sharedWork = new Promise((resolve) => { releaseShared = resolve; });
const first = coordinator.run({ documentId: "frame-a:loader-a", generation: "runtime-1:theme-1" }, async ({ guard }) => {
  runs += 1;
  await sharedWork;
  guard();
  return "shared";
});
const duplicate = coordinator.run({ documentId: "frame-a:loader-a", generation: "runtime-1:theme-1" }, async () => {
  runs += 1;
  return "duplicate";
});
assert.equal(first, duplicate, "the same document/generation must share one in-flight operation");
releaseShared();
assert.deepEqual(await first, { status: "committed", value: "shared" });
assert.equal(runs, 1);
assert.deepEqual(await coordinator.run(
  { documentId: "frame-a:loader-a", generation: "runtime-1:theme-1" },
  async () => { runs += 1; return "late-duplicate"; },
), { status: "already-committed", value: "shared" });
assert.equal(runs, 1, "a later load event must not retransmit media for an already committed document/generation");

const commits = [];
let releaseOld;
const oldBarrier = new Promise((resolve) => { releaseOld = resolve; });
const old = coordinator.run({ documentId: "frame-a:loader-a", generation: "runtime-1:theme-2" }, async ({ guard }) => {
  await oldBarrier;
  guard();
  commits.push("old");
  return "old";
});
const newest = coordinator.run({ documentId: "frame-a:loader-a", generation: "runtime-1:theme-3" }, async ({ guard }) => {
  guard();
  commits.push("new");
  return "new";
});
assert.deepEqual(await newest, { status: "committed", value: "new" });
releaseOld();
assert.deepEqual(await old, { status: "superseded" });
assert.deepEqual(commits, ["new"], "an older generation must never commit after a newer generation");

let releaseOldDocument;
const oldDocumentBarrier = new Promise((resolve) => { releaseOldDocument = resolve; });
const oldDocument = coordinator.run({ documentId: "frame-a:loader-a", generation: "runtime-1:theme-4" }, async ({ guard }) => {
  await oldDocumentBarrier;
  guard();
  return "old-document";
});
const newDocument = coordinator.run({ documentId: "frame-a:loader-b", generation: "runtime-1:theme-4" }, async ({ guard }) => {
  guard();
  return "new-document";
});
assert.deepEqual(await newDocument, { status: "committed", value: "new-document" });
releaseOldDocument();
assert.deepEqual(await oldDocument, { status: "superseded" },
  "navigation must invalidate work for the prior document");

let releaseCleanup;
const cleanupBarrier = new Promise((resolve) => { releaseCleanup = resolve; });
const cleaning = coordinator.run({ documentId: "frame-a:loader-b", generation: "runtime-1:theme-5" }, async ({ guard }) => {
  await cleanupBarrier;
  guard();
  return "late";
});
coordinator.cancel();
releaseCleanup();
assert.deepEqual(await cleaning, { status: "superseded" });
assert.equal(coordinator.current(), null);

console.log("PASS: renderer work is single-flight per document/generation and stale generations cannot commit.");
