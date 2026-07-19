import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const STYLE_CATALOG_PATH = path.join(here, "..", "contracts", "theme-style-catalog.json");
export const STYLE_CATALOG_KIND = "theme.style-catalog";

const IDENTIFIER = /^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/;
const CSS_VARIABLE = /^--skin-[a-z0-9-]+$/;
const THEME_PATH = /^(?:colors|semanticColors|fonts)\.[A-Za-z][A-Za-z0-9]*$/;
const COLOR = /^(?:#[0-9A-Fa-f]{6}|rgba?\([0-9., %]+\))$/;
const FONT_NAME = /^[\p{L}\p{N} ._-]{1,80}$/u;
const RUNTIME_CONTROL_ID = /^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/;

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function uniqueStrings(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  const result = [...new Set(value)];
  if (result.length !== value.length) throw new Error(`${label} contains duplicates`);
  return result;
}

export function validateStyleCatalog(value, label = "Theme Style Catalog") {
  const catalog = plainObject(value);
  if (!catalog || catalog.kind !== STYLE_CATALOG_KIND || catalog.catalogId !== "mac-codex-theme") {
    throw new Error(`${label} has an invalid identity`);
  }
  if (catalog.revision !== 1) throw new Error(`${label} has an unsupported revision`);
  if (catalog.geometryPolicy !== "native") throw new Error(`${label} must preserve native geometry`);
  if (!Array.isArray(catalog.groups) || !catalog.groups.length) throw new Error(`${label} requires groups`);
  const groupIds = new Set();
  for (const group of catalog.groups) {
    if (!plainObject(group) || !IDENTIFIER.test(group.id ?? "") || groupIds.has(group.id)) {
      throw new Error(`${label} contains an invalid or duplicate group`);
    }
    if (typeof group.labelZhCN !== "string" || typeof group.labelEn !== "string") {
      throw new Error(`${label} group ${group.id} requires localized labels`);
    }
    groupIds.add(group.id);
  }

  const roles = new Set();
  uniqueStrings(catalog.surfaceContexts ?? [], `${label} surfaceContexts`);
  if (!Array.isArray(catalog.roleFamilies) || !catalog.roleFamilies.length) {
    throw new Error(`${label} requires roleFamilies`);
  }
  for (const family of catalog.roleFamilies) {
    if (!plainObject(family) || !IDENTIFIER.test(family.id ?? "")) throw new Error(`${label} has an invalid role family`);
    for (const role of uniqueStrings(family.roles, `${label} ${family.id} roles`)) {
      if (!/^[a-z][a-z0-9-]*$/.test(role) || roles.has(role)) throw new Error(`${label} contains an invalid or duplicate role: ${role}`);
      roles.add(role);
    }
    if (family.variants !== undefined) uniqueStrings(family.variants, `${label} ${family.id} variants`);
  }
  for (const nativeRole of catalog.nativeRoles ?? []) {
    if (!plainObject(nativeRole) || !/^[a-z][a-z0-9-]*$/.test(nativeRole.id ?? "")) {
      throw new Error(`${label} has an invalid native role`);
    }
  }
  const runtimeOnlyVariables = uniqueStrings(catalog.runtimeOnlyVariables ?? [], `${label} runtimeOnlyVariables`);
  for (const variable of runtimeOnlyVariables) {
    if (!CSS_VARIABLE.test(variable)) throw new Error(`${label} has an invalid runtime-only variable: ${variable}`);
  }
  if (!Array.isArray(catalog.adapterBindingFamilies) ||
      catalog.adapterBindingFamilies.some((family) => !["--color-*", "--vscode-*", "--oai-*"].includes(family))) {
    throw new Error(`${label} has an invalid adapter binding family`);
  }
  if (!Array.isArray(catalog.runtimeControls) || !catalog.runtimeControls.length) {
    throw new Error(`${label} requires runtimeControls`);
  }
  const runtimeControlIds = new Set();
  for (const control of catalog.runtimeControls) {
    if (!plainObject(control) || !RUNTIME_CONTROL_ID.test(control.id ?? "") || runtimeControlIds.has(control.id) ||
        control.type !== "enum" || control.persistence !== "theme-runtime-overrides" ||
        control.reducedMotionOwner !== "client-runtime") {
      throw new Error(`${label} contains an invalid runtime control`);
    }
    const values = uniqueStrings(control.values, `${label} runtime control ${control.id}`);
    if (!values.length || values.some((value) => !/^[a-z][a-z0-9-]{0,31}$/.test(value))) {
      throw new Error(`${label} runtime control ${control.id} contains invalid values`);
    }
    runtimeControlIds.add(control.id);
  }

  if (!Array.isArray(catalog.tokens) || !catalog.tokens.length) throw new Error(`${label} requires tokens`);
  const tokenIds = new Set();
  const themePaths = new Set();
  const cssVariables = new Set();
  for (const token of catalog.tokens) {
    if (!plainObject(token) || !IDENTIFIER.test(token.id ?? "") || tokenIds.has(token.id)) {
      throw new Error(`${label} contains an invalid or duplicate token`);
    }
    if (!groupIds.has(token.group)) throw new Error(`${label} token ${token.id} has an unknown group`);
    if (!["color", "fontList"].includes(token.type)) throw new Error(`${label} token ${token.id} has an unsupported type`);
    if (!THEME_PATH.test(token.themePath ?? "") || themePaths.has(token.themePath)) {
      throw new Error(`${label} token ${token.id} has an invalid or duplicate themePath`);
    }
    if (!CSS_VARIABLE.test(token.cssVariable ?? "") || cssVariables.has(token.cssVariable)) {
      throw new Error(`${label} token ${token.id} has an invalid or duplicate cssVariable`);
    }
    if (typeof token.labelZhCN !== "string" || typeof token.labelEn !== "string") {
      throw new Error(`${label} token ${token.id} requires localized labels`);
    }
    for (const role of uniqueStrings(token.roles, `${label} ${token.id} roles`)) {
      if (!roles.has(role)) throw new Error(`${label} token ${token.id} refers to unknown role ${role}`);
    }
    tokenIds.add(token.id);
    themePaths.add(token.themePath);
    cssVariables.add(token.cssVariable);
  }
  for (const variable of runtimeOnlyVariables) {
    if (cssVariables.has(variable)) throw new Error(`${label} classifies ${variable} as both editable and runtime-only`);
  }
  return catalog;
}

export async function loadStyleCatalog(file = STYLE_CATALOG_PATH) {
  return validateStyleCatalog(JSON.parse(await fs.readFile(file, "utf8")));
}

export function styleCatalogIndex(catalog) {
  validateStyleCatalog(catalog);
  return new Map(catalog.tokens.map((token) => [token.id, token]));
}

export function validateStyleOverrideValues(values, catalog, label = "Style overrides") {
  const object = plainObject(values);
  if (!object) throw new Error(`${label} must be an object`);
  const index = styleCatalogIndex(catalog);
  const normalized = {};
  for (const [id, value] of Object.entries(object)) {
    const token = index.get(id);
    if (!token) throw new Error(`${label} contains unknown token: ${id}`);
    if (token.type === "color") {
      if (typeof value !== "string" || !COLOR.test(value.trim())) throw new Error(`${label} ${id} must be a local CSS color`);
      normalized[id] = value.trim();
    } else {
      if (!Array.isArray(value) || value.length < 1 || value.length > 8 || value.some((item) => typeof item !== "string" || !FONT_NAME.test(item.trim()))) {
        throw new Error(`${label} ${id} must contain 1 to 8 safe local font names`);
      }
      normalized[id] = value.map((item) => item.trim());
    }
  }
  return normalized;
}

export function validateRuntimePreferenceValues(values, catalog, label = "Runtime preferences") {
  const object = plainObject(values);
  if (!object) throw new Error(`${label} must be an object`);
  const controls = new Map((catalog.runtimeControls ?? []).map((control) => [control.id, control]));
  const normalized = {};
  for (const [id, value] of Object.entries(object)) {
    const control = controls.get(id);
    if (!control) throw new Error(`${label} contains unknown control: ${id}`);
    if (control.type !== "enum" || typeof value !== "string" || !control.values.includes(value)) {
      throw new Error(`${label} ${id} has an invalid value`);
    }
    normalized[id] = value;
  }
  return normalized;
}

export function styleOverrideCssValue(token, value) {
  return token.type === "fontList" ? value.join(", ") : value;
}
