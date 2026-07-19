import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertThemePayloadSafe, normalizeTheme } from "./theme-normalizer.mjs";

const capability = JSON.parse(readFileSync(fileURLToPath(new URL("../contracts/adapter-capability.json", import.meta.url)), "utf8"));
const decisions = new Map(capability.sharedCore.fields.map((entry) => [entry.source, entry]));

function fail(code) {
  throw new Error(code);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
  cursor[parts.at(-1)] = structuredClone(value);
}

function flatten(value, prefix, output) {
  if (decisions.has(prefix) || !isObject(value)) {
    output.push({ source: prefix, value });
    return;
  }
  for (const [key, entry] of Object.entries(value)) flatten(entry, `${prefix}.${key}`, output);
}

function canonicalLeaves(theme) {
  const leaves = [
    { source: "id", value: theme.id },
    { source: "name", value: theme.name },
    { source: "version", value: theme.version },
  ];
  flatten(theme.sharedCore.tokens, "tokens", leaves);
  const background = theme.sharedCore.background;
  leaves.push({ source: `background.mode.${background.mode}`, value: background.mode });
  for (const [key, value] of Object.entries(background)) {
    if (key === "mode") continue;
    const prefix = background.mode === "ripple" && new Set(["intensity", "radiusPx", "quality"]).has(key)
      ? "background.ripple"
      : background.mode === "directional" && new Set(["atlas", "directions", "columns", "rows", "firstDirectionDegrees", "idleFrame", "origin"]).has(key)
        ? "background.directional"
        : "background";
    flatten(value, `${prefix}.${key}`, leaves);
  }
  flatten(theme.sharedCore.accessibility, "accessibility", leaves);
  return leaves;
}

function validateEnvelope(theme) {
  if (!isObject(theme) || theme.kind !== "cc-theme.unified-theme" || theme.schemaVersion !== 2) {
    fail("unified-theme-identity-invalid");
  }
  for (const key of Object.keys(theme)) {
    if (!new Set(["kind", "schemaVersion", "id", "name", "version", "sharedCore", "targets", "targetProfiles"]).has(key)) {
      fail("unified-theme-field-unknown");
    }
  }
  if (!Array.isArray(theme.targets) || !theme.targets.includes("win-workbuddy-skin")) fail("adapter-target-missing");
  if (!isObject(theme.sharedCore) || !isObject(theme.sharedCore.tokens)
    || !isObject(theme.sharedCore.background) || !isObject(theme.sharedCore.accessibility)) {
    fail("shared-core-invalid");
  }
  for (const key of Object.keys(theme.sharedCore)) {
    if (!new Set(["tokens", "background", "accessibility"]).has(key)) fail("shared-core-field-unknown");
  }
  for (const key of Object.keys(theme.sharedCore.tokens)) {
    if (!new Set(["colors", "fonts", "appearance"]).has(key)) fail("shared-core-token-group-unknown");
  }
}

function targetProfile(theme) {
  const profile = theme.targetProfiles?.["win-workbuddy-skin"] ?? {
    kind: "cc-theme.target-profile",
    schemaVersion: 1,
    adapterId: "win-workbuddy-skin",
    values: {},
  };
  if (!isObject(profile) || profile.kind !== "cc-theme.target-profile" || profile.schemaVersion !== 1
    || profile.adapterId !== "win-workbuddy-skin" || !isObject(profile.values)) fail("target-profile-invalid");
  for (const key of Object.keys(profile)) {
    if (!new Set(["kind", "schemaVersion", "adapterId", "values"]).has(key)) fail("target-profile-field-unknown");
  }
  const allowed = new Set(["paletteStrategy", "backgroundVideoPosterMode", "backgroundVideoPosition"]);
  for (const key of Object.keys(profile.values)) if (!allowed.has(key)) fail("target-profile-field-unknown");
  if (profile.values.paletteStrategy !== undefined
    && !new Set(["system", "adaptive", "custom"]).has(profile.values.paletteStrategy)) fail("target-profile-palette-invalid");
  if (profile.values.backgroundVideoPosterMode !== undefined
    && !new Set(["none", "image"]).has(profile.values.backgroundVideoPosterMode)) fail("target-profile-poster-invalid");
  return profile.values;
}

export function projectUnifiedTheme(theme) {
  assertThemePayloadSafe(theme);
  validateEnvelope(theme);
  const profile = targetProfile(theme);
  const artifact = {
    kind: "skin.theme",
    schemaVersion: 1,
    adapterId: "win-workbuddy-skin",
    colors: {},
    fonts: {},
    appearance: { paletteStrategy: profile.paletteStrategy ?? "system" },
    background: {},
    accessibility: {},
  };
  const diagnostics = [];
  for (const leaf of canonicalLeaves(theme)) {
    const decision = decisions.get(leaf.source);
    if (!decision) fail("shared-core-field-undecided");
    diagnostics.push({ source: leaf.source, decision: decision.decision, code: decision.diagnostic });
    if (decision.decision === "unsupported") {
      if (decision.required) fail("required-field-unsupported");
      continue;
    }
    setPath(artifact, decision.target, leaf.value);
  }

  if (profile.backgroundVideoPosterMode !== undefined) {
    if (artifact.background.mode === "media") artifact.background.posterMode = profile.backgroundVideoPosterMode;
    diagnostics.push({
      source: "targetProfile.backgroundVideoPosterMode",
      decision: artifact.background.mode === "media" ? "exact" : "unsupported",
      code: artifact.background.mode === "media" ? "mapped-exact" : "target-profile-field-inapplicable",
    });
  }
  if (profile.backgroundVideoPosition !== undefined) {
    artifact.background.position = structuredClone(profile.backgroundVideoPosition);
    diagnostics.push({ source: "targetProfile.backgroundVideoPosition", decision: "exact", code: "mapped-exact" });
  }
  diagnostics.push({ source: "targetProfile.paletteStrategy", decision: "exact", code: "mapped-exact" });

  return {
    artifact: normalizeTheme(artifact),
    diagnostics,
    runtimeApplyAvailable: false,
    applyDeniedCode: "runtime-seam-unverified",
  };
}

export function projectionDecisions() {
  return structuredClone(capability.sharedCore.fields);
}
