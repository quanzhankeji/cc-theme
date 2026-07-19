import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveWorkspaceRoot } from "./workspace-root.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CANONICAL_ADAPTER_IDS = Object.freeze(["mac-codex", "mac-workbuddy"]);
const canonicalAdapterIds = new Set(CANONICAL_ADAPTER_IDS);
export const REPOSITORY_ROOT = resolveWorkspaceRoot({ anchor: import.meta.url });
export const ADAPTER_SOURCE_ROOT = path.resolve(
  process.env.CC_THEME_ADAPTER_SOURCE_ROOT ?? path.join(REPOSITORY_ROOT, "adapters"),
);
const selectedAdapterId = process.env.CC_THEME_SELECTED_ADAPTER_ID;
const selectedAdapterRoot = process.env.CC_THEME_SELECTED_ADAPTER_ROOT
  ? path.resolve(process.env.CC_THEME_SELECTED_ADAPTER_ROOT)
  : null;
if ((selectedAdapterId || selectedAdapterRoot) && (!canonicalAdapterIds.has(selectedAdapterId) || !selectedAdapterRoot)) {
  throw new Error("Selected Adapter source override is invalid");
}
function adapterSourcePath(relative) {
  const [adapterId, ...tail] = relative.split("/");
  if (selectedAdapterRoot && adapterId === selectedAdapterId && tail.length) {
    return path.join(selectedAdapterRoot, ...tail);
  }
  return path.join(ADAPTER_SOURCE_ROOT, relative);
}
export const DEFAULT_REGISTRY_FILE = process.env.CC_THEME_CAPABILITY_ROOT
  ? path.resolve(process.env.CC_THEME_CAPABILITY_ROOT, "registry.json")
  : path.join(REPOSITORY_ROOT, "app/registry/adapter-capabilities.json");

const clone = (value) => structuredClone(value);
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const support = (value) => ({ exact: "supported", approximate: "approximated" }[value] ?? value);
const ACCESSIBILITY_TOKENS = [
  "accessibility.reducedMotion",
  "accessibility.minimumTextContrast",
  "accessibility.minimumLargeTextContrast",
  "accessibility.preserveSystemFocusRing",
  "accessibility.transparencyFallback",
];
const TOKEN_ALIASES = new Map([
  ["accessibility.reduceMotion", "accessibility.reducedMotion"],
  ["accessibility.reduce-motion", "accessibility.reducedMotion"],
  ["background.heroImage", "background.homeHeroImage"],
]);

function normalizeDecisions(raw, descriptor) {
  let decisions;
  if (descriptor.projectionFile) {
    decisions = readJson(adapterSourcePath(descriptor.projectionFile)).fields.map((field) => ({
      sourceToken: field.field,
      support: support(field.decision),
      required: ["identity.id", "identity.name", "background.mode", "background.imageAsset"].includes(field.field),
      targetPath: field.target ?? null,
      diagnostic: field.diagnostic ?? `${field.field} maps ${field.fidelity}`,
    }));
  } else if (Array.isArray(raw.sharedCoreDecisions)) {
    decisions = raw.sharedCoreDecisions.map((field) => ({
      sourceToken: field.path,
      support: support(field.decision),
      required: field.requirement === "required",
      targetPath: field.targetPath ?? null,
      diagnostic: field.diagnosticCode ?? field.mapping,
    }));
  } else {
    const fields = raw.sharedCore?.fields ?? [];
    decisions = fields.map((field) => ({
      sourceToken: field.source ?? field.id,
      support: support(field.decision),
      required: field.required ?? field.requirement === "required",
      targetPath: field.target ?? field.mapping ?? null,
      diagnostic: field.diagnostic ?? `${field.source ?? field.id} is ${field.decision}`,
    }));
  }
  decisions = decisions.map((decision) => ({
    ...decision,
    sourceToken: TOKEN_ALIASES.get(decision.sourceToken) ?? decision.sourceToken,
  }));
  const declared = new Set(decisions.map(({ sourceToken }) => sourceToken));
  for (const token of ACCESSIBILITY_TOKENS) {
    if (!declared.has(token)) decisions.push({
      sourceToken: token,
      support: "unsupported",
      required: false,
      targetPath: null,
      diagnostic: "capability-missing-explicit-decision",
    });
  }
  return decisions;
}

function stableTokenIds(raw, descriptor) {
  const declared = raw.localRuntimeOverrides?.editableTokens ?? raw.localRuntimeOverrides?.editableTokenIds ?? raw.localRuntimeOverrides?.stableTokenIds;
  if (Array.isArray(declared)) return clone(declared);
  if (!descriptor.styleCatalogFile || (!declared && declared !== true)) return [];
  const catalog = readJson(adapterSourcePath(descriptor.styleCatalogFile));
  const controls = catalog.tokens ?? catalog.settingsControls ?? [];
  return controls.map(({ id }) => id).filter((id) => typeof id === "string");
}

function normalizeCapability(raw, descriptor) {
  const declaredAvailability = raw.availability && typeof raw.availability === "object" ? raw.availability : null;
  const availability = raw.status === "contract-only"
    ? "contract-only"
    : declaredAvailability?.status ?? (raw.available === false || raw.availability === "unavailable" ? "unavailable" : raw.availability ?? "available");
  const runtimeApplyAvailable = declaredAvailability?.runtimeApplyAvailable ?? raw.runtimeApplyAvailable ?? false;
  const local = raw.localRuntimeOverrides ?? {};
  const transaction = raw.transactionSeam ?? {};
  const serialTransactionSeamAvailable = transaction.available ?? Boolean(
    transaction.serialization || local.transactionPolicy || local.concurrency,
  );
  const stable = stableTokenIds(raw, descriptor);
  return Object.freeze({
    kind: "cc-theme.normalized-adapter-capability",
    schemaVersion: 1,
    adapterId: raw.adapterId,
    displayName: raw.displayName ?? raw.adapterId,
    availability,
    capabilityVersion: String(raw.capabilityVersion),
    compileAvailable: Boolean(descriptor.projectorModule) && availability !== "contract-only" && availability !== "unavailable",
    runtimeApplyAvailable: Boolean(runtimeApplyAvailable),
    sharedCore: normalizeDecisions(raw, descriptor),
    targetProfile: clone(raw.targetProfile ?? {}),
    localRuntimeOverrides: {
      stableTokenIds: stable,
      baseHashAvailable: Boolean(local.baseHash || local.baseBinding || local.binding || local.rebase),
      serialTransactionSeamAvailable,
      incompatiblePolicy: local.incompatibleValuePolicy ?? local.incompatiblePolicy ?? local.incompatible ?? "quarantine-and-notify",
    },
    compatibility: clone(raw.compatibility ?? {}),
    projection: {
      module: descriptor.projectorModule,
      export: descriptor.projectorExport,
      requestContract: descriptor.requestContract,
      outputDirectory: descriptor.outputDirectory,
    },
    sourceCapabilityFile: descriptor.capabilityFile,
    raw: clone(raw),
  });
}

export function loadAdapterRegistry(file = DEFAULT_REGISTRY_FILE) {
  const source = readJson(file);
  if (source.kind !== "cc-theme.adapter-capability-registry" || source.schemaVersion !== 1 || !Array.isArray(source.adapters)) {
    throw new Error("Adapter capability registry has an invalid identity");
  }
  const capabilities = source.adapters.map((descriptor) => {
    const requested = adapterSourcePath(descriptor.capabilityFile);
    let capabilityPath = requested;
    try {
      readFileSync(requested, "utf8");
    } catch (error) {
      if (!descriptor.fallbackCapabilityFile || error.code !== "ENOENT") throw error;
      capabilityPath = adapterSourcePath(descriptor.fallbackCapabilityFile);
    }
    return normalizeCapability(readJson(capabilityPath), descriptor);
  });
  const ids = capabilities.map(({ adapterId }) => adapterId);
  if (new Set(ids).size !== ids.length) throw new Error("Adapter capability registry contains duplicate adapter ids");
  if (ids.some((adapterId) => !canonicalAdapterIds.has(adapterId))) {
    throw new Error("Adapter capability registry contains a non-canonical adapter id");
  }
  return Object.freeze({ kind: source.kind, schemaVersion: 1, capabilities: Object.freeze(capabilities) });
}

export const DEFAULT_ADAPTER_REGISTRY = loadAdapterRegistry();

export function discoverAdapterCapabilities(registry = DEFAULT_ADAPTER_REGISTRY) {
  return registry.capabilities.map((capability) => clone(capability));
}

export function capabilityFor(adapterId, registry = DEFAULT_ADAPTER_REGISTRY) {
  const capability = registry.capabilities.find((item) => item.adapterId === adapterId);
  if (!capability) throw new Error(`Unknown adapter capability: ${String(adapterId)}`);
  return capability;
}

export async function loadAdapterProjector(capability) {
  if (!capability.compileAvailable || !capability.projection.module || !capability.projection.export) {
    throw new Error(`${capability.adapterId} compilation is unavailable`);
  }
  const modulePath = adapterSourcePath(capability.projection.module);
  const imported = await import(pathToFileURL(modulePath).href);
  const projector = imported[capability.projection.export];
  if (typeof projector !== "function") throw new Error(`${capability.adapterId} projector export is unavailable`);
  return projector;
}
