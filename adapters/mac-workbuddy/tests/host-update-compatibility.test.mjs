import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const common = await fs.readFile(path.join(root, "scripts/common-macos.sh"), "utf8");

assert(common.includes("CC_THEME_ADAPTER_COMPATIBILITY_ATTEMPT"));
assert(common.includes("version_is_strictly_newer"));
assert.match(common, /runtime role discovery is required before theme state can commit/);
assert.match(common, /WORKBUDDY_VERSION.*!=.*EXPECTED_WORKBUDDY_VERSION/);

console.log("host-update-compatibility.test.mjs: ok");
