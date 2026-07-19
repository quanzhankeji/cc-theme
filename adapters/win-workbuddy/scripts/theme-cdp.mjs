#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectUnifiedTheme } from "../src/projector.mjs";
import { compileProofRuntimeStyle } from "../src/runtime-style-compiler.mjs";

const ADAPTER_ID = "win-workbuddy-skin";
const CLIENT_VERSION = "5.2.6";
const RUNTIME_MARKER = "win-workbuddy-theme-proof-v1";
const STYLE_ID = "cc-theme-win-runtime-style";
const BACKGROUND_ID = "cc-theme-win-runtime-background";
const MARKER_ID = "cc-theme-win-runtime-marker";
const SNAPSHOT_KEY = "__CC_THEME_WIN_RUNTIME_SNAPSHOT_V1__";
const OPERATIONS = new Set(["preflight", "apply", "verify", "pause", "restore"]);
const DEFAULT_THEME = fileURLToPath(new URL("../presets/xtxg/unified-theme.json", import.meta.url));
const SURFACE_CATALOG = fileURLToPath(new URL("../compatibility/workbuddy-windows/5.2.6/ui-surface-catalog.v1.json", import.meta.url));
const STYLE_CATALOG = fileURLToPath(new URL("../contracts/theme-style-catalog.v2.json", import.meta.url));

function fail(code) {
  throw new Error(code);
}

function boundedCode(error, fallback = "theme-operation-failed") {
  return /^[a-z][a-z0-9-]{1,79}$/.test(error?.message) ? error.message : fallback;
}

function boundedResult(operation, ok, code, details = {}, warnings = []) {
  return {
    kind: "cc-theme.win-workbuddy-theme-result",
    schemaVersion: 1,
    adapterId: ADAPTER_ID,
    operation,
    ok,
    code,
    runtimeCapabilityEnabled: false,
    details,
    warnings: [...new Set(warnings)].filter((warning) => /^[a-z][a-z0-9-]{1,79}$/.test(warning)).slice(0, 24),
  };
}

function parseArguments(argv) {
  const [operation, ...rest] = argv;
  if (!OPERATIONS.has(operation)) fail("operation-invalid");
  const parsed = { operation, port: 9223, themeFile: DEFAULT_THEME, generation: 1 };
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (value === undefined) fail("argument-invalid");
    if (name === "--port") parsed.port = Number(value);
    else if (name === "--theme") parsed.themeFile = resolve(value);
    else if (name === "--generation") parsed.generation = Number(value);
    else fail("argument-invalid");
  }
  if (!Number.isInteger(parsed.port) || parsed.port < 1024 || parsed.port > 65535) fail("port-invalid");
  if (!Number.isSafeInteger(parsed.generation) || parsed.generation < 1 || parsed.generation > 2147483647) fail("generation-invalid");
  return parsed;
}

function readBoundedJson(path, maximumBytes, errorCode) {
  const item = lstatSync(path);
  if (!item.isFile() || item.isSymbolicLink() || item.size > maximumBytes) fail(errorCode);
  try {
    const bytes = readFileSync(path);
    return {
      value: JSON.parse(bytes.toString("utf8")),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    fail(errorCode);
  }
}

function mimeAndMagic(path, bytes) {
  const extension = extname(path).toLowerCase();
  if (extension === ".png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if ((extension === ".jpg" || extension === ".jpeg") && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (extension === ".webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  fail("background-image-format-invalid");
}

function loadImageAsset(themeFile, filename, includeData) {
  const realTheme = realpathSync(themeFile);
  const themeDirectory = dirname(realTheme);
  const candidate = resolve(themeDirectory, filename);
  const item = lstatSync(candidate);
  if (!item.isFile() || item.isSymbolicLink() || item.size < 8 || item.size > 16 * 1024 * 1024) {
    fail("background-image-file-invalid");
  }
  const realAsset = realpathSync(candidate);
  if (dirname(realAsset) !== themeDirectory) fail("background-image-scope-invalid");
  const bytes = readFileSync(realAsset);
  const mime = mimeAndMagic(realAsset, bytes);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    dataUrl: includeData ? `data:${mime};base64,${bytes.toString("base64")}` : null,
  };
}

function computeRuntimeManifestDigest(members) {
  const keys = [
    "unifiedThemeFileSha256", "normalizedTargetSha256", "backgroundImageFileSha256",
    "uiSurfaceCatalogFileSha256", "themeStyleCatalogFileSha256", "compiledStyleSha256",
  ];
  if (!members || Object.keys(members).length !== keys.length
    || keys.some((key) => typeof members[key] !== "string" || !/^[a-f0-9]{64}$/.test(members[key]))) {
    fail("runtime-manifest-member-invalid");
  }
  return createHash("sha256").update(JSON.stringify({
    kind: "cc-theme.win-workbuddy-runtime-manifest",
    schemaVersion: 1,
    ...Object.fromEntries(keys.map((key) => [key, members[key]])),
  })).digest("hex");
}

function prepareTheme(themeFile, includeImage) {
  const unifiedDocument = readBoundedJson(themeFile, 512 * 1024, "unified-theme-file-invalid");
  const surfaceDocument = readBoundedJson(SURFACE_CATALOG, 512 * 1024, "surface-catalog-file-invalid");
  const styleDocument = readBoundedJson(STYLE_CATALOG, 512 * 1024, "style-catalog-file-invalid");
  const projection = projectUnifiedTheme(unifiedDocument.value);
  const compiled = compileProofRuntimeStyle(projection.artifact, surfaceDocument.value, styleDocument.value, MARKER_ID);
  const image = loadImageAsset(themeFile, projection.artifact.background.image, includeImage);
  const normalizedTargetSha256 = createHash("sha256").update(JSON.stringify(projection.artifact)).digest("hex");
  const compiledStyleSha256 = createHash("sha256").update(compiled.css).digest("hex");
  const artifactMembers = {
    unifiedThemeFileSha256: unifiedDocument.sha256,
    normalizedTargetSha256,
    backgroundImageFileSha256: image.sha256,
    uiSurfaceCatalogFileSha256: surfaceDocument.sha256,
    themeStyleCatalogFileSha256: styleDocument.sha256,
    compiledStyleSha256,
  };
  const artifactManifestSha256 = computeRuntimeManifestDigest(artifactMembers);
  const warnings = [
    ...projection.diagnostics.filter((item) => item.decision !== "exact").map((item) => item.code),
    ...compiled.warnings,
  ];
  return {
    theme: projection.artifact,
    css: compiled.css,
    baseHash: artifactManifestSha256,
    artifactManifestSha256,
    artifactMembers,
    imageDataUrl: image.dataUrl,
    warnings,
    requiredSelectors: surfaceDocument.value.roles
      .filter((role) => new Set(["exactly-one", "at-least-one", "at-least-one-each-when-visible"]).has(role.cardinality))
      .flatMap((role) => role.selectors),
  };
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
      this.socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolveOpen();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timeout);
        rejectOpen(new Error("cdp-websocket-failed"));
      }, { once: true });
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
      }, 15000);
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
  const result = await client.command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
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

function rendererConfig(prepared, generation) {
  const position = prepared.theme.background.position ?? prepared.theme.appearance.backgroundPosition ?? { xPercent: 50, yPercent: 50 };
  return {
    runtimeMarker: RUNTIME_MARKER,
    snapshotKey: SNAPSHOT_KEY,
    styleId: STYLE_ID,
    backgroundId: BACKGROUND_ID,
    markerId: MARKER_ID,
    themeId: prepared.theme.id,
    themeName: prepared.theme.name,
    baseHash: prepared.baseHash,
    generation,
    css: prepared.css,
    compiledStyleSha256: prepared.artifactMembers.compiledStyleSha256,
    imageSha256: prepared.artifactMembers.backgroundImageFileSha256,
    imageDataUrl: prepared.imageDataUrl,
    position,
    scrimOpacity: prepared.theme.background.scrimOpacity ?? 0,
    surfaceBase: prepared.theme.colors.surfaceBase,
    requiredSelectors: prepared.requiredSelectors,
  };
}

function minimalRendererConfig() {
  return {
    runtimeMarker: RUNTIME_MARKER,
    snapshotKey: SNAPSHOT_KEY,
    styleId: STYLE_ID,
    backgroundId: BACKGROUND_ID,
    markerId: MARKER_ID,
  };
}

function preflightExpression(config) {
  return `(() => {
    const config = ${JSON.stringify(config)};
    const body = document.body;
    const names = ["data-cc-theme-runtime", "data-cc-theme-id", "data-cc-theme-generation", "data-cc-theme-state", "data-cc-theme-hash"];
    const owned = body.getAttribute("data-cc-theme-runtime") === config.runtimeMarker;
    const snapshotPresent = Object.prototype.hasOwnProperty.call(window, config.snapshotKey);
    const snapshot = snapshotPresent ? window[config.snapshotKey] : null;
    const snapshotValid = snapshot && Object.isFrozen(snapshot) && Object.isFrozen(snapshot.attributes)
      && snapshot.owner === config.runtimeMarker && snapshot.schemaVersion === 1
      && Object.keys(snapshot).length === 3 && Object.keys(snapshot.attributes).length === names.length
      && names.every((name) => Object.prototype.hasOwnProperty.call(snapshot.attributes, name)
        && (snapshot.attributes[name] === null || (typeof snapshot.attributes[name] === "string" && snapshot.attributes[name].length <= 256)));
    const collision = !owned && (names.some((name) => body.hasAttribute(name))
      || document.getElementById(config.styleId) || document.getElementById(config.backgroundId)
      || document.getElementById(config.markerId) || snapshotPresent);
    if (collision) return { ok: false, code: "theme-runtime-collision" };
    if (owned && !snapshotPresent) return { ok: false, code: "theme-snapshot-missing" };
    if (owned && !snapshotValid) return { ok: false, code: "theme-snapshot-invalid" };
    const missing = config.requiredSelectors.filter((selector) => document.querySelectorAll(selector).length === 0);
    if (missing.length) return { ok: false, code: "required-surface-missing", missingCount: missing.length };
    return { ok: true, code: "ok", state: body.getAttribute("data-cc-theme-state") ?? "absent" };
  })()`;
}

function applyExpression(config) {
  return `(async () => {
    const config = ${JSON.stringify(config)};
    const body = document.body;
    const names = ["data-cc-theme-runtime", "data-cc-theme-id", "data-cc-theme-generation", "data-cc-theme-state", "data-cc-theme-hash"];
    const current = {
      style: document.getElementById(config.styleId),
      background: document.getElementById(config.backgroundId),
      marker: document.getElementById(config.markerId)
    };
    const runtime = body.getAttribute("data-cc-theme-runtime");
    const snapshotPresent = Object.prototype.hasOwnProperty.call(window, config.snapshotKey);
    const snapshot = snapshotPresent ? window[config.snapshotKey] : null;
    const snapshotValid = snapshot && Object.isFrozen(snapshot) && Object.isFrozen(snapshot.attributes)
      && snapshot.owner === config.runtimeMarker && snapshot.schemaVersion === 1
      && Object.keys(snapshot).length === 3 && Object.keys(snapshot.attributes).length === names.length
      && names.every((name) => Object.prototype.hasOwnProperty.call(snapshot.attributes, name)
        && (snapshot.attributes[name] === null || (typeof snapshot.attributes[name] === "string" && snapshot.attributes[name].length <= 256)));
    if (runtime !== config.runtimeMarker && (Object.values(current).some(Boolean)
      || names.some((name) => body.hasAttribute(name)) || snapshotPresent)) {
      return { ok: false, code: "theme-runtime-collision" };
    }
    if (runtime === config.runtimeMarker && !snapshotPresent) return { ok: false, code: "theme-snapshot-missing" };
    if (runtime === config.runtimeMarker && !snapshotValid) return { ok: false, code: "theme-snapshot-invalid" };
    if (runtime === config.runtimeMarker) {
      const currentGeneration = Number(body.getAttribute("data-cc-theme-generation"));
      if (!Number.isSafeInteger(currentGeneration)) return { ok: false, code: "theme-generation-corrupt" };
      if (config.generation < currentGeneration) return { ok: false, code: "stale-generation" };
      if (config.generation === currentGeneration
        && (body.getAttribute("data-cc-theme-id") !== config.themeId || body.getAttribute("data-cc-theme-hash") !== config.baseHash)) {
        return { ok: false, code: "generation-conflict" };
      }
    }
    if (runtime === config.runtimeMarker
      && body.getAttribute("data-cc-theme-id") === config.themeId
      && body.getAttribute("data-cc-theme-hash") === config.baseHash
      && body.getAttribute("data-cc-theme-generation") === String(config.generation)
      && body.getAttribute("data-cc-theme-state") === "applied"
      && current.style?.getAttribute("data-cc-theme-owned") === config.runtimeMarker
      && current.style.getAttribute("data-cc-theme-hash") === config.baseHash
      && current.style.textContent === config.css
      && current.background?.getAttribute("data-cc-theme-owned") === config.runtimeMarker
      && current.background.getAttribute("data-cc-theme-hash") === config.baseHash
      && current.background.style.position === "fixed" && current.background.style.zIndex === "0"
      && current.marker?.getAttribute("data-cc-theme-owned") === config.runtimeMarker
      && current.marker.getAttribute("data-cc-theme-hash") === config.baseHash
      && current.marker.textContent === "CC Theme · " + config.themeName
      && !current.marker.hasAttribute("style")
      && current.background.querySelector("img")?.getAttribute("data-cc-theme-asset-sha256") === config.imageSha256
      && current.background.querySelector("img")?.src === config.imageDataUrl
      && current.background.querySelector("img")?.complete && current.background.querySelector("img")?.naturalWidth > 0) {
      return { ok: true, changed: false };
    }

    const createdSnapshot = !snapshotPresent;
    if (createdSnapshot) {
      const attributes = Object.freeze(Object.fromEntries(names.map((name) => [name, body.getAttribute(name)])));
      const ownedSnapshot = Object.freeze({ owner: config.runtimeMarker, schemaVersion: 1, attributes });
      Object.defineProperty(window, config.snapshotKey, {
        value: ownedSnapshot, writable: false, configurable: true, enumerable: false
      });
    }
    const before = {
      attributes: Object.fromEntries(names.map((name) => [name, body.getAttribute(name)])),
      style: current.style?.cloneNode(true) ?? null,
      background: current.background?.cloneNode(true) ?? null,
      marker: current.marker?.cloneNode(true) ?? null
    };
    const restoreBefore = () => {
      document.getElementById(config.styleId)?.remove();
      document.getElementById(config.backgroundId)?.remove();
      document.getElementById(config.markerId)?.remove();
      if (before.style) document.head.append(before.style);
      if (before.background) body.append(before.background);
      if (before.marker) body.append(before.marker);
      for (const name of names) {
        const value = before.attributes[name];
        if (value === null) body.removeAttribute(name); else body.setAttribute(name, value);
      }
      if (createdSnapshot) delete window[config.snapshotKey];
    };
    try {
      const style = document.createElement("style");
      style.id = config.styleId;
      style.setAttribute("data-cc-theme-owned", config.runtimeMarker);
      style.setAttribute("data-cc-theme-hash", config.baseHash);
      style.setAttribute("data-cc-theme-style-sha256", config.compiledStyleSha256);
      style.textContent = config.css;

      const background = document.createElement("div");
      background.id = config.backgroundId;
      background.setAttribute("data-cc-theme-owned", config.runtimeMarker);
      background.setAttribute("data-cc-theme-hash", config.baseHash);
      background.setAttribute("aria-hidden", "true");
      background.style.cssText = "position:fixed;inset:30px 0 0 0;z-index:0;overflow:hidden;pointer-events:none;background:" + config.surfaceBase;
      const image = document.createElement("img");
      image.alt = "";
      image.setAttribute("data-cc-theme-role", "background-image");
      image.setAttribute("data-cc-theme-asset-sha256", config.imageSha256);
      image.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:"
        + config.position.xPercent + "% " + config.position.yPercent + "%";
      const loaded = new Promise((resolveLoad, rejectLoad) => {
        const timeout = setTimeout(() => rejectLoad(new Error("background-image-load-timeout")), 8000);
        image.addEventListener("load", () => { clearTimeout(timeout); resolveLoad(); }, { once: true });
        image.addEventListener("error", () => { clearTimeout(timeout); rejectLoad(new Error("background-image-load-failed")); }, { once: true });
      });
      image.src = config.imageDataUrl;
      await loaded;
      const scrim = document.createElement("div");
      scrim.setAttribute("data-cc-theme-role", "background-scrim");
      scrim.style.cssText = "position:absolute;inset:0;background:" + config.surfaceBase + ";opacity:" + config.scrimOpacity;
      background.append(image, scrim);

      const marker = document.createElement("div");
      marker.id = config.markerId;
      marker.setAttribute("data-cc-theme-owned", config.runtimeMarker);
      marker.setAttribute("data-cc-theme-hash", config.baseHash);
      marker.textContent = "CC Theme · " + config.themeName;

      current.style?.remove(); current.background?.remove(); current.marker?.remove();
      document.head.append(style);
      body.append(background, marker);
      body.setAttribute("data-cc-theme-runtime", config.runtimeMarker);
      body.setAttribute("data-cc-theme-id", config.themeId);
      body.setAttribute("data-cc-theme-generation", String(config.generation));
      body.setAttribute("data-cc-theme-state", "applied");
      body.setAttribute("data-cc-theme-hash", config.baseHash);
      return { ok: true, changed: true };
    } catch (error) {
      restoreBefore();
      const code = /^[a-z][a-z0-9-]{1,79}$/.test(error?.message) ? error.message : "theme-apply-rolled-back";
      return { ok: false, code };
    }
  })()`;
}

function pauseExpression(config) {
  return `(() => {
    const config = ${JSON.stringify(config)};
    const body = document.body;
    if (body.getAttribute("data-cc-theme-runtime") !== config.runtimeMarker) return { ok: false, code: "theme-runtime-mismatch" };
    const names = ["data-cc-theme-runtime", "data-cc-theme-id", "data-cc-theme-generation", "data-cc-theme-state", "data-cc-theme-hash"];
    const snapshotPresent = Object.prototype.hasOwnProperty.call(window, config.snapshotKey);
    const snapshot = snapshotPresent ? window[config.snapshotKey] : null;
    const snapshotValid = snapshot && Object.isFrozen(snapshot) && Object.isFrozen(snapshot.attributes)
      && snapshot.owner === config.runtimeMarker && snapshot.schemaVersion === 1
      && Object.keys(snapshot).length === 3 && Object.keys(snapshot.attributes).length === names.length
      && names.every((name) => Object.prototype.hasOwnProperty.call(snapshot.attributes, name)
        && (snapshot.attributes[name] === null || (typeof snapshot.attributes[name] === "string" && snapshot.attributes[name].length <= 256)));
    if (!snapshotPresent) return { ok: false, code: "theme-snapshot-missing" };
    if (!snapshotValid) return { ok: false, code: "theme-snapshot-invalid" };
    const themeId = body.getAttribute("data-cc-theme-id");
    const baseHash = body.getAttribute("data-cc-theme-hash");
    const generation = body.getAttribute("data-cc-theme-generation");
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(themeId ?? "") || !/^[a-f0-9]{64}$/.test(baseHash ?? "")
      || !/^[1-9][0-9]{0,9}$/.test(generation ?? "") || Number(generation) > 2147483647) {
      return { ok: false, code: "theme-identity-invalid" };
    }
    const style = document.getElementById(config.styleId);
    const background = document.getElementById(config.backgroundId);
    const marker = document.getElementById(config.markerId);
    if (body.getAttribute("data-cc-theme-state") === "paused" && !style && !background && marker?.textContent === "CC Theme paused") {
      return marker.getAttribute("data-cc-theme-owned") === config.runtimeMarker
        && marker.getAttribute("data-cc-theme-hash") === baseHash
        ? { ok: true, changed: false } : { ok: false, code: "theme-owned-element-mismatch" };
    }
    if (body.getAttribute("data-cc-theme-state") !== "applied") return { ok: false, code: "theme-state-invalid" };
    if (!style || !background || !marker) return { ok: false, code: "theme-owned-element-missing" };
    if (style.getAttribute("data-cc-theme-owned") !== config.runtimeMarker
      || style.getAttribute("data-cc-theme-hash") !== baseHash
      || background.getAttribute("data-cc-theme-owned") !== config.runtimeMarker
      || background.getAttribute("data-cc-theme-hash") !== baseHash
      || marker.getAttribute("data-cc-theme-owned") !== config.runtimeMarker
      || marker.getAttribute("data-cc-theme-hash") !== baseHash) {
      return { ok: false, code: "theme-owned-element-mismatch" };
    }
    const before = {
      state: body.getAttribute("data-cc-theme-state"),
      style: style?.cloneNode(true) ?? null,
      background: background?.cloneNode(true) ?? null,
      markerText: marker.textContent,
      markerStyle: marker.getAttribute("style")
    };
    try {
      style?.remove(); background?.remove();
      marker.textContent = "CC Theme paused";
      marker.setAttribute("style", "position:fixed;top:42px;right:14px;z-index:2147483647;padding:7px 11px;border:1px solid #777;border-radius:999px;color:#fff;background:#333;font:600 12px/1.2 system-ui;pointer-events:none");
      body.setAttribute("data-cc-theme-state", "paused");
      return { ok: true, changed: true };
    } catch {
      if (before.style) document.head.append(before.style);
      if (before.background) body.append(before.background);
      marker.textContent = before.markerText;
      if (before.markerStyle === null) marker.removeAttribute("style"); else marker.setAttribute("style", before.markerStyle);
      if (before.state === null) body.removeAttribute("data-cc-theme-state"); else body.setAttribute("data-cc-theme-state", before.state);
      return { ok: false, code: "theme-pause-rolled-back" };
    }
  })()`;
}

function restoreExpression(config) {
  return `(() => {
    const config = ${JSON.stringify(config)};
    const body = document.body;
    const names = ["data-cc-theme-runtime", "data-cc-theme-id", "data-cc-theme-generation", "data-cc-theme-state", "data-cc-theme-hash"];
    const runtime = body.getAttribute("data-cc-theme-runtime");
    const snapshotPresent = Object.prototype.hasOwnProperty.call(window, config.snapshotKey);
    const snapshot = snapshotPresent ? window[config.snapshotKey] : null;
    const snapshotValid = snapshot && Object.isFrozen(snapshot) && Object.isFrozen(snapshot.attributes)
      && snapshot.owner === config.runtimeMarker && snapshot.schemaVersion === 1
      && Object.keys(snapshot).length === 3 && Object.keys(snapshot.attributes).length === names.length
      && names.every((name) => Object.prototype.hasOwnProperty.call(snapshot.attributes, name)
        && (snapshot.attributes[name] === null || (typeof snapshot.attributes[name] === "string" && snapshot.attributes[name].length <= 256)));
    const elements = [document.getElementById(config.styleId), document.getElementById(config.backgroundId), document.getElementById(config.markerId)];
    if (runtime === null && !snapshotPresent && elements.every((element) => !element)) {
      return names.some((name) => body.hasAttribute(name))
        ? { ok: false, code: "theme-namespace-corrupt" } : { ok: true, changed: false };
    }
    if (runtime !== config.runtimeMarker) return { ok: false, code: "theme-runtime-mismatch" };
    if (!snapshotPresent) return { ok: false, code: "theme-snapshot-missing" };
    if (!snapshotValid) return { ok: false, code: "theme-snapshot-invalid" };
    if (elements.some((element) => element && element.getAttribute("data-cc-theme-owned") !== config.runtimeMarker)) {
      return { ok: false, code: "theme-owned-element-mismatch" };
    }
    const before = {
      attributes: Object.fromEntries(names.map((name) => [name, body.getAttribute(name)])),
      style: elements[0]?.cloneNode(true) ?? null,
      background: elements[1]?.cloneNode(true) ?? null,
      marker: elements[2]?.cloneNode(true) ?? null
    };
    try {
      for (const element of elements) element?.remove();
      for (const name of names) {
        const value = snapshot.attributes[name];
        if (value === null) body.removeAttribute(name); else body.setAttribute(name, value);
      }
      if (!delete window[config.snapshotKey]) throw new Error("theme-snapshot-delete-failed");
      return { ok: true, changed: true };
    } catch {
      if (before.style) document.head.append(before.style);
      if (before.background) body.append(before.background);
      if (before.marker) body.append(before.marker);
      for (const name of names) {
        const value = before.attributes[name];
        if (value === null) body.removeAttribute(name); else body.setAttribute(name, value);
      }
      return { ok: false, code: "theme-restore-rolled-back" };
    }
  })()`;
}

function verifyExpression(config) {
  return `(() => {
    const config = ${JSON.stringify(config)};
    const names = ["data-cc-theme-runtime", "data-cc-theme-id", "data-cc-theme-generation", "data-cc-theme-state", "data-cc-theme-hash"];
    const snapshotPresent = Object.prototype.hasOwnProperty.call(window, config.snapshotKey);
    const snapshot = snapshotPresent ? window[config.snapshotKey] : null;
    const snapshotValid = snapshot && Object.isFrozen(snapshot) && Object.isFrozen(snapshot.attributes)
      && snapshot.owner === config.runtimeMarker && snapshot.schemaVersion === 1
      && Object.keys(snapshot).length === 3 && Object.keys(snapshot.attributes).length === names.length
      && names.every((name) => Object.prototype.hasOwnProperty.call(snapshot.attributes, name)
        && (snapshot.attributes[name] === null || (typeof snapshot.attributes[name] === "string" && snapshot.attributes[name].length <= 256)));
    const style = document.getElementById(config.styleId);
    const background = document.getElementById(config.backgroundId);
    const image = background?.querySelector("img");
    const scrim = background?.querySelector('[data-cc-theme-role="background-scrim"]');
    const marker = document.getElementById(config.markerId);
    const position = config.position ?? { xPercent: 50, yPercent: 50 };
    const surfaceBase = config.surfaceBase ?? "transparent";
    const expectedBackground = document.createElement("div");
    expectedBackground.style.cssText = "position:fixed;inset:30px 0 0 0;z-index:0;overflow:hidden;pointer-events:none;background:" + surfaceBase;
    const expectedImage = document.createElement("img");
    expectedImage.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:"
      + position.xPercent + "% " + position.yPercent + "%";
    const expectedScrim = document.createElement("div");
    expectedScrim.style.cssText = "position:absolute;inset:0;background:" + surfaceBase + ";opacity:" + (config.scrimOpacity ?? 0);
    const contentValid = style?.getAttribute("data-cc-theme-owned") === config.runtimeMarker
      && style.getAttribute("data-cc-theme-hash") === config.baseHash
      && style.getAttribute("data-cc-theme-style-sha256") === config.compiledStyleSha256
      && style.textContent === config.css
      && background?.getAttribute("data-cc-theme-owned") === config.runtimeMarker
      && background.getAttribute("data-cc-theme-hash") === config.baseHash
      && background.getAttribute("style") === expectedBackground.getAttribute("style")
      && background.children.length === 2
      && image?.getAttribute("data-cc-theme-role") === "background-image"
      && image.getAttribute("data-cc-theme-asset-sha256") === config.imageSha256
      && image.getAttribute("style") === expectedImage.getAttribute("style")
      && image.src === config.imageDataUrl
      && image.alt === ""
      && scrim?.getAttribute("style") === expectedScrim.getAttribute("style")
      && marker?.getAttribute("data-cc-theme-owned") === config.runtimeMarker
      && marker.getAttribute("data-cc-theme-hash") === config.baseHash
      && marker.textContent === "CC Theme · " + config.themeName
      && !marker.hasAttribute("style");
    return {
      runtime: document.body?.getAttribute("data-cc-theme-runtime"),
      themeId: document.body?.getAttribute("data-cc-theme-id"),
      generation: document.body?.getAttribute("data-cc-theme-generation"),
      state: document.body?.getAttribute("data-cc-theme-state"),
      baseHash: document.body?.getAttribute("data-cc-theme-hash"),
      stylePresent: Boolean(style),
      backgroundPresent: Boolean(background),
      markerPresent: Boolean(marker),
      imageLoaded: Boolean(image?.complete && image?.naturalWidth > 0),
      contentValid: Boolean(contentValid),
      snapshotValid: Boolean(snapshotValid)
    };
  })()`;
}

function expectedState(operation, marker, config) {
  if (operation === "restore") return !marker.runtime && !marker.stylePresent && !marker.backgroundPresent && !marker.markerPresent;
  if (operation === "pause") {
    return marker.runtime === config.runtimeMarker && /^[A-Za-z0-9_-]{1,80}$/.test(marker.themeId ?? "")
      && /^[a-f0-9]{64}$/.test(marker.baseHash ?? "") && /^[1-9][0-9]{0,9}$/.test(marker.generation ?? "")
      && marker.state === "paused" && !marker.stylePresent && !marker.backgroundPresent
      && marker.markerPresent && marker.snapshotValid;
  }
  if (operation === "apply" || operation === "verify") {
    return marker.runtime === config.runtimeMarker && marker.themeId === config.themeId
      && marker.baseHash === config.baseHash && marker.generation === String(config.generation)
      && marker.state === "applied" && marker.stylePresent && marker.backgroundPresent
      && marker.markerPresent && marker.imageLoaded && marker.contentValid && marker.snapshotValid;
  }
  return true;
}

async function main() {
  let operation = "unknown";
  try {
    const parsed = parseArguments(process.argv.slice(2));
    operation = parsed.operation;
    const minimalOnly = operation === "pause" || operation === "restore";
    const includeImage = operation === "preflight" || operation === "apply" || operation === "verify";
    const prepared = minimalOnly ? null : prepareTheme(parsed.themeFile, includeImage);
    const config = minimalOnly ? minimalRendererConfig() : rendererConfig(prepared, parsed.generation);
    const { client, identity } = await findTarget(parsed.port);
    try {
      let preflight = { ok: true, state: "not-checked" };
      if (operation === "preflight" || operation === "apply") {
        preflight = await evaluate(client, preflightExpression(config));
        if (preflight?.ok === false) fail(preflight.code);
      }
      let mutation = { ok: true, changed: false };
      if (operation === "apply") mutation = await evaluate(client, applyExpression(config));
      else if (operation === "pause") mutation = await evaluate(client, pauseExpression(config));
      else if (operation === "restore") mutation = await evaluate(client, restoreExpression(config));
      if (mutation?.ok === false) fail(mutation.code);
      const marker = await evaluate(client, verifyExpression(config));
      if (!expectedState(operation, marker, config)) fail("theme-marker-mismatch");
      const resultThemeId = prepared?.theme.id
        ?? (/^[A-Za-z0-9_-]{1,80}$/.test(marker.themeId ?? "") ? marker.themeId : undefined);
      const resultGeneration = prepared ? parsed.generation
        : (/^[1-9][0-9]{0,9}$/.test(marker.generation ?? "") ? Number(marker.generation) : undefined);
      const resultArtifactDigest = prepared?.artifactManifestSha256
        ?? (/^[a-f0-9]{64}$/.test(marker.baseHash ?? "") ? marker.baseHash : undefined);
      process.stdout.write(`${JSON.stringify(boundedResult(operation, true, "ok", {
        clientVersion: identity.productVersion,
        targetIdentity: "workbuddy-windows-main-renderer",
        themeId: resultThemeId,
        rendererGeneration: resultGeneration,
        rendererGenerationScope: resultGeneration === undefined ? undefined : "renderer-session",
        artifactManifestSha256: resultArtifactDigest,
        artifactDigestScope: resultArtifactDigest === undefined ? undefined : "deterministic-runtime-manifest",
        baseHashPrefix: resultArtifactDigest?.slice(0, 12),
        markerState: operation === "preflight"
          ? new Set(["applied", "paused", "absent"]).has(preflight.state) ? preflight.state : "unknown"
          : new Set(["applied", "paused"]).has(marker.state) ? marker.state : "absent",
        changed: Boolean(mutation.changed),
        catalogStatus: prepared ? "partial-live-verified" : undefined,
      }, prepared?.warnings ?? []))}\n`);
    } finally {
      client.close();
    }
  } catch (error) {
    process.stdout.write(`${JSON.stringify(boundedResult(operation, false, boundedCode(error), {}, []))}\n`);
    process.exitCode = 1;
  }
}

export {
  applyExpression, computeRuntimeManifestDigest, minimalRendererConfig, pauseExpression,
  preflightExpression, restoreExpression, verifyExpression,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
