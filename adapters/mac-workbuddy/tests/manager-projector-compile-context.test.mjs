import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  MANAGER_COMPILE_CONTEXT_KEYS,
  projectThemeFamilyAdapter,
} from "../scripts/workbuddy-theme-projection.mjs";

const adapterId = ["mac", "workbuddy"].join("-");
const identity = ["WO", "LP"].join("");
const managerCompileContext = JSON.parse(await fs.readFile(
  new URL("./fixtures/manager-rust-build-compile-context.json", import.meta.url),
  "utf8",
));
assert.deepEqual(Object.keys(managerCompileContext), [...MANAGER_COMPILE_CONTEXT_KEYS],
  "the shared fixture must preserve the complete Manager Rust serialization shape and field order");
const invocation = {
  kind: "cc-theme.adapter-projector-invocation",
  schemaVersion: 1,
  adapterId,
  capabilityVersion: 1,
  identity: { id: identity, name: identity, version: "1.0.0" },
  sharedCore: {
    tokens: {
      colors: {
        surfaceBase: "#101010",
        text: "#f0f0f0",
        textMuted: "#a0a0a0",
        action: "#2f7d57",
        actionForeground: "#ffffff",
        focusRing: "#2f7d57",
      },
      fonts: { ui: ["system-ui"] },
      appearance: { shellMode: "auto" },
    },
    background: {
      mode: "media",
      image: "background.jpg",
      video: "background.mp4",
      posterMode: "image",
      scrimOpacity: 0.2,
      position: { xPercent: 50, yPercent: 42 },
    },
    accessibility: { reducedMotion: "static" },
  },
  targetProfiles: {
    [adapterId]: {
      kind: "cc-theme.target-profile",
      schemaVersion: 1,
      adapterId,
      values: { paletteStrategy: "system" },
    },
  },
  compileContext: managerCompileContext,
  assetBindings: { background: "background.jpg", video: "background.mp4" },
};

const withNullBuild = await projectThemeFamilyAdapter(invocation);
assert.equal(withNullBuild.adapterId, adapterId);
assert.equal(withNullBuild.applyAllowed, true);
assert.equal(withNullBuild.paletteStrategy, "system");

const withRealManagerFacts = await projectThemeFamilyAdapter({
  ...structuredClone(invocation),
  compileContext: {
    ...invocation.compileContext,
    detectedClientBuild: "526.20260719 release",
    surfaceCatalogId: "workbuddy-macos-5.2.6-v2",
  },
});
assert.deepEqual(withRealManagerFacts, withNullBuild,
  "currently unconsumed WorkBuddy build/catalog facts must not change target theme projection");

for (const invalid of [false, 526, {}, [], "", "../unsafe", "x".repeat(81)]) {
  await assert.rejects(projectThemeFamilyAdapter({
    ...structuredClone(invocation),
    compileContext: { ...invocation.compileContext, detectedClientBuild: invalid },
  }), /detectedClientBuild must be null or a bounded safe string/,
  `Manager compile context accepted invalid detectedClientBuild: ${JSON.stringify(invalid)}`);
}

for (const invalid of [false, 2, {}, [], "", "../unsafe", "catalog/id", "x".repeat(129)]) {
  await assert.rejects(projectThemeFamilyAdapter({
    ...structuredClone(invocation),
    compileContext: { ...invocation.compileContext, surfaceCatalogId: invalid },
  }), /surfaceCatalogId must be null or a bounded safe catalog id/,
  `Manager compile context accepted invalid surfaceCatalogId: ${JSON.stringify(invalid)}`);
}

await assert.rejects(projectThemeFamilyAdapter({
  ...structuredClone(invocation),
  compileContext: { ...invocation.compileContext, unknownManagerFact: null },
}), /compile context contains unsupported fields: unknownManagerFact/,
"unknown Manager compile context fields must remain fail closed");

console.log("PASS: WorkBuddy accepts the complete Manager Rust compile-context shape, validates nullable build/catalog facts, ignores unused facts deterministically, and rejects invalid or unknown fields.");
