export const IMMERSIVE_SCENE_PROFILE_ID = "immersive-scene-v1";
export const IMMERSIVE_SCENE_PROFILE_VERSION = 1;
export const IMMERSIVE_SCENE_SURFACES = Object.freeze([
  "shell", "navigation", "home", "conversation", "composer", "cards", "overlays",
]);
export const IMMERSIVE_SCENE_PARAMETERS = Object.freeze([
  "density", "borderTreatment", "textureIntensity", "surfaceOpacity",
  "navigationTreatment", "composerTreatment", "cardTreatment",
]);
export const IMMERSIVE_SCENE_ASSET_SLOTS = Object.freeze(["scene.backdrop"]);
export const IMMERSIVE_SCENE_BOUNDARIES = Object.freeze([
  "nativeControls", "layout", "uncataloguedPortals", "fonts",
]);

const PARAMETER_KEYS = new Set(IMMERSIVE_SCENE_PARAMETERS);
const ASSET_SLOT_KEYS = new Set(IMMERSIVE_SCENE_ASSET_SLOTS);
const FALLBACK_KEYS = new Set(["unsupportedSurface", "reducedMotion"]);
const FORBIDDEN_KEYS = new Set([
  "css", "javascript", "script", "html", "shader", "selector", "selectors", "command", "commands",
  "url", "urls", "path", "paths", "width", "height", "display", "grid", "flex", "order", "position",
]);
const SAFE_LOCAL_FILE = /^(?!.*[:/\\])[^\u0000-\u001f]+\.(?:png|jpe?g|webp)$/i;
const SAFE_CONSUMER_ID = /^[A-Za-z][A-Za-z0-9.-]{2,119}$/;
const SAFE_DIAGNOSTIC_CODE = /^[a-z][a-z0-9-]{2,159}$/;
const MAPPING_DECISIONS = new Set(["exact", "approximate", "unsupported"]);

function fail(label, message) {
  throw new Error(`${label}: ${message}`);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label, "must be an object");
  return value;
}

function exactKeys(value, keys, label) {
  const unknown = Object.keys(value).filter((key) => !keys.has(key));
  if (unknown.length) fail(label, `contains unsupported fields: ${unknown.sort().join(", ")}`);
}

function rejectForbidden(value, label) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectForbidden(entry, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) fail(`${label}.${key}`, "contains a forbidden host-specific or executable field");
    rejectForbidden(entry, `${label}.${key}`);
  }
}

export function normalizePresentation(value, label = "presentation") {
  const presentation = object(value, label);
  exactKeys(presentation, new Set([
    "profileId", "profileVersion", "strictness", "geometryPolicy", "surfaces", "parameters", "assetSlots", "fallbackPolicy",
  ]), label);
  rejectForbidden(presentation, label);
  if (presentation.profileId !== IMMERSIVE_SCENE_PROFILE_ID) {
    fail(`${label}.profileId`, `must be ${IMMERSIVE_SCENE_PROFILE_ID}`);
  }
  if (presentation.profileVersion !== IMMERSIVE_SCENE_PROFILE_VERSION) {
    fail(`${label}.profileVersion`, `must be ${IMMERSIVE_SCENE_PROFILE_VERSION}`);
  }
  if (presentation.strictness !== "exact-required") fail(`${label}.strictness`, "must be exact-required");
  if (presentation.geometryPolicy !== "scene-bounded") fail(`${label}.geometryPolicy`, "must be scene-bounded");
  if (!Array.isArray(presentation.surfaces) || presentation.surfaces.length !== IMMERSIVE_SCENE_SURFACES.length ||
      new Set(presentation.surfaces).size !== presentation.surfaces.length ||
      [...presentation.surfaces].sort().join("|") !== [...IMMERSIVE_SCENE_SURFACES].sort().join("|")) {
    fail(`${label}.surfaces`, "must declare every immersive scene surface exactly once");
  }
  const parameters = object(presentation.parameters, `${label}.parameters`);
  exactKeys(parameters, PARAMETER_KEYS, `${label}.parameters`);
  if (parameters.density !== "comfortable") fail(`${label}.parameters.density`, "must be comfortable");
  if (parameters.borderTreatment !== "etched") fail(`${label}.parameters.borderTreatment`, "must be etched");
  if (!Number.isFinite(parameters.textureIntensity) || parameters.textureIntensity < 0 || parameters.textureIntensity > 1) {
    fail(`${label}.parameters.textureIntensity`, "must be a number from 0 to 1");
  }
  if (!Number.isFinite(parameters.surfaceOpacity) || parameters.surfaceOpacity < 0 || parameters.surfaceOpacity > 1) {
    fail(`${label}.parameters.surfaceOpacity`, "must be a number from 0 to 1");
  }
  if (parameters.navigationTreatment !== "framed") fail(`${label}.parameters.navigationTreatment`, "must be framed");
  if (parameters.composerTreatment !== "anchored") fail(`${label}.parameters.composerTreatment`, "must be anchored");
  if (parameters.cardTreatment !== "elevated") fail(`${label}.parameters.cardTreatment`, "must be elevated");

  const assetSlots = object(presentation.assetSlots, `${label}.assetSlots`);
  exactKeys(assetSlots, ASSET_SLOT_KEYS, `${label}.assetSlots`);
  if (typeof assetSlots["scene.backdrop"] !== "string" || !SAFE_LOCAL_FILE.test(assetSlots["scene.backdrop"])) {
    fail(`${label}.assetSlots.scene.backdrop`, "must be a safe local image filename");
  }
  const fallbackPolicy = object(presentation.fallbackPolicy, `${label}.fallbackPolicy`);
  exactKeys(fallbackPolicy, FALLBACK_KEYS, `${label}.fallbackPolicy`);
  if (fallbackPolicy.unsupportedSurface !== "block") fail(`${label}.fallbackPolicy.unsupportedSurface`, "must be block");
  if (fallbackPolicy.reducedMotion !== "static") fail(`${label}.fallbackPolicy.reducedMotion`, "must be static");
  return structuredClone(presentation);
}

function validateMappingDecision(value, label) {
  const mapping = object(value, label);
  exactKeys(mapping, new Set(["decision", "consumerId", "diagnostic"]), label);
  if (!MAPPING_DECISIONS.has(mapping.decision)) fail(`${label}.decision`, "must be exact, approximate, or unsupported");
  if (typeof mapping.diagnostic !== "string" || !SAFE_DIAGNOSTIC_CODE.test(mapping.diagnostic)) {
    fail(`${label}.diagnostic`, "must be a stable diagnostic code");
  }
  if (mapping.decision === "unsupported") {
    if (mapping.consumerId !== null) fail(`${label}.consumerId`, "must be null for unsupported mappings");
  } else if (typeof mapping.consumerId !== "string" || !SAFE_CONSUMER_ID.test(mapping.consumerId)) {
    fail(`${label}.consumerId`, "must be a bounded opaque consumer id for exact or approximate mappings");
  }
  return structuredClone(mapping);
}

function validateMappingScope(value, keys, label) {
  const scope = object(value, label);
  exactKeys(scope, new Set(keys), label);
  const missing = keys.filter((key) => !Object.hasOwn(scope, key));
  if (missing.length) fail(label, `requires mapping decisions for: ${missing.join(", ")}`);
  return Object.fromEntries(keys.map((key) => [key, validateMappingDecision(scope[key], `${label}.${key}`)]));
}

export function validatePresentationProfileCapability(value, label = "presentationProfile") {
  const profile = object(value, label);
  exactKeys(profile, new Set(["profileVersion", "geometryPolicy", "sceneSemantics"]), label);
  if (profile.profileVersion !== IMMERSIVE_SCENE_PROFILE_VERSION) {
    fail(`${label}.profileVersion`, `must be ${IMMERSIVE_SCENE_PROFILE_VERSION}`);
  }
  if (profile.geometryPolicy !== "scene-bounded") fail(`${label}.geometryPolicy`, "must be scene-bounded");
  const semantics = object(profile.sceneSemantics, `${label}.sceneSemantics`);
  exactKeys(semantics, new Set(["scope", "surfaces", "parameters", "assetSlots"]), `${label}.sceneSemantics`);
  if (semantics.scope !== "presentation-scene") fail(`${label}.sceneSemantics.scope`, "must be presentation-scene");
  return {
    profileVersion: profile.profileVersion,
    geometryPolicy: profile.geometryPolicy,
    sceneSemantics: {
      scope: semantics.scope,
      surfaces: validateMappingScope(semantics.surfaces, IMMERSIVE_SCENE_SURFACES, `${label}.sceneSemantics.surfaces`),
      parameters: validateMappingScope(semantics.parameters, IMMERSIVE_SCENE_PARAMETERS, `${label}.sceneSemantics.parameters`),
      assetSlots: validateMappingScope(semantics.assetSlots, IMMERSIVE_SCENE_ASSET_SLOTS, `${label}.sceneSemantics.assetSlots`),
    },
  };
}

export function validatePresentationBoundaries(value, label = "presentationBoundaries") {
  return validateMappingScope(value, IMMERSIVE_SCENE_BOUNDARIES, label);
}

function unsupportedPresentationCapability(profile = {}) {
  return {
    profileVersion: profile.profileVersion,
    geometryPolicy: profile.geometryPolicy,
    scope: null,
    surfaces: Object.fromEntries(IMMERSIVE_SCENE_SURFACES.map((surface) => [surface, "unsupported"])),
    parameters: Object.fromEntries(IMMERSIVE_SCENE_PARAMETERS.map((parameter) => [parameter, "unsupported"])),
    assetSlots: Object.fromEntries(IMMERSIVE_SCENE_ASSET_SLOTS.map((slot) => [slot, "unsupported"])),
  };
}

export function presentationCapability(profile = {}) {
  try {
    const validated = validatePresentationProfileCapability(profile);
    return {
      profileVersion: validated.profileVersion,
      geometryPolicy: validated.geometryPolicy,
      scope: validated.sceneSemantics.scope,
      surfaces: Object.fromEntries(Object.entries(validated.sceneSemantics.surfaces).map(([key, value]) => [key, value.decision])),
      parameters: Object.fromEntries(Object.entries(validated.sceneSemantics.parameters).map(([key, value]) => [key, value.decision])),
      assetSlots: Object.fromEntries(Object.entries(validated.sceneSemantics.assetSlots).map(([key, value]) => [key, value.decision])),
    };
  } catch {
    return unsupportedPresentationCapability(profile);
  }
}
