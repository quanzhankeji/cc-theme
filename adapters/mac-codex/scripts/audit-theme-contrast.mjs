import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { normalizeSkinTheme } from "./skin-theme.mjs";

const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);

function valueFor(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
  return value;
}

async function readJson(filePath, label) {
  let handle;
  try {
    handle = await fs.open(filePath, OPEN_FLAGS);
  } catch (error) {
    if (error.code === "ELOOP") throw new Error(`${label} must not be a symbolic link`);
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 2 || stat.size > 1024 * 1024) throw new Error(`${label} has an invalid size`);
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

function color(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    const number = Number.parseInt(value.slice(1), 16);
    return { r: number >> 16, g: (number >> 8) & 255, b: number & 255, a: 1 };
  }
  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) throw new Error(`Unsupported color in contrast audit: ${value}`);
  const parts = match[1].split(",").map((part) => part.trim());
  if (parts.length < 3 || parts.length > 4) throw new Error(`Malformed color in contrast audit: ${value}`);
  const channel = (item) => item.endsWith("%") ? Number(item.slice(0, -1)) * 2.55 : Number(item);
  const result = { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: parts[3] === undefined ? 1 : Number(parts[3].replace("%", "")) / (parts[3].endsWith("%") ? 100 : 1) };
  if (![result.r, result.g, result.b, result.a].every(Number.isFinite)
    || result.r < 0 || result.r > 255 || result.g < 0 || result.g > 255
    || result.b < 0 || result.b > 255 || result.a < 0 || result.a > 1) {
    throw new Error(`Out-of-range color in contrast audit: ${value}`);
  }
  return result;
}

function composite(foreground, background) {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (!alpha) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  };
}

function opaque(value, base) {
  const parsed = typeof value === "string" ? color(value) : value;
  return parsed.a < 1 ? composite(parsed, base) : parsed;
}

function linear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(value) {
  return 0.2126 * linear(value.r) + 0.7152 * linear(value.g) + 0.0722 * linear(value.b);
}

function ratio(left, right) {
  const high = Math.max(luminance(left), luminance(right));
  const low = Math.min(luminance(left), luminance(right));
  return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
}

async function main() {
  const themeDirectory = valueFor("theme-dir");
  if (!themeDirectory) throw new Error("Usage: audit-theme-contrast.mjs --theme-dir <theme-dir> [--analysis-file <media-analysis.json>]");
  const theme = normalizeSkinTheme(await readJson(path.join(path.resolve(themeDirectory), "theme.json"), "Theme config"));
  const shells = theme.shellMode === "light" || theme.shellMode === "dark"
    ? [theme.shellMode] : ["light", "dark"];
  const evaluated = shells.map((shell) => {
    const palette = theme.resolvedPalettes[shell];
    const canvas = shell === "light" ? { r: 255, g: 255, b: 255, a: 1 } : { r: 0, g: 0, b: 0, a: 1 };
    const base = opaque(palette.colors.background, canvas);
    const pairs = [
      ["colors.text/panel", palette.colors.text, palette.colors.panel, 4.5],
      ["colors.muted/panel", palette.colors.muted, palette.colors.panel, 3],
      ["textStrong/surfaceBase", palette.semanticColors.textStrong, palette.semanticColors.surfaceBase, 4.5],
      ["placeholder/surfaceBase", palette.semanticColors.placeholder, palette.semanticColors.surfaceBase, 3],
      ["actionForeground/action", palette.semanticColors.actionForeground, palette.semanticColors.action, 4.5],
      ["link/surfaceBase", palette.semanticColors.link, palette.semanticColors.surfaceBase, 3],
      ["focusRing/surfaceBase", palette.semanticColors.focusRing, palette.semanticColors.surfaceBase, 3],
    ].map(([name, foreground, background, minimum]) => {
      const backgroundColor = opaque(background, base);
      const foregroundColor = opaque(foreground, backgroundColor);
      const contrastRatio = ratio(foregroundColor, backgroundColor);
      return { shell, name, ratio: contrastRatio, minimum, pass: contrastRatio >= minimum };
    });
    return { shell, base, palette, pairs };
  });
  const pairs = evaluated.flatMap((entry) => entry.pairs);

  let mediaComposite = { status: "not-evaluated", reason: "Pass the matching media analysis to estimate direct text-over-art risk." };
  const analysisFile = valueFor("analysis-file");
  if (analysisFile) {
    const analysis = await readJson(path.resolve(analysisFile), "Media analysis");
    const expected = analysis.mediaType === "video" ? theme.backgroundVideo : theme.image;
    if (analysis.kind !== "cc-theme.media-analysis" || analysis.revision !== 1 || analysis.source?.name !== expected) {
      throw new Error("Media analysis does not match this theme background");
    }
    const swatches = analysis.analysis?.palette?.swatches;
    if (!Array.isArray(swatches) || !swatches.length || swatches.some((item) => typeof item !== "string")) {
      throw new Error("Media analysis has no usable palette swatches");
    }
    const samples = [];
    for (const entry of evaluated) {
      const text = opaque(entry.palette.semanticColors.textStrong, entry.base);
      for (const swatch of swatches) {
        const art = opaque(swatch, entry.base);
        for (const [scrimName, scrimValue] of [
          ["start", entry.palette.semanticColors.mainScrimStart],
          ["mid", entry.palette.semanticColors.mainScrimMid],
          ["end", entry.palette.semanticColors.mainScrimEnd],
        ]) {
          const backdrop = opaque(scrimValue, art);
          samples.push({ shell: entry.shell, swatch, scrim: scrimName, ratio: ratio(text, backdrop) });
        }
      }
    }
    samples.sort((left, right) => left.ratio - right.ratio);
    mediaComposite = {
      status: samples[0].ratio >= 4.5 ? "pass" : "review",
      minimum: 4.5,
      worst: samples[0],
      note: "Advisory approximation only; native surfaces, crop position, blur and route layout still require preview inspection.",
    };
  }

  const result = {
    kind: "cc-theme.contrast-audit",
    revision: 1,
    themeId: theme.id,
    pass: pairs.every((item) => item.pass),
    pairs,
    mediaComposite,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 1;
}

await main();
