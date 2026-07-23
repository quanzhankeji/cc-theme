import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSkinTheme } from "../scripts/skin-theme.mjs";
import { loadAdapterCapability, validateAdapterCapability } from "../scripts/adapter-capability.mjs";
import { loadUiSurfaceCatalog } from "../scripts/ui-surface-catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const presentation = {
  profileId: "immersive-scene-v1",
  profileVersion: 1,
  strictness: "exact-required",
  geometryPolicy: "scene-bounded",
  surfaces: ["shell", "navigation", "home", "conversation", "composer", "cards", "overlays"],
  parameters: {
    density: "comfortable",
    borderTreatment: "etched",
    textureIntensity: 0.36,
    surfaceOpacity: 0.72,
    navigationTreatment: "framed",
    composerTreatment: "anchored",
    cardTreatment: "elevated",
  },
  assetSlots: { "scene.backdrop": "background.png" },
  fallbackPolicy: { unsupportedSurface: "block", reducedMotion: "static" },
};

const source = () => ({
  kind: "skin.theme",
  id: "immersive-contract",
  image: "background.png",
  appearance: { paletteStrategy: "adaptive", shellMode: "auto" },
  presentation: structuredClone(presentation),
});

assert.deepEqual(normalizeSkinTheme(source()).presentation, presentation,
  "the bounded immersive profile remains available to standalone WorkBuddy engines");
assert.equal(normalizeSkinTheme({ ...source(), presentation: undefined }).presentation, undefined,
  "existing themes without presentation retain their import path");

const unknownParameter = source();
unknownParameter.presentation.parameters.untrustedCss = "body { display: none }";
assert.throws(() => normalizeSkinTheme(unknownParameter), /presentation\.parameters.*unsupported|validated immersive-scene-v1/i);

const badOpacity = source();
badOpacity.presentation.parameters.surfaceOpacity = 1.1;
assert.throws(() => normalizeSkinTheme(badOpacity), /surfaceOpacity.*0.*1/);

const validNonDefaultNumbers = source();
validNonDefaultNumbers.presentation.parameters.textureIntensity = 0.18;
validNonDefaultNumbers.presentation.parameters.surfaceOpacity = 0.44;
assert.deepEqual(normalizeSkinTheme(validNonDefaultNumbers).presentation.parameters, validNonDefaultNumbers.presentation.parameters,
  "every in-range immersive number remains available to the bounded renderer recipe");

const badAssetSlot = source();
badAssetSlot.presentation.assetSlots["scene.overlay"] = "overlay.png";
assert.throws(() => normalizeSkinTheme(badAssetSlot), /presentation\.assetSlots.*unsupported|validated immersive-scene-v1/i);

const mismatchedBackdrop = source();
mismatchedBackdrop.presentation.assetSlots["scene.backdrop"] = "other.png";
assert.throws(() => normalizeSkinTheme(mismatchedBackdrop), /scene\.backdrop.*theme image/i);

const badFallback = source();
badFallback.presentation.fallbackPolicy.reducedMotion = "animate";
assert.throws(() => normalizeSkinTheme(badFallback), /reducedMotion.*static/);

const [renderer, css] = await Promise.all([
  fs.readFile(path.join(ROOT, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(ROOT, "assets", "skin.css"), "utf8"),
]);
const [capability, surfaceCatalog] = await Promise.all([
  loadAdapterCapability(),
  loadUiSurfaceCatalog(),
]);

const immersiveCapability = capability.presentationProfiles["immersive-scene-v1"];
assert.equal(immersiveCapability.sceneSemantics.scope, "presentation-scene",
  "the scene recipe must never be confused with a host layout or native-control contract");
assert.deepEqual(Object.keys(immersiveCapability.sceneSemantics).sort(), ["assetSlots", "parameters", "scope", "surfaces"],
  "the Capability must publish every immersive scope without exposing host CSS or selectors");
for (const scope of ["shell", "navigation", "home", "conversation", "composer", "cards", "overlays"]) {
  assert.equal(immersiveCapability.sceneSemantics.surfaces[scope].decision, "exact",
    `immersive surface ${scope} must be exact before strict presentation can compile`);
  assert.match(immersiveCapability.sceneSemantics.surfaces[scope].consumerId, /^workbuddy\.presentation\.surface\./,
    `immersive surface ${scope} must name its stable semantic consumer`);
}
for (const parameter of [
  "density", "borderTreatment", "textureIntensity", "surfaceOpacity",
  "navigationTreatment", "composerTreatment", "cardTreatment",
]) {
  assert.equal(immersiveCapability.sceneSemantics.parameters[parameter].decision, "exact",
    `immersive parameter ${parameter} must publish an exact runtime consumer`);
  assert.match(immersiveCapability.sceneSemantics.parameters[parameter].consumerId, /^workbuddy\.presentation\.parameter\./,
    `immersive parameter ${parameter} must name its stable semantic consumer`);
}
assert.equal(immersiveCapability.sceneSemantics.assetSlots["scene.backdrop"].decision, "exact",
  "the semantic backdrop slot must bind the verified theme image");
assert.match(immersiveCapability.sceneSemantics.assetSlots["scene.backdrop"].consumerId, /^workbuddy\.presentation\.asset\./,
  "the semantic backdrop slot must name its stable semantic consumer");
for (const boundary of ["nativeControls", "layout", "uncataloguedPortals", "fonts"]) {
  assert.equal(capability.presentationBoundaries[boundary].decision, "unsupported",
    `${boundary} must remain outside the immersive profile's exact scope`);
}
const approximatePresentation = structuredClone(capability);
approximatePresentation.presentationProfiles["immersive-scene-v1"].sceneSemantics.parameters.textureIntensity.decision = "approximate";
assert.throws(() => validateAdapterCapability(approximatePresentation), /exact immersive scene semantics/i,
  "exact-required presentation must fail closed when a declared parameter loses its runtime consumer");
const missingConsumer = structuredClone(capability);
delete missingConsumer.presentationProfiles["immersive-scene-v1"].sceneSemantics.parameters.textureIntensity.consumerId;
assert.throws(() => validateAdapterCapability(missingConsumer), /exact immersive scene semantics/i,
  "an exact presentation declaration without a stable consumer ID must fail closed");
for (const [dataset, source] of [
  ["workbuddySkinSceneDensity", "scene.density"],
  ["workbuddySkinSceneBorderTreatment", "scene.borderTreatment"],
  ["workbuddySkinSceneTextureIntensity", "textureIntensity"],
  ["workbuddySkinSceneSurfaceOpacity", "surfaceOpacity"],
  ["workbuddySkinSceneNavigationTreatment", "scene.navigationTreatment"],
  ["workbuddySkinSceneComposerTreatment", "scene.composerTreatment"],
  ["workbuddySkinSceneCardTreatment", "scene.cardTreatment"],
]) {
  assert.match(renderer, new RegExp(`root\\.dataset\\.${dataset} = ${source.replace(".", "\\.")}`),
    `${dataset} must be emitted from the verified presentation input`);
  assert.match(renderer, new RegExp(`delete root\\.dataset\\.${dataset};`),
    `${dataset} must be removed during restore`);
}
assert.match(renderer, /const sceneBackdrop = THEME\.presentation\?\.profileId === "immersive-scene-v1"\s*\? THEME\.presentation\.assetSlots\["scene\.backdrop"\]/,
  "the semantic backdrop slot must be read by the renderer rather than treated as metadata only");
assert.match(renderer, /sceneBackdrop !== THEME\.image/,
  "a divergent backdrop slot must fail before it can reach the runtime");
assert.match(renderer, /const sceneStaticMotionPolicy = THEME\.presentation\?\.fallbackPolicy\?\.reducedMotion === "static"/,
  "the static reduced-motion fallback must be read by the runtime");
assert.match(renderer, /motionPreference\.matches && \(sceneStaticMotionPolicy \|\| !videoMotionOverride\)/,
  "a profile requiring static motion must not be bypassed by a previous video override");
assert.match(renderer, /const customPaletteFor = \(mode\) => paletteFromTheme\(THEME\.appearanceVariants\?\.\[mode\] \?\? THEME\)/,
  "a high-fidelity theme must select its exact light/dark palette before WorkBuddy writes style bindings");
assert.match(renderer, /activePaletteStrategy === "system" \|\| THEME\.appearanceVariants/,
  "a host appearance change must reapply a declared light/dark palette even when the strategy is adaptive or custom");
for (const variable of [
  "--cc-theme-scene-density-tracking",
  "--cc-theme-scene-etched-line",
  "--cc-theme-scene-texture-alpha",
  "--cc-theme-scene-content-opacity",
  "--cc-theme-scene-surface-layer",
  "--cc-theme-scene-navigation-frame",
  "--cc-theme-scene-composer-anchor",
  "--cc-theme-scene-card-elevation",
]) {
  assert.ok(((renderer + css).match(new RegExp(variable.replace(/[-]/g, "\\-"), "g")) ?? []).length >= 2,
    `${variable} must be defined by the bounded renderer recipe and consumed by an owned scene role`);
}
assert.match(renderer, /const textureIntensity = sceneNumber\(scene\.textureIntensity, 0, 1/,
  "the renderer must accept every validated texture intensity instead of a single theme literal");
assert.match(renderer, /const surfaceOpacity = sceneNumber\(scene\.surfaceOpacity, 0, 1/,
  "the renderer must accept every validated surface opacity instead of a single theme literal");
assert.match(css, /var\(--wbs-main-scrim-start\) var\(--cc-theme-scene-content-opacity\)/,
  "the main WorkBuddy scene veil must become transparent when the validated opacity is zero");
assert.match(css, /data-workbuddy-skin-role="overlay-settings-modal"[\s\S]*?--cc-theme-scene-surface-layer/,
  "immersive overlays must consume the verified scene surface treatment");
assert.match(css, /data-workbuddy-skin-role="composer"\] \{[\s\S]*?--cc-theme-scene-composer-anchor/,
  "immersive composer paint must consume the anchored treatment");

const immersiveBlock = css.slice(css.indexOf("immersive-scene-v1 is a bounded, paint-only recipe"));
const catalogRoles = new Set(surfaceCatalog.runtimeRoles.map((entry) => entry.role));
for (const role of immersiveBlock.matchAll(/data-workbuddy-skin-role="([a-z0-9-]+)"/g)) {
  assert.ok(catalogRoles.has(role[1]),
    `immersive CSS may only consume the versioned Surface Catalog role ${role[1]}`);
}
for (const [surface, role] of Object.entries({
  shell: "shell",
  navigation: "sidebar-nav-row",
  home: "page-home",
  conversation: "page-chat",
  composer: "composer",
  cards: "project-card",
  overlays: "overlay-settings-modal",
})) {
  assert.match(css, new RegExp(`data-workbuddy-skin-presentation="immersive-scene-v1"[\\s\\S]{0,900}data-workbuddy-skin-role="${role}"`),
    `immersive surface ${surface} must retain a bounded consumer from the versioned Surface Catalog`);
}
for (const selector of [
  'data-workbuddy-skin-scene-density="comfortable"',
  'data-workbuddy-skin-scene-border-treatment="etched"',
  'data-workbuddy-skin-scene-navigation-treatment="framed"',
  'data-workbuddy-skin-scene-composer-treatment="anchored"',
  'data-workbuddy-skin-scene-card-treatment="elevated"',
]) assert.match(immersiveBlock, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  `the validated semantic value ${selector} must gate a concrete paint consumer`);

console.log("immersive-presentation-contract.test.mjs: ok");
