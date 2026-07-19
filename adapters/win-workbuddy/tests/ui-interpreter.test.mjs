import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertLiveCatalog, compileFixedStyleSnapshot } from "../src/ui-interpreter.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const surface = read("../compatibility/workbuddy-windows/5.2.6/ui-surface-catalog.json");
const style = read("../contracts/theme-style-catalog.json");

test("fixed interpreter rejects identity-only Surface Catalog", () => {
  assert.throws(() => assertLiveCatalog(surface, style), /surface-catalog-unverified/);
  assert.throws(() => compileFixedStyleSnapshot({}, surface, style), /surface-catalog-unverified/);
});

test("fixed interpreter rejects guessed version and incomplete transport independently", () => {
  const candidate = structuredClone(surface);
  candidate.verificationStatus = "verified";
  assert.throws(() => assertLiveCatalog(candidate, style), /surface-transport-unverified/);
  candidate.clientVersion = "5.2.7";
  assert.throws(() => assertLiveCatalog(candidate, style), /surface-catalog-version-mismatch/);
});
