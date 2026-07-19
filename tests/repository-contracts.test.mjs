import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function json(relative) {
  return JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function bounded(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function exactKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function localBasename(value, extension = null) {
  if (typeof value !== "string" || value.length < 1 || value.length > 255) return false;
  if (/[:/\\\u0000-\u001f]/.test(value)) return false;
  return extension ? value.toLowerCase().endsWith(extension) : true;
}

function validateFragment(value) {
  if (!plainObject(value) || !exactKeys(value, ["image", "backgroundVideo", "interactiveBackground"])) return "unknown-field";
  if (!localBasename(value.image)) return "local-basename";
  if (!/\.(?:png|jpe?g|webp)$/i.test(value.image)) return "image-type";
  if (value.backgroundVideo !== undefined && !localBasename(value.backgroundVideo, ".mp4")) return "local-basename";
  if (value.backgroundVideo !== undefined && value.interactiveBackground !== undefined) return "mutually-exclusive";
  if (value.interactiveBackground === undefined) return null;

  const interactive = value.interactiveBackground;
  if (!plainObject(interactive)) return "interactive-shape";
  if (interactive.type === "ripple") {
    if (!exactKeys(interactive, ["type", "intensity", "radiusPx", "quality", "scrimOpacity"])) return "unknown-field";
    if (interactive.intensity !== undefined && !bounded(interactive.intensity, 0, 1)) return "ripple-parameter";
    if (interactive.radiusPx !== undefined && !bounded(interactive.radiusPx, 8, 96)) return "ripple-parameter";
    if (interactive.quality !== undefined && !["auto", "low", "high"].includes(interactive.quality)) return "ripple-parameter";
    if (interactive.scrimOpacity !== undefined && !bounded(interactive.scrimOpacity, 0, 0.8)) return "ripple-parameter";
    return null;
  }
  if (interactive.type !== "directional") return "interactive-type";
  if (!exactKeys(interactive, ["type", "atlas", "directions", "columns", "rows", "firstDirectionDegrees", "idleFrame", "origin", "scrimOpacity"])) return "unknown-field";
  if (!localBasename(interactive.atlas)) return "local-basename";
  if (!localBasename(interactive.atlas, ".webp")) return "static-webp";
  if (![8, 16, 32].includes(interactive.directions)) return "directions";
  if (!Number.isInteger(interactive.columns) || !Number.isInteger(interactive.rows)
    || interactive.columns < 1 || interactive.columns > 8 || interactive.rows < 1 || interactive.rows > 8
    || interactive.columns * interactive.rows !== interactive.directions) return "grid";
  if (interactive.firstDirectionDegrees !== undefined && !bounded(interactive.firstDirectionDegrees, -180, 180)) return "first-direction";
  if (interactive.idleFrame !== undefined && (!Number.isInteger(interactive.idleFrame)
    || interactive.idleFrame < 0 || interactive.idleFrame >= interactive.directions)) return "idle-frame";
  if (interactive.origin !== undefined && (!plainObject(interactive.origin)
    || !exactKeys(interactive.origin, ["xPercent", "yPercent"])
    || !bounded(interactive.origin.xPercent, 0, 100) || !bounded(interactive.origin.yPercent, 0, 100))) return "origin";
  if (interactive.scrimOpacity !== undefined && !bounded(interactive.scrimOpacity, 0, 0.8)) return "directional-parameter";
  return null;
}

test("shared background vectors preserve the cross-platform contract", async () => {
  const vectors = await json("app/packages/test-kit/fixtures/background-capability.vectors.json");
  for (const vector of vectors.valid) {
    assert.equal(validateFragment(vector.value), null, vector.id);
  }
  for (const vector of vectors.invalid) {
    assert.equal(validateFragment(vector.value), vector.error, vector.id);
  }
});

test("shared Schema exposes the authoritative interactive allowlists", async () => {
  const schema = await json("app/packages/contracts/background/background-capability.schema.json");
  const ripple = schema.$defs.ripple;
  const directional = schema.$defs.directional;
  assert.equal(ripple.additionalProperties, false);
  assert.deepEqual(ripple.properties.quality.enum, ["auto", "low", "high"]);
  assert.equal(ripple.properties.intensity.minimum, 0);
  assert.equal(ripple.properties.intensity.maximum, 1);
  assert.equal(ripple.properties.radiusPx.minimum, 8);
  assert.equal(ripple.properties.radiusPx.maximum, 96);
  assert.equal(directional.additionalProperties, false);
  assert.deepEqual(directional.properties.directions.enum, [8, 16, 32]);
  assert.equal(directional.properties.atlas.$ref, "#/$defs/staticWebpFile");
  assert.deepEqual(schema.allOf[0].not.required, ["backgroundVideo", "interactiveBackground"]);
});

test("repository media limits match the current authoritative mac-codex mirror", async () => {
  const shared = await json("app/packages/contracts/background/media-limits.json");
  const macCodex = await json("adapters/mac-codex/contracts/media-limits.json");
  assert.deepEqual(shared, macCodex);
  assert.equal(shared.directionalAtlasBytes, 32 * 1024 * 1024);
  assert.equal(shared.directionalAtlasPixels, 32_000_000);
  assert.equal(shared.directionalAtlasDimension, 16_384);
});

test("capability matrix keeps every Windows runtime paused-by-user", async () => {
  const matrix = await json("app/registry/client-capabilities.json");
  assert.deepEqual(
    matrix.projects.map((project) => project.id).sort(),
    ["mac-codex", "mac-workbuddy", "win-codex", "win-workbuddy"],
  );
  const allowed = new Set(matrix.statuses);
  for (const project of matrix.projects) {
    for (const status of Object.values(project.capabilities)) assert.ok(allowed.has(status), `${project.id}: ${status}`);
  }
  const windows = matrix.projects.filter((project) => project.platform === "windows");
  assert.deepEqual(windows.map((project) => project.id).sort(), ["win-codex", "win-workbuddy"]);
  for (const project of windows) {
    assert.equal(project.clientRuntimeBaseline, false);
    assert.equal(project.runtimeApplyAvailable, false);
    assert.deepEqual(project.evidence, []);
    assert.ok(Object.values(project.capabilities).every((status) => status === "paused-by-user"));
  }
  assert.equal(matrix.projects.some((project) => project.application === "claude"), false);
});

test("only evidence-backed integrations are marked verified", async () => {
  const matrix = await json("app/registry/client-capabilities.json");
  for (const project of matrix.projects) {
    if (Object.values(project.capabilities).includes("verified")) {
      assert.ok(project.evidence.length > 0, `${project.id} requires evidence`);
    }
  }
  const macCodex = matrix.projects.find((project) => project.id === "mac-codex");
  assert.equal(macCodex.capabilities.ripple, "verified");
  assert.equal(macCodex.capabilities.directional, "verified");
  assert.equal(macCodex.capabilities.reduceMotionForceStatic, "verified");
  const macWorkBuddy = matrix.projects.find((project) => project.id === "mac-workbuddy");
  assert.equal(macWorkBuddy.runtimeApplyAvailable, true);
  assert.ok(Object.values(macWorkBuddy.capabilities).every((status) => status === "verified"));
});

test("shared state machine preserves controls, appearance, and Reduce Motion semantics", async () => {
  const machine = await json("app/packages/contracts/background/background-state-machine.json");
  assert.equal(machine.initialState, "loading");
  assert.equal(machine.terminalState, "disposed");
  assert.deepEqual(machine.interactiveModes.ripple.control, {
    enabled: "水波启用",
    disabled: "静态图片",
  });
  assert.deepEqual(machine.interactiveModes.directional.control, {
    enabled: "方向跟随",
    disabled: "默认方向",
  });
  assert.equal(machine.interactiveModes.ripple.staticPresentation, "base-image");
  assert.equal(machine.interactiveModes.directional.staticPresentation, "idle-frame");
  assert.equal(machine.policies.reduceMotion, "force-static");
  assert.equal(machine.policies.disableInteraction, "preserve-theme-appearance");
  assert.equal(machine.policies.themeRuntimeCode, "forbidden");
});
