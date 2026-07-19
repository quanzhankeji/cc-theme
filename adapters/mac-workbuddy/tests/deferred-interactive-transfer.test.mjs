import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { transferDeferredInteractiveAtlas } from "../scripts/injector.mjs";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-directional-transfer-"));
const atlasPath = path.join(temporary, "directions.webp");
const source = Buffer.alloc(2 * 1024 * 1024 + 137);
for (let index = 0; index < source.length; index += 1) source[index] = index % 251;
await fs.writeFile(atlasPath, source);

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
      assert.ok(encoded);
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
  const result = await transferDeferredInteractiveAtlas(session, {
    interactiveAtlasPath: atlasPath,
    interactiveAtlasStat: await fs.stat(atlasPath),
    theme: { id: "directional-transfer" },
  });
  assert.deepEqual(result, { transferred: true, bytes: source.length });
  assert.equal(initialized, true);
  assert.equal(committed, true);
  assert.ok(received.length >= 3);
  assert.deepEqual(Buffer.concat(received), source);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("PASS: directional atlases use bounded CDP chunks and a renderer-local Blob.");
