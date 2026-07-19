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
import { loadClaudeLocaleCatalog } from "./claude-locale-catalog.mjs";
import { createClaudeLocaleRuntime } from "./claude-locale-runtime.mjs";
import { loadStyleOverrides, saveStyleOverrides } from "./theme-style-overrides.mjs";
import { DEFAULT_CATALOG_PATH, validateUiSurfaceCatalog } from "./ui-surface-catalog.mjs";
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
const SKIN_VERSION = "1.22209.3";
const DEFERRED_VIDEO_SOURCE = "cc-theme:deferred-video";
const DEFERRED_MOTION_FALLBACK_SOURCE = "cc-theme:deferred-motion-fallback";
const DEFERRED_INTERACTIVE_ATLAS_SOURCE = "cc-theme:deferred-interactive-atlas";
const STYLE_EDITOR_BINDING = "__ccThemeSaveStyleOverrides";
const THEME_RUNTIME_RESULT_KEY = "__CC_THEME_RUNTIME_RESULT__";
const VIDEO_TRANSFER_CHUNK_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_ART_BYTES = MAX_IMAGE_BYTES;
const MAX_TOTAL_ART_BYTES = MAX_TOTAL_MEDIA_BYTES;
const SUPPORTED_ART_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
let staticPayloadAssets = null;

function imageMime(file) {
  const extension = path.extname(file).toLowerCase();
  return extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
    : extension === ".gif" ? "image/gif"
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

async function validateMotionFallback(assetsRoot, file) {
  if (!file) return null;
  if (path.basename(file) !== file) {
    throw new Error("Background motion fallback must stay inside its theme directory");
  }
  if (path.extname(file).toLowerCase() !== ".gif") {
    throw new Error("Background motion fallback must be a GIF file");
  }
  const motionFallbackPath = path.resolve(assetsRoot, file);
  assertContainedPath(assetsRoot, motionFallbackPath, "Background motion fallback");
  const loaded = await readStableFile(
    motionFallbackPath,
    "Background motion fallback",
    MAX_IMAGE_BYTES,
  );
  if (loaded.bytes.length < 10 || !["GIF87a", "GIF89a"].includes(loaded.bytes.subarray(0, 6).toString("ascii"))) {
    throw new Error("Background motion fallback content is not a valid GIF file");
  }
  const width = loaded.bytes.readUInt16LE(6);
  const height = loaded.bytes.readUInt16LE(8);
  if (!width || !height || width > 16384 || height > 16384 || width * height > 50_000_000) {
    throw new Error("Background motion fallback exceeds the image dimension safety limit");
  }
  return { motionFallbackPath, motionFallbackStat: loaded.stat };
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
    port: 9451,
    mode: "watch",
    timeoutMs: 30000,
    screenshot: null,
    reload: false,
    themeDir: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--watch") options.mode = "watch";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--evidence") options.mode = "evidence";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--check-payload") options.mode = "check";
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++i]);
    else if (arg === "--theme-dir") options.themeDir = path.resolve(argv[++i]);
    else if (arg === "--reload") options.reload = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 120000) {
    throw new Error(`Invalid timeout: ${options.timeoutMs}`);
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

async function installStyleEditorBinding(session, currentPayload, onSaved = null) {
  await session.send("Runtime.addBinding", { name: STYLE_EDITOR_BINDING });
  let saveChain = Promise.resolve();
  const latestRevisionByNonce = new Map();
  session.on("Runtime.bindingCalled", (params) => {
    if (params.name !== STYLE_EDITOR_BINDING) return;
    let message;
    let requestId = "unknown";
    try {
      if (Buffer.byteLength(params.payload ?? "", "utf8") > 64 * 1024) throw new Error("Editor request is too large");
      message = JSON.parse(params.payload ?? "null");
      requestId = typeof message?.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)
        ? message.requestId : "unknown";
      if (!Number.isSafeInteger(message?.revision) || message.revision < 1) {
        throw new Error("Editor revision is invalid");
      }
      const nonceKey = typeof message?.nonce === "string" ? message.nonce : "";
      latestRevisionByNonce.set(nonceKey, Math.max(
        latestRevisionByNonce.get(nonceKey) ?? 0,
        message.revision,
      ));
    } catch (error) {
      void sendStyleEditorResult(session, params.executionContextId, requestId, {
        ok: false,
        revision: 0,
        message: error.message,
      });
      return;
    }

    saveChain = saveChain.then(async () => {
      const current = currentPayload();
      const fallback = {
        values: current?.styleOverrides ?? {},
        preferences: current?.runtimePreferences ?? {},
      };
      try {
        if (!current || message.nonce !== current.editorNonce || message.themeId !== current.theme.id) {
          throw new Error("Editor session is stale; reopen the CC Theme settings panel");
        }
        const latestRevision = latestRevisionByNonce.get(message.nonce) ?? message.revision;
        if (message.revision < latestRevision) {
          await sendStyleEditorResult(session, params.executionContextId, requestId, {
            ok: false,
            superseded: true,
            revision: message.revision,
            ...fallback,
          });
          return;
        }
        const saved = await saveStyleOverrides(current.theme, current.styleCatalog, message.values, {
          preferences: message.preferences,
        });
        current.styleOverrides = saved.values;
        current.runtimePreferences = saved.preferences;
        await sendStyleEditorResult(session, params.executionContextId, requestId, {
          ok: true,
          revision: message.revision,
          values: saved.values,
          preferences: saved.preferences,
        });
        onSaved?.();
      } catch (error) {
        await sendStyleEditorResult(session, params.executionContextId, requestId, {
          ok: false,
          revision: message.revision,
          message: error.message,
          ...fallback,
        });
      }
    }).catch((error) => {
      console.error(`[cc-theme] style persistence queue failed: ${error.message}`);
    });
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
      if (item.type !== "page" || !item.webSocketDebuggerUrl) return false;
      try {
        const rendererUrl = new URL(item.url);
        if (rendererUrl.protocol !== "https:" || !["claude.ai", "claude.com"].includes(rendererUrl.hostname)) {
          return false;
        }
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
      shell: Boolean(document.querySelector('main.dframe-content')),
      sidebar: Boolean(document.querySelector('aside.dframe-sidebar')),
      composer: Boolean(document.querySelector('[data-testid="chat-input"]')),
      main: Boolean(document.querySelector('[role=region].dframe-pane-primary')),
      settings: Boolean(document.querySelector('[role="dialog"] > nav.flex.w-48.shrink-0.flex-col')),
    };
    return {
      markers,
      claude: (markers.shell && markers.sidebar && (markers.composer || markers.main)) || markers.settings,
    };
  })()`);
}

async function waitForClaudeProbe(session, timeoutMs = 1800) {
  const deadline = Date.now() + timeoutMs;
  let probe = null;
  while (Date.now() < deadline) {
    probe = await probeSession(session);
    if (probe?.claude) return probe;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return probe;
}

async function connectTarget(target, port) {
  return new CdpSession(target, port).open();
}

async function connectClaudeTargets(port, timeoutMs) {
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
          if (probe?.claude) connected.push({ target, session, probe });
          else session.close();
        } catch (error) {
          session?.close();
          lastError = error;
        }
      }
      if (connected.length) return connected;
      lastError = new Error("No page matched the expected Claude shell markers");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`No verified Claude renderer on 127.0.0.1:${port}: ${lastError?.message ?? "timed out"}`);
}

async function loadTheme(themeDir) {
  if (!themeDir) throw new Error("An explicit validated external theme directory is required");
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
  const motionFallback = await validateMotionFallback(assetsRoot, theme.backgroundMotionFallback);
  const atlas = await validateDirectionalAtlas(assetsRoot, theme.interactiveBackground);
  const totalBytes = image.imageStat.size + (hero?.imageStat.size ?? 0) +
    (video?.videoStat.size ?? 0) + (motionFallback?.motionFallbackStat.size ?? 0) +
    (atlas?.atlasStat.size ?? 0);
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
    motionFallbackPath: motionFallback?.motionFallbackPath ?? null,
    motionFallbackStat: motionFallback?.motionFallbackStat ?? null,
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
      const [css, template, backgroundEffects, uiInterpreterFactory, uiCatalog, styleCatalog] = await Promise.all([
        fs.readFile(path.join(staticAssetsRoot, "skin.css"), "utf8"),
        fs.readFile(path.join(staticAssetsRoot, "renderer-inject.js"), "utf8"),
        fs.readFile(path.join(staticAssetsRoot, "background-effects.js"), "utf8"),
        fs.readFile(path.join(staticAssetsRoot, "ui-interpreter.js"), "utf8"),
        fs.readFile(DEFAULT_CATALOG_PATH, "utf8").then(JSON.parse),
        loadStyleCatalog(),
      ]);
      const catalogErrors = validateUiSurfaceCatalog(uiCatalog);
      if (catalogErrors.length) throw new Error(`Invalid Claude UI Surface Catalog: ${catalogErrors.join("; ")}`);
      const claudeLocaleCatalog = await loadClaudeLocaleCatalog();
      const editorLocales = await loadThemeEditorLocales(styleCatalog);
      return [css, template, backgroundEffects, uiInterpreterFactory, uiCatalog, styleCatalog, editorLocales, claudeLocaleCatalog];
    })().catch((error) => {
      staticPayloadAssets = null;
      throw error;
    });
  }
  const [css, template, backgroundEffects, uiInterpreterFactory, uiCatalog, styleCatalog, editorLocales, claudeLocaleCatalog] = await staticPayloadAssets;
  return { css, template, backgroundEffects, uiInterpreterFactory, uiCatalog, styleCatalog, editorLocales, claudeLocaleCatalog, cacheHit };
}

function invalidateStaticPayloadAssets() {
  staticPayloadAssets = null;
}

async function loadPayload(themeDir, { videoUrlFor = null, inlineVideo = false, deferredVideo = false } = {}) {
  const startedAt = performance.now();
  const [staticAssets, loaded] = await Promise.all([
    loadStaticPayloadAssets(),
    loadTheme(themeDir),
  ]);
  const { css, template, backgroundEffects, uiInterpreterFactory, uiCatalog, styleCatalog, editorLocales, claudeLocaleCatalog } = staticAssets;
  const {
    imageBytes: art,
    imagePath,
    heroImageBytes: heroArt,
    heroImagePath,
    heroImageStat,
    videoPath,
    videoStat,
    motionFallbackPath,
    motionFallbackStat,
    interactiveAtlasPath,
    interactiveAtlasStat,
    interactiveAtlasMetadata,
    theme,
  } = loaded;
  let styleOverrideState = { values: {}, preferences: {}, status: "unavailable" };
  try {
    styleOverrideState = await loadStyleOverrides(theme, styleCatalog);
  } catch (error) {
    console.error(`[cc-theme] ignored invalid local style overrides: ${error.message}`);
  }
  const editorNonce = randomBytes(24).toString("hex");
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
  const motionFallbackSource = motionFallbackPath ? DEFERRED_MOTION_FALLBACK_SOURCE : null;
  const styleRevision = createHash("sha256").update(css).digest("hex").slice(0, 20);
  const payload = template
    .replace("__SKIN_CSS_JSON__", JSON.stringify(css))
    .replace("__SKIN_ART_JSON__", JSON.stringify(artDataUrl))
    .replace("__SKIN_HERO_ART_JSON__", JSON.stringify(heroArtDataUrl))
    .replace("__SKIN_VIDEO_JSON__", JSON.stringify(videoArtSource))
    .replace("__SKIN_MOTION_FALLBACK_JSON__", JSON.stringify(motionFallbackSource))
    .replace("__SKIN_INTERACTIVE_ATLAS_JSON__", JSON.stringify(
      interactiveAtlasPath ? DEFERRED_INTERACTIVE_ATLAS_SOURCE : null,
    ))
    .replace("__SKIN_BACKGROUND_EFFECT_FACTORY__", backgroundEffects)
    .replace("__SKIN_THEME_JSON__", JSON.stringify(theme))
    .replace("__THEME_STYLE_CATALOG_JSON__", JSON.stringify(styleCatalog))
    .replace("__THEME_EDITOR_LOCALES_JSON__", JSON.stringify(editorLocales))
    .replace("__CLAUDE_LOCALE_CATALOG_JSON__", JSON.stringify(claudeLocaleCatalog))
    .replace("__CLAUDE_UI_ADAPTER_JSON__", JSON.stringify(uiCatalog.runtimeInterpreter))
    .replace("__CLAUDE_UI_INTERPRETER_FACTORY__", uiInterpreterFactory)
    .replace("__CLAUDE_LOCALE_RUNTIME_FACTORY__", createClaudeLocaleRuntime.toString())
    .replace("__THEME_STYLE_OVERRIDES_JSON__", JSON.stringify(styleOverrideState.values))
    .replace("__THEME_RUNTIME_PREFERENCES_JSON__", JSON.stringify(styleOverrideState.preferences))
    .replace("__THEME_STYLE_OVERRIDE_STATE_JSON__", JSON.stringify({
      status: styleOverrideState.status,
      diagnosticCode: styleOverrideState.diagnosticCode ?? null,
      quarantinedTokenCount: styleOverrideState.quarantinedTokenIds?.length ?? 0,
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
    .update(uiInterpreterFactory)
    .update(createClaudeLocaleRuntime.toString())
    .update(JSON.stringify(uiCatalog.runtimeInterpreter))
    .update(JSON.stringify(styleCatalog))
    .update(JSON.stringify(editorLocales))
    .update(JSON.stringify(claudeLocaleCatalog))
    .update(JSON.stringify(styleOverrideState.values))
    .update(JSON.stringify(styleOverrideState.preferences))
    .update(JSON.stringify({
      status: styleOverrideState.status,
      diagnosticCode: styleOverrideState.diagnosticCode ?? null,
      quarantinedTokenCount: styleOverrideState.quarantinedTokenIds?.length ?? 0,
    }))
    .update(JSON.stringify(theme))
    .update(art);
  if (heroArt) revisionHash.update(heroArt);
  if (videoPath && videoStat) revisionHash.update(`${videoPath}:${videoStat.dev}:${videoStat.ino}:${videoStat.size}:${videoStat.mtimeMs}`);
  if (motionFallbackPath && motionFallbackStat) {
    revisionHash.update(`${motionFallbackPath}:${motionFallbackStat.dev}:${motionFallbackStat.ino}:${motionFallbackStat.size}:${motionFallbackStat.mtimeMs}`);
  }
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
    motionFallbackBytes: motionFallbackStat?.size ?? 0,
    motionFallbackPath,
    motionFallbackStat,
    backgroundRenderMode: theme.interactiveBackground?.type ?? "media",
    interactiveAtlasBytes: interactiveAtlasStat?.size ?? 0,
    interactiveAtlasPath,
    interactiveAtlasStat,
    interactiveAtlasMetadata,
    styleCatalog,
    styleOverrides: styleOverrideState.values,
    runtimePreferences: styleOverrideState.preferences,
    styleOverrideStatus: styleOverrideState.status,
    editorNonce,
    heroImageSource: heroImagePath ? "dedicated" : "not-used",
    payload,
    revision,
    theme,
    timings: {
      buildMs: Number((performance.now() - startedAt).toFixed(3)),
      staticCacheHit: staticAssets.cacheHit,
    },
  };
}

// The diagnostic DevTools bridge deliberately reuses the exact validated
// payload builder used by the CDP injector.  It receives no theme-provided
// JavaScript or selectors; callers get only the fixed Adapter payload plus the
// bounded local media facts required by the user-confirmed preview server.
export async function buildDiagnosticPreviewBundle(themeDir) {
  const loaded = await loadPayload(themeDir, { deferredVideo: true });
  return {
    payload: loaded.payload,
    revision: loaded.revision,
    editorNonce: loaded.editorNonce,
    theme: loaded.theme,
    styleCatalog: loaded.styleCatalog,
    styleOverrides: loaded.styleOverrides,
    runtimePreferences: loaded.runtimePreferences,
    motionFallbackPath: loaded.motionFallbackPath,
    motionFallbackStat: loaded.motionFallbackStat,
    motionFallbackBytes: loaded.motionFallbackBytes,
    videoEnabled: loaded.videoEnabled,
  };
}

async function applyToSession(session, payload) {
  return session.evaluate(payload);
}

async function transferDeferredAsset(session, loaded, options) {
  const { filePath, fileStat, setterName, transferKey, mimeType, label } = options;
  if (!filePath || !fileStat) return { transferred: false, bytes: 0 };
  const transferId = randomBytes(18).toString("hex");
  const themeId = String(loaded.theme.id);
  const expectedBytes = fileStat.size;
  const initialized = await session.evaluate(`(() => {
    const state = window.__CC_THEME_STATE__;
    if (typeof state?.[${JSON.stringify(setterName)}] !== "function" ||
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
      const length = Math.min(buffer.length, expectedBytes - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (!bytesRead) throw new Error(`${label} ended during deferred transfer`);
      const base64 = buffer.subarray(0, bytesRead).toString("base64");
      const accepted = await session.evaluate(`(() => {
        const transfer = window[${JSON.stringify(transferKey)}];
        if (!transfer || transfer.id !== ${JSON.stringify(transferId)}) return false;
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
    const committed = await session.evaluate(`(() => {
      const transfer = window[${JSON.stringify(transferKey)}];
      if (!transfer || transfer.id !== ${JSON.stringify(transferId)} ||
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

export async function transferDeferredVideo(session, loaded) {
  return transferDeferredAsset(session, loaded, {
    filePath: loaded?.videoPath,
    fileStat: loaded?.videoStat,
    setterName: "setDeferredVideoSource",
    transferKey: "__CC_THEME_VIDEO_TRANSFER__",
    mimeType: "video/mp4",
    label: "background video",
  });
}

export async function transferDeferredMotionFallback(session, loaded) {
  return transferDeferredAsset(session, loaded, {
    filePath: loaded?.motionFallbackPath,
    fileStat: loaded?.motionFallbackStat,
    setterName: "setDeferredMotionFallbackSource",
    transferKey: "__CC_THEME_MOTION_FALLBACK_TRANSFER__",
    mimeType: "image/gif",
    label: "background motion fallback",
  });
}

export async function transferDeferredInteractiveAtlas(session, loaded) {
  return transferDeferredAsset(session, loaded, {
    filePath: loaded?.interactiveAtlasPath,
    fileStat: loaded?.interactiveAtlasStat,
    setterName: "setDeferredInteractiveAtlasSource",
    transferKey: "__CC_THEME_INTERACTIVE_ATLAS_TRANSFER__",
    mimeType: "image/webp",
    label: "directional background atlas",
  });
}

async function transferDeferredMedia(session, loaded) {
  const motionFallback = await transferDeferredMotionFallback(session, loaded);
  const video = motionFallback.transferred
    ? { transferred: false, bytes: 0, diagnosticCode: "video-media-policy-animated-image-fallback" }
    : await transferDeferredVideo(session, loaded);
  const interactiveAtlas = await transferDeferredInteractiveAtlas(session, loaded);
  return { video, motionFallback, interactiveAtlas };
}

async function removeFromSession(session) {
  const removed = await session.evaluate(`(() => {
    window.__CC_THEME_DISABLED__ = true;
    const state = window.__CC_THEME_STATE__;
    if (state?.cleanup) return state.cleanup();
    const video = document.querySelector("#cc-theme-video-layer video");
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    document.querySelectorAll('[data-theme-page-native-hidden="true"]').forEach((node) => {
      node.hidden = false;
      node.removeAttribute("data-theme-page-native-hidden");
    });
    document.querySelectorAll("[data-skin-marker]").forEach((node) => {
      node.removeAttribute("data-skin-marker");
      node.removeAttribute("data-skin-role");
      node.removeAttribute("data-skin-overlay-kind");
    });
    const root = document.documentElement;
    root?.classList.remove("cc-theme");
    for (const attribute of [...(root?.attributes || [])]) {
      if (attribute.name.startsWith("data-skin-") || attribute.name === "data-theme-settings-page") {
        root.removeAttribute(attribute.name);
      }
    }
    for (const name of [...(root?.style || [])]) {
      if (name.startsWith("--skin-")) root.style.removeProperty(name);
    }
    for (const id of [
      "cc-theme-style", "cc-theme-video-layer",
      "cc-theme-interactive-layer", "cc-theme-style-editor",
      "cc-theme-settings-page", "cc-theme-settings-nav-item",
    ]) document.getElementById(id)?.remove();
    delete window.__CC_THEME_EDITOR_RESULT__;
    delete window.__CC_THEME_RUNTIME_RESULT__;
    delete window.__CC_THEME_STATE__;
    return true;
  })()`);
  await session.send("Runtime.removeBinding", { name: STYLE_EDITOR_BINDING }).catch(() => {});
  return removed;
}

async function verifyRemovedSession(session) {
  return session.evaluate(`(() => {
    const root = document.documentElement;
    const owned = {
      style: Number(Boolean(document.getElementById("cc-theme-style"))),
      videoLayer: Number(Boolean(document.getElementById("cc-theme-video-layer"))),
      interactiveLayer: Number(Boolean(document.getElementById("cc-theme-interactive-layer"))),
      settingsNav: Number(Boolean(document.getElementById("cc-theme-settings-nav-item"))),
      settingsPage: Number(Boolean(document.getElementById("cc-theme-settings-page"))),
      editor: Number(Boolean(document.getElementById("cc-theme-style-editor"))),
      roleMarkers: document.querySelectorAll("[data-skin-marker], [data-skin-role]").length,
      nativeHidden: document.querySelectorAll('[data-theme-page-native-hidden="true"]').length,
    };
    const rootState = {
      classPresent: root.classList.contains("cc-theme"),
      skinAttributes: [...root.attributes].filter((attribute) =>
        attribute.name.startsWith("data-skin-") || attribute.name === "data-theme-settings-page").length,
      skinInlineVariables: [...root.style].filter((name) => name.startsWith("--skin-")).length,
    };
    const runtime = {
      state: Boolean(window.__CC_THEME_STATE__),
      editorCallback: Boolean(window.__CC_THEME_EDITOR_RESULT__),
      runtimeCallback: Boolean(window.__CC_THEME_RUNTIME_RESULT__),
    };
    const pass = Object.values(owned).every((count) => count === 0) &&
      !rootState.classPresent && rootState.skinAttributes === 0 &&
      rootState.skinInlineVariables === 0 && !Object.values(runtime).some(Boolean);
    return {
      kind: "cc-theme.lifecycle-result",
      schemaVersion: 1,
      phase: "restore",
      status: pass ? "passed" : "failed",
      failureCategory: pass ? null : "theme-contract",
      pass,
      adapter: { id: "mac-claude", targetVersion: "1.22209.3" },
      owned,
      rootState,
      runtime,
    };
  })()`);
}

async function captureLiveSurfaceEvidence(session) {
  return session.evaluate(`(() => {
    const stableClasses = (node) => [...(node?.classList || [])]
      .filter((token) => /^[A-Za-z][A-Za-z0-9_:/.-]{0,96}$/.test(token) && !/^_/.test(token))
      .slice(0, 48);
    const snapshot = (id, node, parentId = null) => {
      if (!node) return { id, present: false, parentId };
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        id,
        present: true,
        parentId,
        element: node.localName,
        semanticRole: node.getAttribute("role") || null,
        stableClasses: stableClasses(node),
        stableAttributes: {
          testId: node.getAttribute("data-testid") || null,
          current: node.hasAttribute("aria-current"),
          pressed: node.hasAttribute("aria-pressed") ? node.getAttribute("aria-pressed") === "true" : null,
          expanded: node.hasAttribute("aria-expanded") ? node.getAttribute("aria-expanded") === "true" : null,
          hidden: node.hidden || style.display === "none" || style.visibility === "hidden",
        },
        childElementCount: node.childElementCount,
        bounds: {
          x: Math.round(rect.x), y: Math.round(rect.y),
          width: Math.round(rect.width), height: Math.round(rect.height),
        },
        computedStyle: {
          display: style.display,
          position: style.position,
          backgroundColor: style.backgroundColor,
          color: style.color,
          borderRadius: style.borderRadius,
          borderWidth: style.borderWidth,
          boxShadow: style.boxShadow,
          opacity: style.opacity,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          padding: style.padding,
          gap: style.gap,
          transitionDuration: style.transitionDuration,
          transitionTimingFunction: style.transitionTimingFunction,
        },
      };
    };
    const main = document.querySelector("main.dframe-content");
    const sidebar = document.querySelector("aside.dframe-sidebar");
    const primary = document.querySelector("[role=region].dframe-pane-primary");
    const input = document.querySelector('[data-testid="chat-input"]');
    const settingsDialog = document.querySelector('[role="dialog"]:has(> nav.flex.w-48.shrink-0.flex-col)');
    const settingsNav = settingsDialog?.querySelector(":scope > nav.flex.w-48.shrink-0.flex-col") || null;
    const nativeSettingsContent = settingsDialog ? [...settingsDialog.children].find((node) =>
      node !== settingsNav && node.id !== "cc-theme-settings-page") || null : null;
    const ccItem = document.getElementById("cc-theme-settings-nav-item");
    const ccListItem = ccItem?.closest("li") || null;
    const adjacentNative = ccListItem?.previousElementSibling?.querySelector(":scope > button") || null;
    const nodes = [
      snapshot("main", main),
      snapshot("sidebar", sidebar),
      snapshot("primary-pane", primary, "main"),
      snapshot("composer-input", input, "primary-pane"),
      snapshot("settings-dialog", settingsDialog),
      snapshot("settings-nav", settingsNav, "settings-dialog"),
      snapshot("settings-native-content", nativeSettingsContent, "settings-dialog"),
      snapshot("settings-adjacent-native-item", adjacentNative, "settings-nav"),
      snapshot("settings-cc-theme-item", ccItem, "settings-nav"),
      snapshot("settings-cc-theme-page", document.getElementById("cc-theme-settings-page"), "settings-dialog"),
    ];
    const landmarkCount = nodes.filter((node) => node.present).length;
    const pass = Boolean(settingsDialog)
      ? Boolean(settingsNav && nativeSettingsContent)
      : Boolean(main && sidebar && primary && input);
    return {
      kind: "cc-theme.live-surface-evidence",
      schemaVersion: 1,
      adapter: "mac-claude",
      targetVersion: "1.22209.3",
      status: pass ? "captured" : "insufficient-landmarks",
      pass,
      privacy: {
        policy: "structure-only-v1",
        structuralOnly: true,
        rawArtifactsCommitted: false,
        sensitiveFieldCount: 0,
      },
      environment: {
        colorMode: document.documentElement.getAttribute("data-mode") || null,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        viewport: { width: innerWidth, height: innerHeight },
      },
      counts: {
        landmarks: landmarkCount,
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        menus: document.querySelectorAll('[role="menu"]').length,
        listboxes: document.querySelectorAll('[role="listbox"]').length,
        ownedNodes: document.querySelectorAll('[data-theme-owned], [data-skin-owned]').length,
      },
      nodes,
    };
  })()`);
}

async function verifySession(session) {
  return session.evaluate(`(() => {
    const bounds = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: rect.width > 0 && rect.height > 0 &&
          style.display !== "none" && style.visibility !== "hidden",
      };
    };
    const styleDigest = (node) => {
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        display: style.display,
        height: style.height,
        minWidth: style.minWidth,
        padding: style.padding,
        gap: style.gap,
        borderWidth: style.borderWidth,
        borderRadius: style.borderRadius,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        color: style.color,
        backgroundColor: style.backgroundColor,
        opacity: style.opacity,
        boxShadow: style.boxShadow,
        outlineWidth: style.outlineWidth,
        transitionDuration: style.transitionDuration,
        transitionTimingFunction: style.transitionTimingFunction,
      };
    };
    const equalDigest = (left, right) => Boolean(left && right &&
      Object.keys(left).every((key) => left[key] === right[key]));
    const root = document.documentElement;
    const state = window.__CC_THEME_STATE__;
    const main = document.querySelector("main.dframe-content");
    const sidebar = document.querySelector("aside.dframe-sidebar");
    const primaryPane = document.querySelector("[role=region].dframe-pane-primary");
    const chatInput = document.querySelector('[data-testid="chat-input"]');
    const composer = document.querySelector('[data-skin-role="composer"]');
    const settingsShell = document.querySelector('[data-skin-role="settings-shell"]');
    const settingsPage = document.getElementById("cc-theme-settings-page");
    const settingsItem = document.getElementById("cc-theme-settings-nav-item");
    const settingsListItem = settingsItem?.closest("li") || null;
    const adjacentNativeItem = settingsListItem?.previousElementSibling || null;
    const adjacentNativeButton = adjacentNativeItem?.querySelector(":scope > button") || null;
    const ownedIcon = settingsItem?.querySelector(":scope > span:first-child") || null;
    const nativeIcon = adjacentNativeButton?.querySelector(":scope > span:first-child") || null;
    const ownedIconBounds = bounds(ownedIcon);
    const nativeIconBounds = bounds(nativeIcon);
    const iconGeometryMatches = Boolean(ownedIconBounds && nativeIconBounds &&
      Math.abs(ownedIconBounds.width - nativeIconBounds.width) <= 1 &&
      Math.abs(ownedIconBounds.height - nativeIconBounds.height) <= 1);
    const ownedIconStyle = styleDigest(ownedIcon);
    const nativeIconStyle = styleDigest(nativeIcon);
    const iconStyleMatches = Boolean(ownedIconStyle && nativeIconStyle && [
      "display", "height", "minWidth", "padding", "gap", "borderWidth",
      "borderRadius", "opacity", "transitionDuration", "transitionTimingFunction",
    ].every((key) => ownedIconStyle[key] === nativeIconStyle[key]));
    const nativeContentHidden = document.querySelectorAll('[data-theme-page-native-hidden="true"]').length;
    const videoLayer = document.getElementById("cc-theme-video-layer");
    const interactiveLayer = document.getElementById("cc-theme-interactive-layer");
    const video = videoLayer?.querySelector("video") || null;
    const motionFallback = videoLayer?.querySelector("#cc-theme-motion-fallback") || null;
    const canvas = interactiveLayer?.querySelector("canvas") || null;
    const ownedCounts = {
      style: Number(Boolean(document.getElementById("cc-theme-style"))),
      settingsNav: Number(Boolean(settingsItem)),
      settingsPage: Number(Boolean(settingsPage)),
      editor: Number(Boolean(document.getElementById("cc-theme-style-editor"))),
      videoLayer: Number(Boolean(videoLayer)),
      motionFallback: Number(Boolean(motionFallback)),
      interactiveLayer: Number(Boolean(interactiveLayer)),
      roleMarkers: document.querySelectorAll("[data-skin-marker]").length,
    };
    const landmarks = {
      main: Boolean(main),
      sidebar: Boolean(sidebar),
      primaryPane: Boolean(primaryPane),
      composerInput: Boolean(chatInput),
      settingsShell: Boolean(settingsShell),
    };
    const settingsContract = settingsShell ? {
      navInserted: Boolean(settingsItem),
      followsGeneralStructurally: Boolean(settingsListItem && adjacentNativeItem),
      ownedPageIsDialogChild: settingsPage ? settingsPage.parentElement === settingsShell : null,
      nativeContentHiddenCount: nativeContentHidden,
      iconUsesNativeContainer: Boolean(ownedIcon?.className === nativeIcon?.className),
      iconGeometryMatches,
      iconStyleMatches,
      saveButtonAbsent: !document.querySelector("#cc-theme-style-editor .cc-theme-style-editor-save"),
    } : null;
    const resourceState = {
      observer: Boolean(state?.observer),
      interval: Boolean(state?.timer),
      resizeHandler: Boolean(state?.resizeHandler),
      mediaHandler: Boolean(state?.mediaHandler),
      motionHandler: Boolean(state?.motionMediaHandler),
      backgroundMedia: Boolean(video?.hasAttribute("src") || motionFallback?.hasAttribute("src")),
      motionFallback: Boolean(motionFallback?.hasAttribute("src")),
      canvas: Boolean(canvas),
    };
    const visual = {
      viewport: { width: innerWidth, height: innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      main: bounds(main),
      sidebar: bounds(sidebar),
      composer: bounds(composer || chatInput),
      settingsShell: bounds(settingsShell),
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
    const adapterLandmarksPass = landmarks.settingsShell ||
      (landmarks.main && landmarks.sidebar && landmarks.primaryPane && landmarks.composerInput);
    const settingsPass = !settingsContract || (
      settingsContract.navInserted &&
      settingsContract.followsGeneralStructurally &&
      settingsContract.ownedPageIsDialogChild !== false &&
      settingsContract.iconUsesNativeContainer &&
      settingsContract.iconGeometryMatches &&
      settingsContract.iconStyleMatches &&
      settingsContract.saveButtonAbsent
    );
    const visualPass = !visual.horizontalOverflow;
    const pass = Boolean(state) && ownedCounts.style === 1 &&
      adapterLandmarksPass && settingsPass && visualPass;
    return {
      kind: "cc-theme.lifecycle-result",
      schemaVersion: 1,
      phase: "verify",
      status: pass ? "passed" : "failed",
      failureCategory: !adapterLandmarksPass ? "adapter-landmark"
        : !settingsPass ? "adapter-landmark"
          : !visualPass ? "visual" : !state ? "theme-contract" : null,
      pass,
      adapter: {
        id: "mac-claude",
        targetVersion: "1.22209.3",
        landmarks,
      },
      ownedCounts,
      settingsContract,
      resourceState,
      visual,
      theme: {
        idPresent: typeof state?.themeId === "string" && state.themeId.length > 0,
        versionPresent: typeof state?.version === "string" && state.version.length > 0,
        videoEnabled: Boolean(state?.videoEnabled),
        motionFallbackEnabled: Boolean(state?.motionFallbackEnabled),
        motionFallbackDiagnosticCode: state?.motionFallbackDiagnosticCode || null,
        backgroundRenderMode: state?.backgroundRenderMode || "media",
        persistenceRevision: Number(state?.persistedEditorRevision || 0),
      },
    };
  })()`);
}

async function waitForVerifiedSession(session, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastResult;
  while (Date.now() < deadline) {
    lastResult = await verifySession(session);
    if (lastResult.pass) return lastResult;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return lastResult;
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
  const connected = await connectClaudeTargets(options.port, options.timeoutMs);
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
        : options.mode === "evidence"
          ? await captureLiveSurfaceEvidence(session)
          : await waitForVerifiedSession(session, options.timeoutMs);
      results.push({ targetId: target.id, landmarks: probe.markers, result });

      if (options.screenshot && !screenshotCaptured) {
        await capture(session, options.screenshot);
        screenshotCaptured = true;
      }
    } finally {
      session.close();
    }
  }

  const failed = results.length === 0 || results.some((item) => !item.result?.pass);
  if (options.mode === "evidence") {
    console.log(JSON.stringify({
      kind: "cc-theme.live-surface-evidence-batch",
      schemaVersion: 1,
      adapter: "mac-claude",
      pass: !failed,
      privacy: "structure-only-no-user-content",
      targets: results,
    }, null, 2));
  } else {
    const phase = options.mode === "remove" ? "restore"
      : options.mode === "once" ? "apply" : "verify";
    const category = results.find((item) => item.result?.failureCategory)?.result?.failureCategory ||
      (failed ? "adapter-landmark" : null);
    console.log(JSON.stringify({
      kind: "cc-theme.lifecycle-result",
      schemaVersion: 1,
      phase,
      status: failed ? "failed" : "passed",
      failureCategory: category,
      pass: !failed,
      adapter: { id: "mac-claude", targetVersion: "1.22209.3" },
      version: SKIN_VERSION,
      port: options.port,
      targets: results,
    }, null, 2));
  }
  if (failed) process.exitCode = 2;
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
      const shell = document.querySelector('main.dframe-content');
      const sidebar = document.querySelector('aside.dframe-sidebar');
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
  if (!themeDir) throw new Error("An explicit validated external theme directory is required");
  const themeRoot = themeDir;
  const watchers = [];
  const add = (directory, kind) => {
    let watcher;
    try {
      watcher = watchFs(directory, { persistent: false }, (_event, filename) => {
        const name = filename ? String(filename) : "";
        const staticChanged = (directory === staticAssetsRoot
          && (!name || name === "skin.css" || name === "renderer-inject.js" || name === "background-effects.js" || name === "ui-interpreter.js")) ||
          (kind === "contract" && (!name || name === "theme-style-catalog.json" ||
            name === "theme-editor-locales.json" || name === "claude-locale-catalog.json"));
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

  const registerEarly = async (session, payload, revision) => {
    const result = await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: earlyPayloadFor(payload, revision),
    });
    return result.identifier ?? null;
  };

  const removeEarly = async (record) => {
    if (!record.earlyScriptId || record.session.closed) return;
    const identifier = record.earlyScriptId;
    record.earlyScriptId = null;
    await record.session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }).catch(() => {});
  };

  const refreshPayload = async () => {
    let next;
    try {
      next = await loadPayload(options.themeDir, { deferredVideo: true });
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
        const nextIdentifier = await registerEarly(session, current.payload, current.revision);
        if (record.earlyScriptId) {
          await session.send("Page.removeScriptToEvaluateOnNewDocument", {
            identifier: record.earlyScriptId,
          }).catch(() => {});
        }
        record.earlyScriptId = nextIdentifier;
        record.needsLoadFallback = !nextIdentifier;
        await applyToSession(session, current.payload);
        await transferDeferredMedia(session, current);
        await notifyThemeRuntimeResult(session, { ok: true });
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

  const queuePayloadRefresh = ({ staticChanged = false } = {}) => {
    if (staticChanged) invalidateStaticPayloadAssets();
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      reloadChain = reloadChain.then(refreshPayload).catch((error) => {
        console.error(`[cc-theme] theme reload failed: ${error.message}`);
      });
    }, 45);
  };
  const closePayloadWatchers = watchPayloadSources(options.themeDir, queuePayloadRefresh);

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
          record.session.close();
          sessions.delete(id);
        }
      }

      for (const target of targets) {
        if (sessions.has(target.id)) continue;
        let session;
        let record;
        try {
          session = await connectTarget(target, options.port);
          record = { session, earlyScriptId: null, needsLoadFallback: false, videoTransfer: Promise.resolve() };
          await installStyleEditorBinding(session, () => current, () => queuePayloadRefresh());
          try {
            record.earlyScriptId = await registerEarly(session, current.payload, current.revision);
            await session.evaluate(earlyPayloadFor(current.payload, current.revision));
          } catch (error) {
            record.needsLoadFallback = true;
            console.error(`[cc-theme] early injection unavailable: ${error.message}`);
          }
          const probe = await waitForClaudeProbe(session);
          if (!probe?.claude) {
            await removeEarly(record);
            session.close();
            if (!rejected.has(target.id)) {
              console.error(`[cc-theme] rejected non-Claude app target ${target.id}`);
              rejected.add(target.id);
            }
            continue;
          }
          rejected.delete(target.id);
          session.on("Page.loadEventFired", () => {
            setTimeout(() => {
              const snapshot = current;
              record.videoTransfer = record.videoTransfer.catch(() => {}).then(async () => {
                if (record.needsLoadFallback) await applyToSession(session, snapshot.payload);
                await transferDeferredMedia(session, snapshot);
              }).catch((error) => {
                notifyThemeRuntimeResult(session, {
                  ok: false,
                  stage: "media-load",
                  message: error.message,
                });
                console.error(`[cc-theme] navigation video transfer failed: ${error.message}`);
              });
            }, 0);
          });
          const earlyApplied = await session.evaluate(
            `window.__CC_THEME_EARLY_APPLIED__ === ${JSON.stringify(current.revision)}`,
          );
          if (!earlyApplied) {
            await session.evaluate(
              `window.__CC_THEME_EARLY_GENERATION__ = ${JSON.stringify(`fallback:${current.revision}`)}`,
            );
            await applyToSession(session, current.payload);
          }
          await transferDeferredMedia(session, current);
          await notifyThemeRuntimeResult(session, { ok: true });
          sessions.set(target.id, record);
          console.log(`[cc-theme] injected compatible Claude renderer ${target.id}`);
        } catch (error) {
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
    closePayloadWatchers();
    await reloadChain.catch(() => {});
    await Promise.all([...sessions.values()].map((record) => removeEarly(record)));
    for (const record of sessions.values()) record.session.close();
  }
}

if (path.resolve(process.argv[1] || "") === path.resolve(scriptPath)) {
  try {
    const options = parseArgs(process.argv.slice(2));
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
    } else {
      await runOneShot(options);
    }
  } catch (error) {
    console.error(`[cc-theme] ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}
