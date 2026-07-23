import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateThemeFamily } from "../compiler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const readTheme = async () => JSON.parse(await fs.readFile(path.join(root, "app/packages/test-kit/fixtures/unified-theme.json"), "utf8"));

const SEMANTIC_COLOR_KEYS = [
  "surfaceBase", "surfaceRaised", "surfaceElevated", "surfaceCode", "text", "textStrong", "textMuted", "placeholder",
  "borderSubtle", "borderDefault", "borderStrong", "action", "actionHover", "actionPressed", "actionForeground",
  "hoverSurface", "pressedSurface", "selectedSurface", "selectedHoverSurface", "focusRing", "link", "danger", "success",
  "warning", "sidebarSurface", "headerSurface", "mainScrimStart", "mainScrimMid", "mainScrimEnd", "composerSurface",
];

function completePalette({ surface, text, muted, action, actionHover, actionPressed, actionForeground }) {
  return {
    ...Object.fromEntries(SEMANTIC_COLOR_KEYS.map((key) => [key, surface])),
    text,
    textStrong: text,
    textMuted: muted,
    placeholder: muted,
    action,
    actionHover,
    actionPressed,
    actionForeground,
    borderStrong: action,
    focusRing: action,
    link: action,
  };
}

function appearanceVariants() {
  return {
    light: {
      colors: completePalette({
        surface: "#F7F0E1", text: "#241C15", muted: "#6F5F4B",
        action: "#795021", actionHover: "#634019", actionPressed: "#4A2F12", actionForeground: "#FFFFFF",
      }),
    },
    dark: {
      colors: completePalette({
        surface: "#171513", text: "#F3EAD7", muted: "#B5A386",
        action: "#8F6431", actionHover: "#795021", actionPressed: "#70482B", actionForeground: "#FFF8E9",
      }),
    },
  };
}

async function contrastSafeTheme() {
  const theme = await readTheme();
  Object.assign(theme.sharedCore.tokens.colors, {
    action: "#2F7D57",
    actionForeground: "#FFFFFF",
  });
  return theme;
}

test("declared minimumTextContrast validates bounded semantic text pairs", async () => {
  const theme = await contrastSafeTheme();
  assert.doesNotThrow(() => validateThemeFamily(theme));
});

test("declared minimumTextContrast rejects unreadable action states before projection", async () => {
  const theme = await contrastSafeTheme();
  theme.sharedCore.tokens.colors.actionHover = "#6699FF";

  assert.throws(
    () => validateThemeFamily(theme),
    /actionForeground\/actionHover: contrast .* below declared minimumTextContrast/,
  );
});

test("declared minimumTextContrast rejects muted text against declared semantic surfaces", async () => {
  const theme = await contrastSafeTheme();
  Object.assign(theme.sharedCore.tokens.colors, {
    surfaceBase: "#FFFFFF",
    text: "#666666",
    textMuted: "#777777",
  });
  delete theme.sharedCore.tokens.colors.surfaceRaised;
  delete theme.sharedCore.tokens.colors.composerSurface;

  assert.throws(
    () => validateThemeFamily(theme),
    /textMuted\/surfaceBase: contrast .* below declared minimumTextContrast/,
  );
});

test("appearanceVariants requires a complete, contrast-safe light and dark semantic palette", async () => {
  const theme = await contrastSafeTheme();
  theme.sharedCore.appearanceVariants = appearanceVariants();

  assert.doesNotThrow(() => validateThemeFamily(theme));
});

test("appearanceVariants rejects unknown keys and unreadable per-appearance colors", async () => {
  const unknown = await contrastSafeTheme();
  unknown.sharedCore.appearanceVariants = appearanceVariants();
  unknown.sharedCore.appearanceVariants.dark.script = "alert(1)";
  assert.throws(() => validateThemeFamily(unknown), /appearanceVariants\.dark: contains unsupported fields: script/);

  const unreadable = await contrastSafeTheme();
  unreadable.sharedCore.appearanceVariants = appearanceVariants();
  unreadable.sharedCore.appearanceVariants.light.colors.actionHover = "#C8B99B";
  assert.throws(
    () => validateThemeFamily(unreadable),
    /appearanceVariants\.light\.colors\.actionForeground\/actionHover: contrast .* below declared minimumTextContrast/,
  );
});
