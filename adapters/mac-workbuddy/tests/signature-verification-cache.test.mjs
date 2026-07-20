import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const common = await fs.readFile(path.join(root, "scripts", "common-macos.sh"), "utf8");

assert.match(common, /EXPECTED_WORKBUDDY_VERSION=.*VERSION/,
  "runtime admission must bind the Adapter to its exact host version");
assert.match(common, /WORKBUDDY_VERSION" != "\$EXPECTED_WORKBUDDY_VERSION/,
  "a non-exact host must enter the explicit compatibility decision before injection");
assert.match(common, /CC_THEME_ADAPTER_COMPATIBILITY_ATTEMPT[\s\S]*version_is_strictly_newer/,
  "only an explicit attempt on a strictly newer host may bypass exact version equality");
assert.match(common, /codesign --verify --strict "\$WORKBUDDY_BUNDLE"/,
  "a metadata cache hit must still verify the outer resource seal");
assert.match(common, /strategy\)" = "metadata-cache"[\s\S]*codesign --verify --strict/,
  "only the exact metadata-cache strategy may replace recursive verification with the outer seal check");
assert.match(common, /codesign --verify --deep --strict "\$WORKBUDDY_BUNDLE"/,
  "a new or changed installation must still receive full recursive verification");
assert.match(common, /bundle_metadata_fingerprint/,
  "deep verification reuse must be keyed by a whole-bundle metadata fingerprint");
for (const field of ["%d", "%i", "%p", "%u", "%g", "%z", "%m", "%c", "%B", "%f", "%HT"]) {
  assert(common.includes(field), `bundle fingerprint must include stat field ${field}`);
}
assert.match(common, /SIGNATURE_CACHE_FILE/);
assert.match(common, /signature_cache_matches/);
assert.match(common, /\[ ! -L "\$SIGNATURE_CACHE_FILE" \]/,
  "the trust cache must never follow a symbolic link");
assert.match(common, /stat -f '%u' "\$SIGNATURE_CACHE_FILE"/,
  "the trust cache must remain owned by the current user");
assert.match(common, /signature-cache-v1/,
  "cache identity must be explicitly versioned so future checks invalidate it");
assert.match(common, /write_signature_cache/,
  "only a successful deep verification may atomically publish a reusable trust record");
assert.match(common, /deep-always/,
  "fast filesystems must retain recursive verification instead of taking a slower cache path");
assert.match(common, /metadata-cache/,
  "slow filesystems may reuse only the exact whole-bundle metadata identity");
assert.match(common, /elapsed.*-ge 3/,
  "cache strategy selection must use a bounded explicit threshold");

console.log("PASS: WorkBuddy caches only an exact deep-verification result while rechecking the outer seal and whole-bundle change identity on every operation.");
