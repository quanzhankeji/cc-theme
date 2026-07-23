import assert from "node:assert/strict";
import {
  checkCatalogDocument,
  loadUiSurfaceCatalog,
  renderUiSurfaceCatalog,
  validateUiSurfaceCatalog,
} from "../scripts/ui-surface-catalog.mjs";

const catalog = await loadUiSurfaceCatalog();
assert.deepEqual(validateUiSurfaceCatalog(catalog), []);
assert.equal(catalog.adapter, "mac-workbuddy");
assert.equal(catalog.adapterVersion, catalog.target.version);
assert.equal(catalog.adapterReleaseRevision, 4);
assert.equal(catalog.capture.visualStates, 55);
assert.equal(catalog.capture.computedStyleSnapshots, 65);
assert.ok(catalog.domHierarchy.length >= 18);
assert.ok(catalog.runtimeRoles.length >= 72);
assert.equal(catalog.componentStyleEvidence.length, 9);
assert.equal(catalog.systemPalettePolicy.nativeOverlayAppearance, true);
assert.deepEqual(catalog.systemPalettePolicy.themedOverlayStrategies, ["adaptive", "custom"]);
assert.ok(catalog.pageFamilies.length >= 15);
assert.ok(catalog.overlayFamilies.length >= 13);
assert.ok(catalog.unsupported.includes("pet or companion UI"));
assert.match(renderUiSurfaceCatalog(catalog), /项目会话/);
assert.match(renderUiSurfaceCatalog(catalog), /collaborationPopover/);
assert.match(renderUiSurfaceCatalog(catalog), /miniprogram\.popup-typography-switches/);
assert.match(renderUiSurfaceCatalog(catalog), /system\.background-route-shells/);
assert.match(renderUiSurfaceCatalog(catalog), /detail\.artifact-panel-transparency/);
assert.match(renderUiSurfaceCatalog(catalog), /topbar\.video-playback-control/);
assert.match(renderUiSurfaceCatalog(catalog), /topbar\.task-transfer-native-disabled/);
assert.match(renderUiSurfaceCatalog(catalog), /markdown\.table-theme-divergence/);
assert.match(renderUiSurfaceCatalog(catalog), /interaction\.primary-action-pressed/);
assert.match(renderUiSurfaceCatalog(catalog), /System 配色边界/);
assert.match(renderUiSurfaceCatalog(catalog), /UI Interpreter 配置/);
assert.match(renderUiSurfaceCatalog(catalog), /themeSettings/);
await checkCatalogDocument(catalog);

console.log("ui-surface-catalog.test.mjs: ok");
