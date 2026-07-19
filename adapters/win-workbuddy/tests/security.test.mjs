import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectUnifiedTheme } from "../src/projector.mjs";
import { normalizeTheme } from "../src/theme-normalizer.mjs";

const fixture = JSON.parse(readFileSync(new URL("fixtures/unified-theme.json", import.meta.url), "utf8"));
const valid = projectUnifiedTheme(structuredClone(fixture)).artifact;

test("normalized themes reject executable and locator fields", () => {
  for (const [key, value] of [
    ["css", "body{}"], ["javascript", "alert(1)"], ["html", "<div>"],
    ["shader", "void main(){}"], ["selector", "#root"], ["command", "whoami"],
    ["url", "https://example.test"], ["path", "C:\\temp\\x"],
  ]) {
    const input = structuredClone(valid);
    input[key] = value;
    assert.throws(() => normalizeTheme(input), /theme-executable-field-forbidden/);
  }
});

test("normalized themes reject URLs, absolute paths, traversal, and environment expansion", () => {
  for (const image of [
    "https://example.test/image.png", "C:\\Users\\person\\image.png", "\\\\server\\share\\image.png",
    "/tmp/image.png", "../image.png", "%USERPROFILE%\\image.png", "${HOME}/image.png",
  ]) {
    const input = structuredClone(valid);
    input.background.image = image;
    assert.throws(() => normalizeTheme(input), /theme-executable-value-forbidden|theme-background-image-invalid/);
  }
});

test("unknown nested theme fields fail closed", () => {
  const input = structuredClone(valid);
  input.appearance.experimental = true;
  assert.throws(() => normalizeTheme(input), /theme-field-unknown/);
});

test("HTML and CSS/URL-like strings are rejected even in otherwise textual fields", () => {
  const htmlName = structuredClone(valid);
  htmlName.name = "<script>alert(1)</script>";
  assert.throws(() => normalizeTheme(htmlName), /theme-executable-value-forbidden/);

  const cssFont = structuredClone(valid);
  cssFont.fonts.ui = ["url(evil)"];
  assert.throws(() => normalizeTheme(cssFont), /theme-executable-value-forbidden/);

  const shaderFont = structuredClone(valid);
  shaderFont.fonts.ui = ["void main()"];
  assert.throws(() => normalizeTheme(shaderFont), /theme-executable-value-forbidden/);
});
