import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDiagnosticPreviewBundle } from "./injector.mjs";
import { saveStyleOverrides } from "./theme-style-overrides.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_MOTION_BYTES = 32 * 1024 * 1024;
const STYLE_EDITOR_BINDING = "__ccThemeSaveStyleOverrides";

function parseArgs(argv) {
  const options = {
    themeDir: null,
    stateFile: null,
    readyFile: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--theme-dir") options.themeDir = path.resolve(argv[++index]);
    else if (argument === "--state-file") options.stateFile = path.resolve(argv[++index]);
    else if (argument === "--ready-file") options.readyFile = path.resolve(argv[++index]);
    else throw new Error(`Unknown diagnostic preview server argument: ${argument}`);
  }
  if (!options.themeDir || !options.stateFile || !options.readyFile) {
    throw new Error("--theme-dir, --state-file and --ready-file are required");
  }
  return options;
}

function isLoopback(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function atomicPrivateJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function readStableMotion(file, expectedStat) {
  if (!file || !expectedStat) return null;
  let handle;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_MOTION_BYTES ||
        before.dev !== expectedStat.dev || before.ino !== expectedStat.ino ||
        before.size !== expectedStat.size || before.mtimeMs !== expectedStat.mtimeMs) {
      throw new Error("Diagnostic motion fallback changed before it was served");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || bytes.length !== before.size) {
      throw new Error("Diagnostic motion fallback changed while it was served");
    }
    return bytes;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readRequestJson(request, limit = MAX_REQUEST_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("Diagnostic preview request is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response, statusCode, body, contentType = "application/json; charset=utf-8") {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": bytes.length,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Private-Network": "true",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(bytes);
}

function json(response, statusCode, value) {
  send(response, statusCode, JSON.stringify(value));
}

function exactObjectKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function validReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set(["kind", "schemaVersion", "status", "pass", "revision", "themeId", "sourceKind", "landmarks", "owned"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  if (value.kind !== "cc-theme.diagnostic-preview-receipt" || value.schemaVersion !== 1 ||
      typeof value.pass !== "boolean" || !["connected", "failed"].includes(value.status) ||
      typeof value.revision !== "string" || !/^[a-f0-9]{20}$/.test(value.revision) ||
      typeof value.themeId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value.themeId) ||
      value.sourceKind !== "user-confirmed-devtools") return false;
  if (!exactObjectKeys(value.landmarks, ["main", "sidebar", "composer", "settings"]) ||
      Object.values(value.landmarks).some((entry) => typeof entry !== "boolean")) return false;
  if (!exactObjectKeys(value.owned, ["style", "settingsNav", "settingsPage", "editor", "media"]) ||
      Object.values(value.owned).some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 1)) return false;
  return true;
}

function diagnosticBootstrap(bundle, baseUrl) {
  const base = JSON.stringify(baseUrl);
  const themeId = JSON.stringify(String(bundle.theme.id));
  const revision = JSON.stringify(bundle.revision);
  const editorBinding = JSON.stringify(STYLE_EDITOR_BINDING);
  return `(() => {
    const base = ${base};
    const previewRevision = ${revision};
    const previewThemeId = ${themeId};
    const post = async (route, value) => {
      const response = await fetch(base + route, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Diagnostic preview bridge failed");
      return result;
    };
    window[${editorBinding}] = (raw) => {
      let request;
      try { request = JSON.parse(raw); }
      catch { return; }
      void post("/style-overrides", request).then((result) => {
        window.__CC_THEME_EDITOR_RESULT__?.(result.requestId, result);
      }).catch(() => {
        window.__CC_THEME_EDITOR_RESULT__?.(request.requestId || "unknown", { ok: false });
      });
    };
    ${bundle.payload};
    const state = window.__CC_THEME_STATE__;
    if (!state || state.themeId !== previewThemeId) throw new Error("CC Theme diagnostic payload did not install");
    const root = document.documentElement;
    root.setAttribute("data-skin-source-kind", "user-confirmed-devtools");
    root.setAttribute("data-skin-generation", previewRevision);
    const receipt = () => {
      const current = window.__CC_THEME_STATE__;
      const landmarks = {
        main: Boolean(document.querySelector("main.dframe-content")),
        sidebar: Boolean(document.querySelector("aside.dframe-sidebar")),
        composer: Boolean(document.querySelector('[data-testid="chat-input"]')),
        settings: Boolean(document.querySelector('[role="dialog"] > nav.flex.w-48.shrink-0.flex-col')),
      };
      const owned = {
        style: Number(Boolean(document.getElementById("cc-theme-style"))),
        settingsNav: Number(Boolean(document.getElementById("cc-theme-settings-nav-item"))),
        settingsPage: Number(Boolean(document.getElementById("cc-theme-settings-page"))),
        editor: Number(Boolean(document.getElementById("cc-theme-style-editor"))),
        media: Number(Boolean(document.getElementById("cc-theme-video-layer"))),
      };
      const pass = Boolean(current && owned.style === 1 && (landmarks.settings || (landmarks.main && landmarks.sidebar)));
      return post("/receipt", {
        kind: "cc-theme.diagnostic-preview-receipt",
        schemaVersion: 1,
        status: pass ? "connected" : "failed",
        pass,
        revision: previewRevision,
        themeId: previewThemeId,
        sourceKind: "user-confirmed-devtools",
        landmarks,
        owned,
      }).catch(() => null);
    };
    let reportTimer = setInterval(receipt, 1500);
    const originalCleanup = state.cleanup.bind(state);
    state.cleanup = () => {
      if (reportTimer) clearInterval(reportTimer);
      reportTimer = null;
      delete window[${editorBinding}];
      delete window.__CC_THEME_DIAGNOSTIC_PREVIEW__;
      return originalCleanup();
    };
    window.__CC_THEME_DIAGNOSTIC_PREVIEW__ = {
      kind: "cc-theme.diagnostic-preview-session",
      schemaVersion: 1,
      sourceKind: "user-confirmed-devtools",
      persistence: "renderer-session",
      revision: previewRevision,
      themeId: previewThemeId,
      report: receipt,
      cleanup: state.cleanup,
    };
    void (async () => {
      if (typeof state.setDeferredMotionFallbackSource === "function") {
        const response = await fetch(base + "/motion", { cache: "no-store" });
        if (response.ok) {
          const source = URL.createObjectURL(await response.blob());
          if (state.setDeferredMotionFallbackSource(source, previewThemeId) !== true) URL.revokeObjectURL(source);
        }
      }
      await receipt();
    })().catch(() => { void receipt(); });
    return {
      installed: true,
      sourceKind: "user-confirmed-devtools",
      persistence: "renderer-session",
      themeId: previewThemeId,
      revision: previewRevision,
    };
  })()`;
}

export async function startDiagnosticPreviewServer(options) {
  const bundle = await buildDiagnosticPreviewBundle(options.themeDir);
  const token = randomBytes(24).toString("hex");
  const sessionId = randomBytes(12).toString("hex");
  const startedAt = new Date().toISOString();
  let state = {
    kind: "cc-theme.diagnostic-preview-result",
    schemaVersion: 1,
    adapterId: "mac-claude",
    operation: "prepare",
    status: "starting",
    pass: false,
    code: "diagnostic-preview-server-unavailable",
    runtimeApplyAvailable: false,
    diagnosticPreviewAvailable: true,
    mode: "user-confirmed-devtools",
    persistence: "renderer-session",
    requiresUserAction: true,
    themeId: bundle.theme.id,
    revision: bundle.revision,
    sessionId,
    serverPid: process.pid,
    startedAt,
    privacy: "structure-only-no-user-content",
  };
  let writeChain = Promise.resolve();
  const updateState = (patch) => {
    state = { ...state, ...patch, updatedAt: new Date().toISOString() };
    writeChain = writeChain.then(() => atomicPrivateJson(options.stateFile, state));
    return writeChain;
  };
  let motionBytes = null;
  let saveChain = Promise.resolve();
  let latestRevision = 0;
  const server = createServer(async (request, response) => {
    try {
      if (!isLoopback(request.socket.remoteAddress)) {
        json(response, 403, { ok: false, message: "Loopback access only" });
        return;
      }
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const prefix = `/${token}`;
      if (!requestUrl.pathname.startsWith(prefix)) {
        json(response, 404, { ok: false, message: "Not found" });
        return;
      }
      const route = requestUrl.pathname.slice(prefix.length) || "/";
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Private-Network": "true",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Cache-Control": "no-store",
        });
        response.end();
        return;
      }
      if (request.method === "GET" && route === "/bootstrap.js") {
        const baseUrl = `http://127.0.0.1:${server.address().port}/${token}`;
        send(response, 200, diagnosticBootstrap(bundle, baseUrl), "application/javascript; charset=utf-8");
        return;
      }
      if (request.method === "GET" && route === "/motion") {
        if (!bundle.motionFallbackPath || !bundle.motionFallbackStat) {
          json(response, 404, { ok: false, message: "No motion fallback" });
          return;
        }
        motionBytes ??= await readStableMotion(bundle.motionFallbackPath, bundle.motionFallbackStat);
        send(response, 200, motionBytes, "image/gif");
        return;
      }
      if (request.method === "POST" && route === "/receipt") {
        const receipt = await readRequestJson(request, 16 * 1024);
        if (!validReceipt(receipt) || receipt.revision !== bundle.revision || receipt.themeId !== bundle.theme.id) {
          await updateState({ status: "failed", pass: false, code: "diagnostic-preview-renderer-receipt-invalid" });
          json(response, 400, { ok: false, message: "Invalid structural receipt" });
          return;
        }
        await updateState({
          status: receipt.pass ? "connected" : "failed",
          pass: receipt.pass,
          code: receipt.pass ? "diagnostic-preview-connected" : "diagnostic-preview-renderer-receipt-invalid",
          receipt,
          connectedAt: receipt.pass ? new Date().toISOString() : null,
        });
        json(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && route === "/style-overrides") {
        const message = await readRequestJson(request);
        const requestId = typeof message?.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)
          ? message.requestId : "unknown";
        if (!Number.isSafeInteger(message?.revision) || message.revision < 1 ||
            message.nonce !== bundle.editorNonce || message.themeId !== bundle.theme.id) {
          json(response, 400, { ok: false, requestId, message: "Stale or invalid diagnostic editor request" });
          return;
        }
        latestRevision = Math.max(latestRevision, message.revision);
        const task = saveChain.then(async () => {
          if (message.revision < latestRevision) {
            return {
              ok: false,
              superseded: true,
              requestId,
              revision: message.revision,
              values: bundle.styleOverrides,
              preferences: bundle.runtimePreferences,
            };
          }
          const saved = await saveStyleOverrides(bundle.theme, bundle.styleCatalog, message.values, {
            preferences: message.preferences,
          });
          bundle.styleOverrides = saved.values;
          bundle.runtimePreferences = saved.preferences;
          await updateState({ persistedEditorRevision: message.revision });
          return {
            ok: true,
            requestId,
            revision: message.revision,
            values: saved.values,
            preferences: saved.preferences,
          };
        });
        saveChain = task.catch(() => {});
        try {
          json(response, 200, await task);
        } catch (error) {
          json(response, 400, {
            ok: false,
            requestId,
            revision: message.revision,
            values: bundle.styleOverrides,
            preferences: bundle.runtimePreferences,
            message: error.message,
          });
        }
        return;
      }
      json(response, 404, { ok: false, message: "Not found" });
    } catch (error) {
      json(response, 400, { ok: false, message: String(error.message || error).slice(0, 300) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const bootstrapUrl = `http://127.0.0.1:${port}/${token}/bootstrap.js`;
  // Fetching is allowed by Claude's diagnostic renderer, but evaluating a
  // fetched string inside the page is correctly blocked by its CSP.  The
  // supported user-confirmed flow therefore copies the fixed Adapter script
  // and asks the user to paste it back into the DevTools Console, where the
  // Console performs the explicit Runtime evaluation without weakening CSP.
  const copyScript = `copy(await (await fetch(${JSON.stringify(bootstrapUrl)}, {cache:"no-store"})).text())`;
  await updateState({
    status: "awaiting-user-action",
    pass: true,
    code: "diagnostic-preview-awaiting-user-action",
    port,
    userAction: {
      kind: "copy-bootstrap-then-paste-in-claude-devtools-console",
      step1Script: copyScript,
      step2: "paste-clipboard-and-run",
      clipboardSourceUrl: bootstrapUrl,
    },
  });
  await atomicPrivateJson(options.readyFile, { ready: true, port, sessionId });

  const stop = async () => {
    await updateState({ status: "stopped", pass: true, code: "diagnostic-preview-stopped", stoppedAt: new Date().toISOString() }).catch(() => {});
    await writeChain.catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.once("SIGTERM", () => { void stop(); });
  process.once("SIGINT", () => { void stop(); });
  return { server, state: () => state, bundle };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startDiagnosticPreviewServer(parseArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`[cc-theme-diagnostic-preview] ${error.message}\n`);
    process.exitCode = 1;
  });
}
