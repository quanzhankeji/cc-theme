import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_ADAPTER_IDS,
  capabilityFor,
  discoverAdapterCapabilities,
} from "../adapter-registry.mjs";

test("Adapter Registry exposes canonical identities without protocol aliases", () => {
  const capabilities = discoverAdapterCapabilities();
  const aliasField = ["legacy", "Aliases"].join("");
  assert.deepEqual(capabilities.map(({ adapterId }) => adapterId), CANONICAL_ADAPTER_IDS);
  for (const capability of capabilities) {
    assert.equal(Object.hasOwn(capability, aliasField), false, capability.adapterId);
    assert.equal(capabilityFor(capability.adapterId).adapterId, capability.adapterId);
  }
  const retired = ["codex", "claude", "workbuddy"].map((client) => ["mac", client, "skin"].join("-"));
  for (const adapterId of [...retired, "codex", "claude", "workbuddy"]) {
    assert.throws(() => capabilityFor(adapterId), /Unknown adapter capability/);
  }
});
