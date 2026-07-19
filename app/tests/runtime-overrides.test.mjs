import assert from "node:assert/strict";
import test from "node:test";

import { adapterRegistry, runtimeOverrides } from "./support/runtime-interface.mjs";

const { DEFAULT_ADAPTER_REGISTRY, capabilityFor } = adapterRegistry;
const { planLocalRuntimeOverrideReplay } = runtimeOverrides;

const OLD_HASH = "a".repeat(64);
const NEW_HASH = "b".repeat(64);

test("Adapter decisions explicitly preserve, replay, or quarantine stable-token overrides", () => {
  const cases = [
    ["mac-codex", "preserve", OLD_HASH, "preserved"],
    ["mac-workbuddy", "replay", NEW_HASH, "replay"],
  ];
  for (const [adapterId, status, nextBaseHash, bucket] of cases) {
    const capability = capabilityFor(adapterId, DEFAULT_ADAPTER_REGISTRY);
    const tokenId = capability.localRuntimeOverrides.stableTokenIds[0];
    assert.equal(typeof tokenId, "string", `${adapterId} must publish stable token ids`);
    const plan = planLocalRuntimeOverrideReplay({
      capability,
      entries: [{ tokenId, baseHash: OLD_HASH, value: "#112233" }],
      adapterDecisions: [{ tokenId, status, nextBaseHash, diagnostic: `adapter-${status}` }],
    });
    assert.equal(plan[bucket].length, 1, adapterId);
    assert.equal(plan[bucket][0].tokenId, tokenId);
    if (status === "replay") assert.equal(plan.replay[0].baseHash, NEW_HASH);
  }
});

test("Manager quarantines changed-base overrides without an Adapter decision and blocks a missing transaction Seam", () => {
  const capability = capabilityFor("mac-codex", DEFAULT_ADAPTER_REGISTRY);
  const tokenId = capability.localRuntimeOverrides.stableTokenIds[0];
  const undecided = planLocalRuntimeOverrideReplay({
    capability,
    entries: [{ tokenId, baseHash: OLD_HASH, value: "#112233" }],
    adapterDecisions: [],
  });
  assert.equal(undecided.status, "partial");
  assert.equal(undecided.quarantined[0].reasonCode, "adapter-rebase-decision-required");

  const unavailable = structuredClone(capability);
  unavailable.localRuntimeOverrides.serialTransactionSeamAvailable = false;
  const blocked = planLocalRuntimeOverrideReplay({
    capability: unavailable,
    entries: [{ tokenId, baseHash: OLD_HASH, value: "#112233" }],
    adapterDecisions: [{ tokenId, status: "preserve", nextBaseHash: OLD_HASH }],
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.quarantined[0].reasonCode, "transaction-seam-unavailable");
});
