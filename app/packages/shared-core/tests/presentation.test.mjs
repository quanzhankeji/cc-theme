import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEFAULT_ADAPTER_REGISTRY } from "../../adapter-sdk/adapter-registry.mjs";
import { compileThemeFamily, validateThemeFamily } from "../compiler.mjs";
import { validatePresentationBoundaries, validatePresentationProfileCapability } from "../presentation.mjs";
import { normalizeSkinTheme as normalizeCodexSkin } from "../../../../adapters/mac-codex/scripts/skin-theme.mjs";
import { normalizeSkinTheme as normalizeDoubaoSkin } from "../../../../adapters/mac-doubao/scripts/skin-theme.mjs";
import { normalizeSkinTheme as normalizeWorkBuddySkin } from "../../../../adapters/mac-workbuddy/scripts/skin-theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const readJson = async (relative) => JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));

function immersivePresentation(image = "background.webp") {
  return {
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
    assetSlots: { "scene.backdrop": image },
    fallbackPolicy: { unsupportedSurface: "block", reducedMotion: "static" },
  };
}

function exactSceneSemantics(presentation) {
  const exact = (consumerId) => ({ decision: "exact", consumerId, diagnostic: "scene-consumer-exact" });
  return {
    scope: "presentation-scene",
    surfaces: Object.fromEntries(presentation.surfaces.map((surface) => [surface, exact(`scene.surface.${surface}`)])),
    parameters: Object.fromEntries(Object.keys(presentation.parameters).map((parameter) => [parameter, exact(`scene.parameter.${parameter}`)])),
    assetSlots: Object.fromEntries(Object.keys(presentation.assetSlots).map((slot) => [slot, exact(`scene.asset.${slot.replace(".", "-")}`)])),
  };
}

function hostOwnedBoundaries() {
  return Object.fromEntries([
    "nativeControls", "layout", "uncataloguedPortals", "fonts",
  ].map((boundary) => [boundary, {
    decision: "unsupported",
    consumerId: null,
    diagnostic: `scene-${boundary.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-host-owned`,
  }]));
}

function registryWithExactSceneSemantics(presentation) {
  const registry = structuredClone(DEFAULT_ADAPTER_REGISTRY);
  for (const capability of registry.capabilities) {
    const profile = capability.presentationProfiles["immersive-scene-v1"];
    delete profile.surfaces;
    delete profile.scope;
    profile.sceneSemantics = exactSceneSemantics(presentation);
    capability.presentationBoundaries = hostOwnedBoundaries();
  }
  return registry;
}

test("immersive-scene-v1 reaches every target only when each Adapter declares complete exact scene semantics", async () => {
  const theme = await readJson("app/packages/test-kit/fixtures/unified-theme.json");
  const context = await readJson("app/packages/test-kit/fixtures/compile-context.json");
  theme.presentation = immersivePresentation(theme.sharedCore.background.image);
  const registry = registryWithExactSceneSemantics(theme.presentation);
  validateThemeFamily(theme);
  const compiled = await compileThemeFamily(theme, context, { registry });
  for (const [adapterId, target] of Object.entries(compiled.themes)) {
    assert.equal(target.presentation.profileId, "immersive-scene-v1", adapterId);
    assert.equal(compiled.applyAvailability[adapterId].allowed, true, adapterId);
    assert.ok(compiled.diagnostics[adapterId].some((entry) => entry.code === "immersive-scene-consumer-exact"), adapterId);
  }
  assert.equal(normalizeCodexSkin(compiled.themes["mac-codex"]).presentation.profileId, "immersive-scene-v1");
  assert.equal(normalizeDoubaoSkin(compiled.themes["mac-doubao"]).presentation.profileId, "immersive-scene-v1");
  assert.equal(normalizeWorkBuddySkin(compiled.themes["mac-workbuddy"]).presentation.profileId, "immersive-scene-v1");
});

test("immersive scene surface opacity accepts the complete 0–100% range across every Adapter normalizer", async () => {
  const source = await readJson("app/packages/test-kit/fixtures/unified-theme.json");
  for (const surfaceOpacity of [0, 1]) {
    const theme = structuredClone(source);
    theme.presentation = immersivePresentation(theme.sharedCore.background.image);
    theme.presentation.parameters.surfaceOpacity = surfaceOpacity;
    validateThemeFamily(theme);
    const registry = registryWithExactSceneSemantics(theme.presentation);
    const context = await readJson("app/packages/test-kit/fixtures/compile-context.json");
    const compilation = await compileThemeFamily(theme, context, { registry });
    assert.equal(normalizeCodexSkin(compilation.themes["mac-codex"]).presentation.parameters.surfaceOpacity, surfaceOpacity);
    assert.equal(normalizeDoubaoSkin(compilation.themes["mac-doubao"]).presentation.parameters.surfaceOpacity, surfaceOpacity);
    assert.equal(normalizeWorkBuddySkin(compilation.themes["mac-workbuddy"]).presentation.parameters.surfaceOpacity, surfaceOpacity);
  }
  const invalid = structuredClone(source);
  invalid.presentation = immersivePresentation(invalid.sharedCore.background.image);
  invalid.presentation.parameters.surfaceOpacity = 1.01;
  assert.throws(() => validateThemeFamily(invalid), /surfaceOpacity.*0 to 1/);
});

test("immersive-scene-v1 rejects executable payloads, incorrect asset bindings, and missing profile declarations", async () => {
  const theme = await readJson("app/packages/test-kit/fixtures/unified-theme.json");
  const context = await readJson("app/packages/test-kit/fixtures/compile-context.json");
  theme.presentation = immersivePresentation(theme.sharedCore.background.image);

  const executable = structuredClone(theme);
  executable.presentation.parameters.css = "body { display:none }";
  assert.throws(() => validateThemeFamily(executable), /unsupported fields|forbidden/);

  const wrongAsset = structuredClone(theme);
  wrongAsset.presentation.assetSlots["scene.backdrop"] = "other.webp";
  assert.throws(() => validateThemeFamily(wrongAsset), /scene.backdrop must bind/);

  const registry = registryWithExactSceneSemantics(theme.presentation);
  registry.capabilities.find((entry) => entry.adapterId === "mac-doubao").presentationProfiles = {};
  await assert.rejects(
    () => compileThemeFamily(theme, context, { registry, targetAdapterIds: ["mac-doubao"] }),
    /does not support the required immersive-scene-v1/,
  );
});

test("exact-required presentation fails closed when a required scene parameter has no exact consumer", async () => {
  const theme = await readJson("app/packages/test-kit/fixtures/unified-theme.json");
  const context = await readJson("app/packages/test-kit/fixtures/compile-context.json");
  theme.presentation = immersivePresentation(theme.sharedCore.background.image);

  const registry = registryWithExactSceneSemantics(theme.presentation);
  const capability = registry.capabilities.find((entry) => entry.adapterId === "mac-doubao");
  capability.presentationProfiles["immersive-scene-v1"].sceneSemantics.parameters.cardTreatment = {
    decision: "unsupported",
    consumerId: null,
    diagnostic: "scene-parameter-not-consumed",
  };

  await assert.rejects(
    () => compileThemeFamily(theme, context, { registry, targetAdapterIds: ["mac-doubao"] }),
    /presentation-mapping-incomplete.*parameter consumer for cardTreatment/,
  );
});

test("immersive-scene-v1 makes host-owned boundaries explicit in normalized capability diagnostics", async () => {
  const theme = await readJson("app/packages/test-kit/fixtures/unified-theme.json");
  const context = await readJson("app/packages/test-kit/fixtures/compile-context.json");
  theme.presentation = immersivePresentation(theme.sharedCore.background.image);

  for (const adapterId of ["mac-doubao", "mac-workbuddy"]) {
    const capability = DEFAULT_ADAPTER_REGISTRY.capabilities.find((entry) => entry.adapterId === adapterId);
    assert.doesNotThrow(() => validatePresentationBoundaries(capability.presentationBoundaries, `${adapterId}.presentationBoundaries`));
    const compilation = await compileThemeFamily(theme, context, { targetAdapterIds: [adapterId] });
    const boundaries = compilation.diagnostics[adapterId]
      .filter((entry) => entry.field.startsWith("presentation.boundaries."));
    assert.equal(boundaries.length, 4, adapterId);
    assert.ok(boundaries.every((entry) => entry.decision === "unsupported"), adapterId);
  }
});

test("immersive-scene-v1 fails closed when an Adapter omits a declared host boundary", async () => {
  const theme = await readJson("app/packages/test-kit/fixtures/unified-theme.json");
  const context = await readJson("app/packages/test-kit/fixtures/compile-context.json");
  theme.presentation = immersivePresentation(theme.sharedCore.background.image);
  const registry = registryWithExactSceneSemantics(theme.presentation);
  delete registry.capabilities.find((entry) => entry.adapterId === "mac-doubao").presentationBoundaries.fonts;

  await assert.rejects(
    () => compileThemeFamily(theme, context, { registry, targetAdapterIds: ["mac-doubao"] }),
    /presentation-mapping-incomplete.*presentationBoundaries/,
  );
});

test("legacy themes without a presentation extension keep compiling against current Adapter capabilities", async () => {
  const theme = await readJson("app/packages/test-kit/fixtures/unified-theme.json");
  const context = await readJson("app/packages/test-kit/fixtures/compile-context.json");

  const compilation = await compileThemeFamily(theme, context, { targetAdapterIds: ["mac-doubao"] });
  assert.equal(compilation.applyAvailability["mac-doubao"].allowed, true);
  assert.equal(compilation.themes["mac-doubao"].presentation, undefined);
});

test("current mac-codex capability publishes complete immersive-scene semantics and explicit host boundaries", async () => {
  const theme = await readJson("app/packages/test-kit/fixtures/unified-theme.json");
  const context = await readJson("app/packages/test-kit/fixtures/compile-context.json");
  theme.presentation = immersivePresentation(theme.sharedCore.background.image);

  const capability = DEFAULT_ADAPTER_REGISTRY.capabilities.find((entry) => entry.adapterId === "mac-codex");
  assert.equal(validatePresentationProfileCapability(capability.presentationProfiles["immersive-scene-v1"])
    .sceneSemantics.scope, "presentation-scene");
  assert.doesNotThrow(() => validatePresentationBoundaries(capability.presentationBoundaries));

  const compilation = await compileThemeFamily(theme, context, { targetAdapterIds: ["mac-codex"] });
  assert.equal(compilation.applyAvailability["mac-codex"].allowed, true);
  const diagnostics = compilation.diagnostics["mac-codex"].filter((entry) => entry.field.startsWith("presentation."));
  assert.equal(diagnostics.length, 19);
  assert.equal(diagnostics.filter((entry) => entry.decision === "exact").length, 15);
  assert.equal(diagnostics.filter((entry) => entry.decision === "unsupported").length, 4);
});

test("presentation capability closes its semantic scope and mapping decisions", async () => {
  const theme = await readJson("app/packages/test-kit/fixtures/unified-theme.json");
  const profile = {
    profileVersion: 1,
    geometryPolicy: "scene-bounded",
    sceneSemantics: exactSceneSemantics(immersivePresentation(theme.sharedCore.background.image)),
  };
  assert.equal(validatePresentationProfileCapability(profile).sceneSemantics.scope, "presentation-scene");

  const unknownScopeField = structuredClone(profile);
  unknownScopeField.sceneSemantics.parameters.animationScript = {
    decision: "exact",
    consumerId: "scene.parameter.animationScript",
    diagnostic: "scene-parameter-exact",
  };
  assert.throws(() => validatePresentationProfileCapability(unknownScopeField), /unsupported fields/);

  const invalidMapping = structuredClone(profile);
  invalidMapping.sceneSemantics.assetSlots["scene.backdrop"] = {
    decision: "exact",
    consumerId: null,
    diagnostic: "scene-asset-exact",
  };
  assert.throws(() => validatePresentationProfileCapability(invalidMapping), /bounded opaque consumer id/);
});

test("public Adapter capability schema requires the same closed presentation-scene mapping contract", async () => {
  const schema = await readJson("app/packages/contracts/adapter-capability.schema.json");
  const profile = schema.$defs.presentationProfile;
  const semantics = profile.properties.sceneSemantics;
  const mapping = schema.$defs.mappingDecision;

  assert.deepEqual(profile.required, ["profileVersion", "geometryPolicy", "sceneSemantics"]);
  assert.equal(profile.additionalProperties, false);
  assert.deepEqual(semantics.required, ["scope", "surfaces", "parameters", "assetSlots"]);
  assert.equal(semantics.additionalProperties, false);
  assert.equal(semantics.properties.scope.const, "presentation-scene");
  assert.deepEqual(mapping.properties.decision.enum, ["exact", "approximate", "unsupported"]);
  assert.equal(mapping.additionalProperties, false);
});
