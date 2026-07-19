import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateUiSurfaceCatalog } from "../scripts/ui-surface-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "compatibility", "claude-macos", "1.22209.3", "ui-surface-catalog.json");
const catalog = JSON.parse(await fs.readFile(file, "utf8"));
assert.deepEqual(validateUiSurfaceCatalog(catalog), []);
assert.equal(catalog.target.bundleId, "com.anthropic.claudefordesktop");
assert.equal(catalog.adapterVersion, "1.22209.3");
assert.equal(catalog.adapterReleaseRevision, 1);
assert.equal(catalog.target.signingTeamId, "Q6L2SF6YDW");
assert.equal(catalog.target.electronVersion, "42.5.1");
assert.equal(catalog.target.chromiumVersion, "148.0.7778.271");
assert.equal(catalog.diagnosticEvidence.compatibilityClaim, "exact-host-binary-evidence-surfaces-pending-live-revalidation-runtime-seam-blocked");
assert.equal(catalog.diagnosticEvidence.surfaceAdmission, "fail-closed-pending-live-landmarks");
assert.equal(catalog.diagnosticEvidence.manualDiagnosticPreview.appliesToCurrentTarget, false);
assert.equal(catalog.diagnosticEvidence.manualDiagnosticPreview.status, "historical-reference-only");
assert.equal(catalog.diagnosticEvidence.manualDiagnosticPreview.visualPaintResult, "passed");
assert.equal(catalog.diagnosticEvidence.manualDiagnosticPreview.themeId, "external-diagnostic-sample");
assert.equal(catalog.diagnosticEvidence.manualDiagnosticPreview.persistence, "current-renderer-session-only");
assert.equal(catalog.diagnosticEvidence.manualDiagnosticPreview.capabilityUpgrade, false);
assert.equal(catalog.diagnosticEvidence.manualDiagnosticPreview.rawScreenshotCommitted, false);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.placement, "desktop-app-after-general");
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.navigationItemMounted, true);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.icon, "single-letter-c-in-cloned-native-icon-container");
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.independentPageMounted, true);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.embeddedInGeneral, false);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.fullEditorMounted, true);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.editableControlGroupsObserved, 8);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.saveButtonPresent, false);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.strictSingleSelectionVerified, true);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.nativeSelectionRoundTripTarget, "developer");
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.nativeTabReturnVerified, true);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.settingsCloseReopenVerified, true);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.keyboardFocusVisibleVerified, true);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.rawScreenshotCommitted, false);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.readsUserContent, false);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.persistence, "current-renderer-session-only");
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.diagnosticPersistenceBackend, "session-memory-only");
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.repeatableAutomation, false);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.capabilityUpgrade, false);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.appliesToCurrentTarget, false);
assert.equal(catalog.diagnosticEvidence.manualSettingsPreview.status, "historical-reference-only");
assert.equal(catalog.capture.sensitiveFieldCount, 0);
assert.equal(catalog.settingsEntryNativeContract.source, "clone-adjacent-general-list-item");
assert.equal(catalog.runtimeInterpreter.settingsMount.insertionMode, "after-general");
assert.equal(catalog.runtimeInterpreter.settingsMount.pageMode, "dialog-direct-child");
assert.equal(catalog.settingsEntryNativeContract.icon, "single-letter-c-in-native-icon-container");
assert.equal(catalog.settingsEntryNativeContract.verificationState, "historical-1.22209.0-plus-offline-owned-contract-pending-1.22209.3-live-revalidation");
assert(catalog.pageFamilies.every((page) => !page.state.startsWith("verified")), "current host pages must remain unverified until live landmarks pass");
assert.deepEqual(catalog.lifecycleAcceptance.phases, ["detect", "preflight", "apply", "verify", "pause", "restore"]);

for (const [field, invalidValue] of [
  ["icon", "custom-brand-icon"],
  ["keyboardFocusVisibleVerified", false],
  ["rawScreenshotCommitted", true],
  ["readsUserContent", true],
  ["persistence", "restart-persistent"],
  ["diagnosticPersistenceBackend", "disk"],
  ["fullEditorMounted", false],
  ["strictSingleSelectionVerified", false],
  ["repeatableAutomation", true],
  ["capabilityUpgrade", true],
]) {
  const mutated = structuredClone(catalog);
  mutated.diagnosticEvidence.manualSettingsPreview[field] = invalidValue;
  assert.notDeepEqual(validateUiSurfaceCatalog(mutated), [], `validator accepted unsafe manual evidence field ${field}`);
}
const serialized = JSON.stringify(catalog);
for (const forbidden of ["mac-codex", "mac-workbuddy", "app-shell-left-panel", "main-surface", "aria-label"]) {
  assert.equal(serialized.includes(forbidden), false, `Claude catalog contains foreign landmark: ${forbidden}`);
}
console.log("ui-surface-catalog.test.mjs: ok");
