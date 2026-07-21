import assert from "node:assert/strict";
import test from "node:test";

import { adapterRegistry } from "./support/runtime-interface.mjs";

const { DEFAULT_ADAPTER_REGISTRY, discoverAdapterCapabilities } = adapterRegistry;

test("capability discovery returns the active registered Adapter-owned capabilities", () => {
  const capabilities = discoverAdapterCapabilities(DEFAULT_ADAPTER_REGISTRY);

  assert.deepEqual(
    capabilities.map(({ adapterId }) => adapterId),
    ["mac-codex", "mac-doubao", "mac-workbuddy"],
  );
  assert.deepEqual(
    capabilities.map(({ availability, compileAvailable, runtimeApplyAvailable }) => ({ availability, compileAvailable, runtimeApplyAvailable })),
    [
      { availability: "available", compileAvailable: true, runtimeApplyAvailable: true },
      { availability: "available", compileAvailable: true, runtimeApplyAvailable: true },
      { availability: "available", compileAvailable: true, runtimeApplyAvailable: true },
    ],
  );
  for (const capability of capabilities) assert.ok(capability.sharedCore.length > 0);
  assert.deepEqual(
    [...new Set(capabilities.map(({ projection }) => projection.requestContract))],
    ["cc-theme.adapter-projector-invocation@1"],
  );
  assert.deepEqual(
    [...new Set(capabilities.map(({ projection }) => projection.export))],
    ["projectThemeFamilyAdapter"],
  );

});

test("capabilities explicitly decide accessibility and adapter-specific surfaces", () => {
  const byId = Object.fromEntries(
    discoverAdapterCapabilities(DEFAULT_ADAPTER_REGISTRY).map((entry) => [entry.adapterId, entry]),
  );

  for (const capability of Object.values(byId)) {
    for (const field of [
      "accessibility.reducedMotion",
      "accessibility.minimumTextContrast",
      "accessibility.minimumLargeTextContrast",
      "accessibility.preserveSystemFocusRing",
      "accessibility.transparencyFallback",
    ]) {
      const decision = capability.sharedCore.find(({ sourceToken }) => sourceToken === field);
      assert.ok(decision, `${capability.adapterId}: ${field}`);
      assert.ok(["supported", "approximated", "unsupported"].includes(decision.support));
    }
  }

  const decision = (adapterId, token) => byId[adapterId].sharedCore.find(({ sourceToken }) => sourceToken === token);
  assert.equal(decision("mac-workbuddy", "background.homeHeroImage").support, "unsupported");
  assert.equal(decision("mac-workbuddy", "copy.*").support, "unsupported");

  const workBuddyTargets = new Set(
    byId["mac-workbuddy"].sharedCore
      .filter(({ targetPath, support }) => support !== "unsupported" && targetPath?.startsWith("semanticColors."))
      .map(({ targetPath }) => targetPath.slice("semanticColors.".length)),
  );
  assert.equal(workBuddyTargets.has("surfaceBase"), true);
  assert.equal(workBuddyTargets.has("danger"), true);
  for (const dormant of ["surfaceCode", "borderStrong", "selectedHoverSurface", "success", "warning"]) {
    assert.equal(workBuddyTargets.has(dormant), false, `WorkBuddy must not project dormant semantic token ${dormant}`);
  }

  for (const token of ["tokens.fonts.ui", "tokens.fonts.display", "tokens.fonts.code"]) {
    assert.equal(decision("mac-doubao", token).support, "unsupported", token);
  }
  for (const token of [
    "tokens.colors.surfaceElevated", "tokens.colors.surfaceCode", "tokens.colors.borderStrong",
    "tokens.colors.actionHover", "tokens.colors.actionPressed", "tokens.colors.composerSurface",
    "tokens.appearance.radiusScale", "tokens.appearance.shellMode",
  ]) {
    assert.equal(decision("mac-doubao", token).support, "unsupported", token);
  }
  for (const token of ["tokens.colors.text", "tokens.colors.action", "tokens.colors.actionForeground", "tokens.colors.focusRing"]) {
    assert.equal(decision("mac-doubao", token).support, "approximated", token);
  }
  assert.equal(decision("mac-doubao", "background.video").support, "supported");
  assert.equal(decision("mac-doubao", "background.mode.ripple").support, "approximated");
  assert.equal(decision("mac-doubao", "background.mode.directional").support, "approximated");
});
