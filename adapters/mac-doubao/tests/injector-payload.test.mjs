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
      action: "#6699FF",
      actionForeground: "#FFFFFF",
      focusRing: "#8EB1FF",
      sidebarSurface: "rgba(16, 21, 31, 0.82)",
    },
    fonts: { ui: ["system-ui"] },
    appearance: {
      backdropBlurPx: 18,
      backdropSaturation: 1.1,
      radiusScale: 1,
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

test("theme data becomes a bounded renderer payload without executable fields", async (t) => {
  const directory = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const payload = await loadRuntimePayload(directory);

  assert.equal(payload.version, "1.0.0");
  assert.match(payload.generation, /^[0-9a-f]{16}$/);
  assert.match(payload.backgroundUrl, /^data:image\/webp;base64,/);
  assert.deepEqual(payload.position, { xPercent: 25, yPercent: 75 });
  assert.equal(payload.variables["--cc-doubao-text"], "#E9EEF7");
  assert.equal(payload.variables["--cc-doubao-sidebar-surface"], "rgba(16, 21, 31, 0.82)");
  assert.equal(payload.variables["--cc-doubao-font-ui"], "system-ui");
  assert.equal(payload.variables["--cc-doubao-backdrop-blur"], "18px");
  assert.deepEqual(Object.keys(payload).sort(), ["backgroundUrl", "generation", "position", "variables", "version"]);
  assert.equal(JSON.stringify(payload).includes("selector"), false);
  assert.equal(JSON.stringify(payload).includes("javascript"), false);
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
