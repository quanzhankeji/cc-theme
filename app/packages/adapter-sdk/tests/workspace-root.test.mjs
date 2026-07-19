import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findWorkspaceRoot, resolveWorkspaceRoot } from "../workspace-root.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const expected = path.resolve(here, "../../../..");

test("workspace root resolves from nested Module, Adapter, and arbitrary cwd paths", () => {
  assert.equal(findWorkspaceRoot(here), expected);
  assert.equal(findWorkspaceRoot(path.join(expected, "adapters/mac-codex/tests")), expected);
  assert.equal(resolveWorkspaceRoot({ anchor: null, cwd: path.join(expected, "app/src") }), expected);
});

test("workspace root fails closed when no marker is present", () => {
  assert.throws(() => findWorkspaceRoot("/tmp/cc-theme-no-workspace/nested"), /marker not found/);
});
