export const IMMERSIVE_SCENE_PROFILE_ID = "immersive-scene-v1";
export const IMMERSIVE_SCENE_PROFILE_VERSION = 1;
export const IMMERSIVE_SCENE_SURFACES = Object.freeze([
  "shell", "navigation", "home", "conversation", "composer", "cards", "overlays",
]);

const PARAMETER_KEYS = new Set([
  "density", "borderTreatment", "textureIntensity", "surfaceOpacity",
  "navigationTreatment", "composerTreatment", "cardTreatment",
]);
const ASSET_SLOT_KEYS = new Set(["scene.backdrop"]);
const FALLBACK_KEYS = new Set(["unsupportedSurface", "reducedMotion"]);
const FORBIDDEN_KEYS = new Set([
  "css", "javascript", "script", "html", "shader", "selector", "selectors", "command", "commands",
  "url", "urls", "path", "paths", "width", "height", "display", "grid", "flex", "order", "position",
]);
const SAFE_LOCAL_FILE = /^(?!.*[:/\\])[^\u0000-\u001f]+\.(?:png|jpe?g|webp)$/i;

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
  if (!Number.isFinite(parameters.surfaceOpacity) || parameters.surfaceOpacity < 0.4 || parameters.surfaceOpacity > 0.88) {
    fail(`${label}.parameters.surfaceOpacity`, "must be a number from 0.4 to 0.88");
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

export function presentationCapability(profile = {}) {
  const surfaces = profile.surfaces ?? {};
  return {
    profileVersion: profile.profileVersion,
    geometryPolicy: profile.geometryPolicy,
    surfaces: Object.fromEntries(IMMERSIVE_SCENE_SURFACES.map((surface) => [surface, surfaces[surface] ?? "unsupported"])),
  };
}
