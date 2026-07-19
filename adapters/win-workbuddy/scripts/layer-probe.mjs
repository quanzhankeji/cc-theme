#!/usr/bin/env node

const CLIENT_VERSION = "5.2.6";

function fail(code) {
  throw new Error(code);
}

function parseArguments(argv) {
  let port = 9223;
  let mode = "layer";
  for (let index = 0; index < argv.length; index += 2) {
    if (argv[index + 1] === undefined) fail("argument-invalid");
    if (argv[index] === "--port") port = Number(argv[index + 1]);
    else if (argv[index] === "--mode") mode = argv[index + 1];
    else fail("argument-invalid");
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail("port-invalid");
  if (!new Set(["layer", "settings"]).has(mode)) fail("probe-mode-invalid");
  return { port, mode };
}

async function fetchJson(url, timeoutMs = 3000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  if (!response.ok) fail("cdp-http-failed");
  return response.json();
}

function safeWebSocketUrl(rawUrl, port) {
  const url = new URL(rawUrl);
  if (url.protocol !== "ws:") fail("cdp-websocket-scheme-invalid");
  if (!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname)) fail("cdp-websocket-not-loopback");
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
    await new Promise((resolveOpen, rejectOpen) => {
      const timeout = setTimeout(() => rejectOpen(new Error("cdp-websocket-timeout")), 5000);
      this.socket.addEventListener("open", () => { clearTimeout(timeout); resolveOpen(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timeout); rejectOpen(new Error("cdp-websocket-failed")); }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error("cdp-command-failed"));
      else pending.resolve(message.result);
    });
  }

  command(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveCommand, rejectCommand) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectCommand(new Error("cdp-command-timeout"));
      }, 10000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolveCommand(value); },
        reject: (error) => { clearTimeout(timeout); rejectCommand(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) fail("renderer-evaluation-failed");
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

const PROBE_EXPRESSION = `(() => {
  const target = { x: 264, y: 30, width: 936, height: 771 };
  const cleanTokens = (value) => String(value ?? "").split(/\\s+/).filter(Boolean).slice(0, 12);
  const summarize = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: cleanTokens(element.className),
      parentClasses: cleanTokens(element.parentElement?.className),
      bounds: {
        x: Math.round(rect.x * 10) / 10,
        y: Math.round(rect.y * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10
      },
      computedBackground: {
        color: style.backgroundColor,
        imagePresent: style.backgroundImage !== "none"
      }
    };
  };
  const near = (left, right, tolerance = 3) => Math.abs(left - right) <= tolerance;
  const geometryMatches = [];
  const nodes = Array.from(document.querySelectorAll("body *")).slice(0, 6000);
  for (const element of nodes) {
    const rect = element.getBoundingClientRect();
    if (near(rect.x, target.x) && near(rect.y, target.y)
      && near(rect.width, target.width) && near(rect.height, target.height)) {
      geometryMatches.push(summarize(element));
      if (geometryMatches.length >= 16) break;
    }
  }
  const points = [
    { id: "main-center", x: 732, y: 415 },
    { id: "main-bottom-right", x: 1184, y: 785 },
    { id: "main-top-center", x: 732, y: 46 }
  ].map((point) => ({
    id: point.id,
    stack: document.elementsFromPoint(point.x, point.y).slice(0, 12).map(summarize)
  }));
  return {
    targetBounds: target,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scannedNodeCount: nodes.length,
    geometryMatches,
    points
  };
})()`;

const SETTINGS_PROBE_EXPRESSION = `(() => {
  const cleanTokens = (value) => String(value ?? "").split(/\\s+/).filter(Boolean).slice(0, 12);
  const knownState = (element, name) => {
    const value = element.getAttribute(name);
    return new Set(["true", "false", "page", "step", "location", "date", "time"]).has(value) ? value : null;
  };
  const summarize = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: cleanTokens(element.className),
      parentClasses: cleanTokens(element.parentElement?.className),
      grandparentClasses: cleanTokens(element.parentElement?.parentElement?.className),
      childElementCount: element.childElementCount,
      bounds: {
        x: Math.round(rect.x * 10) / 10,
        y: Math.round(rect.y * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10
      },
      semantics: {
        role: element.getAttribute("role"),
        tabIndex: element.tabIndex,
        disabled: element.matches(":disabled"),
        selected: knownState(element, "aria-selected"),
        checked: knownState(element, "aria-checked"),
        expanded: knownState(element, "aria-expanded"),
        current: knownState(element, "aria-current")
      },
      computed: {
        display: style.display,
        position: style.position,
        backgroundColor: style.backgroundColor,
        color: style.color,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        padding: style.padding,
        gap: style.gap,
        borderRadius: style.borderRadius,
        transitionDuration: style.transitionDuration,
        transitionProperty: style.transitionProperty,
        animationDuration: style.animationDuration,
        animationName: style.animationName,
        cursor: style.cursor
      }
    };
  };
  const nodes = Array.from(document.querySelectorAll("body *")).slice(0, 6000);
  const candidates = [];
  for (const element of nodes) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") continue;
    const classes = cleanTokens(element.className).join(" ");
    const role = element.getAttribute("role") ?? "";
    const structuralTag = new Set(["button", "nav", "aside", "main", "section", "header"]).has(element.tagName.toLowerCase());
    const structuralClass = /(setting|preference|sidebar|navigation|menu|panel|tab|item|content)/i.test(classes);
    const interactive = element.tabIndex >= 0 || /^(button|menuitem|tab|navigation|listbox|option|switch)$/.test(role);
    if (structuralTag || structuralClass || interactive) candidates.push(summarize(element));
    if (candidates.length >= 180) break;
  }
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scannedNodeCount: nodes.length,
    candidateCount: candidates.length,
    candidates
  };
})()`;

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
    fail(matches.length === 0 ? "renderer-target-not-found" : "renderer-target-ambiguous");
  }
  return matches[0];
}

const SAFE_TOKEN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const COLOR = /^(?:rgba?\([0-9., %]+\)|transparent)$/;

function cleanToken(value) {
  if (typeof value !== "string" || !SAFE_TOKEN.test(value)) return null;
  if (/[0-9a-f]{12,}/i.test(value) || /\d{6,}/.test(value)) return "present-redacted";
  return value;
}

function finiteBound(value) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 100000 ? value : 0;
}

function sanitizeElement(raw) {
  return {
    tag: typeof raw?.tag === "string" && /^[a-z][a-z0-9-]{0,23}$/.test(raw.tag) ? raw.tag : "unknown",
    id: raw?.id === null ? null : cleanToken(raw?.id) ?? "present-redacted",
    classes: Array.isArray(raw?.classes) ? raw.classes.map(cleanToken).filter(Boolean).slice(0, 12) : [],
    parentClasses: Array.isArray(raw?.parentClasses) ? raw.parentClasses.map(cleanToken).filter(Boolean).slice(0, 12) : [],
    bounds: {
      x: finiteBound(raw?.bounds?.x), y: finiteBound(raw?.bounds?.y),
      width: finiteBound(raw?.bounds?.width), height: finiteBound(raw?.bounds?.height),
    },
    computedBackground: {
      color: typeof raw?.computedBackground?.color === "string" && COLOR.test(raw.computedBackground.color)
        ? raw.computedBackground.color : "unavailable",
      imagePresent: raw?.computedBackground?.imagePresent === true,
    },
  };
}

function sanitizeProbe(raw) {
  const target = raw?.targetBounds ?? {};
  const viewport = raw?.viewport ?? {};
  return {
    targetBounds: {
      x: finiteBound(target.x), y: finiteBound(target.y),
      width: finiteBound(target.width), height: finiteBound(target.height),
    },
    viewport: { width: finiteBound(viewport.width), height: finiteBound(viewport.height) },
    scannedNodeCount: Number.isInteger(raw?.scannedNodeCount) ? Math.min(Math.max(raw.scannedNodeCount, 0), 6000) : 0,
    geometryMatches: Array.isArray(raw?.geometryMatches) ? raw.geometryMatches.slice(0, 16).map(sanitizeElement) : [],
    points: Array.isArray(raw?.points) ? raw.points.slice(0, 3).map((point) => ({
      id: new Set(["main-center", "main-bottom-right", "main-top-center"]).has(point?.id) ? point.id : "unknown",
      stack: Array.isArray(point?.stack) ? point.stack.slice(0, 12).map(sanitizeElement) : [],
    })) : [],
  };
}

const SAFE_CSS_VALUE = /^[A-Za-z0-9 #.,()%_'"-]{1,160}$/;

function safeCssValue(value) {
  return typeof value === "string" && SAFE_CSS_VALUE.test(value)
    && !/(?:url\s*\(|javascript|[A-Za-z]:\\|\/Users\/|\\\\)/i.test(value) ? value : "unavailable";
}

function sanitizeSettingsElement(raw) {
  const semantics = raw?.semantics ?? {};
  const computed = raw?.computed ?? {};
  const knownState = (value) => new Set(["true", "false", "page", "step", "location", "date", "time"]).has(value)
    ? value : null;
  return {
    tag: typeof raw?.tag === "string" && /^[a-z][a-z0-9-]{0,23}$/.test(raw.tag) ? raw.tag : "unknown",
    id: raw?.id === null ? null : cleanToken(raw?.id) ?? "present-redacted",
    classes: Array.isArray(raw?.classes) ? raw.classes.map(cleanToken).filter(Boolean).slice(0, 12) : [],
    parentClasses: Array.isArray(raw?.parentClasses) ? raw.parentClasses.map(cleanToken).filter(Boolean).slice(0, 12) : [],
    grandparentClasses: Array.isArray(raw?.grandparentClasses) ? raw.grandparentClasses.map(cleanToken).filter(Boolean).slice(0, 12) : [],
    childElementCount: Number.isInteger(raw?.childElementCount) ? Math.min(Math.max(raw.childElementCount, 0), 512) : 0,
    bounds: {
      x: finiteBound(raw?.bounds?.x), y: finiteBound(raw?.bounds?.y),
      width: finiteBound(raw?.bounds?.width), height: finiteBound(raw?.bounds?.height),
    },
    semantics: {
      role: cleanToken(semantics.role),
      tabIndex: Number.isInteger(semantics.tabIndex) && semantics.tabIndex >= -1 && semantics.tabIndex <= 32767
        ? semantics.tabIndex : -1,
      disabled: semantics.disabled === true,
      selected: knownState(semantics.selected),
      checked: knownState(semantics.checked),
      expanded: knownState(semantics.expanded),
      current: knownState(semantics.current),
    },
    computed: Object.fromEntries([
      "display", "position", "backgroundColor", "color", "fontFamily", "fontSize", "fontWeight",
      "padding", "gap", "borderRadius", "transitionDuration", "transitionProperty",
      "animationDuration", "animationName", "cursor",
    ].map((key) => [key, safeCssValue(computed[key])])),
  };
}

function sanitizeSettingsProbe(raw) {
  const viewport = raw?.viewport ?? {};
  return {
    viewport: { width: finiteBound(viewport.width), height: finiteBound(viewport.height) },
    scannedNodeCount: Number.isInteger(raw?.scannedNodeCount) ? Math.min(Math.max(raw.scannedNodeCount, 0), 6000) : 0,
    candidateCount: Number.isInteger(raw?.candidateCount) ? Math.min(Math.max(raw.candidateCount, 0), 180) : 0,
    candidates: Array.isArray(raw?.candidates) ? raw.candidates.slice(0, 180).map(sanitizeSettingsElement) : [],
  };
}

async function main() {
  let mode = "layer";
  try {
    const parsed = parseArguments(process.argv.slice(2));
    mode = parsed.mode;
    const { port } = parsed;
    const { client } = await findTarget(port);
    try {
      const probe = mode === "settings"
        ? sanitizeSettingsProbe(await evaluate(client, SETTINGS_PROBE_EXPRESSION))
        : sanitizeProbe(await evaluate(client, PROBE_EXPRESSION));
      process.stdout.write(`${JSON.stringify({
        kind: mode === "settings" ? "cc-theme.win-workbuddy-settings-structure-evidence" : "cc-theme.win-workbuddy-layer-evidence",
        schemaVersion: 1,
        adapterId: "win-workbuddy-skin",
        clientVersion: CLIENT_VERSION,
        classification: "vm-read-only",
        privacy: mode === "settings" ? "structure-semantics-and-computed-style-only" : "structure-and-computed-background-only",
        probe,
      })}\n`);
    } finally {
      client.close();
    }
  } catch (error) {
    const code = /^[a-z][a-z0-9-]{1,79}$/.test(error?.message) ? error.message : "read-only-probe-failed";
    process.stdout.write(`${JSON.stringify({
        kind: mode === "settings" ? "cc-theme.win-workbuddy-settings-structure-evidence" : "cc-theme.win-workbuddy-layer-evidence",
      schemaVersion: 1,
      adapterId: "win-workbuddy-skin",
      clientVersion: CLIENT_VERSION,
      classification: "unverified",
      ok: false,
      code,
    })}\n`);
    process.exitCode = 1;
  }
}

await main();
