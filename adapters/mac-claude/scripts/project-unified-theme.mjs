import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeSkinTheme } from "./skin-theme.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const capabilityPath = path.join(root, "contracts", "adapter-capability.json");
const MAX_REQUEST_BYTES = 1024 * 1024;
const COLOR_KEYS = new Set(["background", "panel", "panelAlt", "accent", "accentAlt", "secondary", "highlight", "text", "muted", "line"]);
const SEMANTIC_KEYS = new Set([
  "surfaceBase", "surfaceRaised", "surfaceElevated", "surfaceCode", "textStrong", "placeholder",
  "borderSubtle", "borderDefault", "borderStrong", "action", "actionHover", "actionPressed",
  "actionForeground", "hoverSurface", "pressedSurface", "selectedSurface", "selectedHoverSurface",
  "focusRing", "link", "danger", "success", "warning", "sidebarSurface", "headerSurface",
  "mainScrimStart", "mainScrimMid", "mainScrimEnd", "composerSurface",
]);
const COLOR_PATTERN = /^(?:#[0-9a-f]{6}|rgba?\([0-9., %]+\))$/i;
const SAFE_FONT_PATTERN = /^[\p{L}\p{N} ._-]{1,80}$/u;
const IMAGE_PATTERN = /^[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp)$/i;
const VIDEO_PATTERN = /^[A-Za-z0-9_.-]+\.mp4$/i;
export const MANAGER_PROJECTOR_INVOCATION_KIND = "cc-theme.adapter-projector-invocation";

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function keys(value, allowed, label) {
  const result = object(value ?? {}, label);
  for (const key of Object.keys(result)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field: ${key}`);
  }
  return result;
}

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function diagnostic(code, pathValue, decision, severity, message) {
  return { code, path: pathValue, decision, severity, message };
}

function assertEnum(value, allowed, label) {
  if (value !== undefined && !allowed.includes(value)) throw new Error(`${label} is invalid`);
}

function assertNumber(value, minimum, maximum, label, integer = false) {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be ${integer ? "an integer" : "a number"} from ${minimum} to ${maximum}`);
  }
}

function assertPosition(value, label) {
  if (value === undefined) return;
  const position = keys(value, new Set(["xPercent", "yPercent"]), label);
  if (position.xPercent === undefined || position.yPercent === undefined) throw new Error(`${label} requires xPercent and yPercent`);
  assertNumber(position.xPercent, 0, 100, `${label}.xPercent`);
  assertNumber(position.yPercent, 0, 100, `${label}.yPercent`);
}

function validateSharedValues(identity, background, colors, semanticColors, fonts, appearance, accessibility) {
  if (typeof identity.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(identity.id)) {
    throw new Error("sharedCore.identity.id is invalid");
  }
  if (typeof identity.name !== "string" || !identity.name.trim() || [...identity.name].length > 80) {
    throw new Error("sharedCore.identity.name must contain 1 to 80 characters");
  }
  if (typeof background.image !== "string" || !IMAGE_PATTERN.test(background.image)) {
    throw new Error("sharedCore.background.image must be a local image basename");
  }
  if (background.video !== undefined && (typeof background.video !== "string" || !VIDEO_PATTERN.test(background.video))) {
    throw new Error("sharedCore.background.video must be a local MP4 basename");
  }
  if (background.heroImage !== undefined && (typeof background.heroImage !== "string" || !IMAGE_PATTERN.test(background.heroImage))) {
    throw new Error("sharedCore.background.heroImage must be a local image basename");
  }
  assertEnum(background.mode, ["media", "ripple", "directional"], "sharedCore.background.mode");
  for (const [name, map] of [["colors", colors], ["semanticColors", semanticColors]]) {
    for (const [key, value] of Object.entries(map)) {
      if (typeof value !== "string" || !COLOR_PATTERN.test(value.trim())) {
        throw new Error(`sharedCore.${name}.${key} is not an allowlisted color`);
      }
    }
  }
  for (const [key, value] of Object.entries(fonts)) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 8 || value.some((font) => typeof font !== "string" || !SAFE_FONT_PATTERN.test(font))) {
      throw new Error(`sharedCore.fonts.${key} must contain 1 to 8 safe local font names`);
    }
  }
  assertEnum(appearance.shellMode, ["auto", "light", "dark"], "sharedCore.appearance.shellMode");
  assertNumber(appearance.backdropBlurPx, 0, 48, "sharedCore.appearance.backdropBlurPx");
  assertNumber(appearance.backdropSaturation, 0.5, 1.5, "sharedCore.appearance.backdropSaturation");
  assertNumber(appearance.radiusScale, 0.75, 1.5, "sharedCore.appearance.radiusScale");
  if (accessibility.increasedContrast !== undefined && typeof accessibility.increasedContrast !== "boolean") {
    throw new Error("sharedCore.accessibility.increasedContrast must be a boolean");
  }
  if (accessibility.forceMotion !== undefined && typeof accessibility.forceMotion !== "boolean") {
    throw new Error("sharedCore.accessibility.forceMotion must be a boolean");
  }
}

function validateTargetValues(profileArt, profileAppearance, effects, background) {
  assertNumber(profileArt.focusX, 0, 1, "targetProfiles.mac-claude.art.focusX");
  assertNumber(profileArt.focusY, 0, 1, "targetProfiles.mac-claude.art.focusY");
  assertEnum(profileArt.safeArea, ["auto", "left", "right", "center", "none"], "targetProfiles.mac-claude.art.safeArea");
  assertEnum(profileArt.taskMode, ["auto", "ambient", "banner", "off"], "targetProfiles.mac-claude.art.taskMode");
  assertEnum(profileArt.paletteMode, ["system", "media"], "targetProfiles.mac-claude.art.paletteMode");
  assertPosition(profileAppearance.backgroundPosition, "targetProfiles.mac-claude.appearance.backgroundPosition");
  assertPosition(profileAppearance.backgroundVideoPosition, "targetProfiles.mac-claude.appearance.backgroundVideoPosition");
  assertEnum(profileAppearance.backgroundVideoPosterMode, ["none", "image"], "targetProfiles.mac-claude.appearance.backgroundVideoPosterMode");
  assertNumber(profileAppearance.backgroundVideoScrimOpacity, 0, 0.8, "targetProfiles.mac-claude.appearance.backgroundVideoScrimOpacity");

  const hasRipple = effects.ripple !== undefined;
  const hasDirectional = effects.directional !== undefined;
  const mode = background.mode ?? "media";
  if ((mode === "media" && (hasRipple || hasDirectional)) ||
      (mode === "ripple" && hasDirectional) || (mode === "directional" && hasRipple)) {
    throw new Error("Mac-Claude Target Profile effects must match sharedCore.background.mode");
  }
  if (background.video === undefined && [
    profileAppearance.backgroundVideoPosition,
    profileAppearance.backgroundVideoPosterMode,
    profileAppearance.backgroundVideoScrimOpacity,
  ].some((value) => value !== undefined)) {
    throw new Error("Mac-Claude video appearance fields require sharedCore.background.video");
  }
}

export async function projectUnifiedTheme(request, options = {}) {
  const capability = options.capability ?? JSON.parse(await fs.readFile(capabilityPath, "utf8"));
  const diagnostics = [];
  try {
    const input = keys(request, new Set(["kind", "schemaVersion", "adapterId", "capabilityVersion", "sharedCore", "targetProfiles"]), "Projection request");
    if (input.kind !== "cc-theme.adapter-projection-request" || input.schemaVersion !== 1 || input.adapterId !== "mac-claude") {
      throw new Error("Projection request identity is invalid");
    }
    if (input.capabilityVersion !== undefined && input.capabilityVersion !== capability.capabilityVersion) {
      throw new Error(`Capability version ${input.capabilityVersion} is not supported`);
    }
    const core = keys(input.sharedCore, new Set([
      "identity", "colors", "semanticColors", "fonts", "appearance", "background", "accessibility",
    ]), "sharedCore");
    const identity = keys(core.identity, new Set(["id", "name"]), "sharedCore.identity");
    const background = keys(core.background, new Set(["mode", "image", "video", "heroImage"]), "sharedCore.background");
    const colors = keys(core.colors, COLOR_KEYS, "sharedCore.colors");
    const semanticColors = keys(core.semanticColors, SEMANTIC_KEYS, "sharedCore.semanticColors");
    const fonts = keys(core.fonts, new Set(["ui", "display", "code"]), "sharedCore.fonts");
    const appearance = keys(core.appearance, new Set(["shellMode", "backdropBlurPx", "backdropSaturation", "radiusScale"]), "sharedCore.appearance");
    const accessibility = keys(core.accessibility, new Set(["reducedMotion", "increasedContrast", "forceMotion"]), "sharedCore.accessibility");
    const profiles = keys(input.targetProfiles, new Set(["mac-claude"]), "targetProfiles");
    const profile = keys(profiles["mac-claude"], new Set(["art", "appearance", "effects"]), "targetProfiles.mac-claude");
    const profileArt = keys(profile.art, new Set(["focusX", "focusY", "safeArea", "taskMode", "paletteMode"]), "targetProfiles.mac-claude.art");
    const profileAppearance = keys(profile.appearance, new Set([
      "backgroundPosition", "backgroundVideoPosition", "backgroundVideoPosterMode", "backgroundVideoScrimOpacity",
    ]), "targetProfiles.mac-claude.appearance");
    const effects = keys(profile.effects, new Set(["ripple", "directional"]), "targetProfiles.mac-claude.effects");
    validateSharedValues(identity, background, colors, semanticColors, fonts, appearance, accessibility);
    validateTargetValues(profileArt, profileAppearance, effects, background);

    const theme = {
      kind: "skin.theme",
      id: identity.id,
      name: identity.name,
      image: background.image,
    };
    if (Object.keys(colors).length) theme.colors = copy(colors);
    if (Object.keys(semanticColors).length) theme.semanticColors = copy(semanticColors);
    if (Object.keys(fonts).length) theme.fonts = copy(fonts);
    if (Object.keys(profileArt).length) theme.art = copy(profileArt);
    const targetAppearance = { ...copy(appearance), ...copy(profileAppearance) };
    if (Object.keys(targetAppearance).length) theme.appearance = targetAppearance;
    if (background.video !== undefined) theme.backgroundVideo = background.video;

    const mode = background.mode ?? "media";
    if (mode === "ripple") {
      theme.interactiveBackground = { type: "ripple", ...copy(keys(effects.ripple, new Set(["intensity", "radiusPx", "quality", "scrimOpacity"]), "targetProfiles.mac-claude.effects.ripple")) };
    } else if (mode === "directional") {
      const directional = keys(effects.directional, new Set([
        "atlas", "directions", "columns", "rows", "firstDirectionDegrees", "idleFrame", "origin", "scrimOpacity",
      ]), "targetProfiles.mac-claude.effects.directional");
      if (!["atlas", "directions", "columns", "rows"].every((key) => directional[key] !== undefined)) {
        throw new Error("Directional background requires the Mac-Claude atlas, directions, columns and rows Target Profile fields");
      }
      theme.interactiveBackground = { type: "directional", ...copy(directional) };
    }

    if (appearance.radiusScale !== undefined) {
      diagnostics.push(diagnostic(
        "approximate-owned-radius-only", "sharedCore.appearance.radiusScale", "approximated", "warning",
        "Radius scale applies only to CC Theme-owned surfaces; Claude native Settings navigation geometry remains native.",
      ));
    }
    if (profileArt.taskMode !== undefined) {
      diagnostics.push(diagnostic(
        "approximate-art-layout-hint", "targetProfiles.mac-claude.art.taskMode", "approximated", "warning",
        "Task mode is a decorative artwork/layout hint and does not alter Claude native navigation or content structure.",
      ));
    }
    if (background.heroImage !== undefined) {
      diagnostics.push(diagnostic(
        "unsupported-separate-home-hero-surface", "sharedCore.background.heroImage", "unsupported", "warning",
        "Claude's verified Surface Catalog has no separate stable home Hero surface; the optional field was omitted.",
      ));
    }
    if (accessibility.reducedMotion !== undefined) {
      if (accessibility.reducedMotion !== "system") {
        throw new Error("sharedCore.accessibility.reducedMotion must be system for Mac-Claude");
      }
      diagnostics.push(diagnostic(
        "host-reduced-motion-owner", "sharedCore.accessibility.reducedMotion", "supported", "info",
        "Reduced Motion is evaluated at runtime after theme and local overrides.",
      ));
    }
    if (accessibility.increasedContrast !== undefined) {
      diagnostics.push(diagnostic(
        "unsupported-increased-contrast-projection", "sharedCore.accessibility.increasedContrast", "unsupported", "warning",
        "The current Claude Surface Catalog does not provide a verified increased-contrast projection; the optional value was omitted.",
      ));
    }
    if (accessibility.forceMotion !== undefined) {
      diagnostics.push(diagnostic(
        "unsupported-accessibility-override", "sharedCore.accessibility.forceMotion", "unsupported", "error",
        "Mac-Claude never allows theme data to override the host Reduced Motion safety decision.",
      ));
      throw new Error("forceMotion is forbidden by the Mac-Claude accessibility policy");
    }
    normalizeSkinTheme(theme, "Projected Mac-Claude skin.theme");
    diagnostics.push(diagnostic(
      "runtime-apply-unavailable", "$adapter.availability", "unsupported", "warning",
      capability.availability.reason,
    ));
    return {
      kind: "cc-theme.adapter-projection-result",
      schemaVersion: 1,
      adapterId: "mac-claude",
      status: "projected",
      pass: true,
      capabilityVersion: capability.capabilityVersion,
      runtimeApplyAvailable: capability.availability.runtimeApplyAvailable,
      skinTheme: theme,
      diagnostics,
    };
  } catch (error) {
    if (!diagnostics.some((item) => item.severity === "error")) {
      diagnostics.push(diagnostic("projection-invalid", "$request", "unsupported", "error", error.message));
    }
    return {
      kind: "cc-theme.adapter-projection-result",
      schemaVersion: 1,
      adapterId: "mac-claude",
      status: "failed",
      pass: false,
      capabilityVersion: capability.capabilityVersion,
      runtimeApplyAvailable: capability.availability.runtimeApplyAvailable,
      diagnostics,
      message: error.message,
    };
  }
}

function neutralInvocation(value) {
  const invocation = keys(value, new Set([
    "kind", "schemaVersion", "adapterId", "capabilityVersion", "identity", "sharedCore",
    "targetProfiles", "compileContext", "assetBindings",
  ]), "Adapter projector invocation");
  if (invocation.kind !== MANAGER_PROJECTOR_INVOCATION_KIND || invocation.schemaVersion !== 1 || invocation.adapterId !== "mac-claude") {
    throw new Error("Adapter projector invocation has an invalid Mac-Claude identity");
  }
  const identity = keys(invocation.identity, new Set(["id", "name", "version"]), "Adapter projector identity");
  if (typeof identity.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(identity.version)) {
    throw new Error("Adapter projector identity.version is invalid");
  }
  const core = keys(invocation.sharedCore, new Set(["tokens", "background", "accessibility"]), "Adapter projector Shared Core");
  const profiles = keys(invocation.targetProfiles, new Set(["mac-claude"]), "Adapter projector Target Profiles");
  const assets = keys(invocation.assetBindings, new Set(["background", "homeHero", "video", "atlas"]), "Adapter projector asset bindings");
  object(invocation.compileContext, "Adapter projector compile context");
  for (const [role, filename] of Object.entries(assets)) {
    const allowed = role === "video" ? VIDEO_PATTERN : IMAGE_PATTERN;
    if (typeof filename !== "string" || !allowed.test(filename) || filename.includes("..")) {
      throw new Error(`Adapter projector assetBindings.${role} must be a safe package-local filename`);
    }
  }
  return { invocation, identity, core, profile: profiles["mac-claude"] ?? {}, assets };
}

function optionalAccessibilityDiagnostics(accessibility) {
  return ["minimumTextContrast", "minimumLargeTextContrast", "preserveSystemFocusRing", "transparencyFallback"]
    .filter((field) => accessibility[field] !== undefined)
    .map((field) => diagnostic(
      `unsupported-accessibility-${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      `accessibility.${field}`,
      "unsupported",
      "warning",
      `Mac-Claude has no verified projection for accessibility.${field}; the optional value was omitted.`,
    ));
}

export async function projectThemeFamilyAdapter(value) {
  const wrapperDiagnostics = [];
  try {
    const { invocation, identity, core, profile: rawProfile, assets } = neutralInvocation(value);
    const capability = JSON.parse(await fs.readFile(capabilityPath, "utf8"));
    if (invocation.capabilityVersion !== capability.capabilityVersion) {
      throw new Error(`Mac-Claude capability version ${String(invocation.capabilityVersion)} is not supported`);
    }
    const tokens = keys(core.tokens, new Set(["colors", "fonts", "appearance"]), "Adapter projector Shared Core tokens");
    const colors = keys(tokens.colors, new Set([
      "surfaceBase", "surfaceRaised", "surfaceElevated", "surfaceCode", "text", "textStrong", "textMuted",
      "placeholder", "borderSubtle", "borderDefault", "borderStrong", "action", "actionHover", "actionPressed",
      "actionForeground", "hoverSurface", "pressedSurface", "selectedSurface", "selectedHoverSurface", "focusRing",
      "link", "danger", "success", "warning", "sidebarSurface", "headerSurface", "mainScrimStart", "mainScrimMid",
      "mainScrimEnd", "composerSurface",
    ]), "Adapter projector Shared Core colors");
    const sharedAppearance = keys(tokens.appearance, new Set([
      "shellMode", "backdropBlurPx", "backdropSaturation", "radiusScale", "backgroundPosition", "homeHeroPosition",
    ]), "Adapter projector Shared Core appearance");
    const background = object(core.background, "Adapter projector Shared Core background");
    const accessibility = keys(core.accessibility, new Set([
      "reducedMotion", "minimumTextContrast", "minimumLargeTextContrast", "preserveSystemFocusRing", "transparencyFallback",
    ]), "Adapter projector Shared Core accessibility");
    const legacy = rawProfile.kind === "cc-theme.legacy-target-profile";
    const profile = legacy ? {} : copy(rawProfile);
    if (legacy) {
      for (const field of Object.keys(rawProfile.copy ?? {}).sort()) {
        wrapperDiagnostics.push(diagnostic(
          "legacy-copy-surface-unsupported",
          `copy.${field}`,
          "unsupported",
          "warning",
          `Legacy copy.${field} is not rendered by Mac-Claude and was omitted.`,
        ));
      }
    }
    profile.appearance = {
      ...(sharedAppearance.backgroundPosition === undefined ? {} : { backgroundPosition: copy(sharedAppearance.backgroundPosition) }),
      ...(profile.appearance ?? {}),
    };
    if (background.mode === "media" && assets.video !== undefined) {
      if (profile.appearance.backgroundVideoPosition === undefined && background.position !== undefined) {
        profile.appearance.backgroundVideoPosition = copy(background.position);
      }
      if (profile.appearance.backgroundVideoPosterMode === undefined && background.posterMode !== undefined) {
        profile.appearance.backgroundVideoPosterMode = background.posterMode;
      }
      if (profile.appearance.backgroundVideoScrimOpacity === undefined && background.scrimOpacity !== undefined) {
        profile.appearance.backgroundVideoScrimOpacity = background.scrimOpacity;
      }
    }
    if (background.mode === "ripple") {
      profile.effects = {
        ...(profile.effects ?? {}),
        ripple: {
          ...Object.fromEntries(["intensity", "radiusPx", "quality", "scrimOpacity"]
            .filter((field) => background[field] !== undefined).map((field) => [field, copy(background[field])])),
          ...(profile.effects?.ripple ?? {}),
        },
      };
    }
    if (background.mode === "directional") {
      profile.effects = {
        ...(profile.effects ?? {}),
        directional: {
          ...Object.fromEntries(["directions", "columns", "rows", "firstDirectionDegrees", "idleFrame", "origin", "scrimOpacity"]
            .filter((field) => background[field] !== undefined).map((field) => [field, copy(background[field])])),
          ...(assets.atlas === undefined ? {} : { atlas: assets.atlas }),
          ...(profile.effects?.directional ?? {}),
        },
      };
    }
    const semanticColors = Object.fromEntries(Object.entries(colors).filter(([field]) => field !== "text" && field !== "textMuted"));
    const request = {
      kind: "cc-theme.adapter-projection-request",
      schemaVersion: 1,
      adapterId: "mac-claude",
      capabilityVersion: capability.capabilityVersion,
      sharedCore: {
        identity: { id: identity.id, name: identity.name },
        colors: { text: colors.text, muted: colors.textMuted },
        semanticColors,
        fonts: copy(tokens.fonts),
        appearance: Object.fromEntries(["shellMode", "backdropBlurPx", "backdropSaturation", "radiusScale"]
          .filter((field) => sharedAppearance[field] !== undefined).map((field) => [field, copy(sharedAppearance[field])])),
        background: {
          mode: background.mode,
          image: assets.background,
          ...(assets.video === undefined ? {} : { video: assets.video }),
          ...(assets.homeHero === undefined ? {} : { heroImage: assets.homeHero }),
        },
        accessibility: { reducedMotion: accessibility.reducedMotion === "static" ? "system" : accessibility.reducedMotion },
      },
      targetProfiles: { "mac-claude": profile },
    };
    wrapperDiagnostics.push(...optionalAccessibilityDiagnostics(accessibility));
    const result = await projectUnifiedTheme(request, { capability });
    result.diagnostics = [...wrapperDiagnostics, ...(result.diagnostics ?? [])];
    return result;
  } catch (error) {
    wrapperDiagnostics.push(diagnostic("projection-invalid", "$request", "unsupported", "error", error.message));
    return {
      kind: "cc-theme.adapter-projection-result",
      schemaVersion: 1,
      adapterId: "mac-claude",
      status: "failed",
      pass: false,
      runtimeApplyAvailable: false,
      diagnostics: wrapperDiagnostics,
      message: error.message,
    };
  }
}

async function readRequest(file) {
  if (typeof file !== "string" || !path.isAbsolute(file)) throw new Error("--request must be an absolute path");
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_REQUEST_BYTES) {
    throw new Error("Projection request must be a bounded regular JSON file");
  }
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function main(argv) {
  if (argv[0] === "--describe") {
    process.stdout.write(await fs.readFile(capabilityPath, "utf8"));
    return;
  }
  if (argv[0] !== "--request" || !argv[1]) throw new Error("Usage: project-unified-theme.mjs --describe | --request <absolute.json>");
  const result = await projectUnifiedTheme(await readRequest(argv[1]));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
