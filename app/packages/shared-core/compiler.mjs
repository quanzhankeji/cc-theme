import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_ADAPTER_REGISTRY,
  capabilityFor,
  loadAdapterProjector,
} from "../adapter-sdk/adapter-registry.mjs";
import {
  IMMERSIVE_SCENE_PROFILE_ID,
  IMMERSIVE_SCENE_PROFILE_VERSION,
  IMMERSIVE_SCENE_SURFACES,
  normalizePresentation,
  presentationCapability,
} from "./presentation.mjs";

export const UNIFIED_THEME_KIND = "cc-theme.unified-theme";
export const SKIN_THEME_KIND = "skin.theme";
const TOKEN_KEYS = ["colors", "fonts", "appearance"];
const COLOR_KEYS = [
  "surfaceBase", "surfaceRaised", "surfaceElevated", "surfaceCode", "text", "textStrong", "textMuted",
  "placeholder", "borderSubtle", "borderDefault", "borderStrong", "action", "actionHover", "actionPressed",
  "actionForeground", "hoverSurface", "pressedSurface", "selectedSurface", "selectedHoverSurface", "focusRing",
  "link", "danger", "success", "warning", "sidebarSurface", "headerSurface", "mainScrimStart", "mainScrimMid",
  "mainScrimEnd", "composerSurface",
];
const REQUIRED_COLOR_KEYS = ["surfaceBase", "text", "textMuted", "action", "actionForeground", "focusRing"];
const FONT_KEYS = ["ui", "display", "code"];
const APPEARANCE_KEYS = ["shellMode", "backdropBlurPx", "backdropSaturation", "radiusScale", "backgroundPosition", "homeHeroPosition"];
const ACCESSIBILITY_KEYS = [
  "reducedMotion", "minimumTextContrast", "minimumLargeTextContrast", "preserveSystemFocusRing", "transparencyFallback",
];
const POSITION_KEYS = ["xPercent", "yPercent"];
const BACKGROUND_KEYS = Object.freeze({
  media: ["mode", "image", "homeHeroImage", "video", "posterMode", "scrimOpacity", "position"],
  ripple: ["mode", "image", "homeHeroImage", "intensity", "radiusPx", "quality", "scrimOpacity", "position"],
  directional: [
    "mode", "image", "homeHeroImage", "atlas", "directions", "columns", "rows", "firstDirectionDegrees",
    "idleFrame", "origin", "scrimOpacity", "position",
  ],
});
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/;
const COLOR_PATTERN = /^(#[0-9A-Fa-f]{6}|rgba?\([0-9., %]+\))$/;
const IMAGE_PATTERN = /\.(?:png|jpe?g|webp)$/i;
const VIDEO_PATTERN = /\.mp4$/i;
const ATLAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.webp$/;

export class ThemeCompilerError extends Error {
  constructor(message, field = "theme") {
    super(`${field}: ${message}`);
    this.name = "ThemeCompilerError";
    this.field = field;
  }
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value : null;
}

function object(value, field) {
  const result = plainObject(value);
  if (!result) throw new ThemeCompilerError("must be a plain object", field);
  return result;
}

function allowedObject(value, keys, field) {
  const result = object(value, field);
  const allowed = new Set(keys);
  const unknown = Object.keys(result).filter((key) => !allowed.has(key));
  if (unknown.length) throw new ThemeCompilerError(`contains unsupported fields: ${unknown.sort().join(", ")}`, field);
  return result;
}

function requireKeys(value, keys, field) {
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  if (missing.length) throw new ThemeCompilerError(`requires fields: ${missing.join(", ")}`, field);
}

function string(value, field, { min = 0, max = Infinity, pattern } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    throw new ThemeCompilerError("has an invalid string value", field);
  }
  return value;
}

function choice(value, choices, field) {
  if (!choices.includes(value)) throw new ThemeCompilerError(`must be one of: ${choices.join(", ")}`, field);
}

function number(value, minimum, maximum, field, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new ThemeCompilerError(`must be ${integer ? "an integer" : "a number"} from ${minimum} to ${maximum}`, field);
  }
}

function optionalNumber(value, minimum, maximum, field, integer = false) {
  if (value !== undefined) number(value, minimum, maximum, field, integer);
}

function validateLocalFile(value, extensionPattern, field) {
  string(value, field, { min: 5, max: 255 });
  if (
    value !== path.basename(value) || value.includes("/") || value.includes("\\") || value.includes(":") ||
    value === "." || value === ".." || value.includes("\0") || !extensionPattern.test(value)
  ) {
    throw new ThemeCompilerError("must be a safe local filename (URLs, absolute paths, and traversal are not allowed)", field);
  }
}

function validatePosition(value, field) {
  const position = allowedObject(value, POSITION_KEYS, field);
  requireKeys(position, POSITION_KEYS, field);
  number(position.xPercent, 0, 100, `${field}.xPercent`);
  number(position.yPercent, 0, 100, `${field}.yPercent`);
}

function validateColors(value, field, required = []) {
  const colors = allowedObject(value, COLOR_KEYS, field);
  if (!Object.keys(colors).length) throw new ThemeCompilerError("must contain at least one color", field);
  requireKeys(colors, required, field);
  for (const key of COLOR_KEYS) {
    if (colors[key] !== undefined) string(colors[key], `${field}.${key}`, { max: 48, pattern: COLOR_PATTERN });
  }
}

function validateFonts(value, field) {
  const fonts = allowedObject(value, FONT_KEYS, field);
  if (!Object.keys(fonts).length) throw new ThemeCompilerError("must contain at least one font family", field);
  for (const key of FONT_KEYS) {
    if (fonts[key] === undefined) continue;
    if (!Array.isArray(fonts[key]) || fonts[key].length < 1 || fonts[key].length > 8 || new Set(fonts[key]).size !== fonts[key].length) {
      throw new ThemeCompilerError("must contain 1 to 8 unique font names", `${field}.${key}`);
    }
    for (const [index, font] of fonts[key].entries()) {
      string(font, `${field}.${key}[${index}]`, { min: 1, max: 80, pattern: /^[^:/\\\u0000-\u001F]+$/ });
    }
  }
}

function validateAppearance(value, field) {
  const appearance = allowedObject(value, APPEARANCE_KEYS, field);
  if (appearance.shellMode !== undefined) choice(appearance.shellMode, ["auto", "light", "dark"], `${field}.shellMode`);
  optionalNumber(appearance.backdropBlurPx, 0, 48, `${field}.backdropBlurPx`);
  optionalNumber(appearance.backdropSaturation, 0.5, 1.5, `${field}.backdropSaturation`);
  optionalNumber(appearance.radiusScale, 0.75, 1.5, `${field}.radiusScale`);
  if (appearance.backgroundPosition !== undefined) validatePosition(appearance.backgroundPosition, `${field}.backgroundPosition`);
  if (appearance.homeHeroPosition !== undefined) validatePosition(appearance.homeHeroPosition, `${field}.homeHeroPosition`);
}

function validateBackground(value, field) {
  const raw = object(value, field);
  choice(raw.mode, ["media", "ripple", "directional"], `${field}.mode`);
  const background = allowedObject(raw, BACKGROUND_KEYS[raw.mode], field);
  validateLocalFile(background.image, IMAGE_PATTERN, `${field}.image`);
  if (background.homeHeroImage !== undefined) validateLocalFile(background.homeHeroImage, IMAGE_PATTERN, `${field}.homeHeroImage`);
  optionalNumber(background.scrimOpacity, 0, 0.8, `${field}.scrimOpacity`);
  if (background.position !== undefined) validatePosition(background.position, `${field}.position`);

  if (background.mode === "media") {
    if (background.video !== undefined) validateLocalFile(background.video, VIDEO_PATTERN, `${field}.video`);
    if (background.posterMode !== undefined) choice(background.posterMode, ["none", "image"], `${field}.posterMode`);
    if ((background.posterMode !== undefined || background.scrimOpacity !== undefined) && background.video === undefined) {
      throw new ThemeCompilerError("posterMode and scrimOpacity require video", field);
    }
  } else if (background.mode === "ripple") {
    optionalNumber(background.intensity, 0, 1, `${field}.intensity`);
    optionalNumber(background.radiusPx, 8, 96, `${field}.radiusPx`);
    if (background.quality !== undefined) choice(background.quality, ["auto", "low", "high"], `${field}.quality`);
  } else {
    validateLocalFile(background.atlas, ATLAS_PATTERN, `${field}.atlas`);
    choice(background.directions, [8, 16, 32], `${field}.directions`);
    number(background.columns, 1, 8, `${field}.columns`, true);
    number(background.rows, 1, 8, `${field}.rows`, true);
    if (background.columns * background.rows !== background.directions) {
      throw new ThemeCompilerError("columns × rows must equal directions", field);
    }
    optionalNumber(background.firstDirectionDegrees, -180, 180, `${field}.firstDirectionDegrees`);
    optionalNumber(background.idleFrame, 0, 31, `${field}.idleFrame`, true);
    if (background.idleFrame !== undefined && background.idleFrame >= background.directions) {
      throw new ThemeCompilerError("idleFrame must be smaller than directions", `${field}.idleFrame`);
    }
    if (background.origin !== undefined) validatePosition(background.origin, `${field}.origin`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function stableStringify(value, space = 2) {
  return `${JSON.stringify(canonicalize(value), null, space)}\n`;
}

const FAMILY_ROOT_KEYS = ["kind", "schemaVersion", "id", "name", "version", "sharedCore", "presentation", "targets", "targetProfiles"];
const SHARED_CORE_KEYS = ["tokens", "background", "accessibility"];
const PROFILE_FORBIDDEN_KEYS = new Set([
  "css", "javascript", "script", "html", "shader", "selector", "selectors", "command", "commands", "url", "urls", "path", "paths",
]);

function validateTargetProfilePayload(value, field) {
  const profile = object(value, field);
  const visit = (current, label) => {
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${label}[${index}]`));
      return;
    }
    if (!plainObject(current)) return;
    for (const [key, entry] of Object.entries(current)) {
      if (PROFILE_FORBIDDEN_KEYS.has(key.toLowerCase())) throw new ThemeCompilerError("contains a forbidden executable or host-specific field", `${label}.${key}`);
      if (typeof entry === "string" && (/^(?:https?:|file:|data:|blob:)/i.test(entry) || path.isAbsolute(entry) || entry.includes("../") || entry.includes("..\\"))) {
        throw new ThemeCompilerError("contains a URL, absolute path, or path traversal", `${label}.${key}`);
      }
      visit(entry, `${label}.${key}`);
    }
  };
  visit(profile, field);
}

function validateThemeFamilyVersion(value, expectedSchemaVersion, registry = DEFAULT_ADAPTER_REGISTRY) {
  const theme = allowedObject(value, FAMILY_ROOT_KEYS, "theme");
  requireKeys(theme, ["kind", "schemaVersion", "id", "name", "version", "sharedCore", "targets"], "theme");
  if (theme.kind !== UNIFIED_THEME_KIND || theme.schemaVersion !== expectedSchemaVersion) {
    throw new ThemeCompilerError(`must use cc-theme.unified-theme schemaVersion ${expectedSchemaVersion}`, "theme");
  }
  string(theme.id, "theme.id", { pattern: ID_PATTERN });
  string(theme.name, "theme.name", { min: 1, max: 80 });
  string(theme.version, "theme.version", { max: 40, pattern: VERSION_PATTERN });
  const core = allowedObject(theme.sharedCore, SHARED_CORE_KEYS, "theme.sharedCore");
  requireKeys(core, SHARED_CORE_KEYS, "theme.sharedCore");
  const tokens = allowedObject(core.tokens, TOKEN_KEYS, "theme.sharedCore.tokens");
  requireKeys(tokens, ["colors", "fonts"], "theme.sharedCore.tokens");
  validateColors(tokens.colors, "theme.sharedCore.tokens.colors", REQUIRED_COLOR_KEYS);
  validateFonts(tokens.fonts, "theme.sharedCore.tokens.fonts");
  if (tokens.appearance !== undefined) validateAppearance(tokens.appearance, "theme.sharedCore.tokens.appearance");
  validateBackground(core.background, "theme.sharedCore.background");
  const accessibility = allowedObject(core.accessibility, ACCESSIBILITY_KEYS, "theme.sharedCore.accessibility");
  requireKeys(accessibility, ["reducedMotion"], "theme.sharedCore.accessibility");
  if (accessibility.reducedMotion !== "static") throw new ThemeCompilerError("must be static", "theme.sharedCore.accessibility.reducedMotion");
  optionalNumber(accessibility.minimumTextContrast, 4.5, 7, "theme.sharedCore.accessibility.minimumTextContrast");
  optionalNumber(accessibility.minimumLargeTextContrast, 3, 7, "theme.sharedCore.accessibility.minimumLargeTextContrast");
  if (accessibility.preserveSystemFocusRing !== undefined && typeof accessibility.preserveSystemFocusRing !== "boolean") throw new ThemeCompilerError("must be a boolean", "theme.sharedCore.accessibility.preserveSystemFocusRing");
  if (accessibility.transparencyFallback !== undefined) choice(accessibility.transparencyFallback, ["opaque", "increased-scrim"], "theme.sharedCore.accessibility.transparencyFallback");
  if (!Array.isArray(theme.targets) || !theme.targets.length || new Set(theme.targets).size !== theme.targets.length) throw new ThemeCompilerError("must contain unique Adapter ids", "theme.targets");
  for (const adapterId of theme.targets) capabilityFor(adapterId, registry);
  const profiles = theme.targetProfiles === undefined ? {} : object(theme.targetProfiles, "theme.targetProfiles");
  for (const [adapterId, profile] of Object.entries(profiles)) {
    capabilityFor(adapterId, registry);
    validateTargetProfilePayload(profile, `theme.targetProfiles.${adapterId}`);
  }
  if (theme.presentation !== undefined) {
    const presentation = normalizePresentation(theme.presentation, "theme.presentation");
    if (presentation.assetSlots["scene.backdrop"] !== core.background.image) {
      throw new ThemeCompilerError("scene.backdrop must bind the Shared Core background image", "theme.presentation.assetSlots.scene.backdrop");
    }
  }
  return value;
}

export function validateThemeFamily(value, registry = DEFAULT_ADAPTER_REGISTRY) {
  return validateThemeFamilyVersion(value, 1, registry);
}

export function validateUnifiedTheme(value, registry = DEFAULT_ADAPTER_REGISTRY) {
  return validateThemeFamily(value, registry);
}

function validateCompileContextIdentity(value, registry) {
  const context = allowedObject(value, ["kind", "schemaVersion", "adapters"], "compileContext");
  requireKeys(context, ["kind", "schemaVersion", "adapters"], "compileContext");
  if (context.kind !== "cc-theme.compile-context" || context.schemaVersion !== 1) {
    throw new ThemeCompilerError("must use cc-theme.compile-context schemaVersion 1", "compileContext");
  }
  const adapters = object(context.adapters, "compileContext.adapters");
  for (const adapterId of Object.keys(adapters)) capabilityFor(adapterId, registry);
  return context;
}

function normalizeFamilySource(value, registry) {
  validateThemeFamily(value, registry);
  return { theme: value };
}

function effectiveCore(source) {
  return structuredClone(source.theme.sharedCore);
}

function profileFor(source, capability) {
  return structuredClone(source.theme.targetProfiles?.[capability.adapterId] ?? {});
}

function presentationFor(source) {
  return source.theme.presentation === undefined ? null : normalizePresentation(source.theme.presentation, "theme.presentation");
}

function assertPresentationCapability(capability, presentation) {
  if (!presentation) return [];
  const declared = presentationCapability(capability.presentationProfiles?.[presentation.profileId]);
  if (presentation.profileId !== IMMERSIVE_SCENE_PROFILE_ID || presentation.profileVersion !== IMMERSIVE_SCENE_PROFILE_VERSION ||
      declared.profileVersion !== presentation.profileVersion || declared.geometryPolicy !== presentation.geometryPolicy) {
    throw new ThemeCompilerError("does not support the required immersive-scene-v1 profile revision", `${capability.adapterId}.presentation`);
  }
  for (const surface of IMMERSIVE_SCENE_SURFACES) {
    if (declared.surfaces[surface] !== "exact") {
      throw new ThemeCompilerError(`does not provide an exact immersive-scene-v1 consumer for ${surface}`, `${capability.adapterId}.presentation.surfaces.${surface}`);
    }
  }
  return IMMERSIVE_SCENE_SURFACES.map((surface) => ({
    severity: "info",
    field: `presentation.surfaces.${surface}`,
    decision: "exact",
    code: "immersive-scene-consumer-exact",
    message: `${capability.adapterId} provides an exact immersive-scene-v1 consumer for ${surface}.`,
  }));
}

function contextFor(capability, compileContext) {
  const explicit = compileContext?.adapters?.[capability.adapterId];
  if (explicit) return explicit;
  throw new ThemeCompilerError("requires an explicit canonical Adapter compile context", `compileContext.adapters.${capability.adapterId}`);
}

function neutralAssetBindings(core) {
  const background = core.background;
  return {
    background: background.image,
    ...(background.homeHeroImage === undefined ? {} : { homeHero: background.homeHeroImage }),
    ...(background.video === undefined ? {} : { video: background.video }),
    ...(background.atlas === undefined ? {} : { atlas: background.atlas }),
  };
}

function adapterProjectorInvocation(source, capability, context) {
  const core = effectiveCore(source);
  const profile = profileFor(source, capability);
  return {
    kind: "cc-theme.adapter-projector-invocation",
    schemaVersion: 1,
    adapterId: capability.adapterId,
    capabilityVersion: capability.capabilityVersion,
    identity: {
      id: source.theme.id,
      name: source.theme.name,
      version: source.theme.version,
    },
    sharedCore: core,
    targetProfiles: { [capability.adapterId]: profile },
    compileContext: structuredClone(context),
    assetBindings: neutralAssetBindings(core),
  };
}

function unpackProjectionResult(capability, result) {
  if (result.status === "failed" || result.pass === false) throw new ThemeCompilerError(result.message ?? "Adapter projection failed", capability.adapterId);
  const theme = result.targetTheme ?? result.skinTheme ?? result.theme;
  if (!theme) throw new ThemeCompilerError("Adapter projection returned no target skin.theme", capability.adapterId);
  return { theme, diagnostics: result.diagnostics ?? [], applyAllowed: result.applyAllowed };
}

function selectedCapabilities(source, registry, targetAdapterIds) {
  const requestedIds = targetAdapterIds === undefined ? source.theme.targets : targetAdapterIds;
  if (!Array.isArray(requestedIds) || !requestedIds.length || new Set(requestedIds).size !== requestedIds.length) {
    throw new ThemeCompilerError("must contain unique Adapter ids", "targetAdapterIds");
  }
  const familyTargets = new Set(source.theme.targets.map((adapterId) => capabilityFor(adapterId, registry).adapterId));
  return requestedIds.map((adapterId) => {
    const capability = capabilityFor(adapterId, registry);
    if (!familyTargets.has(capability.adapterId)) {
      throw new ThemeCompilerError("is not declared by this Theme Family", `targetAdapterIds.${capability.adapterId}`);
    }
    return capability;
  });
}

export async function compileThemeFamily(value, compileContext, { registry = DEFAULT_ADAPTER_REGISTRY, targetAdapterIds } = {}) {
  const source = normalizeFamilySource(value, registry);
  validateCompileContextIdentity(compileContext, registry);
  const themes = {};
  const diagnostics = {};
  const applyAvailability = {};
  for (const capability of selectedCapabilities(source, registry, targetAdapterIds)) {
    if (!capability.compileAvailable) throw new ThemeCompilerError(`${capability.adapterId} compilation is unavailable`, capability.adapterId);
    const context = contextFor(capability, compileContext);
    if (context.compileAllowed === false) throw new ThemeCompilerError(`${capability.adapterId} compilation is denied by Adapter compile context`, capability.adapterId);
    if (capability.projection.requestContract !== "cc-theme.adapter-projector-invocation@1") {
      throw new ThemeCompilerError(`unsupported Adapter request contract ${capability.projection.requestContract}`, capability.adapterId);
    }
    const projected = unpackProjectionResult(
      capability,
      await (await loadAdapterProjector(capability))(adapterProjectorInvocation(source, capability, context)),
    );
    const presentation = presentationFor(source);
    const presentationDiagnostics = assertPresentationCapability(capability, presentation);
    themes[capability.adapterId] = presentation
      ? { ...projected.theme, presentation }
      : projected.theme;
    const applyAllowed = capability.runtimeApplyAvailable && context.applyAllowed === true && projected.applyAllowed !== false;
    const applyDiagnostic = applyAllowed ? [] : [{
      code: context.reasonCode ?? "runtime-apply-unavailable",
      field: "$adapter.runtimeApplyAvailable",
      decision: "unsupported",
      severity: "warning",
      message: `${capability.adapterId} can be projected but cannot currently be applied.`,
    }];
    diagnostics[capability.adapterId] = [...projected.diagnostics, ...presentationDiagnostics, ...applyDiagnostic];
    applyAvailability[capability.adapterId] = { allowed: applyAllowed, reasonCode: applyAllowed ? null : context.reasonCode ?? "runtime-apply-unavailable" };
  }
  return { kind: "cc-theme.compiled-family", schemaVersion: 1, themes, diagnostics, applyAvailability };
}

export async function writeCompiledThemeFamily(value, compileContext, outputDirectory, { registry = DEFAULT_ADAPTER_REGISTRY, targetAdapterIds } = {}) {
  string(outputDirectory, "outputDirectory", { min: 1 });
  const compilation = await compileThemeFamily(value, compileContext, { registry, targetAdapterIds });
  const files = {};
  for (const [adapterId, theme] of Object.entries(compilation.themes)) {
    const capability = capabilityFor(adapterId, registry);
    const directory = path.resolve(outputDirectory, capability.projection.outputDirectory);
    const file = path.join(directory, "theme.json");
    const temporary = path.join(directory, `.theme.json.${process.pid}.tmp`);
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, stableStringify(theme), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, file);
    files[adapterId] = file;
  }
  return { ...compilation, files };
}
