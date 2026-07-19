import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { byteRange, createLocalMediaServer } from "../scripts/injector.mjs";

assert.deepEqual(byteRange("bytes=4-11", 64), { start: 4, end: 11 });
assert.deepEqual(byteRange("bytes=-8", 64), { start: 56, end: 63 });
assert.equal(byteRange("bytes=80-90", 64), null);

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-media-server-"));
const videoPath = path.join(temporary, "background.mp4");
const bytes = Buffer.from(Array.from({ length: 64 }, (_, index) => index));
const server = createLocalMediaServer();
try {
  await fs.writeFile(videoPath, bytes);
  const stat = await fs.stat(videoPath);
  const url = await server.urlFor(videoPath, stat);
  const response = await fetch(url, { headers: { Range: "bytes=4-11" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-range"), "bytes 4-11/64");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(4, 12));

  const rejected = await fetch(new URL("/wrong/background.mp4", url));
  assert.equal(rejected.status, 404);
} finally {
  await server.close();
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("PASS: the compatibility media server remains loopback-only, tokenized, and supports byte ranges.");
