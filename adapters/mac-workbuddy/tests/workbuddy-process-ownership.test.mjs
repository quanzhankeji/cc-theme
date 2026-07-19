import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-process-ownership-"));
const fakeBundle = "/Applications/NonexistentCCThemeWorkBuddy.app";
const fakeExecutable = `${fakeBundle}/Contents/MacOS/WorkBuddy`;

try {
  const { stdout } = await execFile("/bin/bash", ["-c", [
    '. "$1"',
    'WORKBUDDY_BUNDLE="$2"',
    'WORKBUDDY_EXECUTABLE="$3"',
    "workbuddy_pids",
  ].join("; "), "process-ownership", path.join(root, "scripts", "common-macos.sh"), fakeBundle, fakeExecutable], {
    env: { ...process.env, HOME: temporary },
  });
  assert.equal(stdout.trim(), "",
    "process discovery matched its own awk/command line merely because the executable path appeared as an argument");

  const common = await fs.readFile(path.join(root, "scripts", "common-macos.sh"), "utf8");
  assert.match(common, /ps -ww -axo pid=,ppid=,comm=/,
    "WorkBuddy ownership must come from the executable identity field, not UI names or the full command line");
  assert.match(common, /ppid == 1 && \$0 == executable/,
    "the UI main-process check must not confuse WorkBuddy child Electron processes with a newly launched host main process");
  assert.doesNotMatch(common, /ps -axo pid=,command=/);
  console.log("PASS: WorkBuddy main/residual process discovery uses the verified bundle executable field without self-matching command arguments.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
