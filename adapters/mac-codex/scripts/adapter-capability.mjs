import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertSkinThemeIdentity, normalizeSkinTheme } from "./skin-theme.mjs";
import { loadStyleCatalog } from "./theme-style-catalog.mjs";
import { loadThemeEditorLocales } from "./theme-editor-locales.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
export const ADAPTER_CAPABILITY_PATH = path.join(root, "contracts", "adapter-capability.json");
export const ADAPTER_PROJECTION_PATH = path.join(root, "contracts", "adapter-projection.json");
export const TARGET_PROFILE_SCHEMA_PATH = path.join(root, "contracts", "target-profile.schema.json");
const VERSION_PATH = path.join(root, "VERSION");
const ADAPTER_RELEASE_MANIFEST_PATH = path.join(root, "contracts", "adapter-release-manifest.json");
export const ADAPTER_ID = "mac-codex";
export const COMPILE_REQUEST_KIND = "cc-theme.adapter-compile-request";
export const COMPILE_RESULT_KIND = "cc-theme.adapter-compile-result";
export const MANAGER_PROJECTOR_INVOCATION_KIND = "cc-theme.adapter-projector-invocation";
const MAX_REQUEST_BYTES = 1024 * 1024;

const TOP_LEVEL = new Set(["kind", "adapterId", "sharedCore", "targetProfile", "assetBindings"]);
const SHARED_TOP_LEVEL = new Set(["identity", "semanticColors", "fonts", "appearance", "background", "accessibility"]);
const IDENTITY_KEYS = new Set(["id", "name"]);
const SEMANTIC_COLOR_KEYS = new Set([
  "surfaceBase", "surfaceRaised", "surfaceElevated", "surfaceCode", "text", "textStrong", "textMuted", "placeholder",
  "borderSubtle", "borderDefault", "borderStrong", "action", "actionHover", "actionPressed",
  "actionForeground", "hoverSurface", "pressedSurface", "selectedSurface", "selectedHoverSurface",
  "focusRing", "link", "danger", "success", "warning", "sidebarSurface", "headerSurface",
  "mainScrimStart", "mainScrimMid", "mainScrimEnd", "composerSurface",
]);
const REQUIRED_SEMANTIC_COLOR_KEYS = Object.freeze([
  "surfaceBase", "text", "textMuted", "action", "actionForeground", "focusRing",
]);
const FONT_KEYS = new Set(["ui", "display", "code"]);
const SHARED_APPEARANCE_KEYS = new Set(["colorScheme", "backgroundPosition", "windowMaterial"]);
const BACKGROUND_KEYS = new Set([
  "mode", "imageAsset", "homeHeroAsset", "videoAsset", "directionalAtlasAsset", "posterMode", "scrimOpacity", "position",
  "ripple", "directional", "continuousAvatar",
]);
const V2_BACKGROUND_KEYS = new Set([
  "mode", "image", "homeHeroImage", "video", "posterMode", "scrimOpacity", "position",
  "intensity", "radiusPx", "quality", "atlas", "directions", "columns", "rows",
  "firstDirectionDegrees", "idleFrame", "origin",
]);
const RIPPLE_KEYS = new Set(["intensity", "radiusPx", "quality"]);
const DIRECTIONAL_KEYS = new Set([
  "directions", "columns", "rows", "firstDirectionDegrees", "idleFrame", "origin",
]);
const ACCESSIBILITY_KEYS = new Set(["reduceMotion", "highContrast"]);
const PROFILE_KEYS = new Set(["kind", "adapterId", "revision", "copy", "art", "appearance", "homeHeroAsset"]);
const COPY_KEYS = new Set(["brandSubtitle", "tagline", "projectPrefix", "projectLabel", "statusText", "quote"]);
const ART_KEYS = new Set(["analysis", "focusX", "focusY", "safeArea", "taskMode", "paletteMode", "adaptivePalette"]);
const PROFILE_APPEARANCE_KEYS = new Set([
  "newTaskLayout", "videoPosterMode", "videoPosition", "homeHeroPosition",
  "backdropBlurPx", "backdropSaturation", "radiusScale", "reduceParticles",
]);
const POSITION_KEYS = new Set(["xPercent", "yPercent"]);
const COLOR = /^(?:#[0-9A-Fa-f]{6}|rgba?\([0-9., %]+\))$/;
const ASSET_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SAFE_FILE = /^[A-Za-z0-9_.-]+$/;
const MANAGER_COMPILE_CONTEXT_KEYS = new Set([
  "detectedClientVersion", "detectedClientBuild", "surfaceCatalogId", "surfaceCatalogVersion",
  "probeStatus", "compileAllowed", "applyAllowed", "reasonCode", "localRuntimeOverrides",
]);
const LOCAL_RUNTIME_OVERRIDE_KEYS = new Set(["baseThemeHash", "entries"]);
const LOCAL_RUNTIME_OVERRIDE_ENTRY_KEYS = new Set(["tokenId", "baseHash", "value"]);
const SAFE_CONTEXT_TEXT = /^[A-Za-z0-9._:+-]{1,160}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function allowedObject(value, keys, label, optional = false) {
  if (value === undefined && optional) return {};
  const object = plainObject(value, label);
  const unknown = Object.keys(object).filter((key) => !keys.has(key));
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}`);
  return object;
}

function managerCompileContext(value) {
  const context = allowedObject(value, MANAGER_COMPILE_CONTEXT_KEYS, "Adapter projector compile context");
  const missing = [...MANAGER_COMPILE_CONTEXT_KEYS].filter((key) => !Object.hasOwn(context, key));
  if (missing.length) throw new Error(`Adapter projector compile context is missing fields: ${missing.join(", ")}`);
  for (const key of ["detectedClientVersion", "detectedClientBuild", "surfaceCatalogId"]) {
    if (context[key] !== null && (typeof context[key] !== "string" || !SAFE_CONTEXT_TEXT.test(context[key]))) {
      throw new Error(`Adapter projector compile context ${key} is invalid`);
    }
  }
  if (!Number.isSafeInteger(context.surfaceCatalogVersion) || context.surfaceCatalogVersion < 1) {
    throw new Error("Adapter projector compile context surfaceCatalogVersion must be a positive integer");
  }
  enumValue(context.probeStatus, ["passed", "failed", "not-run", "unavailable"], "Adapter projector compile context probeStatus");
  if (typeof context.compileAllowed !== "boolean" || typeof context.applyAllowed !== "boolean") {
    throw new Error("Adapter projector compile context admission values must be booleans");
  }
  if (context.reasonCode !== null && (typeof context.reasonCode !== "string" || !SAFE_CONTEXT_TEXT.test(context.reasonCode))) {
    throw new Error("Adapter projector compile context reasonCode is invalid");
  }
  const overrides = allowedObject(context.localRuntimeOverrides, LOCAL_RUNTIME_OVERRIDE_KEYS,
    "Adapter projector compile context localRuntimeOverrides");
  if (overrides.baseThemeHash !== null && (typeof overrides.baseThemeHash !== "string" || !SHA256.test(overrides.baseThemeHash))) {
    throw new Error("Adapter projector compile context localRuntimeOverrides.baseThemeHash is invalid");
  }
  if (!Array.isArray(overrides.entries) || overrides.entries.length > 256) {
    throw new Error("Adapter projector compile context localRuntimeOverrides.entries is invalid");
  }
  for (const entry of overrides.entries) {
    const item = allowedObject(entry, LOCAL_RUNTIME_OVERRIDE_ENTRY_KEYS,
      "Adapter projector compile context localRuntimeOverrides entry");
    if (typeof item.tokenId !== "string" || !/^[a-z][A-Za-z0-9.-]{0,119}$/.test(item.tokenId) ||
        typeof item.baseHash !== "string" || !SHA256.test(item.baseHash) || !Object.hasOwn(item, "value")) {
      throw new Error("Adapter projector compile context localRuntimeOverrides entry is invalid");
    }
  }
  return context;
}

function localAssetId(value, label) {
  if (typeof value !== "string" || !ASSET_ID.test(value)) throw new Error(`${label} must be a stable local asset id`);
  return value;
}

function position(value, label) {
  const object = allowedObject(value, POSITION_KEYS, label);
  for (const key of POSITION_KEYS) {
    if (!Number.isFinite(object[key]) || object[key] < 0 || object[key] > 100) {
      throw new Error(`${label}.${key} must be a number from 0 to 100`);
    }
  }
  return { xPercent: object.xPercent, yPercent: object.yPercent };
}

function optionalNumber(value, minimum, maximum, label) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a number from ${minimum} to ${maximum}`);
  }
  return value;
}

function enumValue(value, choices, label, optional = false) {
  if (value === undefined && optional) return undefined;
  if (!choices.includes(value)) throw new Error(`${label} must be one of: ${choices.join(", ")}`);
  return value;
}

function safeText(value, maximum, label) {
  if (typeof value !== "string" || value.length > maximum) throw new Error(`${label} must be a string no longer than ${maximum}`);
  if (/[<>\u0000-\u001f\u007f]/u.test(value) || /(?:\b(?:https?|file|data|javascript):|\bwww\.)/iu.test(value)) {
    throw new Error(`${label} must be plain local copy without HTML, URLs, or executable schemes`);
  }
  return value;
}

function validateTargetProfile(value = {}) {
  const profile = allowedObject(value, PROFILE_KEYS, "targetProfile");
  if (profile.kind !== "cc-theme.target-profile" || profile.adapterId !== ADAPTER_ID || profile.revision !== 1) {
    throw new Error("targetProfile has an invalid Mac Codex identity");
  }
  const copy = allowedObject(profile.copy, COPY_KEYS, "targetProfile.copy", true);
  for (const [key, maximum] of Object.entries({ brandSubtitle: 80, tagline: 160, projectPrefix: 80, projectLabel: 80, statusText: 80, quote: 80 })) {
    if (copy[key] !== undefined) safeText(copy[key], maximum, `targetProfile.copy.${key}`);
  }
  const art = allowedObject(profile.art, ART_KEYS, "targetProfile.art", true);
  if (art.analysis !== undefined) enumValue(art.analysis, ["auto", "off"], "targetProfile.art.analysis");
  if (art.safeArea !== undefined) enumValue(art.safeArea, ["auto", "left", "right", "center", "none"], "targetProfile.art.safeArea");
  if (art.taskMode !== undefined) enumValue(art.taskMode, ["auto", "ambient", "banner", "off"], "targetProfile.art.taskMode");
  if (art.paletteMode !== undefined) enumValue(art.paletteMode, ["system", "media"], "targetProfile.art.paletteMode");
  for (const key of ["focusX", "focusY"]) optionalNumber(art[key], 0, 1, `targetProfile.art.${key}`);
  if (art.adaptivePalette !== undefined && typeof art.adaptivePalette !== "boolean") throw new Error("targetProfile.art.adaptivePalette must be boolean");
  const appearance = allowedObject(profile.appearance, PROFILE_APPEARANCE_KEYS, "targetProfile.appearance", true);
  if (appearance.newTaskLayout !== undefined) enumValue(appearance.newTaskLayout, ["cards", "banner"], "targetProfile.appearance.newTaskLayout");
  if (appearance.videoPosterMode !== undefined) enumValue(appearance.videoPosterMode, ["none", "image"], "targetProfile.appearance.videoPosterMode");
  if (appearance.videoPosition !== undefined) position(appearance.videoPosition, "targetProfile.appearance.videoPosition");
  if (appearance.homeHeroPosition !== undefined) position(appearance.homeHeroPosition, "targetProfile.appearance.homeHeroPosition");
  optionalNumber(appearance.backdropBlurPx, 0, 48, "targetProfile.appearance.backdropBlurPx");
  optionalNumber(appearance.backdropSaturation, 0.5, 1.5, "targetProfile.appearance.backdropSaturation");
  optionalNumber(appearance.radiusScale, 0.75, 1.5, "targetProfile.appearance.radiusScale");
  if (appearance.reduceParticles !== undefined && typeof appearance.reduceParticles !== "boolean") throw new Error("targetProfile.appearance.reduceParticles must be boolean");
  if (profile.homeHeroAsset !== undefined) localAssetId(profile.homeHeroAsset, "targetProfile.homeHeroAsset");
  return { ...profile, copy, art, appearance };
}

function validateAssetBindings(value) {
  const bindings = plainObject(value, "assetBindings");
  const normalized = {};
  for (const [id, file] of Object.entries(bindings)) {
    localAssetId(id, `assetBindings.${id}`);
    if (typeof file !== "string" || !SAFE_FILE.test(file) || file.includes("..") || /^(?:https?:|file:|data:|blob:)/i.test(file)) {
      throw new Error(`assetBindings.${id} must be a safe package-local filename`);
    }
    normalized[id] = file;
  }
  return normalized;
}

function resolveAsset(id, bindings, extensions, label) {
  const key = localAssetId(id, label);
  const file = bindings[key];
  if (!file) throw new Error(`${label} is not present in assetBindings`);
  if (!extensions.some((extension) => file.toLowerCase().endsWith(extension))) {
    throw new Error(`${label} resolves to an unsupported media type`);
  }
  return file;
}

function diagnostic(field, decision, message, target = null, fidelity = null) {
  return { field, decision, ...(fidelity ? { fidelity } : {}), ...(target ? { target } : {}), message };
}

function projectionDiagnostic(item, field, fallback) {
  return {
    ...diagnostic(field, item.decision, item.diagnostic ?? item.mapping ?? fallback, item.target, item.fidelity),
    ...(item.code ? { code: item.code } : {}),
  };
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function samePosition(left, right) {
  return left.xPercent === right.xPercent && left.yPercent === right.yPercent;
}

export async function loadAdapterCapability(file = ADAPTER_CAPABILITY_PATH) {
  const [capability, adapterVersion, releaseManifest] = await Promise.all([
    fs.readFile(file, "utf8").then(JSON.parse),
    fs.readFile(VERSION_PATH, "utf8").then((value) => value.trim()),
    fs.readFile(ADAPTER_RELEASE_MANIFEST_PATH, "utf8").then(JSON.parse),
  ]);
  if (capability.kind !== "cc-theme.adapter-capability" || capability.adapterId !== ADAPTER_ID || capability.revision !== 2) {
    throw new Error("Mac Codex capability has an invalid identity");
  }
  const expectedAssetIdentity = `${ADAPTER_ID}-${adapterVersion}-r${releaseManifest.adapterReleaseRevision}-macos-arm64`;
  if (!/^\d+(?:\.\d+){2}$/.test(adapterVersion) ||
      !Number.isSafeInteger(releaseManifest.adapterReleaseRevision) || releaseManifest.adapterReleaseRevision < 1 ||
      capability.adapterVersion !== adapterVersion ||
      capability.adapterReleaseRevision !== releaseManifest.adapterReleaseRevision ||
      capability.releaseTarget?.os !== "macos" || capability.releaseTarget?.arch !== "arm64" ||
      capability.releaseTarget?.assetIdentity !== expectedAssetIdentity ||
      capability.compatibility?.currentEvidence?.clientVersion !== adapterVersion) {
    throw new Error("Mac Codex capability does not match the frozen Adapter release identity");
  }
  return capability;
}

export async function loadAdapterProjection(file = ADAPTER_PROJECTION_PATH) {
  const projection = JSON.parse(await fs.readFile(file, "utf8"));
  if (projection.kind !== "cc-theme.adapter-projection" || projection.adapterId !== ADAPTER_ID || projection.revision !== 2 ||
      !Array.isArray(projection.fields) || !Array.isArray(projection.targetProfileFields)) {
    throw new Error("Mac Codex projection has an invalid identity");
  }
  const fields = new Set();
  for (const item of [...projection.fields, ...projection.targetProfileFields]) {
    if (!item || typeof item !== "object" || typeof item.field !== "string" || fields.has(item.field) ||
        !["required", "optional", "conditional"].includes(item.requirement) ||
        !["supported", "approximated", "unsupported"].includes(item.decision) ||
        !["exact", "approximate", "none"].includes(item.fidelity)) {
      throw new Error("Mac Codex projection contains an invalid field decision");
    }
    fields.add(item.field);
  }
  return projection;
}

export async function describeAdapterCapability() {
  const styleCatalogPromise = loadStyleCatalog();
  const [capability, projection, targetProfileSchema, styleCatalog, editorLocales] = await Promise.all([
    loadAdapterCapability(),
    loadAdapterProjection(),
    fs.readFile(TARGET_PROFILE_SCHEMA_PATH, "utf8").then(JSON.parse),
    styleCatalogPromise,
    styleCatalogPromise.then((catalog) => loadThemeEditorLocales(catalog)),
  ]);
  return {
    ...capability,
    resolved: {
      sharedCoreFieldDecisions: projection.fields,
      targetProfileFieldDecisions: projection.targetProfileFields,
      targetProfileSchema,
      editableTokenIds: styleCatalog.tokens.map((token) => token.id),
      runtimeControlIds: styleCatalog.runtimeControls.map((control) => control.id),
      supportedLocales: editorLocales.locales,
      defaultLocale: editorLocales.defaultLocale,
      rtlLocales: editorLocales.rtlLocales,
    },
  };
}

function projectionIndex(projection) {
  return new Map([...projection.fields, ...(projection.targetProfileFields ?? [])].map((item) => [item.field, item]));
}

function requireProjection(index, field, expectedDecision = null) {
  const item = index.get(field);
  if (!item) throw new Error(`Adapter Projection does not declare ${field}`);
  if (expectedDecision && item.decision !== expectedDecision) {
    throw new Error(`Adapter Projection decision for ${field} does not match the compiler`);
  }
  return item;
}

export function compileAdapterTheme(request, projection) {
  const mapping = projectionIndex(plainObject(projection, "adapter projection"));
  const input = allowedObject(request, TOP_LEVEL, "compile request");
  if (input.kind !== COMPILE_REQUEST_KIND || input.adapterId !== ADAPTER_ID) throw new Error("compile request has an invalid adapter identity");
  const core = allowedObject(input.sharedCore, SHARED_TOP_LEVEL, "sharedCore");
  const identity = allowedObject(core.identity, IDENTITY_KEYS, "sharedCore.identity");
  if (typeof identity.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(identity.id)) throw new Error("sharedCore.identity.id is invalid");
  if (typeof identity.name !== "string" || !identity.name.trim() || identity.name.length > 80) throw new Error("sharedCore.identity.name is invalid");
  const semanticColors = allowedObject(core.semanticColors, SEMANTIC_COLOR_KEYS, "sharedCore.semanticColors", true);
  for (const [key, value] of Object.entries(semanticColors)) {
    if (typeof value !== "string" || !COLOR.test(value.trim())) throw new Error(`sharedCore.semanticColors.${key} is invalid`);
    semanticColors[key] = value.trim();
  }
  for (const key of REQUIRED_SEMANTIC_COLOR_KEYS) {
    if (semanticColors[key] === undefined) throw codedError("required-shared-core-token-missing", `sharedCore.semanticColors.${key} is required`);
  }
  const fonts = allowedObject(core.fonts, FONT_KEYS, "sharedCore.fonts", true);
  for (const [key, value] of Object.entries(fonts)) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 8 || value.some((item) => typeof item !== "string" || !/^[\p{L}\p{N} ._-]{1,80}$/u.test(item))) {
      throw new Error(`sharedCore.fonts.${key} is invalid`);
    }
  }
  const appearance = allowedObject(core.appearance, SHARED_APPEARANCE_KEYS, "sharedCore.appearance", true);
  const background = allowedObject(core.background, BACKGROUND_KEYS, "sharedCore.background");
  const accessibility = allowedObject(core.accessibility, ACCESSIBILITY_KEYS, "sharedCore.accessibility", true);
  const profile = validateTargetProfile(input.targetProfile);
  const bindings = validateAssetBindings(input.assetBindings);
  const diagnostics = [];

  requireProjection(mapping, "identity.id", "supported");
  requireProjection(mapping, "identity.name", "supported");
  for (const key of Object.keys(semanticColors)) requireProjection(mapping, `tokens.colors.${key}`, "supported");
  for (const key of Object.keys(fonts)) requireProjection(mapping, `tokens.fonts.${key}`);

  requireProjection(mapping, "background.mode", "supported");
  requireProjection(mapping, "background.image", "supported");
  const mode = enumValue(background.mode, ["media", "ripple", "directional"], "sharedCore.background.mode");
  const image = resolveAsset(background.imageAsset, bindings, [".png", ".jpg", ".jpeg", ".webp"], "sharedCore.background.imageAsset");
  const target = { kind: "skin.theme", id: identity.id, name: identity.name.trim(), image };
  const targetColors = { text: semanticColors.text, muted: semanticColors.textMuted };
  const targetSemanticColors = Object.fromEntries(Object.entries(semanticColors).filter(([key]) => key !== "text" && key !== "textMuted"));
  target.colors = targetColors;
  if (Object.keys(targetSemanticColors).length) target.semanticColors = targetSemanticColors;
  const targetFonts = {};
  if (fonts.ui !== undefined) {
    const decision = requireProjection(mapping, "tokens.fonts.ui", "approximated");
    targetFonts.ui = fonts.ui;
    diagnostics.push(projectionDiagnostic(decision, "tokens.fonts.ui", "The UI font is applied to verified owned surfaces only."));
  }
  if (fonts.display !== undefined) {
    requireProjection(mapping, "tokens.fonts.display", "supported");
    targetFonts.display = fonts.display;
  }
  if (fonts.code !== undefined) {
    const decision = requireProjection(mapping, "tokens.fonts.code", "unsupported");
    diagnostics.push(projectionDiagnostic(decision, "tokens.fonts.code", "The optional code font was omitted."));
  }
  if (Object.keys(targetFonts).length) target.fonts = targetFonts;
  Object.assign(target, Object.fromEntries(Object.entries(profile.copy).filter(([key]) => key !== "tagline")));
  if (profile.copy.tagline !== undefined) {
    const decision = requireProjection(mapping, "targetProfiles.mac-codex.copy.tagline", "unsupported");
    diagnostics.push(projectionDiagnostic(decision, "targetProfiles.mac-codex.copy.tagline", "The optional tagline was omitted."));
  }
  const homeHeroAsset = background.homeHeroAsset ?? profile.homeHeroAsset;
  if (homeHeroAsset) {
    if (background.homeHeroAsset !== undefined) requireProjection(mapping, "background.homeHeroImage", "supported");
    target.homeHeroImage = resolveAsset(homeHeroAsset, bindings, [".png", ".jpg", ".jpeg", ".webp"], background.homeHeroAsset !== undefined ? "sharedCore.background.homeHeroAsset" : "targetProfile.homeHeroAsset");
  }

  const targetAppearance = {};
  if (appearance.colorScheme !== undefined) {
    requireProjection(mapping, "tokens.appearance.shellMode", "supported");
    enumValue(appearance.colorScheme, ["system", "light", "dark"], "sharedCore.appearance.colorScheme");
    targetAppearance.shellMode = appearance.colorScheme === "system" ? "auto" : appearance.colorScheme;
  }
  const authoritativePosition = background.position === undefined ? undefined : position(background.position, "sharedCore.background.position");
  const legacyPosition = appearance.backgroundPosition === undefined ? undefined : position(appearance.backgroundPosition, "sharedCore.appearance.backgroundPosition");
  if (authoritativePosition !== undefined) {
    requireProjection(mapping, "background.position", "supported");
    if (legacyPosition !== undefined && !samePosition(authoritativePosition, legacyPosition)) {
      throw codedError("conflicting-background-position", "sharedCore.background.position conflicts with legacy sharedCore.appearance.backgroundPosition");
    }
    targetAppearance.backgroundPosition = authoritativePosition;
  } else if (legacyPosition !== undefined) {
    const decision = requireProjection(mapping, "tokens.appearance.backgroundPosition", "approximated");
    targetAppearance.backgroundPosition = legacyPosition;
    diagnostics.push(projectionDiagnostic(decision, "tokens.appearance.backgroundPosition", "Legacy background position was used because background.position is absent."));
  }
  if (profile.appearance.newTaskLayout !== undefined) targetAppearance.newTaskLayout = profile.appearance.newTaskLayout;
  for (const key of ["backdropBlurPx", "backdropSaturation", "radiusScale", "reduceParticles"]) {
    if (profile.appearance[key] !== undefined) targetAppearance[key] = profile.appearance[key];
  }
  const scrimOpacity = optionalNumber(background.scrimOpacity, 0, 0.8, "sharedCore.background.scrimOpacity");
  if (scrimOpacity !== undefined) requireProjection(mapping, "background.scrimOpacity", "supported");
  if (mode === "media" && background.videoAsset !== undefined) {
    requireProjection(mapping, "background.video", "supported");
    target.backgroundVideo = resolveAsset(background.videoAsset, bindings, [".mp4"], "sharedCore.background.videoAsset");
    if (background.posterMode !== undefined) {
      requireProjection(mapping, "background.posterMode", "supported");
      targetAppearance.backgroundVideoPosterMode = enumValue(background.posterMode, ["none", "image"], "sharedCore.background.posterMode");
    }
    if (scrimOpacity !== undefined) targetAppearance.backgroundVideoScrimOpacity = scrimOpacity;
  } else if (mode === "media" && background.posterMode !== undefined) {
    throw new Error("sharedCore.background.posterMode requires a video asset");
  } else if (mode === "ripple") {
    if (background.videoAsset !== undefined || background.directionalAtlasAsset !== undefined) throw new Error("ripple mode cannot use video or directional atlas assets");
    const ripple = allowedObject(background.ripple, RIPPLE_KEYS, "sharedCore.background.ripple");
    for (const key of Object.keys(ripple)) requireProjection(mapping, `background.${key}`, "supported");
    target.interactiveBackground = {
      type: "ripple",
      ...(ripple.intensity === undefined ? {} : { intensity: optionalNumber(ripple.intensity, 0, 1, "sharedCore.background.ripple.intensity") }),
      ...(ripple.radiusPx === undefined ? {} : { radiusPx: optionalNumber(ripple.radiusPx, 8, 96, "sharedCore.background.ripple.radiusPx") }),
      ...(ripple.quality === undefined ? {} : { quality: enumValue(ripple.quality, ["auto", "low", "high"], "sharedCore.background.ripple.quality") }),
      ...(scrimOpacity === undefined ? {} : { scrimOpacity }),
    };
  } else if (mode === "directional") {
    if (background.videoAsset !== undefined) throw new Error("directional mode cannot use a video asset");
    const directional = allowedObject(background.directional, DIRECTIONAL_KEYS, "sharedCore.background.directional");
    const directions = enumValue(directional.directions, [8, 16, 32], "sharedCore.background.directional.directions");
    if (!Number.isInteger(directional.columns) || !Number.isInteger(directional.rows) || directional.columns * directional.rows !== directions) {
      throw new Error("sharedCore.background.directional columns × rows must equal directions");
    }
    requireProjection(mapping, "background.atlas", "supported");
    for (const key of Object.keys(directional)) requireProjection(mapping, `background.${key}`, "supported");
    target.interactiveBackground = {
      type: "directional",
      atlas: resolveAsset(background.directionalAtlasAsset, bindings, [".webp"], "sharedCore.background.directionalAtlasAsset"),
      directions,
      columns: directional.columns,
      rows: directional.rows,
      ...(directional.firstDirectionDegrees === undefined ? {} : { firstDirectionDegrees: optionalNumber(directional.firstDirectionDegrees, -180, 180, "sharedCore.background.directional.firstDirectionDegrees") }),
      ...(directional.idleFrame === undefined ? {} : { idleFrame: directional.idleFrame }),
      ...(directional.origin === undefined ? {} : { origin: position(directional.origin, "sharedCore.background.directional.origin") }),
      ...(scrimOpacity === undefined ? {} : { scrimOpacity }),
    };
  }
  // Target Profile is the Adapter-owned layer above Shared Core. Its media
  // position remains scoped to the Codex video surface and never rewrites the
  // authoritative Shared Core background position.
  if (profile.appearance.videoPosterMode !== undefined) targetAppearance.backgroundVideoPosterMode = profile.appearance.videoPosterMode;
  if (profile.appearance.videoPosition !== undefined) targetAppearance.backgroundVideoPosition = profile.appearance.videoPosition;
  if (profile.appearance.homeHeroPosition !== undefined) targetAppearance.homeHeroPosition = profile.appearance.homeHeroPosition;
  if (Object.keys(profile.art).length) target.art = profile.art;
  if (Object.keys(targetAppearance).length) target.appearance = targetAppearance;

  if (appearance.windowMaterial !== undefined) {
    if (typeof appearance.windowMaterial !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(appearance.windowMaterial)) {
      throw new Error("sharedCore.appearance.windowMaterial must be a safe semantic value");
    }
    throw new Error("sharedCore.appearance.windowMaterial is not part of Unified Theme v2");
  }
  if (background.continuousAvatar !== undefined) {
    if (typeof background.continuousAvatar !== "boolean") throw new Error("sharedCore.background.continuousAvatar must be boolean");
    throw new Error("sharedCore.background.continuousAvatar is not part of Unified Theme v2");
  }
  if (accessibility.reduceMotion !== undefined) {
    enumValue(accessibility.reduceMotion, ["system"], "sharedCore.accessibility.reduceMotion");
    const decision = requireProjection(mapping, "accessibility.reducedMotion", "supported");
    diagnostics.push(projectionDiagnostic(decision, "accessibility.reducedMotion", "Reduced Motion remains enforced by the host runtime."));
  }
  if (accessibility.highContrast !== undefined) {
    throw new Error("sharedCore.accessibility.highContrast is not part of Unified Theme v2");
  }
  assertSkinThemeIdentity(target, "Compiled Mac Codex theme");
  normalizeSkinTheme(target, "Compiled Mac Codex theme");
  return { targetTheme: target, diagnostics };
}

export async function executeCompileRequest(request) {
  try {
    const compiled = compileAdapterTheme(request, await loadAdapterProjection());
    return { kind: COMPILE_RESULT_KIND, revision: 1, adapterId: ADAPTER_ID, status: "success", code: "ok", ...compiled };
  } catch (error) {
    return { kind: COMPILE_RESULT_KIND, revision: 1, adapterId: ADAPTER_ID, status: "failed", code: error.code ?? "invalid-design-data", message: error.message };
  }
}

function neutralInvocation(value) {
  const invocation = allowedObject(value, new Set([
    "kind", "schemaVersion", "adapterId", "capabilityVersion", "identity", "sharedCore",
    "targetProfiles", "compileContext", "assetBindings",
  ]), "Adapter projector invocation");
  if (invocation.kind !== MANAGER_PROJECTOR_INVOCATION_KIND || invocation.schemaVersion !== 1 || invocation.adapterId !== ADAPTER_ID) {
    throw new Error("Adapter projector invocation has an invalid Mac Codex identity");
  }
  const identity = allowedObject(invocation.identity, new Set(["id", "name", "version"]), "Adapter projector identity");
  const core = allowedObject(invocation.sharedCore, new Set(["tokens", "background", "accessibility"]), "Adapter projector Shared Core");
  const profiles = allowedObject(invocation.targetProfiles, new Set([ADAPTER_ID]), "Adapter projector Target Profiles");
  const assets = allowedObject(invocation.assetBindings, new Set(["background", "homeHero", "video", "atlas"]), "Adapter projector asset bindings");
  const compileContext = managerCompileContext(invocation.compileContext);
  if (typeof identity.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(identity.version)) {
    throw new Error("Adapter projector identity.version is invalid");
  }
  for (const [role, filename] of Object.entries(assets)) {
    if (typeof filename !== "string" || !SAFE_FILE.test(filename) || filename.includes("..") || /^(?:https?:|file:|data:|blob:)/i.test(filename)) {
      throw new Error(`Adapter projector assetBindings.${role} must be a safe package-local filename`);
    }
  }
  return { invocation, identity, core, profile: profiles[ADAPTER_ID] ?? {}, assets, compileContext };
}

function visibleUnsupportedAccessibility(accessibility, projection) {
  const mapping = projectionIndex(projection);
  return ["minimumTextContrast", "minimumLargeTextContrast", "preserveSystemFocusRing", "transparencyFallback"]
    .filter((field) => accessibility[field] !== undefined)
    .map((field) => {
      const item = requireProjection(mapping, `accessibility.${field}`, "unsupported");
      return {
        ...projectionDiagnostic(item, `accessibility.${field}`, `The optional accessibility.${field} value was omitted.`),
        severity: "warning",
      };
    });
}

function compileAdmission(capability, context) {
  const expected = capability.compatibility?.currentEvidence ?? {};
  const diagnostics = [];
  const deny = (code, field, message) => diagnostics.push({
    code, field, decision: "unsupported", severity: "error", message,
  });
  if (context.compileAllowed !== true) deny("adapter-compile-context-denied", "compileContext.compileAllowed", "The Manager compile context did not admit this Adapter compilation.");
  if (context.applyAllowed !== true) deny("adapter-apply-context-denied", "compileContext.applyAllowed", "The Manager compile context did not admit runtime application.");
  if (context.detectedClientVersion !== expected.clientVersion) {
    deny("surface-evidence-client-version-mismatch", "compileContext.detectedClientVersion", `Current Mac Codex evidence is for ${expected.clientVersion}; received ${String(context.detectedClientVersion)}.`);
  }
  if (context.detectedClientBuild !== expected.clientBuild) {
    deny("surface-evidence-client-build-mismatch", "compileContext.detectedClientBuild", `Current Mac Codex evidence is for build ${expected.clientBuild}; received ${String(context.detectedClientBuild)}.`);
  }
  if (context.probeStatus !== "passed") {
    deny("surface-evidence-probe-not-passed", "compileContext.probeStatus", "Current privacy-preserving Surface evidence has not passed for this compile context.");
  }
  if (context.surfaceCatalogId !== expected.surfaceCatalogId) {
    deny("surface-evidence-catalog-mismatch", "compileContext.surfaceCatalogId", `Expected Surface Catalog ${expected.surfaceCatalogId}.`);
  }
  if (context.surfaceCatalogVersion !== expected.surfaceCatalogVersion) {
    deny("surface-evidence-catalog-version-mismatch", "compileContext.surfaceCatalogVersion", `Expected Surface Catalog version ${expected.surfaceCatalogVersion}.`);
  }
  return { applyAllowed: !diagnostics.some((item) => item.severity === "error"), diagnostics };
}

export async function projectThemeFamilyAdapter(value) {
  try {
    const { invocation, identity, core, profile: rawProfile, assets, compileContext } = neutralInvocation(value);
    const [capability, projection] = await Promise.all([loadAdapterCapability(), loadAdapterProjection()]);
    if (invocation.capabilityVersion !== capability.capabilityVersion) {
      throw new Error(`Mac Codex capability version ${String(invocation.capabilityVersion)} is not supported`);
    }
    const tokens = allowedObject(core.tokens, new Set(["colors", "fonts", "appearance"]), "Adapter projector Shared Core tokens");
    const background = allowedObject(core.background, V2_BACKGROUND_KEYS, "Adapter projector Shared Core background");
    const accessibility = allowedObject(core.accessibility, new Set([
      "reducedMotion", "minimumTextContrast", "minimumLargeTextContrast", "preserveSystemFocusRing", "transparencyFallback",
    ]), "Adapter projector Shared Core accessibility");
    const mapping = projectionIndex(projection);
    for (const key of Object.keys(tokens.appearance ?? {})) {
      requireProjection(mapping, `tokens.appearance.${key}`, key === "backgroundPosition" ? "approximated" : "supported");
    }
    const legacy = rawProfile.kind === "cc-theme.legacy-target-profile";
    const profile = legacy ? {
      kind: "cc-theme.target-profile",
      adapterId: ADAPTER_ID,
      revision: 1,
      copy: structuredClone(rawProfile.copy ?? {}),
    } : structuredClone(rawProfile);
    profile.kind ??= "cc-theme.target-profile";
    profile.adapterId ??= ADAPTER_ID;
    profile.revision ??= 1;
    profile.appearance = {
      ...Object.fromEntries(["backdropBlurPx", "backdropSaturation", "radiusScale", "homeHeroPosition"]
        .filter((key) => tokens.appearance?.[key] !== undefined)
        .map((key) => [key, structuredClone(tokens.appearance[key])])),
      ...(profile.appearance ?? {}),
    };
    const adapterBackground = { mode: background.mode, imageAsset: "background" };
    if (assets.homeHero !== undefined) adapterBackground.homeHeroAsset = "homeHero";
    if (assets.video !== undefined) adapterBackground.videoAsset = "video";
    if (assets.atlas !== undefined) adapterBackground.directionalAtlasAsset = "atlas";
    if (background.posterMode !== undefined) adapterBackground.posterMode = background.posterMode;
    if (background.scrimOpacity !== undefined) adapterBackground.scrimOpacity = background.scrimOpacity;
    if (background.position !== undefined) adapterBackground.position = structuredClone(background.position);
    if (background.mode === "ripple") {
      adapterBackground.ripple = Object.fromEntries(["intensity", "radiusPx", "quality"]
        .filter((key) => background[key] !== undefined).map((key) => [key, structuredClone(background[key])]));
    }
    if (background.mode === "directional") {
      adapterBackground.directional = Object.fromEntries([
        "directions", "columns", "rows", "firstDirectionDegrees", "idleFrame", "origin",
      ].filter((key) => background[key] !== undefined).map((key) => [key, structuredClone(background[key])]));
    }
    const appearance = {};
    if (tokens.appearance?.shellMode !== undefined) {
      appearance.colorScheme = tokens.appearance.shellMode === "auto" ? "system" : tokens.appearance.shellMode;
    }
    if (tokens.appearance?.backgroundPosition !== undefined) {
      appearance.backgroundPosition = structuredClone(tokens.appearance.backgroundPosition);
    }
    const request = {
      kind: COMPILE_REQUEST_KIND,
      adapterId: ADAPTER_ID,
      sharedCore: {
        identity: { id: identity.id, name: identity.name },
        semanticColors: structuredClone(tokens.colors),
        fonts: structuredClone(tokens.fonts),
        appearance,
        background: adapterBackground,
        accessibility: { reduceMotion: accessibility.reducedMotion === "static" ? "system" : accessibility.reducedMotion },
      },
      targetProfile: profile,
      assetBindings: structuredClone(assets),
    };
    const result = await executeCompileRequest(request);
    if (result.status === "success") {
      const admission = compileAdmission(capability, compileContext);
      result.applyAllowed = admission.applyAllowed;
      result.diagnostics = [
        ...(result.diagnostics ?? []),
        ...visibleUnsupportedAccessibility(accessibility, projection),
        ...admission.diagnostics,
      ];
    }
    return result;
  } catch (error) {
    return { kind: COMPILE_RESULT_KIND, revision: 1, adapterId: ADAPTER_ID, status: "failed", code: error.code ?? "invalid-design-data", message: error.message };
  }
}

async function readRequest(file) {
  if (typeof file !== "string" || !path.isAbsolute(file)) throw new Error("--request must be an absolute local JSON file");
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_REQUEST_BYTES) throw new Error("Compile request must be a bounded regular JSON file");
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function main(argv) {
  const [operation, ...args] = argv;
  if (operation === "describe") {
    process.stdout.write(`${JSON.stringify(await describeAdapterCapability(), null, 2)}\n`);
    return;
  }
  if (operation !== "compile") throw new Error("Usage: adapter-capability.mjs describe | compile --request <absolute-json>");
  const requestIndex = args.indexOf("--request");
  const result = await executeCompileRequest(await readRequest(args[requestIndex + 1]));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "success") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`[cc-theme-capability] ${error.message}\n`);
    process.exitCode = 1;
  });
}
