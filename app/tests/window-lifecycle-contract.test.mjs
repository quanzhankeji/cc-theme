import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("main window has only the event and native package-picker permissions it requires", async () => {
  const capability = JSON.parse(await readFile(new URL("src-tauri/capabilities/main.json", root), "utf8"));
  assert.deepEqual(capability.windows, ["main"]);
  assert.deepEqual(capability.permissions, [
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "dialog:allow-open",
  ]);

  const [backend, frontend] = await Promise.all([
    readFile(new URL("src-tauri/src/lib.rs", root), "utf8"),
    readFile(new URL("src/window-api.ts", root), "utf8"),
  ]);
  assert.match(backend, /manager-close-requested/);
  assert.match(frontend, /manager-close-requested/);
});

test("main window accepts native file drops and routes them through the theme package importer", async () => {
  const [config, dropTarget, app] = await Promise.all([
    readFile(new URL("src-tauri/tauri.conf.json", root), "utf8").then(JSON.parse),
    readFile(new URL("src/theme-package-drop.ts", root), "utf8"),
    readFile(new URL("src/App.tsx", root), "utf8"),
  ]);
  assert.equal(config.app.windows[0].dragDropEnabled, true);
  assert.match(dropTarget, /getCurrentWebview\(\)\.onDragDropEvent/);
  assert.match(app, /\.toLowerCase\(\)\.endsWith\("\.cctheme"\)/);
  assert.match(app, /await importThemePackageAtPath\(packagePath\)/);
  assert.match(app, /await api\.importThemePackage\(packagePath\)/);
});

test("menu bar uses the approved transparent PNG as a macOS template icon", async () => {
  const [icon, backend, cargo] = await Promise.all([
    readFile(new URL("src-tauri/icons/menu-bar-icon.png", root)),
    readFile(new URL("src-tauri/src/lib.rs", root), "utf8"),
    readFile(new URL("src-tauri/Cargo.toml", root), "utf8"),
  ]);
  assert.equal(createHash("sha256").update(icon).digest("hex"), "3705ba7d644d117893809fe55c1cdbe607375a73ffb466b87ce1d06c8ed6091b");
  assert.match(
    backend,
    /include_bytes!\(\s*"\.\.\/icons\/menu-bar-icon\.png"\s*\)/,
  );
  assert.match(backend, /icon_as_template\(true\)/);
  assert.match(cargo, /"image-png"/);
});
