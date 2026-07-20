import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeSkinTheme } from "./skin-theme.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterRoot = path.resolve(here, "..");
const MAX_THEME_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function imageMime(extension) {
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  return "image/webp";
}

function signatureMatches(extension, bytes) {
  if (extension === ".png") {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function sameFile(left, right) {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function readStableFile(file, label, maxBytes) {
  let handle;
  try {
    handle = await fs.open(file, OPEN_FLAGS);
  } catch (error) {
    if (error?.code === "ELOOP") throw new Error(`${label} must not be a symbolic link`);
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`${label} must be a regular file`);
    if (before.size < 1 || before.size > maxBytes) throw new Error(`${label} has an invalid size`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFile(before, after)) throw new Error(`${label} changed while it was being read`);
    return bytes;
  } finally {
    await handle.close();
  }
}

function fontStack(families, fallback) {
  const source = families?.length ? families : [fallback];
  if (source.some((family) => !/^[A-Za-z0-9 ._-]{1,80}$/.test(family))) {
    throw new Error("Doubao theme contains an unsafe font family");
  }
  return source.join(", ");
}

function variablesFor(theme) {
  const semantic = theme.semanticColors ?? {};
  const appearance = theme.appearance ?? {};
  return {
    "--cc-doubao-text": theme.colors?.text ?? "#E9EEF7",
    "--cc-doubao-muted": theme.colors?.muted ?? "#AAB5C5",
    "--cc-doubao-placeholder": semantic.placeholder ?? theme.colors?.muted ?? "#8390A3",
    "--cc-doubao-surface-base": semantic.surfaceBase ?? "#10151F",
    "--cc-doubao-sidebar-surface": semantic.sidebarSurface ?? semantic.surfaceRaised ?? "rgba(16, 21, 31, 0.82)",
    "--cc-doubao-composer-surface": semantic.composerSurface ?? semantic.surfaceElevated ?? "rgba(24, 31, 44, 0.86)",
    "--cc-doubao-border": semantic.borderDefault ?? semantic.borderSubtle ?? "rgba(255, 255, 255, 0.12)",
    "--cc-doubao-action": semantic.action ?? "#6699FF",
    "--cc-doubao-action-foreground": semantic.actionForeground ?? "#FFFFFF",
    "--cc-doubao-focus-ring": semantic.focusRing ?? semantic.action ?? "#8EB1FF",
    "--cc-doubao-link": semantic.link ?? semantic.action ?? "#8EB1FF",
    "--cc-doubao-main-scrim-start": semantic.mainScrimStart ?? "rgba(16, 21, 31, 0.34)",
    "--cc-doubao-main-scrim-mid": semantic.mainScrimMid ?? "rgba(16, 21, 31, 0.46)",
    "--cc-doubao-main-scrim-end": semantic.mainScrimEnd ?? "rgba(16, 21, 31, 0.64)",
    "--cc-doubao-font-ui": fontStack(theme.fonts?.ui, "system-ui"),
    "--cc-doubao-backdrop-blur": `${appearance.backdropBlurPx ?? 18}px`,
    "--cc-doubao-saturation": String(appearance.backdropSaturation ?? 1),
    "--cc-doubao-radius-scale": String(appearance.radiusScale ?? 1),
  };
}

export async function loadRuntimePayload(themeDirectory) {
  const directory = path.resolve(themeDirectory);
  const themeBytes = await readStableFile(path.join(directory, "theme.json"), "Doubao theme.json", MAX_THEME_BYTES);
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(themeBytes));
  } catch {
    throw new Error("Doubao theme.json is not valid UTF-8 JSON");
  }
  const theme = normalizeSkinTheme(parsed);
  const imagePath = path.resolve(directory, theme.image);
  const relative = path.relative(directory, imagePath);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Doubao theme image must stay inside its theme directory");
  }
  const extension = path.extname(imagePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error("Doubao theme image format is unsupported");
  const imageBytes = await readStableFile(imagePath, "Doubao theme image", MAX_IMAGE_BYTES);
  if (imageBytes.length < 12 || !signatureMatches(extension, imageBytes)) {
    throw new Error("Doubao theme image signature does not match its extension");
  }
  const position = theme.appearance?.backgroundPosition ?? { xPercent: 50, yPercent: 50 };
  const generation = createHash("sha256")
    .update("cc-theme-doubao-generation-v1\0")
    .update(themeBytes)
    .update("\0")
    .update(imageBytes)
    .digest("hex")
    .slice(0, 16);
  return Object.freeze({
    version: theme.sourceVersion,
    generation,
    backgroundUrl: `data:${imageMime(extension)};base64,${imageBytes.toString("base64")}`,
    position: structuredClone(position),
    variables: Object.freeze(variablesFor(theme)),
  });
}

function parseArgs(argv) {
  const options = { mode: "watch", port: 9343, themeDirectory: null, timeoutMs: 30_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply" || argument === "--once") options.mode = "apply";
    else if (argument === "--watch") options.mode = "watch";
    else if (argument === "--verify") options.mode = "verify";
    else if (argument === "--remove") options.mode = "remove";
    else if (argument === "--check-payload") options.mode = "check";
    else if (argument === "--port") options.port = Number(argv[++index]);
    else if (argument === "--theme-dir") options.themeDirectory = path.resolve(argv[++index]);
    else if (argument === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("Invalid CDP port");
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 120_000) throw new Error("Invalid timeout");
  if (["apply", "watch", "check"].includes(options.mode) && !options.themeDirectory) throw new Error("--theme-dir is required");
  return options;
}

async function chatTarget(port, timeoutMs) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Doubao CDP target discovery failed with HTTP ${response.status}`);
  const targets = await response.json();
  const trusted = targets.filter((entry) => entry?.type === "page" && /^doubao:\/\/doubao-chat(?:\/|$)/.test(entry.url ?? ""));
  if (trusted.length !== 1 || !trusted[0]?.webSocketDebuggerUrl) {
    throw new Error("Exactly one trusted Doubao chat target is required");
  }
  const [target] = trusted;
  const endpoint = new URL(target.webSocketDebuggerUrl);
  if (!["ws:", "wss:"].includes(endpoint.protocol) || !LOOPBACK_HOSTS.has(endpoint.hostname) || Number(endpoint.port) !== port ||
      typeof target.id !== "string" || !/^[A-F0-9]{16,64}$/i.test(target.id) || endpoint.pathname !== `/devtools/page/${target.id}`) {
    throw new Error("Doubao CDP target did not resolve to the requested loopback endpoint");
  }
  return target;
}

async function evaluate(target, expression, timeoutMs) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const id = 1;
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Doubao CDP evaluation timed out"));
    }, timeoutMs);
    const finish = (callback, value) => {
      clearTimeout(timeout);
      socket.close();
      callback(value);
    };
    socket.addEventListener("error", () => finish(reject, new Error("Doubao CDP WebSocket failed")), { once: true });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    }, { once: true });
    socket.addEventListener("message", async (event) => {
      const data = typeof event.data === "string" ? event.data : await event.data.text();
      const message = JSON.parse(data);
      if (message.id !== id) return;
      if (message.error) finish(reject, new Error(message.error.message));
      else if (message.result?.exceptionDetails) {
        const exception = message.result.exceptionDetails.exception?.description ??
          message.result.exceptionDetails.exception?.value ?? message.result.exceptionDetails.text;
        finish(reject, new Error(exception ?? "Renderer evaluation failed"));
      }
      else finish(resolve, message.result?.result?.value);
    });
  });
}

async function staticAssets() {
  const [factory, styleText] = await Promise.all([
    fs.readFile(path.join(adapterRoot, "assets/renderer-inject.js"), "utf8"),
    fs.readFile(path.join(adapterRoot, "assets/skin.css"), "utf8"),
  ]);
  if (!factory.startsWith("function createDoubaoSkinRuntime") || styleText.length > 256 * 1024) {
    throw new Error("Doubao Adapter runtime assets are invalid");
  }
  return { factory, styleText };
}

async function apply(port, themeDirectory, timeoutMs) {
  const [payload, assets, target] = await Promise.all([
    loadRuntimePayload(themeDirectory),
    staticAssets(),
    chatTarget(port, timeoutMs),
  ]);
  const runtimePayload = {
    version: payload.version,
    generation: payload.generation,
    backgroundUrl: payload.backgroundUrl,
    backgroundPosition: `${payload.position.xPercent}% ${payload.position.yPercent}%`,
    variables: payload.variables,
    styleText: assets.styleText,
  };
  const expression = `(() => {
    const previous = globalThis.__CC_THEME_DOUBAO_RUNTIME__;
    if (previous && typeof previous.remove === "function") previous.remove();
    document.querySelectorAll("#cc-theme-doubao-style, #cc-theme-doubao-background").forEach((node) => node.remove());
    document.querySelectorAll("[data-cc-theme-doubao-role]").forEach((node) => node.removeAttribute("data-cc-theme-doubao-role"));
    Array.from(document.documentElement.style).filter((name) => name.startsWith("--cc-doubao-")).forEach((name) => document.documentElement.style.removeProperty(name));
    document.documentElement.removeAttribute("data-cc-theme-doubao-version");
    document.documentElement.removeAttribute("data-cc-theme-doubao-generation");
    const factory = (${assets.factory});
    const runtime = factory({ document: globalThis.document, location: globalThis.location });
    const result = runtime.apply(${JSON.stringify(runtimePayload)});
    globalThis.__CC_THEME_DOUBAO_RUNTIME__ = runtime;
    return result;
  })()`;
  return evaluate(target, expression, timeoutMs);
}

async function verify(port, timeoutMs) {
  const target = await chatTarget(port, timeoutMs);
  return evaluate(target, `(() => {
    const root = document.documentElement;
    const runtime = globalThis.__CC_THEME_DOUBAO_RUNTIME__;
    const inspected = runtime && typeof runtime.inspect === "function" ? runtime.inspect() : null;
    return {
      applied: Boolean(inspected?.applied && root.hasAttribute("data-cc-theme-doubao-version") && root.hasAttribute("data-cc-theme-doubao-generation")),
      version: root.getAttribute("data-cc-theme-doubao-version"),
      generation: root.getAttribute("data-cc-theme-doubao-generation"),
      roles: document.querySelectorAll("[data-cc-theme-doubao-role]").length,
      styleCount: document.querySelectorAll("#cc-theme-doubao-style").length,
      backgroundCount: document.querySelectorAll("#cc-theme-doubao-background").length,
      styleGeneration: document.getElementById("cc-theme-doubao-style")?.getAttribute("data-cc-theme-doubao-generation") ?? null,
      backgroundGeneration: document.getElementById("cc-theme-doubao-background")?.getAttribute("data-cc-theme-doubao-generation") ?? null,
      ownedVariables: Array.from(root.style).filter((name) => name.startsWith("--cc-doubao-")).length,
    };
  })()`, timeoutMs);
}

async function remove(port, timeoutMs) {
  const target = await chatTarget(port, timeoutMs);
  return evaluate(target, `(() => {
    const runtime = globalThis.__CC_THEME_DOUBAO_RUNTIME__;
    if (runtime && typeof runtime.remove === "function") runtime.remove();
    delete globalThis.__CC_THEME_DOUBAO_RUNTIME__;
    document.getElementById("cc-theme-doubao-style")?.remove();
    document.getElementById("cc-theme-doubao-background")?.remove();
    document.querySelectorAll("[data-cc-theme-doubao-role]").forEach((node) => node.removeAttribute("data-cc-theme-doubao-role"));
    Array.from(document.documentElement.style).filter((name) => name.startsWith("--cc-doubao-")).forEach((name) => document.documentElement.style.removeProperty(name));
    document.documentElement.removeAttribute("data-cc-theme-doubao-version");
    document.documentElement.removeAttribute("data-cc-theme-doubao-generation");
    return {
      removed: true,
      roles: document.querySelectorAll("[data-cc-theme-doubao-role]").length,
      styleCount: document.querySelectorAll("#cc-theme-doubao-style").length,
      backgroundCount: document.querySelectorAll("#cc-theme-doubao-background").length,
      ownedVariables: Array.from(document.documentElement.style).filter((name) => name.startsWith("--cc-doubao-")).length,
      version: document.documentElement.getAttribute("data-cc-theme-doubao-version"),
      generation: document.documentElement.getAttribute("data-cc-theme-doubao-generation"),
    };
  })()`, timeoutMs);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "check") {
    const payload = await loadRuntimePayload(options.themeDirectory);
    console.log(JSON.stringify({ ok: true, version: payload.version, generation: payload.generation }));
    return;
  }
  if (options.mode === "apply") {
    console.log(JSON.stringify(await apply(options.port, options.themeDirectory, options.timeoutMs)));
    return;
  }
  if (options.mode === "verify") {
    const result = await verify(options.port, options.timeoutMs);
    console.log(JSON.stringify(result));
    const generationReady = typeof result?.generation === "string" &&
      result.generation === result.styleGeneration && result.generation === result.backgroundGeneration;
    if (!result?.applied || result.styleCount !== 1 || result.backgroundCount !== 1 || result.roles < 3 || result.ownedVariables < 1 || !generationReady) process.exitCode = 1;
    return;
  }
  if (options.mode === "remove") {
    console.log(JSON.stringify(await remove(options.port, options.timeoutMs)));
    return;
  }
  for (;;) {
    try {
      const state = await verify(options.port, Math.min(options.timeoutMs, 5_000));
      const generationReady = typeof state?.generation === "string" &&
        state.generation === state.styleGeneration && state.generation === state.backgroundGeneration;
      if (!state?.applied || state.styleCount !== 1 || state.backgroundCount !== 1 || state.roles < 3 || state.ownedVariables < 1 || !generationReady) {
        await apply(options.port, options.themeDirectory, options.timeoutMs);
      }
    } catch (error) {
      console.error(`[mac-doubao] ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`CC Theme Doubao: ${error.message}`);
    process.exitCode = 1;
  });
}
