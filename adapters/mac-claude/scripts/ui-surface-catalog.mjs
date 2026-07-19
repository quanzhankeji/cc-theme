import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VERIFIED_CLAUDE_VERSION = "1.22209.3";
export const DEFAULT_CATALOG_PATH = path.join(
  ROOT,
  "compatibility",
  "claude-macos",
  VERIFIED_CLAUDE_VERSION,
  "ui-surface-catalog.json",
);

export async function loadUiSurfaceCatalog(file = DEFAULT_CATALOG_PATH) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

const duplicateValues = (values) => values.filter((value, index) => values.indexOf(value) !== index);

export function validateUiSurfaceCatalog(catalog) {
  const errors = [];
  const add = (condition, message) => { if (!condition) errors.push(message); };
  add(catalog?.kind === "cc-theme.ui-surface-catalog", "catalog kind is invalid");
  add(catalog?.schemaVersion === 2, "schemaVersion must be 2");
  add(catalog?.adapter === "mac-claude", "adapter must be mac-claude");
  add(catalog?.adapterVersion === VERIFIED_CLAUDE_VERSION, "adapterVersion must equal the supported Claude ShortVersion");
  add(Number.isInteger(catalog?.adapterReleaseRevision) && catalog.adapterReleaseRevision > 0,
    "adapterReleaseRevision must be a positive integer");
  add(catalog?.target?.bundleId === "com.anthropic.claudefordesktop", "Claude bundle id is invalid");
  add(catalog?.target?.version === VERIFIED_CLAUDE_VERSION, "verified Claude version is invalid");
  add(catalog?.target?.signingTeamId === "Q6L2SF6YDW", "Claude signing team is invalid");
  add(catalog?.capture?.kind === "structure-only-v1", "capture privacy policy is invalid");
  add(catalog?.capture?.rawScreenshotsCommitted === false, "raw screenshots must not be committed");
  add(catalog?.capture?.sensitiveFieldCount === 0, "sensitive field count must be zero");
  add(catalog?.target?.remoteUiEvidenceStatus === "not-reverified-for-1.22209.3",
    "current remote UI evidence must remain explicitly unverified");
  add(catalog?.target?.remoteUiBuildId === null && catalog?.target?.remoteUiGitHash === null &&
      catalog?.target?.remoteUiBuildTimestamp === null,
    "unverified remote UI identity must not inherit prior values");
  add(catalog?.diagnosticEvidence?.surfaceAdmission === "fail-closed-pending-live-landmarks",
    "current Surface admission must fail closed");

  const manualSettings = catalog?.diagnosticEvidence?.manualSettingsPreview;
  const manualPaint = catalog?.diagnosticEvidence?.manualDiagnosticPreview;
  add(manualPaint?.sourceTargetVersion === "1.22209.0" && manualPaint?.appliesToCurrentTarget === false &&
      manualPaint?.status === "historical-reference-only",
    "manual paint proof must remain historical for the current host");
  add(manualSettings?.sourceTargetVersion === "1.22209.0" && manualSettings?.appliesToCurrentTarget === false &&
      manualSettings?.status === "historical-reference-only",
    "manual settings proof must remain historical for the current host");
  add(manualSettings?.placement === "desktop-app-after-general",
    "manual settings evidence must target Desktop app after General");
  add(manualSettings?.navigationItemMounted === true,
    "manual settings evidence must confirm the owned navigation item");
  add(manualSettings?.icon === "single-letter-c-in-cloned-native-icon-container",
    "manual settings evidence must retain the C icon in the cloned native container");
  add(manualSettings?.independentPageMounted === true && manualSettings?.embeddedInGeneral === false,
    "manual settings evidence must confirm an independent page");
  add(manualSettings?.fullEditorMounted === true && manualSettings?.editableControlGroupsObserved === 8,
    "manual settings evidence must confirm the complete eight-group editor");
  add(manualSettings?.saveButtonPresent === false,
    "manual settings evidence must confirm that no Save button exists");
  add(manualSettings?.strictSingleSelectionVerified === true &&
      manualSettings?.nativeSelectionRoundTripTarget === "developer",
    "manual settings evidence must confirm strict single selection against Developer");
  add(manualSettings?.nativeTabReturnVerified === true && manualSettings?.settingsCloseReopenVerified === true,
    "manual settings evidence must confirm native return and Settings reopen");
  add(manualSettings?.keyboardFocusVisibleVerified === true,
    "manual settings evidence must confirm keyboard focus visibility");
  add(manualSettings?.rawScreenshotCommitted === false && manualSettings?.readsUserContent === false,
    "manual settings evidence must remain privacy-safe");
  add(manualSettings?.persistence === "current-renderer-session-only",
    "manual settings evidence must remain session-only");
  add(manualSettings?.diagnosticPersistenceBackend === "session-memory-only",
    "manual settings evidence must not imply production persistence");
  add(manualSettings?.repeatableAutomation === false && manualSettings?.capabilityUpgrade === false,
    "manual settings evidence must not imply automation or a capability upgrade");

  const hierarchyIds = (catalog?.domHierarchy ?? []).map((node) => node.id);
  const runtimeRoleIds = (catalog?.runtimeRoles ?? []).map((rule) => rule.role);
  add(duplicateValues(hierarchyIds).length === 0, "DOM hierarchy ids must be unique");
  add(duplicateValues(runtimeRoleIds).length === 0, "runtime roles must be unique");
  const hierarchySet = new Set(hierarchyIds);
  for (const node of catalog?.domHierarchy ?? []) {
    add(node.parent === null || hierarchySet.has(node.parent), `${node.id} has an unknown parent`);
    add(["one", "zero-or-one", "many"].includes(node.cardinality), `${node.id} has invalid cardinality`);
    add(["host", "skin-owned"].includes(node.ownership), `${node.id} has invalid ownership`);
  }
  for (const rule of catalog?.runtimeRoles ?? []) {
    add(Array.isArray(rule.selectors) && rule.selectors.length > 0, `${rule.role} needs selectors`);
  }

  const interpreter = catalog?.runtimeInterpreter;
  add(interpreter?.kind === "cc-theme.ui-interpreter-config", "interpreter kind is invalid");
  add(interpreter?.version === 1, "interpreter version must be 1");
  add(interpreter?.roleAttribute === "data-skin-role", "interpreter role attribute is invalid");
  add(interpreter?.settingsMount?.insertionMode === "after-general", "CC Theme must follow General");
  add(interpreter?.settingsMount?.pageMode === "dialog-direct-child", "CC Theme page must be independent");
  add(catalog?.settingsEntryNativeContract?.icon === "single-letter-c-in-native-icon-container",
    "CC Theme icon contract is invalid");
  for (const page of catalog?.pageFamilies ?? []) {
    add(typeof page?.state === "string" && !page.state.startsWith("verified"),
      `${page?.id || "page"} must not claim current live verification`);
  }

  const selectors = [
    ...(catalog?.identitySelectors ?? []),
    ...(catalog?.domHierarchy ?? []).map((node) => node.selector),
    ...(catalog?.runtimeRoles ?? []).flatMap((rule) => rule.selectors ?? []),
    ...(interpreter?.identity?.alternatives ?? []).flat(),
    ...Object.values(interpreter?.targets ?? {}).flatMap((target) => target.selectors ?? []),
    ...(interpreter?.roles ?? []).flatMap((rule) => rule.selectors ?? []),
    ...(catalog?.pageFamilies ?? []).flatMap((page) => page.rootSelectors ?? []),
  ];
  for (const selector of selectors) {
    add(typeof selector === "string" && selector.length > 0, "selector must be non-empty");
    add(!selector.includes("aria-label"), `accessible label selector is forbidden: ${selector}`);
    add(!/(?:mac-codex|mac-workbuddy|main-surface|app-shell-left-panel|composer-surface-chrome)/.test(selector),
      `sibling-client selector is forbidden: ${selector}`);
    add(!/(?:^|[.\s])_[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9]+_[0-9]+/.test(selector),
      `generated class is forbidden: ${selector}`);
  }
  return errors;
}

async function main(argv) {
  const [command, file] = argv;
  if (command !== "validate") throw new Error("Usage: ui-surface-catalog.mjs validate [catalog.json]");
  const catalog = await loadUiSurfaceCatalog(file || DEFAULT_CATALOG_PATH);
  const errors = validateUiSurfaceCatalog(catalog);
  if (errors.length) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify({ pass: true, adapter: catalog.adapter, target: catalog.target.version })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
