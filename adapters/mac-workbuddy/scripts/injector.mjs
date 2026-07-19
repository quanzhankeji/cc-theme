import fs from "node:fs/promises";
import { constants as fsConstants, watch as watchFs } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectDirectionalAtlas } from "./interactive-background.mjs";
import { normalizeSkinTheme } from "./skin-theme.mjs";
import { operationResult, writeOperationResult } from "./operation-result.mjs";
import { loadThemeSettingsLocales } from "./theme-settings-locales.mjs";
import { loadThemeStyleCatalog } from "./theme-style-catalog.mjs";
import { loadThemeRuntimeSettings, saveThemeRuntimeSettings } from "./theme-runtime-settings.mjs";
import { catalogPathFor, loadUiSurfaceCatalog, validateUiSurfaceCatalog } from "./ui-surface-catalog.mjs";
import {
  MAX_DIRECTIONAL_ATLAS_BYTES,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_MEDIA_BYTES,
  MAX_VIDEO_BYTES,
} from "./media-limits.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const here = path.dirname(scriptPath);
const root = path.resolve(here, "..");
const SKIN_VERSION = "5.2.6";
const DEFERRED_INTERACTIVE_ATLAS_SOURCE = "workbuddy-skin:deferred-interactive-atlas";
const TRANSFER_CHUNK_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_ART_BYTES = MAX_IMAGE_BYTES;
const SUPPORTED_ART_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
const THEME_SETTINGS_BINDING = "__workbuddyCcThemeSettingsUpdate";
const THEME_SETTINGS_RESULT_KEY = "__WORKBUDDY_CC_THEME_SETTINGS_RESULT__";
const RENDERER_SESSION_NONCE = randomBytes(18).toString("hex");
const RENDERER_REVISION_SCOPE = "renderer-session-generation";
const RELEASE_TRACEABILITY = "file-manifest-sha256";

export function assessVideoStartup(inspected) {
  if (!inspected || typeof inspected !== "object") {
    return { outcome: "pending", settled: false, code: "renderer-not-inspected" };
  }
  if (!inspected.videoEnabled) {
    return { outcome: "ready", settled: true, code: "startup-ready" };
  }
  if (inspected.videoDisabled) {
    return { outcome: "degraded", settled: true, code: "video-disabled" };
  }
  if (inspected.reducedMotion) {
    return { outcome: "degraded", settled: true, code: "reduced-motion-static" };
  }
  if (inspected.videoUserPaused) {
    return { outcome: "degraded", settled: true, code: "user-paused" };
  }
  if (inspected.documentHidden) {
    return { outcome: "degraded", settled: true, code: "background-paused" };
  }
  if (!["loopback-range", "blob-fallback"].includes(inspected.videoTransport)) {
    return { outcome: "failed", settled: true, code: "video-transport-rejected" };
  }
  if (!inspected.videoPresent) {
    return { outcome: "pending", settled: false, code: "video-not-present" };
  }
  if (inspected.videoPlaybackState === "error") {
    return { outcome: "failed", settled: true, code: "video-playback-error" };
  }
  if (!inspected.videoReady || inspected.videoPlaybackState === "loading") {
    return { outcome: "pending", settled: false, code: "video-not-ready" };
  }
  if (inspected.videoPlaybackState !== "playing") {
    return { outcome: "pending", settled: false, code: "video-not-playing" };
  }
  return {
    outcome: "ready",
    settled: true,
    code: inspected.videoTransport === "blob-fallback" ? "video-playing-blob-fallback" : "video-playing",
  };
}

const defaultSavedThemeRoot = (home = os.homedir()) =>
  path.join(home, "Library", "Application Support", "mac-workbuddy", "themes");

function parseArgs(argv) {
  const options = {
    port: 9342,
    mode: "watch",
    timeoutMs: 30000,
    screenshot: null,
    themeDir: null,
    themesRoot: defaultSavedThemeRoot(),
    reload: false,
    reportFile: null,
    startup: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--watch") options.mode = "watch";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--inspect") options.mode = "inspect";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--check-payload") options.mode = "check";
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++index]);
    else if (arg === "--theme-dir") options.themeDir = path.resolve(argv[++index]);
    else if (arg === "--themes-root") options.themesRoot = path.resolve(argv[++index]);
    else if (arg === "--reload") options.reload = true;
    else if (arg === "--report-file") options.reportFile = path.resolve(argv[++index]);
    else if (arg === "--startup") options.startup = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 120000) {
    throw new Error(`Invalid timeout: ${options.timeoutMs}`);
  }
  if (["check", "once", "watch"].includes(options.mode) && !options.themeDir) {
    throw new Error("--theme-dir is required; the WorkBuddy Adapter has no bundled or fallback theme");
  }
  if (options.startup && options.mode !== "verify") {
    throw new Error("--startup is only valid with --verify");
  }
  return options;
}

function assertContainedPath(rootPath, candidatePath, label) {
  const relative = path.relative(rootPath, candidatePath);
  if (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)) return;
  throw new Error(`${label} must stay inside its theme directory`);
}

function sameStat(left, right) {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
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

function imageSignatureMatches(extension, bytes) {
  if (extension === ".png") {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function imageMime(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
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
    const boxSize = bytesRead >= 8 ? header.readUInt32BE(0) : 0;
    if (bytesRead < 16 || header.subarray(4, 8).toString("ascii") !== "ftyp" || boxSize < 16 || boxSize > before.size) {
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
  const loaded = await readStableFile(atlasPath, "Directional background atlas", MAX_DIRECTIONAL_ATLAS_BYTES);
  const metadata = inspectDirectionalAtlas(loaded.bytes, interactiveBackground, "Directional background atlas");
  return { atlasPath, atlasStat: loaded.stat, metadata };
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

export function createLocalMediaServer({ onRequest = null } = {}) {
  const token = randomBytes(24).toString("hex");
  const route = `/${token}/background.mp4`;
  let current = null;
  let listening = null;
  const server = createServer(async (request, response) => {
    let handle;
    const method = request.method ?? "UNKNOWN";
    const reportRequest = (status, ranged = false) => onRequest?.({
      method: ["GET", "HEAD", "OPTIONS"].includes(method) ? method : "OTHER",
      status,
      ranged,
    });
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (!current || url.pathname !== route || !["GET", "HEAD"].includes(request.method ?? "")) {
        response.writeHead(404, { "Cache-Control": "no-store" });
        response.end();
        reportRequest(404);
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
        reportRequest(416, true);
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
        reportRequest(range ? 206 : 200, Boolean(range));
        return;
      }
      reportRequest(range ? 206 : 200, Boolean(range));
      const stream = handle.createReadStream({ start, end, autoClose: true });
      handle = null;
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    } catch {
      await handle?.close().catch(() => {});
      if (!response.headersSent) response.writeHead(409, { "Cache-Control": "no-store" });
      response.end();
      reportRequest(409, Boolean(request.headers.range));
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

async function loadTheme(themeDir) {
  if (!themeDir) throw new Error("An explicit external theme directory is required");
  const requestedRoot = themeDir;
  const assetsRoot = await fs.realpath(requestedRoot).catch((error) => {
    if (error.code === "ENOENT") throw new Error(`Theme directory does not exist: ${requestedRoot}`);
    throw error;
  });
  const stat = await fs.stat(assetsRoot);
  if (!stat.isDirectory()) throw new Error(`Theme root is not a directory: ${requestedRoot}`);

  const configPath = path.resolve(assetsRoot, "theme.json");
  assertContainedPath(assetsRoot, configPath, "Theme config");
  const config = await readStableFile(configPath, "Theme config", MAX_CONFIG_BYTES);
  let raw;
  try {
    raw = JSON.parse(decodeStrictUtf8(config.bytes, "Theme config"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${configPath} is not valid JSON`);
    throw error;
  }
  const theme = normalizeSkinTheme(raw, configPath);
  const extension = path.extname(theme.image).toLowerCase();
  if (!SUPPORTED_ART_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported theme image format: ${extension || "missing"}`);
  }
  const imagePath = path.resolve(assetsRoot, theme.image);
  assertContainedPath(assetsRoot, imagePath, "Theme image");
  const image = await readStableFile(imagePath, "Theme image", MAX_ART_BYTES);
  if (image.bytes.length < 12 || !imageSignatureMatches(extension, image.bytes)) {
    throw new Error(`Theme image content does not match its ${extension} extension`);
  }
  const video = theme.backgroundVideo ? await validateThemeVideo(assetsRoot, theme.backgroundVideo) : null;
  const atlas = await validateDirectionalAtlas(assetsRoot, theme.interactiveBackground);
  const totalMediaBytes = image.stat.size + (video?.videoStat.size ?? 0) + (atlas?.atlasStat.size ?? 0);
  if (totalMediaBytes > MAX_TOTAL_MEDIA_BYTES) {
    throw new Error(`Theme media exceed the ${MAX_TOTAL_MEDIA_BYTES}-byte total asset budget`);
  }
  return {
    assetsRoot,
    imagePath,
    imageBytes: image.bytes,
    videoPath: video?.videoPath ?? null,
    videoStat: video?.videoStat ?? null,
    interactiveAtlasPath: atlas?.atlasPath ?? null,
    interactiveAtlasStat: atlas?.atlasStat ?? null,
    interactiveAtlasMetadata: atlas?.metadata ?? null,
    theme,
  };
}

function replaceOnce(source, marker, value) {
  const first = source.indexOf(marker);
  if (first < 0) throw new Error(`Renderer payload marker is missing: ${marker}`);
  if (source.indexOf(marker, first + marker.length) >= 0) throw new Error(`Renderer payload marker is duplicated: ${marker}`);
  return `${source.slice(0, first)}${value}${source.slice(first + marker.length)}`;
}

async function loadPayload(themeDir, { videoUrlFor = null, themesRoot = defaultSavedThemeRoot() } = {}) {
  const startedAt = performance.now();
  const [{
    assetsRoot,
    imageBytes,
    imagePath,
    videoPath,
    videoStat,
    interactiveAtlasPath,
    interactiveAtlasStat,
    interactiveAtlasMetadata,
    theme,
  }, css, template, backgroundEffects, uiInterpreter, themeSettingsSession, themeSettingsLocale, themeSettingsColor, catalog, settingsLocales] = await Promise.all([
    loadTheme(themeDir),
    fs.readFile(path.join(root, "assets", "skin.css"), "utf8"),
    fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
    fs.readFile(path.join(root, "assets", "background-effects.js"), "utf8"),
    fs.readFile(path.join(root, "assets", "ui-interpreter.js"), "utf8"),
    fs.readFile(path.join(root, "assets", "theme-settings-session.js"), "utf8"),
    fs.readFile(path.join(root, "assets", "theme-settings-locale.js"), "utf8"),
    fs.readFile(path.join(root, "assets", "theme-settings-color.js"), "utf8"),
    loadUiSurfaceCatalog(),
    loadThemeSettingsLocales(),
  ]);
  const savedThemeRoot = path.resolve(themesRoot);
  const themeSettingsNonce = randomBytes(18).toString("hex");
  const catalogErrors = validateUiSurfaceCatalog(catalog);
  if (catalogErrors.length) throw new Error(`Invalid UI Surface Catalog:\n- ${catalogErrors.join("\n- ")}`);
  const styleCatalog = await loadThemeStyleCatalog(catalog.runtimeRoles);
  const runtimeSettingsRoot = path.join(path.dirname(savedThemeRoot), "settings");
  const runtimeSettingsRecord = await loadThemeRuntimeSettings(theme, styleCatalog, { root: runtimeSettingsRoot });
  const runtimeSettings = runtimeSettingsRecord.state;
  const runtimeSettingsDiagnostics = {
    status: runtimeSettingsRecord.status,
    diagnostics: runtimeSettingsRecord.diagnostics ?? [],
    quarantineCount: runtimeSettingsRecord.quarantine?.length ?? 0,
  };
  const runtimeCatalog = {
    schemaVersion: catalog.schemaVersion,
    targetVersion: catalog.target.version,
    roles: catalog.runtimeRoles,
    interpreter: { ...catalog.runtimeInterpreter, roles: catalog.runtimeRoles },
  };
  const artUrl = `data:${imageMime(imagePath)};base64,${imageBytes.toString("base64")}`;
  const videoUrl = videoPath && videoUrlFor ? await videoUrlFor(videoPath, videoStat) : null;
  const revision = createHash("sha256")
    .update(RENDERER_SESSION_NONCE)
    .update(SKIN_VERSION).update(css).update(template).update(backgroundEffects).update(uiInterpreter)
    .update(themeSettingsSession).update(themeSettingsLocale).update(themeSettingsColor)
    .update(JSON.stringify(theme)).update(JSON.stringify(runtimeCatalog)).update(JSON.stringify(styleCatalog))
    .update(JSON.stringify(settingsLocales)).update(JSON.stringify(runtimeSettings))
    .update(JSON.stringify(runtimeSettingsDiagnostics))
    .update(imageBytes)
    .update(videoStat ? `${videoPath}:${videoStat.dev}:${videoStat.ino}:${videoStat.size}:${videoStat.mtimeMs}` : "no-video")
    .update(interactiveAtlasStat
      ? `${interactiveAtlasPath}:${interactiveAtlasStat.dev}:${interactiveAtlasStat.ino}:${interactiveAtlasStat.size}:${interactiveAtlasStat.mtimeMs}`
      : "no-interactive-atlas")
    .digest("hex").slice(0, 20);
  let payload = template;
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_CSS_JSON__", JSON.stringify(css));
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_ART_JSON__", JSON.stringify(artUrl));
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_VIDEO_JSON__", JSON.stringify(videoUrl));
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_INTERACTIVE_ATLAS_JSON__", JSON.stringify(
    interactiveAtlasPath ? DEFERRED_INTERACTIVE_ATLAS_SOURCE : null,
  ));
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_BACKGROUND_EFFECT_FACTORY__", backgroundEffects);
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_UI_INTERPRETER_FACTORY__", uiInterpreter);
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_THEME_SETTINGS_SESSION_FACTORY__", themeSettingsSession);
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_THEME_SETTINGS_LOCALE_FACTORY__", themeSettingsLocale);
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_THEME_SETTINGS_COLOR_FACTORY__", themeSettingsColor);
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_THEME_JSON__", JSON.stringify(theme));
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_CATALOG_JSON__", JSON.stringify(runtimeCatalog));
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_STYLE_CATALOG_JSON__", JSON.stringify(styleCatalog));
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_SETTINGS_LOCALES_JSON__", JSON.stringify(settingsLocales));
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_THEME_SETTINGS_STATE_JSON__", JSON.stringify(runtimeSettings));
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_THEME_SETTINGS_DIAGNOSTICS_JSON__", JSON.stringify(runtimeSettingsDiagnostics));
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_THEME_SETTINGS_NONCE_JSON__", JSON.stringify(themeSettingsNonce));
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_THEME_SETTINGS_BINDING_JSON__", JSON.stringify(THEME_SETTINGS_BINDING));
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_VERSION_JSON__", JSON.stringify(SKIN_VERSION));
  payload = replaceOnce(payload, "__WORKBUDDY_SKIN_REVISION_JSON__", JSON.stringify(revision));
  return {
    payload,
    revision,
    theme,
    styleCatalog,
    assetsRoot,
    runtimeSettings,
    runtimeSettingsStatus: runtimeSettingsRecord.status,
    runtimeSettingsDiagnostics,
    runtimeSettingsQuarantine: runtimeSettingsRecord.quarantine ?? [],
    runtimeSettingsContext: { root: runtimeSettingsRoot },
    themeSettingsNonce,
    targetVersion: catalog.target.version,
    runtimeRoles: runtimeCatalog.roles.length,
    styleBindings: styleCatalog.bindings.length,
    settingsLocales: settingsLocales.locales.length,
    imageBytes: imageBytes.length,
    videoBytes: videoStat?.size ?? 0,
    videoEnabled: Boolean(videoPath),
    videoPath,
    videoStat,
    backgroundRenderMode: theme.backgroundRenderMode,
    interactiveAtlasBytes: interactiveAtlasStat?.size ?? 0,
    interactiveAtlasPath,
    interactiveAtlasStat,
    interactiveAtlasMetadata,
    payloadBytes: Buffer.byteLength(payload),
    buildMs: Number((performance.now() - startedAt).toFixed(3)),
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

async function sendThemeSettingsResult(session, executionContextId, requestId, result) {
  if (session.closed) return;
  await session.send("Runtime.evaluate", {
    expression: `window[${JSON.stringify(THEME_SETTINGS_RESULT_KEY)}]?.(${JSON.stringify(requestId)}, ${JSON.stringify(result)})`,
    contextId: executionContextId,
    awaitPromise: false,
    returnByValue: true,
    userGesture: false,
  }).catch(() => {});
}

async function installThemeSettingsBinding(session, currentPayload) {
  await session.send("Runtime.addBinding", { name: THEME_SETTINGS_BINDING });
  const lastRevisionByContext = new Map();
  let writeChain = Promise.resolve();
  session.on("Runtime.bindingCalled", (params) => {
    if (params.name !== THEME_SETTINGS_BINDING) return;
    writeChain = writeChain.then(async () => {
      let requestId = "unknown";
      try {
        if (Buffer.byteLength(params.payload ?? "", "utf8") > 128 * 1024) {
          throw new Error("Theme settings request is too large");
        }
        const message = JSON.parse(params.payload ?? "null");
        requestId = typeof message?.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(message.requestId)
          ? message.requestId : "unknown";
        const current = currentPayload();
        if (!current || message?.nonce !== current.themeSettingsNonce || message?.themeId !== current.theme.id) {
          throw new Error("Theme settings session is stale; reopen CC-Theme settings");
        }
        if (!Number.isSafeInteger(message?.revision) || message.revision < 1) {
          throw new Error("Theme settings revision is invalid");
        }
        const contextKey = `${params.executionContextId ?? 0}:${current.theme.id}:${current.themeSettingsNonce}`;
        const lastRevision = lastRevisionByContext.get(contextKey) ?? 0;
        if (message.revision <= lastRevision) {
          await sendThemeSettingsResult(session, params.executionContextId, requestId, {
            ok: false,
            code: "superseded-write",
            revision: message.revision,
          });
          return;
        }
        const saved = await saveThemeRuntimeSettings(current.theme, current.styleCatalog, message.state, {
          root: current.runtimeSettingsContext.root,
          quarantine: current.runtimeSettingsQuarantine,
        });
        current.runtimeSettings = saved.state;
        lastRevisionByContext.set(contextKey, message.revision);
        await sendThemeSettingsResult(session, params.executionContextId, requestId, {
          ok: true,
          code: "settings-persisted",
          revision: message.revision,
          state: saved.state,
        });
      } catch (error) {
        await sendThemeSettingsResult(session, params.executionContextId, requestId, {
          ok: false,
          code: error?.code === "ADAPTER_THEME_BASE_STALE" ? "stale-theme-base" : "settings-persist-failed",
          message: String(error?.message || "Theme settings update failed").slice(0, 240),
        });
      }
    }).catch((error) => {
      console.error(`[workbuddy-skin] settings write queue failed: ${error.message}`);
    });
  });
}

function likelyMainRenderer(target) {
  if (target.type !== "page" || !target.webSocketDebuggerUrl) return false;
  try {
    const url = new URL(target.url);
    if (url.protocol !== "file:") return false;
    const file = decodeURIComponent(url.pathname);
    return file.endsWith("/Contents/Resources/app.asar/renderer/index.html");
  } catch {
    return false;
  }
}

async function listAppTargets(port) {
  return (await listWatchTargets(port)).filter(likelyMainRenderer);
}

async function listWatchTargets(port) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: controller.signal });
    if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
    const targets = await response.json();
    return targets.filter((target) => {
      if (target?.type !== "page" || !target.webSocketDebuggerUrl) return false;
      try {
        validatedDebuggerUrl(target, port);
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
    const applicationName = document.body?.dataset.applicationName ?? null;
    const sidebar = Boolean(document.querySelector('[data-view-id="sidebar"]'));
    const main = Boolean(document.querySelector('[data-view-id="main-content"]'));
    const shell = Boolean(document.querySelector('.teams-container'));
    return {
      applicationName,
      markers: { shell, sidebar, main },
      workbuddy: applicationName === 'workbuddy' && shell && main,
    };
  })()`);
}

async function waitForProbe(session, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let probe;
  while (Date.now() < deadline) {
    probe = await probeSession(session);
    if (probe?.workbuddy) return probe;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return probe;
}

async function connectTarget(target, port) {
  return new CdpSession(target, port).open();
}

async function connectWorkBuddyTargets(port, timeoutMs) {
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
          const probe = await waitForProbe(session, 1200);
          if (probe?.workbuddy) connected.push({ target, session, probe });
          else session.close();
        } catch (error) {
          session?.close();
          lastError = error;
        }
      }
      if (connected.length) return connected;
      lastError = new Error("No page matched WorkBuddy shell markers");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No verified WorkBuddy renderer on 127.0.0.1:${port}: ${lastError?.message ?? "timed out"}`);
}

async function applyToSession(session, payload) {
  return session.evaluate(payload);
}

export async function transferDeferredInteractiveAtlas(session, loaded) {
  const filePath = loaded?.interactiveAtlasPath;
  const fileStat = loaded?.interactiveAtlasStat;
  if (!filePath || !fileStat) return { transferred: false, bytes: 0 };
  const transferId = randomBytes(18).toString("hex");
  const themeId = String(loaded.theme.id);
  const expectedBytes = fileStat.size;
  const transferKey = "__WORKBUDDY_SKIN_INTERACTIVE_ATLAS_TRANSFER__";
  const initialized = await session.evaluate(`(() => {
    const state = window.__WORKBUDDY_SKIN_STATE__;
    if (typeof state?.setDeferredInteractiveAtlasSource !== 'function' ||
        state.themeId !== ${JSON.stringify(themeId)}) return false;
    window[${JSON.stringify(transferKey)}] = {
      id: ${JSON.stringify(transferId)}, parts: [], bytes: 0, expected: ${expectedBytes}
    };
    return true;
  })()`);
  if (!initialized) throw new Error("Renderer is not ready for the deferred directional background atlas");

  let handle;
  try {
    handle = await fs.open(filePath, OPEN_FLAGS);
    const before = await handle.stat();
    if (!sameStat(before, fileStat)) throw new Error("Directional background atlas changed before deferred transfer");
    const buffer = Buffer.allocUnsafe(TRANSFER_CHUNK_BYTES);
    let position = 0;
    while (position < expectedBytes) {
      const length = Math.min(buffer.length, expectedBytes - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (!bytesRead) throw new Error("Directional background atlas ended during deferred transfer");
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
      if (!accepted) throw new Error("Renderer navigated during directional background atlas transfer");
      position += bytesRead;
    }
    const after = await handle.stat();
    if (!sameStat(before, after)) throw new Error("Directional background atlas changed during deferred transfer");
    const committed = await session.evaluate(`(() => {
      const transfer = window[${JSON.stringify(transferKey)}];
      if (!transfer || transfer.id !== ${JSON.stringify(transferId)} ||
          transfer.bytes !== transfer.expected || transfer.bytes !== ${expectedBytes}) return false;
      const source = URL.createObjectURL(new Blob(transfer.parts, { type: 'image/webp' }));
      delete window[${JSON.stringify(transferKey)}];
      const accepted = window.__WORKBUDDY_SKIN_STATE__?.setDeferredInteractiveAtlasSource?.(
        source,
        ${JSON.stringify(themeId)},
      ) === true;
      if (!accepted) URL.revokeObjectURL(source);
      return accepted;
    })()`);
    if (!committed) throw new Error("Renderer rejected the directional background atlas");
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

async function removeFromSession(session) {
  return session.evaluate(`(() => {
    window.__WORKBUDDY_SKIN_DISABLED__ = true;
    const state = window.__WORKBUDDY_SKIN_STATE__;
    if (state?.cleanup) return state.cleanup();
    document.querySelectorAll('[data-workbuddy-skin-role]').forEach((node) => node.removeAttribute('data-workbuddy-skin-role'));
    document.querySelectorAll('[data-workbuddy-skin-owned="true"]').forEach((node) => node.remove());
    document.documentElement?.classList.remove('workbuddy-skin');
    delete document.documentElement?.dataset.workbuddySkinVideo;
    delete window.__WORKBUDDY_SKIN_STATE__;
    return true;
  })()`);
}

async function verifyRemovedSession(session) {
  return session.evaluate(`(() =>
    !document.documentElement.classList.contains('workbuddy-skin') &&
    !document.querySelector('[data-workbuddy-skin-owned="true"]') &&
    !document.querySelector('[data-workbuddy-skin-role]') &&
    ![...document.documentElement.style].some((name) => name.startsWith('--wbs-')) &&
    !window.__WORKBUDDY_SKIN_STATE__
  )()`);
}

async function verifySession(session) {
  const result = await session.evaluate(`(() => {
    const probe = {
      applicationName: document.body?.dataset.applicationName ?? null,
      shell: Boolean(document.querySelector('.teams-container')),
      sidebar: Boolean(document.querySelector('[data-view-id="sidebar"]')),
      main: Boolean(document.querySelector('[data-view-id="main-content"]')),
    };
    const state = window.__WORKBUDDY_SKIN_STATE__;
    const inspected = state?.inspect?.() ?? null;
    const result = {
      installed: document.documentElement.classList.contains('workbuddy-skin'),
      version: state?.version ?? null,
      revision: state?.revision ?? null,
      themeId: state?.themeId ?? null,
      stylePresent: Boolean(document.getElementById('workbuddy-skin-style')),
      backgroundPresent: Boolean(document.getElementById('workbuddy-skin-background')),
      probe,
      inspected,
      viewport: { width: innerWidth, height: innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
    const interactivePass = !inspected?.interactiveEnabled || Boolean(
      inspected.interactiveLayerPresent && inspected.interactiveCanvasPresent &&
      inspected.interactivePointerEvents === 'none' &&
      ['enabled', 'static', 'fallback'].includes(inspected.interactiveRuntimeState)
    );
    result.structuralPass = Boolean(
      probe.applicationName === 'workbuddy' && probe.shell && probe.main &&
      result.installed && result.version === ${JSON.stringify(SKIN_VERSION)} &&
      result.stylePresent && result.backgroundPresent && inspected?.markedRoles >= 5 &&
      interactivePass &&
      !result.horizontalOverflow
    );
    return result;
  })()`);
  const startup = assessVideoStartup(result.inspected);
  result.startup = startup;
  result.settled = Boolean(result.structuralPass && startup.settled);
  result.pass = Boolean(result.structuralPass && startup.outcome === "ready");
  return result;
}

async function inspectSurfaceSession(session) {
  return session.evaluate(`(() => {
    const stableToken = (value) => {
      if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9:_-]{0,79}$/.test(value)) return null;
      if (/[A-Fa-f0-9]{20,}/.test(value) || /[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(value)) return null;
      return value;
    };
    const stableClasses = (node) => [...(node?.classList || [])]
      .map(stableToken)
      .filter(Boolean)
      .slice(0, 24);
    const structuralIds = new Set([
      'root', 'workbuddy-skin-background', 'workbuddy-skin-background-art',
      'workbuddy-skin-background-video', 'workbuddy-skin-interactive-layer',
      'workbuddy-skin-video-toggle', 'workbuddy-cc-theme-settings-nav',
      'workbuddy-cc-theme-settings-panel'
    ]);
    const stableId = (node) => structuralIds.has(node?.id) ? node.id : null;
    const booleanAttribute = (node, name) => node.hasAttribute?.(name)
      ? node.getAttribute(name) !== 'false'
      : null;
    const describe = (node) => {
      if (!node) return null;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        tag: node.tagName?.toLowerCase() ?? null,
        id: stableId(node),
        stableClasses: stableClasses(node),
        viewId: stableToken(node.getAttribute?.('data-view-id')),
        semanticRole: stableToken(node.getAttribute?.('role')),
        interpreterRole: stableToken(node.getAttribute?.('data-workbuddy-skin-role')),
        childCount: node.children?.length ?? 0,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        interaction: {
          disabled: Boolean(node.disabled) || booleanAttribute(node, 'aria-disabled'),
          hidden: Boolean(node.hidden) || booleanAttribute(node, 'aria-hidden'),
          expanded: booleanAttribute(node, 'aria-expanded'),
          selected: booleanAttribute(node, 'aria-selected'),
          pressed: booleanAttribute(node, 'aria-pressed'),
          checked: booleanAttribute(node, 'aria-checked'),
        },
        computedStyle: {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          backgroundColor: style.backgroundColor,
          color: style.color,
          borderColor: style.borderColor,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          position: style.position,
          zIndex: style.zIndex,
          pointerEvents: style.pointerEvents,
          overflow: style.overflow,
        },
      };
    };
    const ancestryAt = (x, y) => {
      const result = [];
      let node = document.elementFromPoint(x, y);
      while (node && result.length < 12) { result.push(describe(node)); node = node.parentElement; }
      return result;
    };
    const selectorList = [
      'body', '#root', '.teams-container', '[data-view-id="sidebar"]', '.conversation-sidebar',
      '.conversation-list', '[data-view-id="main-content"]', '.teams-content-wrapper',
      '.teams-main-content', '.main-content--welcome', '.chat-container--welcome', '.wb-cb-chat',
      '.wb-home-page', '.workbuddy-topbar', '.wb-home-composer', '.wb-home-composer__chips',
      '.wb-home-composer__input-slot', '[data-cb-chat-input-toolbar-selector="true"]', '.wb-input-footer',
      '[role="textbox"][data-slate-editor="true"]', '[data-slate-placeholder="true"]',
      '.detail-panel-container'
    ];
    const selectors = Object.fromEntries(selectorList.map((selector) => [selector, describe(document.querySelector(selector))]));
    const selectorCounts = Object.fromEntries(selectorList.map((selector) => [selector, document.querySelectorAll(selector).length]));
    const backgroundNode = document.getElementById('workbuddy-skin-background');
    const backgroundStyle = backgroundNode ? getComputedStyle(backgroundNode) : null;
    const artworkNode = document.getElementById('workbuddy-skin-background-art');
    const videoNode = document.getElementById('workbuddy-skin-background-video');
    return {
      kind: "workbuddy.surface-evidence",
      schemaVersion: 1,
      privacy: "content-free",
      viewport: { width: innerWidth, height: innerHeight },
      selectors,
      selectorCounts,
      samples: {
        mainTop: ancestryAt(Math.round(innerWidth * .62), 120),
        mainCenter: ancestryAt(Math.round(innerWidth * .62), Math.round(innerHeight * .34)),
        composerInput: ancestryAt(Math.round(innerWidth * .62), Math.round(innerHeight * .63)),
        composerCenter: ancestryAt(Math.round(innerWidth * .62), Math.round(innerHeight * .72)),
        sidebarCenter: ancestryAt(120, Math.round(innerHeight * .28)),
      },
      backgroundLayer: backgroundNode ? {
        rect: describe(backgroundNode).rect,
        zIndex: backgroundStyle.zIndex,
        backgroundColor: backgroundStyle.backgroundColor,
        artworkPresent: Boolean(artworkNode),
        imageComplete: artworkNode?.complete ?? false,
        naturalSize: artworkNode ? { width: artworkNode.naturalWidth, height: artworkNode.naturalHeight } : null,
        position: backgroundStyle.backgroundPosition,
        size: backgroundStyle.backgroundSize,
      } : null,
      videoLayer: videoNode ? {
        rect: describe(videoNode).rect,
        ready: videoNode.dataset.ready === 'true',
        playbackState: videoNode.dataset.playbackState || null,
        muted: videoNode.muted,
        loop: videoNode.loop,
        playsInline: videoNode.playsInline,
        errorCode: videoNode.error?.code ?? null,
        networkState: videoNode.networkState,
        readyState: videoNode.readyState,
      } : null,
    };
  })()`);
}

async function waitForVerifiedSession(session, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let result;
  while (Date.now() < deadline) {
    result = await verifySession(session);
    if (result.settled) return result;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return result;
}

async function capture(session, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const result = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await fs.writeFile(outputPath, Buffer.from(result.data, "base64"));
}

const operationForMode = (mode) => mode === "once" ? "apply" : mode === "remove" ? "pause" :
  mode === "verify" ? "verify" : mode === "check" ? "preflight" : "check";

const failureClassification = (mode, error = null) => {
  const message = String(error?.message || "");
  if (mode === "check" || /theme|palette|media|payload|catalog|atlas|font|color|package|image|video|runtime settings/i.test(message)) {
    return "theme-contract-failure";
  }
  if (mode === "inspect") return "adapter-landmark-failure";
  if (mode === "once" || mode === "verify") return "visual-verification-failure";
  return `${operationForMode(mode)}-failed`;
};

async function runOneShot(options) {
  const mediaServer = options.mode === "once" ? createLocalMediaServer() : null;
  try {
    const connected = await connectWorkBuddyTargets(options.port, options.timeoutMs);
    const loaded = options.mode === "once" ? await loadPayload(options.themeDir, {
      videoUrlFor: (videoPath, videoStat) => mediaServer.urlFor(videoPath, videoStat),
      themesRoot: options.themesRoot,
    }) : null;
    if (loaded?.videoEnabled) {
      throw new Error("Video themes require the long-lived --watch media lifecycle");
    }
    const results = [];
    let screenshotCaptured = false;
    for (const { target, session, probe } of connected) {
      try {
        if (options.mode === "remove") await removeFromSession(session);
        else if (options.mode === "once") await applyToSession(session, loaded.payload);
        if (options.reload) {
          await session.send("Page.reload", { ignoreCache: true });
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (options.mode === "once") await applyToSession(session, loaded.payload);
        }
        if (loaded && options.mode !== "remove") await transferDeferredInteractiveAtlas(session, loaded);
        const result = options.mode === "remove"
          ? await verifyRemovedSession(session)
          : options.mode === "inspect"
            ? await inspectSurfaceSession(session)
            : await waitForVerifiedSession(session, options.timeoutMs);
        results.push({ targetId: target.id, probe, result });
        if (options.screenshot && !screenshotCaptured) {
          await capture(session, options.screenshot);
          screenshotCaptured = true;
        }
      } finally {
        session.close();
      }
    }
    const verifiedResults = ["once", "verify"].includes(options.mode)
      ? results.map((item) => item.result) : [];
    const startupFailure = verifiedResults.find((result) =>
      result?.startup?.outcome === "failed" || result?.settled !== true);
    const startupDegraded = verifiedResults.find((result) => result?.startup?.outcome === "degraded");
    const failed = !results.length || (options.mode === "remove"
      ? results.some((item) => item.result !== true)
      : options.mode === "inspect" ? false : Boolean(startupFailure));
    const degraded = !failed && Boolean(startupDegraded);
    const operation = operationForMode(options.mode);
    const code = failed ? (startupFailure?.startup?.code ?? failureClassification(options.mode))
      : degraded ? startupDegraded.startup.code : `${operation}-ok`;
    const report = operationResult({
      operation,
      status: failed ? "failed" : degraded ? "partial" : "ok",
      changed: !failed && ["once", "remove"].includes(options.mode),
      code,
      message: failed ? `WorkBuddy ${operation} did not satisfy its verification contract`
        : degraded ? `WorkBuddy ${operation} completed with an explicit playback downgrade`
          : `WorkBuddy ${operation} completed`,
    });
    const output = {
      ...report,
      mode: options.mode,
      startup: options.startup,
      version: SKIN_VERSION,
      port: options.port,
      targets: results,
    };
    if (options.reportFile) await writeOperationResult(options.reportFile, output);
    console.log(JSON.stringify(output, null, 2));
    if (failed) process.exitCode = 2;
  } finally {
    await mediaServer?.close();
  }
}

export function earlyPayloadFor(payload, revision) {
  return `(() => {
    const generationKey = '__WORKBUDDY_SKIN_EARLY_GENERATION__';
    const appliedKey = '__WORKBUDDY_SKIN_EARLY_APPLIED__';
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
      if (window[generationKey] !== generation || window.__WORKBUDDY_SKIN_DISABLED__) { stop(); return true; }
      if (!document.documentElement || !document.body) return false;
      const workbuddy = Boolean(document.body);
      if (!workbuddy) return false;
      const result = ${payload};
      if (result?.installed !== true) return false;
      stop();
      window[appliedKey] = generation;
      return true;
    };
    if (install()) return;
    if (typeof MutationObserver === 'function' && document.documentElement) {
      observer = new MutationObserver(install);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-application-name', 'data-platform', 'data-product-version'],
      });
    }
    timeout = setTimeout(stop, 12000);
  })()`;
}

function watchPayloadSources(themeDir, onDirty) {
  const staticRoot = path.join(root, "assets");
  const contractRoot = path.join(root, "contracts");
  const themeRoot = path.resolve(themeDir);
  const catalogRoot = path.dirname(catalogPathFor());
  const directories = new Set([staticRoot, contractRoot, themeRoot, catalogRoot]);
  const payloadFiles = new Set([
    "skin.css", "renderer-inject.js", "background-effects.js", "ui-interpreter.js", "theme-settings-session.js",
    "theme-settings-locale.js", "theme.json",
    "ui-surface-catalog.json", "theme-style-catalog.json", "theme-settings-locales.json",
  ]);
  const watchers = [];
  for (const directory of directories) {
    try {
      const watcher = watchFs(directory, { persistent: false }, (_event, filename) => {
        const name = filename ? String(filename) : "";
        if (!name || payloadFiles.has(name) || directory === themeRoot) onDirty();
      });
      watcher.on("error", (error) => console.error(`[workbuddy-skin] file watch unavailable: ${error.message}`));
      watchers.push(watcher);
    } catch (error) {
      console.error(`[workbuddy-skin] file watch unavailable for ${directory}: ${error.message}`);
    }
  }
  return () => watchers.forEach((watcher) => watcher.close());
}

async function runWatch(options) {
  const watcherStartedAt = performance.now();
  let mediaRequestCount = 0;
  const mediaServer = createLocalMediaServer({
    onRequest: ({ method, status, ranged }) => {
      mediaRequestCount += 1;
      if (mediaRequestCount === 1 || status >= 400) {
        console.log(`[workbuddy-skin] media request ${method} status=${status} ranged=${ranged}`);
      }
    },
  });
  let current;
  try {
    current = await loadPayload(options.themeDir, {
      videoUrlFor: (videoPath, videoStat) => mediaServer.urlFor(videoPath, videoStat),
      themesRoot: options.themesRoot,
    });
  } catch (error) {
    await mediaServer.close();
    throw error;
  }
  const sessions = new Map();
  const watcherTargetTimingsMs = {
    firstPageCandidate: null,
    firstMainRendererCandidate: null,
    firstEarlyRegistration: null,
    firstVerifiedRenderer: null,
  };
  let stopping = false;
  let refreshTimer = null;
  let refreshChain = Promise.resolve();
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const writeWatcherReport = async () => {
    if (!options.reportFile) return;
    await writeOperationResult(options.reportFile, {
      ...operationResult({
        operation: "check",
        status: "ok",
        changed: false,
        code: "watcher-ready",
        message: "The WorkBuddy Watcher and media lifecycle are ready",
        details: {
          videoEnabled: current.videoEnabled,
          videoTransport: current.videoEnabled ? "loopback-range" : "none",
          payloadBuildMs: Math.min(120000, Math.max(0, current.buildMs)),
          watcherStartupMs: Number(Math.min(120000, performance.now() - watcherStartedAt).toFixed(3)),
          generationContract: "single-long-lived-watcher",
          targetTimingsMs: watcherTargetTimingsMs,
        },
      }),
      version: SKIN_VERSION,
      revision: current.revision,
      revisionScope: RENDERER_REVISION_SCOPE,
      releaseTraceability: RELEASE_TRACEABILITY,
    });
  };
  await writeWatcherReport();

  const registerEarly = async (session) => {
    const result = await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: earlyPayloadFor(current.payload, current.revision),
    });
    return result.identifier ?? null;
  };

  const refresh = async () => {
    const next = await loadPayload(options.themeDir, {
      videoUrlFor: (videoPath, videoStat) => mediaServer.urlFor(videoPath, videoStat),
      themesRoot: options.themesRoot,
    });
    if (next.revision === current.revision) return;
    current = next;
    for (const record of sessions.values()) {
      if (record.session.closed) continue;
      const nextIdentifier = await registerEarly(record.session);
      if (record.earlyScriptId) {
        await record.session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: record.earlyScriptId }).catch(() => {});
      }
      record.earlyScriptId = nextIdentifier;
      await applyToSession(record.session, current.payload);
      await transferDeferredInteractiveAtlas(record.session, current);
    }
    console.log(`[workbuddy-skin] refreshed ${current.theme.id} (${current.buildMs}ms)`);
  };

  const queuePayloadRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshChain = refreshChain.then(refresh).catch((error) => console.error(`[workbuddy-skin] refresh failed: ${error.message}`));
    }, 80);
  };
  const closeWatchers = watchPayloadSources(options.themeDir, queuePayloadRefresh);

  try {
    while (!stopping) {
      let targets = [];
      try {
        targets = await listWatchTargets(options.port);
      } catch (error) {
        console.error(`[workbuddy-skin] target discovery failed: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      let watcherReportChanged = false;
      if (targets.length && watcherTargetTimingsMs.firstPageCandidate === null) {
        watcherTargetTimingsMs.firstPageCandidate = Number((performance.now() - watcherStartedAt).toFixed(3));
        watcherReportChanged = true;
      }
      if (targets.some(likelyMainRenderer) && watcherTargetTimingsMs.firstMainRendererCandidate === null) {
        watcherTargetTimingsMs.firstMainRendererCandidate = Number((performance.now() - watcherStartedAt).toFixed(3));
        watcherReportChanged = true;
      }
      if (watcherReportChanged) await writeWatcherReport();
      const activeIds = new Set(targets.map((target) => target.id));
      for (const [id, record] of sessions) {
        if (!activeIds.has(id) || record.session.closed) {
          record.session.close();
          sessions.delete(id);
        }
      }
      for (const target of targets) {
        const existing = sessions.get(target.id);
        if (existing) {
          if (existing.pending && likelyMainRenderer(target)) {
            try {
              await existing.session.evaluate(earlyPayloadFor(current.payload, current.revision));
              const probe = await waitForProbe(existing.session, 3000);
              if (probe?.workbuddy) {
                const earlyApplied = await existing.session.evaluate(
                  `window.__WORKBUDDY_SKIN_EARLY_APPLIED__ === ${JSON.stringify(current.revision)}`,
                );
                if (!earlyApplied) await applyToSession(existing.session, current.payload);
                await transferDeferredInteractiveAtlas(existing.session, current);
                existing.pending = false;
                if (watcherTargetTimingsMs.firstVerifiedRenderer === null) {
                  watcherTargetTimingsMs.firstVerifiedRenderer = Number((performance.now() - watcherStartedAt).toFixed(3));
                  await writeWatcherReport();
                }
                console.log(`[workbuddy-skin] injected ${target.id}`);
              }
            } catch (error) {
              console.error(`[workbuddy-skin] pending renderer handoff failed for ${target.id}: ${error.message}`);
            }
          }
          continue;
        }
        let session;
        let earlyScriptId = null;
        try {
          session = await connectTarget(target, options.port);
          // Runtime settings already preview in this renderer. Rebuilding the payload
          // after each successful write would rotate its nonce while the user is still
          // editing and reject the next debounced control update as stale.
          await installThemeSettingsBinding(session, () => current);
          earlyScriptId = await registerEarly(session);
          if (watcherTargetTimingsMs.firstEarlyRegistration === null) {
            watcherTargetTimingsMs.firstEarlyRegistration = Number((performance.now() - watcherStartedAt).toFixed(3));
            await writeWatcherReport();
          }
          const record = { session, earlyScriptId, pending: true };
          session.on("Page.loadEventFired", () => {
            setTimeout(() => {
              // A reload is the handoff boundary: rebuild from the latest atomically
              // persisted settings, rotate the generation nonce, then reinject.
              refreshChain = refreshChain.then(async () => {
                await refresh();
                const snapshot = current;
                await session.evaluate(earlyPayloadFor(snapshot.payload, snapshot.revision));
                await transferDeferredInteractiveAtlas(session, snapshot);
              }).catch((error) => {
                console.error(`[workbuddy-skin] reinject failed: ${error.message}`);
              });
            }, 0);
          });
          sessions.set(target.id, record);
          // Register before a candidate target navigates to the WorkBuddy renderer.
          // The payload itself accepts only the versioned file-path/bootstrap identity.
          await session.evaluate(earlyPayloadFor(current.payload, current.revision));
          if (likelyMainRenderer(target)) {
            const probe = await waitForProbe(session, 3000);
            if (probe?.workbuddy) {
              const earlyApplied = await session.evaluate(
                `window.__WORKBUDDY_SKIN_EARLY_APPLIED__ === ${JSON.stringify(current.revision)}`,
              );
              if (!earlyApplied) await applyToSession(session, current.payload);
              await transferDeferredInteractiveAtlas(session, current);
              record.pending = false;
              if (watcherTargetTimingsMs.firstVerifiedRenderer === null) {
                watcherTargetTimingsMs.firstVerifiedRenderer = Number((performance.now() - watcherStartedAt).toFixed(3));
                await writeWatcherReport();
              }
              console.log(`[workbuddy-skin] injected ${target.id}`);
            }
          }
        } catch (error) {
          if (earlyScriptId && session && !session.closed) {
            await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: earlyScriptId }).catch(() => {});
          }
          session?.close();
          console.error(`[workbuddy-skin] injection failed for ${target.id}: ${error.message}`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, sessions.size ? 800 : 250));
    }
  } finally {
    if (refreshTimer) clearTimeout(refreshTimer);
    closeWatchers();
    await refreshChain.catch(() => {});
    await mediaServer.close();
    for (const record of sessions.values()) record.session.close();
  }
}

if (path.resolve(process.argv[1] || "") === path.resolve(scriptPath)) {
  let options = null;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.mode === "check") {
      const loaded = await loadPayload(options.themeDir, {
        videoUrlFor: async (_videoPath, videoStat) => `http://127.0.0.1:9/workbuddy-skin-check/background.mp4?v=${videoStat.size}`,
        themesRoot: options.themesRoot,
      });
      const output = {
        ...operationResult({
          operation: "preflight",
          status: "ok",
          changed: false,
          code: "payload-valid",
          message: "The WorkBuddy theme payload passed offline preflight",
        }),
        pass: true,
        version: SKIN_VERSION,
        adapter: loaded.theme.adapter,
        themeId: loaded.theme.id,
        themeName: loaded.theme.name,
        shellMode: loaded.theme.shellMode,
        imageBytes: loaded.imageBytes,
        videoBytes: loaded.videoBytes,
        videoEnabled: loaded.videoEnabled,
        backgroundRenderMode: loaded.backgroundRenderMode,
        interactiveBackground: loaded.theme.interactiveBackground ?? null,
        interactiveAtlasBytes: loaded.interactiveAtlasBytes,
        interactiveAtlasMetadata: loaded.interactiveAtlasMetadata,
        payloadBytes: loaded.payloadBytes,
        revision: loaded.revision,
        revisionScope: RENDERER_REVISION_SCOPE,
        releaseTraceability: RELEASE_TRACEABILITY,
        unsupportedMedia: loaded.theme.unsupportedMedia,
        runtimeRoles: loaded.runtimeRoles,
        styleBindings: loaded.styleBindings,
        settingsLocales: loaded.settingsLocales,
        buildMs: loaded.buildMs,
      };
      if (options.reportFile) await writeOperationResult(options.reportFile, output);
      console.log(JSON.stringify(output, null, 2));
    } else if (options.mode === "watch") await runWatch(options);
    else await runOneShot(options);
  } catch (error) {
    if (options?.reportFile) {
      const operation = operationForMode(options.mode);
      const output = operationResult({
        operation,
        status: "failed",
        changed: false,
        code: failureClassification(options.mode, error),
        message: `WorkBuddy ${operation} failed`,
        details: { errorName: String(error?.name || "Error").slice(0, 80) },
      });
      await writeOperationResult(options.reportFile, output).catch((reportError) => {
        console.error(`[workbuddy-skin] could not write operation report: ${reportError.message}`);
      });
    }
    console.error(`[workbuddy-skin] ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}
