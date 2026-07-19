import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const probe = read("../scripts/layer-probe.mjs");
const wrapper = read("../scripts/layer-probe.ps1");

test("layer probe is read-only and excludes content and accessibility fields", () => {
  for (const forbidden of ["textContent", "innerText", "innerHTML", "outerHTML", "aria-label", "accessibleName", "element.value", "getAttribute(\"value\")", "dataset"]) {
    assert.equal(probe.includes(forbidden), false, forbidden);
  }
  for (const allowed of ["tag", "id", "classes", "parentClasses", "bounds", "computedBackground"]) {
    assert.ok(probe.includes(allowed), allowed);
  }
  assert.ok(probe.includes("geometryMatches"));
  assert.ok(probe.includes("elementsFromPoint"));
});

test("layer probe keeps exact process and renderer gates", () => {
  for (const marker of ["127.0.0.1", "::1", "Get-AuthenticodeSignature", "Tencent Technology (Shenzhen) Company Limited", "5.2.6", "OwningProcess"]) {
    assert.ok(wrapper.includes(marker), marker);
  }
  for (const marker of ["resources/app.asar/renderer/index.html", "data-application-name", "data-platform", "data-product-version", "matches.length !== 1"]) {
    assert.ok(probe.includes(marker), marker);
  }
});

test("Settings mode emits structural parity fields without labels or user content", () => {
  for (const marker of [
    "settings-structure-evidence", "grandparentClasses", "tabIndex", "selected", "checked",
    "expanded", "backgroundColor", "fontFamily", "transitionDuration", "animationDuration",
  ]) assert.ok(probe.includes(marker), marker);
  assert.ok(wrapper.includes("'layer', 'settings'"));
  assert.ok(wrapper.includes("--mode $Mode"));
  for (const forbidden of ["aria-label", "aria-labelledby", "placeholder", "textContent", "innerText", "account", "conversation"]) {
    assert.equal(probe.includes(forbidden), false, forbidden);
  }
});
