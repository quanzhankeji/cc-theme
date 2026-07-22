import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeSkinTheme } from "./skin-theme.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterRoot = path.resolve(here, "..");
const MAX_THEME_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const VIDEO_TRANSFER_CHUNK_BYTES = 1024 * 1024;
const VIDEO_TRANSFER_KEY = "__CC_THEME_DOUBAO_VIDEO_TRANSFER__";
const APPLY_LEASE_KEY = "__CC_THEME_DOUBAO_APPLY__";

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

function videoSignatureMatches(bytes) {
  if (bytes.length < 16 || bytes.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const boxSize = bytes.readUInt32BE(0);
  return boxSize >= 16 && boxSize <= bytes.length;
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

function variablesFor(theme) {
  const semantic = theme.semanticColors ?? {};
  const appearance = theme.appearance ?? {};
  const surfaceBase = semantic.surfaceBase ?? "#10151F";
  const surfaceRaised = semantic.surfaceRaised ?? semantic.sidebarSurface ?? surfaceBase;
  const sidebarSurface = semantic.sidebarSurface ?? surfaceRaised;
  const headerSurface = semantic.headerSurface ?? surfaceRaised;
  const scrimStart = semantic.mainScrimStart ?? `color-mix(in srgb, ${surfaceBase} 72%, transparent)`;
  const scrimMid = semantic.mainScrimMid ?? `color-mix(in srgb, ${surfaceBase} 54%, transparent)`;
  const scrimEnd = semantic.mainScrimEnd ?? `color-mix(in srgb, ${surfaceBase} 34%, transparent)`;
  return {
    "--cc-doubao-theme-surface-base": surfaceBase,
    "--cc-doubao-theme-surface-raised": surfaceRaised,
    "--cc-doubao-theme-sidebar-surface": sidebarSurface,
    "--cc-doubao-theme-header-surface": headerSurface,
    "--cc-doubao-theme-main-scrim-start": scrimStart,
    "--cc-doubao-theme-main-scrim-mid": scrimMid,
    "--cc-doubao-theme-main-scrim-end": scrimEnd,
    "--cc-doubao-surface-base": surfaceBase,
    "--cc-doubao-surface-raised": surfaceRaised,
    "--cc-doubao-sidebar-surface": sidebarSurface,
    "--cc-doubao-header-surface": headerSurface,
    "--cc-doubao-main-scrim-start": scrimStart,
    "--cc-doubao-main-scrim-mid": scrimMid,
    "--cc-doubao-main-scrim-end": scrimEnd,
    "--cc-doubao-backdrop-blur": `${appearance.backdropBlurPx ?? 18}px`,
    "--cc-doubao-saturation": String(appearance.backdropSaturation ?? 1),
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
  let video = null;
  if (theme.backgroundVideo) {
    const videoPath = path.resolve(directory, theme.backgroundVideo);
    const videoRelative = path.relative(directory, videoPath);
    if (videoRelative.startsWith(`..${path.sep}`) || path.isAbsolute(videoRelative)) {
      throw new Error("Doubao theme video must stay inside its theme directory");
    }
    if (path.extname(videoPath).toLowerCase() !== ".mp4") {
      throw new Error("Doubao theme video format is unsupported");
    }
    const videoBytes = await readStableFile(videoPath, "Doubao theme video", MAX_VIDEO_BYTES);
    if (!videoSignatureMatches(videoBytes)) {
      throw new Error("Doubao theme video is not a valid MP4/ISO-BMFF file");
    }
    video = Object.freeze({
      bytes: videoBytes,
      mimeType: "video/mp4",
      posterMode: theme.appearance?.backgroundVideoPosterMode ?? "image",
      scrimOpacity: theme.appearance?.backgroundVideoScrimOpacity ?? 0.16,
      position: structuredClone(theme.appearance?.backgroundVideoPosition ?? position),
    });
  }
  const generationHash = createHash("sha256")
    .update("cc-theme-doubao-generation-v1\0")
    .update(themeBytes)
    .update("\0")
    .update(imageBytes);
  if (video) generationHash.update("\0video\0").update(video.bytes);
  const generation = generationHash.digest("hex").slice(0, 16);
  return Object.freeze({
    version: theme.sourceVersion,
    generation,
    paletteStrategy: theme.appearance.paletteStrategy,
    backgroundUrl: `data:${imageMime(extension)};base64,${imageBytes.toString("base64")}`,
    position: structuredClone(position),
    variables: Object.freeze(variablesFor(theme)),
    ...(theme.presentation ? { presentationProfile: theme.presentation.profileId } : {}),
    ...(video ? { video } : {}),
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

async function documentIdentity(target, timeoutMs) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const id = 2;
  const frame = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Doubao CDP frame identity timed out"));
    }, timeoutMs);
    const finish = (callback, value) => {
      clearTimeout(timeout);
      socket.close();
      callback(value);
    };
    socket.addEventListener("error", () => finish(reject, new Error("Doubao CDP frame identity failed")), { once: true });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id, method: "Page.getFrameTree" }));
    }, { once: true });
    socket.addEventListener("message", async (event) => {
      const data = typeof event.data === "string" ? event.data : await event.data.text();
      const message = JSON.parse(data);
      if (message.id !== id) return;
      if (message.error) finish(reject, new Error(message.error.message));
      else finish(resolve, message.result?.frameTree?.frame);
    });
  });
  // Target admission already pins the sole page to doubao://doubao-chat and its
  // loopback debugger endpoint. Chromium may report the internal root frame as
  // chrome:// during Doubao's bootstrap, so document identity is intentionally
  // based only on the CDP-owned frameId + loaderId pair.
  if (!frame || typeof frame.id !== "string" || typeof frame.loaderId !== "string" ||
      !frame.id || !frame.loaderId) {
    throw new Error("Doubao main frame identity is invalid");
  }
  return createHash("sha256")
    .update("cc-theme-doubao-document-v1\0")
    .update(frame.id)
    .update("\0")
    .update(frame.loaderId)
    .digest("hex");
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

export async function transferDeferredVideo(session, video, { generation, documentIdentity: expectedDocumentIdentity } = {}) {
  if (!session || typeof session.evaluate !== "function" || !video || !Buffer.isBuffer(video.bytes) ||
      typeof session.documentIdentity !== "function" || video.mimeType !== "video/mp4" ||
      typeof generation !== "string" || !/^[0-9a-f]{16}$/.test(generation) ||
      typeof expectedDocumentIdentity !== "string" || !/^[0-9a-f]{64}$/.test(expectedDocumentIdentity)) {
    throw new Error("Doubao deferred video transfer input is invalid");
  }
  const assertCurrentDocument = async () => {
    if (await session.documentIdentity() !== expectedDocumentIdentity) {
      throw new Error("Doubao video transfer document was superseded");
    }
  };
  await assertCurrentDocument();
  const transferId = randomBytes(18).toString("hex");
  const expectedBytes = video.bytes.length;
  const initialized = await session.evaluate(`(() => {
    const runtime = globalThis.__CC_THEME_DOUBAO_RUNTIME__;
    const inspected = runtime?.inspect?.();
    if (!runtime || typeof runtime.setVideoSource !== "function" || inspected?.generation !== ${JSON.stringify(generation)} ||
        inspected?.documentIdentity !== ${JSON.stringify(expectedDocumentIdentity)} || inspected?.videoExpected !== true ||
        inspected?.videoSourceReady === true || globalThis.${VIDEO_TRANSFER_KEY}) return false;
    globalThis.${VIDEO_TRANSFER_KEY} = {
      id: ${JSON.stringify(transferId)}, generation: ${JSON.stringify(generation)}, parts: [], bytes: 0, expected: ${expectedBytes}
    };
    return true;
  })()`);
  if (!initialized) throw new Error("Doubao renderer is not ready for the deferred video");

  try {
    for (let position = 0; position < expectedBytes; position += VIDEO_TRANSFER_CHUNK_BYTES) {
      await assertCurrentDocument();
      const base64 = video.bytes.subarray(position, Math.min(position + VIDEO_TRANSFER_CHUNK_BYTES, expectedBytes)).toString("base64");
      const accepted = await session.evaluate(`(() => {
        const transfer = globalThis.${VIDEO_TRANSFER_KEY};
        const runtime = globalThis.__CC_THEME_DOUBAO_RUNTIME__;
        if (!transfer || transfer.id !== ${JSON.stringify(transferId)} || transfer.generation !== ${JSON.stringify(generation)} ||
            runtime?.inspect?.().generation !== ${JSON.stringify(generation)} ||
            runtime?.inspect?.().documentIdentity !== ${JSON.stringify(expectedDocumentIdentity)}) return false;
        const binary = atob(${JSON.stringify(base64)});
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        transfer.parts.push(bytes);
        transfer.bytes += bytes.length;
        return transfer.bytes <= transfer.expected;
      })()`);
      if (!accepted) throw new Error("Doubao video transfer was superseded");
    }
    await assertCurrentDocument();
    const committed = await session.evaluate(`(async () => {
      const transfer = globalThis.${VIDEO_TRANSFER_KEY};
      const runtime = globalThis.__CC_THEME_DOUBAO_RUNTIME__;
      if (!transfer || transfer.id !== ${JSON.stringify(transferId)} || transfer.generation !== ${JSON.stringify(generation)} ||
          transfer.bytes !== transfer.expected || transfer.bytes !== ${expectedBytes} ||
          runtime?.inspect?.().generation !== ${JSON.stringify(generation)} ||
          runtime?.inspect?.().documentIdentity !== ${JSON.stringify(expectedDocumentIdentity)}) return false;
      const source = URL.createObjectURL(new Blob(transfer.parts, { type: "video/mp4" }));
      delete globalThis.${VIDEO_TRANSFER_KEY};
      try {
        const state = await runtime.setVideoSource(source, ${JSON.stringify(generation)});
        if (!state?.videoSourceReady) throw new Error("renderer rejected video source");
        return true;
      } catch (error) {
        URL.revokeObjectURL(source);
        throw error;
      }
    })()`);
    if (!committed) throw new Error("Doubao renderer rejected the deferred video");
    await assertCurrentDocument();
    return { transferred: true, bytes: expectedBytes };
  } catch (error) {
    await session.evaluate(`(() => {
      if (globalThis.${VIDEO_TRANSFER_KEY}?.id === ${JSON.stringify(transferId)}) delete globalThis.${VIDEO_TRANSFER_KEY};
    })()`).catch(() => {});
    throw error;
  }
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
    paletteStrategy: payload.paletteStrategy,
    documentIdentity: await documentIdentity(target, timeoutMs),
    backgroundUrl: payload.backgroundUrl,
    backgroundPosition: `${payload.position.xPercent}% ${payload.position.yPercent}%`,
    variables: payload.variables,
    ...(payload.presentationProfile ? { presentationProfile: payload.presentationProfile } : {}),
    styleText: assets.styleText,
    ...(payload.video ? {
      videoExpected: true,
      videoPosterMode: payload.video.posterMode,
      videoScrimOpacity: payload.video.scrimOpacity,
      videoPosition: `${payload.video.position.xPercent}% ${payload.video.position.yPercent}%`,
    } : {}),
  };
  const applyId = randomBytes(18).toString("hex");
  const expression = `(() => {
    const existingLease = globalThis.${APPLY_LEASE_KEY};
    if (existingLease && Number.isFinite(existingLease.startedAt) && Date.now() - existingLease.startedAt < 120000) {
      throw new Error("Doubao theme apply is already in progress");
    }
    globalThis.${APPLY_LEASE_KEY} = { id: ${JSON.stringify(applyId)}, startedAt: Date.now() };
    try {
    const previous = globalThis.__CC_THEME_DOUBAO_RUNTIME__;
    if (previous && typeof previous.remove === "function") previous.remove();
    document.querySelectorAll("#cc-theme-doubao-style, #cc-theme-doubao-background").forEach((node) => node.remove());
    document.querySelectorAll("[data-cc-theme-doubao-role], [data-cc-theme-doubao-state]").forEach((node) => {
      node.removeAttribute("data-cc-theme-doubao-role");
      node.removeAttribute("data-cc-theme-doubao-state");
    });
    Array.from(document.documentElement.style).filter((name) => name.startsWith("--cc-doubao-")).forEach((name) => document.documentElement.style.removeProperty(name));
    document.documentElement.removeAttribute("data-cc-theme-doubao-version");
    document.documentElement.removeAttribute("data-cc-theme-doubao-generation");
    document.documentElement.removeAttribute("data-cc-theme-doubao-host-appearance");
    document.documentElement.removeAttribute("data-cc-theme-doubao-appearance");
    document.documentElement.removeAttribute("data-cc-theme-doubao-palette-strategy");
    document.documentElement.removeAttribute("data-cc-theme-doubao-presentation");
    const factory = (${assets.factory});
    const runtime = factory({ document: globalThis.document, location: globalThis.location });
    const result = runtime.apply(${JSON.stringify(runtimePayload)});
    globalThis.__CC_THEME_DOUBAO_RUNTIME__ = runtime;
    return result;
    } catch (error) {
      if (globalThis.${APPLY_LEASE_KEY}?.id === ${JSON.stringify(applyId)}) delete globalThis.${APPLY_LEASE_KEY};
      throw error;
    }
  })()`;
  await evaluate(target, expression, timeoutMs);
  try {
    if (await documentIdentity(target, timeoutMs) !== runtimePayload.documentIdentity) {
      throw new Error("Doubao renderer navigated during theme apply");
    }
    if (payload.video) {
      await transferDeferredVideo({
        evaluate: (videoExpression) => evaluate(target, videoExpression, timeoutMs),
        documentIdentity: () => documentIdentity(target, timeoutMs),
      }, payload.video, { generation: payload.generation, documentIdentity: runtimePayload.documentIdentity });
    }
    return evaluate(target, `globalThis.__CC_THEME_DOUBAO_RUNTIME__?.inspect?.() ?? null`, timeoutMs);
  } finally {
    await evaluate(target, `(() => {
      if (globalThis.${APPLY_LEASE_KEY}?.id === ${JSON.stringify(applyId)}) delete globalThis.${APPLY_LEASE_KEY};
    })()`, Math.min(timeoutMs, 5_000)).catch(() => {});
  }
}

async function verify(port, timeoutMs) {
  const target = await chatTarget(port, timeoutMs);
  return evaluate(target, `(() => {
    const root = document.documentElement;
    const runtime = globalThis.__CC_THEME_DOUBAO_RUNTIME__;
    const inspected = runtime && typeof runtime.inspect === "function" ? runtime.inspect() : null;
    const video = document.getElementById("cc-theme-doubao-background-video");
    const videoSource = video?.currentSrc || video?.src || "";
    const ownedRoleNodes = Array.from(document.querySelectorAll("[data-cc-theme-doubao-role]"));
    const surfaceStyles = Object.fromEntries(Array.from(new Set(ownedRoleNodes
      .map((node) => node.getAttribute("data-cc-theme-doubao-role"))
      .filter(Boolean))).map((role) => {
        const node = ownedRoleNodes.find((candidate) => candidate.getAttribute("data-cc-theme-doubao-role") === role);
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return [role, {
          tag: node.tagName.toLowerCase(),
          visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          color: style.color,
          backgroundColor: style.backgroundColor,
          opacity: style.opacity,
          fontFamily: style.fontFamily,
          backdropFilter: style.backdropFilter,
        }];
      }));
    return {
      applied: Boolean(inspected?.applied && root.hasAttribute("data-cc-theme-doubao-version") && root.hasAttribute("data-cc-theme-doubao-generation")),
      version: root.getAttribute("data-cc-theme-doubao-version"),
      generation: root.getAttribute("data-cc-theme-doubao-generation"),
      documentIdentity: inspected?.documentIdentity ?? null,
      applyInProgress: Boolean(globalThis.${APPLY_LEASE_KEY}),
      lifecycle: inspected?.lifecycle ?? null,
      roles: ownedRoleNodes.length,
      roleCounts: Object.fromEntries(ownedRoleNodes
        .map((node) => node.getAttribute("data-cc-theme-doubao-role"))
        .filter(Boolean)
        .reduce((entries, role) => entries.set(role, (entries.get(role) ?? 0) + 1), new Map())),
      surfaceContext: root.getAttribute("data-cc-theme-doubao-surface-context"),
      surfaceStyles,
      styleCount: document.querySelectorAll("#cc-theme-doubao-style").length,
      backgroundCount: document.querySelectorAll("#cc-theme-doubao-background").length,
      videoCount: document.querySelectorAll("#cc-theme-doubao-background-video").length,
      videoScrimCount: document.querySelectorAll("#cc-theme-doubao-video-scrim").length,
      videoExpected: inspected?.videoExpected === true,
      videoPlaybackState: inspected?.videoPlaybackState ?? null,
      videoFrameReady: inspected?.videoFrameReady === true,
      videoSourceReady: inspected?.videoSourceReady === true && videoSource.startsWith("blob:"),
      videoReadyState: Number(video?.readyState ?? 0),
      videoErrorCode: Number(video?.error?.code ?? 0),
      videoAttributes: video ? {
        muted: video.muted,
        defaultMuted: video.defaultMuted,
        loop: video.loop,
        playsInline: video.playsInline,
      } : null,
      documentHidden: document.hidden === true,
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
    delete globalThis.${VIDEO_TRANSFER_KEY};
    delete globalThis.${APPLY_LEASE_KEY};
    document.getElementById("cc-theme-doubao-style")?.remove();
    document.getElementById("cc-theme-doubao-background")?.remove();
    document.querySelectorAll("[data-cc-theme-doubao-role], [data-cc-theme-doubao-state]").forEach((node) => {
      node.removeAttribute("data-cc-theme-doubao-role");
      node.removeAttribute("data-cc-theme-doubao-state");
    });
    Array.from(document.documentElement.style).filter((name) => name.startsWith("--cc-doubao-")).forEach((name) => document.documentElement.style.removeProperty(name));
    document.documentElement.removeAttribute("data-cc-theme-doubao-version");
    document.documentElement.removeAttribute("data-cc-theme-doubao-generation");
    document.documentElement.removeAttribute("data-cc-theme-doubao-surface-context");
    document.documentElement.removeAttribute("data-cc-theme-doubao-host-appearance");
    document.documentElement.removeAttribute("data-cc-theme-doubao-appearance");
    document.documentElement.removeAttribute("data-cc-theme-doubao-palette-strategy");
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

export function runtimeVerificationPass(result) {
  const generationReady = typeof result?.generation === "string" &&
    result.generation === result.styleGeneration && result.generation === result.backgroundGeneration;
  const documentReady = typeof result?.documentIdentity === "string" && /^[0-9a-f]{64}$/.test(result.documentIdentity);
  const videoReady = !result?.videoExpected || (
    result.videoCount === 1 && result.videoScrimCount === 1 && result.videoSourceReady && result.videoErrorCode === 0 &&
    result.videoAttributes?.muted && result.videoAttributes?.defaultMuted && result.videoAttributes?.loop &&
    result.videoAttributes?.playsInline &&
    ((result.videoPlaybackState === "playing" && result.videoFrameReady && result.videoReadyState >= 2) ||
     result.videoPlaybackState === "reduced-motion" ||
     (result.documentHidden && result.videoPlaybackState === "paused"))
  );
  return Boolean(result?.applied && result.styleCount === 1 && result.backgroundCount === 1 && result.roles >= 3 &&
    result.ownedVariables >= 1 && generationReady && documentReady && videoReady);
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
    if (!runtimeVerificationPass(result)) process.exitCode = 1;
    return;
  }
  if (options.mode === "remove") {
    console.log(JSON.stringify(await remove(options.port, options.timeoutMs)));
    return;
  }
  for (;;) {
    try {
      const state = await verify(options.port, Math.min(options.timeoutMs, 5_000));
      if (!state?.applyInProgress && !runtimeVerificationPass(state)) {
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
