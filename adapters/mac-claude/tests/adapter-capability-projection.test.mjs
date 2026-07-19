import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectUnifiedTheme } from "../scripts/project-unified-theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capability = JSON.parse(await fs.readFile(path.join(root, "contracts", "adapter-capability.json"), "utf8"));
const styleCatalog = JSON.parse(await fs.readFile(path.join(root, "contracts", "theme-style-catalog.json"), "utf8"));
const requestSchema = JSON.parse(await fs.readFile(path.join(root, "contracts", "adapter-projection-request.schema.json"), "utf8"));
assert.equal(capability.kind, "cc-theme.adapter-capability");
assert.equal(capability.adapterId, "mac-claude");
assert.equal(capability.availability.status, "projection-only");
assert.equal(capability.availability.runtimeApplyAvailable, false);
assert.equal(capability.availability.managerApplyAllowed, false);
assert.equal(capability.availability.managerSelectionScope, "adapter-local");
assert.equal(capability.availability.managerApplyAllowed, capability.availability.runtimeApplyAvailable);
assert(capability.availability.runtimeApplyUpgradeEvidenceRequired.length >= 5);
assert.equal(capability.availability.deepSettingsAvailable, false);
assert.equal(capability.compatibility.themeCarriesVersionFacts, false);
for (const field of ["colors", "semanticColors", "fonts", "appearance", "accessibility"]) {
  assert.equal(requestSchema.properties.sharedCore.properties[field].additionalProperties, false,
    `Projection Request Schema leaves sharedCore.${field} open`);
}
assert.equal(capability.targetProfile.fields.includes("art.adaptivePalette"), false);
assert.deepEqual(
  [...capability.targetProfile.fields].sort(),
  capability.targetProfile.decisions.map((item) => item.path).sort(),
);
for (const pathValue of [
  "identity.id", "identity.name", "background.image", "background.mode",
  "accessibility.reducedMotion", "accessibility.increasedContrast",
]) assert(capability.sharedCoreDecisions.some((item) => item.path === pathValue));
assert(capability.sharedCoreDecisions.some((item) => item.decision === "approximated"));
assert(capability.sharedCoreDecisions.some((item) => item.decision === "unsupported"));
assert.deepEqual(
  [...capability.localRuntimeOverrides.editableTokenIds].sort(),
  styleCatalog.tokens.map((token) => token.id).sort(),
);

const request = {
  kind: "cc-theme.adapter-projection-request",
  schemaVersion: 1,
  adapterId: "mac-claude",
  capabilityVersion: "1.0.0",
  sharedCore: {
    identity: { id: "consensus", name: "Consensus" },
    colors: { text: "#112233" },
    semanticColors: { composerSurface: "rgba(1, 2, 3, 0.8)" },
    fonts: { ui: ["system-ui", "sans-serif"] },
    appearance: { shellMode: "auto", backdropBlurPx: 20, radiusScale: 1.1 },
    background: { mode: "ripple", image: "background.png", heroImage: "hero.png" },
    accessibility: { reducedMotion: "system", increasedContrast: true },
  },
  targetProfiles: {
    "mac-claude": {
      art: { paletteMode: "system" },
      appearance: { backgroundPosition: { xPercent: 62, yPercent: 45 } },
      effects: { ripple: { intensity: 0.3, radiusPx: 24, quality: "auto", scrimOpacity: 0.16 } },
    },
  },
};
const projected = await projectUnifiedTheme(request, { capability });
assert.equal(projected.pass, true);
assert.equal(projected.runtimeApplyAvailable, false);
assert.equal(capability.availability.managerApplyAllowed && projected.runtimeApplyAvailable, false);
assert.equal(projected.skinTheme.id, "consensus");
assert.equal(projected.skinTheme.interactiveBackground.type, "ripple");
assert.equal(projected.skinTheme.homeHeroImage, undefined);
assert(projected.diagnostics.some((item) => item.code === "approximate-owned-radius-only"));
assert(projected.diagnostics.some((item) => item.code === "unsupported-separate-home-hero-surface"));
assert(projected.diagnostics.some((item) => item.code === "unsupported-increased-contrast-projection"));
assert(projected.diagnostics.some((item) => item.code === "runtime-apply-unavailable"));

const forbidden = await projectUnifiedTheme({
  ...request,
  sharedCore: { ...request.sharedCore, accessibility: { forceMotion: true } },
}, { capability });
assert.equal(forbidden.pass, false);
assert(forbidden.diagnostics.some((item) => item.code === "unsupported-accessibility-override" && item.severity === "error"));

const arbitraryProfile = await projectUnifiedTheme({
  ...request,
  targetProfiles: { "mac-claude": { arbitrary: { selector: "body" } } },
}, { capability });
assert.equal(arbitraryProfile.pass, false);

const unsafeIgnoredField = await projectUnifiedTheme({
  ...request,
  sharedCore: { ...request.sharedCore, background: { ...request.sharedCore.background, heroImage: "https://example.com/private.png" } },
}, { capability });
assert.equal(unsafeIgnoredField.pass, false);

const mismatchedEffect = await projectUnifiedTheme({
  ...request,
  sharedCore: { ...request.sharedCore, background: { mode: "media", image: "background.png" } },
}, { capability });
assert.equal(mismatchedEffect.pass, false);

const invalidFont = await projectUnifiedTheme({
  ...request,
  sharedCore: { ...request.sharedCore, fonts: { ui: ["system-ui; color:red"] } },
}, { capability });
assert.equal(invalidFont.pass, false);
console.log("adapter-capability-projection.test.mjs: ok");
