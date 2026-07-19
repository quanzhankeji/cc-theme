import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const probe = await readFile(
  new URL("../scripts/probe-windows-claude.ps1", import.meta.url),
  "utf8",
);

test("environment probe does not collect sensitive process fields", () => {
  assert.doesNotMatch(probe, /\.CommandLine\b/);
  assert.doesNotMatch(probe, /Get-ChildItem\s+(?:Env:|['\"]Env:)/i);
  assert.doesNotMatch(probe, /GetOwner\s*\(/);
  assert.match(probe, /includesFullPaths = \$false/);
  assert.match(probe, /signatureStatus/);
  assert.match(probe, /sha256/);
});

test("environment probe emits only bounded Claude discovery families", () => {
  for (const required of [
    "appxPackages",
    "uninstallEntries",
    "processes",
    "knownClientFiles",
    "downloadedInstallers",
  ]) {
    assert.match(probe, new RegExp(required));
  }
});
