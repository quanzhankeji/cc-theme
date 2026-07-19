import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectUnifiedTheme } from "../src/projector.mjs";

const fixture = JSON.parse(readFileSync(new URL("fixtures/unified-theme.json", import.meta.url), "utf8"));
const clone = (value) => structuredClone(value);

test("projection is deterministic and emits visible unsupported/approximate diagnostics", () => {
  const first = projectUnifiedTheme(clone(fixture));
  const second = projectUnifiedTheme(clone(fixture));
  assert.deepEqual(first, second);
  assert.equal(first.runtimeApplyAvailable, false);
  assert.equal(first.artifact.adapterId, "win-workbuddy-skin");
  assert.equal(first.artifact.appearance.paletteStrategy, "custom");
  assert.equal(first.artifact.colors.success, "#55CC88");
  assert.equal(first.artifact.background.mode, "directional");
  assert.deepEqual(first.artifact.background.position, { xPercent: 60, yPercent: 40 });
  assert.equal("homeHeroImage" in first.artifact.background, false);
  assert.ok(first.diagnostics.some((entry) => entry.source === "background.homeHeroImage" && entry.decision === "unsupported"));
  assert.ok(first.diagnostics.some((entry) => entry.source === "accessibility.preserveSystemFocusRing" && entry.decision === "approximate"));
});

test("system, adaptive, and custom remain explicit Target Profile strategies", () => {
  for (const strategy of ["system", "adaptive", "custom"]) {
    const input = clone(fixture);
    input.targetProfiles["win-workbuddy-skin"].values.paletteStrategy = strategy;
    const result = projectUnifiedTheme(input);
    assert.equal(result.artifact.appearance.paletteStrategy, strategy);
    assert.equal(result.artifact.colors.surfaceBase, "#111111");
    assert.ok(result.diagnostics.some((entry) => entry.source === "targetProfile.paletteStrategy"));
  }
});

test("media and ripple fields project without silent loss", () => {
  const media = clone(fixture);
  media.sharedCore.background = {
    mode: "media", image: "poster.png", video: "loop.mp4", posterMode: "image",
    scrimOpacity: 0.25, position: { xPercent: 40, yPercent: 60 },
  };
  const mediaResult = projectUnifiedTheme(media);
  assert.equal(mediaResult.artifact.background.video, "loop.mp4");
  assert.equal(mediaResult.artifact.background.posterMode, "image");

  const ripple = clone(fixture);
  ripple.sharedCore.background = {
    mode: "ripple", image: "ripple.png", intensity: 0.4, radiusPx: 24,
    quality: "auto", scrimOpacity: 0.1, position: { xPercent: 50, yPercent: 50 },
  };
  const rippleResult = projectUnifiedTheme(ripple);
  assert.equal(rippleResult.artifact.background.intensity, 0.4);
  assert.equal(rippleResult.artifact.background.radiusPx, 24);
  assert.equal(rippleResult.artifact.background.quality, "auto");
});

test("unknown Shared Core and Target Profile fields fail closed", () => {
  const unknownCore = clone(fixture);
  unknownCore.sharedCore.tokens.colors.secretCss = "#FFFFFF";
  assert.throws(() => projectUnifiedTheme(unknownCore), /theme-executable-field-forbidden/);

  const unknownProfile = clone(fixture);
  unknownProfile.targetProfiles["win-workbuddy-skin"].values.selector = "#root";
  assert.throws(() => projectUnifiedTheme(unknownProfile), /theme-executable-field-forbidden/);

  const unknownRoot = clone(fixture);
  unknownRoot.sharedCore.command = "whoami";
  assert.throws(() => projectUnifiedTheme(unknownRoot), /theme-executable-field-forbidden/);

  const unknownTop = clone(fixture);
  unknownTop.css = "body{}";
  assert.throws(() => projectUnifiedTheme(unknownTop), /theme-executable-field-forbidden/);

  const unknownProfileRoot = clone(fixture);
  unknownProfileRoot.targetProfiles["win-workbuddy-skin"].html = "<div>";
  assert.throws(() => projectUnifiedTheme(unknownProfileRoot), /theme-executable-field-forbidden/);

  const foreignTargetPayload = clone(fixture);
  foreignTargetPayload.targets.push("javascript:alert");
  assert.throws(() => projectUnifiedTheme(foreignTargetPayload), /theme-executable-value-forbidden/);

  const foreignProfilePayload = clone(fixture);
  foreignProfilePayload.targetProfiles["other-adapter"] = { css: "body{}", path: "C:\\temp" };
  assert.throws(() => projectUnifiedTheme(foreignProfilePayload), /theme-executable-field-forbidden/);
});
