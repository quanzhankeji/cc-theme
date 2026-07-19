import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { loadClaudeLocaleCatalog } from "../scripts/claude-locale-catalog.mjs";

const resources = "/Applications/Claude.app/Contents/Resources";
const catalog = await loadClaudeLocaleCatalog();
try {
  await fs.access(resources);
} catch {
  console.log("SKIP: official Claude.app is not installed; locale bundle evidence was not re-probed.");
  process.exit(0);
}

const available = (await fs.readdir(resources))
  .filter((name) => /^[a-z]{2}-(?:[A-Z]{2}|\d{3})\.json$/.test(name))
  .map((name) => name.replace(/\.json$/, ""))
  .sort();
assert.deepEqual(available, [...catalog.locales].sort(), "signed client locale resources differ from the Catalog");
for (const locale of catalog.locales) {
  const messages = JSON.parse(await fs.readFile(path.join(resources, `${locale}.json`), "utf8"));
  assert.equal(Object.keys(messages).length, catalog.evidence.resourceKeyCountPerLocale,
    `${locale} resource key count changed`);
}
const asar = await fs.readFile(path.join(resources, "app.asar"));
for (const marker of ["DesktopIntl", "getInitialLocale", "requestLocaleChange", "onLocaleChanged"]) {
  assert(asar.includes(Buffer.from(marker)), `official app.asar no longer exposes ${marker} evidence`);
}
console.log("claude-locale-client-evidence.test.mjs: ok");
