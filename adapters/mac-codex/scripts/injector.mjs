import fs from "node:fs/promises";
import { constants as fsConstants, createReadStream, watch as watchFs } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readImageMetadata } from "./image-metadata.mjs";
import { inspectDirectionalAtlas } from "./interactive-background.mjs";
import { normalizeSkinTheme, SKIN_THEME_KIND } from "./skin-theme.mjs";
import { loadStyleCatalog } from "./theme-style-catalog.mjs";
import { loadThemeEditorLocales } from "./theme-editor-locales.mjs";
import { defaultStyleOverrideRoot, loadStyleOverrides, transactStyleOverrides } from "./theme-style-overrides.mjs";
import {
  assertSurfaceEvidencePrivacy,
  buildSurfaceEvidenceExpression,
  normalizeSurfaceEvidence,
  writeSurfaceEvidence,
} from "./live-surface-evidence.mjs";
import { createLatestWriteCoordinator } from "./latest-write-coordinator.mjs";
import { createDocumentGenerationReconciler } from "./document-generation.mjs";
import {
  MAX_DIRECTIONAL_ATLAS_BYTES,
  MAX_IMAGE_BYTES,
  MAX_INLINE_VIDEO_BYTES,
  MAX_TOTAL_MEDIA_BYTES,
  MAX_VIDEO_BYTES,
} from "./media-limits.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const staticAssetsRoot = path.join(root, "assets");
const SKIN_VERSION = (await fs.readFile(path.join(root, "VERSION"), "utf8")).trim();
if (!/^\d+(?:\.\d+){2}$/.test(SKIN_VERSION)) throw new Error(`Invalid Adapter VERSION: ${SKIN_VERSION}`);
const DEFERRED_VIDEO_SOURCE = "cc-theme:deferred-video";
const DEFERRED_INTERACTIVE_ATLAS_SOURCE = "cc-theme:deferred-interactive-atlas";
const STYLE_EDITOR_BINDING = "__ccThemePersistStyleOverrides";
const STYLE_EDITOR_SYNC_KEY = "__CC_THEME_APPLY_PERSISTED_OVERRIDES__";
const THEME_RUNTIME_RESULT_KEY = "__CC_THEME_RUNTIME_RESULT__";
const VIDEO_TRANSFER_CHUNK_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_ART_BYTES = MAX_IMAGE_BYTES;
const MAX_TOTAL_ART_BYTES = MAX_TOTAL_MEDIA_BYTES;
const SUPPORTED_ART_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
let staticPayloadAssets = null;
const styleWriteCoordinator = createLatestWriteCoordinator();

function imageMime(file) {
  const extension = path.extname(file).toLowerCase();
  return extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
    : extension === ".webp" ? "image/webp" : "image/png";
}

function imageDataUrl(bytes, file) {
  return `data:${imageMime(file)};base64,${bytes.toString("base64")}`;
}

function videoDataUrl(bytes) {
  return `data:video/mp4;base64,${bytes.toString("base64")}`;
}

function signatureMatches(extension, header) {
  if (extension === ".png") {
    return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  if (extension === ".webp") {
    return header.subarray(0, 4).toString("ascii") === "RIFF"
      && header.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function assertContainedPath(rootPath, candidatePath, label) {
  const relative = path.relative(rootPath, candidatePath);
  if (
    relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  ) return;
  throw new Error(`${label} must stay inside its theme directory`);
}

function sameStat(left, right) {
  return left.isFile() && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function readStableFile(filePath, label, maxBytes) {
  let handle;
  try {
    handle = await fs.open(filePath, OPEN_FLAGS);
  } catch (error) {
    if (error.code === "ELOOP") throw new Error(`${label} must not be a symbolic link`);
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`${label} must be a regular file`);
    if (before.size > maxBytes) throw new Error(`${label} is larger than ${maxBytes} bytes`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameStat(before, after)) throw new Error(`${label} changed while it was being loaded`);
    if (bytes.length > maxBytes) throw new Error(`${label} is larger than ${maxBytes} bytes`);
    return { bytes, stat: after };
  } finally {
    await handle.close();
  }
}

function decodeStrictUtf8(bytes, label) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) throw new Error(`${label} contains NUL characters`);
  return text;
}

async function validateThemeImage(assetsRoot, file, label) {
  if (path.basename(file) !== file) throw new Error(`${label} must stay inside its theme directory`);
  const extension = path.extname(file).toLowerCase();
  if (!SUPPORTED_ART_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported ${label} format: ${extension || "missing"}`);
  }
  const imagePath = path.resolve(assetsRoot, file);
  assertContainedPath(assetsRoot, imagePath, label);
  const loaded = await readStableFile(imagePath, label, MAX_ART_BYTES);
  if (loaded.bytes.length < 1) {
    throw new Error(`${label} must be a non-empty file no larger than ${MAX_ART_BYTES} bytes`);
  }
  const header = loaded.bytes.subarray(0, 12);
  if (header.length < 12 || !signatureMatches(extension, header)) {
    throw new Error(`${label} content does not match its ${extension} extension`);
  }
  const metadata = readImageMetadata(loaded.bytes, extension);
  if (!metadata) {
    throw new Error(`${label} metadata is invalid or exceeds the 16384px / 50MP safety limit`);
  }
  return { imagePath, imageStat: loaded.stat, imageBytes: loaded.bytes, metadata, extension };
}

async function validateThemeVideo(assetsRoot, file) {
  if (path.basename(file) !== file) throw new Error("Background video must stay inside its theme directory");
  const extension = path.extname(file).toLowerCase();
  if (extension !== ".mp4") throw new Error(`Unsupported background video format: ${extension || "missing"}`);
  const videoPath = path.resolve(assetsRoot, file);
  assertContainedPath(assetsRoot, videoPath, "Background video");
  let handle;
  try {
    handle = await fs.open(videoPath, OPEN_FLAGS);
  } catch (error) {
    if (error.code === "ELOOP") throw new Error("Background video must not be a symbolic link");
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 16 || before.size > MAX_VIDEO_BYTES) {
      throw new Error(`Background video must be an MP4 file between 16 and ${MAX_VIDEO_BYTES} bytes`);
    }
    const header = Buffer.alloc(32);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const after = await handle.stat();
    if (!sameStat(before, after)) throw new Error("Background video changed while it was being checked");
    if (bytesRead < 16) {
      throw new Error(`Background video must be an MP4 file between 16 and ${MAX_VIDEO_BYTES} bytes`);
    }
    const boxSize = header.readUInt32BE(0);
    if (header.subarray(4, 8).toString("ascii") !== "ftyp" || boxSize < 16 || boxSize > before.size) {
      throw new Error("Background video content is not a valid MP4/ISO-BMFF file");
    }
    return { videoPath, videoStat: after };
  } finally {
    await handle.close();
  }
}

async function validateDirectionalAtlas(assetsRoot, interactiveBackground) {
  if (interactiveBackground?.type !== "directional") return null;
  const file = interactiveBackground.atlas;
  if (path.basename(file) !== file) {
    throw new Error("Directional background atlas must stay inside its theme directory");
  }
  const atlasPath = path.resolve(assetsRoot, file);
  assertContainedPath(assetsRoot, atlasPath, "Directional background atlas");
  const loaded = await readStableFile(
    atlasPath,
    "Directional background atlas",
    MAX_DIRECTIONAL_ATLAS_BYTES,
  );
  const metadata = inspectDirectionalAtlas(
    loaded.bytes,
    interactiveBackground,
    "Directional background atlas",
  );
  return { atlasPath, atlasStat: loaded.stat, metadata };
}

function parseArgs(argv) {
  const options = {
    port: 9341,
    mode: "watch",
    timeoutMs: 30000,
    screenshot: null,
    output: null,
    reload: false,
    themeDir: null,
    runtimeGeneration: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--watch") options.mode = "watch";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--check-payload") options.mode = "check";
    else if (arg === "--surface-evidence") options.mode = "evidence";
    else if (arg === "--wait-ready") options.mode = "ready";
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++i]);
    else if (arg === "--output") options.output = path.resolve(argv[++i]);
    else if (arg === "--theme-dir") options.themeDir = path.resolve(argv[++i]);
    else if (arg === "--runtime-generation") options.runtimeGeneration = argv[++i];
    else if (arg === "--reload") options.reload = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 120000) {
    throw new Error(`Invalid timeout: ${options.timeoutMs}`);
  }
  if (options.runtimeGeneration !== null &&
      (typeof options.runtimeGeneration !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(options.runtimeGeneration))) {
    throw new Error("Invalid runtime generation");
  }
  if (options.mode === "ready" && !options.runtimeGeneration) {
    throw new Error("Readiness requires --runtime-generation");
  }
  return options;
}

export function byteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value ?? "");
  if (!match || (!match[1] && !match[2])) return null;
  const suffix = !match[1];
  let start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  let end = suffix ? size - 1 : match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

export function createLocalMediaServer() {
  const token = randomBytes(24).toString("hex");
  const route = `/${token}/background.mp4`;
  let current = null;
  let listening = null;
  const server = createServer(async (request, response) => {
    let handle;
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (!current || url.pathname !== route || (request.method !== "GET" && request.method !== "HEAD")) {
        response.writeHead(404, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      handle = await fs.open(current.path, OPEN_FLAGS);
      const stat = await handle.stat();
      if (!sameStat(stat, current.stat)) throw new Error("Background video changed before it was streamed");
      const rangeHeader = request.headers.range;
      const range = rangeHeader ? byteRange(rangeHeader, stat.size) : null;
      if (rangeHeader && !range) {
        response.writeHead(416, { "Content-Range": `bytes */${stat.size}`, "Cache-Control": "no-store" });
        await handle.close();
        handle = null;
        response.end();
        return;
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? stat.size - 1;
      response.writeHead(range ? 206 : 200, {
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Length": String(end - start + 1),
        "Content-Type": "video/mp4",
        "Cross-Origin-Resource-Policy": "cross-origin",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
      });
      if (request.method === "HEAD") {
        await handle.close();
        handle = null;
        response.end();
        return;
      }
      const stream = handle.createReadStream({ start, end, autoClose: true });
      handle = null;
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    } catch {
      await handle?.close().catch(() => {});
      if (!response.headersSent) response.writeHead(409, { "Cache-Control": "no-store" });
      response.end();
    }
  });

  return {
    async urlFor(videoPath, videoStat) {
      current = { path: videoPath, stat: videoStat };
      if (!listening) {
        listening = new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolve(server.address());
          });
        });
      }
      const address = await listening;
      if (!address || typeof address === "string") throw new Error("Could not bind the local media server");
      return `http://127.0.0.1:${address.port}${route}?v=${videoStat.size}-${Math.round(videoStat.mtimeMs)}`;
    },
    async close() {
      current = null;
      if (!server.listening) return;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function validatedDebuggerUrl(target, port) {
  const url = new URL(target.webSocketDebuggerUrl);
  if (url.protocol !== "ws:" || !LOOPBACK_HOSTS.has(url.hostname) || Number(url.port) !== port) {
    throw new Error(`Rejected non-loopback CDP WebSocket URL: ${url.href}`);
  }
  return url.href;
}

class CdpSession {
  constructor(target, port) {
    this.target = target;
    this.ws = new WebSocket(validatedDebuggerUrl(target, port));
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("CDP WebSocket open timed out")), 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("CDP WebSocket open failed")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => this.onMessage(event));
    this.ws.addEventListener("close", () => {
      this.closed = true;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    // Keep the host application's content-security policy active. The Skin
    // runtime only uses renderer-owned DOM/CSS and a same-document Blob URL.
    await this.send("Page.setBypassCSP", { enabled: false }).catch(() => {});
    return this;
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timeout);
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP session is closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return result.result?.value;
  }

  close() {
    if (!this.closed) this.ws.close();
    this.closed = true;
  }
}

async function sendStyleEditorResult(session, executionContextId, requestId, result) {
  if (session.closed) return;
  await session.send("Runtime.evaluate", {
    expression: `window.__CC_THEME_EDITOR_RESULT__?.(${JSON.stringify(requestId)}, ${JSON.stringify(result)})`,
    contextId: executionContextId,
    awaitPromise: false,
    returnByValue: true,
    userGesture: false,
  }).catch(() => {});
}

async function replaceRuntimeBinding(session, name) {
  // A CDP binding function can outlive the watcher session that installed it.
  // Reusing that orphaned function sends calls to a closed connection and
  // makes a freshly injected editor appear permanently stale. Replace the
  // project-owned binding before subscribing the current watcher.
  await session.send("Runtime.removeBinding", { name }).catch(() => {});
  await session.evaluate(`(() => {
    try { delete window[${JSON.stringify(name)}]; } catch {}
  })()`).catch(() => {});
  await session.send("Runtime.addBinding", { name });
}

async function installStyleEditorBinding(session, currentPayload, onPersisted = null) {
  await replaceRuntimeBinding(session, STYLE_EDITOR_BINDING);
  session.on("Runtime.bindingCalled", (params) => {
    if (params.name !== STYLE_EDITOR_BINDING) return;
    void (async () => {
      let requestId = "unknown";
      let writeVersion = 0;
      try {
        if (Buffer.byteLength(params.payload ?? "", "utf8") > 64 * 1024) throw new Error("Editor request is too large");
        const message = JSON.parse(params.payload ?? "null");
        requestId = typeof message?.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)
          ? message.requestId : "unknown";
        const current = currentPayload();
        if (!current || message?.nonce !== current.editorNonce || message?.themeId !== current.theme.id) {
          throw new Error("Editor session is stale; reopen the Theme settings panel");
        }
        if (!Number.isSafeInteger(message?.writeVersion) || message.writeVersion < 1) {
          throw new Error("Editor write version is invalid");
        }
        writeVersion = message.writeVersion;
        const theme = current.theme;
        const catalog = current.styleCatalog;
        const coordinated = await styleWriteCoordinator.submit(theme.id, () =>
          transactStyleOverrides(theme, catalog, {
            source: "local-editor",
            values: message.values,
            runtimePreferences: message.runtimePreferences,
            baseValues: message.baseValues,
            baseRuntimePreferences: message.baseRuntimePreferences,
          }));
        const saved = coordinated.value;
        const superseded = coordinated.superseded;
        if (saved) {
          if (!superseded) {
            const active = currentPayload();
            if (active?.theme.id === theme.id) {
              active.styleOverrides = saved.values;
              active.runtimePreferences = saved.runtimePreferences;
              active.styleOverrideQuarantine = saved.quarantine;
              active.styleOverrideDiagnostics = saved.diagnostics;
            }
            await onPersisted?.({
              themeId: theme.id,
              values: saved.values,
              runtimePreferences: saved.runtimePreferences,
              quarantine: saved.quarantine,
              diagnostics: saved.diagnostics,
              writeVersion,
              receipt: coordinated.receipt,
            });
          }
        }
        await sendStyleEditorResult(session, params.executionContextId, requestId, {
          ok: true, superseded, writeVersion,
          ...(saved && !superseded ? {
            values: saved.values,
            runtimePreferences: saved.runtimePreferences,
            diagnostics: saved.diagnostics,
            conflicts: saved.conflicts,
            transactionRevision: saved.transactionRevision,
          } : {}),
        });
      } catch (error) {
        await sendStyleEditorResult(session, params.executionContextId, requestId, {
          ok: false,
          writeVersion,
          message: error.message,
        });
      }
    })();
  });
}

async function notifyThemeRuntimeResult(session, result) {
  if (session.closed) return;
  await session.evaluate(
    `window[${JSON.stringify(THEME_RUNTIME_RESULT_KEY)}]?.(${JSON.stringify(result)})`,
  ).catch(() => {});
}

async function listAppTargets(port) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const targets = await response.json();
    return targets.filter((item) => {
      if (item.type !== "page" || !item.url?.startsWith("app://") || !item.webSocketDebuggerUrl) return false;
      try {
        validatedDebuggerUrl(item, port);
        return true;
      } catch {
        return false;
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function probeSession(session) {
  return session.evaluate(`(() => {
    const markers = {
      shell: Boolean(document.querySelector('[data-app-shell-main-content-layout], main.main-surface')),
      sidebar: Boolean(document.querySelector('.app-shell-left-panel')),
      composer: Boolean(document.querySelector('[data-codex-composer-root], .composer-surface-chrome')),
      main: Boolean(document.querySelector('[role="main"]')),
      settings: Boolean(document.querySelector('[data-skin-role="settings-shell"], [data-settings-panel-slug]')),
    };
    return {
      markers,
      codex: (markers.shell && markers.sidebar && (markers.composer || markers.main)) || markers.settings,
    };
  })()`);
}

async function waitForCodexProbe(session, timeoutMs = 1800) {
  const deadline = Date.now() + timeoutMs;
  let probe = null;
  while (Date.now() < deadline) {
    probe = await probeSession(session);
    if (probe?.codex) return probe;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return probe;
}

async function connectTarget(target, port) {
  return new CdpSession(target, port).open();
}

async function connectCodexTargets(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await listAppTargets(port);
      const connected = [];
      for (const target of targets) {
        let session;
        try {
          session = await connectTarget(target, port);
          const probe = await probeSession(session);
          if (probe?.codex) connected.push({ target, session, probe });
          else session.close();
        } catch (error) {
          session?.close();
          lastError = error;
        }
      }
      if (connected.length) return connected;
      lastError = new Error("No page matched the expected Codex shell markers");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`No verified Codex renderer on 127.0.0.1:${port}: ${lastError?.message ?? "timed out"}`);
}

async function loadTheme(themeDir) {
  if (!themeDir) throw new Error("Theme operations require an explicit external --theme-dir");
  const requestedRoot = themeDir;
  let assetsRoot;
  try {
    assetsRoot = await fs.realpath(requestedRoot);
  } catch (error) {
    if (error.code === "ENOENT" && themeDir) {
      throw new Error(`Explicit theme directory does not exist: ${requestedRoot}`);
    }
    throw error;
  }
  const rootStat = await fs.stat(assetsRoot);
  if (!rootStat.isDirectory()) throw new Error(`Theme root is not a directory: ${requestedRoot}`);
  const configPath = path.resolve(assetsRoot, "theme.json");
  assertContainedPath(assetsRoot, configPath, "Theme config");
  let config;
  try {
    config = await readStableFile(configPath, "Theme config", MAX_CONFIG_BYTES);
  } catch (error) {
    if (error.code === "ENOENT" && themeDir) {
      throw new Error(`Explicit theme directory is missing theme.json: ${requestedRoot}`);
    }
    throw error;
  }
  let raw;
  try {
    raw = JSON.parse(decodeStrictUtf8(config.bytes, "Theme config"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${configPath} is not valid JSON`);
    throw error;
  }
  const theme = normalizeSkinTheme(raw, configPath);
  const image = await validateThemeImage(assetsRoot, theme.image, "Theme image");
  const hero = theme.homeHeroImage && theme.homeHeroImage !== theme.image
    ? await validateThemeImage(assetsRoot, theme.homeHeroImage, "New Task Hero image")
    : null;
  const video = theme.backgroundVideo ? await validateThemeVideo(assetsRoot, theme.backgroundVideo) : null;
  const atlas = await validateDirectionalAtlas(assetsRoot, theme.interactiveBackground);
  const totalBytes = image.imageStat.size + (hero?.imageStat.size ?? 0) +
    (video?.videoStat.size ?? 0) + (atlas?.atlasStat.size ?? 0);
  if (totalBytes > MAX_TOTAL_ART_BYTES) {
    throw new Error(`Theme media exceed the ${MAX_TOTAL_ART_BYTES}-byte total asset budget`);
  }
  theme.artMetadata = image.metadata;
  theme.artKey = createHash("sha256").update(image.imageBytes).digest("hex").slice(0, 20);
  return {
    assetsRoot,
    imagePath: image.imagePath,
    imageStat: image.imageStat,
    imageBytes: image.imageBytes,
    heroImagePath: hero?.imagePath ?? null,
    heroImageStat: hero?.imageStat ?? null,
    heroImageBytes: hero?.imageBytes ?? null,
    videoPath: video?.videoPath ?? null,
    videoStat: video?.videoStat ?? null,
    interactiveAtlasPath: atlas?.atlasPath ?? null,
    interactiveAtlasStat: atlas?.atlasStat ?? null,
    interactiveAtlasMetadata: atlas?.metadata ?? null,
    theme,
  };
}

async function loadStaticPayloadAssets() {
  const cacheHit = Boolean(staticPayloadAssets);
  if (!staticPayloadAssets) {
    staticPayloadAssets = (async () => {
      const [css, template, backgroundEffects, styleCatalog] = await Promise.all([
        fs.readFile(path.join(staticAssetsRoot, "skin.css"), "utf8"),
        fs.readFile(path.join(staticAssetsRoot, "renderer-inject.js"), "utf8"),
        fs.readFile(path.join(staticAssetsRoot, "background-effects.js"), "utf8"),
        loadStyleCatalog(),
      ]);
      const editorLocales = await loadThemeEditorLocales(styleCatalog);
      return [css, template, backgroundEffects, styleCatalog, editorLocales];
    })().catch((error) => {
      staticPayloadAssets = null;
      throw error;
    });
  }
  const [css, template, backgroundEffects, styleCatalog, editorLocales] = await staticPayloadAssets;
  return { css, template, backgroundEffects, styleCatalog, editorLocales, cacheHit };
}

function invalidateStaticPayloadAssets() {
  staticPayloadAssets = null;
}

async function loadPayload(themeDir, {
  videoUrlFor = null,
  inlineVideo = false,
  deferredVideo = false,
  editorNonceOverride = null,
} = {}) {
  const startedAt = performance.now();
  const [staticAssets, loaded] = await Promise.all([
    loadStaticPayloadAssets(),
    loadTheme(themeDir),
  ]);
  const { css, template, backgroundEffects, styleCatalog, editorLocales } = staticAssets;
  const {
    imageBytes: art,
    imagePath,
    heroImageBytes: heroArt,
    heroImagePath,
    heroImageStat,
    videoPath,
    videoStat,
    interactiveAtlasPath,
    interactiveAtlasStat,
    interactiveAtlasMetadata,
    theme,
  } = loaded;
  let styleOverrideState = { values: {}, status: "unavailable" };
  try {
    styleOverrideState = await loadStyleOverrides(theme, styleCatalog);
  } catch (error) {
    console.error(`[cc-theme] ignored invalid local style overrides: ${error.message}`);
  }
  const editorNonce = typeof editorNonceOverride === "string" && /^[a-f0-9]{48}$/.test(editorNonceOverride)
    ? editorNonceOverride : randomBytes(24).toString("hex");
  const artDataUrl = imageDataUrl(art, imagePath);
  const heroArtDataUrl = heroArt ? imageDataUrl(heroArt, heroImagePath) : null;
  let videoArtSource = null;
  if (videoPath && deferredVideo) videoArtSource = DEFERRED_VIDEO_SOURCE;
  else if (videoPath && videoUrlFor) videoArtSource = await videoUrlFor(videoPath, videoStat);
  else if (videoPath && inlineVideo) {
    const inline = await readStableFile(videoPath, "Inline background video", MAX_INLINE_VIDEO_BYTES);
    videoArtSource = videoDataUrl(inline.bytes);
  } else if (videoPath) {
    throw new Error("Background video requires the persistent watch injector");
  }
  const styleRevision = createHash("sha256").update(css).digest("hex").slice(0, 20);
  const payload = template
    .replace("__SKIN_CSS_JSON__", JSON.stringify(css))
    .replace("__SKIN_ART_JSON__", JSON.stringify(artDataUrl))
    .replace("__SKIN_HERO_ART_JSON__", JSON.stringify(heroArtDataUrl))
    .replace("__SKIN_VIDEO_JSON__", JSON.stringify(videoArtSource))
    .replace("__SKIN_INTERACTIVE_ATLAS_JSON__", JSON.stringify(
      interactiveAtlasPath ? DEFERRED_INTERACTIVE_ATLAS_SOURCE : null,
    ))
    .replace("__SKIN_BACKGROUND_EFFECT_FACTORY__", backgroundEffects)
    .replace("__SKIN_THEME_JSON__", JSON.stringify(theme))
    .replace("__THEME_STYLE_CATALOG_JSON__", JSON.stringify(styleCatalog))
    .replace("__THEME_EDITOR_LOCALES_JSON__", JSON.stringify(editorLocales))
    .replace("__THEME_STYLE_OVERRIDES_JSON__", JSON.stringify(styleOverrideState.values))
    .replace("__THEME_RUNTIME_PREFERENCES_JSON__", JSON.stringify(styleOverrideState.runtimePreferences ?? {}))
    .replace("__THEME_OVERRIDE_STATE_JSON__", JSON.stringify({
      status: styleOverrideState.status,
      diagnostics: styleOverrideState.diagnostics ?? [],
      quarantine: styleOverrideState.quarantine ?? { entries: [] },
    }))
    .replace("__THEME_STYLE_EDITOR_NONCE_JSON__", JSON.stringify(editorNonce))
    .replace("__THEME_STYLE_EDITOR_BINDING_JSON__", JSON.stringify(STYLE_EDITOR_BINDING))
    .replace("__SKIN_VERSION_JSON__", JSON.stringify(SKIN_VERSION))
    .replace("__SKIN_STYLE_REVISION_JSON__", JSON.stringify(styleRevision));
  const revisionHash = createHash("sha256")
    .update(SKIN_VERSION)
    .update(css)
    .update(template)
    .update(backgroundEffects)
    .update(JSON.stringify(styleCatalog))
    .update(JSON.stringify(editorLocales))
    .update(JSON.stringify(styleOverrideState.values))
    .update(JSON.stringify(styleOverrideState.runtimePreferences ?? {}))
    .update(JSON.stringify(styleOverrideState.quarantine ?? { entries: [] }))
    .update(JSON.stringify(theme))
    .update(art);
  if (heroArt) revisionHash.update(heroArt);
  if (videoPath && videoStat) revisionHash.update(`${videoPath}:${videoStat.dev}:${videoStat.ino}:${videoStat.size}:${videoStat.mtimeMs}`);
  if (interactiveAtlasPath && interactiveAtlasStat) {
    revisionHash.update(`${interactiveAtlasPath}:${interactiveAtlasStat.dev}:${interactiveAtlasStat.ino}:${interactiveAtlasStat.size}:${interactiveAtlasStat.mtimeMs}`);
  }
  const revision = revisionHash.digest("hex").slice(0, 20);
  return {
    imageBytes: art.length,
    heroImageBytes: heroImageStat?.size ?? 0,
    videoBytes: videoStat?.size ?? 0,
    videoEnabled: Boolean(videoPath),
    videoPath,
    videoStat,
    backgroundRenderMode: theme.interactiveBackground?.type ?? "media",
    interactiveAtlasBytes: interactiveAtlasStat?.size ?? 0,
    interactiveAtlasPath,
    interactiveAtlasStat,
    interactiveAtlasMetadata,
    styleCatalog,
    styleOverrides: styleOverrideState.values,
    runtimePreferences: styleOverrideState.runtimePreferences ?? {},
    styleOverrideStatus: styleOverrideState.status,
    styleOverrideQuarantine: styleOverrideState.quarantine ?? { entries: [] },
    styleOverrideDiagnostics: styleOverrideState.diagnostics ?? [],
    editorNonce,
    heroImageSource: heroImagePath
      ? "dedicated"
      : theme.appearance.newTaskLayout === "banner" ? "main-background-fallback" : "not-used",
    payload,
    revision,
    theme,
    timings: {
      buildMs: Number((performance.now() - startedAt).toFixed(3)),
      staticCacheHit: staticAssets.cacheHit,
    },
  };
}

async function applyToSession(session, payload) {
  return session.evaluate(payload);
}

async function documentIdentity(session) {
  const tree = await session.send("Page.getFrameTree");
  const frame = tree?.frameTree?.frame;
  const frameId = typeof frame?.id === "string" ? frame.id : "";
  const loaderId = typeof frame?.loaderId === "string" ? frame.loaderId : "";
  if (!frameId || !loaderId || frameId.length > 128 || loaderId.length > 128) {
    throw new Error("CDP did not provide a bounded main-document identity");
  }
  return `${frameId}:${loaderId}`;
}

async function beginRendererGeneration(session, runtimeGeneration, payloadGeneration, documentId) {
  return session.evaluate(`(() => {
    window.__CC_THEME_RUNTIME_GENERATION_ACTIVE__ = ${JSON.stringify(runtimeGeneration)};
    window.__CC_THEME_PAYLOAD_GENERATION_ACTIVE__ = ${JSON.stringify(payloadGeneration)};
    window.__CC_THEME_DOCUMENT_ID_ACTIVE__ = ${JSON.stringify(documentId)};
    window.__CC_THEME_RUNTIME_GENERATION_READY__ = null;
    return true;
  })()`);
}

async function commitRendererGeneration(session, runtimeGeneration, payloadGeneration, documentId) {
  return session.evaluate(`(() => {
    if (window.__CC_THEME_RUNTIME_GENERATION_ACTIVE__ !== ${JSON.stringify(runtimeGeneration)} ||
        window.__CC_THEME_PAYLOAD_GENERATION_ACTIVE__ !== ${JSON.stringify(payloadGeneration)} ||
        window.__CC_THEME_DOCUMENT_ID_ACTIVE__ !== ${JSON.stringify(documentId)}) return false;
    window.__CC_THEME_RUNTIME_GENERATION_READY__ = ${JSON.stringify(runtimeGeneration)};
    window.__CC_THEME_PAYLOAD_GENERATION_READY__ = ${JSON.stringify(payloadGeneration)};
    return true;
  })()`);
}

async function transferDeferredAsset(session, loaded, options) {
  const {
    filePath, fileStat, setterName, transferKey, mimeType, label,
    runtimeGeneration = null, payloadGeneration = null, isCurrent = null,
  } = options;
  if (!filePath || !fileStat) return { transferred: false, bytes: 0 };
  const generationCheck = runtimeGeneration
    ? `window.__CC_THEME_RUNTIME_GENERATION_ACTIVE__ === ${JSON.stringify(runtimeGeneration)} &&
       window.__CC_THEME_PAYLOAD_GENERATION_ACTIVE__ === ${JSON.stringify(payloadGeneration)}`
    : "true";
  if (isCurrent && !isCurrent()) throw new Error(`Superseded deferred ${label}`);
  const transferId = randomBytes(18).toString("hex");
  const themeId = String(loaded.theme.id);
  const expectedBytes = fileStat.size;
  const initialized = await session.evaluate(`(() => {
    const state = window.__CC_THEME_STATE__;
    if (!(${generationCheck}) || typeof state?.[${JSON.stringify(setterName)}] !== "function" ||
        state.themeId !== ${JSON.stringify(themeId)}) return false;
    window[${JSON.stringify(transferKey)}] = {
      id: ${JSON.stringify(transferId)}, parts: [], bytes: 0, expected: ${expectedBytes}
    };
    return true;
  })()`);
  if (!initialized) throw new Error(`Renderer is not ready for the deferred ${label}`);

  let handle;
  try {
    handle = await fs.open(filePath, OPEN_FLAGS);
    const before = await handle.stat();
    if (!sameStat(before, fileStat)) throw new Error(`${label} changed before deferred transfer`);
    const buffer = Buffer.allocUnsafe(VIDEO_TRANSFER_CHUNK_BYTES);
    let position = 0;
    while (position < expectedBytes) {
      if (isCurrent && !isCurrent()) throw new Error(`Superseded deferred ${label}`);
      const length = Math.min(buffer.length, expectedBytes - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (!bytesRead) throw new Error(`${label} ended during deferred transfer`);
      const base64 = buffer.subarray(0, bytesRead).toString("base64");
      const accepted = await session.evaluate(`(() => {
        const transfer = window[${JSON.stringify(transferKey)}];
        if (!(${generationCheck}) || !transfer || transfer.id !== ${JSON.stringify(transferId)}) return false;
        const binary = atob(${JSON.stringify(base64)});
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        transfer.parts.push(bytes);
        transfer.bytes += bytes.length;
        return true;
      })()`);
      if (!accepted) throw new Error(`Renderer navigated during deferred ${label} transfer`);
      position += bytesRead;
    }
    const after = await handle.stat();
    if (!sameStat(before, after)) throw new Error(`${label} changed during deferred transfer`);
    if (isCurrent && !isCurrent()) throw new Error(`Superseded deferred ${label}`);
    const committed = await session.evaluate(`(() => {
      const transfer = window[${JSON.stringify(transferKey)}];
      if (!(${generationCheck}) || !transfer || transfer.id !== ${JSON.stringify(transferId)} ||
          transfer.bytes !== transfer.expected || transfer.bytes !== ${expectedBytes}) return false;
      const source = URL.createObjectURL(new Blob(transfer.parts, { type: ${JSON.stringify(mimeType)} }));
      delete window[${JSON.stringify(transferKey)}];
      const state = window.__CC_THEME_STATE__;
      const accepted = state?.[${JSON.stringify(setterName)}]?.(source, ${JSON.stringify(themeId)}) === true;
      if (!accepted) URL.revokeObjectURL(source);
      return accepted;
    })()`);
    if (!committed) throw new Error(`Renderer rejected the deferred ${label}`);
    return { transferred: true, bytes: expectedBytes };
  } catch (error) {
    await session.evaluate(`(() => {
      if (window[${JSON.stringify(transferKey)}]?.id === ${JSON.stringify(transferId)}) {
        delete window[${JSON.stringify(transferKey)}];
      }
    })()`).catch(() => {});
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function transferDeferredVideo(session, loaded, generation = {}) {
  return transferDeferredAsset(session, loaded, {
    filePath: loaded?.videoPath,
    fileStat: loaded?.videoStat,
    setterName: "setDeferredVideoSource",
    transferKey: "__CC_THEME_VIDEO_TRANSFER__",
    mimeType: "video/mp4",
    label: "background video",
    ...generation,
  });
}

export async function transferDeferredInteractiveAtlas(session, loaded, generation = {}) {
  return transferDeferredAsset(session, loaded, {
    filePath: loaded?.interactiveAtlasPath,
    fileStat: loaded?.interactiveAtlasStat,
    setterName: "setDeferredInteractiveAtlasSource",
    transferKey: "__CC_THEME_INTERACTIVE_ATLAS_TRANSFER__",
    mimeType: "image/webp",
    label: "directional background atlas",
    ...generation,
  });
}

async function transferDeferredMedia(session, loaded, generation = {}) {
  const video = await transferDeferredVideo(session, loaded, generation);
  const interactiveAtlas = await transferDeferredInteractiveAtlas(session, loaded, generation);
  return { video, interactiveAtlas };
}

async function removeFromSession(session) {
  return session.evaluate(`(() => {
    window.__CC_THEME_DISABLED__ = true;
    const state = window.__CC_THEME_STATE__;
    if (state?.cleanup) return state.cleanup();
    const video = document.querySelector('#cc-theme-video-layer video');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    document.documentElement?.classList.remove('cc-theme');
    document.documentElement?.removeAttribute('data-skin-video');
    document.documentElement?.removeAttribute('data-skin-video-playback');
    document.documentElement?.removeAttribute('data-skin-background-mode');
    document.documentElement?.removeAttribute('data-skin-interactive-state');
    document.documentElement?.style.removeProperty('--skin-art');
    document.documentElement?.style.removeProperty('--skin-hero-art');
    document.getElementById('cc-theme-style')?.remove();
    document.getElementById('cc-theme-chrome')?.remove();
    document.getElementById('cc-theme-video-layer')?.remove();
    document.getElementById('cc-theme-interactive-layer')?.remove();
    document.getElementById('cc-theme-video-toggle')?.remove();
    delete window.__CC_THEME_STATE__;
    return true;
  })()`);
}

async function verifyRemovedSession(session) {
  return session.evaluate(`(() =>
    !document.documentElement.classList.contains('cc-theme') &&
    !document.documentElement.hasAttribute('data-skin-video') &&
    !document.documentElement.hasAttribute('data-skin-video-playback') &&
    !document.documentElement.hasAttribute('data-skin-background-mode') &&
    !document.documentElement.hasAttribute('data-skin-interactive-state') &&
    !document.getElementById('cc-theme-style') &&
    !document.getElementById('cc-theme-chrome') &&
    !document.getElementById('cc-theme-video-layer') &&
    !document.getElementById('cc-theme-interactive-layer') &&
    !document.getElementById('cc-theme-video-toggle') &&
    !window.__CC_THEME_STATE__
  )()`);
}

async function verifySession(session) {
  return session.evaluate(`(() => {
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.round(r.width), height: Math.round(r.height),
        visible: r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
      };
    };
    const homeIndicator = document.querySelector('[data-testid="home-icon"]');
    const homeSignal = homeIndicator ?? document.querySelector('[data-feature="game-source"]') ??
      document.querySelector('.group\\\\/home-suggestions');
    const homeRoute = homeSignal?.closest('[role="main"]') ?? null;
    // Video themes intentionally preserve Codex's native New Task geometry and
    // therefore do not add the skin-home class. Verification must still inspect that
    // native route instead of treating the absence of the styling class as a
    // missing home surface.
    const home = document.querySelector('[role="main"].skin-home') ?? homeRoute;
    const newTaskLayout = document.documentElement.getAttribute('data-skin-home-layout') || 'cards';
    const nativeHeading = homeIndicator?.parentElement
      ? [...homeIndicator.parentElement.children].find((node) => {
          if (node === homeIndicator) return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }) ?? null
      : null;
    const heading = box(home?.querySelector('[data-skin-role="home-heading"]') ??
      home?.querySelector('[data-feature="game-source"]') ?? nativeHeading);
    const suggestions = home?.querySelector('[data-skin-role="home-suggestions"]') ??
      home?.querySelector('.group\\\\/home-suggestions') ?? null;
    const cards = home?.querySelectorAll('[data-skin-role="home-suggestion-card"]');
    const nativeCardButtons = home ? [...home.querySelectorAll('button')].filter((button) => {
      const rect = button.getBoundingClientRect();
      const headingBottom = heading?.y != null ? heading.y + heading.height : 0;
      const composerTop = box(document.querySelector('.composer-surface-chrome'))?.y ?? innerHeight;
      return rect.width >= 120 && rect.height >= 72 &&
        rect.top >= headingBottom && rect.bottom <= composerTop;
    }) : [];
    const cardBoxes = cards?.length
      ? [...cards].map(box)
      : nativeCardButtons.length >= 2
        ? nativeCardButtons.slice(0, 6).map(box)
        : suggestions ? [...suggestions.querySelectorAll('button')].map(box) : [];
    const visibleCards = cardBoxes.filter((item) => item?.visible);
    const hero = box(home?.querySelector('[data-skin-role="home-hero"]'));
    const projectButton = box(home?.querySelector('.group\\\\/project-selector > button'));
    const composer = box(document.querySelector('[data-skin-role="composer"], .composer-surface-chrome'));
    const sidebar = box(document.querySelector(
      '[data-skin-role="sidebar"], [data-skin-role="settings-sidebar"], .app-shell-left-panel'
    ));
    const settingsShell = box(document.querySelector('[data-skin-role="settings-shell"], [data-settings-panel-slug]'));
    const chrome = document.getElementById('cc-theme-chrome');
    const videoState = window.__CC_THEME_STATE__;
    const videoLayerNode = document.getElementById('cc-theme-video-layer');
    const videoNode = videoLayerNode?.querySelector('video') ?? null;
    const videoScrimStyle = videoLayerNode ? getComputedStyle(videoLayerNode, '::after') : null;
    const interactiveLayerNode = document.getElementById('cc-theme-interactive-layer');
    const interactiveCanvasNode = interactiveLayerNode?.querySelector('canvas') ?? null;
    const interactiveScrimStyle = interactiveLayerNode ? getComputedStyle(interactiveLayerNode, '::after') : null;
    const headerSurface = document.querySelector('[data-testid="app-shell-header-context-menu-surface"]');
    let pinnedSummaryButton = headerSurface
      ? [...headerSurface.querySelectorAll('button[aria-pressed]')].find((button) => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }) || null
      : null;
    if (!pinnedSummaryButton && headerSurface) {
      const row = [...headerSurface.children].find((node) =>
        node.classList?.contains('ms-auto') && node.classList.contains('gap-1.5')) || null;
      const candidates = row ? [...row.querySelectorAll('button[aria-pressed]:not([data-skin-owned])')] : [];
      if (candidates.length === 1) pinnedSummaryButton = candidates[0];
    }
    const headerShell = headerSurface?.closest('header') || null;
    const headerSurfaceIndex = headerShell && headerSurface
      ? [...headerShell.children].indexOf(headerSurface)
      : -1;
    const trailingActionContainer = headerShell && headerSurfaceIndex >= 0
      ? [...headerShell.children].find((node, index) =>
          index > headerSurfaceIndex && !node.classList?.contains('invisible') &&
          node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 &&
          node.querySelector('button:not([data-skin-owned])')) || null
      : null;
    const trailingActionRow = trailingActionContainer
      ? [...trailingActionContainer.children].find((node) =>
          node.querySelector('button:not([data-skin-owned])')) || null
      : null;
    const trailingReferenceWrapper = trailingActionRow
      ? [...trailingActionRow.children].find((node) =>
          !node.hasAttribute('data-skin-owned') && !node.querySelector('[data-skin-owned]') &&
          node.querySelector('button')) || null
      : null;
    const trailingReferenceButton = trailingReferenceWrapper?.querySelector('button') || null;
    const summaryActionWrapper = pinnedSummaryButton?.closest('div.no-drag.pointer-events-auto.flex.shrink-0.items-center') || null;
    const videoToggleWrapper = document.getElementById('cc-theme-video-toggle-wrapper');
    const videoToggle = document.getElementById('cc-theme-video-toggle');
    const videoToggleAnchorKind = videoToggleWrapper?.dataset.skinAnchorKind || null;
    const absoluteAnchorKinds = new Set(['summary-actions', 'header-content-actions', 'header-trailing-actions']);
    const markedVideoToggleAnchor = videoToggleWrapper && videoToggleAnchorKind
      ? videoToggleWrapper.closest('[data-skin-video-control-anchor="' + videoToggleAnchorKind + '"]')
      : null;
    const anchoredReferenceButton = markedVideoToggleAnchor
      ? [...markedVideoToggleAnchor.querySelectorAll('button:not([data-skin-owned])')].find((button) => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }) || null
      : null;
    const markedReferenceButton = pinnedSummaryButton && markedVideoToggleAnchor?.contains(pinnedSummaryButton)
      ? pinnedSummaryButton
      : anchoredReferenceButton;
    const adjacentReferenceWrapper = videoToggleWrapper?.nextElementSibling ?? null;
    const adjacentReferenceButton = adjacentReferenceWrapper?.querySelector('button:not([data-skin-owned])') ?? null;
    const videoToggleReference = markedReferenceButton || pinnedSummaryButton || adjacentReferenceButton || trailingReferenceButton;
    const videoToggleStyleMatchesReference = Boolean(videoToggle && videoToggleReference && (() => {
      const ownedStyle = getComputedStyle(videoToggle);
      const referenceStyle = getComputedStyle(videoToggleReference);
      const ownedSvgStyle = getComputedStyle(videoToggle.querySelector('svg') || videoToggle);
      const referenceSvgStyle = getComputedStyle(videoToggleReference.querySelector('svg') || videoToggleReference);
      const ownedPathStyle = getComputedStyle(videoToggle.querySelector('path') || videoToggle);
      const referencePathStyle = getComputedStyle(videoToggleReference.querySelector('path') || videoToggleReference);
      return ownedStyle.color === referenceStyle.color &&
        ownedStyle.opacity === referenceStyle.opacity &&
        ownedStyle.backgroundColor === referenceStyle.backgroundColor &&
        ownedStyle.borderColor === referenceStyle.borderColor &&
        ownedSvgStyle.color === referenceSvgStyle.color &&
        ownedSvgStyle.opacity === referenceSvgStyle.opacity &&
        ownedPathStyle.fill === referencePathStyle.fill;
    })());
    const videoTogglePlacementValid = Boolean(videoToggle && videoToggleWrapper &&
      videoToggleWrapper.contains(videoToggle) && (
        absoluteAnchorKinds.has(videoToggleAnchorKind)
          ? markedVideoToggleAnchor && markedReferenceButton && (() => {
              const parentMatchesAnchor = videoToggleWrapper.parentElement === markedVideoToggleAnchor;
              const owned = videoToggle.getBoundingClientRect();
              const reference = markedReferenceButton.getBoundingClientRect();
              const gap = reference.left - owned.right;
              const centerDelta = Math.abs(
                (owned.top + owned.height / 2) - (reference.top + reference.height / 2)
              );
              return parentMatchesAnchor && owned.left >= 0 && owned.right <= innerWidth &&
                gap >= 4 && gap <= 8 && centerDelta <= 2;
            })()
          : pinnedSummaryButton
            ? videoToggleWrapper.parentElement === summaryActionWrapper?.parentElement &&
              videoToggleWrapper.nextElementSibling === summaryActionWrapper
            : adjacentReferenceButton && adjacentReferenceWrapper &&
              videoToggleWrapper.parentElement === adjacentReferenceWrapper.parentElement
      ));
    const videoTogglePlacement = videoToggle && videoToggleReference ? (() => {
      const owned = videoToggle.getBoundingClientRect();
      const reference = videoToggleReference.getBoundingClientRect();
      return {
        anchorKind: videoToggleAnchorKind,
        parentMatchesAnchor: videoToggleWrapper?.parentElement === markedVideoToggleAnchor,
        owned: { x: owned.x, y: owned.y, width: owned.width, height: owned.height },
        reference: { x: reference.x, y: reference.y, width: reference.width, height: reference.height },
        gap: reference.left - owned.right,
        centerDelta: Math.abs((owned.top + owned.height / 2) - (reference.top + reference.height / 2)),
      };
    })() : null;
    const root = document.documentElement;
    const skinAppearanceActive = root.classList.contains('cc-theme');
    const visibleElement = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
    };
    const visibleElements = (selector, scope = document) =>
      [...scope.querySelectorAll(selector)].filter(visibleElement);
    const paintSnapshot = (node, pseudo = null) => {
      if (!node) return null;
      const style = getComputedStyle(node, pseudo);
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        outlineColor: style.outlineColor,
        fontFamily: style.fontFamily,
        objectPosition: style.objectPosition,
      };
    };
    const tokenProbe = document.createElement('span');
    tokenProbe.setAttribute('data-skin-owned', 'semantic-verification-probe');
    tokenProbe.setAttribute('aria-hidden', 'true');
    tokenProbe.style.cssText = 'position:fixed!important;left:-1px!important;top:-1px!important;' +
      'width:1px!important;height:1px!important;visibility:hidden!important;pointer-events:none!important;';
    document.body?.appendChild(tokenProbe);
    const resolveToken = (name, property = 'color') => {
      const raw = root.style.getPropertyValue(name).trim();
      if (!raw || !tokenProbe.isConnected) return { raw, resolved: '' };
      tokenProbe.style.removeProperty(property);
      tokenProbe.style.setProperty(property, 'var(' + name + ')', 'important');
      const resolved = getComputedStyle(tokenProbe).getPropertyValue(property).trim();
      tokenProbe.style.removeProperty(property);
      return { raw, resolved };
    };
    const semanticTokens = {
      text: resolveToken('--skin-text'),
      muted: resolveToken('--skin-muted'),
      textStrong: resolveToken('--skin-text-strong'),
      focusRing: resolveToken('--skin-focus-ring'),
      surfaceBase: resolveToken('--skin-surface-base', 'background-color'),
      surfaceRaised: resolveToken('--skin-surface-raised', 'background-color'),
      sidebarSurface: resolveToken('--skin-sidebar-surface', 'background-color'),
      composerSurface: resolveToken('--skin-composer-surface', 'background-color'),
      fontDisplay: resolveToken('--skin-font-display', 'font-family'),
      fontUi: resolveToken('--skin-font-ui', 'font-family'),
      artPosition: { raw: root.style.getPropertyValue('--skin-art-position').trim(), resolved: '' },
      videoPosition: { raw: root.style.getPropertyValue('--skin-video-position').trim(), resolved: '' },
    };
    tokenProbe.remove();
    const requiredSemanticVariables = [
      'text', 'muted', 'textStrong', 'focusRing', 'surfaceBase', 'surfaceRaised',
      'sidebarSurface', 'composerSurface', 'fontDisplay', 'fontUi', 'artPosition',
    ];
    const missingSemanticVariables = requiredSemanticVariables.filter((name) => !semanticTokens[name].raw);
    const aliasBindings = {
      text: root.style.getPropertyValue('--color-text-foreground').trim(),
      muted: root.style.getPropertyValue('--color-text-foreground-secondary').trim(),
      focus: root.style.getPropertyValue('--color-border-focus').trim(),
      surface: root.style.getPropertyValue('--color-background-surface').trim(),
    };
    const aliasPass = aliasBindings.text === 'var(--skin-text)' &&
      aliasBindings.muted === 'var(--skin-muted)' &&
      aliasBindings.focus === 'var(--skin-focus-ring)' &&
      aliasBindings.surface === 'var(--skin-surface-base)';
    const semanticMainNode = document.querySelector('[data-skin-role="main-content"]');
    const semanticSidebarNode = document.querySelector(
      '[data-skin-role="sidebar"], [data-skin-role="settings-sidebar"]'
    );
    const semanticComposerNode = document.querySelector('[data-skin-role="composer"]');
    const semanticSettingsNode = document.querySelector('[data-skin-role="settings-shell"]');
    const nativeMainNode = document.querySelector('[data-app-shell-main-content-layout], main.main-surface');
    const nativeSidebarNode = document.querySelector('.app-shell-left-panel');
    const nativeComposerNode = document.querySelector('.composer-surface-chrome');
    const runtimeLandmarks = {
      main: { native: Boolean(nativeMainNode), owned: Boolean(semanticMainNode), visible: visibleElement(nativeMainNode) },
      sidebar: { native: Boolean(nativeSidebarNode), owned: Boolean(semanticSidebarNode), visible: visibleElement(nativeSidebarNode) },
      composer: { native: Boolean(nativeComposerNode), owned: Boolean(semanticComposerNode), visible: visibleElement(nativeComposerNode) },
      settings: { native: Boolean(settingsShell), owned: Boolean(semanticSettingsNode), visible: Boolean(settingsShell?.visible) },
    };
    const roleLandmarkPass = runtimeLandmarks.settings.visible
      ? runtimeLandmarks.settings.owned && runtimeLandmarks.sidebar.owned
      : runtimeLandmarks.main.owned && runtimeLandmarks.sidebar.owned && runtimeLandmarks.composer.owned &&
        runtimeLandmarks.main.visible && runtimeLandmarks.sidebar.visible && runtimeLandmarks.composer.visible;
    const headingCandidates = visibleElements(
      '[data-app-shell-main-content-layout] h1, [data-app-shell-main-content-layout] h2, ' +
      '[data-app-shell-main-content-layout] h3, [data-app-shell-main-content-layout] [role="heading"], ' +
      'main.main-surface h1, main.main-surface h2, main.main-surface h3, ' +
      'main.main-surface [role="heading"], [data-skin-role="home-heading"]'
    );
    const bodyCandidates = visibleElements(
      '[data-app-shell-main-content-layout] p, [data-app-shell-main-content-layout] article, ' +
      '[data-app-shell-main-content-layout] [role="article"], [data-message-author-role], ' +
      'main.main-surface p, main.main-surface article, main.main-surface [role="article"]'
    );
    const displayFontCandidates = visibleElements('[data-skin-role="home-heading"]');
    const mutedCandidates = visibleElements(
      '[data-app-shell-main-content-layout] small, [data-app-shell-main-content-layout] [class*="muted"], ' +
      '[data-app-shell-main-content-layout] [class*="description"], ' +
      '.app-shell-left-panel small, .app-shell-left-panel [class*="muted"], ' +
      '.app-shell-left-panel [class*="description"], [data-skin-role="home-suggestion-label"]'
    );
    const colorMatchCount = (nodes, expected) => expected
      ? [...nodes].filter((node) => getComputedStyle(node).color === expected).length : 0;
    const titleStrongMatches = colorMatchCount(headingCandidates, semanticTokens.textStrong.resolved);
    const displayFontMatches = semanticTokens.fontDisplay.resolved
      ? displayFontCandidates.filter((node) =>
          getComputedStyle(node).fontFamily === semanticTokens.fontDisplay.resolved).length : 0;
    const bodyTextMatches = colorMatchCount(bodyCandidates, semanticTokens.text.resolved);
    const mutedMatches = colorMatchCount(mutedCandidates, semanticTokens.muted.resolved);
    const textConsumers = {
      title: { candidates: headingCandidates.length, colorMatches: titleStrongMatches },
      displayFont: { candidates: displayFontCandidates.length, matches: displayFontMatches },
      body: { candidates: bodyCandidates.length, colorMatches: bodyTextMatches },
      muted: { candidates: mutedCandidates.length, colorMatches: mutedMatches },
    };
    const titleConsumerPass = !headingCandidates.length || titleStrongMatches > 0;
    const displayFontConsumerPass = !displayFontCandidates.length || displayFontMatches > 0;
    const bodyConsumerPass = !bodyCandidates.length || bodyTextMatches > 0;
    // Secondary content is route-dependent; the host alias is the hard gate.
    // A live match remains part of the report and the independent visual QA.
    const mutedConsumerObserved = mutedMatches > 0;
    const composerPaint = paintSnapshot(nativeComposerNode);
    const sidebarPaint = paintSnapshot(nativeSidebarNode);
    const sidebarLayerPaint = paintSnapshot(nativeSidebarNode, '::before');
    const mainPaint = paintSnapshot(nativeMainNode);
    const settingsPaint = paintSnapshot(document.querySelector('[data-skin-role="settings-content"]'));
    const transparentPaint = (value) => ['rgba(0, 0, 0, 0)', 'transparent'].includes(value);
    const composerSurfacePass = runtimeLandmarks.settings.visible
      ? Boolean(settingsPaint || paintSnapshot(semanticSettingsNode))
      : composerPaint?.backgroundColor === semanticTokens.composerSurface.resolved;
    const sidebarSurfacePass = runtimeLandmarks.settings.visible
      ? Boolean(sidebarPaint) && !transparentPaint(sidebarPaint.backgroundColor)
      : Boolean(sidebarPaint) && transparentPaint(sidebarPaint.backgroundColor) &&
        Boolean(sidebarLayerPaint) && !transparentPaint(sidebarLayerPaint.backgroundColor);
    const mainSurfacePass = Boolean(mainPaint) && transparentPaint(mainPaint.backgroundColor);
    const surfaceConsumers = {
      main: mainPaint,
      sidebar: sidebarPaint,
      sidebarLayer: sidebarLayerPaint,
      composer: composerPaint,
      settings: settingsPaint,
    };
    const focusWithinNode = document.querySelector('.composer-surface-chrome:focus-within, :focus-visible');
    const focusPaint = paintSnapshot(focusWithinNode);
    const focusObserved = Boolean(focusPaint && [focusPaint.borderColor, focusPaint.outlineColor]
      .includes(semanticTokens.focusRing.resolved));
    const videoPaint = paintSnapshot(videoNode);
    const backgroundPositionPass = videoNode && visibleElement(videoNode)
      ? videoPaint?.objectPosition === semanticTokens.videoPosition.raw
      : Boolean(semanticTokens.artPosition.raw);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const reducedMotionPass = !reducedMotion ||
      videoState?.videoPlaybackPreference === 'disabled' ||
      ['paused', 'reduced-motion'].includes(videoNode?.dataset.skinPlaybackState || '') ||
      ['static', 'fallback'].includes(videoState?.interactiveRuntimeState || '');
    const semanticDiagnostics = [];
    if (missingSemanticVariables.length) semanticDiagnostics.push('semantic-style-variable-missing');
    if (!aliasPass) semanticDiagnostics.push('semantic-host-alias-mismatch');
    if (!roleLandmarkPass) semanticDiagnostics.push('semantic-landmark-missing');
    if (!titleConsumerPass) semanticDiagnostics.push('semantic-display-consumer-mismatch');
    if (!displayFontConsumerPass) semanticDiagnostics.push('semantic-display-font-consumer-mismatch');
    if (!bodyConsumerPass) semanticDiagnostics.push('semantic-body-consumer-mismatch');
    if (!mutedConsumerObserved) semanticDiagnostics.push('semantic-muted-consumer-not-observed');
    if (!(mainSurfacePass && sidebarSurfacePass && composerSurfacePass)) {
      semanticDiagnostics.push('semantic-surface-consumer-mismatch');
    }
    if (!backgroundPositionPass) semanticDiagnostics.push('semantic-background-position-mismatch');
    if (!reducedMotionPass) semanticDiagnostics.push('semantic-reduced-motion-mismatch');
    const semanticStyleEvidence = {
      privacyProfile: 'structural-computed-style-only-v1',
      tokens: semanticTokens,
      missingVariables: missingSemanticVariables,
      aliasBindings,
      runtimeLandmarks,
      textConsumers,
      mutedConsumerObserved,
      surfaceConsumers,
      focus: { available: Boolean(focusWithinNode), observed: focusObserved, paint: focusPaint },
      background: { video: videoPaint, positionMatches: backgroundPositionPass },
      accessibility: { reducedMotion, pass: reducedMotionPass },
      diagnostics: semanticDiagnostics,
      pass: missingSemanticVariables.length === 0 && aliasPass && roleLandmarkPass &&
        titleConsumerPass && displayFontConsumerPass && bodyConsumerPass &&
        mainSurfacePass && sidebarSurfacePass &&
        composerSurfacePass && backgroundPositionPass && reducedMotionPass,
    };
    const inspectedInlineVariables = [
      '--skin-art', '--skin-active-art', '--skin-hero-art', '--skin-text',
      '--color-text-foreground', '--color-background-accent', '--vscode-editor-background',
    ];
    const nativeAppearanceResiduals = {
      themeBridge: root.hasAttribute('data-skin-theme-bridge'),
      themeId: root.hasAttribute('data-skin-theme-id'),
      shell: root.hasAttribute('data-skin-shell'),
      route: root.hasAttribute('data-skin-route'),
      roleMarkers: document.querySelectorAll('[data-skin-marker], [data-skin-role]').length,
      homeClasses: document.querySelectorAll('.skin-home, .skin-home-shell').length,
      appMount: Boolean(document.querySelector('[data-skin-app-mount]')),
      inlineVariables: inspectedInlineVariables.filter((name) => root.style.getPropertyValue(name).trim()),
      inlineVariableMismatches: inspectedInlineVariables.filter((name) => {
        const original = videoState?.rootStyleSnapshot?.[name] ?? { value: '', priority: '' };
        return root.style.getPropertyValue(name) !== (original.value || '') ||
          root.style.getPropertyPriority(name) !== (original.priority || '');
      }),
    };
    const activeArtValue = document.documentElement.style.getPropertyValue('--skin-active-art').trim();
    const result = {
      installed: Boolean(videoState),
      version: window.__CC_THEME_STATE__?.version ?? null,
      skinAppearanceActive,
      appearanceBypassed: videoState?.videoPlaybackPreference === 'disabled' && !skinAppearanceActive,
      semanticStyleEvidence,
      nativeAppearanceResiduals,
      stylePresent: Boolean(document.getElementById('cc-theme-style')),
      chromePresent: Boolean(chrome),
      chromePointerEvents: getComputedStyle(chrome || document.body).pointerEvents,
      videoEnabled: Boolean(videoState?.videoEnabled),
      videoPosterMode: videoState?.videoPosterMode ?? null,
      videoScrimOpacity: videoState?.videoScrimOpacity ?? null,
      videoScrim: videoScrimStyle ? {
        opacity: Number(videoScrimStyle.opacity),
        backgroundColor: videoScrimStyle.backgroundColor,
        pointerEvents: videoScrimStyle.pointerEvents,
      } : null,
      videoPlaybackPreference: videoState?.videoPlaybackPreference ?? null,
      videoPresentation: document.documentElement.getAttribute('data-skin-video'),
      videoPlaybackState: document.documentElement.getAttribute('data-skin-video-playback'),
      videoLayer: box(videoLayerNode),
      videoLayerPointerEvents: getComputedStyle(videoLayerNode || document.body).pointerEvents,
      videoElementPointerEvents: getComputedStyle(videoNode || document.body).pointerEvents,
      videoAttributes: videoNode ? {
        muted: videoNode.muted,
        loop: videoNode.loop,
        playsInline: videoNode.playsInline,
        paused: videoNode.paused,
        currentTime: Number(videoNode.currentTime.toFixed(3)),
        posterPresent: Boolean(videoNode.poster),
        state: videoNode.dataset.skinPlaybackState || null,
        sourceKind: videoNode.currentSrc.startsWith('blob:') ? 'blob'
          : videoNode.currentSrc ? 'other' : 'missing',
        readyState: videoNode.readyState,
        networkState: videoNode.networkState,
        // MediaError.message may embed a source URL. Verification reports only
        // the stable numeric code so diagnostics never expose media origins.
        error: videoNode.error ? { code: videoNode.error.code } : null,
      } : null,
      backgroundRenderMode: videoState?.backgroundRenderMode ?? 'media',
      interactiveEnabled: Boolean(videoState?.interactiveEnabled),
      interactiveRuntimeState: videoState?.interactiveRuntimeState ?? null,
      interactiveScrimOpacity: videoState?.interactiveScrimOpacity ?? null,
      interactivePresentation: root.getAttribute('data-skin-background-mode'),
      interactiveState: root.getAttribute('data-skin-interactive-state'),
      interactiveLayer: box(interactiveLayerNode),
      interactiveLayerPointerEvents: getComputedStyle(interactiveLayerNode || document.body).pointerEvents,
      interactiveCanvasPresent: Boolean(interactiveCanvasNode),
      interactiveScrim: interactiveScrimStyle ? {
        opacity: Number(interactiveScrimStyle.opacity),
        pointerEvents: interactiveScrimStyle.pointerEvents,
      } : null,
      activeArtState: activeArtValue === 'none' ? 'none' : activeArtValue ? 'present' : 'absent',
      staticArtworkPaintCount: (() => {
        const rawArt = document.documentElement.style.getPropertyValue('--skin-art');
        const match = rawArt.match(/url\(["']?([^"')]+)["']?\)/);
        if (!match?.[1]) return 0;
        return [...document.querySelectorAll('*')].filter((node) => {
          const style = getComputedStyle(node);
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            style.backgroundImage.includes(match[1]);
        }).length;
      })(),
      videoTogglePresent: Boolean(videoToggle),
      videoToggleReferenceKind: videoToggleAnchorKind ||
        (pinnedSummaryButton ? 'pinned-summary' : trailingReferenceButton ? 'header-trailing-actions' : null),
      videoTogglePlacement,
      videoTogglePlacementValid,
      videoToggleStyleMatchesReference,
      homeRoute: Boolean(homeRoute),
      homePresent: Boolean(home),
      newTaskLayout,
      heading,
      hero,
      cards: cardBoxes,
      visibleCardCount: visibleCards.length,
      projectButton,
      composer,
      sidebar,
      settingsShell,
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflow: {
        x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      },
    };
    const primarySurfacePass = Boolean(result.settingsShell?.visible) ||
      (Boolean(result.composer?.visible) && Boolean(result.sidebar?.visible));
    const basePass = result.installed && result.version === ${JSON.stringify(SKIN_VERSION)} &&
      result.stylePresent && result.chromePresent && result.chromePointerEvents === 'none' &&
      primarySurfacePass && !result.documentOverflow.x &&
      (!result.skinAppearanceActive || result.semanticStyleEvidence.pass);
    const posterPass = result.videoPosterMode === 'image'
      ? result.videoAttributes?.posterPresent
      : !result.videoAttributes?.posterPresent && result.activeArtState === 'none' &&
        result.staticArtworkPaintCount === 0;
    const disabledVideoPass = result.videoPlaybackPreference === 'disabled' && result.appearanceBypassed &&
      result.videoPresentation === 'disabled' && result.videoPlaybackState === 'disabled' &&
      !result.videoLayer?.visible && result.videoAttributes?.state === 'disabled' &&
      result.activeArtState === 'absent' && result.staticArtworkPaintCount === 0 &&
      !result.nativeAppearanceResiduals.themeBridge && !result.nativeAppearanceResiduals.themeId &&
      !result.nativeAppearanceResiduals.shell && !result.nativeAppearanceResiduals.route &&
      result.nativeAppearanceResiduals.roleMarkers === 0 &&
      result.nativeAppearanceResiduals.homeClasses === 0 &&
      !result.nativeAppearanceResiduals.appMount &&
      result.nativeAppearanceResiduals.inlineVariableMismatches.length === 0;
    const sourcePass = result.videoAttributes?.sourceKind === 'blob' &&
      result.videoAttributes.readyState >= 2 && !result.videoAttributes.error;
    const scrimPass = result.videoScrim && result.videoScrim.pointerEvents === 'none' &&
      Math.abs(result.videoScrim.opacity - result.videoScrimOpacity) < 0.001;
    const runtimePlaybackPass = result.videoPlaybackPreference === 'paused'
      ? result.videoAttributes?.state === 'paused'
      : ['playing', 'reduced-motion'].includes(result.videoAttributes?.state);
    const visibleVideoPass = result.videoPlaybackPreference !== 'disabled' &&
      result.videoPresentation === 'enabled' &&
      result.videoPlaybackState === result.videoPlaybackPreference && result.videoLayer?.visible &&
      sourcePass && scrimPass && runtimePlaybackPass && posterPass;
    // Background controls are hosted only in Settings → Appearance. No Theme
    // toolbar action may occupy or shift the native header action area.
    const videoControlPass = !result.videoTogglePresent;
    const videoPass = !result.videoEnabled || ((disabledVideoPass || (sourcePass && visibleVideoPass)) &&
      result.videoLayerPointerEvents === 'none' && result.videoElementPointerEvents === 'none' &&
      result.videoAttributes?.muted && result.videoAttributes?.loop &&
      result.videoAttributes?.playsInline && videoControlPass);
    const interactiveStaticLayerPass = result.backgroundRenderMode === 'ripple'
      ? !result.interactiveLayer?.visible
      : result.interactiveLayer?.visible && result.interactiveCanvasPresent;
    const interactivePass = !result.interactiveEnabled || (
      result.interactivePresentation === result.backgroundRenderMode &&
      result.interactiveState === result.interactiveRuntimeState &&
      ['enabled', 'static', 'fallback'].includes(result.interactiveState) &&
      result.interactiveLayerPointerEvents === 'none' &&
      result.interactiveScrim?.pointerEvents === 'none' &&
      Math.abs(result.interactiveScrim.opacity - result.interactiveScrimOpacity) < 0.001 &&
      (result.interactiveState === 'fallback'
        ? !result.interactiveLayer?.visible
        : result.interactiveState === 'static'
          ? interactiveStaticLayerPass
          : result.interactiveLayer?.visible && result.interactiveCanvasPresent) &&
      !result.videoTogglePresent
    );
    // Project selector markup varies across Codex builds — soft requirement.
    const cardsHomePass = result.newTaskLayout === 'cards' && result.homePresent &&
      result.heading?.visible && result.composer?.visible && !result.hero;
    const bannerHomePass = result.newTaskLayout === 'banner' && result.homePresent &&
      result.hero?.visible && result.hero.width >= 280 && result.hero.height >= 120 &&
      result.visibleCardCount >= 1 && result.visibleCardCount <= 6;
    // Moving backgrounds deliberately preserve the host's current Home layout;
    // suggestion-card count is therefore not an Adapter contract in this mode.
    const nativeMovingBackgroundHomePass = (result.videoEnabled || result.interactiveEnabled) &&
      result.homePresent && result.heading?.visible && result.composer?.visible;
    const homePass = result.videoPlaybackPreference === 'disabled' || !result.homeRoute ||
      nativeMovingBackgroundHomePass || cardsHomePass || bannerHomePass;
    result.pass = Boolean(basePass && videoPass && interactivePass && homePass);
    result.softNotes = {
      projectButtonOptional: !result.projectButton?.visible,
    };
    return result;
  })()`);
}

async function waitForVerifiedSession(session, timeoutMs, expectedRuntimeGeneration = null) {
  const deadline = Date.now() + timeoutMs;
  let lastResult;
  let generationReady = expectedRuntimeGeneration === null;
  while (Date.now() < deadline) {
    lastResult = await verifySession(session);
    if (expectedRuntimeGeneration !== null) {
      generationReady = await session.evaluate(
        `window.__CC_THEME_RUNTIME_GENERATION_READY__ === ${JSON.stringify(expectedRuntimeGeneration)}`,
      );
    }
    if (lastResult.pass && generationReady) return { ...lastResult, runtimeGenerationReady: true };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ...lastResult, pass: false, runtimeGenerationReady: generationReady };
}

async function capture(session, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  const viewport = await session.evaluate("({ width: innerWidth, height: innerHeight })");
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(viewport.width * 0.64),
    y: Math.round(viewport.height * 0.62),
    button: "none",
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const result = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await fs.writeFile(outputPath, Buffer.from(result.data, "base64"));
}

async function runOneShot(options) {
  const connected = await connectCodexTargets(options.port, options.timeoutMs);
  const loaded = (options.mode === "once" || options.reload)
    ? await loadPayload(options.themeDir, { deferredVideo: true }) : null;
  const payload = loaded?.payload ?? null;
  const results = [];
  let screenshotCaptured = false;

  for (const { target, session, probe } of connected) {
    try {
      if (options.mode === "remove") await removeFromSession(session);
      else if (options.mode === "once") await applyToSession(session, payload);

      if (options.reload) {
        await session.send("Page.reload", { ignoreCache: true });
        await new Promise((resolve) => setTimeout(resolve, 1600));
        if (options.mode !== "remove") await applyToSession(session, payload);
      }

      if (loaded && options.mode !== "remove") await transferDeferredMedia(session, loaded);

      const result = options.mode === "remove"
        ? await verifyRemovedSession(session)
        : await waitForVerifiedSession(
          session,
          options.timeoutMs,
          options.mode === "ready" ? options.runtimeGeneration : null,
        );
      results.push({ targetId: target.id, markers: probe.markers, result });

      if (options.screenshot && !screenshotCaptured) {
        await capture(session, options.screenshot);
        screenshotCaptured = true;
      }
    } finally {
      session.close();
    }
  }

  console.log(JSON.stringify({ mode: options.mode, version: SKIN_VERSION, port: options.port, targets: results }, null, 2));
  const failed = results.length === 0 || results.some((item) => options.mode === "remove" ? item.result !== true : !item.result?.pass);
  if (failed) process.exitCode = 2;
}

async function runSurfaceEvidence(options) {
  const connected = await connectCodexTargets(options.port, options.timeoutMs);
  const targets = [];
  for (let ordinal = 0; ordinal < connected.length; ordinal += 1) {
    const { session } = connected[ordinal];
    try {
      const raw = await session.evaluate(buildSurfaceEvidenceExpression());
      targets.push({ ordinal, evidence: assertSurfaceEvidencePrivacy(normalizeSurfaceEvidence(raw)) });
    } finally {
      session.close();
    }
  }
  const report = assertSurfaceEvidencePrivacy({
    kind: "cc-theme.live-surface-evidence-report",
    revision: 1,
    privacyPolicy: "structural-only-v1",
    clientVersionPolicy: "always-latest",
    targetCount: targets.length,
    targets,
  });
  if (options.output) await writeSurfaceEvidence(options.output, report);
  console.log(JSON.stringify(report, null, 2));
}

export function earlyPayloadFor(payload, revision) {
  return `(() => {
    const generationKey = "__CC_THEME_EARLY_GENERATION__";
    const appliedKey = "__CC_THEME_EARLY_APPLIED__";
    const generation = ${JSON.stringify(revision)};
    window[generationKey] = generation;
    let observer = null;
    let timeout = null;
    const stop = () => {
      observer?.disconnect();
      observer = null;
      if (timeout) clearTimeout(timeout);
      timeout = null;
    };
    const install = () => {
      if (window[generationKey] !== generation) { stop(); return true; }
      if (!document.documentElement) return false;
      const shell = document.querySelector('[data-app-shell-main-content-layout], main.main-surface');
      const sidebar = document.querySelector('.app-shell-left-panel');
      if (!shell || !sidebar) return false;
      stop();
      ${payload};
      window[appliedKey] = generation;
      return true;
    };
    if (install()) return;
    if (typeof MutationObserver === "function" && document.documentElement) {
      observer = new MutationObserver(install);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    timeout = setTimeout(stop, 10000);
  })()`;
}

function watchPayloadSources(themeDir, onDirty) {
  if (!themeDir) throw new Error("Theme watch requires an explicit external --theme-dir");
  const themeRoot = themeDir;
  const watchers = [];
  const add = (directory, kind) => {
    let watcher;
    try {
      watcher = watchFs(directory, { persistent: false }, (_event, filename) => {
        const name = filename ? String(filename) : "";
        const staticChanged = (directory === staticAssetsRoot
          && (!name || name === "skin.css" || name === "renderer-inject.js" || name === "background-effects.js")) ||
          (kind === "contract" && (!name || name === "theme-style-catalog.json" || name === "theme-editor-locales.json"));
        if (kind === "static" && !staticChanged) return;
        if (kind === "contract" && !staticChanged) return;
        onDirty({ staticChanged });
      });
      watcher.on("error", (error) => {
        console.error(`[cc-theme] file watch unavailable for ${directory}: ${error.message}`);
      });
      watchers.push(watcher);
    } catch (error) {
      console.error(`[cc-theme] file watch unavailable for ${directory}: ${error.message}`);
    }
  };
  add(themeRoot, "theme");
  if (themeRoot !== staticAssetsRoot) add(staticAssetsRoot, "static");
  add(path.join(root, "contracts"), "contract");
  return () => watchers.forEach((watcher) => watcher.close());
}

async function runWatch(options) {
  options.runtimeGeneration ??= randomBytes(18).toString("hex");
  let current;
  try {
    current = await loadPayload(options.themeDir, { deferredVideo: true });
  } catch (error) {
    throw error;
  }
  const sessions = new Map();
  const rejected = new Set();
  let stopping = false;
  let reloadTimer = null;
  let reloadChain = Promise.resolve();
  let discoveryDelayMs = 100;
  let lastListErrorAt = 0;
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const registerEarly = async (session, payload, generation) => {
    const result = await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: earlyPayloadFor(payload, generation),
    });
    return result.identifier ?? null;
  };

  const removeEarly = async (record) => {
    if (!record.earlyScriptId || record.session.closed) return;
    const identifier = record.earlyScriptId;
    record.earlyScriptId = null;
    await record.session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }).catch(() => {});
  };

  const payloadGenerationFor = (loaded) => `${loaded.revision}:${loaded.editorNonce}`;
  const generationFor = (loaded) => `${options.runtimeGeneration}:${payloadGenerationFor(loaded)}`;
  const runSessionGeneration = async (record, loaded) => {
    const { session } = record;
    const payloadGeneration = payloadGenerationFor(loaded);
    const generation = generationFor(loaded);
    return record.reconciler.reconcile({ generation, task: async ({ documentId, guard, isCurrent }) => {
      await beginRendererGeneration(session, options.runtimeGeneration, payloadGeneration, documentId);
      guard();
      const probe = await waitForCodexProbe(session);
      if (!probe?.codex) throw new Error("Renderer document did not expose current Codex landmarks");
      const earlyApplied = await session.evaluate(
        `window.__CC_THEME_EARLY_APPLIED__ === ${JSON.stringify(generation)}`,
      );
      if (!earlyApplied) await applyToSession(session, loaded.payload);
      guard();
      await transferDeferredMedia(session, loaded, {
        runtimeGeneration: options.runtimeGeneration,
        payloadGeneration,
        isCurrent,
      });
      guard();
      if (!await commitRendererGeneration(session, options.runtimeGeneration, payloadGeneration, documentId)) {
        throw new Error("Renderer rejected a superseded generation commit");
      }
      guard();
      await notifyThemeRuntimeResult(session, { ok: true });
      return { documentId, generation };
    } });
  };

  const refreshPayload = async ({ applySessions = true, preserveEditorNonce = false } = {}) => {
    let next;
    try {
      next = await loadPayload(options.themeDir, {
        deferredVideo: true,
        editorNonceOverride: preserveEditorNonce ? current.editorNonce : null,
      });
    } catch (error) {
      await Promise.all([...sessions.values()].map(({ session }) =>
        notifyThemeRuntimeResult(session, {
          ok: false,
          stage: "theme-reload",
          message: error.message,
        })));
      throw error;
    }
    if (next.revision === current.revision) return;
    current = next;
    for (const record of sessions.values()) {
      const { session } = record;
      if (session.closed) continue;
      try {
        const nextIdentifier = await registerEarly(session, current.payload, generationFor(current));
        if (record.earlyScriptId) {
          await session.send("Page.removeScriptToEvaluateOnNewDocument", {
            identifier: record.earlyScriptId,
          }).catch(() => {});
        }
        record.earlyScriptId = nextIdentifier;
        record.needsLoadFallback = !nextIdentifier;
        if (applySessions) {
          await runSessionGeneration(record, current);
        }
      } catch (error) {
        record.needsLoadFallback = true;
        await notifyThemeRuntimeResult(session, {
          ok: false,
          stage: "theme-reload",
          message: error.message,
        });
        console.error(`[cc-theme] theme refresh failed: ${error.message}`);
      }
    }
    console.log(`[cc-theme] refreshed theme ${current.theme.id} (${current.timings.buildMs}ms)`);
  };

  const queuePayloadRefresh = ({ staticChanged = false, applySessions = true, preserveEditorNonce = false } = {}) => {
    if (staticChanged) invalidateStaticPayloadAssets();
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      reloadChain = reloadChain.then(() => refreshPayload({ applySessions, preserveEditorNonce })).catch((error) => {
        console.error(`[cc-theme] theme reload failed: ${error.message}`);
      });
    }, 45);
  };
  const closePayloadWatchers = watchPayloadSources(options.themeDir, queuePayloadRefresh);
  const broadcastPersistedStyleOverrides = async ({ themeId, values, runtimePreferences, quarantine = { entries: [] }, diagnostics = [] }) => {
    const overrideState = { quarantine, diagnostics };
    await Promise.all([...sessions.values()].map(({ session }) => {
      if (session.closed) return Promise.resolve();
      return session.evaluate(`window[${JSON.stringify(STYLE_EDITOR_SYNC_KEY)}]?.(${JSON.stringify(themeId)}, ${JSON.stringify(values)}, ${JSON.stringify(runtimePreferences)}, ${JSON.stringify(overrideState)})`).catch(() => {});
    }));
    queuePayloadRefresh({ applySessions: false, preserveEditorNonce: true });
  };
  const overrideRoot = defaultStyleOverrideRoot();
  await fs.mkdir(overrideRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(overrideRoot, 0o700);
  let overrideTimer = null;
  let overrideWatcher = null;
  try {
    overrideWatcher = watchFs(overrideRoot, { persistent: false }, (_event, filename) => {
      if (filename && String(filename) !== `${current.theme.id}.json`) return;
      if (overrideTimer) clearTimeout(overrideTimer);
      overrideTimer = setTimeout(() => {
        overrideTimer = null;
        reloadChain = reloadChain.then(async () => {
          const state = await loadStyleOverrides(current.theme, current.styleCatalog);
          current.styleOverrides = state.values;
          current.runtimePreferences = state.runtimePreferences;
          current.styleOverrideStatus = state.status;
          current.styleOverrideQuarantine = state.quarantine;
          current.styleOverrideDiagnostics = state.diagnostics;
          await broadcastPersistedStyleOverrides({
            themeId: current.theme.id,
            values: state.values,
            runtimePreferences: state.runtimePreferences,
            quarantine: state.quarantine,
            diagnostics: state.diagnostics,
          });
        }).catch((error) => console.error(`[cc-theme] runtime override refresh failed: ${error.message}`));
      }, 35);
    });
  } catch (error) {
    console.error(`[cc-theme] runtime override watch unavailable: ${error.message}`);
  }

  try {
    while (!stopping) {
      let targets = [];
      try {
        targets = await listAppTargets(options.port);
        discoveryDelayMs = 100;
      } catch (error) {
        if (Date.now() - lastListErrorAt >= 2000) {
          console.error(`[cc-theme] ${new Date().toISOString()} ${error.message}`);
          lastListErrorAt = Date.now();
        }
        await new Promise((resolve) => setTimeout(resolve, discoveryDelayMs));
        discoveryDelayMs = Math.min(500, Math.round(discoveryDelayMs * 1.6));
        continue;
      }

      const activeIds = new Set(targets.map((target) => target.id));
      for (const [id, record] of sessions) {
        if (!activeIds.has(id) || record.session.closed) {
          record.reconciler.cancel();
          record.session.close();
          sessions.delete(id);
        }
      }

      for (const target of targets) {
        const existing = sessions.get(target.id);
        if (existing) {
          try {
            await runSessionGeneration(existing, current);
          } catch (error) {
            const now = Date.now();
            if (now - existing.lastReconcileErrorAt >= 2000) {
              existing.lastReconcileErrorAt = now;
              await notifyThemeRuntimeResult(existing.session, {
                ok: false,
                stage: "navigation-reconcile",
                message: error.message,
              });
              console.error(`[cc-theme] current document reconciliation failed: ${error.message}`);
            }
          }
          continue;
        }
        let session;
        let record;
        try {
          session = await connectTarget(target, options.port);
          record = {
            session,
            earlyScriptId: null,
            needsLoadFallback: false,
            reconciler: createDocumentGenerationReconciler({
              readDocumentId: () => documentIdentity(session),
            }),
            lastReconcileErrorAt: 0,
          };
          await installStyleEditorBinding(session, () => current, broadcastPersistedStyleOverrides);
          try {
            const generation = generationFor(current);
            record.earlyScriptId = await registerEarly(session, current.payload, generation);
            await session.evaluate(earlyPayloadFor(current.payload, generation));
          } catch (error) {
            record.needsLoadFallback = true;
            console.error(`[cc-theme] early injection unavailable: ${error.message}`);
          }
          const probe = await waitForCodexProbe(session);
          if (!probe?.codex) {
            await removeEarly(record);
            session.close();
            if (!rejected.has(target.id)) {
              console.error(`[cc-theme] rejected non-Codex app target ${target.id}`);
              rejected.add(target.id);
            }
            continue;
          }
          rejected.delete(target.id);
          session.on("Page.loadEventFired", () => {
            queueMicrotask(() => {
              void runSessionGeneration(record, current).catch((error) => {
                notifyThemeRuntimeResult(session, {
                  ok: false,
                  stage: "media-load",
                  message: error.message,
                });
                console.error(`[cc-theme] navigation video transfer failed: ${error.message}`);
              });
            });
          });
          await runSessionGeneration(record, current);
          sessions.set(target.id, record);
          console.log(`[cc-theme] injected Codex target ${target.id}`);
        } catch (error) {
          record?.reconciler.cancel();
          if (record) await removeEarly(record);
          if (session && !session.closed) {
            await notifyThemeRuntimeResult(session, {
              ok: false,
              stage: "theme-load",
              message: error.message,
            });
          }
          session?.close();
          console.error(`[cc-theme] inject failed for ${target.id}: ${error.message}`);
        }
      }
      const pollDelay = sessions.size ? 800 : (targets.length ? 250 : 100);
      await new Promise((resolve) => setTimeout(resolve, pollDelay));
    }
  } finally {
    if (reloadTimer) clearTimeout(reloadTimer);
    if (overrideTimer) clearTimeout(overrideTimer);
    overrideWatcher?.close();
    closePayloadWatchers();
    await reloadChain.catch(() => {});
    await Promise.all([...sessions.values()].map((record) => removeEarly(record)));
    for (const record of sessions.values()) {
      record.reconciler.cancel();
      record.session.close();
    }
  }
}

async function flushCliStreamsAndExit(exitCode) {
  // Node's built-in WebSocket can keep the event loop alive while a remote
  // DevTools endpoint delays the close handshake. One-shot commands have
  // already closed every owned session at this boundary, so flush their
  // bounded report and terminate deterministically instead of leaking a
  // readiness verifier into the launch transaction.
  await Promise.all([
    new Promise((resolve) => process.stdout.write("", resolve)),
    new Promise((resolve) => process.stderr.write("", resolve)),
  ]);
  process.exit(exitCode);
}

if (path.resolve(process.argv[1] || "") === path.resolve(scriptPath)) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.mode === "check") {
      const loaded = await loadPayload(options.themeDir, {
        videoUrlFor: async (_videoPath, videoStat) => `http://127.0.0.1:9/cc-theme-check/background.mp4?v=${videoStat.size}`,
      });
      console.log(JSON.stringify({
        pass: true,
        version: SKIN_VERSION,
        themeId: loaded.theme.id,
        themeName: loaded.theme.name,
        themeBridgeEnabled: loaded.theme.themeBridgeEnabled,
        shellMode: loaded.theme.shellMode,
        art: loaded.theme.art,
        artMetadata: loaded.theme.artMetadata,
        newTaskLayout: loaded.theme.appearance.newTaskLayout,
        backgroundVideoPosition: loaded.theme.appearance.backgroundVideoPosition,
        backgroundVideoPosterMode: loaded.theme.appearance.backgroundVideoPosterMode,
        backgroundVideoScrimOpacity: loaded.theme.appearance.backgroundVideoScrimOpacity,
        backgroundRenderMode: loaded.backgroundRenderMode,
        interactiveBackground: loaded.theme.interactiveBackground ?? null,
        imageBytes: loaded.imageBytes,
        heroImageBytes: loaded.heroImageBytes,
        heroImageSource: loaded.heroImageSource,
        videoBytes: loaded.videoBytes,
        videoEnabled: loaded.videoEnabled,
        interactiveAtlasBytes: loaded.interactiveAtlasBytes,
        interactiveAtlasMetadata: loaded.interactiveAtlasMetadata,
        payloadBytes: Buffer.byteLength(loaded.payload),
        revision: loaded.revision,
        timings: loaded.timings,
      }, null, 2));
    } else if (options.mode === "watch") {
      await runWatch(options);
    } else if (options.mode === "evidence") {
      await runSurfaceEvidence(options);
    } else {
      await runOneShot(options);
    }
  } catch (error) {
    console.error(`[cc-theme] ${error.stack || error.message}`);
    process.exitCode = 1;
  } finally {
    if (options?.mode !== "watch") {
      await flushCliStreamsAndExit(process.exitCode ?? 0);
    }
  }
}
