import { createHash } from "node:crypto";
import { createServer } from "node:http";

const websocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeTextFrame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function consumeFrames(socket, onMessage) {
  let buffered = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 2) {
      const opcode = buffered[0] & 0x0f;
      const masked = Boolean(buffered[1] & 0x80);
      let length = buffered[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffered.length < 10) return;
        const wide = buffered.readBigUInt64BE(2);
        if (wide > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Fake CDP frame is too large");
        length = Number(wide);
        offset = 10;
      }
      const maskBytes = masked ? 4 : 0;
      if (buffered.length < offset + maskBytes + length) return;
      const mask = masked ? buffered.subarray(offset, offset + 4) : null;
      offset += maskBytes;
      const payload = Buffer.from(buffered.subarray(offset, offset + length));
      buffered = buffered.subarray(offset + length);
      if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      if (opcode === 0x8) {
        socket.end(Buffer.from([0x88, 0x00]));
        return;
      }
      if (opcode === 0x9) {
        socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
        continue;
      }
      if (opcode === 0x1) onMessage(JSON.parse(payload.toString("utf8")));
    }
  });
}

export async function createFakeWorkBuddyCdpServer({ initialUrl =
  "file:///Applications/WorkBuddy.app/Contents/Resources/app.asar/renderer/index.html" } = {}) {
  const calls = [];
  const earlySources = [];
  const sockets = new Set();
  let port = 0;
  let targetUrl = initialUrl;
  const server = createServer((request, response) => {
    if (request.url === "/json/list") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify([{
        id: "workbuddy-main",
        type: "page",
        url: targetUrl,
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/workbuddy-main`,
      }]));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    if (!key || request.url !== "/devtools/page/workbuddy-main") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1").update(`${key}${websocketGuid}`).digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"));
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    consumeFrames(socket, (message) => {
      calls.push({ method: message.method, params: message.params });
      let result = {};
      if (message.method === "Page.addScriptToEvaluateOnNewDocument") {
        earlySources.push(message.params?.source ?? "");
        result = { identifier: `early-${earlySources.length}` };
      } else if (message.method === "Runtime.evaluate") {
        const expression = message.params?.expression ?? "";
        const value = expression.includes("const applicationName = document.body")
          ? targetUrl.startsWith("file:")
            ? { applicationName: "workbuddy", markers: { shell: true, sidebar: true, main: true }, workbuddy: true }
            : { applicationName: null, markers: { shell: false, sidebar: false, main: false }, workbuddy: false }
          : expression.includes("__WORKBUDDY_SKIN_EARLY_APPLIED__ ===") ? true : undefined;
        result = { result: value === undefined ? { type: "undefined" } : { type: "object", value } };
      }
      socket.write(encodeTextFrame({ id: message.id, result }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      port = typeof address === "object" && address ? address.port : 0;
      resolve();
    });
  });
  return {
    port,
    calls,
    earlySources,
    setTargetUrl(value) { targetUrl = value; },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
