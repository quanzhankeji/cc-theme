import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { managerRoot, readContract, readFixture, registrySource } from "./support/runtime-interface.mjs";

const canonicalAdapterIds = ["mac-codex", "mac-workbuddy"];
const managerCompileContextKeys = [
  "applyAllowed",
  "compileAllowed",
  "detectedClientBuild",
  "detectedClientVersion",
  "localRuntimeOverrides",
  "probeStatus",
  "reasonCode",
  "surfaceCatalogId",
  "surfaceCatalogVersion",
];

async function readManagerContract(name) {
  return JSON.parse(await readFile(path.join(managerRoot, "contracts", name), "utf8"));
}

function propertyNames(schema, output = new Set()) {
  if (!schema || typeof schema !== "object") return output;
  if (schema.properties) Object.keys(schema.properties).forEach((key) => output.add(key));
  Object.values(schema).forEach((value) => propertyNames(value, output));
  return output;
}

test("unified theme is a closed, semantic authoring contract", async () => {
  const schema = await readContract("unified-theme.schema.json");
  const v1 = await readContract("unified-theme-v1.schema.json");
  assert.equal(schema.$ref, "unified-theme-v1.schema.json");
  assert.equal(v1.properties.kind.const, "cc-theme.unified-theme");
  assert.equal(v1.properties.schemaVersion.const, 1);
  assert.equal(v1.additionalProperties, false);
  assert.equal(v1.properties.sharedCore.additionalProperties, false);
  assert.deepEqual(v1.properties.targets.items.enum, canonicalAdapterIds);
  assert.deepEqual(v1.properties.targetProfiles.propertyNames.enum, canonicalAdapterIds);
  assert.equal(v1.properties.compatibility, undefined);
  assert.deepEqual(
    v1.$defs.background.oneOf.map((entry) => entry.$ref),
    ["#/$defs/mediaBackground", "#/$defs/rippleBackground", "#/$defs/directionalBackground"],
  );
  assert.deepEqual(v1.$defs.tokens.required, ["colors", "fonts"]);
  assert.deepEqual(
    v1.$defs.tokens.properties.colors.required,
    ["surfaceBase", "text", "textMuted", "action", "actionForeground", "focusRing"],
  );
  assert.equal(v1.$defs.accessibility.properties.reducedMotion.const, "static");

  const forbidden = new Set(["css", "script", "javascript", "selector", "shader", "url", "command", "arguments", "path"]);
  for (const name of propertyNames(v1)) assert.equal(forbidden.has(name.toLowerCase()), false, `forbidden theme field: ${name}`);
});

test("local media patterns reject URL, absolute path, and traversal forms", async () => {
  const schema = await readContract("unified-theme-v1.schema.json");
  const image = new RegExp(schema.$defs.localImage.pattern);
  const video = new RegExp(schema.$defs.localVideo.pattern);
  const atlas = new RegExp(schema.$defs.staticWebp.pattern);

  assert.equal(image.test("background.webp"), true);
  assert.equal(video.test("ambient.mp4"), true);
  assert.equal(atlas.test("directions-16.webp"), true);
  for (const unsafe of ["https://example.com/a.webp", "/tmp/a.webp", "../a.webp", "dir/a.webp", "dir\\a.webp", "file:a.webp"]) {
    assert.equal(image.test(unsafe), false, unsafe);
  }
});

test("Manager IPC contracts expose only canonical Adapter identities", async () => {
  const request = await readManagerContract("adapter-request.schema.json");
  const result = await readManagerContract("adapter-result.schema.json");
  assert.deepEqual(request.properties.adapter.enum, canonicalAdapterIds);
  assert.deepEqual(result.properties.adapter.enum, canonicalAdapterIds);
  assert.equal(JSON.stringify({ request, result }).includes("-skin"), false);
});

test("example uses capability identities and projection discovery instead of embedded compatibility facts", async () => {
  const example = await readFixture("fixtures/unified-theme.json");
  const projection = await readContract("theme-projection-map.json");
  assert.equal(example.kind, "cc-theme.unified-theme");
  assert.equal(example.schemaVersion, 1);
  assert.equal(projection.sourceKind, example.kind);
  assert.equal(projection.outputKind, "skin.theme");
  assert.deepEqual(example.targets, ["mac-codex", "mac-workbuddy"]);
  assert.equal(projection.targetDiscovery, "registry");
  assert.equal(projection.projectionOwner, "adapter");
  assert.equal(projection.targets, undefined);
  assert.equal(example.sharedCore.compatibility, undefined);
  assert.ok(["media", "ripple", "directional"].includes(example.sharedCore.background.mode));
});

test("compile context and Adapter discovery derive identities from the registry", async () => {
  const context = await readFixture("fixtures/compile-context.json");
  const contextSchema = await readContract("compile-context.schema.json");
  const capability = await readContract("adapter-capability.schema.json");
  const registryIds = registrySource.adapters.map(({ capabilityFile }) => capabilityFile.split("/")[0]);
  assert.deepEqual(Object.keys(context.adapters), registryIds);
  assert.deepEqual(capability.$defs.adapterId.enum, canonicalAdapterIds);
  assert.equal(registrySource.adapters.some(({ capabilityFile }) => capabilityFile.startsWith("win-")), false);
  const allowedContextKeys = new Set(Object.keys(contextSchema.$defs.adapterContext.properties));
  for (const [adapterId, value] of Object.entries(context.adapters)) {
    for (const key of Object.keys(value)) assert.equal(allowedContextKeys.has(key), true, `${adapterId}.${key}`);
    assert.deepEqual(Object.keys(value).sort(), managerCompileContextKeys, `${adapterId} complete Manager context`);
  }
  assert.equal(allowedContextKeys.has("detectedClientBuild"), true);
  assert.equal(allowedContextKeys.has("surfaceCatalogId"), true);
});

test("Manager build compile context golden preserves the complete nine-key Adapter fact shape", async () => {
  const golden = JSON.parse(
    await readFile(path.join(managerRoot, "tests", "fixtures", "manager-build-compile-context.json"), "utf8"),
  );
  assert.equal(golden.kind, "cc-theme.compile-context");
  assert.equal(golden.schemaVersion, 1);
  assert.deepEqual(Object.keys(golden.adapters), canonicalAdapterIds);
  for (const [adapterId, adapterContext] of Object.entries(golden.adapters)) {
    assert.deepEqual(Object.keys(adapterContext).sort(), managerCompileContextKeys, adapterId);
  }
  assert.equal(golden.adapters["mac-workbuddy"].detectedClientBuild, null);
  assert.equal(golden.adapters["mac-workbuddy"].surfaceCatalogId, null);
});
