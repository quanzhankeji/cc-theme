import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Doubao lifecycle is CDP-only and exposes the Manager command surface", async () => {
  const names = [
    "start-skin-macos.sh",
    "switch-theme-macos.sh",
    "pause-skin-macos.sh",
    "restore-skin-macos.sh",
    "verify-skin-macos.sh",
    "status-skin-macos.sh",
    "doctor-macos.sh",
  ];
  const scripts = await Promise.all(names.map((name) => fs.readFile(path.join(root, "scripts", name), "utf8")));
  const common = await fs.readFile(path.join(root, "scripts/common-macos.sh"), "utf8");
  const combined = [common, ...scripts].join("\n");

  assert.match(common, /com\.bot\.pc\.doubao/);
  assert.match(combined, /remote-debugging-address=127\.0\.0\.1/);
  assert.match(combined, /remote-debugging-port/);
  assert.doesNotMatch(combined, /app\.asar|Contents\/Resources\/extensions\/obkcimipmjdkghadnfcjojepocldeggd/);
  assert.doesNotMatch(combined, /sudo\b/);
  assert.match(scripts[1], /--id/);
  assert.match(scripts[0], /apply_deadline=\$\(\(SECONDS \+ 20\)\)/);
  assert.match(scripts[0], /occupied by an untrusted process/);
  assert.match(scripts[0], /restore_native_runtime/);
  assert.match(scripts[2], /--remove/);
  assert.match(scripts[3], /restore_native_runtime/);
  assert.match(scripts[3], /relaunch=false/);
  assert.match(scripts[3], /verified_cdp_endpoint.*\|\| \[ -f "\$STATE_FILE" \].*relaunch=true/);
  assert.doesNotMatch(scripts[3], /\bkill\b/);
  assert.match(common, /wait_for_port_clear/);
  assert.match(common, /injector_owned_pids/);
  assert.match(common, /app\.cc-theme\.mac-doubao\.injector/);
  assert.match(common, /launchctl bootstrap/);
  assert.match(common, /launchctl bootout/);
  assert.match(common, /<key>KeepAlive<\/key><true\/>/);
  assert.match(common, /trusted_injector_running/);
  assert.doesNotMatch(common, /\/usr\/bin\/nohup/);
  assert.match(common, /CC_THEME_NODE_SHA256/);
  assert.match(common, /CC_THEME_MANAGER_BUNDLE/);
  assert.match(common, /Contents\/Resources\/runtime\/node\/bin\/node/);
  assert.match(common, /codesign --verify --deep --strict "\$manager"/);
  assert.match(common, /shasum -a 256/);
  assert.doesNotMatch(common, /ChatGPT\.app|cua_node|command -v node|\/opt\/homebrew\/bin\/node|\/usr\/local\/bin\/node/);
  assert.doesNotMatch(scripts[3], /discover_node/);
  assert.match(common, /if doubao_running \|\| \[ -n "\$\(doubao_owned_pids\)" \]; then stop_doubao; fi/);
  assert.match(common, /wait_for_port_clear "\$port" 8/);
  assert.match(common, /\/bin\/rm -f "\$STATE_FILE" "\$INJECTOR_PID_FILE"/);
  assert.match(common, /if \[ "\$relaunch" = "true" \]; then launch_doubao_normal; fi/);
});
