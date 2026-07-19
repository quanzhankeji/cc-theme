import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadStyleCatalog } from "../scripts/theme-style-catalog.mjs";
import { loadStyleOverrides, saveStyleOverrides } from "../scripts/theme-style-overrides.mjs";
import { normalizeSkinTheme } from "../scripts/skin-theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [renderer, injector, skinCss, catalog] = await Promise.all([
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "scripts", "injector.mjs"), "utf8"),
  fs.readFile(path.join(root, "assets", "skin.css"), "utf8"),
  loadStyleCatalog(),
]);
for (const forbidden of ["cc-theme-style-editor-save", "saveLocal", "Save on this Mac"]) {
  assert.equal(renderer.includes(forbidden), false, `WYSIWYG page still contains a save control: ${forbidden}`);
}
assert(renderer.includes('input.addEventListener("input"'));
assert(renderer.includes("applyStyleOverrides(document.documentElement);"));
assert(renderer.includes("stylePersistenceDebounceTimer = setTimeout(() => dispatchStylePersistence(entry), 180)"));
assert(renderer.includes("const flushStyleEditorPersistence"));
assert(renderer.includes("restoreLastValidEditorState(result)"));
assert(renderer.includes("persistedEditorRevision"));
assert(renderer.includes('input.type = token.type === "number" ? "number" : "text"'));
assert(renderer.includes("const syncOwnedThemeSettingsPresentation"),
  "the owned settings page must keep its editor presentation when host visuals are bypassed");
assert(renderer.includes('page.dataset.themeVisualPresentation = disabled ? "native" : "theme"'));
assert(renderer.includes("syncOwnedThemeSettingsPresentation();\n      return;"),
  "the disabled rendering branch must resync the owned page after restoring the host");
assert(renderer.includes("previewStyleOverrides();"),
  "editor input must preview through the presentation-aware boundary");
const commitInputBlock = renderer.slice(
  renderer.indexOf("const commitInputValue = () =>"),
  renderer.indexOf('input.addEventListener("input"'),
);
assert(commitInputBlock.includes("previewStyleOverrides();"));
assert.equal(commitInputBlock.includes("applyStyleOverrides(document.documentElement);"), false,
  "editor input must not leak a partial theme back onto the host while visuals are disabled");
assert(skinCss.includes('#cc-theme-style-editor[data-theme-editor-placement="settings"] > footer {\n  background: transparent;'),
  "the dedicated settings footer must not paint an opaque block over the theme background");
assert(injector.includes("latestRevisionByNonce"));
assert(injector.includes("message.revision < latestRevision"));
assert(injector.includes("let saveChain = Promise.resolve()"));
for (const id of ["effect.backdropBlur", "effect.backdropSaturation", "effect.videoScrimOpacity", "effect.interactiveScrimOpacity"]) {
  assert(catalog.tokens.some((token) => token.id === id && token.type === "number"));
}

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cc-theme-wysiwyg-"));
try {
  const theme = normalizeSkinTheme({ kind: "skin.theme", id: "wysiwyg", name: "WYSIWYG", image: "background.png" });
  const values = { "text.primary": "#112233", "effect.backdropBlur": 27, "effect.videoScrimOpacity": 0.31 };
  await saveStyleOverrides(theme, catalog, values, {
    root: temporary,
    preferences: { backgroundPresentation: "paused", interactiveEffectEnabled: false },
  });
  const loaded = await loadStyleOverrides(theme, catalog, { root: temporary });
  assert.deepEqual(loaded.values, values);
  assert.deepEqual(loaded.preferences, { backgroundPresentation: "paused", interactiveEffectEnabled: false });
  assert.equal((await fs.stat(loaded.file)).mode & 0o777, 0o600);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
console.log("theme-editor-wysiwyg.test.mjs: ok");
