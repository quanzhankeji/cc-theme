import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CANONICAL_ADAPTER_IDS } from "../../adapter-sdk/adapter-registry.mjs";
import { compileThemeFamily, validateThemeFamily } from "../compiler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const readJson = async (relative) => JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));

test("Theme, Compile Context, Registry, and compile output use only canonical Adapter IDs", async () => {
  const theme = await readJson("app/packages/test-kit/fixtures/unified-theme.json");
  const context = await readJson("app/packages/test-kit/fixtures/compile-context.json");
  assert.deepEqual(theme.targets, CANONICAL_ADAPTER_IDS);
  assert.deepEqual(Object.keys(context.adapters), CANONICAL_ADAPTER_IDS);
  validateThemeFamily(theme);
  const compiled = await compileThemeFamily(theme, context);
  assert.deepEqual(Object.keys(compiled.themes), CANONICAL_ADAPTER_IDS);
  assert.deepEqual(Object.keys(compiled.applyAvailability), CANONICAL_ADAPTER_IDS);

  const capabilitySchema = await readJson("app/packages/contracts/adapter-capability.schema.json");
  const contextSchema = await readJson("app/packages/contracts/compile-context.schema.json");
  const themeSchema = await readJson("app/packages/contracts/unified-theme-v1.schema.json");
  assert.deepEqual(capabilitySchema.$defs.adapterId.enum, CANONICAL_ADAPTER_IDS);
  assert.deepEqual(contextSchema.properties.adapters.propertyNames.enum, CANONICAL_ADAPTER_IDS);
  assert.deepEqual(themeSchema.properties.targets.items.enum, CANONICAL_ADAPTER_IDS);
  assert.deepEqual(themeSchema.properties.targetProfiles.propertyNames.enum, CANONICAL_ADAPTER_IDS);
  assert.equal(capabilitySchema.properties[["legacy", "Aliases"].join("")], undefined);

  const retired = ["codex", "claude", "workbuddy"].map((client) => ["mac", client, "skin"].join("-"));
  for (const adapterId of retired) {
    const invalid = structuredClone(theme);
    invalid.targets = [adapterId];
    assert.throws(() => validateThemeFamily(invalid), /Unknown adapter capability/);

    const invalidContext = structuredClone(context);
    invalidContext.adapters[adapterId] = invalidContext.adapters["mac-codex"];
    await assert.rejects(() => compileThemeFamily(theme, invalidContext), /Unknown adapter capability/);
  }
});

test("compilation fails closed when a selected canonical Adapter context is absent", async () => {
  const theme = await readJson("app/packages/test-kit/fixtures/unified-theme.json");
  const context = await readJson("app/packages/test-kit/fixtures/compile-context.json");
  delete context.adapters["mac-workbuddy"];
  await assert.rejects(
    () => compileThemeFamily(theme, context, { targetAdapterIds: ["mac-workbuddy"] }),
    /requires an explicit canonical Adapter compile context/,
  );
});
