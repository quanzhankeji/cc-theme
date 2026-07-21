import assert from "node:assert/strict";
import test from "node:test";

import { projectThemeFamilyAdapter } from "../scripts/adapter-capability.mjs";

const invocation = {
  kind: "cc-theme.adapter-projector-invocation",
  schemaVersion: 1,
  adapterId: "mac-doubao",
  capabilityVersion: "1.3.0",
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
    surfaceCatalogVersion: 4,
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
    appearance: {
      paletteStrategy: "system",
      backdropBlurPx: 18,
      backgroundPosition: { xPercent: 50, yPercent: 50 },
    },
  });
  assert.ok(result.diagnostics.some(({ field, decision, code }) =>
    field === "tokens.fonts.code" && decision === "unsupported" && code === "host-native-typography"));
  assert.ok(result.diagnostics.some(({ field, decision }) => field === "tokens.appearance.shellMode" && decision === "unsupported"));
  assert.ok(result.diagnostics.some(({ field, decision, code }) =>
    field === "tokens.colors" && decision === "approximated" && code === "host-native-control-palette"));
});

test("namespaced palette strategy selects only host-safe system or adaptive paint", async () => {
  for (const paletteStrategy of ["system", "adaptive"]) {
    const candidate = structuredClone(invocation);
    candidate.targetProfiles["mac-doubao"] = {
      kind: "cc-theme.target-profile",
      schemaVersion: 1,
      adapterId: "mac-doubao",
      values: { paletteStrategy },
    };
    const result = await projectThemeFamilyAdapter(candidate);
    assert.equal(result.theme.appearance.paletteStrategy, paletteStrategy);
    assert.equal(result.theme.semanticColors.action, candidate.sharedCore.tokens.colors.action);
  }

  for (const paletteStrategy of ["custom", "automatic"]) {
    const invalid = structuredClone(invocation);
    invalid.targetProfiles["mac-doubao"] = {
      kind: "cc-theme.target-profile",
      schemaVersion: 1,
      adapterId: "mac-doubao",
      values: { paletteStrategy },
    };
    await assert.rejects(() => projectThemeFamilyAdapter(invalid), /paletteStrategy/i);
  }
});

test("semantic text, interaction, surface, status, and font hierarchy survives projection", async () => {
  const visual = structuredClone(invocation);
  Object.assign(visual.sharedCore.tokens.colors, {
    surfaceRaised: "#202431",
    surfaceElevated: "#2D3242",
    surfaceCode: "#191D27",
    textStrong: "#FFFFFF",
    borderSubtle: "rgba(214, 67, 82, .26)",
    borderStrong: "#E45766",
    actionHover: "#D13E54",
    actionPressed: "#96283A",
    hoverSurface: "rgba(228, 87, 102, .13)",
    pressedSurface: "rgba(228, 87, 102, .21)",
    selectedSurface: "rgba(184, 50, 72, .44)",
    selectedHoverSurface: "rgba(209, 62, 84, .57)",
    danger: "#F16A75",
    success: "#74C49D",
    warning: "#E4B263",
    headerSurface: "rgba(21, 24, 33, .87)",
  });
  visual.sharedCore.tokens.fonts.display = ["DIN Condensed", "system-ui"];
  visual.sharedCore.tokens.fonts.code = ["SFMono-Regular", "monospace"];
  visual.sharedCore.tokens.appearance.radiusScale = 0.92;

  const result = await projectThemeFamilyAdapter(visual);

  for (const key of ["surfaceRaised", "headerSurface"]) {
    assert.equal(result.theme.semanticColors[key], visual.sharedCore.tokens.colors[key], key);
    assert.equal(result.diagnostics.some(({ field, decision }) => field === `tokens.colors.${key}` && decision === "unsupported"), false, key);
  }
  for (const key of [
    "surfaceElevated", "surfaceCode", "textStrong", "borderSubtle", "actionHover", "actionPressed",
    "hoverSurface", "pressedSurface", "selectedSurface", "selectedHoverSurface",
  ]) {
    assert.equal(result.theme.semanticColors[key], undefined, key);
    assert.ok(result.diagnostics.some(({ field, decision, code }) =>
      field === `tokens.colors.${key}` && decision === "unsupported" && code === "host-native-control-paint"), key);
  }
  assert.equal(result.theme.fonts, undefined);
  for (const key of ["ui", "display", "code"]) {
    assert.ok(result.diagnostics.some(({ field, decision, code }) =>
      field === `tokens.fonts.${key}` && decision === "unsupported" && code === "host-native-typography"), key);
  }
  assert.equal(result.theme.semanticColors.borderStrong, undefined);
  assert.ok(result.diagnostics.some(({ field, code }) =>
    field === "tokens.colors.borderStrong" && code === "optional-color-consumer-unavailable"));
  for (const key of ["danger", "success", "warning"]) {
    assert.equal(result.theme.semanticColors[key], undefined);
    assert.ok(result.diagnostics.some(({ field, decision, code }) =>
      field === `tokens.colors.${key}` && decision === "unsupported" && code === "status-consumer-unverified"));
  }
  assert.equal(result.theme.appearance.radiusScale, undefined);
  assert.ok(result.diagnostics.some(({ field, code }) =>
    field === "tokens.appearance.radiusScale" && code === "geometry-policy-native"));
});

test("video is projected exactly while ripple and directional inputs remain visible static approximations", async () => {
  const media = structuredClone(invocation);
  media.sharedCore.background.video = "background.mp4";
  media.sharedCore.background.posterMode = "image";
  media.sharedCore.background.scrimOpacity = 0.34;
  media.assetBindings.video = "background.mp4";
  const mediaResult = await projectThemeFamilyAdapter(media);
  assert.equal(mediaResult.theme.backgroundVideo, "background.mp4");
  assert.equal(mediaResult.theme.appearance.backgroundVideoPosterMode, "image");
  assert.equal(mediaResult.theme.appearance.backgroundVideoScrimOpacity, 0.34);
  assert.deepEqual(mediaResult.theme.appearance.backgroundVideoPosition, { xPercent: 50, yPercent: 50 });
  assert.equal(mediaResult.diagnostics.some(({ code }) => code === "video-static-image-approximation"), false);

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
