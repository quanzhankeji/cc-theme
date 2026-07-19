import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await fs.readFile(path.join(root, "assets", "background-effects.js"), "utf8");
const createBackgroundEffect = vm.runInNewContext(source);
assert.equal(typeof createBackgroundEffect, "function");

const eightDirectionConfig = {
  directions: 8,
  firstDirectionDegrees: 0,
  idleFrame: 0,
  origin: { xPercent: 50, yPercent: 50 },
};
for (let frame = 0; frame < 8; frame += 1) {
  const angle = frame * Math.PI / 4;
  assert.equal(createBackgroundEffect.directionalFrameForPointer(
    eightDirectionConfig,
    { x: 500 + Math.cos(angle) * 300, y: 400 + Math.sin(angle) * 300 },
    { width: 1000, height: 800 },
  ), frame);
}
const nearBoundary = 24 * Math.PI / 180;
assert.equal(createBackgroundEffect.directionalFrameForPointer(
  eightDirectionConfig,
  { x: 500 + Math.cos(nearBoundary) * 300, y: 400 + Math.sin(nearBoundary) * 300 },
  { width: 1000, height: 800 },
  0,
), 0, "directional hysteresis retains the previous frame near a sector boundary");

function emitter(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, event = {}) { for (const listener of listeners.get(type) ?? []) listener(event); },
    count(type) { return listeners.get(type)?.size ?? 0; },
  };
}

const frames = [];
let nextFrame = 1;
const windowObject = emitter({
  innerWidth: 1000,
  innerHeight: 800,
  devicePixelRatio: 2,
  requestAnimationFrame(callback) { frames.push(callback); return nextFrame++; },
  cancelAnimationFrame() {},
  setTimeout(callback) { callback(); return 1; },
  clearTimeout() {},
  matchMedia() { return emitter({ matches: false }); },
});
const drawCalls = [];
const context2d = {
  clearRect() {},
  drawImage(...args) { drawCalls.push(args); },
};
const canvas = emitter({
  width: 0,
  height: 0,
  style: {},
  setAttribute() {},
  getContext(type) { return type === "2d" ? context2d : null; },
  remove() { this.removed = true; },
});
const documentObject = emitter({
  hidden: false,
  createElement(tag) { assert.equal(tag, "canvas"); return canvas; },
});
const layer = {
  ownerDocument: documentObject,
  appendChild(node) { this.child = node; },
};
class FakeImage {
  set src(value) {
    this.source = value;
    this.naturalWidth = 1600;
    this.naturalHeight = 900;
    this.onload();
  }
}

const controller = createBackgroundEffect({
  mode: "directional",
  layer,
  sourceUrl: "blob:atlas",
  config: {
    directions: 16,
    columns: 4,
    rows: 4,
    firstDirectionDegrees: -90,
    idleFrame: 0,
    origin: { xPercent: 50, yPercent: 50 },
  },
  position: { xPercent: 50, yPercent: 50 },
  window: windowObject,
  document: documentObject,
  Image: FakeImage,
});
assert.equal(controller.inspect().ready, true);
assert.equal(controller.inspect().frame, 0);
assert.equal(drawCalls.length, 1);
windowObject.emit("pointermove", { clientX: 1000, clientY: 400 });
frames.shift()();
assert.equal(controller.inspect().frame, 4);
assert.equal(drawCalls.length, 2, "directional mode redraws only after the selected frame changes");
windowObject.emit("pointermove", { clientX: 1000, clientY: 400 });
frames.shift()();
assert.equal(drawCalls.length, 2);
controller.setEnabled(false);
assert.equal(controller.inspect().frame, 0);
assert.equal(controller.inspect().active, false);
controller.dispose();
assert.equal(windowObject.count("pointermove"), 0);
assert.equal(canvas.removed, true);

let rippleFallback = null;
const rippleCanvas = emitter({
  width: 0,
  height: 0,
  setAttribute() {},
  getContext() { return null; },
  remove() {},
});
const rippleDocument = emitter({ hidden: false, createElement() { return rippleCanvas; } });
createBackgroundEffect({
  mode: "ripple",
  layer: { ownerDocument: rippleDocument, appendChild() {} },
  sourceUrl: "blob:image",
  config: { quality: "auto", intensity: 0.35, radiusPx: 24 },
  position: { xPercent: 50, yPercent: 50 },
  window: windowObject,
  document: rippleDocument,
  Image: FakeImage,
  onFallback(reason) { rippleFallback = reason; },
});
assert.equal(rippleFallback, "webgl-unavailable");

frames.length = 0;
const gl = {
  VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
  TEXTURE_2D: 5, TEXTURE_MIN_FILTER: 6, TEXTURE_MAG_FILTER: 7,
  TEXTURE_WRAP_S: 8, TEXTURE_WRAP_T: 9, LINEAR: 10, CLAMP_TO_EDGE: 11,
  UNPACK_FLIP_Y_WEBGL: 12, RGBA: 13, UNSIGNED_BYTE: 14, RGBA8: 15,
  FRAMEBUFFER: 16, COLOR_ATTACHMENT0: 17, FRAMEBUFFER_COMPLETE: 18,
  TRIANGLES: 19, TEXTURE0: 20, TEXTURE1: 21, MAX_TEXTURE_SIZE: 22,
  createShader: () => ({}), shaderSource() {}, compileShader() {},
  getShaderParameter: () => true, getShaderInfoLog: () => "", deleteShader() {},
  createProgram: () => ({}), attachShader() {}, linkProgram() {},
  getProgramParameter: () => true, getProgramInfoLog: () => "", deleteProgram() {},
  createVertexArray: () => ({}), bindVertexArray() {}, deleteVertexArray() {},
  createTexture: () => ({}), bindTexture() {}, texParameteri() {}, pixelStorei() {}, texImage2D() {}, deleteTexture() {},
  createFramebuffer: () => ({}), bindFramebuffer() {}, framebufferTexture2D() {}, deleteFramebuffer() {},
  checkFramebufferStatus: () => 18,
  getParameter(parameter) { return parameter === this.MAX_TEXTURE_SIZE ? 16384 : 0; },
  viewport() {}, useProgram() {}, activeTexture() {}, getUniformLocation: () => ({}),
  uniform1i() {}, uniform1f() {}, uniform2f() {}, drawArrays() { this.draws = (this.draws || 0) + 1; },
};
const liveRippleCanvas = emitter({
  width: 0,
  height: 0,
  setAttribute() {},
  getContext(type) { return type === "webgl2" ? gl : null; },
  remove() { this.removed = true; },
});
const liveRippleDocument = emitter({ hidden: false, createElement() { return liveRippleCanvas; } });
const liveMotion = emitter({ matches: false });
const liveRipple = createBackgroundEffect({
  mode: "ripple",
  layer: { ownerDocument: liveRippleDocument, appendChild() {} },
  sourceUrl: "blob:water",
  config: { quality: "auto", intensity: 0.35, radiusPx: 24 },
  position: { xPercent: 50, yPercent: 50 },
  motionMediaQuery: liveMotion,
  window: windowObject,
  document: liveRippleDocument,
  Image: FakeImage,
});
assert.equal(liveRipple.inspect().ready, true);
windowObject.emit("pointermove", { clientX: 500, clientY: 400 });
let rippleFrames = 0;
while (frames.length && rippleFrames < 120) {
  frames.shift()(rippleFrames * 16);
  rippleFrames += 1;
}
assert.ok(rippleFrames >= 90 && rippleFrames < 120, "ripple RAF naturally stops after its energy decays");
assert.equal(frames.length, 0);
liveRippleDocument.hidden = true;
liveRippleDocument.emit("visibilitychange");
windowObject.emit("pointermove", { clientX: 300, clientY: 200 });
assert.equal(frames.length, 0, "hidden pages do not restart ripple rendering");
liveRippleDocument.hidden = false;
liveMotion.matches = true;
liveMotion.emit("change");
assert.equal(liveRipple.inspect().active, false, "Reduce Motion forces a static ripple frame");
liveRippleCanvas.emit("webglcontextlost", { preventDefault() {} });
assert.equal(liveRipple.inspect().fallback, "webgl-context-lost");
liveRipple.dispose();
assert.equal(liveRippleCanvas.removed, true);

console.log("PASS: the fixed runtime redraws directional frames on demand, stops ripple RAF, honors visibility/Reduce Motion, and releases contexts.");
