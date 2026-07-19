import test from "node:test";
import assert from "node:assert/strict";
import {
  computeRuntimeManifestDigest, minimalRendererConfig, preflightExpression,
  restoreExpression, verifyExpression,
} from "../scripts/theme-cdp.mjs";

function bodyWith(entries = {}) {
  const attributes = new Map(Object.entries(entries));
  return {
    attributes,
    getAttribute: (name) => attributes.has(name) ? attributes.get(name) : null,
    hasAttribute: (name) => attributes.has(name),
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    append: () => {},
  };
}

function documentWith(body, elements = new Map()) {
  const createElement = () => {
    let styleText = "";
    return {
      style: {
        get cssText() { return styleText; },
        set cssText(value) { styleText = String(value); },
      },
      getAttribute: (name) => name === "style" ? styleText : null,
    };
  };
  return {
    body,
    head: { append: () => {} },
    getElementById: (id) => elements.get(id) ?? null,
    querySelectorAll: () => [],
    createElement,
  };
}

function run(expression, window, document) {
  return Function("window", "document", `return ${expression}`)(window, document);
}

test("every deterministic manifest member changes the artifact digest", () => {
  const members = {
    unifiedThemeFileSha256: "1".repeat(64),
    normalizedTargetSha256: "2".repeat(64),
    backgroundImageFileSha256: "3".repeat(64),
    uiSurfaceCatalogFileSha256: "4".repeat(64),
    themeStyleCatalogFileSha256: "5".repeat(64),
    compiledStyleSha256: "6".repeat(64),
  };
  const baseline = computeRuntimeManifestDigest(members);
  for (const key of Object.keys(members)) {
    const changed = { ...members, [key]: "a".repeat(64) };
    assert.notEqual(computeRuntimeManifestDigest(changed), baseline, key);
  }
});

test("foreign snapshot namespace fails preflight before any DOM mutation", () => {
  const config = { ...minimalRendererConfig(), requiredSelectors: [] };
  const body = bodyWith();
  const window = { [config.snapshotKey]: { owner: "foreign" } };
  const before = [...body.attributes];
  const result = run(preflightExpression(config), window, documentWith(body));
  assert.deepEqual(result, { ok: false, code: "theme-runtime-collision" });
  assert.deepEqual([...body.attributes], before);
  assert.equal(window[config.snapshotKey].owner, "foreign");
});

test("restore rejects malformed owned snapshot without deleting state", () => {
  const config = minimalRendererConfig();
  const body = bodyWith({ "data-cc-theme-runtime": config.runtimeMarker });
  const window = { [config.snapshotKey]: { owner: config.runtimeMarker, attributes: {} } };
  const result = run(restoreExpression(config), window, documentWith(body));
  assert.deepEqual(result, { ok: false, code: "theme-snapshot-invalid" });
  assert.equal(body.getAttribute("data-cc-theme-runtime"), config.runtimeMarker);
  assert.ok(Object.hasOwn(window, config.snapshotKey));
});

test("restore does not call residual reserved attributes a clean idempotent state", () => {
  const config = minimalRendererConfig();
  const body = bodyWith({ "data-cc-theme-id": "xtxg" });
  const result = run(restoreExpression(config), {}, documentWith(body));
  assert.deepEqual(result, { ok: false, code: "theme-namespace-corrupt" });
  assert.equal(body.getAttribute("data-cc-theme-id"), "xtxg");
});

test("verify exposes missing snapshot as an invalid recovery state", () => {
  const config = minimalRendererConfig();
  const body = bodyWith({
    "data-cc-theme-runtime": config.runtimeMarker,
    "data-cc-theme-id": "xtxg",
    "data-cc-theme-generation": "4",
    "data-cc-theme-state": "applied",
    "data-cc-theme-hash": "a".repeat(64),
  });
  const marker = run(verifyExpression(config), {}, documentWith(body));
  assert.equal(marker.snapshotValid, false);
});

test("restore uses only fixed identity and a valid owned snapshot", () => {
  const config = minimalRendererConfig();
  const names = ["data-cc-theme-runtime", "data-cc-theme-id", "data-cc-theme-generation", "data-cc-theme-state", "data-cc-theme-hash"];
  const body = bodyWith({
    "data-cc-theme-runtime": config.runtimeMarker,
    "data-cc-theme-id": "xtxg",
    "data-cc-theme-generation": "9",
    "data-cc-theme-state": "applied",
    "data-cc-theme-hash": "a".repeat(64),
  });
  const attributes = Object.freeze(Object.fromEntries(names.map((name) => [name, null])));
  const snapshot = Object.freeze({ owner: config.runtimeMarker, schemaVersion: 1, attributes });
  const window = {};
  Object.defineProperty(window, config.snapshotKey, { value: snapshot, configurable: true });
  const result = run(restoreExpression(config), window, documentWith(body));
  assert.deepEqual(result, { ok: true, changed: true });
  for (const name of names) assert.equal(body.getAttribute(name), null);
  assert.equal(Object.hasOwn(window, config.snapshotKey), false);
  const marker = run(verifyExpression(config), window, documentWith(body));
  assert.equal(marker.runtime, null);
  assert.equal(marker.snapshotValid, false);
});
