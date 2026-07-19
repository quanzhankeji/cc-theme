import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { adapterRegistry, compiler, readFixture } from "./support/runtime-interface.mjs";

const { compileThemeFamily, stableStringify, writeCompiledThemeFamily } = compiler;
const { DEFAULT_ADAPTER_REGISTRY } = adapterRegistry;
const example = await readFixture("fixtures/unified-theme.json");
const context = await readFixture("fixtures/compile-context.json");

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseObjectKeys(value[key])]));
}

test("registry compilation is deterministic when authoring key order changes", async () => {
  const first = await compileThemeFamily(example, context);
  const second = await compileThemeFamily(reverseObjectKeys(example), reverseObjectKeys(context));
  assert.equal(stableStringify(first), stableStringify(second));
});

test("compiler fails closed on unknown fields, executable payloads, URLs, absolute paths, and traversal", async () => {
  const attempts = [
    ["unknown root field", (value) => { value.unknown = true; }],
    ["unknown shared field", (value) => { value.sharedCore.unknown = true; }],
    ["target CSS", (value) => { value.targetProfiles["mac-codex"].css = "body{}"; }],
    ["target command", (value) => { value.targetProfiles["mac-codex"].command = "open"; }],
    ["target URL", (value) => { value.targetProfiles["mac-codex"].asset = "https://example.com/a.webp"; }],
    ["target absolute path", (value) => { value.targetProfiles["mac-codex"].asset = "/tmp/a.webp"; }],
    ["background traversal", (value) => { value.sharedCore.background.image = "../a.webp"; }],
  ];
  for (const [label, mutate] of attempts) {
    const source = structuredClone(example);
    mutate(source);
    await assert.rejects(() => compileThemeFamily(source, context), /unsupported|forbidden|URL|absolute|traversal|local|unsafe/i, label);
  }
});

test("writer creates one stable target artifact per discovered Adapter", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "cc-theme-family-"));
  try {
    const result = await writeCompiledThemeFamily(example, context, outputDirectory);
    assert.deepEqual(Object.keys(result.files), ["mac-codex", "mac-workbuddy"]);
    for (const [adapterId, file] of Object.entries(result.files)) {
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), result.themes[adapterId]);
      assert.equal(path.basename(file), "theme.json");
    }
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("a selected Adapter compiles independently when an unselected projector is broken", async () => {
  const registry = {
    ...DEFAULT_ADAPTER_REGISTRY,
    capabilities: DEFAULT_ADAPTER_REGISTRY.capabilities.map((capability) => capability.adapterId === "mac-workbuddy"
      ? { ...capability, projection: { ...capability.projection, module: "missing-workbuddy-projector.mjs" } }
      : capability),
  };

  const result = await compileThemeFamily(example, context, {
    registry,
    targetAdapterIds: ["mac-codex"],
  });

  assert.deepEqual(Object.keys(result.themes), ["mac-codex"]);
  assert.deepEqual(Object.keys(result.applyAvailability), ["mac-codex"]);
});

test("target-scoped writer publishes only the selected Adapter artifact", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "cc-theme-selected-"));
  try {
    const result = await writeCompiledThemeFamily(example, context, outputDirectory, {
      targetAdapterIds: ["mac-codex"],
    });
    assert.deepEqual(Object.keys(result.files), ["mac-codex"]);
    assert.deepEqual(JSON.parse(await readFile(result.files["mac-codex"], "utf8")), result.themes["mac-codex"]);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
