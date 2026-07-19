import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const manager = path.join(root, "scripts", "launcher-app-macos.sh");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-launcher-test-"));

try {
  const home = path.join(temporary, "home");
  const engine = path.join(temporary, "engine root");
  const startScript = path.join(engine, "scripts", "start-skin-macos.sh");
  const output = path.join(temporary, "CC Theme.app");
  await fs.mkdir(path.dirname(startScript), { recursive: true });
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(path.join(engine, "VERSION"), "1.22209.3\n");
  await fs.writeFile(startScript, `#!/bin/bash\n/usr/bin/printf '%s\\n' "$@" > "$HOME/launcher-args.txt"\n`);
  await fs.chmod(startScript, 0o755);

  const install = [
    "install", "--output", output, "--engine-root", engine,
    "--port", "9450",
  ];
  await execFile(manager, install, { env: { ...process.env, HOME: home } });
  await execFile(manager, ["validate", "--output", output], { env: { ...process.env, HOME: home } });

  const plist = await fs.readFile(path.join(output, "Contents", "Info.plist"), "utf8");
  assert.match(plist, /<string>app\.cc-theme\.launcher<\/string>/);
  assert.match(plist, /<string>cc-theme-launcher<\/string>/);
  assert.match(plist, /<key>LSArchitecturePriority<\/key>/);
  assert.equal((await fs.readFile(path.join(output, "Contents", "Resources", "CCThemeLauncher.marker"), "utf8")).startsWith("kind=cc-theme-launcher\n"), true);
  await assert.rejects(fs.stat(path.join(output, "Contents", "Resources", "AppIcon.icns")), (error) => error?.code === "ENOENT");
  await execFile("/usr/bin/codesign", ["--verify", "--deep", "--strict", output]);

  const executable = path.join(output, "Contents", "MacOS", "cc-theme-launcher");
  const launcherSource = await fs.readFile(executable, "utf8");
  assert.match(launcherSource, /START_RUNNER=\(\/usr\/bin\/arch -arm64 \/bin\/bash\)/);
  assert.match(launcherSource, /FAILURE_DETAIL=/);
  assert.match(launcherSource, /已停止主题加载并保留客户端原始外观/);
  await execFile(executable, [], {
    env: { ...process.env, HOME: home, CC_THEME_LAUNCHER_SKIP_ACTIVATE: "true" },
  });
  assert.deepEqual((await fs.readFile(path.join(home, "launcher-args.txt"), "utf8")).trim().split("\n"), [
    "--port", "9450", "--prompt-restart",
  ]);

  await execFile(manager, install, { env: { ...process.env, HOME: home } });
  await execFile(manager, ["remove", "--output", output], { env: { ...process.env, HOME: home } });
  await assert.rejects(fs.stat(output), /ENOENT/);

  await fs.mkdir(output);
  await assert.rejects(execFile(manager, ["remove", "--output", output], {
    env: { ...process.env, HOME: home },
  }), /Refusing to remove an unrelated app/);

  console.log("PASS: the local CC Theme.app launcher installs atomically, validates, launches without Terminal, and preserves unrelated apps.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
