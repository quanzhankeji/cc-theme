import assert from "node:assert/strict";
import { normalizeSkinTheme, MAC_WORKBUDDY_ADAPTER_ID } from "../scripts/skin-theme.mjs";

const normalized = normalizeSkinTheme({
  kind: "skin.theme",
  id: "test_theme",
  image: "background.png",
  colors: { accent: "#123456" },
  backgroundVideo: "ignored.mp4",
  appearance: { backdropBlurPx: 999, radiusScale: 0 },
});

assert.equal(normalized.adapter, MAC_WORKBUDDY_ADAPTER_ID);
assert.equal(normalized.paletteStrategy, "custom");
assert.equal(normalized.appearance.paletteStrategy, "custom");
assert.equal(normalized.colors.accent, "#123456");
assert.equal(normalized.semanticColors.overlayScrim, "rgba(0, 0, 0, .60)");
assert.equal(normalized.semanticColors.detailScrim, "rgba(0, 0, 0, .34)");
assert.equal(normalized.semanticColors.danger, "#F64041");
assert.equal(normalized.semanticColors.textSecondary, "#9ebdb3");
assert.equal(normalized.semanticColors.textDisabled, "rgba(158, 189, 179, .58)");
assert.equal(normalized.semanticColors.iconPrimary, "#e9fff1");
assert.equal(normalized.semanticColors.iconMuted, "#9ebdb3");
assert.equal(normalized.semanticColors.controlTrack, "rgba(158, 189, 179, .30)");
assert.equal(normalized.semanticColors.controlTrackActive, "#123456");
assert.equal(normalized.semanticColors.controlThumb, "#FFFFFF");
assert.equal(normalized.appearance.backdropBlurPx, 48);
assert.equal(normalized.appearance.radiusScale, 0.75);
assert.equal(normalized.backgroundVideo, "ignored.mp4");
assert.equal(normalized.appearance.backgroundVideoPosterMode, "image");
assert.equal(normalized.appearance.backgroundVideoPosition, undefined);
assert.equal(normalized.appearance.backgroundScrimOpacity, 1);

// Palette variants inherit only the already-validated outer media presence.
// This prevents a legal video poster policy from being rejected while still
// keeping variants closed to paint data.
const dualAppearanceVideo = normalizeSkinTheme({
  kind: "skin.theme",
  id: "dual-appearance-video",
  image: "background.png",
  backgroundVideo: "ambient.mp4",
  appearance: { backgroundVideoPosterMode: "image" },
  appearanceVariants: {
    light: { colors: { text: "#1D2D3D", muted: "#5B6D7E" }, semanticColors: { surfaceBase: "#F7FAFC" } },
    dark: { colors: { text: "#F5F8FC", muted: "#B8C4D0" }, semanticColors: { surfaceBase: "#101820" } },
  },
});
assert.equal(dualAppearanceVideo.backgroundVideo, "ambient.mp4");
assert.equal(dualAppearanceVideo.appearanceVariants.light.colors.text, "#1D2D3D");
assert.equal(dualAppearanceVideo.appearanceVariants.dark.colors.text, "#F5F8FC");
assert.throws(() => normalizeSkinTheme({
  kind: "skin.theme",
  id: "hero-is-not-a-workbuddy-field",
  image: "background.png",
  homeHeroImage: "hero.png",
}), /unsupported fields: homeHeroImage/);
assert.throws(() => normalizeSkinTheme({
  kind: "skin.theme",
  id: "unknown-semantic-color",
  image: "background.png",
  semanticColors: { success: "#00ff00" },
}), /semanticColors has unsupported fields: success/);
assert.throws(() => normalizeSkinTheme({ kind: "other", id: "x", image: "x.png" }), /skin.theme/);
assert.throws(() => normalizeSkinTheme({ kind: "skin.theme", id: "bad id", image: "x.png" }), /id may contain/);
assert.throws(() => normalizeSkinTheme({ kind: "skin.theme", id: "ok", image: "../x.png" }), /theme directory/);
assert.throws(() => normalizeSkinTheme({
  kind: "skin.theme",
  id: "ok",
  image: "x.png",
  backgroundVideo: "../x.mp4",
}), /theme directory/);
assert.equal(normalizeSkinTheme({
  kind: "skin.theme",
  id: "system-theme",
  image: "background.png",
  appearance: { paletteStrategy: "system", shellMode: "auto" },
}).paletteStrategy, "system");
assert.throws(() => normalizeSkinTheme({
  kind: "skin.theme",
  id: "host-shell-mode-is-authoritative",
  image: "background.png",
  appearance: { paletteStrategy: "adaptive", shellMode: "dark" },
}), /shellMode must be auto/);
assert.throws(() => normalizeSkinTheme({
  kind: "skin.theme",
  id: "bad-strategy",
  image: "background.png",
  appearance: { paletteStrategy: "automatic" },
}), /paletteStrategy/);

console.log("theme.test.mjs: ok");
