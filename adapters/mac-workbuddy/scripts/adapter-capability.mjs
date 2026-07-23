import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  UI_SURFACE_CATALOG_VERSION,
  UI_SURFACE_SCHEMA_VERSION,
  loadUiSurfaceCatalog,
  validateUiSurfaceCatalog,
} from "./ui-surface-catalog.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ADAPTER_CAPABILITY_PATH = path.join(here, "..", "contracts", "adapter-capability.json");
export const TARGET_PROFILE_SCHEMA_PATH = path.join(here, "..", "contracts", "target-profile.schema.json");
export const ADAPTER_CAPABILITY_KIND = "cc-theme.adapter-capability";
export const TARGET_PROFILE_KIND = "cc-theme.target-profile";
export const ADAPTER_ID = "mac-workbuddy";
export const ADAPTER_VERSION = "5.2.6";
export const ADAPTER_RELEASE_REVISION = 4;
export const ADAPTER_PLATFORM = "macos";
export const ADAPTER_ARCHITECTURE = "arm64";

const plainObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const safeRelative = (value) => typeof value === "string" && value.length > 2 && value.length <= 240 &&
  !path.isAbsolute(value) && !value.includes("..") && !value.includes("\\") && !/^[a-z]+:/i.test(value);

function exactKeys(value, allowed, label) {
  const object = plainObject(value);
  if (!object) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}`);
  return object;
}

export function validateAdapterCapability(value, label = "WorkBuddy adapter capability") {
  const capability = exactKeys(value, [
    "kind", "schemaVersion", "capabilityVersion", "adapterId", "adapterVersion",
    "adapterReleaseRevision", "platform", "architecture", "available", "runtimeApplyAvailable",
    "catalogs", "compatibility", "sharedCore", "targetProfile", "presentationProfiles", "presentationBoundaries", "localRuntimeOverrides", "paletteStrategy",
    "transactionSeam", "migration",
  ], label);
  if (capability.kind !== ADAPTER_CAPABILITY_KIND || capability.schemaVersion !== 1 ||
      capability.capabilityVersion !== 1 || capability.adapterId !== ADAPTER_ID ||
      capability.adapterVersion !== ADAPTER_VERSION ||
      capability.adapterReleaseRevision !== ADAPTER_RELEASE_REVISION ||
      capability.platform !== ADAPTER_PLATFORM || capability.architecture !== ADAPTER_ARCHITECTURE ||
      capability.available !== true || capability.runtimeApplyAvailable !== true) {
    throw new Error(`${label} has an invalid identity or availability state`);
  }
  const catalogs = exactKeys(capability.catalogs, [
    "skinThemeSchema", "themeStyleCatalog", "themeStyleCatalogVersion", "uiSurfaceCatalogPattern",
    "uiSurfaceCatalogSchemaVersion", "uiSurfaceCatalogVersion", "targetProfileSchema", "targetProfileSchemaVersion",
  ], `${label}.catalogs`);
  for (const key of ["skinThemeSchema", "themeStyleCatalog", "uiSurfaceCatalogPattern", "targetProfileSchema"]) {
    if (!safeRelative(catalogs[key])) throw new Error(`${label}.catalogs.${key} must be a safe adapter-relative reference`);
  }
  if (catalogs.themeStyleCatalogVersion !== 2 ||
      catalogs.uiSurfaceCatalogSchemaVersion !== UI_SURFACE_SCHEMA_VERSION ||
      catalogs.uiSurfaceCatalogVersion !== UI_SURFACE_CATALOG_VERSION ||
      catalogs.targetProfileSchemaVersion !== 1) {
    throw new Error(`${label} has invalid catalog versions`);
  }
  const compatibility = exactKeys(capability.compatibility, [
    "policy", "verifiedClientVersions", "runtimeProbeRequired", "applyDeniedCode",
  ], `${label}.compatibility`);
  if (compatibility.policy !== "verified-only" || compatibility.runtimeProbeRequired !== true ||
      compatibility.applyDeniedCode !== "client-version-unsupported" ||
      !Array.isArray(compatibility.verifiedClientVersions) || !compatibility.verifiedClientVersions.length ||
      new Set(compatibility.verifiedClientVersions).size !== compatibility.verifiedClientVersions.length ||
      compatibility.verifiedClientVersions.some((version) => typeof version !== "string" || !/^[A-Za-z0-9._+-]{1,80}$/.test(version))) {
    throw new Error(`${label} has invalid compatibility policy`);
  }
  if (!compatibility.verifiedClientVersions.includes(capability.adapterVersion)) {
    throw new Error(`${label} adapterVersion must be an admitted host ShortVersion`);
  }
  const sharedCore = exactKeys(capability.sharedCore, ["sourceKind", "fields"], `${label}.sharedCore`);
  const fields = sharedCore.fields;
  if (sharedCore.sourceKind !== "cc-theme.unified-theme" || !Array.isArray(fields) || !fields.length) {
    throw new Error(`${label} requires Shared Core decisions`);
  }
  const sources = new Set();
  for (const field of fields) {
    exactKeys(field, ["source", "decision", "required", "target", "diagnostic", "condition"], `${label}.sharedCore field`);
    if (typeof field.source !== "string" || !/^[A-Za-z][A-Za-z0-9_.*-]{0,199}$/.test(field.source) ||
        sources.has(field.source) || !["exact", "approximate", "unsupported"].includes(field.decision) ||
        typeof field.required !== "boolean" ||
        (field.target !== null && (typeof field.target !== "string" || !/^[A-Za-z][A-Za-z0-9.|_-]{0,159}$/.test(field.target))) ||
        typeof field.diagnostic !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(field.diagnostic) ||
        (field.condition !== undefined && (typeof field.condition !== "string" || field.condition.length > 160))) {
      throw new Error(`${label} has an invalid or duplicate Shared Core decision`);
    }
    if (field.required && field.decision === "unsupported") {
      throw new Error(`${label} cannot leave a required Shared Core field unsupported`);
    }
    sources.add(field.source);
  }
  const requiredDecisionSources = [
    "tokens.colors.surfaceCode", "tokens.colors.borderStrong", "tokens.colors.selectedHoverSurface",
    "tokens.colors.success", "tokens.colors.warning", "background.homeHeroImage",
    "accessibility.reducedMotion", "copy.*",
  ];
  for (const source of requiredDecisionSources) {
    if (!sources.has(source)) throw new Error(`${label} is missing an explicit decision for ${source}`);
  }
  const targetProfile = exactKeys(capability.targetProfile, ["kind", "schema", "schemaVersion", "fields"], `${label}.targetProfile`);
  const profileFields = targetProfile.fields;
  if (targetProfile.kind !== TARGET_PROFILE_KIND || targetProfile.schemaVersion !== 1 ||
      !safeRelative(targetProfile.schema) || !Array.isArray(profileFields) || !profileFields.length) {
    throw new Error(`${label} has an invalid Target Profile declaration`);
  }
  const profileIds = new Set();
  for (const field of profileFields) {
    exactKeys(field, ["id", "decision", "values", "type"], `${label}.targetProfile field`);
    if (typeof field.id !== "string" || !/^[a-z][A-Za-z0-9]{0,79}$/.test(field.id) || profileIds.has(field.id) ||
        !["exact", "approximate", "unsupported"].includes(field.decision) ||
        (field.values !== undefined && (!Array.isArray(field.values) || !field.values.length || new Set(field.values).size !== field.values.length || field.values.some((item) => typeof item !== "string"))) ||
        (field.type !== undefined && (typeof field.type !== "string" || !/^[a-z][A-Za-z0-9]{0,39}$/.test(field.type)))) {
      throw new Error(`${label} has an invalid or duplicate Target Profile field`);
    }
    profileIds.add(field.id);
  }
  const presentationProfiles = exactKeys(capability.presentationProfiles, ["immersive-scene-v1"], `${label}.presentationProfiles`);
  const immersive = exactKeys(presentationProfiles["immersive-scene-v1"], ["profileVersion", "geometryPolicy", "sceneSemantics"], `${label}.presentationProfiles.immersive-scene-v1`);
  const sceneSemantics = exactKeys(immersive.sceneSemantics, ["scope", "surfaces", "parameters", "assetSlots"], `${label}.presentationProfiles.immersive-scene-v1.sceneSemantics`);
  const exactSceneDecisions = (value, keys, scope) => {
    const decisions = exactKeys(value, keys, `${label}.presentationProfiles.immersive-scene-v1.sceneSemantics.${scope}`);
    for (const [name, declaration] of Object.entries(decisions)) {
      const entry = exactKeys(declaration, ["decision", "consumerId", "diagnostic"], `${label}.presentationProfiles.immersive-scene-v1.sceneSemantics.${scope}.${name}`);
      if (entry.decision !== "exact" || typeof entry.consumerId !== "string" ||
          !/^workbuddy\.presentation\.(?:surface|parameter|asset)\.[a-z0-9.-]{1,120}$/.test(entry.consumerId) ||
          typeof entry.diagnostic !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(entry.diagnostic)) {
        throw new Error(`${label} requires exact immersive scene semantics for ${scope}.${name}`);
      }
    }
    return decisions;
  };
  exactSceneDecisions(sceneSemantics.surfaces, ["shell", "navigation", "home", "conversation", "composer", "cards", "overlays"], "surfaces");
  exactSceneDecisions(sceneSemantics.parameters, ["density", "borderTreatment", "textureIntensity", "surfaceOpacity", "navigationTreatment", "composerTreatment", "cardTreatment"], "parameters");
  exactSceneDecisions(sceneSemantics.assetSlots, ["scene.backdrop"], "assetSlots");
  if (immersive.profileVersion !== 1 || immersive.geometryPolicy !== "scene-bounded" || sceneSemantics.scope !== "presentation-scene") {
    throw new Error(`${label} has an invalid immersive scene capability declaration`);
  }
  const presentationBoundaries = exactKeys(capability.presentationBoundaries, ["nativeControls", "layout", "uncataloguedPortals", "fonts"], `${label}.presentationBoundaries`);
  for (const [scope, declaration] of Object.entries(presentationBoundaries)) {
    const boundary = exactKeys(declaration, ["decision", "consumerId", "diagnostic"], `${label}.presentationBoundaries.${scope}`);
    if (boundary.decision !== "unsupported" || boundary.consumerId !== null || typeof boundary.diagnostic !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(boundary.diagnostic)) {
      throw new Error(`${label} must keep ${scope} outside the immersive exact scope`);
    }
  }
  const localRuntimeOverrides = exactKeys(capability.localRuntimeOverrides, [
    "kind", "schema", "schemaVersion", "catalog", "catalogVersion", "editableTokens", "rebase", "incompatible",
  ], `${label}.localRuntimeOverrides`);
  const editableTokens = localRuntimeOverrides.editableTokens;
  if (localRuntimeOverrides.kind !== "theme.runtime-settings" ||
      localRuntimeOverrides.schemaVersion !== 2 ||
      localRuntimeOverrides.catalogVersion !== catalogs.themeStyleCatalogVersion ||
      !safeRelative(localRuntimeOverrides.schema) || !safeRelative(localRuntimeOverrides.catalog) || !Array.isArray(editableTokens) ||
      !editableTokens.length || new Set(editableTokens).size !== editableTokens.length ||
      editableTokens.some((token) => typeof token !== "string" || !/^[a-z][A-Za-z0-9.-]{0,79}$/.test(token)) ||
      localRuntimeOverrides.rebase !== "validate-by-stable-token-and-control-fingerprint" ||
      localRuntimeOverrides.incompatible !== "quarantine-with-visible-diagnostic") {
    throw new Error(`${label} has invalid Local Runtime Override tokens`);
  }
  const paletteStrategy = exactKeys(capability.paletteStrategy, [
    "precedence", "system", "adaptive", "custom", "adaptiveAuthoringAvailable", "adaptiveRuntimeAvailable",
  ], `${label}.paletteStrategy`);
  if (paletteStrategy.adaptiveRuntimeAvailable !== true ||
      paletteStrategy.adaptiveAuthoringAvailable !== false ||
      JSON.stringify(paletteStrategy.precedence) !== JSON.stringify([
        "shared-core", "target-profile", "local-runtime-override", "runtime-accessibility-and-host-safety",
      ]) || [paletteStrategy.system, paletteStrategy.adaptive, paletteStrategy.custom]
        .some((description) => typeof description !== "string" || !description.trim() || description.length > 320)) {
    throw new Error(`${label} has an invalid palette strategy contract`);
  }
  const transactionSeam = exactKeys(capability.transactionSeam, [
    "implementation", "scope", "serialization", "persistence", "writers",
  ], `${label}.transactionSeam`);
  if (transactionSeam.serialization !== "cross-process-exclusive-lock" ||
      transactionSeam.persistence !== "atomic-fsync-rename" || transactionSeam.scope !== "theme-id" ||
      JSON.stringify(transactionSeam.writers) !== JSON.stringify(["manager-apply", "workbuddy-settings"]) ||
      !safeRelative(transactionSeam.implementation)) {
    throw new Error(`${label} has an invalid transaction seam`);
  }
  const migration = exactKeys(capability.migration, [
    "adapterIdPolicy", "localStateMigration", "legacyUnifiedTargetsCompatibility", "legacyOverridesWorkbuddy",
    "writePolicy", "removalEarliestCapabilityVersion",
  ], `${label}.migration`);
  if (migration.adapterIdPolicy !== "canonical-only-no-alias" ||
      migration.localStateMigration !== "one-time-pre-canonical-directory-move" ||
      !Number.isSafeInteger(migration.removalEarliestCapabilityVersion) || migration.removalEarliestCapabilityVersion < 2 ||
      [migration.legacyUnifiedTargetsCompatibility, migration.legacyOverridesWorkbuddy]
        .some((description) => typeof description !== "string" || !description.trim() || description.length > 160) ||
      typeof migration.writePolicy !== "string" || !migration.writePolicy.trim() || migration.writePolicy.length > 200) {
    throw new Error(`${label} has an invalid migration contract`);
  }
  return capability;
}

export function validateTargetProfile(value, label = "WorkBuddy Target Profile") {
  if (value === undefined || value === null) {
    return { kind: TARGET_PROFILE_KIND, schemaVersion: 1, adapterId: ADAPTER_ID, values: {} };
  }
  const profile = exactKeys(value, ["kind", "schemaVersion", "adapterId", "values"], label);
  if (profile.kind !== TARGET_PROFILE_KIND || profile.schemaVersion !== 1 || profile.adapterId !== ADAPTER_ID) {
    throw new Error(`${label} has an invalid identity`);
  }
  const values = exactKeys(profile.values, [
    "paletteStrategy", "backgroundVideoPosterMode",
  ], `${label}.values`);
  if (values.paletteStrategy !== undefined && !["system", "adaptive", "custom"].includes(values.paletteStrategy)) {
    throw new Error(`${label}.values.paletteStrategy is invalid`);
  }
  if (values.backgroundVideoPosterMode !== undefined && !["none", "image"].includes(values.backgroundVideoPosterMode)) {
    throw new Error(`${label}.values.backgroundVideoPosterMode is invalid`);
  }
  return structuredClone(profile);
}

export async function loadAdapterCapability(file = ADAPTER_CAPABILITY_PATH) {
  const capability = validateAdapterCapability(JSON.parse(await fs.readFile(file, "utf8")));
  for (const clientVersion of capability.compatibility.verifiedClientVersions) {
    const catalog = await loadUiSurfaceCatalog(clientVersion);
    const errors = validateUiSurfaceCatalog(catalog);
    if (errors.length) throw new Error(`WorkBuddy UI Surface Catalog ${clientVersion} is invalid: ${errors.join("; ")}`);
    validateCapabilityCatalogConsistency(capability, catalog, `WorkBuddy UI Surface Catalog ${clientVersion}`);
  }
  return capability;
}

export function validateCapabilityCatalogConsistency(capability, catalog, label = "WorkBuddy UI Surface Catalog") {
  if (catalog?.schemaVersion !== capability?.catalogs?.uiSurfaceCatalogSchemaVersion ||
      catalog?.catalogVersion !== capability?.catalogs?.uiSurfaceCatalogVersion ||
      catalog?.adapter !== capability?.adapterId ||
      catalog?.adapterVersion !== capability?.adapterVersion ||
      catalog?.adapterReleaseRevision !== capability?.adapterReleaseRevision ||
      catalog?.target?.version === undefined ||
      !capability?.compatibility?.verifiedClientVersions?.includes(catalog.target.version)) {
    throw new Error(`${label} does not match the adapter capability catalog declaration`);
  }
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const capability = await loadAdapterCapability();
  process.stdout.write(`${JSON.stringify(capability, null, 2)}\n`);
}
