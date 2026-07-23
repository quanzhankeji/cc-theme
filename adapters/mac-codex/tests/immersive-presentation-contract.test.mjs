import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSkinTheme } from "../scripts/skin-theme.mjs";

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

function theme(nextPresentation = presentation) {
  return {
    kind: "skin.theme",
    id: "immersive-contract",
    name: "Immersive Contract",
    image: "background.png",
    colors: {},
    semanticColors: {},
    fonts: {},
    art: {},
    appearance: {},
    presentation: nextPresentation,
  };
}

const normalized = normalizeSkinTheme(theme());
assert.deepEqual(normalized.presentation, presentation, "the closed Shared Core scene envelope reaches the CodeX runtime intact");

const unknownParameter = structuredClone(presentation);
unknownParameter.parameters.hostSelector = "main > div";
assert.throws(() => normalizeSkinTheme(theme(unknownParameter)), /bounded immersive-scene-v1 values/);

const wrongBackdrop = structuredClone(presentation);
wrongBackdrop.assetSlots["scene.backdrop"] = "another.png";
assert.throws(() => normalizeSkinTheme(theme(wrongBackdrop)), /must bind the active theme image/);

const invalidFallback = structuredClone(presentation);
invalidFallback.fallbackPolicy.reducedMotion = "play";
assert.throws(() => normalizeSkinTheme(theme(invalidFallback)), /bounded immersive-scene-v1 values/);

const legacy = theme();
delete legacy.presentation;
assert.equal(normalizeSkinTheme(legacy).presentation, undefined, "themes without a presentation extension remain compatible");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = await fs.readFile(path.join(root, "assets", "skin.css"), "utf8");
assert.match(css, /var\(--skin-main-scrim-start\) var\(--scene-surface-opacity\)/,
  "the exact surfaceOpacity parameter must scale the CodeX main-content veil");
assert.match(css, /main\.main-surface[\s\S]*?var\(--skin-main-scrim-end\) var\(--scene-surface-opacity\)/,
  "the main content cannot retain an unparameterized dark overlay at 0% opacity");
assert.match(css, /data-skin-surface-context="home"\][\s\S]*?var\(--skin-main-scrim-start\) var\(--scene-surface-opacity\)/,
  "the higher-specificity home route veil must also respect the shared opacity control");

console.log("PASS: Mac CodeX accepts only the bounded immersive-scene-v1 envelope and maps its backdrop to the active asset.");
