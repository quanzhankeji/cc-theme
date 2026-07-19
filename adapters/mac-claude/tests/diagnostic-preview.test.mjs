import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeDiagnosticPreview, validatePrepareRequest } from "../scripts/diagnostic-preview.mjs";
import { startDiagnosticPreviewServer } from "../scripts/diagnostic-preview-server.mjs";
import { createMinimalThemeDirectory } from "./fixtures/synthetic-media.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-claude-diagnostic-preview-"));
const previousHome = process.env.HOME;
process.env.HOME = path.join(temporary, "home");

try {
  const [contract, capability, manifest, startSource, commonSource] = await Promise.all([
    fs.readFile(path.join(root, "contracts", "diagnostic-preview-interface.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(root, "contracts", "adapter-capability.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(root, "PROJECT_MANIFEST.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(root, "scripts", "start-diagnostic-preview-macos.sh"), "utf8"),
    fs.readFile(path.join(root, "scripts", "common-macos.sh"), "utf8"),
  ]);
  assert.equal(contract.availability.mode, "user-confirmed-devtools");
  assert.equal(contract.availability.runtimeApplyAvailable, false);
  assert.equal(contract.availability.requiresUserAction, true);
  assert.equal(capability.availability.diagnosticPreviewAvailable, true);
  assert.equal(capability.availability.runtimeApplyAvailable, false);
  assert.equal(manifest.entrypoints.diagnosticPreview, "scripts/diagnostic-preview.mjs");
  assert.match(commonSource, /CLAUDE_DEV_TOOLS=detach/);
  assert.equal(startSource.includes("--remote-debugging-port"), false);
  assert.equal(startSource.includes("require_runtime_apply_available"), false);
  assert.match(startSource, /--user-confirmed/);
  assert.match(startSource, /\[ "\$RESTART_CLAUDE" = "true" \] \|\| fail "Diagnostic preview requires explicit permission to restart Claude\."/);
  assert(contract.result.diagnosticCodes.includes("diagnostic-preview-stopped"));

  assert.throws(() => validatePrepareRequest({ userConfirmed: false, restartClaude: true }), /must be true/);
  const calls = [];
  const prepared = await executeDiagnosticPreview("prepare", {
    userConfirmed: true, restartClaude: true,
  }, {
    run: async (script, args) => {
      calls.push({ script, args });
      return { stdout: JSON.stringify({ kind: "cc-theme.diagnostic-preview-result", status: "awaiting-user-action" }) };
    },
  });
  assert.equal(prepared.status, "awaiting-user-action");
  assert.deepEqual(calls[0], {
    script: "start-diagnostic-preview-macos.sh",
    args: ["--user-confirmed", "--restart-claude"],
  });

  const stateFile = path.join(temporary, "runtime", "state.json");
  const readyFile = path.join(temporary, "runtime", "ready.json");
  const themeDir = await createMinimalThemeDirectory(path.join(temporary, "active-theme"));
  const running = await startDiagnosticPreviewServer({
    themeDir,
    stateFile,
    readyFile,
  });
  try {
    const initial = JSON.parse(await fs.readFile(stateFile, "utf8"));
    assert.equal(initial.status, "awaiting-user-action");
    assert.equal(initial.runtimeApplyAvailable, false);
    assert.equal(initial.requiresUserAction, true);
    assert.equal((await fs.stat(stateFile)).mode & 0o777, 0o600);
    assert.equal(initial.userAction.kind, "copy-bootstrap-then-paste-in-claude-devtools-console");
    assert.equal(initial.userAction.step2, "paste-clipboard-and-run");
    assert.equal(initial.userAction.step1Script.includes("eval("), false);
    const match = initial.userAction.step1Script.match(/fetch\("([^"]+)"/);
    assert(match, "Manager result must contain a bounded DevTools bootstrap action");
    const bootstrapUrl = match[1];
    assert.equal(initial.userAction.clipboardSourceUrl, bootstrapUrl);
    const baseUrl = bootstrapUrl.slice(0, -"/bootstrap.js".length);
    const bootstrap = await fetch(bootstrapUrl).then((response) => response.text());
    assert.match(bootstrap, /user-confirmed-devtools/);
    assert.match(bootstrap, /cc-theme\.diagnostic-preview-receipt/);
    assert.equal(/document\.(?:body|documentElement)\.innerText|location\.(?:href|search|hash)/.test(bootstrap), false);

    const rejected = await fetch(`${baseUrl}/receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "cc-theme.diagnostic-preview-receipt", text: "forbidden" }),
    });
    assert.equal(rejected.status, 400);

    const nestedKeyRejected = await fetch(`${baseUrl}/receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "cc-theme.diagnostic-preview-receipt",
        schemaVersion: 1,
        status: "connected",
        pass: true,
        revision: running.bundle.revision,
        themeId: running.bundle.theme.id,
        sourceKind: "user-confirmed-devtools",
        landmarks: { main: true, sidebar: true, composer: true, settings: false, unexpectedField: true },
        owned: { style: 1, settingsNav: 0, settingsPage: 0, editor: 0, media: 1 },
      }),
    });
    assert.equal(nestedKeyRejected.status, 400);

    const receipt = {
      kind: "cc-theme.diagnostic-preview-receipt",
      schemaVersion: 1,
      status: "connected",
      pass: true,
      revision: running.bundle.revision,
      themeId: running.bundle.theme.id,
      sourceKind: "user-confirmed-devtools",
      landmarks: { main: true, sidebar: true, composer: true, settings: false },
      owned: { style: 1, settingsNav: 0, settingsPage: 0, editor: 0, media: 1 },
    };
    const accepted = await fetch(`${baseUrl}/receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(receipt),
    });
    assert.equal(accepted.status, 200);
    assert.equal(JSON.parse(await fs.readFile(stateFile, "utf8")).status, "connected");

    const colorToken = running.bundle.styleCatalog.tokens.find((token) => token.type === "color");
    assert(colorToken);
    const styleResult = await fetch(`${baseUrl}/style-overrides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: "r1",
        revision: 1,
        nonce: running.bundle.editorNonce,
        themeId: running.bundle.theme.id,
        values: { ...running.bundle.styleOverrides, [colorToken.id]: "#123456" },
        preferences: { backgroundPresentation: "playing", interactiveEffectEnabled: true },
      }),
    }).then((response) => response.json());
    assert.equal(styleResult.ok, true);
    const overrideFile = path.join(process.env.HOME, "Library", "Application Support", "CCTheme", "claude", "style-overrides", `${running.bundle.theme.id}.json`);
    const saved = JSON.parse(await fs.readFile(overrideFile, "utf8"));
    assert.equal(saved.values[colorToken.id], "#123456");
    assert.equal((await fs.stat(overrideFile)).mode & 0o777, 0o600);
  } finally {
    await new Promise((resolve) => running.server.close(resolve));
  }

  console.log("PASS: Manager can prepare a user-confirmed DevTools preview, receive privacy-safe connectivity, and persist allowlisted WYSIWYG overrides without enabling runtime apply.");
} finally {
  process.env.HOME = previousHome;
  await fs.rm(temporary, { recursive: true, force: true });
}
