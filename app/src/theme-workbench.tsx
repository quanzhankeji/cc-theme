import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { ThemeFamily } from "./types";
import "./theme-workbench.css";

export interface ThemeWorkbenchDraft {
  kind: "cc-theme.theme-workbench-draft";
  revision: 1;
  base: { themeId: string };
  previewAdapterId: PreviewTarget;
  patch: {
    textColors: {
      lightText: string;
      darkText: string;
    };
    surfaceOpacity: number;
    backgroundAsset: {
      source: "inherit" | "theme" | "uploaded";
      mediaType: "image" | "video" | null;
      fileName?: string;
      mimeType?: string;
      requiresStaticFallback?: true;
    };
  };
}

export interface ThemeWorkbenchMedia {
  bytes: Uint8Array;
}

interface LocalBackground {
  objectUrl: string;
  mediaType: "image" | "video";
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

type PreviewTarget = "mac-codex" | "mac-workbuddy";
type PreviewAppearance = "light" | "dark";

export interface ThemeWorkbenchProps {
  theme: ThemeFamily;
  locale: "zh-CN" | "en-US";
  onClose: () => void;
  /** Static simulation targets. Runtime fidelity is owned by an Adapter preview capability. */
  previewTargets?: readonly PreviewTarget[];
  /** Persists only closed local overrides; it never changes the imported package. */
  onSaveDraft?: (draft: ThemeWorkbenchDraft, media: ThemeWorkbenchMedia | null) => void | Promise<void>;
  /** Removes the Manager-owned local editable copy and returns to the imported baseline. */
  onRestoreOriginal?: (themeId: string) => void | Promise<void>;
}

function isHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value);
}

interface HsvColor { hue: number; saturation: number; value: number; }
interface RgbColor { red: number; green: number; blue: number; }

const QUICK_COLOURS = ["#E9EEF7", "#AAB5C5", "#10151F", "#2F7D57", "#7B63ED", "#266446", "#D74D5B", "#D49A35"] as const;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function hexToHsv(value: string): HsvColor {
  const hex = isHexColor(value) ? value.slice(1) : "E9EEF7";
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return { hue: (hue + 360) % 360, saturation: maximum === 0 ? 0 : delta / maximum, value: maximum };
}

function hsvToHex({ hue, saturation, value }: HsvColor): string {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const chroma = clamp(value) * clamp(saturation);
  const match = chroma * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
  const offset = clamp(value) - chroma;
  const [red, green, blue] = normalizedHue < 60 ? [chroma, match, 0]
    : normalizedHue < 120 ? [match, chroma, 0]
      : normalizedHue < 180 ? [0, chroma, match]
        : normalizedHue < 240 ? [0, match, chroma]
          : normalizedHue < 300 ? [match, 0, chroma]
            : [chroma, 0, match];
  const channel = (component: number) => Math.round((component + offset) * 255).toString(16).padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`.toUpperCase();
}

function hexToRgb(value: string): RgbColor {
  const hex = isHexColor(value) ? value.slice(1) : "E9EEF7";
  return { red: Number.parseInt(hex.slice(0, 2), 16), green: Number.parseInt(hex.slice(2, 4), 16), blue: Number.parseInt(hex.slice(4, 6), 16) };
}

function rgbToHex({ red, green, blue }: RgbColor): string {
  const channel = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`.toUpperCase();
}

function previewPalette(theme: ThemeFamily, appearance: PreviewAppearance): [string, string, string] {
  if (theme.appearanceVariants) return theme.appearanceVariants[appearance];
  return appearance === "light"
    ? ["#F4F7FA", theme.colors[1], "#203041"]
    : theme.colors;
}

function previewScrim(theme: ThemeFamily, appearance: PreviewAppearance): [string, string, string] {
  if (theme.presentationScrim) return theme.presentationScrim[appearance];
  return appearance === "light"
    ? ["rgba(247, 249, 252, .88)", "rgba(247, 249, 252, .54)", "rgba(247, 249, 252, .18)"]
    : ["rgba(8, 11, 18, .82)", "rgba(11, 15, 24, .48)", "rgba(14, 18, 28, .16)"];
}

function copyForDraft(theme: ThemeFamily, textColors: Record<PreviewAppearance, string>, surfaceOpacity: number, background: LocalBackground | null, backgroundSource: "inherit" | "theme" | "uploaded", previewAdapterId: PreviewTarget): ThemeWorkbenchDraft {
  return {
    kind: "cc-theme.theme-workbench-draft",
    revision: 1,
    base: { themeId: theme.id },
    previewAdapterId,
    patch: {
      textColors: {
        lightText: textColors.light.toUpperCase(),
        darkText: textColors.dark.toUpperCase(),
      },
      surfaceOpacity,
      backgroundAsset: backgroundSource === "uploaded" && background
        ? { source: "uploaded", mediaType: background.mediaType, fileName: background.fileName, mimeType: background.mimeType, ...(background.mediaType === "video" ? { requiresStaticFallback: true as const } : {}) }
        : { source: backgroundSource, mediaType: null },
    },
  };
}

interface WorkbenchSavedSnapshot {
  textColors: Record<PreviewAppearance, string>;
  surfaceOpacity: number;
  background: LocalBackground | null;
  backgroundSource: "inherit" | "theme" | "uploaded";
}

function initialTextColors(theme: ThemeFamily): Record<PreviewAppearance, string> {
  // A Theme Family without appearanceVariants owns one Shared Core text token.
  // The preview can still use a light-friendly fallback palette, but the
  // editable value must start as the same semantic token for both appearances.
  // Otherwise simply opening the Workbench manufactures an invalid divergent
  // Light/Dark edit and makes an opacity-only save fail closed.
  if (!theme.appearanceVariants) {
    return { light: theme.colors[2], dark: theme.colors[2] };
  }
  return {
    light: previewPalette(theme, "light")[2],
    dark: previewPalette(theme, "dark")[2],
  };
}

function words(locale: ThemeWorkbenchProps["locale"]) {
  return locale === "zh-CN"
    ? {
      title: "主题工作台",
      source: "基于公共主题",
      close: "关闭工作台",
      openPanel: "展开编辑抽屉",
      closePanel: "收起编辑抽屉",
      draft: "有未保存的更改",
      unchanged: "所有更改均已保存",
      saving: "正在保存更改…",
      saved: "已保存到本地；下次应用主题时会使用这些设置。",
      text: "主要文字颜色",
      palette: "颜色板",
      hue: "色相",
      picker: "文字颜色选择器",
      red: "红",
      green: "绿",
      blue: "蓝",
      quickColours: "常用颜色",
      background: "背景媒体",
      opacity: "主内容背景透明度",
      moreOpaque: "更不透明",
      chooseMedia: "选择图片或视频",
      inheritMedia: "沿用主题背景",
      mediaHint: "保存时会校验并复制兼容的本地媒体；原始主题包不会被修改。",
      invalidMedia: "仅支持 PNG、JPEG、WebP 图片或 MP4 视频。",
      opacityHint: "背景在最底层；此数值会同时缩放主内容层与它的场景遮罩。调到 0% 时不再额外暗化或模糊背景。",
      opacityUnavailable: "此主题没有声明可持久化的沉浸式内容层；当前数值只用于预览。",
      reset: "放弃未保存更改",
      restoreOriginal: "恢复原始主题",
      restoringOriginal: "正在恢复原始主题…",
      save: "保存更改",
      back: "返回",
      appearance: "预览外观",
      light: "浅色",
      dark: "深色",
      target: "预览目标",
      codex: "Codex",
      workbuddy: "WorkBuddy",
      newConversation: "新对话",
      recent: "最近",
      task: "给这个项目梳理一份交付计划",
      answer: "我会先拆分目标、风险和验收节点。",
      composer: "给 Codex 发送消息…",
      saveFailed: "无法保存本次编辑；原始主题和已有本地设置均未被修改。",
      saveFailedAppearance: "此主题没有独立的浅色/深色色板，因此主文字颜色会同时用于两种外观。请重新保存。",
      saveFailedStorage: "本地编辑副本未能写入；原始主题和已有本地版本均未被修改。",
      saveFailedBaseline: "导入主题的基线已变化；请先恢复原始主题，再基于新版本重新编辑。",
      selectedMedia: "已选择 {name}",
    }
    : {
      title: "Theme workbench",
      source: "Based on public theme",
      close: "Close workbench",
      openPanel: "Open edit drawer",
      closePanel: "Close edit drawer",
      draft: "Unsaved changes",
      unchanged: "All changes are saved",
      saving: "Saving changes…",
      saved: "Saved locally. These settings will be used the next time the theme is applied.",
      text: "Primary text colour",
      palette: "Colour palette",
      hue: "Hue",
      picker: "Text colour picker",
      red: "R",
      green: "G",
      blue: "B",
      quickColours: "Quick colours",
      background: "Background media",
      opacity: "Main content surface opacity",
      moreOpaque: "More opaque",
      chooseMedia: "Choose image or video",
      inheritMedia: "Use theme background",
      mediaHint: "Saving verifies and copies compatible local media. The original theme package is never changed.",
      invalidMedia: "Only PNG, JPEG, WebP images, or MP4 video are supported.",
      opacityHint: "The background sits underneath. This scales the main content surface and its scene veil; at 0% the preview adds no extra dimming or blur.",
      opacityUnavailable: "This theme does not declare a persistent immersive content surface; this value is preview-only.",
      reset: "Discard unsaved changes",
      restoreOriginal: "Restore original theme",
      restoringOriginal: "Restoring original theme…",
      save: "Save changes",
      back: "Back",
      appearance: "Preview appearance",
      light: "Light",
      dark: "Dark",
      target: "Preview target",
      codex: "Codex",
      workbuddy: "WorkBuddy",
      newConversation: "New conversation",
      recent: "Recent",
      task: "Create a delivery plan for this project",
      answer: "I’ll start by separating goals, risks, and acceptance points.",
      composer: "Message Codex…",
      saveFailed: "Could not save these edits. The original theme and existing local settings were not changed.",
      saveFailedAppearance: "This theme has one shared text token, so the primary text colour is applied to both appearances. Please save again.",
      saveFailedStorage: "The local editable copy could not be written. The original theme and existing local version were not changed.",
      saveFailedBaseline: "The imported theme baseline changed. Restore the original theme before editing the new version.",
      selectedMedia: "Selected {name}",
    };
}

export function ThemeWorkbench({ theme, locale, onClose, onSaveDraft, onRestoreOriginal, previewTargets }: ThemeWorkbenchProps) {
  const copy = useMemo(() => words(locale), [locale]);
  const fileInput = useRef<HTMLInputElement>(null);
  const colourControl = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [previewAppearance, setPreviewAppearance] = useState<PreviewAppearance>("dark");
  const [textColors, setTextColors] = useState<Record<PreviewAppearance, string>>(() => initialTextColors(theme));
  const initialSurfaceOpacity = theme.presentationSurfaceOpacity ?? 0.72;
  const [surfaceOpacity, setSurfaceOpacity] = useState(initialSurfaceOpacity);
  const [background, setBackground] = useState<LocalBackground | null>(null);
  const [backgroundSource, setBackgroundSource] = useState<"inherit" | "theme" | "uploaded">("inherit");
  const [savedSnapshot, setSavedSnapshot] = useState<WorkbenchSavedSnapshot>(() => ({
    textColors: initialTextColors(theme),
    surfaceOpacity: initialSurfaceOpacity,
    background: null,
    backgroundSource: "inherit",
  }));
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasLocalDraft, setHasLocalDraft] = useState(Boolean(theme.hasLocalDraft));
  const [restoringOriginal, setRestoringOriginal] = useState(false);
  const supportedPreviewTargets = useMemo<readonly PreviewTarget[]>(() => previewTargets ?? (["mac-codex", "mac-workbuddy"] as const).filter((target) => theme.compatibility[target]?.status === "ready"), [previewTargets, theme.compatibility]);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget>(supportedPreviewTargets[0] ?? "mac-codex");
  const palette = previewPalette(theme, previewAppearance);
  const textColor = textColors[previewAppearance];

  useEffect(() => {
    setPreviewAppearance("dark");
    const nextTextColors = initialTextColors(theme);
    const nextSurfaceOpacity = theme.presentationSurfaceOpacity ?? 0.72;
    setTextColors(nextTextColors);
    setSurfaceOpacity(nextSurfaceOpacity);
    setSavedSnapshot({ textColors: nextTextColors, surfaceOpacity: nextSurfaceOpacity, background: null, backgroundSource: "inherit" });
    setBackgroundSource("inherit");
    setBackground((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl);
      return null;
    });
    setSaveState("idle");
    setSaveError(null);
    setHasLocalDraft(Boolean(theme.hasLocalDraft));
    setRestoringOriginal(false);
    setMediaError(null);
    setPickerOpen(false);
    setPreviewTarget(supportedPreviewTargets[0] ?? "mac-codex");
  }, [theme.id]);

  useEffect(() => {
    if (!pickerOpen) return;
    const closeIfOutside = (event: PointerEvent) => {
      if (!colourControl.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [pickerOpen]);

  const safeTextColor = isHexColor(textColor) ? textColor.toUpperCase() : palette[2];
  const safeTextColors: Record<PreviewAppearance, string> = {
    light: isHexColor(textColors.light) ? textColors.light.toUpperCase() : previewPalette(theme, "light")[2],
    dark: isHexColor(textColors.dark) ? textColors.dark.toUpperCase() : previewPalette(theme, "dark")[2],
  };
  const currentHsv = hexToHsv(safeTextColor);
  const currentRgb = hexToRgb(safeTextColor);
  const canPersistSurfaceOpacity = theme.presentationSurfaceOpacity !== undefined;
  const hasInvalidTextColor = !isHexColor(textColors.light) || !isHexColor(textColors.dark);
  const hasChanges = textColors.light !== savedSnapshot.textColors.light
    || textColors.dark !== savedSnapshot.textColors.dark
    || surfaceOpacity !== savedSnapshot.surfaceOpacity
    || background !== savedSnapshot.background
    || backgroundSource !== savedSnapshot.backgroundSource;
  const canSave = Boolean(onSaveDraft && canPersistSurfaceOpacity && hasChanges && !hasInvalidTextColor && saveState !== "saving");
  const draftStatus = saveState === "saving"
    ? copy.saving
    : saveState === "saved"
      ? copy.saved
      : saveState === "failed"
        ? saveError === "appearance" ? copy.saveFailedAppearance
          : saveError === "storage" ? copy.saveFailedStorage
            : saveError === "baseline" ? copy.saveFailedBaseline
            : copy.saveFailed
        : hasChanges ? copy.draft : copy.unchanged;
  const backgroundUrl = background?.objectUrl ?? theme.previewUrl ?? null;
  const scrim = previewScrim(theme, previewAppearance);
  const surfaceOpacityPercent = `${Math.round(surfaceOpacity * 100)}%`;
  const previewStyle = {
    "--workbench-text": safeTextColor,
    "--workbench-surface-opacity": String(surfaceOpacity),
    "--workbench-surface-opacity-percent": surfaceOpacityPercent,
    "--workbench-surface-blur": `${Math.round(surfaceOpacity * 3)}px`,
    "--workbench-main-scrim-start": scrim[0],
    "--workbench-main-scrim-mid": scrim[1],
    "--workbench-main-scrim-end": scrim[2],
    "--workbench-theme-base": palette[0],
    "--workbench-theme-accent": palette[1],
    "--workbench-ui-surface": previewAppearance === "light" ? "#F7F9FC" : "#0C1019",
    "--workbench-ui-surface-strong": previewAppearance === "light" ? "#FFFFFF" : "#0A0D14",
    "--workbench-ui-rail": previewAppearance === "light" ? "#EEF2F6" : "#101623",
    "--workbench-ui-muted": previewAppearance === "light" ? "#526173" : "#AAB5C5",
    "--workbench-ui-border": previewAppearance === "light" ? "rgba(24,32,45,.14)" : "rgba(255,255,255,.13)",
  } as CSSProperties;

  function reset() {
    setTextColors(savedSnapshot.textColors);
    setSurfaceOpacity(savedSnapshot.surfaceOpacity);
    setBackground((current) => {
      if (current && current !== savedSnapshot.background) URL.revokeObjectURL(current.objectUrl);
      return savedSnapshot.background;
    });
    setBackgroundSource(savedSnapshot.backgroundSource);
    if (fileInput.current && !savedSnapshot.background) fileInput.current.value = "";
    setSaveState("idle");
    setSaveError(null);
    setMediaError(null);
  }

  async function handleMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const mediaType = file.type === "video/mp4" ? "video" : file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp" ? "image" : null;
    if (!mediaType) {
      setMediaError(copy.invalidMedia);
      event.target.value = "";
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      setMediaError(copy.invalidMedia);
      event.target.value = "";
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setBackground((current) => {
      if (current && current !== savedSnapshot.background) URL.revokeObjectURL(current.objectUrl);
      return { objectUrl, mediaType, fileName: file.name, mimeType: file.type, bytes };
    });
    setBackgroundSource("uploaded");
    setMediaError(null);
    setSaveState("idle");
    setSaveError(null);
  }

  function updateTextColour(value: string) {
    const normalized = value.toUpperCase();
    setTextColors((current) => theme.appearanceVariants
      ? { ...current, [previewAppearance]: normalized }
      : { light: normalized, dark: normalized });
    setSaveState("idle");
    setSaveError(null);
  }

  function updateRgb(channel: keyof RgbColor, next: string) {
    const value = Number(next);
    if (!Number.isFinite(value)) return;
    updateTextColour(rgbToHex({ ...currentRgb, [channel]: value }));
  }

  function updatePaletteFromPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const saturation = clamp((event.clientX - bounds.left) / bounds.width);
    const value = 1 - clamp((event.clientY - bounds.top) / bounds.height);
    updateTextColour(hsvToHex({ hue: currentHsv.hue, saturation, value }));
  }

  function handlePaletteKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const delta = event.shiftKey ? 0.1 : 0.025;
    let saturation = currentHsv.saturation;
    let value = currentHsv.value;
    if (event.key === "ArrowLeft") saturation -= delta;
    else if (event.key === "ArrowRight") saturation += delta;
    else if (event.key === "ArrowUp") value += delta;
    else if (event.key === "ArrowDown") value -= delta;
    else return;
    event.preventDefault();
    updateTextColour(hsvToHex({ hue: currentHsv.hue, saturation, value }));
  }

  async function saveDraft() {
    if (!canSave || !onSaveDraft) return;
    setSaveState("saving");
    try {
      await onSaveDraft(
        copyForDraft(theme, safeTextColors, surfaceOpacity, background, backgroundSource, previewTarget),
        backgroundSource === "uploaded" && background ? { bytes: background.bytes } : null,
      );
      setSavedSnapshot({ textColors, surfaceOpacity, background, backgroundSource });
      setSaveState("saved");
      setSaveError(null);
      setHasLocalDraft(true);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setSaveError(
        code.includes("theme-workbench-text-colour-appearance-unsupported")
          ? "appearance"
          : code.includes("theme-local-override-baseline-changed")
            ? "baseline"
            : code.includes("storage")
              ? "storage"
              : "generic",
      );
      setSaveState("failed");
    }
  }

  async function restoreOriginal() {
    if (!onRestoreOriginal || !hasLocalDraft || restoringOriginal) return;
    setRestoringOriginal(true);
    try {
      await onRestoreOriginal(theme.id);
      setHasLocalDraft(false);
      onClose();
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setSaveError(code.includes("storage") ? "storage" : "generic");
      setSaveState("failed");
    } finally {
      setRestoringOriginal(false);
    }
  }

  return (
    <section className={`theme-workbench${drawerOpen ? "" : " theme-workbench--drawer-closed"}`} data-testid="theme-workbench" aria-label={copy.title}>
      <div className="theme-workbench__body">
        <aside className="theme-workbench__drawer" aria-label={locale === "zh-CN" ? "主题编辑" : "Theme editor"}>
          <div className="theme-workbench__drawer-head">
            <div className="theme-workbench__drawer-theme">
              <span>{copy.source}</span>
              <strong>{theme.name}</strong>
            </div>
            <button type="button" className="theme-workbench__drawer-toggle" onClick={() => setDrawerOpen(false)} aria-label={copy.closePanel} title={copy.closePanel}>‹</button>
          </div>

          <details className="theme-workbench__section" open>
            <summary>{copy.text}</summary>
            <div className="theme-workbench__colour-control" ref={colourControl}>
              <div className="theme-workbench__control-row">
                <button type="button" className="theme-workbench__colour-swatch" aria-label={copy.text} aria-haspopup="dialog" aria-expanded={pickerOpen} style={{ backgroundColor: safeTextColor }} onClick={() => setPickerOpen((open) => !open)} />
                <input aria-label={`${copy.text} hex`} className="theme-workbench__hex" type="text" value={textColor} maxLength={7} onChange={(event) => { const value = event.target.value; setTextColors((current) => theme.appearanceVariants ? { ...current, [previewAppearance]: value } : { light: value, dark: value }); setSaveState("idle"); }} />
              </div>
              {pickerOpen && <div className="theme-workbench__colour-picker" role="dialog" aria-label={copy.picker}>
                <button
                  type="button"
                  className="theme-workbench__colour-palette"
                  aria-label={copy.palette}
                  style={{ "--palette-hue": `${currentHsv.hue}deg`, "--palette-x": `${currentHsv.saturation * 100}%`, "--palette-y": `${(1 - currentHsv.value) * 100}%` } as CSSProperties}
                  onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); updatePaletteFromPointer(event); }}
                  onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updatePaletteFromPointer(event); }}
                  onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                  onKeyDown={handlePaletteKeyboard}
                >
                  <span aria-hidden="true" />
                </button>
                <label className="theme-workbench__hue-control">
                  <span>{copy.hue}</span>
                  <input aria-label={copy.hue} type="range" min="0" max="359" value={Math.round(currentHsv.hue)} onChange={(event) => updateTextColour(hsvToHex({ ...currentHsv, hue: Number(event.target.value) }))} />
                </label>
                <div className="theme-workbench__rgb-controls" role="group" aria-label={copy.text}>
                  {(["red", "green", "blue"] as const).map((channel) => <label key={channel}><span>{copy[channel]}</span><input aria-label={`${copy.text} ${copy[channel]}`} type="number" inputMode="numeric" min="0" max="255" value={currentRgb[channel]} onChange={(event) => updateRgb(channel, event.target.value)} /></label>)}
                </div>
                <div className="theme-workbench__quick-colours" role="group" aria-label={copy.quickColours}>
                  {QUICK_COLOURS.map((colour) => <button key={colour} type="button" aria-label={colour} aria-pressed={safeTextColor.toUpperCase() === colour} style={{ backgroundColor: colour }} onClick={() => updateTextColour(colour)} />)}
                </div>
              </div>}
            </div>
          </details>

          <details className="theme-workbench__section" open>
            <summary>{copy.background}</summary>
            <input ref={fileInput} className="visually-hidden" id="theme-workbench-media" type="file" accept="image/png,image/jpeg,image/webp,video/mp4" onChange={handleMedia} />
            <label className="theme-workbench__media-button" htmlFor="theme-workbench-media">{copy.chooseMedia}</label>
            {background && <p className="theme-workbench__selected-media">{copy.selectedMedia.replace("{name}", background.fileName)}</p>}
            {mediaError && <p className="theme-workbench__media-error" role="alert">{mediaError}</p>}
            <button className="theme-workbench__inline-button" type="button" disabled={backgroundSource === "theme"} onClick={() => { setBackground((current) => { if (current && current !== savedSnapshot.background) URL.revokeObjectURL(current.objectUrl); return null; }); setBackgroundSource("theme"); if (fileInput.current) fileInput.current.value = ""; setSaveState("idle"); }}>{copy.inheritMedia}</button>
            <p>{copy.mediaHint}</p>
          </details>

          <details className="theme-workbench__section" open>
            <summary>{copy.opacity}</summary>
            <div className="theme-workbench__range-title"><span>{Math.round(surfaceOpacity * 100)}%</span><span>{copy.moreOpaque}</span></div>
            <input aria-label={copy.opacity} type="range" min="0" max="100" value={Math.round(surfaceOpacity * 100)} style={{ "--workbench-opacity-progress": `${Math.round(surfaceOpacity * 100)}%` } as CSSProperties} onChange={(event) => { setSurfaceOpacity(Number(event.target.value) / 100); setSaveState("idle"); }} />
            <p>{copy.opacityHint}</p>
            {!canPersistSurfaceOpacity && <p>{copy.opacityUnavailable}</p>}
          </details>

          <div className="theme-workbench__drawer-actions">
            <p className={`theme-workbench__save-status theme-workbench__save-status--${saveState}`} role="status" aria-live="polite">{draftStatus}</p>
            <div className="theme-workbench__drawer-action-row">
              <button className="theme-workbench__back" type="button" onClick={onClose}>{copy.back}</button>
              <button className="theme-workbench__reset" type="button" disabled={!hasChanges || saveState === "saving"} onClick={reset}>{copy.reset}</button>
              <button className="theme-workbench__save" type="button" disabled={!canSave} onClick={() => void saveDraft()}>{copy.save}</button>
            </div>
            {hasLocalDraft && onRestoreOriginal && <button className="theme-workbench__restore-original" type="button" disabled={restoringOriginal || saveState === "saving"} onClick={() => void restoreOriginal()}>{restoringOriginal ? copy.restoringOriginal : copy.restoreOriginal}</button>}
          </div>
        </aside>

        {!drawerOpen && <button className="theme-workbench__open-drawer" type="button" onClick={() => setDrawerOpen(true)} aria-label={copy.openPanel} title={copy.openPanel}>›</button>}

        <main className="theme-workbench__preview-area">
          <div className="theme-workbench__preview-controls">
            <div className="theme-workbench__appearance-tabs" role="group" aria-label={copy.appearance}>
              {(["light", "dark"] as const).map((appearance) => <button key={appearance} type="button" aria-pressed={previewAppearance === appearance} onClick={() => setPreviewAppearance(appearance)}>{appearance === "light" ? copy.light : copy.dark}</button>)}
            </div>
            <div className="theme-workbench__target-tabs" role="group" aria-label={copy.target}>
            {(["mac-codex", "mac-workbuddy"] as const).map((target) => {
              const enabled = supportedPreviewTargets.includes(target);
              const name = target === "mac-codex" ? copy.codex : copy.workbuddy;
              return <button key={target} type="button" disabled={!enabled} aria-pressed={previewTarget === target} onClick={() => setPreviewTarget(target)}>{name}</button>;
            })}
            </div>
          </div>
          <div className={`codex-preview${previewTarget === "mac-workbuddy" ? " workbuddy-preview" : ""}`} style={previewStyle} data-testid="static-client-preview" data-preview-target={previewTarget} data-preview-appearance={previewAppearance}>
            {backgroundUrl && background?.mediaType === "video"
              ? <video className="codex-preview__media" src={backgroundUrl} muted autoPlay loop playsInline aria-hidden="true" />
              : backgroundUrl && <div className="codex-preview__image" style={{ backgroundImage: `url("${backgroundUrl}")` }} aria-hidden="true" />}
            {previewTarget === "mac-codex" ? <div className="codex-preview__content">
              <nav className="codex-preview__rail" aria-label="Codex sidebar preview">
                <div className="codex-preview__brand"><i />Codex</div>
                <button type="button">＋ {copy.newConversation}</button>
                <small>{copy.recent}</small>
                <a>Theme workbench</a>
                <a className="codex-preview__active">Product planning</a>
                <span className="codex-preview__rail-footer">⌘ K</span>
              </nav>
              <section className="codex-preview__main">
                <header><span>Product planning</span><button type="button">•••</button></header>
                <div className="codex-preview__conversation">
                  <div className="codex-preview__message codex-preview__message--user">{copy.task}</div>
                  <div className="codex-preview__message codex-preview__message--assistant"><i />{copy.answer}</div>
                  <pre><code>{"Milestone 1\n  └ Validate the workbench preview\nMilestone 2\n  └ Save a local draft after approval"}</code></pre>
                </div>
                <div className="codex-preview__composer"><span>{copy.composer}</span><kbd>↵</kbd></div>
              </section>
            </div> : <div className="workbuddy-preview__content">
              <header className="workbuddy-preview__header"><strong>WorkBuddy</strong><span>⌘</span><button type="button">Share</button><button type="button">•••</button></header>
              <nav className="workbuddy-preview__rail"><b>Workspace</b><a className="workbuddy-preview__active">Product planning</a><a>Research notes</a><a>Team updates</a><small>{copy.recent}</small><a>Theme workbench</a></nav>
              <section className="workbuddy-preview__main"><h2>{copy.task}</h2><p><i />{copy.answer}</p><div className="workbuddy-preview__card"><strong>Delivery focus</strong><span>Validate design direction before implementation.</span></div><div className="workbuddy-preview__composer">{copy.composer}<kbd>↵</kbd></div></section>
            </div>}
          </div>
        </main>
      </div>
    </section>
  );
}
