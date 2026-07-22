import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEFAULT_ADAPTER_REGISTRY } from "../../adapter-sdk/adapter-registry.mjs";
import { compileThemeFamily, validateThemeFamily } from "../compiler.mjs";
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

test("immersive-scene-v1 remains an optional Unified Theme extension and reaches every target", async () => {
  const theme = await readJson("app/packages/test-kit/fixtures/unified-theme.json");
  const context = await readJson("app/packages/test-kit/fixtures/compile-context.json");
  theme.presentation = immersivePresentation(theme.sharedCore.background.image);
  validateThemeFamily(theme);
  const compiled = await compileThemeFamily(theme, context);
  for (const [adapterId, target] of Object.entries(compiled.themes)) {
    assert.equal(target.presentation.profileId, "immersive-scene-v1", adapterId);
    assert.equal(compiled.applyAvailability[adapterId].allowed, true, adapterId);
    assert.ok(compiled.diagnostics[adapterId].some((entry) => entry.code === "immersive-scene-consumer-exact"), adapterId);
  }
  assert.equal(normalizeCodexSkin(compiled.themes["mac-codex"]).presentation.profileId, "immersive-scene-v1");
  assert.equal(normalizeDoubaoSkin(compiled.themes["mac-doubao"]).presentation.profileId, "immersive-scene-v1");
  assert.equal(normalizeWorkBuddySkin(compiled.themes["mac-workbuddy"]).presentation.profileId, "immersive-scene-v1");
});

test("immersive-scene-v1 rejects executable payloads, incorrect asset bindings, and missing exact consumers", async () => {
  const theme = await readJson("app/packages/test-kit/fixtures/unified-theme.json");
  const context = await readJson("app/packages/test-kit/fixtures/compile-context.json");
  theme.presentation = immersivePresentation(theme.sharedCore.background.image);

  const executable = structuredClone(theme);
  executable.presentation.parameters.css = "body { display:none }";
  assert.throws(() => validateThemeFamily(executable), /unsupported fields|forbidden/);

  const wrongAsset = structuredClone(theme);
  wrongAsset.presentation.assetSlots["scene.backdrop"] = "other.webp";
  assert.throws(() => validateThemeFamily(wrongAsset), /scene.backdrop must bind/);

  const registry = structuredClone(DEFAULT_ADAPTER_REGISTRY);
  registry.capabilities.find((entry) => entry.adapterId === "mac-doubao").presentationProfiles = {};
  await assert.rejects(() => compileThemeFamily(theme, context, { registry }), /does not support the required immersive-scene-v1/);
});
