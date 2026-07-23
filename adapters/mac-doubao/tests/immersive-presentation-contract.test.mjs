import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validatePresentationProfileCapability } from "../../../app/packages/shared-core/presentation.mjs";
import { loadAdapterRegistry } from "../../../app/packages/adapter-sdk/adapter-registry.mjs";
import { validatePresentationCapabilityMetadata } from "../scripts/adapter-capability.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [capability, skinCss, injector, renderer] = await Promise.all([
  fs.readFile(path.join(root, "contracts", "adapter-capability.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "assets", "skin.css"), "utf8"),
  fs.readFile(path.join(root, "scripts", "injector.mjs"), "utf8"),
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
]);

const profile = capability.presentationProfiles?.["immersive-scene-v1"];
const REQUIRED_SURFACES = ["shell", "navigation", "home", "conversation", "composer", "cards", "overlays"];
const REQUIRED_PARAMETERS = [
  "density", "borderTreatment", "textureIntensity", "surfaceOpacity",
  "navigationTreatment", "composerTreatment", "cardTreatment",
];
const exactRecord = (consumerId, diagnostic) => ({ decision: "exact", consumerId, diagnostic });
const PRESENTATION_BOUNDARIES = {
  nativeControls: "scene-native-controls-host-owned",
  layout: "scene-layout-host-owned",
  uncataloguedPortals: "scene-uncatalogued-portals-unsupported",
  fonts: "scene-fonts-host-owned",
};

test("immersive-scene capability makes its exact-required semantic scope machine-readable", () => {
  assert.equal(profile.profileVersion, 1);
  assert.equal(profile.geometryPolicy, "scene-bounded");
  assert.equal(profile.sceneSemantics.scope, "presentation-scene");
  for (const [scope, keys] of [
    [profile.sceneSemantics.surfaces, REQUIRED_SURFACES],
    [profile.sceneSemantics.parameters, REQUIRED_PARAMETERS],
    [profile.sceneSemantics.assetSlots, ["scene.backdrop"]],
  ]) {
    assert.deepEqual(Object.keys(scope).sort(), [...keys].sort());
    for (const key of keys) {
      assert.equal(scope[key].decision, "exact", key);
      assert.match(scope[key].consumerId, /^[A-Za-z][A-Za-z0-9.-]{2,119}$/, key);
      assert.match(scope[key].diagnostic, /^[a-z][a-z0-9-]{2,159}$/, key);
    }
  }
  assert.deepEqual(profile.sceneSemantics.parameters.density, exactRecord(
    "doubao.scene.density-inset", "scene-parameter-density-exact",
  ));
});

test("surface opacity scales the Doubao scene veil instead of leaving an opaque base at zero", () => {
  assert.match(injector, /--cc-doubao-scene-panel-opacity.*surfaceOpacity/,
    "the bounded runtime payload must expose the validated opacity");
  assert.match(skinCss, /var\(--cc-doubao-scene-scrim-start\) var\(--cc-doubao-scene-panel-opacity\)/,
    "the main scene scrim must consume that opacity");
  assert.match(skinCss, /data-cc-theme-doubao-surface-context="home"\][\s\S]*?var\(--cc-doubao-scene-scrim-start\) var\(--cc-doubao-scene-panel-opacity\)/,
    "the higher-specificity home surface cannot leave a separate fixed scrim behind");
  assert.doesNotMatch(skinCss, /--cc-doubao-scene-panel:[^;]*var\(--cc-doubao-scene-surface-base\)\);/,
    "zero opacity must not resolve to an opaque fallback surface");
});

test("capability loader and closed shared schema preserve the rich scene semantics", () => {
  const local = validatePresentationCapabilityMetadata(capability);
  const shared = validatePresentationProfileCapability(profile);
  assert.deepEqual(local.sceneSemantics, shared.sceneSemantics);
  const loaded = loadAdapterRegistry().capabilities.find(({ adapterId }) => adapterId === "mac-doubao");
  assert.deepEqual(loaded?.presentationProfiles?.["immersive-scene-v1"], profile);

  const unknownSceneField = structuredClone(capability);
  unknownSceneField.presentationProfiles["immersive-scene-v1"].sceneSemantics.unsafeSelector = "#host";
  assert.throws(
    () => validatePresentationCapabilityMetadata(unknownSceneField),
    /unsupported fields: unsafeSelector/,
  );
  const legacyString = structuredClone(capability);
  legacyString.presentationProfiles["immersive-scene-v1"].sceneSemantics.parameters.cardTreatment = "exact";
  assert.throws(
    () => validatePresentationCapabilityMetadata(legacyString),
    /must be an object/,
  );
  assert.throws(
    () => validatePresentationProfileCapability(legacyString.presentationProfiles["immersive-scene-v1"]),
    /must be an object/,
  );
});

test("presentation boundaries explicitly exclude host-owned native controls, layout, portals, and fonts", () => {
  const local = validatePresentationCapabilityMetadata(capability);
  assert.deepEqual(local.presentationBoundaries, capability.presentationBoundaries);
  for (const [boundary, diagnostic] of Object.entries(PRESENTATION_BOUNDARIES)) {
    assert.deepEqual(capability.presentationBoundaries[boundary], {
      decision: "unsupported",
      consumerId: null,
      diagnostic,
    }, boundary);
  }
  const unsafeBoundary = structuredClone(capability);
  unsafeBoundary.presentationBoundaries.layout = {
    decision: "exact",
    consumerId: "doubao.scene.host-layout",
    diagnostic: "scene-layout-exact",
  };
  assert.throws(
    () => validatePresentationCapabilityMetadata(unsafeBoundary),
    /presentationBoundaries\.layout must be unsupported/,
  );
  const unknownBoundary = structuredClone(capability);
  unknownBoundary.presentationBoundaries.nativeControls.css = "button { color: red; }";
  assert.throws(
    () => validatePresentationCapabilityMetadata(unknownBoundary),
    /unsupported fields: css/,
  );
});

test("every exact immersive parameter has a bounded payload or role-frame consumer", () => {
  for (const [parameter, payloadConsumer, roleConsumer] of [
    ["density", "--cc-doubao-scene-density-inset", "--cc-doubao-scene-navigation-frame"],
    ["borderTreatment", "--cc-doubao-scene-etched-highlight-opacity", "--cc-doubao-scene-etched-highlight"],
    ["textureIntensity", "--cc-doubao-scene-texture-opacity", "--cc-doubao-scene-line"],
    ["surfaceOpacity", "--cc-doubao-scene-panel-opacity", "--cc-doubao-scene-panel"],
  ]) {
    assert.match(injector, new RegExp(parameter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), parameter);
    assert.match(injector, new RegExp(payloadConsumer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), parameter);
    assert.match(skinCss, new RegExp(roleConsumer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), parameter);
  }
  for (const [parameter, frame] of [
    ["navigationTreatment", "--cc-doubao-scene-navigation-frame"],
    ["composerTreatment", "--cc-doubao-scene-composer-frame"],
    ["cardTreatment", "--cc-doubao-scene-card-frame"],
  ]) {
    assert.match(skinCss, new RegExp(frame.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), parameter);
  }
  assert.match(renderer, /backgroundNode\.style\.backgroundImage\s*=/, "scene.backdrop must reach the owned background node");
  assert.match(skinCss, /#cc-theme-doubao-background\s*\{/, "scene.backdrop must have a bounded paint layer");
});

test("native typography, control interaction, focus, and unrecognised portals remain outside the exact scene scope", () => {
  const fields = capability.sharedCore.fields;
  for (const font of ["ui", "display", "code"]) {
    const entry = fields.find(({ source }) => source === `tokens.fonts.${font}`);
    assert.equal(entry?.decision, "unsupported", font);
    assert.equal(entry?.diagnostic, "host-native-typography", font);
  }
  for (const color of ["actionHover", "actionPressed", "hoverSurface", "pressedSurface", "selectedSurface", "selectedHoverSurface"]) {
    const entry = fields.find(({ source }) => source === `tokens.colors.${color}`);
    assert.equal(entry?.decision, "unsupported", color);
    assert.equal(entry?.diagnostic, "host-native-control-paint", color);
  }
  const focus = fields.find(({ source }) => source === "accessibility.preserveSystemFocusRing");
  assert.equal(focus?.decision, "exact");
  assert.equal(focus?.diagnostic, "host-focus-preserved");
  assert.doesNotMatch(skinCss, /:focus-visible\s*\{/);
  assert.doesNotMatch(skinCss, /font-family:\s*var\(--cc-doubao-theme/);
  assert.match(renderer, /\["overlay-surface", ':is\(\[role="menu"\], \[role="listbox"\], \[role="dialog"\]/);
});

test("scene text bridge remains contrast-safe on the documented dark scene frame while arbitrary host contrast remains unclaimed", () => {
  const luminance = (hex) => {
    const [red, green, blue] = hex.slice(1).match(/../g).map((part) => Number.parseInt(part, 16) / 255);
    const linear = (channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
  };
  const contrast = (first, second) => {
    const [light, dark] = [luminance(first), luminance(second)].sort((left, right) => right - left);
    return (light + 0.05) / (dark + 0.05);
  };

  assert.ok(contrast("#F3EAD7", "#0D0D0E") >= 4.5, "scene text");
  assert.ok(contrast("#B5A386", "#0D0D0E") >= 4.5, "scene muted text");
  assert.ok(contrast("#241C15", "#F7F0E1") >= 4.5, "native-icon interaction surface text");
  for (const key of ["minimumTextContrast", "minimumLargeTextContrast"]) {
    const entry = capability.sharedCore.fields.find(({ source }) => source === `accessibility.${key}`);
    assert.equal(entry?.decision, "unsupported", key);
    assert.equal(entry?.diagnostic, "contrast-audit-unavailable", key);
  }
});
