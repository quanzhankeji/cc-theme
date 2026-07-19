import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const capability = read("../contracts/adapter-capability.json");
const style = read("../contracts/theme-style-catalog.json");
const parity = read("../contracts/settings-native-parity.json");
const surface = read("../compatibility/workbuddy-windows/5.2.6/ui-surface-catalog.json");
const identity = read("../contracts/transaction-identity.json");

const EXPECTED_FIELDS = [
  "id", "name", "version",
  ...["surfaceBase", "surfaceRaised", "surfaceElevated", "surfaceCode", "text", "textStrong", "textMuted", "placeholder", "borderSubtle", "borderDefault", "borderStrong", "action", "actionHover", "actionPressed", "actionForeground", "hoverSurface", "pressedSurface", "selectedSurface", "selectedHoverSurface", "focusRing", "link", "danger", "success", "warning", "sidebarSurface", "headerSurface", "mainScrimStart", "mainScrimMid", "mainScrimEnd", "composerSurface"].map((key) => `tokens.colors.${key}`),
  ...["ui", "display", "code"].map((key) => `tokens.fonts.${key}`),
  ...["shellMode", "backdropBlurPx", "backdropSaturation", "radiusScale", "backgroundPosition", "homeHeroPosition"].map((key) => `tokens.appearance.${key}`),
  "background.mode.media", "background.mode.ripple", "background.mode.directional",
  "background.image", "background.homeHeroImage", "background.video", "background.posterMode",
  "background.scrimOpacity", "background.position", "background.ripple.intensity",
  "background.ripple.radiusPx", "background.ripple.quality", "background.directional.atlas",
  "background.directional.directions", "background.directional.columns", "background.directional.rows",
  "background.directional.firstDirectionDegrees", "background.directional.idleFrame", "background.directional.origin",
  "accessibility.reducedMotion", "accessibility.minimumTextContrast",
  "accessibility.minimumLargeTextContrast", "accessibility.preserveSystemFocusRing",
  "accessibility.transparencyFallback",
];

test("capability is proposed Windows adapter and live apply is closed", () => {
  assert.equal(capability.adapterId, "win-workbuddy-skin");
  assert.equal(capability.runtimeApplyAvailable, false);
  assert.deepEqual(capability.compatibility.verifiedClientVersions, []);
  assert.equal(capability.compatibility.applyDeniedCode, "runtime-seam-unverified");
});

test("every Shared Core leaf has one explicit decision", () => {
  const actual = capability.sharedCore.fields.map((field) => field.source);
  assert.equal(new Set(actual).size, actual.length);
  assert.deepEqual(new Set(actual), new Set(EXPECTED_FIELDS));
  for (const field of capability.sharedCore.fields) {
    assert.ok(["exact", "approximate", "unsupported"].includes(field.decision));
    assert.equal(typeof field.diagnostic, "string");
    if (field.decision === "unsupported") assert.equal(field.target, null);
  }
});

test("Settings contract is WYSIWYG, auto-save, and has no save button", () => {
  assert.equal(style.settingsContract.immediatePreview, true);
  assert.equal(style.settingsContract.autoSave, true);
  assert.equal(style.settingsContract.saveButton, false);
  assert.equal(style.settingsContract.debounceMs, 180);
  assert.equal(parity.panel.saveButton, false);
  assert.equal(parity.panel.revision, "strictly-monotonic");
  assert.ok(parity.navigationItem.keyboard.includes("Tab"));
  assert.ok(parity.navigationItem.keyboard.includes("Enter"));
});

test("identity-only Catalog contains no copied or guessed locators", () => {
  assert.equal(surface.verificationStatus, "identity-only");
  assert.equal(surface.transport.verificationStatus, "unverified");
  assert.deepEqual(surface.roles, []);
  assert.deepEqual(surface.pageFamilies, []);
  assert.equal(surface.settingsNavigation.mount, null);
});

test("renderer ordering and deterministic artifact identity use distinct fields and scopes", () => {
  assert.equal(identity.runtimeOrdering.field, "rendererGeneration");
  assert.equal(identity.runtimeOrdering.scope, "renderer-session");
  assert.equal(identity.artifactIdentity.field, "artifactManifestSha256");
  assert.equal(identity.artifactIdentity.algorithm, "sha256");
  assert.notEqual(identity.runtimeOrdering.field, identity.artifactIdentity.field);
  assert.equal(capability.transactionSeam.orderingAndArtifactIdentityAreDistinct, true);
});
