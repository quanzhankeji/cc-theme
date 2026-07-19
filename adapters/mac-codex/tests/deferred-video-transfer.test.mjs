import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  transferDeferredInteractiveAtlas,
  transferDeferredVideo,
} from "../scripts/injector.mjs";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-deferred-video-"));
const videoPath = path.join(temporary, "background.mp4");
const source = Buffer.alloc(2 * 1024 * 1024 + 137);
for (let index = 0; index < source.length; index += 1) source[index] = index % 251;
await fs.writeFile(videoPath, source);

const received = [];
let initialized = false;
let committed = false;
const session = {
  async evaluate(expression) {
    if (expression.includes("parts: []")) {
      initialized = true;
      return true;
    }
    if (expression.includes("const binary = atob(")) {
      const encoded = expression.match(/const binary = atob\(("[A-Za-z0-9+/=]+")\)/)?.[1];
      assert.ok(encoded, "chunk expression must contain one JSON-safe Base64 payload");
      received.push(Buffer.from(JSON.parse(encoded), "base64"));
      return true;
    }
    if (expression.includes("URL.createObjectURL(new Blob")) {
      committed = true;
      return true;
    }
    return true;
  },
};

try {
  const stat = await fs.stat(videoPath);
  const result = await transferDeferredVideo(session, {
    videoPath,
    videoStat: stat,
    theme: { id: "neutral-transfer" },
  });
  assert.deepEqual(result, { transferred: true, bytes: source.length });
  assert.equal(initialized, true);
  assert.equal(committed, true);
  assert.ok(received.length >= 3, "large videos must be transferred in bounded chunks");
  assert.deepEqual(Buffer.concat(received), source);

  received.length = 0;
  committed = false;
  let currentChecks = 0;
  await assert.rejects(transferDeferredVideo(session, {
    videoPath,
    videoStat: stat,
    theme: { id: "neutral-transfer" },
  }, {
    runtimeGeneration: "runtime-generation-a",
    payloadGeneration: "payload-generation-a",
    isCurrent: () => ++currentChecks <= 2,
  }), /Superseded deferred background video/);
  assert.equal(committed, false, "a superseded generation must not commit its Blob URL");

  const atlasPath = path.join(temporary, "background-directions.webp");
  await fs.writeFile(atlasPath, source);
  received.length = 0;
  initialized = false;
  committed = false;
  const atlasStat = await fs.stat(atlasPath);
  const atlasResult = await transferDeferredInteractiveAtlas(session, {
    interactiveAtlasPath: atlasPath,
    interactiveAtlasStat: atlasStat,
    theme: { id: "neutral-transfer" },
  });
  assert.deepEqual(atlasResult, { transferred: true, bytes: source.length });
  assert.equal(initialized, true);
  assert.equal(committed, true);
  assert.deepEqual(Buffer.concat(received), source);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("PASS: persistent video and directional atlas delivery use stable bounded CDP chunks and renderer-local Blobs.");
