import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadRuntimePayload } from "../scripts/injector.mjs";

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-doubao-"));
  const theme = {
    kind: "skin.theme",
    id: "midnight",
    name: "Midnight",
    sourceVersion: "1.0.0",
    image: "background.webp",
    colors: { text: "#E9EEF7", muted: "#AAB5C5" },
    semanticColors: {
      surfaceBase: "#10151F",
      action: "#2F5FAA",
      actionForeground: "#FFFFFF",
      focusRing: "#8EB1FF",
      link: "#8EB1FF",
      sidebarSurface: "rgba(16, 21, 31, 0.82)",
    },
    fonts: { ui: ["system-ui"] },
    appearance: {
      backdropBlurPx: 18,
      backdropSaturation: 1.1,
      backgroundPosition: { xPercent: 25, yPercent: 75 },
    },
  };
  await fs.writeFile(path.join(directory, "theme.json"), JSON.stringify(theme));
  await fs.writeFile(
    path.join(directory, "background.webp"),
    Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WEBP")]),
  );
  return directory;
}

function mp4FixtureBytes(brand = "isom") {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(bytes.length, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write(brand, 8, "ascii");
  bytes.writeUInt32BE(0, 12);
  bytes.write("isom", 16, "ascii");
  bytes.write("mp42", 20, "ascii");
  return bytes;
}

test("theme data becomes a bounded renderer payload without executable fields", async (t) => {
  const directory = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const payload = await loadRuntimePayload(directory);

  assert.equal(payload.version, "1.0.0");
  assert.match(payload.generation, /^[0-9a-f]{16}$/);
  assert.match(payload.backgroundUrl, /^data:image\/webp;base64,/);
  assert.deepEqual(payload.position, { xPercent: 25, yPercent: 75 });
  assert.equal(payload.variables["--cc-doubao-theme-surface-base"], "#10151F");
  assert.equal(payload.variables["--cc-doubao-theme-sidebar-surface"], "rgba(16, 21, 31, 0.82)");
  assert.equal(payload.variables["--cc-doubao-text"], undefined);
  assert.equal(payload.variables["--cc-doubao-font-ui"], undefined);
  assert.equal(payload.variables["--cc-doubao-backdrop-blur"], "18px");
  assert.equal(payload.paletteStrategy, "system");
  assert.deepEqual(Object.keys(payload).sort(), ["backgroundUrl", "generation", "paletteStrategy", "position", "variables", "version"]);
  assert.equal(JSON.stringify(payload).includes("selector"), false);
  assert.equal(JSON.stringify(payload).includes("javascript"), false);
});

test("renderer payload carries only structural theme paint and leaves host controls dormant", async (t) => {
  const directory = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const themePath = path.join(directory, "theme.json");
  const theme = JSON.parse(await fs.readFile(themePath, "utf8"));
  Object.assign(theme.semanticColors, {
    surfaceRaised: "#202431",
    surfaceElevated: "#2D3242",
    surfaceCode: "#191D27",
    textStrong: "#FFFFFF",
    borderSubtle: "rgba(255, 255, 255, .08)",
    actionHover: "#78A6FF",
    actionPressed: "#4F7EDB",
    hoverSurface: "rgba(102, 153, 255, .14)",
    pressedSurface: "rgba(102, 153, 255, .22)",
    selectedSurface: "rgba(102, 153, 255, .28)",
    selectedHoverSurface: "rgba(102, 153, 255, .36)",
    headerSurface: "rgba(16, 21, 31, .76)",
  });
  theme.fonts.display = ["SF Pro Display", "system-ui"];
  theme.fonts.code = ["SFMono-Regular", "monospace"];
  await fs.writeFile(themePath, JSON.stringify(theme));

  const payload = await loadRuntimePayload(directory);

  assert.equal(payload.variables["--cc-doubao-theme-surface-raised"], "#202431");
  assert.equal(payload.variables["--cc-doubao-theme-header-surface"], "rgba(16, 21, 31, .76)");
  assert.equal(payload.variables["--cc-doubao-surface-elevated"], undefined);
  assert.equal(payload.variables["--cc-doubao-surface-code"], undefined);
  assert.equal(payload.variables["--cc-doubao-text-strong"], undefined);
  assert.equal(payload.variables["--cc-doubao-hover-surface"], undefined);
  assert.equal(payload.variables["--cc-doubao-selected-surface"], undefined);
  assert.equal(payload.variables["--cc-doubao-danger"], undefined);
  assert.equal(payload.variables["--cc-doubao-font-display"], undefined);
  assert.equal(payload.variables["--cc-doubao-font-code"], undefined);
});

test("unsupported status tokens cannot enter a normalized Doubao runtime payload", async (t) => {
  const directory = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const themePath = path.join(directory, "theme.json");
  const theme = JSON.parse(await fs.readFile(themePath, "utf8"));
  theme.semanticColors.danger = "#F16A75";
  await fs.writeFile(themePath, JSON.stringify(theme));

  await assert.rejects(() => loadRuntimePayload(directory), /semanticColors.*danger/i);
});

test("validated MP4 media becomes a generation-bound deferred video payload", async (t) => {
  const directory = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const themePath = path.join(directory, "theme.json");
  const theme = JSON.parse(await fs.readFile(themePath, "utf8"));
  theme.backgroundVideo = "background.mp4";
  theme.appearance.backgroundVideoPosterMode = "image";
  theme.appearance.backgroundVideoScrimOpacity = 0.34;
  theme.appearance.backgroundVideoPosition = { xPercent: 40, yPercent: 60 };
  await fs.writeFile(themePath, JSON.stringify(theme));
  await fs.writeFile(path.join(directory, "background.mp4"), mp4FixtureBytes());

  const payload = await loadRuntimePayload(directory);

  assert.equal(payload.video.mimeType, "video/mp4");
  assert.equal(payload.video.bytes.length, 24);
  assert.equal(payload.video.posterMode, "image");
  assert.equal(payload.video.scrimOpacity, 0.34);
  assert.deepEqual(payload.video.position, { xPercent: 40, yPercent: 60 });
  assert.match(payload.generation, /^[0-9a-f]{16}$/);
});

test("theme media cannot escape through a symbolic link", async (t) => {
  const directory = await fixture();
  const external = path.join(directory, "..", `${path.basename(directory)}-external.webp`);
  t.after(() => Promise.all([
    fs.rm(directory, { recursive: true, force: true }),
    fs.rm(external, { force: true }),
  ]));
  await fs.writeFile(external, Buffer.from("RIFF\u0004\u0000\u0000\u0000WEBP"));
  await fs.rm(path.join(directory, "background.webp"));
  await fs.symlink(external, path.join(directory, "background.webp"));

  await assert.rejects(() => loadRuntimePayload(directory), /symbolic link/i);
});

test("dormant control colors do not reject a host-owned native control palette", async (t) => {
  const directory = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const themePath = path.join(directory, "theme.json");
  const theme = JSON.parse(await fs.readFile(themePath, "utf8"));
  theme.semanticColors.selectedSurface = "#10151F";
  theme.semanticColors.action = "#FFFFFF";
  theme.semanticColors.actionForeground = "#FFFFFF";
  await fs.writeFile(themePath, JSON.stringify(theme));

  const payload = await loadRuntimePayload(directory);
  assert.equal(payload.variables["--cc-doubao-action"], undefined);
  assert.equal(payload.variables["--cc-doubao-action-foreground"], undefined);
});
