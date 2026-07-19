import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { compileThemeFamily } from "../../app/packages/shared-core/compiler.mjs";
import { buildThemePackage, packTheme } from "../tools/pack-theme.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const example = path.join(repository, "themes/example");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function temporaryExample() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-theme-example-"));
  const theme = path.join(root, "example");
  await cp(example, theme, { recursive: true });
  return { root, theme };
}

test("the example is a bilingual first-version package source with a complete integrity manifest", async () => {
  const family = JSON.parse(await readFile(path.join(example, "family.json"), "utf8"));
  const unified = JSON.parse(await readFile(path.join(example, "unified-theme.json"), "utf8"));
  const source = await readFile(path.join(example, family.source.path));
  assert.equal(family.kind, "cc-theme.theme-family-package");
  assert.equal(family.schemaVersion, 1);
  assert.equal(family.id, unified.id);
  assert.equal(family.version, unified.version);
  assert.equal(unified.schemaVersion, 1);
  assert.ok(family.metadata.locales["zh-CN"].name);
  assert.ok(family.metadata.locales["en-US"].name);
  assert.equal(family.source.bytes, source.length);
  assert.equal(family.source.sha256, sha256(source));
  assert.equal(unified.sharedCore.tokens.appearance.backgroundPosition, undefined);
  for (const entry of family.assets) {
    const bytes = await readFile(path.join(example, entry.path));
    assert.equal(entry.bytes, bytes.length);
    assert.equal(entry.sha256, sha256(bytes));
  }
});

test("packing is deterministic and creates a ZIP-compatible .cctheme without a wrapper directory", async () => {
  const first = await temporaryExample();
  const second = await temporaryExample();
  try {
    const outputA = path.join(first.root, "first.cctheme");
    const outputB = path.join(second.root, "second.cctheme");
    const resultA = await packTheme(first.theme, outputA);
    const resultB = await packTheme(second.theme, outputB);
    const archiveA = await readFile(outputA);
    const archiveB = await readFile(outputB);
    assert.equal(archiveA.subarray(0, 4).readUInt32LE(), 0x04034b50);
    assert.deepEqual(archiveA, archiveB);
    assert.equal(resultA.sha256, resultB.sha256);
    for (const name of ["family.json", "unified-theme.json", "assets/background.webp"]) {
      assert.ok(archiveA.includes(Buffer.from(name)), name);
    }
    assert.equal(archiveA.includes(Buffer.from("example/family.json")), false);
  } finally {
    await Promise.all([rm(first.root, { recursive: true, force: true }), rm(second.root, { recursive: true, force: true })]);
  }
});

test("the packer rejects missing bilingual metadata and unlisted assets", async () => {
  const missingLocale = await temporaryExample();
  const extraAsset = await temporaryExample();
  try {
    const familyFile = path.join(missingLocale.theme, "family.json");
    const family = JSON.parse(await readFile(familyFile, "utf8"));
    delete family.metadata.locales["en-US"];
    await writeFile(familyFile, JSON.stringify(family));
    await assert.rejects(() => packTheme(missingLocale.theme, path.join(missingLocale.root, "invalid.cctheme")), /requires en-US/);

    await writeFile(path.join(extraAsset.theme, "assets/extra.webp"), await readFile(path.join(extraAsset.theme, "assets/background.webp")));
    await assert.rejects(() => packTheme(extraAsset.theme, path.join(extraAsset.root, "invalid.cctheme")), /must exactly match/);
  } finally {
    await Promise.all([rm(missingLocale.root, { recursive: true, force: true }), rm(extraAsset.root, { recursive: true, force: true })]);
  }
});

test("the package schema keeps display metadata separate from Unified Theme semantics", async () => {
  const schema = JSON.parse(await readFile(path.join(repository, "app/packages/contracts/theme-package.schema.json"), "utf8"));
  assert.equal(schema.properties.kind.const, "cc-theme.theme-family-package");
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.deepEqual(schema.$defs.metadata.properties.locales.required, ["zh-CN", "en-US"]);
  assert.equal(schema.$defs.asset.properties.path.pattern.startsWith("^assets/"), true);
  assert.equal(schema.properties.targets, undefined);
});

test("the public example compiles through the registered macOS Adapters", async () => {
  const context = JSON.parse(await readFile(path.join(repository, "app/packages/test-kit/fixtures/compile-context.json"), "utf8"));
  const source = JSON.parse(await readFile(path.join(example, "unified-theme.json"), "utf8"));
  const built = await buildThemePackage(example);
  const compiled = await compileThemeFamily(source, context);

  assert.equal(source.schemaVersion, 1);
  assert.equal(source.id, "example");
  assert.equal(source.sharedCore.tokens.appearance.backgroundPosition, undefined);
  assert.equal(built.manifest.id, "example");
  assert.equal(built.manifest.metadata.previewAsset, "background.webp");
  assert.deepEqual(Object.keys(compiled.themes), ["mac-codex", "mac-workbuddy"]);
  assert.equal(compiled.applyAvailability["mac-codex"].allowed, true);
  assert.equal(compiled.applyAvailability["mac-workbuddy"].allowed, true);
});
