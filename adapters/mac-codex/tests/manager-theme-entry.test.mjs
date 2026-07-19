import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { writeSyntheticPng } from "./helpers/media-fixtures.mjs";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "scripts/switch-theme-macos.sh");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-codex-manager-entry-"));
const home = path.join(temporary, "home");
const state = path.join(home, "Library/Application Support/CCTheme");
const managerTheme = path.join(state, "themes/manager-fixture");
const liveTheme = path.join(state, "theme");

try {
  await fs.mkdir(managerTheme, { recursive: true });
  await fs.mkdir(liveTheme, { recursive: true });
  await writeSyntheticPng(path.join(managerTheme, "background.png"), { width: 1600, height: 900 });
  await fs.writeFile(path.join(managerTheme, "theme.json"), `${JSON.stringify({
    kind: "skin.theme",
    id: "manager-fixture",
    name: "Manager Fixture",
    image: "background.png",
  })}\n`);
  await fs.writeFile(path.join(liveTheme, "stale.txt"), "last-known-good\n");

  const { stdout } = await run(entry, ["--id", "manager-fixture", "--no-apply"], {
    env: { ...process.env, HOME: home, NODE: process.execPath, CC_THEME_NODE: process.execPath },
  });
  const result = JSON.parse(stdout);
  assert.equal(result.id, "manager-fixture");
  assert.equal(result.applied, false);
  assert.equal(result.mode, "staged");
  assert.equal(JSON.parse(await fs.readFile(path.join(liveTheme, "theme.json"), "utf8")).id, "manager-fixture");
  await assert.rejects(fs.access(path.join(liveTheme, "stale.txt")));
  assert.equal(JSON.parse(await fs.readFile(path.join(state, "active-theme.json"), "utf8")).themeId, "manager-fixture");

  await assert.rejects(
    run(entry, ["--id", "../escape", "--no-apply"], {
      env: { ...process.env, HOME: home, NODE: process.execPath, CC_THEME_NODE: process.execPath },
    }),
  );
  await assert.rejects(
    run(entry, ["--id", "not-downloaded", "--no-apply"], {
      env: { ...process.env, HOME: home, NODE: process.execPath, CC_THEME_NODE: process.execPath },
    }),
  );

  const mismatched = path.join(state, "themes/mismatched");
  await fs.mkdir(mismatched);
  await fs.copyFile(path.join(managerTheme, "background.png"), path.join(mismatched, "background.png"));
  await fs.writeFile(path.join(mismatched, "theme.json"), `${JSON.stringify({
    kind: "skin.theme", id: "different-id", image: "background.png",
  })}\n`);
  await assert.rejects(
    run(entry, ["--id", "mismatched", "--no-apply"], {
      env: { ...process.env, HOME: home, NODE: process.execPath, CC_THEME_NODE: process.execPath },
    }),
  );

  const source = await fs.readFile(entry, "utf8");
  assert.doesNotMatch(source, /PROJECT_ROOT\/presets|bundled_root/i);
  assert.match(source, /\$STATE_ROOT\/themes/);
  console.log("PASS: Codex consumes only a Manager-provided saved theme through the fixed interpreter entry.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
