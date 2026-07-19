const HASH = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-z][A-Za-z0-9.-]{0,119}$/;

function validEntries(entries) {
  if (!Array.isArray(entries)) throw new Error("Local Runtime Override entries must be an array");
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || !TOKEN.test(entry.tokenId) || !HASH.test(entry.baseHash) || !Object.hasOwn(entry, "value")) {
      throw new Error(`Local Runtime Override entry ${index} is invalid`);
    }
    return structuredClone(entry);
  });
}

export function planLocalRuntimeOverrideReplay({ capability, entries, adapterDecisions }) {
  if (!capability?.localRuntimeOverrides) throw new Error("Adapter capability has no Local Runtime Override declaration");
  const values = validEntries(entries);
  const knownTokens = new Set(capability.localRuntimeOverrides.stableTokenIds ?? []);
  const decisions = new Map((adapterDecisions ?? []).map((decision) => [decision.tokenId, decision]));
  const plan = { status: "ready", preserved: [], replay: [], quarantined: [] };
  if (!capability.localRuntimeOverrides.serialTransactionSeamAvailable) {
    plan.status = "blocked";
    plan.quarantined = values.map((entry) => ({ ...entry, reasonCode: "transaction-seam-unavailable" }));
    return plan;
  }
  for (const entry of values) {
    if (!knownTokens.has(entry.tokenId)) {
      plan.quarantined.push({ ...entry, reasonCode: "unknown-stable-token" });
      continue;
    }
    const decision = decisions.get(entry.tokenId);
    if (!decision) {
      plan.quarantined.push({ ...entry, reasonCode: "adapter-rebase-decision-required" });
      continue;
    }
    if (!HASH.test(decision.nextBaseHash ?? "")) {
      plan.quarantined.push({ ...entry, reasonCode: "invalid-next-base-hash", diagnostic: decision.diagnostic });
      continue;
    }
    if (decision.status === "preserve" && decision.nextBaseHash === entry.baseHash) {
      plan.preserved.push({ ...entry, diagnostic: decision.diagnostic });
    } else if (decision.status === "replay") {
      plan.replay.push({ ...entry, baseHash: decision.nextBaseHash, diagnostic: decision.diagnostic });
    } else {
      plan.quarantined.push({ ...entry, reasonCode: "adapter-marked-incompatible", diagnostic: decision.diagnostic });
    }
  }
  if (plan.quarantined.length) plan.status = plan.preserved.length || plan.replay.length ? "partial" : "partial";
  return plan;
}
