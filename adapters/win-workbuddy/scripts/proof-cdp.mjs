#!/usr/bin/env node

const ADAPTER_ID = "win-workbuddy-skin";
const CLIENT_VERSION = "5.2.6";
const PROOF_ID = "win-workbuddy-proof-canary";
const RUNTIME_MARKER = "win-workbuddy-proof-v1";
const STYLE_ID = "cc-theme-win-proof-style";
const BADGE_ID = "cc-theme-win-proof-marker";
const SNAPSHOT_KEY = "__CC_THEME_WIN_PROOF_SNAPSHOT_V1__";
const OPERATIONS = new Set(["preflight", "apply", "verify", "pause", "restore"]);

function boundedResult(operation, ok, code, details = {}) {
  return {
    kind: "cc-theme.win-workbuddy-proof-result",
    schemaVersion: 1,
    adapterId: ADAPTER_ID,
    operation,
    ok,
    code,
    details,
  };
}

function parseArguments(argv) {
  const [operation, ...rest] = argv;
  if (!OPERATIONS.has(operation)) throw new Error("operation-invalid");
  let port = 9223;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] !== "--port" || index + 1 >= rest.length) throw new Error("argument-invalid");
    port = Number(rest[index + 1]);
    index += 1;
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("port-invalid");
  return { operation, port };
}

async function fetchJson(url, timeoutMs = 3000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  if (!response.ok) throw new Error("cdp-http-failed");
  return response.json();
}

function safeWebSocketUrl(rawUrl, port) {
  const url = new URL(rawUrl);
  if (url.protocol !== "ws:") throw new Error("cdp-websocket-scheme-invalid");
  if (!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname)) {
    throw new Error("cdp-websocket-not-loopback");
  }
  url.hostname = "127.0.0.1";
  url.port = String(port);
  return url.toString();
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("cdp-websocket-timeout")), 3000);
      this.socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("cdp-websocket-failed"));
      }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error("cdp-command-failed"));
      else resolve(message.result);
    });
  }

  command(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("cdp-command-timeout"));
      }, 3000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error("renderer-evaluation-failed");
  return result.result?.value;
}

const IDENTITY_EXPRESSION = `(() => ({
  title: document.title,
  applicationName: document.body?.getAttribute("data-application-name"),
  electronDesktop: document.body?.getAttribute("data-electron-desktop"),
  platform: document.body?.getAttribute("data-platform"),
  productVersion: document.body?.getAttribute("data-product-version"),
  rootCount: document.querySelectorAll("#root").length
}))()`;

const APPLY_EXPRESSION = `(() => {
  const names = ["data-cc-theme-runtime", "data-cc-theme-id", "data-cc-theme-revision", "data-cc-theme-state"];
  const body = document.body;
  const runtime = body.getAttribute("data-cc-theme-runtime");
  const currentStyle = document.getElementById(${JSON.stringify(STYLE_ID)});
  const currentBadge = document.getElementById(${JSON.stringify(BADGE_ID)});
  const snapshot = window[${JSON.stringify(SNAPSHOT_KEY)}];
  if (runtime === ${JSON.stringify(RUNTIME_MARKER)} && body.getAttribute("data-cc-theme-state") === "applied"
    && body.getAttribute("data-cc-theme-id") === ${JSON.stringify(PROOF_ID)}
    && body.getAttribute("data-cc-theme-revision") === "1" && currentStyle && currentBadge && snapshot) {
    return { ok: true, changed: false };
  }
  if (runtime !== ${JSON.stringify(RUNTIME_MARKER)}
    && (currentStyle || currentBadge || names.some((name) => body.hasAttribute(name)))) {
    return { ok: false, code: "proof-marker-collision" };
  }
  if (runtime === ${JSON.stringify(RUNTIME_MARKER)} && !snapshot) {
    return { ok: false, code: "proof-snapshot-missing" };
  }
  if (!snapshot) {
    window[${JSON.stringify(SNAPSHOT_KEY)}] = {
      attributes: Object.fromEntries(names.map((name) => [name, body.getAttribute(name)]))
    };
  }
  try {
    currentStyle?.remove();
    currentBadge?.remove();
    const style = document.createElement("style");
    style.id = ${JSON.stringify(STYLE_ID)};
    style.textContent = ` + "`" + `
    body[data-application-name="workbuddy"][data-platform="windows"] {
      box-shadow: inset 0 0 0 4px #ff2da8 !important;
    }
    #${BADGE_ID} {
      position: fixed; top: 44px; right: 14px; z-index: 2147483647;
      padding: 8px 12px; border: 2px solid #ff2da8; border-radius: 999px;
      color: #ffffff; background: #17142b; font: 600 12px/1.2 system-ui;
      box-shadow: 0 8px 24px rgba(0,0,0,.28); pointer-events: none;
    }
    ` + "`" + `;
    const badge = document.createElement("div");
    badge.id = ${JSON.stringify(BADGE_ID)};
    badge.textContent = "CC Theme · Windows proof";
    document.head.append(style);
    body.append(badge);
    body.setAttribute("data-cc-theme-runtime", ${JSON.stringify(RUNTIME_MARKER)});
    body.setAttribute("data-cc-theme-id", ${JSON.stringify(PROOF_ID)});
    body.setAttribute("data-cc-theme-revision", "1");
    body.setAttribute("data-cc-theme-state", "applied");
    return { ok: true, changed: true };
  } catch (error) {
    document.getElementById(${JSON.stringify(STYLE_ID)})?.remove();
    document.getElementById(${JSON.stringify(BADGE_ID)})?.remove();
    const original = window[${JSON.stringify(SNAPSHOT_KEY)}];
    for (const name of names) {
      const value = original?.attributes?.[name] ?? null;
      if (value === null) body.removeAttribute(name); else body.setAttribute(name, value);
    }
    delete window[${JSON.stringify(SNAPSHOT_KEY)}];
    return { ok: false, code: "proof-apply-rolled-back" };
  }
})()`;

const PAUSE_EXPRESSION = `(() => {
  const body = document.body;
  if (body.getAttribute("data-cc-theme-runtime") !== ${JSON.stringify(RUNTIME_MARKER)}) {
    return { ok: false, code: "proof-runtime-mismatch" };
  }
  if (!window[${JSON.stringify(SNAPSHOT_KEY)}]) return { ok: false, code: "proof-snapshot-missing" };
  const badge = document.getElementById(${JSON.stringify(BADGE_ID)});
  if (body.getAttribute("data-cc-theme-state") === "paused"
    && !document.getElementById(${JSON.stringify(STYLE_ID)}) && badge?.textContent === "CC Theme paused") {
    return { ok: true, changed: false };
  }
  if (!badge) return { ok: false, code: "proof-marker-missing" };
  const style = document.getElementById(${JSON.stringify(STYLE_ID)});
  const before = {
    state: body.getAttribute("data-cc-theme-state"),
    badgeText: badge.textContent,
    badgeStyle: badge.getAttribute("style"),
    styleText: style?.textContent ?? null
  };
  try {
    style?.remove();
    badge.textContent = "CC Theme paused";
    badge.setAttribute("style", "position:fixed;top:44px;right:14px;z-index:2147483647;padding:8px 12px;border:1px solid #777;border-radius:999px;color:#fff;background:#333;font:600 12px/1.2 system-ui;pointer-events:none");
    body.setAttribute("data-cc-theme-state", "paused");
    return { ok: true, changed: true };
  } catch (error) {
    if (before.styleText !== null && !document.getElementById(${JSON.stringify(STYLE_ID)})) {
      const restored = document.createElement("style");
      restored.id = ${JSON.stringify(STYLE_ID)};
      restored.textContent = before.styleText;
      document.head.append(restored);
    }
    badge.textContent = before.badgeText;
    if (before.badgeStyle === null) badge.removeAttribute("style"); else badge.setAttribute("style", before.badgeStyle);
    if (before.state === null) body.removeAttribute("data-cc-theme-state"); else body.setAttribute("data-cc-theme-state", before.state);
    return { ok: false, code: "proof-pause-rolled-back" };
  }
})()`;

const RESTORE_EXPRESSION = `(() => {
  const names = ["data-cc-theme-runtime", "data-cc-theme-id", "data-cc-theme-revision", "data-cc-theme-state"];
  const body = document.body;
  const runtime = body.getAttribute("data-cc-theme-runtime");
  const snapshot = window[${JSON.stringify(SNAPSHOT_KEY)}];
  const style = document.getElementById(${JSON.stringify(STYLE_ID)});
  const badge = document.getElementById(${JSON.stringify(BADGE_ID)});
  if (runtime === null && !snapshot && !style && !badge) return { ok: true, changed: false };
  if (runtime !== ${JSON.stringify(RUNTIME_MARKER)}) return { ok: false, code: "proof-runtime-mismatch" };
  if (!snapshot) return { ok: false, code: "proof-snapshot-missing" };
  document.getElementById(${JSON.stringify(STYLE_ID)})?.remove();
  document.getElementById(${JSON.stringify(BADGE_ID)})?.remove();
  for (const name of names) {
    const value = snapshot.attributes[name];
    if (value === null) body.removeAttribute(name); else body.setAttribute(name, value);
  }
  delete window[${JSON.stringify(SNAPSHOT_KEY)}];
  return { ok: true, changed: true };
})()`;

const PREFLIGHT_EXPRESSION = `(() => {
  const names = ["data-cc-theme-runtime", "data-cc-theme-id", "data-cc-theme-revision", "data-cc-theme-state"];
  const runtime = document.body.getAttribute("data-cc-theme-runtime");
  const owned = runtime === ${JSON.stringify(RUNTIME_MARKER)};
  const collision = !owned && (names.some((name) => document.body.hasAttribute(name))
    || document.getElementById(${JSON.stringify(STYLE_ID)})
    || document.getElementById(${JSON.stringify(BADGE_ID)}));
  return { ok: !collision, code: collision ? "proof-marker-collision" : "ok" };
})()`;

const VERIFY_EXPRESSION = `(() => ({
  runtime: document.body?.getAttribute("data-cc-theme-runtime"),
  themeId: document.body?.getAttribute("data-cc-theme-id"),
  revision: document.body?.getAttribute("data-cc-theme-revision"),
  state: document.body?.getAttribute("data-cc-theme-state"),
  stylePresent: Boolean(document.getElementById(${JSON.stringify(STYLE_ID)})),
  markerPresent: Boolean(document.getElementById(${JSON.stringify(BADGE_ID)}))
}))()`;

function identityMatches(identity) {
  return identity?.title === "WorkBuddy"
    && identity.applicationName === "workbuddy"
    && identity.electronDesktop === "true"
    && identity.platform === "windows"
    && identity.productVersion === CLIENT_VERSION
    && identity.rootCount === 1;
}

async function findTarget(port) {
  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  const pages = targets.filter((target) => target.type === "page"
    && typeof target.url === "string"
    && target.url.toLowerCase().replaceAll("\\", "/").endsWith("/resources/app.asar/renderer/index.html")
    && typeof target.webSocketDebuggerUrl === "string");
  const matches = [];
  for (const page of pages) {
    const client = new CdpClient(safeWebSocketUrl(page.webSocketDebuggerUrl, port));
    try {
      await client.open();
      await client.command("Runtime.enable");
      const identity = await evaluate(client, IDENTITY_EXPRESSION);
      if (identityMatches(identity)) matches.push({ client, identity });
      else client.close();
    } catch {
      client.close();
    }
  }
  if (matches.length !== 1) {
    for (const match of matches) match.client.close();
    throw new Error(matches.length === 0 ? "renderer-target-not-found" : "renderer-target-ambiguous");
  }
  return matches[0];
}

async function main() {
  let operation = "unknown";
  try {
    const parsed = parseArguments(process.argv.slice(2));
    operation = parsed.operation;
    const { client, identity } = await findTarget(parsed.port);
    try {
      const mutation = operation === "apply"
        ? await evaluate(client, APPLY_EXPRESSION)
        : operation === "pause"
          ? await evaluate(client, PAUSE_EXPRESSION)
          : operation === "restore"
            ? await evaluate(client, RESTORE_EXPRESSION)
            : operation === "preflight"
              ? await evaluate(client, PREFLIGHT_EXPRESSION)
              : { ok: true };
      if (mutation?.ok === false) throw new Error(mutation.code);
      const marker = await evaluate(client, VERIFY_EXPRESSION);
      const expected = operation === "restore"
        ? !marker.runtime && !marker.stylePresent && !marker.markerPresent
        : operation === "pause"
          ? marker.runtime === RUNTIME_MARKER && marker.themeId === PROOF_ID && marker.revision === "1"
            && marker.state === "paused" && !marker.stylePresent && marker.markerPresent
          : operation === "apply" || operation === "verify"
            ? marker.runtime === RUNTIME_MARKER && marker.themeId === PROOF_ID && marker.revision === "1"
              && marker.state === "applied" && marker.stylePresent && marker.markerPresent
            : true;
      if (!expected) throw new Error("proof-marker-mismatch");
      process.stdout.write(`${JSON.stringify(boundedResult(operation, true, "ok", {
        clientVersion: identity.productVersion,
        targetIdentity: "workbuddy-windows-main-renderer",
        markerState: operation === "preflight" ? "not-checked" : marker.state ?? "absent",
      }))}\n`);
    } finally {
      client.close();
    }
  } catch (error) {
    const code = /^[a-z][a-z0-9-]{1,79}$/.test(error?.message) ? error.message : "proof-operation-failed";
    process.stdout.write(`${JSON.stringify(boundedResult(operation, false, code, {}))}\n`);
    process.exitCode = 1;
  }
}

await main();
