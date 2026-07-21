import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  compiler,
  loadAdapterNormalizer,
  managerRoot,
  readFixture,
  runtimeRoot,
} from "./support/runtime-interface.mjs";

const { compileThemeFamily } = compiler;
const theme = await readFixture("fixtures/unified-theme.json");
const context = await readFixture("fixtures/compile-context.json");
const normalizeCodexTheme = await loadAdapterNormalizer("mac-codex");
const normalizeDoubaoTheme = await loadAdapterNormalizer("mac-doubao");
const normalizeWorkBuddyTheme = await loadAdapterNormalizer("mac-workbuddy");

test("registry-driven compilation delegates to the active Adapter projectors", async () => {
  const result = await compileThemeFamily(theme, context);

  assert.deepEqual(Object.keys(result.themes), ["mac-codex", "mac-doubao", "mac-workbuddy"]);
  assert.doesNotThrow(() => normalizeCodexTheme(result.themes["mac-codex"], "Manager Codex projection"));
  assert.doesNotThrow(() => normalizeDoubaoTheme(result.themes["mac-doubao"], "Manager Doubao projection"));
  assert.doesNotThrow(() => normalizeWorkBuddyTheme(result.themes["mac-workbuddy"], "Manager WorkBuddy projection"));
  assert.equal(result.applyAvailability["mac-codex"].allowed, true);
  assert.equal(result.applyAvailability["mac-doubao"].allowed, true);
  assert.equal(result.applyAvailability["mac-workbuddy"].allowed, true);
});

test("the unified sample matches Adapter-owned target golden artifacts", async () => {
  const result = await compileThemeFamily(theme, context);
  for (const adapterId of theme.targets) {
    const golden = await readFixture(`golden/${adapterId}.theme.json`);
    assert.deepEqual(result.themes[adapterId], golden, adapterId);
  }
});

test("Manager uses one neutral registered projector invocation without host request builders", async () => {
  const compiler = await readFile(path.join(runtimeRoot, "theme-core/compiler.mjs"), "utf8");
  for (const forbidden of ["REQUEST_BUILDERS", "buildCodexInvocation", "buildLegacyInvocation"]) {
    assert.equal(compiler.includes(forbidden), false, forbidden);
  }
  assert.equal(compiler.includes("cc-theme.adapter-projector-invocation"), true);
});

test("Adapter projectors own home Hero mapping and expose unsupported accessibility decisions", async () => {
  const source = structuredClone(theme);
  source.sharedCore.background.homeHeroImage = "hero.webp";
  const result = await compileThemeFamily(source, context);

  assert.equal(result.themes["mac-codex"].homeHeroImage, "hero.webp");
  assert.equal(result.themes["mac-workbuddy"].homeHeroImage, undefined);
  assert.ok(result.diagnostics["mac-workbuddy"].some(({ code }) => code === "home-hero-unsupported"));

  const optionalAccessibility = [
    "minimumTextContrast", "minimumLargeTextContrast", "preserveSystemFocusRing", "transparencyFallback",
  ];
  for (const adapterId of source.targets) {
    const visible = new Set(result.diagnostics[adapterId].map((item) => item.field ?? item.path));
    for (const field of optionalAccessibility) {
      assert.equal(visible.has(`accessibility.${field}`), true, `${adapterId}: accessibility.${field}`);
    }
  }
});

test("WorkBuddy exposes visible approximation and omission without serializing dormant semantic keys", async () => {
  const source = structuredClone(theme);
  Object.assign(source.sharedCore.tokens.colors, {
    surfaceCode: "#111111",
    borderStrong: "#222222",
    selectedHoverSurface: "#333333",
    success: "#00AA00",
    warning: "#AA8800"
  });
  source.sharedCore.background.homeHeroImage = "hero.webp";

  const result = await compileThemeFamily(source, context);
  const workbuddy = result.themes["mac-workbuddy"];
  for (const dormant of ["surfaceCode", "borderStrong", "selectedHoverSurface", "success", "warning"]) {
    assert.equal(Object.hasOwn(workbuddy.semanticColors, dormant), false, dormant);
  }
  const codes = new Set(result.diagnostics["mac-workbuddy"].map(({ code }) => code));
  assert.equal(codes.has("approximated-surface-code"), true);
  assert.equal(codes.has("optional-field-unsupported"), true);
  assert.equal(codes.has("home-hero-unsupported"), true);
});

test("Doubao projects structural consumers while keeping native controls and ripple decisions visible", async () => {
  const source = structuredClone(theme);
  Object.assign(source.sharedCore.tokens.colors, {
    surfaceCode: "#111111",
    textStrong: "#FFFFFF",
    actionHover: "#777777",
    actionPressed: "#555555",
    success: "#00AA00",
    warning: "#AA8800",
  });
  const result = await compileThemeFamily(source, context, { targetAdapterIds: ["mac-doubao"] });
  const doubao = result.themes["mac-doubao"];

  assert.deepEqual(Object.keys(result.themes), ["mac-doubao"]);
  assert.equal(doubao.backgroundVideo, undefined);
  assert.equal(doubao.interactiveBackground, undefined);
  assert.equal(doubao.fonts, undefined);
  assert.equal(doubao.appearance.shellMode, undefined);
  assert.equal(doubao.appearance.radiusScale, undefined);
  for (const consumed of ["surfaceCode", "textStrong", "actionHover", "actionPressed"]) {
    assert.equal(Object.hasOwn(doubao.semanticColors, consumed), false, consumed);
  }
  for (const unsupported of ["success", "warning"]) {
    assert.equal(Object.hasOwn(doubao.semanticColors, unsupported), false, unsupported);
  }
  const codes = new Set(result.diagnostics["mac-doubao"].map(({ code }) => code));
  assert.equal(codes.has("ripple-static-image-approximation"), true);
  assert.equal(codes.has("geometry-policy-native"), true);
  assert.equal(codes.has("host-shell-mode-authority"), true);
  assert.equal(codes.has("status-consumer-unverified"), true);
  assert.equal(codes.has("host-native-control-paint"), true);
  assert.equal(codes.has("host-native-typography"), true);
  assert.doesNotThrow(() => normalizeDoubaoTheme(doubao, "Manager Doubao static approximation"));
});

test("the standard example has a selected-only Doubao golden and complete visible diagnostics", async () => {
  const source = JSON.parse(await readFile(path.join(managerRoot, "..", "themes", "example", "unified-theme.json"), "utf8"));
  const result = await compileThemeFamily(source, context, { targetAdapterIds: ["mac-doubao"] });
  const golden = await readFixture("golden/example.mac-doubao.theme.json");
  assert.deepEqual(Object.keys(result.themes), ["mac-doubao"]);
  assert.deepEqual(result.themes["mac-doubao"], golden);
  assert.deepEqual(
    result.diagnostics["mac-doubao"].map(({ field, decision, code }) => ({ field, decision, code })),
    [
      { field: "tokens.colors", decision: "approximated", code: "host-native-control-palette" },
      { field: "tokens.colors.text", decision: "approximated", code: "host-native-control-paint" },
      { field: "tokens.colors.textMuted", decision: "approximated", code: "host-native-control-paint" },
      { field: "tokens.colors.action", decision: "approximated", code: "host-native-control-paint" },
      { field: "tokens.colors.actionForeground", decision: "approximated", code: "host-native-control-paint" },
      { field: "tokens.colors.focusRing", decision: "approximated", code: "host-native-control-paint" },
      { field: "tokens.colors.danger", decision: "unsupported", code: "status-consumer-unverified" },
      { field: "tokens.colors.success", decision: "unsupported", code: "status-consumer-unverified" },
      { field: "tokens.colors.warning", decision: "unsupported", code: "status-consumer-unverified" },
      { field: "tokens.colors.surfaceElevated", decision: "unsupported", code: "host-native-control-paint" },
      { field: "tokens.colors.textStrong", decision: "unsupported", code: "host-native-control-paint" },
      { field: "tokens.colors.placeholder", decision: "unsupported", code: "host-native-control-paint" },
      { field: "tokens.colors.borderSubtle", decision: "unsupported", code: "host-native-control-paint" },
      { field: "tokens.colors.borderDefault", decision: "unsupported", code: "host-native-control-paint" },
      { field: "tokens.colors.actionHover", decision: "unsupported", code: "host-native-control-paint" },
      { field: "tokens.colors.actionPressed", decision: "unsupported", code: "host-native-control-paint" },
      { field: "tokens.colors.hoverSurface", decision: "unsupported", code: "host-native-control-paint" },
      { field: "tokens.colors.pressedSurface", decision: "unsupported", code: "host-native-control-paint" },
      { field: "tokens.colors.selectedSurface", decision: "unsupported", code: "host-native-control-paint" },
      { field: "tokens.colors.link", decision: "unsupported", code: "host-native-control-paint" },
      { field: "tokens.colors.composerSurface", decision: "unsupported", code: "host-native-control-paint" },
      { field: "tokens.fonts.ui", decision: "unsupported", code: "host-native-typography" },
      { field: "tokens.fonts.display", decision: "unsupported", code: "host-native-typography" },
      { field: "tokens.fonts.code", decision: "unsupported", code: "host-native-typography" },
      { field: "tokens.appearance.radiusScale", decision: "unsupported", code: "geometry-policy-native" },
      { field: "tokens.appearance.shellMode", decision: "unsupported", code: "host-shell-mode-authority" },
      { field: "accessibility.minimumTextContrast", decision: "unsupported", code: "contrast-audit-unavailable" },
      { field: "accessibility.minimumLargeTextContrast", decision: "unsupported", code: "contrast-audit-unavailable" },
      { field: "accessibility.preserveSystemFocusRing", decision: "exact", code: "host-focus-preserved" },
      { field: "accessibility.transparencyFallback", decision: "unsupported", code: "transparency-preference-unavailable" },
    ],
  );
});

test("WorkBuddy scoped compilation accepts the complete real Manager nine-key context with nullable or safe host facts", async () => {
  const source = structuredClone(theme);
  source.sharedCore.background = {
    mode: "media",
    image: "background.jpg",
    video: "background.mp4",
    posterMode: "image",
    scrimOpacity: 0.2,
    position: { xPercent: 50, yPercent: 42 },
  };
  source.targetProfiles["mac-workbuddy"] = {
    kind: "cc-theme.target-profile",
    schemaVersion: 1,
    adapterId: "mac-workbuddy",
    values: {
      paletteStrategy: "system",
      backgroundVideoPosterMode: "image",
    },
  };
  const nullBuild = structuredClone(context);
  nullBuild.adapters["mac-workbuddy"].detectedClientBuild = null;
  const safeStringBuild = structuredClone(context);
  safeStringBuild.adapters["mac-workbuddy"].detectedClientBuild = "526.20260719 release";
  safeStringBuild.adapters["mac-workbuddy"].surfaceCatalogId = "workbuddy-macos-5.2.6-v2";

  const first = await compileThemeFamily(source, nullBuild, { targetAdapterIds: ["mac-workbuddy"] });
  const second = await compileThemeFamily(source, safeStringBuild, { targetAdapterIds: ["mac-workbuddy"] });

  assert.deepEqual(Object.keys(first.themes), ["mac-workbuddy"]);
  assert.deepEqual(first.themes["mac-workbuddy"], second.themes["mac-workbuddy"]);
  assert.equal(first.applyAvailability["mac-workbuddy"].allowed, true);
  assert.equal(second.applyAvailability["mac-workbuddy"].allowed, true);
  assert.doesNotThrow(() => normalizeWorkBuddyTheme(first.themes["mac-workbuddy"], "Manager WOLP-shaped projection"));
});

test("the compiler accepts only the first-version Shared Core source", async () => {
  const unsupportedDraft = structuredClone(theme);
  unsupportedDraft.schemaVersion = 2;
  await assert.rejects(
    () => compileThemeFamily(unsupportedDraft, context),
    /schemaVersion 1/,
  );
});
