import assert from "node:assert/strict";

import {
  listenerTreeOwned,
  selectSingleNewProcess,
  waitForNewTrustedProcess,
} from "../scripts/lifecycle-process-guard.mjs";

assert.deepEqual(selectSingleNewProcess([10], [
  { pid: 22, ppid: 1, startedAt: "new" },
]), { status: "ready", process: { pid: 22, ppid: 1, startedAt: "new" } });
assert.deepEqual(selectSingleNewProcess([10], [{ pid: 10, ppid: 1, startedAt: "old" }]), { status: "pending" });
assert.equal(selectSingleNewProcess([], [
  { pid: 22, ppid: 1, startedAt: "new-a" },
  { pid: 23, ppid: 1, startedAt: "new-b" },
]).status, "conflict", "a launch request must never accept multiple new main processes");

let probes = 0;
const snapshots = [[], [], [{ pid: 42, ppid: 1, startedAt: "visible" }]];
const waited = await waitForNewTrustedProcess({
  beforePids: [],
  timeoutMs: 1000,
  pollMs: 10,
  listProcesses: async () => snapshots[Math.min(probes++, snapshots.length - 1)],
  sleep: async () => {},
  now: (() => { let value = 0; return () => (value += 10); })(),
});
assert.equal(waited.pid, 42);
assert.equal(probes, 3, "LaunchServices must receive a bounded visibility window before executable fallback");

await assert.rejects(waitForNewTrustedProcess({
  beforePids: [],
  timeoutMs: 30,
  pollMs: 10,
  listProcesses: async () => [],
  sleep: async () => {},
  now: (() => { let value = 0; return () => (value += 10); })(),
}), (error) => error?.code === "launch-process-timeout");

const processTree = [
  { pid: 100, ppid: 1 },
  { pid: 101, ppid: 100 },
  { pid: 102, ppid: 101 },
  { pid: 999, ppid: 1 },
];
assert.equal(listenerTreeOwned(100, [100, 102], processTree), true);
assert.equal(listenerTreeOwned(100, [102, 999], processTree), false,
  "a same-name or unrelated listener must not be accepted");
assert.equal(listenerTreeOwned(100, [], processTree), false);

console.log("PASS: cold-launch visibility and CDP listener ownership are bounded to one trusted process tree.");
