import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectUnifiedTheme } from "../src/projector.mjs";
import { compileProofRuntimeStyle, proofSelectorAllowlist } from "../src/runtime-style-compiler.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const readJson = (path) => JSON.parse(read(path));
const unified = readJson("../presets/xtxg/unified-theme.json");
const surfaceCatalog = readJson("../compatibility/workbuddy-windows/5.2.6/ui-surface-catalog.v1.json");
const styleCatalog = readJson("../contracts/theme-style-catalog.v2.json");
const wrapper = read("../scripts/theme-seam.ps1");
const runtime = read("../scripts/theme-cdp.mjs");

test("xtxg projects to a custom Windows theme and compiles only the fixed selector allowlist", () => {
  const { artifact, runtimeApplyAvailable } = projectUnifiedTheme(unified);
  assert.equal(runtimeApplyAvailable, false);
  assert.equal(artifact.id, "xtxg");
  assert.equal(artifact.appearance.paletteStrategy, "custom");
  const compiled = compileProofRuntimeStyle(artifact, surfaceCatalog, styleCatalog, "cc-theme-win-runtime-marker");
  assert.match(compiled.css, /#10151F/);
  assert.match(compiled.css, /#E9EEF7/);
  assert.match(compiled.css, /\.teams-container,[\s\S]*?background: transparent !important;/);
  assert.ok(compiled.css.includes("._gridView_48kdk_9 > ._gridViewItem_48kdk_14:has(> .teams-content-wrapper)"));
  assert.equal(compiled.css.includes("._gridViewItem_48kdk_14 {"), false);
  const transparentRule = compiled.css.match(/\.teams-container,[\s\S]*?\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.equal(transparentRule.includes("color:"), false);
  assert.ok(compiled.warnings.includes("background-video-runtime-unsupported"));
  for (const selectors of Object.values(proofSelectorAllowlist())) {
    for (const selector of selectors) assert.ok(compiled.css.includes(selector), selector);
  }
});

test("theme seam keeps exact listener identity gates and has no arbitrary style or selector argument", () => {
  for (const marker of ["127.0.0.1", "::1", "Get-AuthenticodeSignature", "Tencent Technology (Shenzhen) Company Limited", "5.2.6", "OwningProcess"]) {
    assert.ok(wrapper.includes(marker), marker);
  }
  for (const forbidden of ["--css", "--selector", "--javascript", "--html", "--url"]) {
    assert.equal(runtime.includes(forbidden), false, forbidden);
    assert.equal(wrapper.includes(forbidden), false, forbidden);
  }
  assert.ok(runtime.includes("matches.length !== 1"));
  assert.ok(runtime.includes("theme-snapshot-missing"));
  assert.ok(runtime.includes("theme-snapshot-invalid"));
  assert.ok(runtime.includes("Object.prototype.hasOwnProperty.call(window, config.snapshotKey)"));
  assert.ok(runtime.includes("minimalOnly ? null : prepareTheme"));
  assert.ok(runtime.includes("minimalOnly ? minimalRendererConfig()"));
  assert.ok(runtime.includes("theme-apply-rolled-back"));
  assert.ok(runtime.includes("stale-generation"));
  assert.ok(runtime.includes("generation-conflict"));
  assert.equal(runtime.includes("--revision"), false);
});

test("proof catalogs stay explicitly below production capability", () => {
  assert.equal(surfaceCatalog.verificationStatus, "partial-live-verified");
  assert.equal(surfaceCatalog.transport.listenerCleanupVerified, false);
  assert.equal(styleCatalog.verificationStatus, "partial-live-verified");
  const capability = readJson("../contracts/adapter-capability.json");
  assert.equal(capability.runtimeApplyAvailable, false);
  assert.deepEqual(capability.compatibility.verifiedClientVersions, []);
});

test("style catalog bindings are required and cannot be emptied or remapped", () => {
  const { artifact } = projectUnifiedTheme(unified);
  const empty = structuredClone(styleCatalog);
  empty.bindings = [];
  assert.throws(
    () => compileProofRuntimeStyle(artifact, surfaceCatalog, empty, "cc-theme-win-runtime-marker"),
    /style-catalog-binding-set-invalid/,
  );
  const remapped = structuredClone(styleCatalog);
  remapped.bindings[0].source = "colors.action";
  assert.throws(
    () => compileProofRuntimeStyle(artifact, surfaceCatalog, remapped, "cc-theme-win-runtime-marker"),
    /style-catalog-binding-mismatch/,
  );
});
