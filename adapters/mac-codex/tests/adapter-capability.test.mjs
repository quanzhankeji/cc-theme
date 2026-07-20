import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileAdapterTheme,
  describeAdapterCapability,
  executeCompileRequest,
  loadAdapterCapability,
  loadAdapterProjection,
  projectThemeFamilyAdapter,
} from "../scripts/adapter-capability.mjs";
import { assertSkinThemeIdentity, normalizeSkinTheme } from "../scripts/skin-theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapterVersion = (await fs.readFile(path.join(root, "VERSION"), "utf8")).trim();
const [capability, projection, profileSchema] = await Promise.all([
  loadAdapterCapability(),
  loadAdapterProjection(),
  fs.readFile(path.join(root, "contracts", "target-profile.schema.json"), "utf8").then(JSON.parse),
]);

assert.equal(capability.revision, 2);
assert.equal(capability.capabilityVersion, "2.0.0");
assert.equal(capability.adapterId, "mac-codex");
assert.equal(capability.adapterVersion, adapterVersion);
assert.equal(capability.adapterReleaseRevision, 1);
assert.deepEqual(capability.releaseTarget, {
  os: "macos",
  arch: "arm64",
  assetIdentity: `mac-codex-${adapterVersion}-r1-macos-arm64`,
});
assert.equal(capability.availability, "available");
assert.equal(capability.runtimeApplyAvailable, true);
assert.equal(capability.compatibility.clientVersionPolicy, "always-latest");
assert.equal(capability.compatibility.surfaceEvidenceIsGate, true);
assert.equal(capability.compatibility.currentEvidence.clientVersion, "26.715.31925");
assert.equal(capability.semanticContractStatus, "blocked-pending-manager-cross-validation");
assert.equal(capability.sharedCoreFieldDecisions.source, "adapter-projection.json");
assert.equal(capability.sharedCoreFieldDecisions.singleSourceOfTruth, true);
assert.equal(capability.localRuntimeOverrides.editableTokens.source, "theme-style-catalog.json");
assert.equal(capability.catalogs.uiSurfaceCatalogPolicy, "current-evidence-required");
assert.equal(profileSchema.properties.adapterId.const, "mac-codex");
assert.equal(profileSchema.additionalProperties, false);

const described = await describeAdapterCapability();
assert.deepEqual(described.resolved.sharedCoreFieldDecisions, projection.fields);
assert.deepEqual(described.resolved.targetProfileFieldDecisions, projection.targetProfileFields);
assert(described.resolved.editableTokenIds.includes("text.primary"));
assert(described.resolved.runtimeControlIds.includes("background.presentation"));
assert.equal(described.resolved.supportedLocales.length, 65);
assert.equal(described.resolved.defaultLocale, "en-US");
assert.deepEqual(described.resolved.rtlLocales, ["ar", "fa", "ur"]);

const colorTokens = [
  "surfaceBase", "surfaceRaised", "surfaceElevated", "surfaceCode", "text", "textStrong", "textMuted", "placeholder",
  "borderSubtle", "borderDefault", "borderStrong", "action", "actionHover", "actionPressed", "actionForeground",
  "hoverSurface", "pressedSurface", "selectedSurface", "selectedHoverSurface", "focusRing", "link", "danger", "success",
  "warning", "sidebarSurface", "headerSurface", "mainScrimStart", "mainScrimMid", "mainScrimEnd", "composerSurface",
];
const expectedSharedCore = [
  "identity.id", "identity.name",
  ...colorTokens.map((token) => `tokens.colors.${token}`),
  ...["ui", "display", "code"].map((token) => `tokens.fonts.${token}`),
  ...["shellMode", "backdropBlurPx", "backdropSaturation", "radiusScale", "backgroundPosition", "homeHeroPosition"].map((token) => `tokens.appearance.${token}`),
  ...["mode", "image", "homeHeroImage", "video", "posterMode", "scrimOpacity", "position", "intensity", "radiusPx", "quality", "atlas", "directions", "columns", "rows", "firstDirectionDegrees", "idleFrame", "origin"].map((token) => `background.${token}`),
  ...["reducedMotion", "minimumTextContrast", "minimumLargeTextContrast", "preserveSystemFocusRing", "transparencyFallback"].map((token) => `accessibility.${token}`),
];
const decisionByField = new Map();
for (const item of projection.fields) {
  assert(!decisionByField.has(item.field), `duplicate Projection field: ${item.field}`);
  decisionByField.set(item.field, item);
  assert(["required", "optional", "conditional"].includes(item.requirement));
  assert(["supported", "approximated", "unsupported"].includes(item.decision));
  assert(["exact", "approximate", "none"].includes(item.fidelity));
  if (item.decision !== "supported") assert.match(item.code ?? "", /^[a-z0-9-]+$/);
}
for (const field of expectedSharedCore) assert(decisionByField.has(field), `Projection is missing Unified Theme v2 field ${field}`);
assert.equal(decisionByField.get("tokens.fonts.ui").decision, "approximated");
assert.equal(decisionByField.get("tokens.fonts.code").decision, "unsupported");
assert.equal(projection.targetProfileFields.find((item) => item.field === "targetProfiles.mac-codex.copy.tagline")?.decision, "unsupported");

const requiredColors = {
  surfaceBase: "#10151F",
  text: "#E9EEF7",
  textMuted: "#AAB5C5",
  action: "#6699FF",
  actionForeground: "#FFFFFF",
  focusRing: "#8EB1FF",
  textStrong: "#112233",
  composerSurface: "rgba(1, 2, 3, 0.6)",
};
const baseRequest = {
  kind: "cc-theme.adapter-compile-request",
  adapterId: "mac-codex",
  sharedCore: {
    identity: { id: "family-sample", name: "Family Sample" },
    semanticColors: requiredColors,
    fonts: { ui: ["Inter", "system-ui"], display: ["Inter Display"], code: ["Mono"] },
    appearance: { colorScheme: "system" },
    background: {
      mode: "media",
      imageAsset: "background",
      videoAsset: "video",
      posterMode: "image",
      scrimOpacity: 0.2,
      position: { xPercent: 45, yPercent: 60 },
    },
    accessibility: { reduceMotion: "system" },
  },
  targetProfile: {
    kind: "cc-theme.target-profile",
    adapterId: "mac-codex",
    revision: 1,
    copy: { brandSubtitle: "CC Theme", tagline: "No renderer consumer" },
    art: { paletteMode: "system", analysis: "off" },
    appearance: { newTaskLayout: "cards" },
  },
  assetBindings: { background: "background.webp", video: "background.mp4" },
};

const compiled = compileAdapterTheme(structuredClone(baseRequest), projection);
assertSkinThemeIdentity(compiled.targetTheme);
assert.equal(compiled.targetTheme.image, "background.webp");
assert.equal(compiled.targetTheme.backgroundVideo, "background.mp4");
assert.deepEqual(compiled.targetTheme.colors, { text: "#E9EEF7", muted: "#AAB5C5" });
assert.equal(compiled.targetTheme.semanticColors.textStrong, "#112233");
assert.equal(compiled.targetTheme.appearance.shellMode, "auto");
assert.equal(compiled.targetTheme.appearance.backgroundVideoPosterMode, "image");
assert.deepEqual(compiled.targetTheme.appearance.backgroundPosition, { xPercent: 45, yPercent: 60 });
assert.equal(compiled.targetTheme.fonts.code, undefined);
assert.equal(compiled.targetTheme.tagline, undefined);
assert(compiled.diagnostics.some((item) => item.code === "font-ui-owned-surfaces-only"));
assert(compiled.diagnostics.some((item) => item.code === "font-code-runtime-unavailable"));
assert(compiled.diagnostics.some((item) => item.code === "copy-tagline-runtime-unavailable"));
const normalized = normalizeSkinTheme(compiled.targetTheme);
assert.equal(normalized.resolvedPalettes.dark.colors.text, "#E9EEF7");
assert.equal(normalized.resolvedPalettes.dark.colors.muted, "#AAB5C5");
assert.equal(normalized.appearance.backgroundVideoPosterMode, "image");

const backgroundOnly = structuredClone(baseRequest);
delete backgroundOnly.sharedCore.appearance.backgroundPosition;
assert.deepEqual(compileAdapterTheme(backgroundOnly, projection).targetTheme.appearance.backgroundPosition, { xPercent: 45, yPercent: 60 });

const legacyOnly = structuredClone(baseRequest);
legacyOnly.sharedCore.appearance.backgroundPosition = { xPercent: 20, yPercent: 30 };
delete legacyOnly.sharedCore.background.position;
const legacyResult = compileAdapterTheme(legacyOnly, projection);
assert.deepEqual(legacyResult.targetTheme.appearance.backgroundPosition, { xPercent: 20, yPercent: 30 });
assert(legacyResult.diagnostics.some((item) => item.code === "legacy-background-position-fallback"));

const samePosition = structuredClone(baseRequest);
samePosition.sharedCore.appearance.backgroundPosition = { xPercent: 45, yPercent: 60 };
const sameResult = compileAdapterTheme(samePosition, projection);
assert.equal(sameResult.diagnostics.some((item) => item.code === "legacy-background-position-fallback"), false);

const conflictingPosition = structuredClone(baseRequest);
conflictingPosition.sharedCore.appearance.backgroundPosition = { xPercent: 1, yPercent: 2 };
const conflictResult = await executeCompileRequest(conflictingPosition);
assert.equal(conflictResult.status, "failed");
assert.equal(conflictResult.code, "conflicting-background-position");

const directional = structuredClone(baseRequest);
directional.sharedCore.background = {
  mode: "directional",
  imageAsset: "background",
  directionalAtlasAsset: "atlas",
  position: { xPercent: 50, yPercent: 50 },
  directional: { directions: 16, columns: 4, rows: 4, idleFrame: 3, origin: { xPercent: 50, yPercent: 50 } },
};
directional.assetBindings = { background: "fallback.webp", atlas: "directions.webp" };
const directionalResult = await executeCompileRequest(directional);
assert.equal(directionalResult.status, "success");
assert.equal(directionalResult.targetTheme.interactiveBackground.type, "directional");

for (const mutate of [
  (request) => { request.assetBindings.background = "https://example.com/a.webp"; },
  (request) => { request.targetProfile.copy.tagline = "https://example.com/theme"; },
  (request) => { request.targetProfile.copy.tagline = "<strong>theme</strong>"; },
  (request) => { request.targetProfile.unknown = true; },
  (request) => { delete request.sharedCore.semanticColors.text; },
  (request) => { delete request.sharedCore.background.imageAsset; },
  (request) => { request.sharedCore.background.mode = "shader"; },
]) {
  const invalid = structuredClone(baseRequest);
  mutate(invalid);
  const result = await executeCompileRequest(invalid);
  assert.equal(result.status, "failed");
  assert.equal(Object.hasOwn(result, "targetTheme"), false);
}

const mismatchedProjection = structuredClone(projection);
mismatchedProjection.fields.find((item) => item.field === "background.mode").decision = "unsupported";
assert.throws(() => compileAdapterTheme(structuredClone(baseRequest), mismatchedProjection), /does not match the compiler/);

function managerInvocation(overrides = {}) {
  return {
    kind: "cc-theme.adapter-projector-invocation",
    schemaVersion: 1,
    adapterId: "mac-codex",
    capabilityVersion: "2.0.0",
    identity: { id: "manager-sample", name: "Manager Sample", version: "2.0.0" },
    sharedCore: {
      tokens: {
        colors: structuredClone(requiredColors),
        fonts: { ui: ["Inter"], display: ["Inter Display"], code: ["Mono"] },
        appearance: { shellMode: "dark", backgroundPosition: { xPercent: 40, yPercent: 50 } },
      },
      background: { mode: "media", image: "background.webp", video: "background.mp4", posterMode: "image", position: { xPercent: 40, yPercent: 50 } },
      accessibility: { reducedMotion: "static", minimumTextContrast: 4.5 },
    },
    targetProfiles: {
      "mac-codex": { kind: "cc-theme.target-profile", adapterId: "mac-codex", revision: 1, copy: { tagline: "omit" }, appearance: { videoPosition: { xPercent: 70, yPercent: 20 } } },
    },
    compileContext: {
      detectedClientVersion: "26.715.31925",
      detectedClientBuild: "5551",
      surfaceCatalogId: "chatgpt-macos-26.715.31925",
      probeStatus: "passed",
      compileAllowed: true,
      applyAllowed: true,
      localRuntimeOverrides: { baseThemeHash: null, entries: [] },
    },
    assetBindings: { background: "background.webp", video: "background.mp4" },
    ...overrides,
  };
}

const projected = await projectThemeFamilyAdapter(managerInvocation());
assert.equal(projected.status, "success");
assert.equal(projected.applyAllowed, true);
assert.deepEqual(projected.targetTheme.colors, { text: "#E9EEF7", muted: "#AAB5C5" });
assert.equal(projected.targetTheme.appearance.backgroundVideoPosterMode, "image");
assert.deepEqual(projected.targetTheme.appearance.backgroundPosition, { xPercent: 40, yPercent: 50 });
assert.deepEqual(projected.targetTheme.appearance.backgroundVideoPosition, { xPercent: 70, yPercent: 20 });
assert(projected.diagnostics.some((item) => item.code === "minimum-text-contrast-runtime-unavailable"));

const staleInvocation = managerInvocation();
staleInvocation.compileContext.detectedClientVersion = "26.715.31251";
const stale = await projectThemeFamilyAdapter(staleInvocation);
assert.equal(stale.status, "success");
assert.equal(stale.applyAllowed, false);
assert(stale.diagnostics.some((item) => item.code === "surface-evidence-client-version-mismatch"));

const compatibilityInvocation = managerInvocation();
compatibilityInvocation.compileContext.detectedClientVersion = "26.715.52143";
compatibilityInvocation.compileContext.detectedClientBuild = "6000";
compatibilityInvocation.compileContext.probeStatus = "not-run";
compatibilityInvocation.compileContext.reasonCode = "older-adapter-compatibility-attempt";
const compatibilityProjection = await projectThemeFamilyAdapter(compatibilityInvocation);
assert.equal(compatibilityProjection.status, "success");
assert.equal(compatibilityProjection.applyAllowed, true);
assert(compatibilityProjection.diagnostics.some((item) =>
  item.code === "older-adapter-runtime-probe-required" && item.severity === "warning"));

const missingEvidenceIdentityInvocation = managerInvocation();
delete missingEvidenceIdentityInvocation.compileContext.detectedClientBuild;
delete missingEvidenceIdentityInvocation.compileContext.surfaceCatalogId;
const missingEvidenceIdentity = await projectThemeFamilyAdapter(missingEvidenceIdentityInvocation);
assert.equal(missingEvidenceIdentity.applyAllowed, false);
assert(missingEvidenceIdentity.diagnostics.some((item) => item.code === "surface-evidence-client-build-mismatch"));
assert(missingEvidenceIdentity.diagnostics.some((item) => item.code === "surface-evidence-catalog-mismatch"));

const managerConflict = managerInvocation();
managerConflict.sharedCore.tokens.appearance.backgroundPosition = { xPercent: 1, yPercent: 2 };
const managerConflictResult = await projectThemeFamilyAdapter(managerConflict);
assert.equal(managerConflictResult.status, "failed");
assert.equal(managerConflictResult.code, "conflicting-background-position");

for (const mutate of [
  (value) => { value.sharedCore.background.shader = "void main(){}"; },
  (value) => { value.targetProfiles["mac-codex"].css = "body{}"; },
  (value) => { value.assetBindings.background = "https://example.invalid/background.webp"; },
]) {
  const unsafe = managerInvocation();
  mutate(unsafe);
  const result = await projectThemeFamilyAdapter(unsafe);
  assert.equal(result.status, "failed");
  assert.equal(result.code, "invalid-design-data");
}

console.log("adapter-capability.test.mjs: ok");
