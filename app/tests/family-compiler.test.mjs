import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  compiler,
  loadAdapterNormalizer,
  readFixture,
  runtimeRoot,
} from "./support/runtime-interface.mjs";

const { compileThemeFamily } = compiler;
const theme = await readFixture("fixtures/unified-theme.json");
const context = await readFixture("fixtures/compile-context.json");
const normalizeCodexTheme = await loadAdapterNormalizer("mac-codex");
const normalizeWorkBuddyTheme = await loadAdapterNormalizer("mac-workbuddy");

test("registry-driven compilation delegates to the two active Adapter projectors", async () => {
  const result = await compileThemeFamily(theme, context);

  assert.deepEqual(Object.keys(result.themes), ["mac-codex", "mac-workbuddy"]);
  assert.doesNotThrow(() => normalizeCodexTheme(result.themes["mac-codex"], "Manager Codex projection"));
  assert.doesNotThrow(() => normalizeWorkBuddyTheme(result.themes["mac-workbuddy"], "Manager WorkBuddy projection"));
  assert.equal(result.applyAvailability["mac-codex"].allowed, true);
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
