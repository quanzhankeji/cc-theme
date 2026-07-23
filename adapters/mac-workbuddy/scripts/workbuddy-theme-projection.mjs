import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAdapterCapability, validateTargetProfile, ADAPTER_ID } from "./adapter-capability.mjs";
import { normalizeSkinTheme } from "./skin-theme.mjs";

export const PROJECTION_RESULT_KIND = "cc-theme.adapter-projection-result";
export const MANAGER_PROJECTOR_INVOCATION_KIND = "cc-theme.adapter-projector-invocation";
export const MANAGER_COMPILE_CONTEXT_KEYS = Object.freeze([
  "detectedClientVersion", "detectedClientBuild", "surfaceCatalogId", "surfaceCatalogVersion", "probeStatus",
  "compileAllowed", "applyAllowed", "reasonCode", "localRuntimeOverrides",
]);
const UNIFIED_KIND = "cc-theme.unified-theme";
const COLOR_KEYS = [
  "surfaceBase", "surfaceRaised", "surfaceElevated", "surfaceCode", "text", "textStrong", "textMuted",
  "placeholder", "borderSubtle", "borderDefault", "borderStrong", "action", "actionHover", "actionPressed",
  "actionForeground", "hoverSurface", "pressedSurface", "selectedSurface", "selectedHoverSurface", "focusRing",
  "link", "danger", "success", "warning", "sidebarSurface", "headerSurface", "mainScrimStart", "mainScrimMid",
  "mainScrimEnd", "composerSurface",
];
const REQUIRED_COLORS = ["surfaceBase", "text", "textMuted", "action", "actionForeground", "focusRing"];
const FONT_KEYS = ["ui", "display", "code"];
const APPEARANCE_KEYS = ["shellMode", "backdropBlurPx", "backdropSaturation", "radiusScale", "backgroundPosition", "homeHeroPosition"];
const ACCESSIBILITY_KEYS = ["reducedMotion", "minimumTextContrast", "minimumLargeTextContrast", "preserveSystemFocusRing", "transparencyFallback"];
const COPY_KEYS = ["brandSubtitle", "tagline", "projectPrefix", "projectLabel", "statusText", "quote"];
const ROOT_KEYS_V1 = ["kind", "schemaVersion", "id", "name", "version", "tokens", "background", "accessibility", "copy", "targets", "overrides"];
const ROOT_KEYS_V2 = ["kind", "schemaVersion", "id", "name", "version", "sharedCore", "presentation", "targets", "targetProfiles"];
const SAFE_COLOR = /^(?:#[0-9a-f]{6}|rgba?\([0-9., %]+\))$/i;

const plainObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const clone = (value) => structuredClone(value);
const canonicalJson = (value) => JSON.stringify(value, (_key, entry) => {
  if (!plainObject(entry)) return entry;
  return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]));
});

function objectWithKeys(value, allowed, label) {
  const object = plainObject(value);
  if (!object) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}`);
  return object;
}

function position(value, label) {
  const object = objectWithKeys(value, ["xPercent", "yPercent"], label);
  if (![object.xPercent, object.yPercent].every((number) => Number.isFinite(number) && number >= 0 && number <= 100)) {
    throw new Error(`${label} must contain percentages from 0 to 100`);
  }
  return clone(object);
}

function samePosition(left, right) {
  return left?.xPercent === right?.xPercent && left?.yPercent === right?.yPercent;
}

function projectionError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function localFile(value, extensions, label) {
  if (typeof value !== "string" || value.length < 5 || value.length > 255 || path.basename(value) !== value ||
      value.includes(":") || !extensions.some((extension) => value.toLowerCase().endsWith(extension))) {
    throw new Error(`${label} must be a local package-root filename`);
  }
  return value;
}

function validateDetectedClientBuild(value) {
  if (value === undefined || value === null) return value ?? null;
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+ -]{0,79}$/.test(value)) {
    throw new Error("Adapter projector compile context detectedClientBuild must be null or a bounded safe string");
  }
  return value;
}

function validateSurfaceCatalogId(value) {
  if (value === undefined || value === null) return value ?? null;
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error("Adapter projector compile context surfaceCatalogId must be null or a bounded safe catalog id");
  }
  return value;
}

function validateColors(value) {
  const colors = objectWithKeys(value, COLOR_KEYS, "theme.tokens.colors");
  for (const key of REQUIRED_COLORS) if (!Object.hasOwn(colors, key)) throw new Error(`theme.tokens.colors requires ${key}`);
  for (const [key, color] of Object.entries(colors)) {
    if (typeof color !== "string" || color.length > 48 || !SAFE_COLOR.test(color)) {
      throw new Error(`theme.tokens.colors.${key} is invalid`);
    }
  }
  return colors;
}

function validateAppearanceVariants(value) {
  if (value === undefined) return null;
  const variants = objectWithKeys(value, ["light", "dark"], "theme.sharedCore.appearanceVariants");
  for (const mode of ["light", "dark"]) {
    const variant = objectWithKeys(variants[mode], ["colors"], `theme.sharedCore.appearanceVariants.${mode}`);
    const colors = validateColors(variant.colors);
    if (Object.keys(colors).length !== COLOR_KEYS.length) {
      throw new Error(`theme.sharedCore.appearanceVariants.${mode}.colors must declare every semantic color`);
    }
  }
  return variants;
}

function validateFonts(value) {
  const fonts = objectWithKeys(value, FONT_KEYS, "theme.tokens.fonts");
  for (const [key, families] of Object.entries(fonts)) {
    if (!Array.isArray(families) || !families.length || families.length > 8 || new Set(families).size !== families.length ||
        families.some((family) => typeof family !== "string" || !/^[^:/\\]{1,80}$/.test(family))) {
      throw new Error(`theme.tokens.fonts.${key} is invalid`);
    }
  }
  return fonts;
}

function validateAppearance(value = {}) {
  const appearance = objectWithKeys(value, APPEARANCE_KEYS, "theme.tokens.appearance");
  if (appearance.shellMode !== undefined && !["auto", "light", "dark"].includes(appearance.shellMode)) throw new Error("theme.tokens.appearance.shellMode is invalid");
  for (const [key, minimum, maximum] of [["backdropBlurPx", 0, 48], ["backdropSaturation", 0.5, 1.5], ["radiusScale", 0.75, 1.5]]) {
    if (appearance[key] !== undefined && (!Number.isFinite(appearance[key]) || appearance[key] < minimum || appearance[key] > maximum)) {
      throw new Error(`theme.tokens.appearance.${key} is invalid`);
    }
  }
  if (appearance.backgroundPosition !== undefined) position(appearance.backgroundPosition, "theme.tokens.appearance.backgroundPosition");
  if (appearance.homeHeroPosition !== undefined) position(appearance.homeHeroPosition, "theme.tokens.appearance.homeHeroPosition");
  return appearance;
}

function validateBackground(value) {
  const background = plainObject(value);
  if (!background || !["media", "ripple", "directional"].includes(background.mode)) throw new Error("theme.background.mode is invalid");
  const allowed = background.mode === "media"
    ? ["mode", "image", "homeHeroImage", "video", "posterMode", "scrimOpacity", "position"]
    : background.mode === "ripple"
      ? ["mode", "image", "homeHeroImage", "intensity", "radiusPx", "quality", "scrimOpacity", "position"]
      : ["mode", "image", "homeHeroImage", "atlas", "directions", "columns", "rows", "firstDirectionDegrees", "idleFrame", "origin", "scrimOpacity", "position"];
  objectWithKeys(background, allowed, "theme.background");
  localFile(background.image, [".png", ".jpg", ".jpeg", ".webp"], "theme.background.image");
  if (background.homeHeroImage !== undefined) localFile(background.homeHeroImage, [".png", ".jpg", ".jpeg", ".webp"], "theme.background.homeHeroImage");
  if (background.position !== undefined) position(background.position, "theme.background.position");
  if (background.scrimOpacity !== undefined && (!Number.isFinite(background.scrimOpacity) || background.scrimOpacity < 0 || background.scrimOpacity > 0.8)) {
    throw new Error("theme.background.scrimOpacity is invalid");
  }
  if (background.mode === "media") {
    if (background.video !== undefined) localFile(background.video, [".mp4"], "theme.background.video");
    if (background.posterMode !== undefined && !["none", "image"].includes(background.posterMode)) throw new Error("theme.background.posterMode is invalid");
  } else if (background.mode === "ripple") {
    if (background.intensity !== undefined && (!Number.isFinite(background.intensity) || background.intensity < 0 || background.intensity > 1)) throw new Error("theme.background.intensity is invalid");
    if (background.radiusPx !== undefined && (!Number.isFinite(background.radiusPx) || background.radiusPx < 8 || background.radiusPx > 96)) throw new Error("theme.background.radiusPx is invalid");
    if (background.quality !== undefined && !["auto", "low", "high"].includes(background.quality)) throw new Error("theme.background.quality is invalid");
  } else {
    localFile(background.atlas, [".webp"], "theme.background.atlas");
    if (![8, 16, 32].includes(background.directions) || !Number.isInteger(background.columns) || !Number.isInteger(background.rows) ||
        background.columns < 1 || background.columns > 8 || background.rows < 1 || background.rows > 8 ||
        background.columns * background.rows !== background.directions) throw new Error("theme.background directional grid is invalid");
    if (background.firstDirectionDegrees !== undefined && (!Number.isFinite(background.firstDirectionDegrees) || background.firstDirectionDegrees < -180 || background.firstDirectionDegrees > 180)) throw new Error("theme.background.firstDirectionDegrees is invalid");
    if (background.idleFrame !== undefined && (!Number.isInteger(background.idleFrame) || background.idleFrame < 0 || background.idleFrame >= background.directions)) throw new Error("theme.background.idleFrame is invalid");
    if (background.origin !== undefined) position(background.origin, "theme.background.origin");
  }
  return background;
}

function mergeLegacy(theme, diagnostics) {
  const overrideRoot = theme.overrides === undefined ? {} : objectWithKeys(theme.overrides, ["codex", "claude", "workbuddy"], "theme.overrides");
  const legacy = overrideRoot.workbuddy;
  if (!legacy) return { colors: theme.tokens.colors, fonts: theme.tokens.fonts, appearance: theme.tokens.appearance ?? {}, background: theme.background, copy: theme.copy ?? {} };
  const override = objectWithKeys(legacy, ["colors", "fonts", "appearance", "background", "copy"], "theme.overrides.workbuddy");
  diagnostics.push({ severity: "warning", field: "overrides.workbuddy", decision: "approximate", code: "legacy-target-override-read", message: "Legacy WorkBuddy override was read for unified-theme v1; new writes must use the namespaced Target Profile." });
  return {
    colors: { ...theme.tokens.colors, ...(override.colors ?? {}) },
    fonts: { ...theme.tokens.fonts, ...(override.fonts ?? {}) },
    appearance: { ...(theme.tokens.appearance ?? {}), ...(override.appearance ?? {}) },
    background: override.background ?? theme.background,
    copy: { ...(theme.copy ?? {}), ...(override.copy ?? {}) },
  };
}

function diagnosticFor(field, severity = "warning", message = null) {
  return {
    severity,
    field: field.source,
    decision: field.decision,
    code: field.diagnostic,
    message: message ?? `${field.source} is ${field.decision} for WorkBuddy.`,
  };
}

function setPath(target, dotted, value) {
  const parts = dotted.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
  cursor[parts.at(-1)] = clone(value);
}

function valueAt(value, dotted) {
  return dotted.split(".").reduce((cursor, part) => cursor?.[part], value);
}

function projectAppearanceVariant(colors, decisions) {
  const output = { colors: {}, semanticColors: {} };
  for (const key of COLOR_KEYS) {
    const field = decisions.get(`tokens.colors.${key}`);
    if (!field) throw new Error(`Capability has no WorkBuddy decision for tokens.colors.${key}`);
    if (field.decision === "exact") {
      setPath(output, field.target, colors[key]);
    } else if (field.decision === "approximate" && valueAt(output, field.target) === undefined) {
      setPath(output, field.target, colors[key]);
    }
  }
  return output;
}

function immersiveSceneCapabilityState(capability, presentation) {
  if (presentation === undefined) return { requested: false, exact: true };
  const declared = capability.presentationProfiles?.[presentation?.profileId];
  const scene = declared?.sceneSemantics;
  const scopes = [
    ["surfaces", ["shell", "navigation", "home", "conversation", "composer", "cards", "overlays"]],
    ["parameters", ["density", "borderTreatment", "textureIntensity", "surfaceOpacity", "navigationTreatment", "composerTreatment", "cardTreatment"]],
    ["assetSlots", ["scene.backdrop"]],
  ];
  const exact = presentation?.profileId === "immersive-scene-v1" && presentation?.profileVersion === 1 &&
    declared?.profileVersion === 1 && declared?.geometryPolicy === presentation?.geometryPolicy &&
    scopes.every(([scope, names]) => names.every((name) => scene?.[scope]?.[name]?.decision === "exact"));
  return { requested: true, exact };
}

export async function projectUnifiedThemeForWorkBuddy(value, { targetProfile = null, clientVersion = null, surfaceCatalogVersion = null, compatibilityAttempt = false } = {}) {
  const capability = await loadAdapterCapability();
  const diagnostics = [];
  const rawTheme = plainObject(value);
  if (!rawTheme || rawTheme.kind !== UNIFIED_KIND || ![1, 2].includes(rawTheme.schemaVersion) ||
      typeof rawTheme.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(rawTheme.id) ||
      typeof rawTheme.name !== "string" || !rawTheme.name.trim() || rawTheme.name.length > 80 ||
      typeof rawTheme.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(rawTheme.version)) {
    throw new Error("theme has an invalid unified identity");
  }
  let theme;
  let tokens;
  let backgroundSource;
  let accessibilitySource;
  let copySource = {};
  let embeddedTargetProfile = null;
  let presentationSource;
  let targetRequested = true;
  const legacySchema = rawTheme.schemaVersion === 1 && rawTheme.sharedCore === undefined;
  if (legacySchema) {
    theme = objectWithKeys(rawTheme, ROOT_KEYS_V1, "theme");
    tokens = objectWithKeys(theme.tokens, ["colors", "fonts", "appearance"], "theme.tokens");
    backgroundSource = theme.background;
    accessibilitySource = theme.accessibility;
    copySource = theme.copy ?? {};
  } else {
    theme = objectWithKeys(rawTheme, ROOT_KEYS_V2, "theme");
    const sharedCore = objectWithKeys(theme.sharedCore, ["tokens", "background", "accessibility", "appearanceVariants"], "theme.sharedCore");
    tokens = objectWithKeys(sharedCore.tokens, ["colors", "fonts", "appearance"], "theme.sharedCore.tokens");
    backgroundSource = sharedCore.background;
    accessibilitySource = sharedCore.accessibility;
    if (!Array.isArray(theme.targets) || !theme.targets.length || new Set(theme.targets).size !== theme.targets.length ||
        theme.targets.some((adapterId) => typeof adapterId !== "string" || !/^[a-z][a-z0-9-]{2,79}$/.test(adapterId))) {
      throw new Error("theme.targets must be unique adapter ids");
    }
    targetRequested = theme.targets.includes(ADAPTER_ID);
    const profiles = theme.targetProfiles === undefined ? {} : objectWithKeys(
      theme.targetProfiles,
      Object.keys(theme.targetProfiles),
      "theme.targetProfiles",
    );
    for (const [adapterId, profileValue] of Object.entries(profiles)) {
      if (!/^[a-z][a-z0-9-]{2,79}$/.test(adapterId) || !plainObject(profileValue)) {
        throw new Error("theme.targetProfiles contains an invalid adapter profile");
      }
    }
    embeddedTargetProfile = profiles[ADAPTER_ID] ?? null;
    presentationSource = theme.presentation;
  }
  if (targetProfile && embeddedTargetProfile && canonicalJson(targetProfile) !== canonicalJson(embeddedTargetProfile)) {
    throw new Error("Explicit WorkBuddy Target Profile conflicts with the unified theme profile");
  }
  const merged = legacySchema
    ? mergeLegacy({ ...theme, tokens }, diagnostics)
    : { colors: tokens.colors, fonts: tokens.fonts, appearance: tokens.appearance ?? {}, background: backgroundSource, copy: copySource };
  const colors = validateColors(merged.colors);
  const appearanceVariants = legacySchema ? null : validateAppearanceVariants(theme.sharedCore.appearanceVariants);
  const fonts = validateFonts(merged.fonts);
  const appearance = validateAppearance(merged.appearance);
  const background = validateBackground(merged.background);
  if (appearance.backgroundPosition !== undefined && background.position !== undefined &&
      !samePosition(appearance.backgroundPosition, background.position)) {
    throw projectionError(
      "theme Shared Core contains conflicting authoritative and legacy background positions",
      "conflicting-background-position",
    );
  }
  const accessibility = objectWithKeys(accessibilitySource, ACCESSIBILITY_KEYS, "theme accessibility");
  if (accessibility.reducedMotion !== "static") throw new Error("theme accessibility.reducedMotion must be static");
  if (accessibility.minimumTextContrast !== undefined && (!Number.isFinite(accessibility.minimumTextContrast) ||
      accessibility.minimumTextContrast < 4.5 || accessibility.minimumTextContrast > 7)) {
    throw new Error("theme accessibility.minimumTextContrast must be a number from 4.5 to 7");
  }
  if (accessibility.minimumLargeTextContrast !== undefined && (!Number.isFinite(accessibility.minimumLargeTextContrast) ||
      accessibility.minimumLargeTextContrast < 3 || accessibility.minimumLargeTextContrast > 7)) {
    throw new Error("theme accessibility.minimumLargeTextContrast must be a number from 3 to 7");
  }
  if (accessibility.preserveSystemFocusRing !== undefined && typeof accessibility.preserveSystemFocusRing !== "boolean") {
    throw new Error("theme accessibility.preserveSystemFocusRing must be a boolean");
  }
  if (accessibility.transparencyFallback !== undefined && !["opaque", "increased-scrim"].includes(accessibility.transparencyFallback)) {
    throw new Error("theme accessibility.transparencyFallback is invalid");
  }
  if (Object.keys(merged.copy ?? {}).length) objectWithKeys(merged.copy, COPY_KEYS, "theme.copy");
  const profile = validateTargetProfile(targetProfile ?? embeddedTargetProfile);
  const output = { kind: "skin.theme", id: theme.id, name: theme.name.trim(), image: background.image, colors: {}, semanticColors: {}, fonts: {}, appearance: {} };
  const decisions = new Map(capability.sharedCore.fields.map((field) => [field.source, field]));
  const mappingSummary = { exact: 0, approximate: 0, unsupported: 0 };
  const recordExact = (sourceField) => {
    const decision = decisions.get(sourceField);
    if (!decision || decision.decision !== "exact") throw new Error(`Capability does not declare an exact WorkBuddy mapping for ${sourceField}`);
    mappingSummary.exact += 1;
  };
  for (const field of ["id", "name", "version", "background.image", "accessibility.reducedMotion"]) recordExact(field);

  for (const key of COLOR_KEYS) {
    if (!Object.hasOwn(colors, key)) continue;
    const color = colors[key];
    const field = decisions.get(`tokens.colors.${key}`);
    if (!field) throw new Error(`Capability has no WorkBuddy decision for tokens.colors.${key}`);
    if (field.decision === "exact") {
      setPath(output, field.target, color);
      mappingSummary.exact += 1;
    }
    else if (field.decision === "approximate") {
      const targetAlreadyPresent = valueAt(output, field.target) !== undefined;
      if (!targetAlreadyPresent) setPath(output, field.target, color);
      diagnostics.push(diagnosticFor(field, "warning", targetAlreadyPresent
        ? `${field.source} was omitted because the exact ${field.target} value has precedence.`
        : `${field.source} was visibly approximated as ${field.target}.`));
      mappingSummary.approximate += 1;
    } else {
      diagnostics.push(diagnosticFor(field));
      mappingSummary.unsupported += 1;
    }
  }
  if (appearanceVariants) {
    output.appearanceVariants = {
      light: projectAppearanceVariant(appearanceVariants.light.colors, decisions),
      dark: projectAppearanceVariant(appearanceVariants.dark.colors, decisions),
    };
  }
  for (const key of FONT_KEYS) {
    if (fonts[key] !== undefined) {
      setPath(output, decisions.get(`tokens.fonts.${key}`).target, fonts[key]);
      mappingSummary.exact += 1;
    }
  }
  for (const key of APPEARANCE_KEYS) {
    if (appearance[key] === undefined) continue;
    if (key === "backgroundPosition") continue;
    const field = decisions.get(`tokens.appearance.${key}`);
    if (field.decision === "exact") {
      setPath(output, field.target, appearance[key]);
      mappingSummary.exact += 1;
    } else {
      diagnostics.push(diagnosticFor(field));
      mappingSummary.unsupported += 1;
    }
  }
  const legacyPositionDecision = decisions.get("tokens.appearance.backgroundPosition");
  if (background.position !== undefined) {
    output.appearance.backgroundPosition = clone(background.position);
    recordExact("background.position");
    if (appearance.backgroundPosition !== undefined) {
      diagnostics.push(diagnosticFor(
        legacyPositionDecision,
        "info",
        "Legacy tokens.appearance.backgroundPosition matched the authoritative background.position and was normalized to it.",
      ));
      mappingSummary.approximate += 1;
    }
  } else if (appearance.backgroundPosition !== undefined) {
    output.appearance.backgroundPosition = clone(appearance.backgroundPosition);
    diagnostics.push(diagnosticFor(
      legacyPositionDecision,
      "warning",
      "Legacy tokens.appearance.backgroundPosition was used because authoritative background.position is absent.",
    ));
    mappingSummary.approximate += 1;
  }
  if (background.homeHeroImage !== undefined) {
    diagnostics.push(diagnosticFor(decisions.get("background.homeHeroImage")));
    mappingSummary.unsupported += 1;
  }
  if (background.mode === "media") {
    recordExact("background.mode.media");
    if (background.video) {
      output.backgroundVideo = background.video;
      recordExact("background.video");
    }
    if (background.scrimOpacity !== undefined) {
      output.appearance.backgroundScrimOpacity = background.scrimOpacity;
      recordExact("background.scrimOpacity");
    }
  } else if (background.mode === "ripple") {
    output.interactiveBackground = { type: "ripple", ...Object.fromEntries(
      ["intensity", "radiusPx", "quality", "scrimOpacity"].filter((key) => background[key] !== undefined).map((key) => [key, background[key]]),
    ) };
    recordExact("background.mode.ripple");
    for (const key of ["intensity", "radiusPx", "quality"]) {
      if (background[key] !== undefined) recordExact(`background.ripple.${key}`);
    }
    if (background.scrimOpacity !== undefined) recordExact("background.scrimOpacity");
  } else {
    output.interactiveBackground = { type: "directional", ...Object.fromEntries(
      ["atlas", "directions", "columns", "rows", "firstDirectionDegrees", "idleFrame", "origin", "scrimOpacity"]
        .filter((key) => background[key] !== undefined).map((key) => [key, clone(background[key])]),
    ) };
    recordExact("background.mode.directional");
    for (const key of ["atlas", "directions", "columns", "rows", "firstDirectionDegrees", "idleFrame", "origin"]) {
      if (background[key] !== undefined) recordExact(`background.directional.${key}`);
    }
    if (background.scrimOpacity !== undefined) recordExact("background.scrimOpacity");
  }
  for (const key of COPY_KEYS) {
    if (!Object.hasOwn(merged.copy ?? {}, key)) continue;
    diagnostics.push(diagnosticFor(decisions.get("copy.*"), "warning", `copy.${key} is not rendered by WorkBuddy and was omitted.`));
    mappingSummary.unsupported += 1;
  }
  for (const key of ACCESSIBILITY_KEYS) {
    if (accessibility[key] === undefined || key === "reducedMotion") continue;
    const decision = decisions.get(`accessibility.${key}`);
    diagnostics.push(diagnosticFor(decision));
    mappingSummary[decision.decision] += 1;
  }

  const profileValues = profile.values;
  output.appearance.paletteStrategy = profileValues.paletteStrategy ?? "system";
  const presentationState = immersiveSceneCapabilityState(capability, presentationSource);
  let presentationApplyBlocked = false;
  if (presentationState.requested) {
    output.presentation = clone(presentationSource);
    if (!presentationState.exact) {
      presentationApplyBlocked = true;
      diagnostics.push({
        severity: "error",
        field: "presentation",
        decision: "unsupported",
        code: "immersive-scene-consumer-incomplete",
        message: "WorkBuddy does not provide an exact consumer for every required immersive scene scope.",
      });
    } else if (output.appearance.paletteStrategy === "system") {
      presentationApplyBlocked = true;
      diagnostics.push({
        severity: "error",
        field: "presentation",
        decision: "unsupported",
        code: "immersive-scene-system-palette-inexact",
        message: "The immersive scene requires adaptive or custom palette output; WorkBuddy system palette leaves scene paint dormant.",
      });
    } else {
      for (const [scope, boundary] of Object.entries(capability.presentationBoundaries)) {
        diagnostics.push({
          severity: "info",
          field: `presentation.boundaries.${scope}`,
          decision: boundary.decision,
          code: boundary.diagnostic,
          message: `${scope} remains host-owned and is outside immersive-scene-v1 exact scope.`,
        });
      }
    }
  }
  if (output.backgroundVideo) {
    output.appearance.backgroundVideoPosterMode = profileValues.backgroundVideoPosterMode ?? background.posterMode ?? "image";
    if (profileValues.backgroundVideoPosterMode === undefined && background.posterMode !== undefined) recordExact("background.posterMode");
  } else if (profileValues.backgroundVideoPosterMode !== undefined) {
    diagnostics.push({ severity: "warning", field: "targetProfile.values.backgroundVideo", decision: "unsupported", code: "target-profile-field-inapplicable", message: "Video-only Target Profile values were omitted because this theme has no background video." });
  }
  if (output.appearance.paletteStrategy === "system") {
    diagnostics.push({ severity: "info", field: "targetProfile.values.paletteStrategy", decision: "exact", code: "system-shared-colors-dormant", message: "WorkBuddy native system colors are active; validated Shared Core colors remain dormant and available for adaptive/custom or local overrides." });
  } else if (output.appearance.paletteStrategy === "adaptive") {
    diagnostics.push({ severity: "info", field: "targetProfile.values.paletteStrategy", decision: "exact", code: "adaptive-shared-core-base", message: "Shared Core colors form the adaptive base; WorkBuddy does not perform media analysis in the standalone adapter." });
  }

  let legacyCompatibility = null;
  if (legacySchema) {
    const targetRoot = theme.targets === undefined ? {} : objectWithKeys(theme.targets, ["codex", "claude", "workbuddy"], "theme.targets");
    const legacyTarget = targetRoot.workbuddy;
    targetRequested = Boolean(legacyTarget);
    if (legacyTarget) {
      objectWithKeys(legacyTarget, ["adapter", "compatibility"], "theme.targets.workbuddy");
      if (legacyTarget.adapter !== ADAPTER_ID) throw new Error("theme.targets.workbuddy uses the wrong adapter");
      legacyCompatibility = objectWithKeys(legacyTarget.compatibility, ["clientVersion", "policy", "surfaceCatalogVersion"], "theme.targets.workbuddy.compatibility");
      if (typeof legacyCompatibility.clientVersion !== "string" || !/^[A-Za-z0-9._+-]{1,80}$/.test(legacyCompatibility.clientVersion) ||
          !["always-latest", "runtime-probe", "verified-only"].includes(legacyCompatibility.policy) ||
          (legacyCompatibility.surfaceCatalogVersion !== undefined &&
            (!Number.isSafeInteger(legacyCompatibility.surfaceCatalogVersion) || legacyCompatibility.surfaceCatalogVersion < 1))) {
        throw new Error("theme.targets.workbuddy.compatibility is invalid");
      }
      diagnostics.push({ severity: "info", field: "targets.workbuddy.compatibility", decision: "approximate", code: "legacy-compatibility-read", message: "Legacy unified compatibility was read; new writes should pass Adapter compile context." });
    }
  }
  const effectiveClientVersion = clientVersion ?? legacyCompatibility?.clientVersion ?? null;
  const effectiveSurfaceVersion = surfaceCatalogVersion ?? legacyCompatibility?.surfaceCatalogVersion ?? null;
  const numericVersion = (value) => typeof value === "string" && /^\d+(?:\.\d+){2}$/.test(value)
    ? value.split(".").map((part) => BigInt(part))
    : null;
  const newerThan = (left, right) => {
    const a = numericVersion(left);
    const b = numericVersion(right);
    if (!a || !b) return false;
    for (let index = 0; index < 3; index += 1) {
      if (a[index] !== b[index]) return a[index] > b[index];
    }
    return false;
  };
  const exactClientAllowed = capability.compatibility.verifiedClientVersions.includes(effectiveClientVersion);
  const compatibilityClientAllowed = compatibilityAttempt && capability.compatibility.verifiedClientVersions.some(
    (verifiedVersion) => newerThan(effectiveClientVersion, verifiedVersion),
  );
  const clientAllowed = exactClientAllowed || compatibilityClientAllowed;
  const surfaceAllowed = effectiveSurfaceVersion === capability.catalogs.uiSurfaceCatalogVersion;
  const applyAllowed = targetRequested && clientAllowed && surfaceAllowed && !presentationApplyBlocked;
  if (!targetRequested) diagnostics.push({ severity: "error", field: "targets", decision: "unsupported", code: "target-not-requested", message: "The unified theme does not include the WorkBuddy adapter target." });
  if (!applyAllowed) diagnostics.push({ severity: "error", field: "compatibility", decision: "unsupported", code: "client-version-unsupported", message: "Compilation is deterministic, but apply is unavailable until the verified WorkBuddy client and UI Surface Catalog versions match." });
  if (applyAllowed && compatibilityClientAllowed) diagnostics.push({
    severity: "warning",
    field: "compatibility",
    decision: "approximate",
    code: "older-adapter-runtime-probe-required",
    message: "Projection uses the older WorkBuddy recipe; runtime role discovery must converge on the current official client before commit.",
  });

  normalizeSkinTheme(output, "Projected WorkBuddy theme");
  const summary = { exact: 0, approximate: 0, unsupported: 0 };
  for (const diagnostic of diagnostics) if (Object.hasOwn(summary, diagnostic.decision)) summary[diagnostic.decision] += 1;
  return {
    kind: PROJECTION_RESULT_KIND,
    schemaVersion: 1,
    adapterId: ADAPTER_ID,
    capabilityVersion: capability.capabilityVersion,
    sourceVersion: theme.version,
    applyAllowed,
    compatibility: { policy: capability.compatibility.policy, clientVersion: effectiveClientVersion, surfaceCatalogVersion: effectiveSurfaceVersion },
    paletteStrategy: output.appearance.paletteStrategy,
    precedence: clone(capability.paletteStrategy.precedence),
    runtimeAccessibility: { reducedMotion: "static", hostSafetyOverride: true },
    theme: output,
    diagnostics,
    diagnosticSummary: summary,
    mappingSummary,
  };
}

function neutralInvocation(value) {
  const invocation = objectWithKeys(value, [
    "kind", "schemaVersion", "adapterId", "capabilityVersion", "identity", "sharedCore",
    "targetProfiles", "compileContext", "assetBindings",
  ], "Adapter projector invocation");
  if (invocation.kind !== MANAGER_PROJECTOR_INVOCATION_KIND || invocation.schemaVersion !== 1 || invocation.adapterId !== ADAPTER_ID) {
    throw new Error("Adapter projector invocation has an invalid WorkBuddy identity");
  }
  const identity = objectWithKeys(invocation.identity, ["id", "name", "version"], "Adapter projector identity");
  if (typeof identity.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(identity.version)) {
    throw new Error("Adapter projector identity.version is invalid");
  }
  const core = objectWithKeys(invocation.sharedCore, ["tokens", "background", "accessibility", "appearanceVariants"], "Adapter projector Shared Core");
  const profiles = objectWithKeys(invocation.targetProfiles, [ADAPTER_ID], "Adapter projector Target Profiles");
  const context = objectWithKeys(invocation.compileContext, MANAGER_COMPILE_CONTEXT_KEYS,
    "Adapter projector compile context");
  validateDetectedClientBuild(context.detectedClientBuild);
  validateSurfaceCatalogId(context.surfaceCatalogId);
  const assets = objectWithKeys(invocation.assetBindings, ["background", "homeHero", "video", "atlas"], "Adapter projector asset bindings");
  for (const [role, filename] of Object.entries(assets)) {
    localFile(filename, role === "video" ? [".mp4"] : role === "atlas" ? [".webp"] : [".png", ".jpg", ".jpeg", ".webp"], `Adapter projector assetBindings.${role}`);
  }
  return { invocation, identity, core, profile: profiles[ADAPTER_ID] ?? {}, context, assets };
}

export async function projectThemeFamilyAdapter(value) {
  const { invocation, identity, core, profile, context, assets } = neutralInvocation(value);
  const capability = await loadAdapterCapability();
  if (String(invocation.capabilityVersion) !== String(capability.capabilityVersion)) {
    throw new Error(`WorkBuddy capability version ${String(invocation.capabilityVersion)} is not supported`);
  }
  const sharedCore = clone(core);
  sharedCore.background.image = assets.background;
  if (assets.homeHero !== undefined) sharedCore.background.homeHeroImage = assets.homeHero;
  if (assets.video !== undefined) sharedCore.background.video = assets.video;
  if (assets.atlas !== undefined) sharedCore.background.atlas = assets.atlas;
  const legacy = profile.kind === "cc-theme.legacy-target-profile";
  const theme = legacy ? {
    kind: UNIFIED_KIND,
    schemaVersion: 1,
    id: identity.id,
    name: identity.name,
    version: identity.version,
    tokens: sharedCore.tokens,
    background: sharedCore.background,
    accessibility: sharedCore.accessibility,
    copy: clone(profile.copy ?? {}),
    targets: {
      workbuddy: {
        adapter: ADAPTER_ID,
        compatibility: {
          clientVersion: context.detectedClientVersion ?? "unknown",
          policy: "verified-only",
          ...(Number.isSafeInteger(context.surfaceCatalogVersion) ? { surfaceCatalogVersion: context.surfaceCatalogVersion } : {}),
        },
      },
    },
  } : {
    kind: UNIFIED_KIND,
    schemaVersion: 1,
    id: identity.id,
    name: identity.name,
    version: identity.version,
    sharedCore,
    targets: [ADAPTER_ID],
    ...(Object.keys(profile).length ? { targetProfiles: { [ADAPTER_ID]: clone(profile) } } : {}),
  };
  return projectUnifiedThemeForWorkBuddy(theme, {
    clientVersion: context.detectedClientVersion ?? null,
    surfaceCatalogVersion: context.surfaceCatalogVersion ?? null,
    compatibilityAttempt: context.reasonCode === "older-adapter-compatibility-attempt",
  });
}

function valueFor(args, name) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = valueFor(process.argv.slice(2), "input");
  const profileFile = valueFor(process.argv.slice(2), "target-profile");
  const output = valueFor(process.argv.slice(2), "output");
  const clientVersion = valueFor(process.argv.slice(2), "client-version");
  const surfaceVersionText = valueFor(process.argv.slice(2), "surface-catalog-version");
  if (!input) throw new Error("Usage: workbuddy-theme-projection.mjs --input <unified-theme.json> [--target-profile <profile.json>] [--client-version <version>] [--surface-catalog-version <number>] [--output <result.json>]");
  const result = await projectUnifiedThemeForWorkBuddy(
    JSON.parse(await fs.readFile(path.resolve(input), "utf8")),
    {
      targetProfile: profileFile ? JSON.parse(await fs.readFile(path.resolve(profileFile), "utf8")) : null,
      clientVersion,
      surfaceCatalogVersion: surfaceVersionText === null ? null : Number(surfaceVersionText),
    },
  );
  const bytes = `${JSON.stringify(result, null, 2)}\n`;
  if (output) {
    const destination = path.resolve(output);
    const temporary = `${destination}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fs.writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  } else process.stdout.write(bytes);
}
