import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capabilityPath = path.join(root, "contracts", "adapter-capability.json");
const styleCatalogPath = path.join(root, "contracts", "theme-style-catalog.json");
const targetProfilePath = path.join(root, "contracts", "claude-target-profile.schema.json");

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate ids`);
  return values;
}

function resolveLocalReference(schema, rootSchema) {
  if (typeof schema?.$ref !== "string" || !schema.$ref.startsWith("#/$defs/")) return schema;
  return rootSchema.$defs?.[schema.$ref.slice("#/$defs/".length)] ?? schema;
}

function schemaLeafPaths(schema, rootSchema, prefix = "") {
  const resolved = resolveLocalReference(schema, rootSchema);
  if (!resolved?.properties) return prefix ? [prefix] : [];
  return Object.entries(resolved.properties).flatMap(([key, child]) =>
    schemaLeafPaths(child, rootSchema, prefix ? `${prefix}.${key}` : key));
}

export function validateAdapterCapability(capability, styleCatalog, targetProfileSchema) {
  if (capability?.kind !== "cc-theme.adapter-capability" || capability.schemaVersion !== 1 ||
      capability.adapterId !== "mac-claude" || capability.adapterVersion !== "1.22209.3" ||
      capability.adapterReleaseRevision !== 1 || capability.releaseStatus !== "development-unpublished" ||
      capability.projectStatus !== "preserved-source") {
    throw new Error("Adapter capability identity is invalid");
  }
  if (!capability.availability || typeof capability.availability.runtimeApplyAvailable !== "boolean" ||
      typeof capability.availability.managerApplyAllowed !== "boolean" ||
      typeof capability.availability.deepSettingsAvailable !== "boolean") {
    throw new Error("Adapter capability availability is incomplete");
  }
  if (capability.availability.managerApplyAllowed !== capability.availability.runtimeApplyAvailable) {
    throw new Error("Manager apply permission must exactly match Claude runtime apply availability");
  }
  if (capability.availability.managerSelectionScope !== "adapter-local") {
    throw new Error("Manager availability must remain local to the Mac-Claude target");
  }
  if (capability.availability.managerRegistrationStatus !== "paused" ||
      capability.availability.managerEngineDeliveryAllowed !== false ||
      capability.availability.managerPrepareReadyAllowed !== false) {
    throw new Error("Paused Mac-Claude registration must not deliver an Engine or prepare-ready state");
  }
  if (capability.compatibility?.verifiedVersion !== capability.adapterVersion ||
      capability.compatibility?.verifiedBuild !== "1.22209.3" ||
      capability.compatibility?.surfaceAdmission !== "fail-closed-pending-live-landmarks") {
    throw new Error("Adapter capability compatibility evidence is stale or not fail-closed");
  }
  if (capability.availability.status === "projection-only" &&
      (capability.availability.runtimeApplyAvailable || capability.availability.managerApplyAllowed ||
       capability.availability.deepSettingsAvailable)) {
    throw new Error("Projection-only capability must not advertise runtime apply or deep settings");
  }
  if (capability.availability.diagnosticPreviewAvailable !== true ||
      capability.availability.diagnosticPreviewMode !== "user-confirmed-devtools" ||
      capability.availability.diagnosticPreviewPersistence !== "renderer-session" ||
      capability.availability.diagnosticPreviewRequiresUserAction !== true) {
    throw new Error("Mac-Claude must publish the bounded user-confirmed diagnostic preview separately from runtime apply");
  }
  if (!capability.availability.runtimeApplyAvailable &&
      (!Array.isArray(capability.availability.runtimeApplyUpgradeEvidenceRequired) ||
       capability.availability.runtimeApplyUpgradeEvidenceRequired.length < 5 ||
       capability.availability.runtimeApplyUpgradeEvidenceRequired.some((item) => typeof item !== "string" || !item))) {
    throw new Error("Unavailable runtime apply must publish its machine-readable upgrade evidence");
  }
  const validSharedDecisions = new Set(["exact", "approximated", "unsupported"]);
  const validTargetDecisions = new Set(["supported", "approximated", "unsupported"]);
  if (!Array.isArray(capability.sharedCoreDecisions) || capability.sharedCoreDecisions.some((item) =>
    !item || typeof item.path !== "string" || item.path.includes("*") || !validSharedDecisions.has(item.decision))) {
    throw new Error("Adapter capability Shared Core decisions are invalid");
  }
  if (!Array.isArray(capability.targetProfile?.decisions) || capability.targetProfile.decisions.some((item) =>
    !item || typeof item.path !== "string" || !validTargetDecisions.has(item.decision))) {
    throw new Error("Adapter capability Target Profile decisions are invalid");
  }
  const sharedPaths = unique(capability.sharedCoreDecisions.map((item) => item.path), "Shared Core decisions");
  if (sharedPaths.length === 0 || capability.sharedCoreDecisions.some((item) =>
    item.requirement === "required" && item.decision !== "exact")) {
    throw new Error("Required Shared Core fields must be exact");
  }
  for (const item of [...capability.sharedCoreDecisions, ...capability.targetProfile.decisions]) {
    if (["approximated", "unsupported"].includes(item.decision) && typeof item.diagnosticCode !== "string") {
      throw new Error(`Capability decision ${item.path} requires a diagnosticCode`);
    }
  }
  const advertisedFields = unique([...(capability.targetProfile.fields ?? [])], "Target Profile fields").sort();
  const decidedFields = unique(capability.targetProfile.decisions.map((item) => item.path), "Target Profile decisions").sort();
  if (advertisedFields.length !== decidedFields.length || advertisedFields.some((id, index) => id !== decidedFields[index])) {
    throw new Error("Every Target Profile field must have exactly one mapping decision");
  }
  const schemaFields = schemaLeafPaths(targetProfileSchema, targetProfileSchema).sort();
  if (schemaFields.length !== advertisedFields.length || schemaFields.some((id, index) => id !== advertisedFields[index])) {
    throw new Error("Adapter capability Target Profile fields do not match its closed schema");
  }
  const actualTokens = (styleCatalog?.tokens ?? []).map((token) => token.id).sort();
  const advertisedTokens = [...(capability.localRuntimeOverrides?.editableTokenIds ?? [])].sort();
  if (actualTokens.length !== advertisedTokens.length || actualTokens.some((id, index) => id !== advertisedTokens[index])) {
    throw new Error("Adapter capability editable tokens do not match the Theme Style Catalog");
  }
  if (styleCatalog?.kind !== "theme.style-catalog" || styleCatalog.schemaVersion !== 1 ||
      styleCatalog.catalogVersion !== capability.themeStyleCatalogVersion ||
      styleCatalog.catalogId !== capability.themeStyleCatalogId) {
    throw new Error("Adapter capability Theme Style Catalog identity or version is inconsistent");
  }
  if (capability.compatibility?.themeCarriesVersionFacts !== false) {
    throw new Error("Theme data must not carry Claude version facts");
  }
  if (capability.compatibility?.versionFactsOwner !== "adapter-compile-context") {
    throw new Error("Claude version facts must remain Adapter compile context");
  }
  return capability;
}

const [capability, styleCatalog, targetProfileSchema] = await Promise.all([
  fs.readFile(capabilityPath, "utf8").then(JSON.parse),
  fs.readFile(styleCatalogPath, "utf8").then(JSON.parse),
  fs.readFile(targetProfilePath, "utf8").then(JSON.parse),
]);
validateAdapterCapability(capability, styleCatalog, targetProfileSchema);
if (process.argv[2] === "--validate") {
  process.stdout.write(`${JSON.stringify({ kind: "cc-theme.adapter-capability-validation", pass: true, adapterId: capability.adapterId, capabilityVersion: capability.capabilityVersion })}\n`);
} else {
  process.stdout.write(`${JSON.stringify(capability, null, 2)}\n`);
}
