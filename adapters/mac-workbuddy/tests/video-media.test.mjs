import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { byteRange, createLocalMediaServer } from "../scripts/injector.mjs";

assert.deepEqual(byteRange("bytes=0-99", 1000), { start: 0, end: 99 });
assert.deepEqual(byteRange("bytes=900-", 1000), { start: 900, end: 999 });
assert.deepEqual(byteRange("bytes=-100", 1000), { start: 900, end: 999 });
assert.deepEqual(byteRange("bytes=0-9999", 1000), { start: 0, end: 999 });
assert.equal(byteRange("bytes=1000-1001", 1000), null);
assert.equal(byteRange("bytes=9-2", 1000), null);
assert.equal(byteRange("not-a-range", 1000), null);

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-video-test-"));
const mediaPath = path.join(temporary, "background.mp4");
const bytes = Buffer.from("0123456789abcdef0123456789abcdef");
await fs.writeFile(mediaPath, bytes);
const server = createLocalMediaServer();
try {
  const url = await server.urlFor(mediaPath, await fs.stat(mediaPath));
  const ranged = await fetch(url, { headers: { Range: "bytes=4-7" } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), `bytes 4-7/${bytes.length}`);
  assert.equal(Buffer.from(await ranged.arrayBuffer()).toString(), "4567");
  const head = await fetch(url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), "video/mp4");
  assert.equal((await fetch(new URL("/missing", url))).status, 404);
} finally {
  await server.close();
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("video-media.test.mjs: ok");
