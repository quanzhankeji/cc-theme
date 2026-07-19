import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "switch-theme-macos.sh");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-manager-switch-"));

try {
  const source = await fs.readFile(script, "utf8");
  assert.match(source, /case "\$theme_id" in/);
  assert.match(source, /\*\[!A-Za-z0-9_-\]\*/);
  assert.match(source, /source_theme="\$themes_root\/\$theme_id"/);
  assert.match(source, /dirname "\$source_theme_real"/);
  assert.match(source, /stage-theme\.mjs/);
  assert.match(source, /injector\.mjs" --check-payload/);
  assert.match(source, /\/bin\/mv "\$stage" "\$runtime_theme"/);
  assert.match(source, /rollback_selection/);
  assert.match(source, /pause-skin-macos\.sh/);
  assert.match(source, /start-skin-macos\.sh/);
  assert.doesNotMatch(source, /presets|theme-library|--theme-dir\)/);

  await assert.rejects(
    execFile("/bin/bash", [script, "--id", "../escape"], {
      env: { ...process.env, HOME: temporary },
    }),
    (error) => /Theme id may contain only/.test(error.stderr),
  );
  await assert.rejects(
    execFile("/bin/bash", [script, "--id", "safe-id", "--theme-dir", temporary], {
      env: { ...process.env, HOME: temporary },
    }),
    (error) => /Unknown argument: --theme-dir/.test(error.stderr),
  );

  console.log("PASS: WorkBuddy Manager switch accepts only a safe theme id and preserves fixed staging, validation, pause, apply, and rollback boundaries.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
