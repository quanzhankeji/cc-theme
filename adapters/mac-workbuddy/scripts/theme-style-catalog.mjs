import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const STYLE_CATALOG_PATH = path.join(here, "..", "contracts", "theme-style-catalog.json");
export const STYLE_CATALOG_KIND = "theme.style-catalog";

const ID = /^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/;
const CSS_VARIABLE = /^--(?:wbs|wb|cb)-[a-z0-9-]+$/;
const SOURCE = /^(?:palette|layout|host)\.[A-Za-z][A-Za-z0-9]*$/;
const SETTING_SOURCE = /^(?:theme|runtime|style)\.[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/;
const SETTING_GROUPS = new Set(["theme", "color", "typography", "opacity", "palette", "background"]);
const SETTING_TYPES = new Set(["theme", "select", "backgroundState", "color", "fontList", "number", "position"]);
const SAFE_COLOR = /^(?:#[0-9a-f]{6}|rgba?\(\s*[0-9.]+\s*,\s*[0-9.]+\s*,\s*[0-9.]+(?:\s*,\s*[0-9.]+)?\s*\)|hsla?\(\s*[0-9.]+(?:deg)?\s*,\s*[0-9.]+%\s*,\s*[0-9.]+%(?:\s*,\s*[0-9.]+)?\s*\)|transparent)$/i;

const plainObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;

export function validateThemeStyleCatalog(value, runtimeRoles, label = "Theme Style Catalog") {
  const catalog = plainObject(value);
  if (!catalog || catalog.kind !== STYLE_CATALOG_KIND || catalog.schemaVersion !== 1 ||
      catalog.catalogVersion !== 2 || catalog.adapterId !== "mac-workbuddy" ||
      catalog.adapterVersion !== "5.2.6" || catalog.adapterReleaseRevision !== 4 ||
      catalog.catalogId !== "mac-workbuddy-theme") {
    throw new Error(`${label} has an invalid identity`);
  }
  if (catalog.geometryPolicy !== "native") throw new Error(`${label} must preserve native geometry`);
  const roleIds = new Set((runtimeRoles ?? []).map((rule) => rule.role));
  const groups = new Set();
  for (const group of catalog.groups ?? []) {
    if (!plainObject(group) || !ID.test(group.id ?? "") || groups.has(group.id)) {
      throw new Error(`${label} contains an invalid or duplicate group`);
    }
    groups.add(group.id);
  }
  if (!groups.size) throw new Error(`${label} requires groups`);

  const ids = new Set();
  const variables = new Set();
  for (const binding of catalog.bindings ?? []) {
    if (!plainObject(binding) || !ID.test(binding.id ?? "") || ids.has(binding.id)) {
      throw new Error(`${label} contains an invalid or duplicate binding`);
    }
    if (!groups.has(binding.group)) throw new Error(`${label} binding ${binding.id} has an unknown group`);
    if (!CSS_VARIABLE.test(binding.cssVariable ?? "") || variables.has(binding.cssVariable)) {
      throw new Error(`${label} binding ${binding.id} has an invalid or duplicate CSS variable`);
    }
    const hasSource = typeof binding.source === "string";
    const hasValue = typeof binding.value === "string";
    if (hasSource === hasValue || (hasSource && !SOURCE.test(binding.source))) {
      throw new Error(`${label} binding ${binding.id} requires exactly one safe source or fixed value`);
    }
    if (hasValue && (!binding.value.trim() || binding.value.length > 320 || /[;{}]|url\s*\(/i.test(binding.value))) {
      throw new Error(`${label} binding ${binding.id} has an unsafe fixed value`);
    }
    if (!Array.isArray(binding.roles) || !binding.roles.length || binding.roles.some((role) => !roleIds.has(role))) {
      throw new Error(`${label} binding ${binding.id} refers to an unknown runtime role`);
    }
    ids.add(binding.id);
    variables.add(binding.cssVariable);
  }
  if (!ids.size) throw new Error(`${label} requires bindings`);

  const controlIds = new Set();
  for (const control of catalog.settingsControls ?? []) {
    if (!plainObject(control) || !ID.test(control.id ?? "") || controlIds.has(control.id) ||
        !SETTING_GROUPS.has(control.group) || !SETTING_TYPES.has(control.type) ||
        !SETTING_SOURCE.test(control.source ?? "") || !/^[a-z][A-Za-z0-9]*$/.test(control.labelKey ?? "")) {
      throw new Error(`${label} contains an invalid or duplicate settings control`);
    }
    if (control.binding !== undefined && (!ids.has(control.binding) ||
        catalog.bindings.find((binding) => binding.id === control.binding)?.value !== undefined)) {
      throw new Error(`${label} settings control ${control.id} has an invalid binding`);
    }
    if (control.type === "position" && (!Array.isArray(control.bindings) || control.bindings.length !== 2 ||
        new Set(control.bindings).size !== 2 || control.binding !== undefined ||
        control.bindings.some((bindingId) => !ids.has(bindingId) ||
          catalog.bindings.find((binding) => binding.id === bindingId)?.value !== undefined))) {
      throw new Error(`${label} settings control ${control.id} requires two position paint bindings`);
    }
    if (control.type !== "position" && control.bindings !== undefined) {
      throw new Error(`${label} settings control ${control.id} has unexpected position bindings`);
    }
    if (["color", "fontList", "number"].includes(control.type) && !control.binding) {
      throw new Error(`${label} settings control ${control.id} requires a paint binding`);
    }
    if (["select", "backgroundState"].includes(control.type) &&
        (!Array.isArray(control.options) || !control.options.length ||
          control.options.some((option) => typeof option !== "string" || !/^[a-z][a-z-]*$/.test(option)))) {
      throw new Error(`${label} settings control ${control.id} requires safe options`);
    }
    if (["number", "position"].includes(control.type) && (!Number.isFinite(control.minimum) || !Number.isFinite(control.maximum) ||
        !Number.isFinite(control.step) || control.minimum >= control.maximum || control.step <= 0 ||
        !["", "%", "px"].includes(control.unit))) {
      throw new Error(`${label} settings control ${control.id} has an invalid numeric range`);
    }
    if (control.themePath !== undefined && !/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/.test(control.themePath)) {
      throw new Error(`${label} settings control ${control.id} has an invalid theme path`);
    }
    if (control.paletteStrategies !== undefined && (!Array.isArray(control.paletteStrategies) ||
        control.paletteStrategies.some((strategy) => !["system", "adaptive", "custom"].includes(strategy)))) {
      throw new Error(`${label} settings control ${control.id} has invalid palette strategies`);
    }
    controlIds.add(control.id);
  }
  if (!controlIds.size) throw new Error(`${label} requires settingsControls`);
  return catalog;
}

export function validateThemeSettingValues(value, catalog, label = "Theme setting values") {
  const values = plainObject(value);
  if (!values) throw new Error(`${label} must be an object`);
  const controls = new Map((catalog.settingsControls ?? [])
    .filter((control) => control.binding || control.bindings)
    .map((control) => [control.id, control]));
  const normalized = {};
  for (const [id, raw] of Object.entries(values)) {
    const control = controls.get(id);
    if (!control) throw new Error(`${label} contains an unknown control: ${id}`);
    if (control.type === "color") {
      if (typeof raw !== "string" || raw.length > 96 || !SAFE_COLOR.test(raw.trim())) {
        throw new Error(`${label}.${id} must be a safe color`);
      }
      normalized[id] = raw.trim();
    } else if (control.type === "fontList") {
      const families = Array.isArray(raw) ? raw.map((family) => typeof family === "string" ? family.trim() : family) : raw;
      if (!Array.isArray(families) || !families.length || families.length > 8 ||
          families.some((family) => typeof family !== "string" || !/^[\p{L}\p{N} _-]{1,64}$/u.test(family) ||
            !/[\p{L}\p{N}]/u.test(family))) {
        throw new Error(`${label}.${id} must be a safe font family list`);
      }
      normalized[id] = families;
    } else if (control.type === "number") {
      const number = Number(raw);
      if (!Number.isFinite(number) || number < control.minimum || number > control.maximum) {
        throw new Error(`${label}.${id} is outside its allowlisted range`);
      }
      normalized[id] = number;
    } else if (control.type === "position") {
      const position = plainObject(raw);
      if (!position || Object.keys(position).length !== 2 ||
          !Object.hasOwn(position, "xPercent") || !Object.hasOwn(position, "yPercent")) {
        throw new Error(`${label}.${id} must be a complete position`);
      }
      const xPercent = Number(position.xPercent);
      const yPercent = Number(position.yPercent);
      if (![xPercent, yPercent].every((number) => Number.isFinite(number) &&
          number >= control.minimum && number <= control.maximum)) {
        throw new Error(`${label}.${id} position is outside its allowlisted range`);
      }
      normalized[id] = { xPercent, yPercent };
    }
  }
  return normalized;
}

export function serializeThemeSettingValue(control, value) {
  if (control.type === "fontList") return value.map((family) =>
    ["serif", "sans-serif", "monospace", "system-ui"].includes(family)
      ? family : `"${family.replaceAll('"', "")}"`).join(", ");
  if (control.type === "number") return `${value}${control.unit}`;
  if (control.type === "position") return {
    xPercent: `${value.xPercent}${control.unit}`,
    yPercent: `${value.yPercent}${control.unit}`,
  };
  return String(value);
}

export async function loadThemeStyleCatalog(runtimeRoles, file = STYLE_CATALOG_PATH) {
  return validateThemeStyleCatalog(JSON.parse(await fs.readFile(file, "utf8")), runtimeRoles);
}
