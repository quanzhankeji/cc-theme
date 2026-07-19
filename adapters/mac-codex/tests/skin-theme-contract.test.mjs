import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAC_CODEX_ADAPTER_ID,
  MAC_CODEX_CONTRACT,
  normalizeSkinTheme,
  SKIN_PACKAGE_KIND,
  SKIN_THEME_KIND,
  themeMediaNames,
} from "../scripts/skin-theme.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const schema = JSON.parse(await fs.readFile(path.join(root, "contracts", "skin-theme.schema.json"), "utf8"));
const example = {
  kind: "skin.theme",
  id: "adapter-contract-fixture",
  name: "Adapter Contract Fixture",
  image: "background.png",
  pet: {
    manifest: "pet/pet.json",
    spritesheet: "pet/spritesheet.webp",
    installPolicy: "if-absent",
    selectionPolicy: "manual",
  },
  art: { analysis: "off", safeArea: "auto", taskMode: "auto", paletteMode: "system" },
  appearance: {
    shellMode: "auto",
    newTaskLayout: "cards",
    backgroundPosition: { xPercent: 50, yPercent: 50 },
    backdropBlurPx: 18,
    backdropSaturation: 1,
    radiusScale: 1,
    reduceParticles: true,
  },
};

assert.equal(schema.properties.kind.const, SKIN_THEME_KIND);
assert.equal(schema.properties.schemaVersion, undefined);
assert.equal(schema.required.includes("colors"), false);
assert.equal(SKIN_PACKAGE_KIND, "skin.package");
assert.equal(MAC_CODEX_ADAPTER_ID, "mac-codex");
assert.equal(MAC_CODEX_CONTRACT, SKIN_THEME_KIND);

const normalized = normalizeSkinTheme(example, "Contract example");
assert.equal(normalized.kind, SKIN_THEME_KIND);
assert.equal(normalized.themeBridgeEnabled, true);
assert.equal(normalized.art.paletteMode, "system");
assert.equal(normalized.art.analysis, "off");
assert.match(normalized.resolvedPalettes.light.semanticColors.sidebarSurface, /^rgba\(/);
assert.match(normalized.resolvedPalettes.dark.semanticColors.mainScrimEnd, /^rgba\(/);
assert.deepEqual(themeMediaNames(example), ["background.png"]);
assert.equal(normalized.appearance.newTaskLayout, "cards");
assert.equal(schema.properties.appearance.properties.backgroundVideoScrimOpacity.maximum, 0.8);
assert.equal(schema.properties.interactiveBackground.oneOf.length, 2);
assert.deepEqual(normalized.pet, {
  manifest: "pet/pet.json",
  spritesheet: "pet/spritesheet.webp",
  installPolicy: "if-absent",
  selectionPolicy: "manual",
});

assert.throws(
  () => normalizeSkinTheme({ ...example, kind: "skin.legacy-theme" }, "Unsupported theme"),
  /skin\.theme contract/,
);
assert.throws(
  () => normalizeSkinTheme({ ...example, schemaVersion: 1 }, "Numbered theme"),
  /must not use a numbered theme schema/,
);
assert.throws(
  () => normalizeSkinTheme({ ...example, id: "../unsafe" }, "Unsafe theme"),
  /id may contain only/,
);
assert.throws(
  () => normalizeSkinTheme({ ...example, script: "install.js" }, "Executable theme"),
  /unsupported fields/,
);
const normalizedVideo = normalizeSkinTheme({
  ...example,
  backgroundVideo: "ambient.mp4",
  appearance: { ...example.appearance, backgroundVideoScrimOpacity: 0.24 },
}, "Video theme");
assert.equal(normalizedVideo.appearance.backgroundVideoScrimOpacity, 0.24);
assert.equal(normalizeSkinTheme({
  ...example,
  backgroundVideo: "ambient.mp4",
}, "Default video theme").appearance.backgroundVideoScrimOpacity, 0.16);

const normalizedRipple = normalizeSkinTheme({
  ...example,
  interactiveBackground: {
    type: "ripple",
    intensity: 0.42,
    radiusPx: 30,
    quality: "high",
    scrimOpacity: 0.2,
  },
}, "Ripple theme");
assert.equal(normalizedRipple.backgroundRenderMode, "ripple");
assert.deepEqual(normalizedRipple.interactiveBackground, {
  type: "ripple",
  intensity: 0.42,
  radiusPx: 30,
  quality: "high",
  scrimOpacity: 0.2,
});
assert.deepEqual(themeMediaNames({
  ...example,
  interactiveBackground: { type: "ripple" },
}), ["background.png"]);

const directionalSource = {
  ...example,
  interactiveBackground: {
    type: "directional",
    atlas: "background-directions.webp",
    directions: 16,
    columns: 4,
    rows: 4,
    firstDirectionDegrees: -90,
    idleFrame: 3,
    origin: { xPercent: 48, yPercent: 52 },
    scrimOpacity: 0.12,
  },
};
const normalizedDirectional = normalizeSkinTheme(directionalSource, "Directional theme");
assert.equal(normalizedDirectional.backgroundRenderMode, "directional");
assert.deepEqual(normalizedDirectional.interactiveBackground, directionalSource.interactiveBackground);
assert.deepEqual(themeMediaNames(directionalSource), ["background.png", "background-directions.webp"]);
assert.throws(
  () => normalizeSkinTheme({ ...directionalSource, backgroundVideo: "ambient.mp4" }, "Mixed background"),
  /must not be combined with backgroundVideo/,
);
assert.throws(
  () => normalizeSkinTheme({
    ...directionalSource,
    interactiveBackground: { ...directionalSource.interactiveBackground, rows: 3 },
  }, "Bad grid"),
  /columns × rows must equal directions/,
);
assert.throws(
  () => normalizeSkinTheme({
    ...directionalSource,
    interactiveBackground: { ...directionalSource.interactiveBackground, atlas: "../escape.webp" },
  }, "Unsafe atlas"),
  /local static WebP filename/,
);
assert.throws(
  () => normalizeSkinTheme({
    ...directionalSource,
    interactiveBackground: { ...directionalSource.interactiveBackground, shader: "evil" },
  }, "Theme shader"),
  /unsupported fields/,
);
assert.throws(
  () => normalizeSkinTheme({
    ...example,
    appearance: { ...example.appearance, backgroundVideoScrimOpacity: 0.2 },
  }, "Scrim without video"),
  /requires backgroundVideo/,
);
assert.throws(
  () => normalizeSkinTheme({
    ...example,
    backgroundVideo: "ambient.mp4",
    appearance: { ...example.appearance, backgroundVideoScrimOpacity: 0.81 },
  }, "Invalid video scrim"),
  /number from 0 to 0\.8/,
);

console.log("PASS: one versionless Skin Theme contract drives validation and adapters.");
