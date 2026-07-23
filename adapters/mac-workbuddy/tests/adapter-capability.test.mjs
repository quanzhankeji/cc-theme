import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAdapterCapability,
  validateAdapterCapability,
  validateCapabilityCatalogConsistency,
  validateTargetProfile,
} from "../scripts/adapter-capability.mjs";
import { loadThemeStyleCatalog } from "../scripts/theme-style-catalog.mjs";
import {
  UI_SURFACE_CATALOG_VERSION,
  UI_SURFACE_SCHEMA_VERSION,
  loadUiSurfaceCatalog,
} from "../scripts/ui-surface-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capability = await loadAdapterCapability();
const uiCatalog = await loadUiSurfaceCatalog();
const styleCatalog = await loadThemeStyleCatalog(uiCatalog.runtimeRoles);
assert.equal(capability.adapterVersion, "5.2.6");
assert.equal(capability.adapterVersion, uiCatalog.target.version);
assert.equal(capability.adapterVersion, uiCatalog.adapterVersion);
assert.equal(capability.adapterReleaseRevision, 4);
assert.equal(capability.adapterReleaseRevision, uiCatalog.adapterReleaseRevision);
assert.equal(capability.platform, "macos");
assert.equal(capability.architecture, "arm64");
assert.equal(capability.catalogs.uiSurfaceCatalogVersion, uiCatalog.catalogVersion);
assert.equal(capability.catalogs.uiSurfaceCatalogSchemaVersion, uiCatalog.schemaVersion);
assert.equal(uiCatalog.catalogVersion, UI_SURFACE_CATALOG_VERSION);
assert.equal(uiCatalog.schemaVersion, UI_SURFACE_SCHEMA_VERSION);
assert.equal(validateCapabilityCatalogConsistency(capability, uiCatalog), true);
for (const [field, value] of [["catalogVersion", 1], ["schemaVersion", 1]]) {
  const mismatchedCatalog = structuredClone(uiCatalog);
  mismatchedCatalog[field] = value;
  assert.throws(() => validateCapabilityCatalogConsistency(capability, mismatchedCatalog),
    /does not match the adapter capability catalog declaration/,
    `capability validation accepted a mismatched UI Surface Catalog ${field}`);
}
assert.equal(capability.catalogs.themeStyleCatalogVersion, styleCatalog.catalogVersion);
assert.deepEqual(new Set(capability.localRuntimeOverrides.editableTokens),
  new Set(styleCatalog.settingsControls.filter((control) => control.type !== "theme").map((control) => control.id)),
  "the machine capability and fixed Settings Catalog must publish one token list");

const decisions = new Map(capability.sharedCore.fields.map((field) => [field.source, field]));
assert.equal(decisions.get("version")?.target, "sourceVersion",
  "capability target path must match the actual projector result");
for (const [source, decision] of Object.entries({
  "tokens.colors.surfaceCode": "approximate",
  "tokens.colors.borderStrong": "approximate",
  "tokens.colors.selectedHoverSurface": "approximate",
  "tokens.colors.success": "unsupported",
  "tokens.colors.warning": "unsupported",
  "tokens.appearance.shellMode": "unsupported",
  "tokens.appearance.backgroundPosition": "approximate",
  "background.homeHeroImage": "unsupported",
  "accessibility.reducedMotion": "exact",
  "accessibility.minimumTextContrast": "unsupported",
  "accessibility.preserveSystemFocusRing": "approximate",
})) assert.equal(decisions.get(source)?.decision, decision, `missing explicit decision for ${source}`);
assert.ok(capability.sharedCore.fields.every((field) => !(field.required && field.decision === "unsupported")));
assert.deepEqual(capability.paletteStrategy.precedence,
  ["shared-core", "target-profile", "local-runtime-override", "runtime-accessibility-and-host-safety"]);
assert.equal(capability.paletteStrategy.adaptiveAuthoringAvailable, false);
assert.equal(capability.paletteStrategy.adaptiveRuntimeAvailable, true);
assert.equal(capability.transactionSeam.serialization, "cross-process-exclusive-lock");
assert.equal(capability.migration.adapterIdPolicy, "canonical-only-no-alias");
assert.equal(capability.migration.localStateMigration, "one-time-pre-canonical-directory-move");

const targetSchema = JSON.parse(await fs.readFile(path.join(root, "contracts", "target-profile.schema.json"), "utf8"));
const targetThemeSchema = JSON.parse(await fs.readFile(path.join(root, "contracts", "skin-theme.schema.json"), "utf8"));
const capabilitySchema = JSON.parse(await fs.readFile(path.join(root, "contracts", "adapter-capability.schema.json"), "utf8"));
const runtimeSchema = JSON.parse(await fs.readFile(path.join(root, capability.localRuntimeOverrides.schema), "utf8"));
assert.equal(capabilitySchema.properties.catalogs.properties.uiSurfaceCatalogSchemaVersion.const,
  uiCatalog.schemaVersion);
assert.equal(capabilitySchema.properties.catalogs.properties.uiSurfaceCatalogVersion.const,
  uiCatalog.catalogVersion);
assert.equal(targetSchema.additionalProperties, false);
assert.equal(targetSchema.properties.values.additionalProperties, false);
assert.equal(targetThemeSchema.properties.appearance.properties.shellMode.const, "auto",
  "target themes must preserve WorkBuddy's effective appearance authority");
assert.equal(runtimeSchema.properties.schemaVersion.const, 2);
assert.equal(runtimeSchema.properties.state.additionalProperties, false);
assert.equal(runtimeSchema.properties.quarantine.items.additionalProperties, false);
assert.equal(runtimeSchema.properties.quarantine.uniqueItems, true);
assert.match(runtimeSchema.properties.updatedAt.pattern, /\\\./);
assert.throws(() => validateTargetProfile({
  kind: "cc-theme.target-profile",
  schemaVersion: 1,
  adapterId: "mac-workbuddy",
  values: { selector: "body" },
}), /unsupported fields: selector/);
assert.throws(() => validateAdapterCapability({ ...capability, runtimeApplyAvailable: false }), /identity or availability/);
for (const mutate of [
  (draft) => { draft.catalogs.uiSurfaceCatalogVersion = 0; },
  (draft) => { draft.catalogs.uiSurfaceCatalogSchemaVersion = 0; },
  (draft) => { draft.catalogs.targetProfileSchemaVersion = 0; },
  (draft) => { draft.compatibility.verifiedClientVersions.push("5.2.6"); },
  (draft) => { draft.adapterVersion = "5.2.6+1"; },
  (draft) => { draft.adapterReleaseRevision = 0; },
  (draft) => { draft.sharedCore.fields.find((field) => field.condition).condition = { selector: "body" }; },
  (draft) => { draft.migration.legacyOverridesWorkbuddy = "x".repeat(161); },
]) {
  const invalid = structuredClone(capability);
  mutate(invalid);
  assert.throws(() => validateAdapterCapability(invalid), /invalid|contract|decision/i,
    "runtime capability validation drifted from its machine schema");
}

console.log("PASS: WorkBuddy publishes a versioned capability, complete field decisions, and one local-token catalog.");
