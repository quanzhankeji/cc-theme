import { normalizeSkinTheme } from "./skin-theme.mjs";

export const ADAPTER_ID = "mac-doubao";
export const CAPABILITY_VERSION = "1.3.0";
export const VERIFIED_CLIENT_VERSION = "2.19.9";
export const VERIFIED_CLIENT_BUILD = "2.19.9";
export const SURFACE_CATALOG_ID = "doubao-macos-2.19.9";
export const SURFACE_CATALOG_VERSION = 4;
export const PROJECTION_RESULT_KIND = "cc-theme.adapter-projection-result";

const INVOCATION_KEYS = new Set([
  "kind", "schemaVersion", "adapterId", "capabilityVersion", "identity", "sharedCore",
  "targetProfiles", "compileContext", "assetBindings",
]);
const CONTEXT_KEYS = new Set([
  "detectedClientVersion", "detectedClientBuild", "surfaceCatalogId", "surfaceCatalogVersion",
  "probeStatus", "compileAllowed", "applyAllowed", "reasonCode", "localRuntimeOverrides",
]);
const COLOR_KEYS = new Set([
  "surfaceBase", "surfaceRaised", "surfaceElevated", "surfaceCode", "text", "textStrong", "textMuted",
  "placeholder", "borderSubtle", "borderDefault", "borderStrong", "action", "actionHover", "actionPressed",
  "actionForeground", "hoverSurface", "pressedSurface", "selectedSurface", "selectedHoverSurface", "focusRing",
  "link", "danger", "success", "warning", "sidebarSurface", "headerSurface", "mainScrimStart", "mainScrimMid",
  "mainScrimEnd", "composerSurface",
]);
const REQUIRED_COLORS = ["surfaceBase", "text", "textMuted", "action", "actionForeground", "focusRing"];
const COLOR_PATTERN = /^(?:#[0-9a-f]{6}|rgba?\([0-9., %]+\))$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const PRESENTATION_MAPPING_DECISIONS = new Set(["exact", "approximate", "unsupported"]);
const PRESENTATION_CONSUMER_ID = /^[A-Za-z][A-Za-z0-9.-]{2,119}$/;
const PRESENTATION_DIAGNOSTIC = /^[a-z][a-z0-9-]{2,159}$/;
const SCENE_SURFACES = ["shell", "navigation", "home", "conversation", "composer", "cards", "overlays"];
const SCENE_PARAMETERS = [
  "density", "borderTreatment", "textureIntensity", "surfaceOpacity",
  "navigationTreatment", "composerTreatment", "cardTreatment",
];
const SCENE_ASSET_SLOTS = ["scene.backdrop"];
const PRESENTATION_BOUNDARIES = ["nativeControls", "layout", "uncataloguedPortals", "fonts"];

const plainObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;

function objectWithKeys(value, keys, label) {
  const object = plainObject(value);
  if (!object) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(object).filter((key) => !keys.has(key));
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.sort().join(", ")}`);
  return object;
}

function requireKeys(value, keys, label) {
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  if (missing.length) throw new Error(`${label} requires fields: ${missing.join(", ")}`);
}

function validatePresentationDecision(value, label) {
  const decision = objectWithKeys(value, new Set(["decision", "consumerId", "diagnostic"]), label);
  requireKeys(decision, ["decision", "consumerId", "diagnostic"], label);
  if (!PRESENTATION_MAPPING_DECISIONS.has(decision.decision)) {
    throw new Error(`${label}.decision is invalid`);
  }
  if (typeof decision.diagnostic !== "string" || !PRESENTATION_DIAGNOSTIC.test(decision.diagnostic)) {
    throw new Error(`${label}.diagnostic is invalid`);
  }
  if (decision.decision === "unsupported") {
    if (decision.consumerId !== null) throw new Error(`${label}.consumerId must be null when unsupported`);
  } else if (typeof decision.consumerId !== "string" || !PRESENTATION_CONSUMER_ID.test(decision.consumerId)) {
    throw new Error(`${label}.consumerId is invalid`);
  }
  return structuredClone(decision);
}

function validatePresentationScope(value, keys, label) {
  const scope = objectWithKeys(value, new Set(keys), label);
  requireKeys(scope, keys, label);
  return Object.fromEntries(keys.map((key) => [key, validatePresentationDecision(scope[key], `${label}.${key}`)]));
}

/**
 * Validates the self-contained portion of the published capability that
 * describes immersive-scene-v1. It intentionally accepts only semantic
 * consumer identifiers: no selectors, CSS, layout coordinates, or commands
 * can appear in the capability advertisement.
 */
export function validatePresentationCapabilityMetadata(raw) {
  const capability = plainObject(raw);
  if (!capability) throw new Error("Adapter capability must be an object");
  const profiles = objectWithKeys(capability.presentationProfiles, new Set(["immersive-scene-v1"]), "Adapter presentationProfiles");
  requireKeys(profiles, ["immersive-scene-v1"], "Adapter presentationProfiles");
  const profile = objectWithKeys(profiles["immersive-scene-v1"], new Set([
    "profileVersion", "geometryPolicy", "sceneSemantics",
  ]), "immersive-scene-v1 capability");
  requireKeys(profile, ["profileVersion", "geometryPolicy", "sceneSemantics"], "immersive-scene-v1 capability");
  if (profile.profileVersion !== 1 || profile.geometryPolicy !== "scene-bounded") {
    throw new Error("immersive-scene-v1 capability has an invalid profile identity");
  }
  const semantics = objectWithKeys(profile.sceneSemantics, new Set([
    "scope", "surfaces", "parameters", "assetSlots",
  ]), "immersive-scene-v1 sceneSemantics");
  requireKeys(semantics, ["scope", "surfaces", "parameters", "assetSlots"], "immersive-scene-v1 sceneSemantics");
  if (semantics.scope !== "presentation-scene") {
    throw new Error("immersive-scene-v1 sceneSemantics.scope is invalid");
  }
  const boundaries = validatePresentationScope(
    capability.presentationBoundaries,
    PRESENTATION_BOUNDARIES,
    "Adapter presentationBoundaries",
  );
  for (const [boundary, value] of Object.entries(boundaries)) {
    if (value.decision !== "unsupported" || value.consumerId !== null) {
      throw new Error(`Adapter presentationBoundaries.${boundary} must be unsupported`);
    }
  }
  return {
    profileVersion: profile.profileVersion,
    geometryPolicy: profile.geometryPolicy,
    sceneSemantics: {
      scope: semantics.scope,
      surfaces: validatePresentationScope(semantics.surfaces, SCENE_SURFACES, "immersive-scene-v1 sceneSemantics.surfaces"),
      parameters: validatePresentationScope(semantics.parameters, SCENE_PARAMETERS, "immersive-scene-v1 sceneSemantics.parameters"),
      assetSlots: validatePresentationScope(semantics.assetSlots, SCENE_ASSET_SLOTS, "immersive-scene-v1 sceneSemantics.assetSlots"),
    },
    presentationBoundaries: boundaries,
  };
}

function optionalText(value, maximum, label) {
  if (value !== null && (typeof value !== "string" || value.length > maximum)) {
    throw new Error(`${label} must be null or a bounded string`);
  }
}

function validateLocalRuntimeOverrides(value) {
  const overrides = objectWithKeys(value, new Set(["baseThemeHash", "entries"]), "Adapter localRuntimeOverrides");
  requireKeys(overrides, ["baseThemeHash", "entries"], "Adapter localRuntimeOverrides");
  if (overrides.baseThemeHash !== null && (typeof overrides.baseThemeHash !== "string" || !HASH_PATTERN.test(overrides.baseThemeHash))) {
    throw new Error("Adapter localRuntimeOverrides.baseThemeHash is invalid");
  }
  if (!Array.isArray(overrides.entries)) throw new Error("Adapter localRuntimeOverrides.entries must be an array");
  if (overrides.baseThemeHash !== null || overrides.entries.length !== 0) {
    throw new Error("mac-doubao does not expose local runtime overrides");
  }
}

function validateCompileContext(value) {
  const context = objectWithKeys(value, CONTEXT_KEYS, "Adapter compile context");
  requireKeys(context, [...CONTEXT_KEYS], "Adapter compile context");
  optionalText(context.detectedClientVersion, 80, "Adapter compile context detectedClientVersion");
  optionalText(context.detectedClientBuild, 80, "Adapter compile context detectedClientBuild");
  optionalText(context.surfaceCatalogId, 160, "Adapter compile context surfaceCatalogId");
  optionalText(context.reasonCode, 120, "Adapter compile context reasonCode");
  if (context.surfaceCatalogVersion !== null &&
      !(Number.isSafeInteger(context.surfaceCatalogVersion) ||
        (typeof context.surfaceCatalogVersion === "string" && /^[0-9]{1,10}$/.test(context.surfaceCatalogVersion)))) {
    throw new Error("Adapter compile context surfaceCatalogVersion is invalid");
  }
  if (!["passed", "failed", "not-run", "unavailable"].includes(context.probeStatus)) {
    throw new Error("Adapter compile context probeStatus is invalid");
  }
  if (typeof context.compileAllowed !== "boolean" || typeof context.applyAllowed !== "boolean") {
    throw new Error("Adapter compile context admission fields must be booleans");
  }
  validateLocalRuntimeOverrides(context.localRuntimeOverrides);
  return context;
}

function validateInvocation(value) {
  const invocation = objectWithKeys(value, INVOCATION_KEYS, "Adapter projector invocation");
  requireKeys(invocation, [...INVOCATION_KEYS], "Adapter projector invocation");
  if (invocation.kind !== "cc-theme.adapter-projector-invocation" || invocation.schemaVersion !== 1 || invocation.adapterId !== ADAPTER_ID) {
    throw new Error("Adapter projector invocation has an invalid Doubao identity");
  }
  if (String(invocation.capabilityVersion) !== CAPABILITY_VERSION) {
    throw new Error(`Doubao capability version ${String(invocation.capabilityVersion)} is not supported`);
  }
  const identity = objectWithKeys(invocation.identity, new Set(["id", "name", "version"]), "Adapter identity");
  requireKeys(identity, ["id", "name", "version"], "Adapter identity");
  if (typeof identity.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(identity.id) ||
      typeof identity.name !== "string" || !identity.name.trim() || identity.name.length > 80 ||
      typeof identity.version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(identity.version)) {
    throw new Error("Adapter identity is invalid");
  }
  const core = objectWithKeys(invocation.sharedCore, new Set(["tokens", "background", "accessibility", "appearanceVariants"]), "Adapter Shared Core");
  requireKeys(core, ["tokens", "background", "accessibility"], "Adapter Shared Core");
  const profiles = objectWithKeys(invocation.targetProfiles, new Set([ADAPTER_ID]), "Adapter Target Profiles");
  requireKeys(profiles, [ADAPTER_ID], "Adapter Target Profiles");
  const rawProfile = objectWithKeys(profiles[ADAPTER_ID], new Set([
    "kind", "schemaVersion", "adapterId", "values",
  ]), "mac-doubao Target Profile");
  let paletteStrategy = "system";
  if (Object.keys(rawProfile).length) {
    requireKeys(rawProfile, ["kind", "schemaVersion", "adapterId", "values"], "mac-doubao Target Profile");
    if (rawProfile.kind !== "cc-theme.target-profile" || rawProfile.schemaVersion !== 1 || rawProfile.adapterId !== ADAPTER_ID) {
      throw new Error("mac-doubao Target Profile has an invalid identity");
    }
    const values = objectWithKeys(rawProfile.values, new Set(["paletteStrategy"]), "mac-doubao Target Profile values");
    if (values.paletteStrategy !== undefined && !["system", "adaptive"].includes(values.paletteStrategy)) {
      throw new Error("mac-doubao Target Profile values.paletteStrategy is invalid");
    }
    paletteStrategy = values.paletteStrategy ?? paletteStrategy;
  }
  const context = validateCompileContext(invocation.compileContext);
  const assets = objectWithKeys(invocation.assetBindings, new Set(["background", "homeHero", "video", "atlas"]), "Adapter asset bindings");
  return { identity, core, context, assets, paletteStrategy };
}

function position(value, label) {
  const result = objectWithKeys(value, new Set(["xPercent", "yPercent"]), label);
  requireKeys(result, ["xPercent", "yPercent"], label);
  if (![result.xPercent, result.yPercent].every((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 100)) {
    throw new Error(`${label} is invalid`);
  }
  return structuredClone(result);
}

function boundedNumber(value, minimum, maximum, label, integer = false) {
  if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} is invalid`);
  }
}

function validateColors(value) {
  const colors = objectWithKeys(value, COLOR_KEYS, "Shared Core colors");
  for (const key of REQUIRED_COLORS) if (!Object.hasOwn(colors, key)) throw new Error(`Shared Core colors requires ${key}`);
  for (const [key, entry] of Object.entries(colors)) {
    if (typeof entry !== "string" || entry.length > 48 || !COLOR_PATTERN.test(entry)) throw new Error(`Shared Core colors.${key} is invalid`);
  }
  return colors;
}

function validateAppearanceVariants(value) {
  if (value === undefined) return null;
  const variants = objectWithKeys(value, new Set(["light", "dark"]), "Shared Core appearanceVariants");
  for (const mode of ["light", "dark"]) {
    const variant = objectWithKeys(variants[mode], new Set(["colors"]), `Shared Core appearanceVariants.${mode}`);
    const colors = validateColors(variant.colors);
    if (Object.keys(colors).length !== COLOR_KEYS.size) {
      throw new Error(`Shared Core appearanceVariants.${mode}.colors must declare every semantic color`);
    }
  }
  return variants;
}

function validateFonts(value) {
  const fonts = objectWithKeys(value, new Set(["ui", "display", "code"]), "Shared Core fonts");
  if (!Object.keys(fonts).length) throw new Error("Shared Core fonts must not be empty");
  for (const [key, families] of Object.entries(fonts)) {
    if (!Array.isArray(families) || !families.length || families.length > 8 || new Set(families).size !== families.length ||
        families.some((family) => typeof family !== "string" || !/^[^:/\\\u0000-\u001f]{1,80}$/.test(family))) {
      throw new Error(`Shared Core fonts.${key} is invalid`);
    }
  }
  return fonts;
}

function validateAppearance(value = {}) {
  const appearance = objectWithKeys(value, new Set([
    "shellMode", "backdropBlurPx", "backdropSaturation", "radiusScale", "backgroundPosition", "homeHeroPosition",
  ]), "Shared Core appearance");
  if (appearance.shellMode !== undefined && !["auto", "light", "dark"].includes(appearance.shellMode)) throw new Error("Shared Core shellMode is invalid");
  for (const [key, min, max] of [["backdropBlurPx", 0, 48], ["backdropSaturation", 0.5, 1.5], ["radiusScale", 0.75, 1.5]]) {
    if (appearance[key] !== undefined) boundedNumber(appearance[key], min, max, `Shared Core ${key}`);
  }
  if (appearance.backgroundPosition !== undefined) position(appearance.backgroundPosition, "Shared Core backgroundPosition");
  if (appearance.homeHeroPosition !== undefined) position(appearance.homeHeroPosition, "Shared Core homeHeroPosition");
  return appearance;
}

function diagnostic(field, decision, code, message) {
  return { severity: "warning", field, decision, code, message };
}

function projectColors(colors, diagnostics, paletteStrategy) {
  const semanticColors = {};
  for (const key of [
    "surfaceBase", "surfaceRaised", "action", "actionForeground", "focusRing",
    "sidebarSurface", "headerSurface", "mainScrimStart", "mainScrimMid", "mainScrimEnd",
  ]) {
    if (colors[key] !== undefined) semanticColors[key] = colors[key];
  }
  if (semanticColors.sidebarSurface === undefined && colors.surfaceRaised !== undefined) semanticColors.sidebarSurface = colors.surfaceRaised;

  const paletteDiagnostic = paletteStrategy === "system"
    ? ["approximated", "host-native-control-palette", "Doubao owns native text, controls, focus, borders, overlays, and motion; the theme supplies media and structural translucency only."]
    : ["approximated", "host-native-control-palette", "Doubao owns native controls while structural surfaces receive a bounded host-safe tint from the Unified Theme."];
  diagnostics.push(diagnostic("tokens.colors", ...paletteDiagnostic));

  for (const key of ["text", "textMuted", "action", "actionForeground", "focusRing"]) {
    diagnostics.push(diagnostic(
      `tokens.colors.${key}`, "approximated", "host-native-control-paint",
      `Doubao preserves its native ${key} paint; the validated Unified Theme value remains dormant for target compatibility.`,
    ));
  }

  const unsupported = {
    borderStrong: "Doubao has no separately verified strong-border consumer and keeps the default border token.",
  };
  for (const [key, message] of Object.entries(unsupported)) {
    if (colors[key] !== undefined) diagnostics.push(diagnostic(
      `tokens.colors.${key}`, "unsupported", "optional-color-consumer-unavailable", message,
    ));
  }
  for (const key of ["danger", "success", "warning"]) {
    if (colors[key] !== undefined) diagnostics.push(diagnostic(
      `tokens.colors.${key}`, "unsupported", "status-consumer-unverified",
      `Doubao has no stable, independently verified ${key} status consumer and leaves the host status paint unchanged.`,
    ));
  }
  for (const key of [
    "surfaceElevated", "surfaceCode", "textStrong", "placeholder", "borderSubtle", "borderDefault",
    "actionHover", "actionPressed", "hoverSurface", "pressedSurface", "selectedSurface",
    "selectedHoverSurface", "link", "composerSurface",
  ]) {
    if (colors[key] !== undefined) diagnostics.push(diagnostic(
      `tokens.colors.${key}`, "unsupported", "host-native-control-paint",
      `Doubao preserves the corresponding native control or content paint and does not consume ${key}.`,
    ));
  }
  return semanticColors;
}

function projectAppearanceVariant(colors) {
  const semanticColors = {};
  for (const key of [
    "surfaceBase", "surfaceRaised", "action", "actionForeground", "focusRing",
    "sidebarSurface", "headerSurface", "mainScrimStart", "mainScrimMid", "mainScrimEnd",
  ]) {
    semanticColors[key] = colors[key];
  }
  return {
    colors: { text: colors.text, muted: colors.textMuted },
    semanticColors,
  };
}

function projectFonts(fonts, diagnostics) {
  for (const key of ["ui", "display", "code"]) {
    if (fonts[key] !== undefined) diagnostics.push(diagnostic(
      `tokens.fonts.${key}`, "unsupported", "host-native-typography",
      `Doubao keeps its native ${key} font metrics so wording, truncation, and control layout remain stable.`,
    ));
  }
  return {};
}

function projectAppearance(appearance, diagnostics, paletteStrategy) {
  const target = { paletteStrategy };
  for (const key of ["backdropBlurPx", "backdropSaturation"]) {
    if (appearance[key] !== undefined) target[key] = appearance[key];
  }
  if (appearance.radiusScale !== undefined) diagnostics.push(diagnostic(
    "tokens.appearance.radiusScale", "unsupported", "geometry-policy-native",
    "Doubao preserves native component geometry and does not scale host corner radii.",
  ));
  if (appearance.shellMode !== undefined) diagnostics.push(diagnostic(
    "tokens.appearance.shellMode", "unsupported", "host-shell-mode-authority",
    "Doubao remains the sole authority for its effective shell color scheme.",
  ));
  if (appearance.homeHeroPosition !== undefined) diagnostics.push(diagnostic(
    "tokens.appearance.homeHeroPosition", "unsupported", "home-hero-unsupported",
    "Doubao has no independently verified home Hero surface.",
  ));
  return target;
}

function validateHomeHeroBinding(input, assets) {
  if (input.homeHeroImage !== undefined && assets.homeHero !== input.homeHeroImage) {
    throw new Error("Home Hero asset binding does not match the Shared Core image");
  }
}

function projectBackground(background, assets, appearance, diagnostics) {
  const input = plainObject(background);
  if (!input || !["media", "ripple", "directional"].includes(input.mode)) throw new Error("Shared Core background mode is invalid");
  if (assets.background !== input.image) throw new Error("Background asset binding does not match the Shared Core image");
  validateHomeHeroBinding(input, assets);
  const result = { image: assets.background };
  const authoritativePosition = input.position === undefined ? appearance.backgroundPosition : position(input.position, "Shared Core background position");
  if (input.position !== undefined && appearance.backgroundPosition !== undefined) {
    const legacy = position(appearance.backgroundPosition, "Shared Core legacy background position");
    if (legacy.xPercent !== authoritativePosition.xPercent || legacy.yPercent !== authoritativePosition.yPercent) {
      throw new Error("Shared Core background positions conflict");
    }
  }
  if (authoritativePosition) result.backgroundPosition = structuredClone(authoritativePosition);
  if (input.homeHeroImage !== undefined) diagnostics.push(diagnostic(
    "background.homeHeroImage", "unsupported", "home-hero-unsupported",
    "Doubao has no independently verified home Hero surface.",
  ));

  if (input.mode === "media") {
    const allowed = objectWithKeys(input, new Set(["mode", "image", "homeHeroImage", "video", "posterMode", "scrimOpacity", "position"]), "Shared Core media background");
    if (allowed.video !== undefined) {
      if (assets.video !== allowed.video) throw new Error("Video asset binding does not match the Shared Core video");
      result.backgroundVideo = assets.video;
      result.backgroundVideoPosition = structuredClone(authoritativePosition ?? { xPercent: 50, yPercent: 50 });
    }
    if (allowed.posterMode !== undefined) {
      if (!["none", "image"].includes(allowed.posterMode)) throw new Error("Shared Core media posterMode is invalid");
      if (allowed.video === undefined) throw new Error("Shared Core media posterMode requires video");
      result.backgroundVideoPosterMode = allowed.posterMode;
    }
    if (allowed.scrimOpacity !== undefined) {
      boundedNumber(allowed.scrimOpacity, 0, 0.8, "Shared Core media scrimOpacity");
      if (allowed.video === undefined) throw new Error("Shared Core media scrimOpacity requires video");
      result.backgroundVideoScrimOpacity = allowed.scrimOpacity;
    }
  } else if (input.mode === "ripple") {
    const allowed = objectWithKeys(input, new Set(["mode", "image", "homeHeroImage", "intensity", "radiusPx", "quality", "scrimOpacity", "position"]), "Shared Core ripple background");
    if (allowed.intensity !== undefined) boundedNumber(allowed.intensity, 0, 1, "Shared Core ripple intensity");
    if (allowed.radiusPx !== undefined) boundedNumber(allowed.radiusPx, 8, 96, "Shared Core ripple radiusPx");
    if (allowed.quality !== undefined && !["auto", "low", "high"].includes(allowed.quality)) throw new Error("Shared Core ripple quality is invalid");
    if (allowed.scrimOpacity !== undefined) boundedNumber(allowed.scrimOpacity, 0, 0.8, "Shared Core ripple scrimOpacity");
    diagnostics.push(diagnostic(
      "background.mode", "approximated", "ripple-static-image-approximation",
      "Doubao displays the declared image as a static approximation; ripple interaction is not implemented.",
    ));
    for (const key of ["intensity", "radiusPx", "quality", "scrimOpacity"]) {
      if (allowed[key] !== undefined) diagnostics.push(diagnostic(
        `background.${key}`, "unsupported", "ripple-control-unavailable",
        `Doubao does not consume ripple ${key} while using the static image approximation.`,
      ));
    }
  } else {
    const allowed = objectWithKeys(input, new Set(["mode", "image", "homeHeroImage", "atlas", "directions", "columns", "rows", "firstDirectionDegrees", "idleFrame", "origin", "scrimOpacity", "position"]), "Shared Core directional background");
    if (assets.atlas !== allowed.atlas) throw new Error("Atlas asset binding does not match the Shared Core atlas");
    if (![8, 16, 32].includes(allowed.directions) || !Number.isInteger(allowed.columns) || !Number.isInteger(allowed.rows) || allowed.columns * allowed.rows !== allowed.directions) {
      throw new Error("Shared Core directional grid is invalid");
    }
    if (allowed.firstDirectionDegrees !== undefined) boundedNumber(allowed.firstDirectionDegrees, -180, 180, "Shared Core directional firstDirectionDegrees");
    if (allowed.idleFrame !== undefined) {
      boundedNumber(allowed.idleFrame, 0, 31, "Shared Core directional idleFrame", true);
      if (allowed.idleFrame >= allowed.directions) throw new Error("Shared Core directional idleFrame is invalid");
    }
    if (allowed.origin !== undefined) position(allowed.origin, "Shared Core directional origin");
    if (allowed.scrimOpacity !== undefined) boundedNumber(allowed.scrimOpacity, 0, 0.8, "Shared Core directional scrimOpacity");
    diagnostics.push(diagnostic(
      "background.mode", "approximated", "directional-static-image-approximation",
      "Doubao displays the declared image as a static approximation; directional interaction is not implemented.",
    ));
    for (const key of ["atlas", "directions", "columns", "rows", "firstDirectionDegrees", "idleFrame", "origin", "scrimOpacity"]) {
      if (allowed[key] !== undefined) diagnostics.push(diagnostic(
        `background.${key}`, "unsupported", "directional-control-unavailable",
        `Doubao does not consume directional ${key} while using the static image approximation.`,
      ));
    }
  }
  return result;
}

function validateAccessibility(value) {
  const accessibility = objectWithKeys(value, new Set([
    "reducedMotion", "minimumTextContrast", "minimumLargeTextContrast", "preserveSystemFocusRing", "transparencyFallback",
  ]), "Shared Core accessibility");
  requireKeys(accessibility, ["reducedMotion"], "Shared Core accessibility");
  if (accessibility.reducedMotion !== "static") throw new Error("Doubao requires reducedMotion=static");
  if (accessibility.minimumTextContrast !== undefined) boundedNumber(accessibility.minimumTextContrast, 4.5, 7, "Shared Core minimumTextContrast");
  if (accessibility.minimumLargeTextContrast !== undefined) boundedNumber(accessibility.minimumLargeTextContrast, 3, 7, "Shared Core minimumLargeTextContrast");
  if (accessibility.preserveSystemFocusRing !== undefined && typeof accessibility.preserveSystemFocusRing !== "boolean") {
    throw new Error("Shared Core preserveSystemFocusRing must be a boolean");
  }
  if (accessibility.transparencyFallback !== undefined && !["opaque", "increased-scrim"].includes(accessibility.transparencyFallback)) {
    throw new Error("Shared Core transparencyFallback is invalid");
  }
  return accessibility;
}

function admission(context) {
  const allowed = context.compileAllowed === true && context.applyAllowed === true && context.probeStatus === "passed" &&
    context.detectedClientVersion === VERIFIED_CLIENT_VERSION && context.detectedClientBuild === VERIFIED_CLIENT_BUILD &&
    context.surfaceCatalogId === SURFACE_CATALOG_ID && Number(context.surfaceCatalogVersion) === SURFACE_CATALOG_VERSION;
  return {
    applyAllowed: allowed,
    diagnostics: allowed ? [] : [{
      severity: "error", field: "compatibility", decision: "unsupported",
      code: context.reasonCode ?? "doubao-runtime-unverified",
      message: "Projection succeeded, but runtime apply requires the verified Doubao 2.19.9 build, Surface Catalog v1, and a passing live probe.",
    }],
  };
}

export async function projectThemeFamilyAdapter(value) {
  const { identity, core, context, assets, paletteStrategy } = validateInvocation(value);
  const tokens = objectWithKeys(core.tokens, new Set(["colors", "fonts", "appearance"]), "Shared Core tokens");
  requireKeys(tokens, ["colors", "fonts"], "Shared Core tokens");
  const colors = validateColors(tokens.colors);
  const appearanceVariants = validateAppearanceVariants(core.appearanceVariants);
  const fonts = validateFonts(tokens.fonts);
  const appearance = validateAppearance(tokens.appearance ?? {});
  const accessibility = validateAccessibility(core.accessibility);
  const diagnostics = [];
  const semanticColors = projectColors(colors, diagnostics, paletteStrategy);
  const targetFonts = projectFonts(fonts, diagnostics);
  const targetAppearance = projectAppearance(appearance, diagnostics, paletteStrategy);
  const background = projectBackground(core.background, assets, appearance, diagnostics);
  if (background.backgroundPosition) targetAppearance.backgroundPosition = background.backgroundPosition;
  if (background.backgroundVideoPosition) targetAppearance.backgroundVideoPosition = background.backgroundVideoPosition;
  if (background.backgroundVideoPosterMode !== undefined) targetAppearance.backgroundVideoPosterMode = background.backgroundVideoPosterMode;
  if (background.backgroundVideoScrimOpacity !== undefined) targetAppearance.backgroundVideoScrimOpacity = background.backgroundVideoScrimOpacity;

  const theme = {
    kind: "skin.theme",
    id: identity.id,
    name: identity.name.trim(),
    sourceVersion: identity.version,
    image: background.image,
    ...(background.backgroundVideo ? { backgroundVideo: background.backgroundVideo } : {}),
    colors: { text: colors.text, muted: colors.textMuted },
    semanticColors,
    ...(appearanceVariants ? {
      appearanceVariants: {
        light: projectAppearanceVariant(appearanceVariants.light.colors),
        dark: projectAppearanceVariant(appearanceVariants.dark.colors),
      },
    } : {}),
    ...(Object.keys(targetFonts).length ? { fonts: targetFonts } : {}),
    ...(Object.keys(targetAppearance).length ? { appearance: targetAppearance } : {}),
  };
  normalizeSkinTheme(theme, "Projected Doubao theme");

  for (const [field, decision, code, message] of [
    ["minimumTextContrast", "unsupported", "contrast-audit-unavailable", "Doubao does not claim a runtime contrast audit for arbitrary host content."],
    ["minimumLargeTextContrast", "unsupported", "contrast-audit-unavailable", "Doubao does not claim a runtime large-text contrast audit for arbitrary host content."],
    ["preserveSystemFocusRing", "exact", "host-focus-preserved", "Doubao preserves the native focus indicator without adding an Adapter-owned outline."],
    ["transparencyFallback", "unsupported", "transparency-preference-unavailable", "Doubao does not consume an Adapter-owned transparency preference."],
  ]) {
    if (accessibility[field] !== undefined) diagnostics.push(diagnostic(
      `accessibility.${field}`, decision, code, message,
    ));
  }

  const gate = admission(context);
  return {
    kind: PROJECTION_RESULT_KIND,
    schemaVersion: 1,
    adapterId: ADAPTER_ID,
    capabilityVersion: CAPABILITY_VERSION,
    sourceVersion: identity.version,
    applyAllowed: gate.applyAllowed,
    theme,
    diagnostics: [...diagnostics, ...gate.diagnostics],
  };
}
