import assert from "node:assert/strict";
import { earlyPayloadFor } from "../scripts/injector.mjs";

const payload = earlyPayloadFor("window.__TEST_APPLIED__ = true", "revision-1");
assert.match(payload, /const workbuddy = Boolean\(document\.body\)/);
assert.match(payload, /result\?\.installed !== true/,
  "early bootstrap must not mark an unverified host identity as installed");
assert.match(payload, /data-product-version/);
assert.match(payload, /__WORKBUDDY_SKIN_DISABLED__/);
assert.doesNotMatch(payload, /CODEX_SKIN/);
assert.doesNotMatch(payload, /pet|mascot|companion/i);

console.log("early-payload.test.mjs: ok");
