import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFile(path.join(root, relative), "utf8");
const common = await read("scripts/common-macos.sh");
const retiredNamespace = ["com", "openai", "cc-theme-studio"].join(".");

assert.match(common, /CLAUDE_APP_JOB_LABEL="app\.cc-theme\.mac-claude\.app"/);
assert.match(common, /INJECTOR_JOB_LABEL="app\.cc-theme\.mac-claude\.injector"/);
assert.equal(common.includes(retiredNamespace), false, "retired namespace must not be shipped as a literal");
for (const needle of [
  "legacy_cc_theme_job_label()",
  "remove_legacy_injector_launchd_job()",
  "remove_legacy_claude_launchd_job()",
  "cleanup_legacy_launchd_jobs()",
  "'com' 'openai' 'cc-theme-studio'",
]) {
  assert.ok(common.includes(needle), `missing safe legacy cleanup contract: ${needle}`);
}

for (const script of [
  "scripts/install-skin-macos.sh",
  "scripts/start-skin-macos.sh",
  "scripts/pause-skin-macos.sh",
  "scripts/restore-skin-macos.sh",
]) {
  assert.ok((await read(script)).includes("cleanup_legacy_launchd_jobs"), `${script} does not clean legacy jobs`);
}

console.log("PASS: launchd jobs use the CC Theme namespace and all lifecycle paths clean retired submit labels.");
