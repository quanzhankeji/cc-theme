import assert from "node:assert/strict";
import { projectUnifiedThemeForWorkBuddy } from "../scripts/workbuddy-theme-projection.mjs";
import { normalizeSkinTheme } from "../scripts/skin-theme.mjs";

const profile = (values) => ({
  kind: "cc-theme.target-profile",
  schemaVersion: 1,
  adapterId: "mac-workbuddy",
  values,
});
const unifiedV2 = {
  kind: "cc-theme.unified-theme",
  schemaVersion: 2,
  id: "mapping_contract",
  name: "Mapping Contract",
  version: "2.1.0",
  sharedCore: {
    tokens: {
      colors: {
        surfaceBase: "#101010", surfaceRaised: "#202020", surfaceCode: "#212121",
        text: "#f0f0f0", textStrong: "#ffffff", textMuted: "#a0a0a0", placeholder: "#888888",
        borderDefault: "#303030", borderStrong: "#404040", action: "#5050ff", actionForeground: "#ffffff",
        selectedSurface: "#414141", selectedHoverSurface: "#424242", focusRing: "#7777ff",
        success: "#00aa00", warning: "#ffaa00",
      },
      fonts: { ui: ["system-ui"], display: ["system-ui"], code: ["Menlo", "monospace"] },
      appearance: { shellMode: "dark", backdropBlurPx: 12, radiusScale: 1 },
    },
    background: {
      mode: "media", image: "background.webp", homeHeroImage: "hero.webp", video: "background.mp4",
      posterMode: "image", scrimOpacity: 0.3, position: { xPercent: 44, yPercent: 55 },
    },
    accessibility: {
      reducedMotion: "static", minimumTextContrast: 4.5, preserveSystemFocusRing: true,
      transparencyFallback: "increased-scrim",
    },
  },
  targets: ["mac-workbuddy"],
  targetProfiles: { "mac-workbuddy": profile({ paletteStrategy: "custom" }) },
};

const context = { clientVersion: "5.2.6", surfaceCatalogVersion: 2 };
const projected = await projectUnifiedThemeForWorkBuddy(unifiedV2, context);
assert.equal(projected.applyAllowed, true);
assert.equal(projected.adapterId, "mac-workbuddy");
assert.equal(normalizeSkinTheme(projected.theme).adapter, "mac-workbuddy");
assert.equal(projected.sourceVersion, "2.1.0");
assert.equal(projected.theme.appearance.paletteStrategy, "custom");
assert.equal(projected.theme.appearance.shellMode, undefined,
  "WorkBuddy host effective appearance must remain authoritative");
assert.ok(projected.diagnostics.some((diagnostic) =>
  diagnostic.field === "tokens.appearance.shellMode" &&
  diagnostic.code === "host-shell-mode-authority" &&
  diagnostic.decision === "unsupported"),
"unsupported Shared Core shellMode must produce a visible diagnostic");
assert.equal(projected.theme.semanticColors.surfaceRaised, "#202020",
  "the exact surfaceRaised token must outrank the surfaceCode approximation");
assert.equal(projected.theme.semanticColors.borderDefault, "#303030",
  "the exact borderDefault token must outrank the borderStrong approximation");
assert.equal(projected.theme.semanticColors.selectedSurface, "#414141",
  "the exact selectedSurface token must outrank selectedHoverSurface");
assert.equal(projected.theme.semanticColors.success, undefined);
assert.equal(projected.theme.semanticColors.warning, undefined);
assert.equal(projected.theme.homeHeroImage, undefined);
assert.equal(projected.theme.appearance.backgroundScrimOpacity, 0.3);
assert.equal(projected.runtimeAccessibility.reducedMotion, "static");
assert.doesNotThrow(() => normalizeSkinTheme(projected.theme));
for (const code of [
  "approximated-surface-code", "approximated-border-strong", "approximated-selected-hover",
  "optional-field-unsupported", "home-hero-unsupported", "contrast-audit-unavailable",
  "focus-ring-strategy-approximate", "transparency-preference-unavailable",
]) assert.ok(projected.diagnostics.some((diagnostic) => diagnostic.code === code), `missing visible diagnostic ${code}`);

const reordered = structuredClone(unifiedV2);
reordered.sharedCore.tokens.colors = Object.fromEntries(Object.entries(reordered.sharedCore.tokens.colors).reverse());
reordered.sharedCore.tokens.fonts = Object.fromEntries(Object.entries(reordered.sharedCore.tokens.fonts).reverse());
reordered.targetProfiles["mac-workbuddy"].values = Object.fromEntries(
  Object.entries(reordered.targetProfiles["mac-workbuddy"].values).reverse(),
);
assert.equal(
  JSON.stringify(await projectUnifiedThemeForWorkBuddy(reordered, context)),
  JSON.stringify(projected),
  "semantic input key order must not change projection bytes or diagnostics order",
);

const approximationSource = structuredClone(unifiedV2);
delete approximationSource.sharedCore.tokens.colors.surfaceRaised;
delete approximationSource.sharedCore.tokens.colors.borderDefault;
delete approximationSource.sharedCore.tokens.colors.selectedSurface;
const approximated = await projectUnifiedThemeForWorkBuddy(approximationSource, context);
assert.equal(approximated.theme.semanticColors.surfaceRaised, "#212121");
assert.equal(approximated.theme.semanticColors.borderDefault, "#404040");
assert.equal(approximated.theme.semanticColors.selectedSurface, "#424242");

for (const strategy of ["system", "adaptive", "custom"]) {
  const source = structuredClone(unifiedV2);
  source.targetProfiles["mac-workbuddy"] = profile({ paletteStrategy: strategy });
  const result = await projectUnifiedThemeForWorkBuddy(source, context);
  assert.equal(result.paletteStrategy, strategy);
  if (strategy === "system") assert.ok(result.diagnostics.some((item) => item.code === "system-shared-colors-dormant"));
  if (strategy === "adaptive") assert.ok(result.diagnostics.some((item) => item.code === "adaptive-shared-core-base"));
}

const untargeted = structuredClone(unifiedV2);
untargeted.targets = ["mac-codex"];
delete untargeted.targetProfiles["mac-workbuddy"];
assert.equal((await projectUnifiedThemeForWorkBuddy(untargeted, context)).applyAllowed, false);
assert.equal((await projectUnifiedThemeForWorkBuddy(unifiedV2, { ...context, clientVersion: "5.2.7" })).applyAllowed, false);
await assert.rejects(projectUnifiedThemeForWorkBuddy(unifiedV2, {
  ...context,
  targetProfile: profile({ paletteStrategy: "system", selector: "body" }),
}), /conflicts|unsupported/);
const remote = structuredClone(unifiedV2);
remote.sharedCore.background.image = "https://example.com/background.webp";
await assert.rejects(projectUnifiedThemeForWorkBuddy(remote, context), /local package-root filename/);

const conflictingBackgroundPosition = structuredClone(unifiedV2);
conflictingBackgroundPosition.sharedCore.tokens.appearance.backgroundPosition = { xPercent: 10, yPercent: 20 };
conflictingBackgroundPosition.sharedCore.background.position = { xPercent: 80, yPercent: 90 };
await assert.rejects(
  projectUnifiedThemeForWorkBuddy(conflictingBackgroundPosition, context),
  (error) => error?.code === "conflicting-background-position",
  "conflicting authoritative and legacy background positions must fail closed",
);

const legacyBackgroundPositionOnly = structuredClone(unifiedV2);
legacyBackgroundPositionOnly.sharedCore.tokens.appearance.backgroundPosition = { xPercent: 12, yPercent: 34 };
delete legacyBackgroundPositionOnly.sharedCore.background.position;
const legacyPositionProjection = await projectUnifiedThemeForWorkBuddy(legacyBackgroundPositionOnly, context);
assert.deepEqual(legacyPositionProjection.theme.appearance.backgroundPosition, { xPercent: 12, yPercent: 34 });
assert.ok(legacyPositionProjection.diagnostics.some((diagnostic) =>
  diagnostic.field === "tokens.appearance.backgroundPosition" &&
  diagnostic.code === "legacy-background-position-fallback" &&
  diagnostic.decision === "approximate"),
"legacy background position fallback must remain visible");

const matchingBackgroundPositions = structuredClone(unifiedV2);
matchingBackgroundPositions.sharedCore.tokens.appearance.backgroundPosition =
  structuredClone(matchingBackgroundPositions.sharedCore.background.position);
matchingBackgroundPositions.targetProfiles["mac-workbuddy"] = profile({
  paletteStrategy: "custom",
});
const matchingPositionProjection = await projectUnifiedThemeForWorkBuddy(matchingBackgroundPositions, context);
assert.deepEqual(matchingPositionProjection.theme.appearance.backgroundPosition, { xPercent: 44, yPercent: 55 });
assert.equal(matchingPositionProjection.theme.appearance.backgroundVideoPosition, undefined,
  "video must not retain a second position write path");
await assert.rejects(projectUnifiedThemeForWorkBuddy({
  ...structuredClone(matchingBackgroundPositions),
  targetProfiles: { "mac-workbuddy": profile({ backgroundVideoPosition: { xPercent: 70, yPercent: 71 } }) },
}, context), /unsupported fields: backgroundVideoPosition/);
assert.ok(matchingPositionProjection.diagnostics.some((diagnostic) =>
  diagnostic.field === "tokens.appearance.backgroundPosition" &&
  diagnostic.code === "legacy-background-position-fallback"),
"matching legacy position must still be normalized visibly to background.position");

const legacyV1 = {
  kind: "cc-theme.unified-theme", schemaVersion: 1, id: "legacy", name: "Legacy", version: "1.0.0",
  tokens: {
    colors: { surfaceBase: "#101010", text: "#f0f0f0", textMuted: "#a0a0a0", action: "#5050ff", actionForeground: "#ffffff", focusRing: "#7777ff" },
    fonts: { ui: ["system-ui"] },
  },
  background: { mode: "media", image: "background.webp" },
  accessibility: { reducedMotion: "static" },
  targets: { workbuddy: { adapter: "mac-workbuddy", compatibility: { clientVersion: "5.2.6", policy: "verified-only", surfaceCatalogVersion: 2 } } },
};
const legacy = await projectUnifiedThemeForWorkBuddy(legacyV1);
assert.equal(legacy.applyAllowed, true);
assert.ok(legacy.diagnostics.some((diagnostic) => diagnostic.code === "legacy-compatibility-read"));
const invalidLegacyPolicy = structuredClone(legacyV1);
invalidLegacyPolicy.targets.workbuddy.compatibility.policy = "allow-any";
await assert.rejects(projectUnifiedThemeForWorkBuddy(invalidLegacyPolicy), /compatibility is invalid/);

for (const [field, invalid] of [
  ["minimumTextContrast", "private text"],
  ["minimumLargeTextContrast", 99],
  ["preserveSystemFocusRing", "yes"],
  ["transparencyFallback", "script"],
]) {
  const invalidAccessibility = structuredClone(unifiedV2);
  invalidAccessibility.sharedCore.accessibility[field] = invalid;
  await assert.rejects(projectUnifiedThemeForWorkBuddy(invalidAccessibility, context), /accessibility/,
    `projector accepted invalid accessibility.${field}`);
}

console.log("PASS: WorkBuddy deterministically projects unified v2, backward-reads v1, exposes approximation/unsupported diagnostics, and blocks unsafe or incompatible apply.");
