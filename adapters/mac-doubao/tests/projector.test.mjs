import assert from "node:assert/strict";
import test from "node:test";

import { projectThemeFamilyAdapter } from "../scripts/adapter-capability.mjs";

const invocation = {
  kind: "cc-theme.adapter-projector-invocation",
  schemaVersion: 1,
  adapterId: "mac-doubao",
  capabilityVersion: "1.0.0",
  identity: { id: "midnight", name: "Midnight", version: "1.0.0" },
  sharedCore: {
    tokens: {
      colors: {
        surfaceBase: "#10151F",
        text: "#E9EEF7",
        textMuted: "#AAB5C5",
        action: "#6699FF",
        actionForeground: "#FFFFFF",
        focusRing: "#8EB1FF",
      },
      fonts: { ui: ["system-ui"], code: ["monospace"] },
      appearance: { shellMode: "dark", backdropBlurPx: 18 },
    },
    background: {
      mode: "media",
      image: "background.webp",
      position: { xPercent: 50, yPercent: 50 },
    },
    accessibility: { reducedMotion: "static" },
  },
  targetProfiles: { "mac-doubao": {} },
  compileContext: {
    detectedClientVersion: "2.19.9",
    detectedClientBuild: "2.19.9",
    surfaceCatalogId: "doubao-macos-2.19.9",
    surfaceCatalogVersion: 1,
    probeStatus: "passed",
    compileAllowed: true,
    applyAllowed: true,
    reasonCode: null,
    localRuntimeOverrides: { baseThemeHash: null, entries: [] },
  },
  assetBindings: { background: "background.webp" },
};

test("Manager invocation projects a verified Doubao skin.theme", async () => {
  const result = await projectThemeFamilyAdapter(invocation);

  assert.equal(result.kind, "cc-theme.adapter-projection-result");
  assert.equal(result.adapterId, "mac-doubao");
  assert.equal(result.applyAllowed, true);
  assert.deepEqual(result.theme, {
    kind: "skin.theme",
    id: "midnight",
    name: "Midnight",
    sourceVersion: "1.0.0",
    image: "background.webp",
    colors: { text: "#E9EEF7", muted: "#AAB5C5" },
    semanticColors: {
      surfaceBase: "#10151F",
      action: "#6699FF",
      actionForeground: "#FFFFFF",
      focusRing: "#8EB1FF",
    },
    fonts: { ui: ["system-ui"] },
    appearance: {
      backdropBlurPx: 18,
      backgroundPosition: { xPercent: 50, yPercent: 50 },
    },
  });
  assert.ok(result.diagnostics.some(({ field, decision }) => field === "tokens.fonts.code" && decision === "unsupported"));
  assert.ok(result.diagnostics.some(({ field, decision }) => field === "tokens.appearance.shellMode" && decision === "unsupported"));
});

test("video, ripple, and directional inputs produce visible static approximation diagnostics", async () => {
  const media = structuredClone(invocation);
  media.sharedCore.background.video = "background.mp4";
  media.sharedCore.background.posterMode = "image";
  media.assetBindings.video = "background.mp4";
  const mediaResult = await projectThemeFamilyAdapter(media);
  assert.equal(mediaResult.theme.backgroundVideo, undefined);
  assert.ok(mediaResult.diagnostics.some(({ code }) => code === "video-static-image-approximation"));

  const ripple = structuredClone(invocation);
  ripple.sharedCore.background = {
    mode: "ripple",
    image: "background.webp",
    intensity: 0.4,
    radiusPx: 32,
    quality: "high",
  };
  const rippleResult = await projectThemeFamilyAdapter(ripple);
  assert.equal(rippleResult.theme.interactiveBackground, undefined);
  assert.ok(rippleResult.diagnostics.some(({ code }) => code === "ripple-static-image-approximation"));

  const directional = structuredClone(invocation);
  directional.sharedCore.background = {
    mode: "directional",
    image: "background.webp",
    atlas: "atlas.webp",
    directions: 8,
    columns: 2,
    rows: 4,
    idleFrame: 0,
  };
  directional.assetBindings.atlas = "atlas.webp";
  const directionalResult = await projectThemeFamilyAdapter(directional);
  assert.equal(directionalResult.theme.interactiveBackground, undefined);
  assert.ok(directionalResult.diagnostics.some(({ code }) => code === "directional-static-image-approximation"));
});

test("complete compile context is fail-closed for build, probe, unknown fields, and local overrides", async () => {
  for (const mutate of [
    (value) => { value.compileContext.detectedClientBuild = "different"; },
    (value) => { value.compileContext.probeStatus = "not-run"; },
    (value) => { value.compileContext.applyAllowed = false; },
  ]) {
    const candidate = structuredClone(invocation);
    mutate(candidate);
    const result = await projectThemeFamilyAdapter(candidate);
    assert.equal(result.applyAllowed, false);
    assert.ok(result.diagnostics.some(({ severity }) => severity === "error"));
  }

  const unknown = structuredClone(invocation);
  unknown.compileContext.unexpected = true;
  await assert.rejects(() => projectThemeFamilyAdapter(unknown), /unsupported fields: unexpected/);

  const override = structuredClone(invocation);
  override.compileContext.localRuntimeOverrides.entries.push({
    tokenId: "foundation.surfaceBase",
    baseHash: "a".repeat(64),
    value: "#000000",
  });
  await assert.rejects(() => projectThemeFamilyAdapter(override), /does not expose local runtime overrides/);
});
