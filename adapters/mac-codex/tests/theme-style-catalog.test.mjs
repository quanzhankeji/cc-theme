import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadStyleCatalog,
  validateRuntimePreferenceValues,
  validateStyleOverrideValues,
} from "../scripts/theme-style-catalog.mjs";
import { loadStyleOverrides, saveStyleOverrides } from "../scripts/theme-style-overrides.mjs";
import { normalizeSkinTheme } from "../scripts/skin-theme.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const [catalog, renderer, css, schema] = await Promise.all([
  loadStyleCatalog(),
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "assets", "skin.css"), "utf8"),
  fs.readFile(path.join(root, "contracts", "skin-theme.schema.json"), "utf8").then(JSON.parse),
]);

assert.equal(catalog.kind, "theme.style-catalog");
assert.equal(catalog.revision, 1);
assert.equal(catalog.geometryPolicy, "native");
assert.deepEqual(validateRuntimePreferenceValues({ "background.presentation": "paused" }, catalog), {
  "background.presentation": "paused",
});
assert.throws(() => validateRuntimePreferenceValues({ "background.presentation": "unknown" }, catalog), /invalid value/);

const catalogRoles = new Set(catalog.roleFamilies.flatMap((family) => family.roles));
const rendererRoles = new Set();
for (const pattern of [
  /\bmark\([^,]+,\s*"([a-z][a-z0-9-]+)"/g,
  /\bmark(?:Home|Library|BottomPanel|Settings|HistoryPreview)\([^,]+,\s*"([a-z][a-z0-9-]+)"/g,
]) {
  for (const match of renderer.matchAll(pattern)) rendererRoles.add(match[1]);
}
const cssRoles = new Set([...css.matchAll(/data-skin-role="([a-z][a-z0-9-]+)"/g)].map((match) => match[1]));
for (const role of [...rendererRoles, ...cssRoles]) {
  assert(catalogRoles.has(role), `Style Catalog is missing runtime role: ${role}`);
}

const tokenThemePaths = new Set(catalog.tokens.map((token) => token.themePath));
for (const [section, properties] of [
  ["colors", schema.properties.colors.properties],
  ["semanticColors", schema.properties.semanticColors.properties],
  ["fonts", schema.properties.fonts.properties],
]) {
  for (const key of Object.keys(properties)) {
    assert(tokenThemePaths.has(`${section}.${key}`), `Editor is missing theme field: ${section}.${key}`);
  }
}

const editableVariables = new Set(catalog.tokens.map((token) => token.cssVariable));
const classifiedVariables = new Set([...editableVariables, ...catalog.runtimeOnlyVariables]);
const runtimeSkinVariables = new Set([
  ...renderer.matchAll(/"(--skin-[a-z0-9-]+)"/g),
  ...css.matchAll(/var\((--skin-[a-z0-9-]+)/g),
].map((match) => match[1]));
for (const variable of runtimeSkinVariables) {
  assert(classifiedVariables.has(variable), `Style Catalog has not classified runtime variable: ${variable}`);
}
for (const token of catalog.tokens) {
  assert(renderer.includes(`"${token.cssVariable}"`) || css.includes(`var(${token.cssVariable}`),
    `Editable token has no runtime binding: ${token.id}`);
}

assert(catalog.nativeRoles.some((role) => role.id === "settings-switch"));
assert(catalog.nativeRoles.some((role) => role.id === "browser-webview"));
assert.deepEqual(catalog.roleFamilies.find((family) => family.id === "overlay")?.variants,
  ["dialog", "menu", "listbox", "tooltip", "status", "alert"]);
assert(renderer.includes('overlay.setAttribute("data-skin-overlay-kind", overlay.getAttribute("role"))'));
assert(renderer.includes('node.removeAttribute("data-skin-overlay-kind")'));
assert(!JSON.stringify(catalog).includes("querySelector"));
assert(!JSON.stringify(catalog).includes("app-shell-left-panel"));

assert.throws(() => validateStyleOverrideValues({ "unknown.color": "#ffffff" }, catalog), /unknown token/);
assert.throws(() => validateStyleOverrideValues({ "text.primary": "url(file:///tmp/x)" }, catalog), /local CSS color/);
assert.throws(() => validateStyleOverrideValues({ "font.ui": ["Safe", "bad;font"] }, catalog), /safe local font/);

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "theme-style-overrides-"));
try {
  const stateRoot = path.join(temporary, "state");
  const rawTheme = {
    kind: "skin.theme",
    id: "catalog-test",
    name: "Catalog Test",
    image: "background.png",
  };
  const theme = normalizeSkinTheme(rawTheme);
  const values = {
    "text.primary": "#112233",
    "font.ui": ["Inter", "system-ui"],
  };
  await saveStyleOverrides(theme, catalog, values, {
    root: stateRoot,
    runtimePreferences: { "background.presentation": "paused" },
  });
  const loaded = await loadStyleOverrides(theme, catalog, { root: stateRoot });
  assert.equal(loaded.status, "loaded");
  assert.deepEqual(loaded.values, values);
  assert.deepEqual(loaded.runtimePreferences, { "background.presentation": "paused" });
  const renamedMediaTheme = normalizeSkinTheme({
    ...rawTheme,
    name: "Changed",
    image: "replacement.webp",
    backgroundVideo: "replacement.mp4",
  });
  const retained = await loadStyleOverrides(renamedMediaTheme, catalog, { root: stateRoot });
  assert.equal(retained.status, "loaded");
  assert.deepEqual(retained.values, values);
  const changedTheme = normalizeSkinTheme({ ...rawTheme, colors: { text: "#abcdef" } });
  const rebased = await loadStyleOverrides(changedTheme, catalog, { root: stateRoot });
  assert.equal(rebased.status, "rebased");
  assert.deepEqual(rebased.values, values);
  assert(rebased.diagnostics.some((item) => item.code === "base-rebased"));

  const unsafeRoot = path.join(temporary, "unsafe");
  await fs.symlink(stateRoot, unsafeRoot);
  await assert.rejects(saveStyleOverrides(theme, catalog, values, { root: unsafeRoot }), /unsafe/);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("theme-style-catalog.test.mjs: ok");
