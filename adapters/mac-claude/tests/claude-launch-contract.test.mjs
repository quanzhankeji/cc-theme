import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [common, start] = await Promise.all([
  fs.readFile(path.join(root, "scripts/common-macos.sh"), "utf8"),
  fs.readFile(path.join(root, "scripts/start-skin-macos.sh"), "utf8"),
]);
assert.equal(common.includes("/usr/bin/open -na"), false, "Claude prohibits forced new LaunchServices instances");
assert.equal(start.includes("/usr/bin/open -na"), false, "activation must not force a second Claude instance");
assert.match(common, /\/usr\/bin\/open -a "\$CLAUDE_BUNDLE" --args/);
assert.match(common, /while ! claude_is_running/);
console.log("claude-launch-contract.test.mjs: ok");
