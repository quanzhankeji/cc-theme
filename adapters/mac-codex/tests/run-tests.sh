#!/bin/bash

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
NODE="${NODE:-/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node}"
[ -x "$NODE" ] || { printf 'Codex bundled Node.js was not found: %s\n' "$NODE" >&2; exit 1; }

while IFS= read -r file; do /bin/bash -n "$file"; done < <(
  /usr/bin/find "$ROOT" -type f \( -name '*.sh' -o -name '*.command' \) \
    ! -path '*/release/*' -print
)
while IFS= read -r file; do "$NODE" --check "$file" >/dev/null; done < <(
  /usr/bin/find "$ROOT/scripts" "$ROOT/assets" "$ROOT/tests" -type f \( -name '*.mjs' -o -name '*.js' \) -print
)

if /usr/bin/grep -R -n -E 'skin-skin|SKIN_SKIN|1\.0\.0-rc2' \
  "$ROOT/scripts" "$ROOT/assets" >/dev/null; then
  printf 'Legacy release-candidate identifiers remain in runtime files.\n' >&2
  exit 1
fi
if /usr/bin/grep -R -n -E '(writeFile|rename|copyFile|rm).*app\.asar' "$ROOT/scripts" >/dev/null; then
  printf 'A runtime script appears to mutate app.asar.\n' >&2
  exit 1
fi
if /usr/bin/grep -R -n -E '(^|[^A-Za-z0-9_])(/usr/bin/)?python3?([^A-Za-z0-9_]|$)' \
  "$ROOT/scripts" >/dev/null; then
  printf 'Packaged Mac Codex runtime still depends on external Python.\n' >&2
  exit 1
fi
RUNTIME_TEST_HOME="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/mac-codex-runtime.XXXXXX")"
cleanup_runtime_test() { /bin/rm -rf "$RUNTIME_TEST_HOME"; }
trap cleanup_runtime_test EXIT
LIMITS_OUTPUT="$(HOME="$RUNTIME_TEST_HOME" CC_THEME_NODE="$NODE" NODE="$NODE" \
  /bin/bash -c '. "$1"; printf "%s:%s:%s:%s:%s" "$MAX_IMAGE_BYTES" "$MAX_STANDARD_VIDEO_BYTES" "$MAX_VIDEO_BYTES" "$MAX_TOTAL_MEDIA_BYTES" "$MAX_PACKAGE_BYTES"' \
  _ "$ROOT/scripts/common-macos.sh")"
[ "$LIMITS_OUTPUT" = "16777216:268435456:268435456:550502400:576716800" ] || {
  printf 'Packaged Node failed to load the media limits contract: %s\n' "$LIMITS_OUTPUT" >&2
  exit 1
}
/bin/mkdir -p "$RUNTIME_TEST_HOME/Library/Application Support/CCTheme"
/bin/cat > "$RUNTIME_TEST_HOME/Library/Application Support/CCTheme/state.json" <<'JSON'
{"port":9341,"session":"paused","injectorPid":0}
JSON
STATUS_JSON="$(HOME="$RUNTIME_TEST_HOME" CC_THEME_NODE="$NODE" NODE="$NODE" \
  "$ROOT/scripts/status-skin-macos.sh" --json)"
"$NODE" -e '
  const value = JSON.parse(process.argv[1]);
  if (value.port !== 9341 || value.session !== "paused" || value.injectorAlive !== false) process.exit(1);
' "$STATUS_JSON" || {
  printf 'Packaged Node failed to read or serialize Mac Codex status.\n' >&2
  exit 1
}

if "$NODE" "$ROOT/scripts/injector.mjs" --check-payload >/dev/null 2>&1; then
  printf 'Injector accepted a theme operation without an explicit external --theme-dir.\n' >&2
  exit 1
fi
"$NODE" "$ROOT/scripts/distribution-ownership.mjs" scan-directory "$ROOT" >/dev/null
for needle in 'MAC_CODEX_ADAPTER_ID' 'MAC_CODEX_CONTRACT' 'SKIN_PACKAGE_KIND' 'integrity mismatch' 'stage-theme.mjs'; do
  /usr/bin/grep -F -- "$needle" "$ROOT/scripts/import-cc-theme.mjs" >/dev/null || {
    printf 'CC Theme import contract is missing: %s\n' "$needle" >&2
    exit 1
  }
done
retired_adapter_id='mac-''codex-skin'
legacy_adapter_key='legacyRead''AdapterIds'
plural_adapter_key='adapter''Ids'
for forbidden in "$retired_adapter_id" "$legacy_adapter_key" "$plural_adapter_key"; do
  if /usr/bin/grep -R -n -F --exclude-dir=release -- "$forbidden" "$ROOT" >/dev/null; then
    printf 'Retired public Adapter alias or compatibility entry remains: %s\n' "$forbidden" >&2
    exit 1
  fi
done
for needle in 'mac-codex' 'skin.theme' 'skin.package'; do
  /usr/bin/grep -F -- "$needle" "$ROOT/scripts/skin-theme.mjs" >/dev/null || {
    printf 'Shared skin contract identity is missing: %s\n' "$needle" >&2
    exit 1
  }
done
for release_script in "$ROOT/scripts/build-release.sh" "$ROOT/scripts/build-client-release.sh"; do
  for needle in 'SOURCE_DATE_EPOCH' 'touch -h -t' 'zip -X -q'; do
    /usr/bin/grep -F -- "$needle" "$release_script" >/dev/null || {
      printf 'Reproducible release contract is missing from %s: %s\n' "$release_script" "$needle" >&2
      exit 1
    }
  done
done
/usr/bin/grep -F -- 'OUTPUT.sha256' "$ROOT/scripts/build-client-release.sh" >/dev/null || {
  printf 'Client release SHA-256 sidecar contract is missing.\n' >&2
  exit 1
}
for needle in 'launcher-app-macos.sh' 'CC Theme.app' '--engine-root "$PROJECT_ROOT"'; do
  /usr/bin/grep -F -- "$needle" "$ROOT/scripts/install-skin-macos.sh" >/dev/null || {
    printf 'Installer launcher-app integration is missing: %s\n' "$needle" >&2
    exit 1
  }
done
INSTALL_HELP="$($ROOT/scripts/install-skin-macos.sh --help)"
for needle in 'CC Theme.app' '--no-launchers' '--no-launch'; do
  /usr/bin/grep -F -- "$needle" <<< "$INSTALL_HELP" >/dev/null || {
    printf 'Installer help is missing the launcher choice: %s\n' "$needle" >&2
    exit 1
  }
done
for needle in 'launcher-app-macos.sh' 'CC Theme.app' 'Refusing to remove an unrelated app'; do
  target="$ROOT/scripts/restore-skin-macos.sh"
  [ "$needle" != 'Refusing to remove an unrelated app' ] || target="$ROOT/scripts/launcher-app-macos.sh"
  /usr/bin/grep -F -- "$needle" "$target" >/dev/null || {
    printf 'Launcher-app uninstall safety contract is missing: %s\n' "$needle" >&2
    exit 1
  }
done
for test in "$ROOT"/tests/*.test.mjs; do
  [ -f "$test" ] || continue
  "$NODE" "$test"
done

"$NODE" - "$ROOT/assets/renderer-inject.js" "$ROOT/assets/skin.css" "$ROOT/scripts/injector.mjs" <<'NODE'
const fs = require("node:fs");
const renderer = fs.readFileSync(process.argv[2], "utf8");
const css = fs.readFileSync(process.argv[3], "utf8");
const injector = fs.readFileSync(process.argv[4], "utf8");
const fail = (message) => { console.error(message); process.exit(1); };

for (const needle of [
  "__SKIN_STYLE_REVISION_JSON__", "const ART_METADATA =", "const analyzeArt =",
  'data-skin-art-ready', 'ART.paletteMode === "media"', 'backgroundPositionExplicit',
  'const captureNativeSystemPalette =', 'const defaults = fallbackColors',
  'const semanticDefaults = { ...systemSemantic, ...adaptiveSemantic }',
  '[data-app-shell-main-content-layout]', '[data-app-shell-main-content-top-fade]',
  '[data-codex-composer-root]', '[data-home-ambient-suggestions]',
  '[data-oai-writing-block-surface]',
]) {
  if (!renderer.includes(needle)) fail(`Missing adaptive art runtime coverage: ${needle}`);
}

for (const needle of [
  '[data-app-shell-main-content-layout]', '[data-app-shell-main-content-top-fade]',
  '[data-codex-composer-root]', '[data-oai-writing-block-surface]',
]) {
  if (!css.includes(needle)) fail(`Missing Codex 26.715 surface coverage: ${needle}`);
}
if (!renderer.includes('document.querySelector("main.main-surface")') ||
    !renderer.includes('document.querySelector(".composer-surface-chrome")')) {
  fail("Latest Codex selectors must retain previous stable-class fallbacks");
}

const nativeBlock = renderer.match(/const NATIVE_THEME_VARIABLES = \[([\s\S]*?)\n  \];/)?.[1] || "";
const listed = new Set([...nativeBlock.matchAll(/"(--[^"\s]+)"/g)].map((match) => match[1]));
const assigned = new Set([...renderer.matchAll(/"(--(?:color|vscode|oai|codex)[^"\s]+)"\s*:/g)].map((match) => match[1]));
const missingCleanup = [...assigned].filter((name) => !listed.has(name));
if (missingCleanup.length) fail(`Native variables missing from cleanup registry: ${missingCleanup.join(", ")}`);

const requiredTokens = [
  "--color-token-main-surface-primary", "--color-background-surface",
  "--color-background-surface-under", "--color-background-panel",
  "--color-background-elevated-primary", "--color-background-elevated-secondary",
  "--color-background-control", "--color-background-control-opaque",
  "--color-text-foreground", "--color-text-foreground-secondary",
  "--color-background-button-primary", "--color-background-button-primary-hover",
  "--color-background-button-primary-active", "--color-background-button-secondary",
  "--color-border", "--color-border-focus", "--color-token-charts-blue",
  "--vscode-terminal-background", "--vscode-terminal-foreground", "--vscode-terminal-border",
  "--vscode-panel-background", "--vscode-panel-border", "--vscode-panelTitle-activeForeground",
  "--vscode-panelTitle-inactiveForeground", "--vscode-panelTitle-activeBorder",
  "--vscode-sash-hoverBorder",
];
for (const token of requiredTokens) {
  if (!assigned.has(token) || !listed.has(token)) fail(`Missing required settings token: ${token}`);
}
if (!renderer.includes('"--color-token-input-background": "var(--skin-surface-raised)"')) {
  fail("Generic input background must use the raised control surface");
}
if (renderer.includes('"--color-token-input-background": "var(--skin-composer-surface)"')) {
  fail("Generic input background still reuses the composer surface");
}

for (const marker of [
  "settings-shell", "settings-sidebar", "settings-nav", "settings-nav-item", "settings-content",
  "settings-search", "settings-group", "settings-row", "settings-control", "settings-switch",
  "settings-select", "settings-input", "settings-checkbox", "settings-radio",
]) {
  if (!renderer.includes(`"${marker}"`)) fail(`Missing settings marker: ${marker}`);
  if (!css.includes(`data-skin-role="${marker}"`) && marker !== "settings-control" && marker !== "settings-switch") {
    fail(`Missing settings CSS coverage: ${marker}`);
  }
}
for (const stateNeedle of [
  'settings-nav-item"]:hover', 'settings-nav-item"]:is(',
  'settings-row"]:hover', 'settings-row"]:focus-within',
  'data-skin-role^="settings-"][aria-disabled="true"]',
]) {
  if (!css.includes(stateNeedle)) fail(`Missing settings state coverage: ${stateNeedle}`);
}
if (css.includes('[role="checkbox"][aria-checked="true"],\n  [data-state="checked"]')) {
  fail("Bare checked-state styling leaks menu selection treatment into switches and their thumbs");
}
const settingsNavBase = css.match(/\[data-skin-role="settings-nav-item"\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!settingsNavBase.includes("border: 0 !important") || !settingsNavBase.includes("box-shadow: none !important")) {
  fail("Settings navigation base must not draw a rectangular highlight border");
}
for (const ownedSwitchSelector of [
  '[data-skin-role="settings-switch"] {',
  '[data-skin-role="settings-switch"] >',
  '[data-skin-role="settings-switch"]:is(',
  '[data-skin-role="settings-switch"]:focus-visible',
]) {
  if (css.includes(ownedSwitchSelector)) fail(`Skin must preserve the native Settings switch: ${ownedSwitchSelector}`);
}
if (css.includes(':where(button, [role="button"], input, textarea, select, [tabindex]):focus-visible') ||
    !css.includes('#cc-theme-video-toggle:focus-visible')) {
  fail("Skin must preserve native host focus styles and only own the playback button focus ring");
}
if (!css.includes('[data-skin-role="settings-nav-item"]:is(:focus-visible, :has(:focus-visible))')) {
  fail("Settings navigation needs shape-aware focus styling");
}
if (!css.includes(':disabled:not([data-skin-role="settings-switch"])') ||
    !css.includes('[aria-disabled="true"]:not([data-skin-role="settings-switch"])')) {
  fail("Disabled-state Skin styling must exclude native Settings switches");
}
const settingsMarkerBlock = renderer.match(/\/\/ Settings is lazy-rendered[\s\S]*?\n    if \(!shellMain/)?.[0] || "";
if (!settingsMarkerBlock) fail("Settings marker block is missing");
if (/querySelectorAll\('\[data-skin-role\^="settings-"\]'\)[\s\S]{0,240}removeAttribute\("data-skin-role"\)/.test(settingsMarkerBlock)) {
  fail("Settings markers are cleared before reconciliation, which restarts every control transition together");
}
if (settingsMarkerBlock.includes("'[data-state=\"checked\"]'") || settingsMarkerBlock.includes("'[aria-checked]'")) {
  fail("Settings control discovery includes non-interactive checked descendants");
}
if (!renderer.includes('node.getAttribute("data-skin-role") !== role')) {
  fail("Renderer role marking must be idempotent");
}
for (const marker of ["history-preview-surface", "history-preview-card"]) {
  if (!renderer.includes(`"${marker}"`) || !css.includes(`data-skin-role="${marker}"`)) {
    fail(`Missing conversation history preview coverage: ${marker}`);
  }
}
for (const needle of [
  'const isHistoryJumpButton = (button)', 'label.startsWith("Jump to user message ")',
  'label.startsWith("跳转到用户消息")', 'document.querySelectorAll(\'[role="tooltip"][data-side="right"]\')',
  'parseFloat(style.borderTopLeftRadius) >= 10',
]) {
  if (!renderer.includes(needle)) fail(`Missing semantic history preview discovery: ${needle}`);
}
const historyPreviewSurfaceCss = css.match(/\[data-skin-role="history-preview-surface"\] \{([\s\S]*?)\n\}/)?.[1] || "";
const historyPreviewCardCss = css.match(/\[data-skin-role="history-preview-card"\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!historyPreviewSurfaceCss.includes("background: transparent !important") ||
    !historyPreviewSurfaceCss.includes("box-shadow: none !important") ||
    !historyPreviewSurfaceCss.includes("backdrop-filter: none !important") ||
    !historyPreviewCardCss.includes("background: var(--skin-composer-surface) !important") ||
    !historyPreviewCardCss.includes("inset 0 0 0 .5px var(--skin-border-default)") ||
    !historyPreviewCardCss.includes("backdrop-filter: blur(var(--skin-backdrop-blur)")) {
  fail("Video history preview must use one readable rounded translucent surface instead of compounded white layers");
}
if (/\b(width|height|padding|margin|inset|position|transform|border-radius)\s*:/.test(
  `${historyPreviewSurfaceCss}\n${historyPreviewCardCss}`)) {
  fail("History preview paint treatment must not change native Portal or card geometry");
}
if (!renderer.includes('"response-waiting-indicator"') ||
    !renderer.includes('document.querySelectorAll(\'[role="status"][aria-busy="true"]\')') ||
    !renderer.includes("status.querySelector(':scope > .sr-only')") ||
    !renderer.includes("status.querySelector(':scope > [aria-hidden=\"true\"]')")) {
  fail("Missing semantic discovery for the compact ChatGPT response waiting indicator");
}
const responseWaitingCss = css.match(/\[data-skin-video="enabled"\][\s\S]*?\[data-skin-role="response-waiting-indicator"\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!responseWaitingCss.includes("background-color: transparent !important") ||
    !responseWaitingCss.includes("background-image: none !important") ||
    !responseWaitingCss.includes("border-color: transparent !important") ||
    !responseWaitingCss.includes("box-shadow: none !important") ||
    !responseWaitingCss.includes("backdrop-filter: none !important")) {
  fail("Video mode must remove only the accidental overlay paint behind the response waiting dot");
}
if (/\b(width|height|padding|margin|inset|position|transform|border-radius|animation)\s*:/.test(responseWaitingCss) ||
    /(?:^|[;\n]\s*)color\s*:/.test(responseWaitingCss)) {
  fail("Response waiting treatment must preserve the native dot geometry, color, and animation");
}
const observerBlock = renderer.match(/observer\.observe\(document\.documentElement, \{[\s\S]*?\n  \}\);/)?.[0] || "";
if (/attributeFilter:[\s\S]*"style"/.test(observerBlock)) {
  fail("Renderer observer listens to its own root style writes");
}
if (!renderer.includes("const containsResponseWaitingSignal = (node)") ||
    !renderer.includes("const responseWaitingChanged = mutations.some") ||
    !renderer.includes("settingsRouteChanged || sidePanelStateChanged || responseWaitingChanged")) {
  fail("Response waiting indicators must receive semantic paint correction before their first frame");
}
if (css.includes("0 0 0 20px")) fail("Legacy composer spread-shadow workaround remains");
const bridgeComposerCss = css.match(/html\.cc-theme\[data-skin-theme-bridge\] \.composer-surface-chrome,[\s\S]*?\n\}/)?.[0] || "";
const bridgeComposerFocusCss = css.match(/html\.cc-theme\[data-skin-theme-bridge\] \.composer-surface-chrome:focus-within \{([\s\S]*?)\n\}/)?.[1] || "";
if (!bridgeComposerCss.includes("box-shadow: none !important") ||
    !bridgeComposerFocusCss.includes("box-shadow: none !important") ||
    /\bborder(?:-radius)?\s*:/.test(bridgeComposerCss)) {
  fail("Theme bridge composer must remain shadowless at rest and while focused");
}
const bridgeNativeTypographyCss = css.match(/\/\* Theme bridge 1\.2[\s\S]*?\/\* New Task: cards-first presentation/)?.[0] || "";
if (/font-family:\s*var\(--skin-font-(?:ui|display|code)\)/.test(bridgeNativeTypographyCss)) {
  fail("Video bridge must preserve native host typography and text metrics");
}
const composerBackdropCss = css.match(/\[data-thread-scroll-footer="true"\] > \[class~="pointer-events-none"\] > \[class~="bg-gradient-to-t"\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!composerBackdropCss.includes("background-image: none !important")) {
  fail("Native thread-footer gradient still paints a large shadow around Composer");
}
const taskExecutionSummaryCss = css.match(/\[data-above-composer-portal="true"\] \[class~="backdrop-blur-sm"\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!taskExecutionSummaryCss.includes("box-shadow: none !important") ||
    !taskExecutionSummaryCss.includes("backdrop-filter: none !important")) {
  fail("Task execution summary still paints a small blurred shadow above Composer");
}
const taskExecutionGradientCss = css.match(/\[data-above-composer-portal="true"\] \[class~="pointer-events-none"\]\[class~="absolute"\]\[class~="bg-gradient-to-t"\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!taskExecutionGradientCss.includes("background-color: transparent !important") ||
    !taskExecutionGradientCss.includes("background-image: none !important")) {
  fail("Task execution portal still paints the 28px gradient between the status summary and Composer");
}
const sidebarSurfaceCss = css.match(/html\.cc-theme\[data-skin-theme-bridge\] \.app-shell-left-panel,[\s\S]*?\[data-skin-role="sidebar"\] \{([\s\S]*?)\n\}/)?.[1] || "";
const mainSurfaceCss = css.match(/html\.cc-theme\[data-skin-theme-bridge\] main\.main-surface,[\s\S]*?main\.main-surface:not\(\.skin-home-shell\) \{([\s\S]*?)\n\}/)?.[1] || "";
if (!sidebarSurfaceCss.includes("border-right: 0 !important") ||
    !sidebarSurfaceCss.includes("box-shadow: none !important") ||
    !mainSurfaceCss.includes("box-shadow: none !important") ||
    /\bborder(?:-left|-right|-top|-bottom|-radius)?\s*:/.test(mainSurfaceCss) ||
    /-10px\s+0\s+36px/.test(mainSurfaceCss)) {
  fail("Sidebar/main seam still paints the vertical black strip beside content");
}
const sidebarBackdropCss = css.match(/html\.cc-theme\[data-skin-theme-bridge\] \.app-shell-left-panel:not\(\[data-skin-role="settings-sidebar"\]\)::before \{([\s\S]*?)\n\}/)?.[1] || "";
if (!sidebarSurfaceCss.includes("background: transparent !important") ||
    !sidebarSurfaceCss.includes("backdrop-filter: none !important") ||
    !sidebarSurfaceCss.includes("isolation: isolate !important") ||
    !sidebarBackdropCss.includes("background: var(--skin-sidebar-surface) !important") ||
    !sidebarBackdropCss.includes("pointer-events: none !important") ||
    !sidebarBackdropCss.includes("backdrop-filter: blur(var(--skin-backdrop-blur))")) {
  fail("Sidebar surface/backdrop is not isolated from its overflow-visible resize handle");
}
const threadScrollCss = css.match(/html\.cc-theme\[data-skin-theme-bridge\] main\.main-surface \.thread-scroll-container \{([\s\S]*?)\n\}/)?.[1] || "";
if (threadScrollCss.includes("scrollbar-gutter")) {
  fail("Theme bridge must not rewrite Codex's native thread scrollbar gutter");
}

for (const needle of [
  "__SKIN_HERO_ART_JSON__", 'root.style.setProperty("--skin-hero-art"',
  '"--skin-art", "--skin-hero-art", ...THEME_VARIABLES', 'restoreRootStyleSnapshot', '"home-hero"',
]) {
  if (!renderer.includes(needle)) fail(`Missing New Task Hero runtime coverage: ${needle}`);
}
if (!renderer.includes('const customHomeLayout = Boolean(home) && !videoEnabled') ||
    !renderer.includes('shellMain.classList.toggle("skin-home-shell", customHomeLayout)') ||
    !renderer.includes('const styledHome = home')) {
  fail("Video themes must preserve the native New Chat / Work layout geometry");
}
if (!renderer.includes('const SURFACE_CONTEXT_ATTR = "data-skin-surface-context"') ||
    !renderer.includes('let surfaceContext = home ? "home" : "task"') ||
    !renderer.includes('surfaceContext = "library"') ||
    !renderer.includes('surfaceContext = "settings"') ||
    !renderer.includes('removeAttribute(SURFACE_CONTEXT_ATTR)')) {
  fail("Semantic surface context must distinguish Home, task, library and Settings and restore cleanly");
}
for (const needle of [
  "document.querySelector('[role=\"main\"].skin-home') ?? homeRoute",
  "const nativeHeading = homeIndicator?.parentElement",
  "const nativeCardButtons = home ? [...home.querySelectorAll('button')].filter",
  "const adjacentReferenceButton = adjacentReferenceWrapper?.querySelector('button:not([data-skin-owned])')",
  "(markers.shell && markers.sidebar && (markers.composer || markers.main)) || markers.settings",
  "const primarySurfacePass = Boolean(result.settingsShell?.visible)",
  "const videoControlPass = !result.videoTogglePresent",
]) {
  if (!injector.includes(needle)) fail(`Live verification fallback is missing: ${needle}`);
}
if (renderer.includes('"--codex-corner-radius-scale":') ||
    !renderer.includes('for (const name of ["--codex-corner-radius-scale"])')) {
  fail("Skin must not resize native control radii through Codex layout tokens");
}
for (const marker of ["home-heading", "home-suggestions", "home-suggestion-card", "home-suggestion-icon"]) {
  if (!renderer.includes(`"${marker}"`)) fail(`Missing cards-first New Task marker: ${marker}`);
  if (!css.includes(`data-skin-role="${marker}"`)) fail(`Missing cards-first New Task CSS: ${marker}`);
}
if (!renderer.includes('data-skin-home-layout') || !renderer.includes('removeAttribute(HOME_LAYOUT_ATTR)')) {
  fail("Renderer must apply and clean up the validated New Task layout mode");
}
for (const stateNeedle of [
  '[data-skin-home-layout="cards"]',
  '[data-skin-role="home-suggestion-card"]:hover',
  '[data-skin-role="home-suggestion-card"]:active',
  '[data-skin-role="home-suggestion-card"]:focus-visible',
  '[data-skin-role="home-suggestion-card"]:disabled',
]) {
  if (!css.includes(stateNeedle)) fail(`Missing cards-first New Task state coverage: ${stateNeedle}`);
}
if (!css.includes('data-skin-role="home-hero"')) fail("Missing stable New Task Hero CSS marker");
if (!css.includes("var(--skin-hero-art, var(--skin-active-art, var(--skin-art)))")) {
  fail("New Task Hero must fall back through the video-aware active artwork variable");
}
if (renderer.includes('setProperty("--skin-name"') ||
    renderer.includes('setProperty("--skin-tagline"') ||
    css.includes('content: var(--skin-name') ||
    css.includes('content: var(--skin-tagline')) {
  fail("New Task must not render theme name or tagline around the native heading");
}
if (!renderer.includes('removeProperty("--skin-name")') ||
    !renderer.includes('removeProperty("--skin-tagline")')) {
  fail("Hot reapply must clear legacy New Task theme-copy variables");
}

for (const needle of [
  "__SKIN_VIDEO_JSON__", 'const VIDEO_LAYER_ID = "cc-theme-video-layer"',
  'const VIDEO_TOGGLE_WRAPPER_ID = "cc-theme-video-toggle-wrapper"',
  'const VIDEO_TOGGLE_ID = "cc-theme-video-toggle"',
  'const VIDEO_PLAYBACK_ATTR = "data-skin-video-playback"',
  'window.matchMedia("(prefers-reduced-motion: reduce)")',
  '"Toggle pinned summary", "Toggle summary"', "row.insertBefore(ownedVideoToggleWrapper, summaryActionWrapper)",
  'const SUMMARY_TOGGLE_LABELS = new Set', 'const SIDE_PANEL_TOGGLE_LABELS = new Set',
  'data-testid="app-shell-header-context-menu-surface"', 'classList.contains("gap-1.5")',
  'anchorKind: "header-actions-fallback"', 'ownedVideoToggleWrapper.dataset.skinAnchorKind = anchorKind',
  'const headerShell = headerSurface?.closest("header")', 'anchorKind: "header-trailing-actions"',
  'anchorKind: "summary-actions"', 'anchorKind: "header-content-actions"',
  'const sidePanelOpen = sidePanelButton?.getAttribute("aria-pressed") === "true"',
  'const anchorContainer = ["summary-actions", "header-content-actions", "header-trailing-actions"].includes(anchorKind)',
  '["summary-actions", "header-content-actions", "header-trailing-actions"].includes(anchorKind)',
  '"Toggle bottom panel", "切换底部面板"', 'const bottomPanelButton = headerShell',
  'const retainedActionButton = ownedVideoToggleAnchor?.querySelector', 'ownedVideoToggleAnchor?.isConnected',
  'headerShell?.contains(ownedVideoToggleAnchor)', 'rect.x >= headerSurfaceRect.right - 1',
  'BOTTOM_PANEL_TOGGLE_LABELS.has(button.getAttribute("aria-label"))', 'bottomPanelWrapper?.parentElement',
  'findLast((node, index)', 'data-skin-video-control-anchor',
  'button[aria-pressed]:not([data-skin-owned])', 'document.createElementNS("http://www.w3.org/2000/svg", "svg")',
  "video.muted = true", "video.loop = true", "video.playsInline = true",
  'video.setAttribute("data-skin-owned", "background-video")',
  'ownedVideoToggle.setAttribute("data-skin-owned", "background-media-control")',
  'const DEFERRED_VIDEO_SOURCE = "cc-theme:deferred-video"',
  'setDeferredVideoSource',
  'videoPlaybackPreference = "disabled"', 'videoPlaybackPreference = "playing"',
  'layer.setAttribute("hidden", "")', 'layer.removeAttribute("hidden")',
  "previous?.videoArtUrl", "URL.revokeObjectURL(state.videoArtUrl)",
  'document.removeEventListener("visibilitychange", state.visibilityHandler)',
]) {
  if (!renderer.includes(needle)) fail(`Missing owned MP4 background lifecycle coverage: ${needle}`);
}
for (const selector of [
  "#cc-theme-video-layer", "#cc-theme-video-layer video",
  "#cc-theme-video-toggle-wrapper", "#cc-theme-video-toggle",
]) {
  if (!css.includes(selector)) fail(`Missing MP4 background CSS coverage: ${selector}`);
}
const videoToggleBaseCss = css.match(/#cc-theme-video-toggle \{([\s\S]*?)\n\}/)?.[1] || "";
if (/\bcolor\s*:|\bbackground\s*:|\bborder(?:-color)?\s*:/.test(videoToggleBaseCss) ||
    css.includes("#cc-theme-video-toggle:hover {") ||
    css.includes("#cc-theme-video-toggle:active {")) {
  fail("The playback button must inherit the adjacent native action colors and interaction styling");
}
const trailingToggleCss = css.match(/#cc-theme-video-toggle-wrapper\[data-skin-anchor-kind="header-trailing-actions"\],\n#cc-theme-video-toggle-wrapper\[data-skin-anchor-kind="header-content-actions"\],\n#cc-theme-video-toggle-wrapper\[data-skin-anchor-kind="summary-actions"\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!trailingToggleCss.includes("position: absolute") ||
    !trailingToggleCss.includes("right: calc(100% + 6px)") ||
    !trailingToggleCss.includes("top: 50%")) {
  fail("The playback action must sit left of, not expand, fixed native header action groups");
}
if (!css.includes('[data-skin-video-control-anchor="header-trailing-actions"]') ||
    !css.includes('[data-skin-video-control-anchor="header-content-actions"]') ||
    !css.includes('[data-skin-video-control-anchor="summary-actions"]') ||
    !renderer.includes('summaryActionWrapper.setAttribute(VIDEO_TOGGLE_ANCHOR_ATTR, anchorKind)') ||
    !renderer.includes('summaryActionWrapper.insertBefore(ownedVideoToggleWrapper, summaryActionWrapper.firstElementChild)') ||
    renderer.includes('anchorKind: "mode-switch"')) {
  fail("The playback action must follow beside the native summary row without covering it, expanding it, or using the Chat / Work switch");
}
if (!renderer.includes('mutation.attributeName === "aria-pressed"') ||
    !renderer.includes('SIDE_PANEL_TOGGLE_LABELS.has(mutation.target.getAttribute("aria-label"))') ||
    !renderer.includes('"data-color-mode", "aria-pressed"')) {
  fail("Side Panel state changes must re-anchor the playback control immediately");
}
const videoLayerCss = css.match(/#cc-theme-video-layer \{([\s\S]*?)\n\}/)?.[1] || "";
const videoElementCss = css.match(/#cc-theme-video-layer video \{([\s\S]*?)\n\}/)?.[1] || "";
const videoScrimCss = css.match(/#cc-theme-video-layer::after \{([\s\S]*?)\n\}/)?.[1] || "";
if (!videoLayerCss.includes("pointer-events: none") || !videoElementCss.includes("pointer-events: none")) {
  fail("The owned video background and media element must be click-through");
}
if (!videoLayerCss.includes("inset: 0") || videoLayerCss.includes("border-radius: var(")) {
  fail("The MP4 background must cover the full viewport without the main-panel crop");
}
if (!videoScrimCss.includes("--skin-video-scrim-color") ||
    !videoScrimCss.includes("--skin-video-scrim-opacity") ||
    !videoScrimCss.includes("pointer-events: none") ||
    !renderer.includes('"--skin-video-scrim-color": shell === "light" ? "#ffffff" : "#000000"') ||
    !renderer.includes('const VIDEO_SCRIM_OPACITY = Math.min(0.8, Math.max(0,') ||
    !renderer.includes('"--skin-video-scrim-opacity": String(VIDEO_SCRIM_OPACITY)')) {
  fail("Video readability scrim must be bounded by the theme contract, system-aware, and click-through");
}
if (!css.includes('#cc-theme-video-layer[hidden]') ||
    !css.includes('#cc-theme-chrome[hidden]') ||
    css.includes('--skin-disabled-canvas') ||
    css.includes('[data-skin-video="disabled"] [data-skin-role="settings-content"]')) {
  fail("Disabled media mode must hide owned visuals without repainting native application surfaces");
}
const disabledNativeDropdownCss = css.match(/html\[data-skin-video="disabled"\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!disabledNativeDropdownCss.includes("--color-token-dropdown-background") ||
    !disabledNativeDropdownCss.includes("--color-background-elevated-primary-opaque") ||
    !disabledNativeDropdownCss.includes("--color-token-main-surface-primary") ||
    /\b(background|color|opacity|backdrop-filter|box-shadow|width|height|padding|margin|inset|transform)\s*:/.test(
      disabledNativeDropdownCss.replace(/--color-token-dropdown-background\s*:/, ""))) {
  fail("Disabled media mode must bridge only Codex's missing native dropdown token without styling the popup");
}
if (!renderer.includes('const VIDEO_POSTER_MODE = THEME.appearance?.backgroundVideoPosterMode === "image" ? "image" : "none"') ||
    !renderer.includes('if (VIDEO_POSTER_MODE === "image") video.poster = artUrl') ||
    renderer.includes('\n      video.poster = artUrl;') ||
    !renderer.includes('video.preload = VIDEO_POSTER_MODE === "image" ? "metadata" : "auto"') ||
    !renderer.includes('video.autoplay = !motionMediaQuery.matches')) {
  fail("MP4 background must default to video-only first paint and permit the static poster only by explicit setting");
}
if (!renderer.includes('root.style.setProperty("--skin-active-art", staticArtworkEnabled') ||
    !renderer.includes('const staticArtworkEnabled = !videoEnabled || VIDEO_POSTER_MODE === "image"')) {
  fail("Video-only mode must disable every shared static-art paint variable");
}
if (!renderer.includes('root.setAttribute(VIDEO_POSTER_ATTR, VIDEO_POSTER_MODE)') ||
    !renderer.includes('root?.removeAttribute(VIDEO_POSTER_ATTR)')) {
  fail("Video poster mode must be observable and cleanup-safe");
}
if (!renderer.includes('let videoPlaybackPreference = previousVideoPlaybackPreference') ||
    !renderer.includes('let videoMotionOverride = previousVideoMotionOverride') ||
    !renderer.includes('const reduced = motionMediaQuery.matches && !videoMotionOverride') ||
    !renderer.includes('const shouldPlay = !document.hidden && videoPlaybackPreference === "playing" && !reduced') ||
    !renderer.includes('video.dataset.skinPlaybackState = "disabled"') ||
    !renderer.includes('restoreNativeAppearance') ||
    !renderer.includes('restoreRootStyleSnapshot') ||
    !renderer.includes('root.classList.remove("cc-theme")') ||
    !renderer.includes('state.skinAppearanceActive = videoPlaybackPreference !== "disabled"')) {
  fail("MP4 background must pause while hidden, avoid Reduced Motion autoplay, and permit only an explicit user play override");
}
if (!/if \(videoEnabled && videoPlaybackPreference === "disabled"\) \{\s*restoreNativeAppearance\(\);\s*ensureVideoLayer\(\);\s*ensureThemeSettingsPage\(\);\s*return;\s*\}/.test(renderer) ||
    !renderer.includes('const cycleBackgroundPresentation = () =>') ||
    !renderer.includes('videoPlaybackPreference = "disabled"') ||
    !renderer.includes('persistVideoPlaybackPreference();\n    ensure();') ||
    !renderer.includes('effectButton.addEventListener("click", cycleBackgroundPresentation)') ||
    !renderer.includes('toggleStyleEditor();')) {
  fail("The disabled control state must fully bypass Theme appearance, keep the dedicated Theme settings page available, and restore it on the next click");
}
const videoLifecycleBlock = renderer.match(/const ensureVideoLayer = \([\s\S]*?\n  const ensure = \(\) =>/)?.[0] || "";
if (!videoLifecycleBlock || /!shellMain/.test(videoLifecycleBlock) ||
    renderer.includes("ensureVideoLayer(null)")) {
  fail("Route transitions must not dispose the owned video merely because main.main-surface is absent");
}
if (!videoLifecycleBlock.includes("layer.parentElement !== document.body") ||
    !videoLifecycleBlock.includes("document.body.appendChild(layer)")) {
  fail("The single persistent video layer must remain a direct child of body on every route");
}
const bridgeSidebarCss = css.match(/html\.cc-theme\[data-skin-theme-bridge\] \.app-shell-left-panel,[\s\S]*?\n\}/)?.[0] || "";
if (!bridgeSidebarCss.includes("border-radius: 0 !important")) {
  fail("The fixed Sidebar must meet the window edge without a bottom-right cutout");
}
const lightSelectionCss = css.match(/html\.cc-theme\[data-skin-shell="light"\] \.app-shell-left-panel \[class~="bg-token-list-hover-background"\],[\s\S]*?\n\}/)?.[0] || "";
if (!lightSelectionCss.includes("var(--skin-selected-surface)") ||
    lightSelectionCss.includes("217, 72, 86")) {
  fail("Light Sidebar selection must use the system semantic highlight instead of the legacy red tint");
}
const shellMainGuardIndex = renderer.indexOf("if (!shellMain || !document.body)");
const routeVideoEnsureIndex = renderer.indexOf("ensureVideoLayer();", renderer.indexOf("const ensure = () =>"));
if (routeVideoEnsureIndex < 0 || shellMainGuardIndex < 0 || routeVideoEnsureIndex > shellMainGuardIndex) {
  fail("The video layer must be ensured before a Settings-route early return");
}
if (!renderer.includes("const containsSettingsRouteSignal = (node)") ||
    !renderer.includes("[...mutation.addedNodes, ...mutation.removedNodes].some(containsSettingsRouteSignal)") ||
    !renderer.includes("const settingsRouteChanged = mutations.some") ||
    !renderer.includes("if (settingsRouteChanged || sidePanelStateChanged || responseWaitingChanged) {") ||
    !renderer.includes("      ensure();\n      return;")) {
  fail("Settings route commits must receive semantic styling before paint instead of waiting for the general debounce");
}
if (!renderer.includes('const APP_MOUNT_ATTR = "data-skin-app-mount"') ||
    !renderer.includes("ownedAppMount.setAttribute(APP_MOUNT_ATTR, VERSION)") ||
    !renderer.includes("ownedAppMount?.removeAttribute(APP_MOUNT_ATTR)")) {
  fail("The direct app mount needs an owned, cleanup-safe stacking marker across app routes");
}
if (!css.includes('body > [data-skin-app-mount]') ||
    !css.includes('body {\n  background: var(--skin-bg) !important;')) {
  fail("Video mode must raise the direct app mount and remove the duplicate static body artwork");
}
if (!css.includes('body > [data-skin-app-mount] > div') ||
    !css.includes('[data-skin-theme-bridge][data-skin-shell="light"]')) {
  fail("System light/dark media mode must clear opaque app-mount wrappers");
}
const rawArtPaintLines = css.split("\n").filter((line) =>
  line.includes("var(--skin-art)") && !line.includes("--skin-active-art"));
if (!css.includes("--skin-active-art") || rawArtPaintLines.length) {
  fail("Static artwork paint sites must consume the video-aware active-art variable");
}
const settingsSidebarCss = css.match(/\[data-skin-role="settings-sidebar"\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!settingsSidebarCss.includes("var(--skin-sidebar-surface)") ||
    settingsSidebarCss.includes("--skin-active-art") ||
    settingsSidebarCss.includes("--skin-art") ||
    !settingsSidebarCss.includes("border-right: 0 !important") ||
    !settingsSidebarCss.includes("box-shadow: none !important")) {
  fail("Settings sidebar must use one semantic surface above the single window artwork without repainting or edge shadow");
}
const movingHomeCardCss = css.match(/:is\(\[data-skin-video="enabled"\], \[data-skin-background-mode\]\)\n\[data-skin-role="home-suggestion-card"\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!movingHomeCardCss.includes("var(--skin-surface-raised)") ||
    /\b(width|height|padding|margin|inset|border-radius|position|transform)\s*:/.test(movingHomeCardCss)) {
  fail("Moving-background Home cards may change paint only and must preserve native layout geometry");
}
if (!css.includes('[data-skin-surface-context="home"] main.main-surface') ||
    !css.includes('[data-skin-surface-context="task"]') ||
    !css.includes('color-mix(in srgb, var(--skin-main-scrim-start) 72%, transparent)')) {
  fail("Home and task routes must use separate paint-only scrim strengths");
}
const videoSettingsSidebarCss = css.match(/:is\(\[data-skin-video="enabled"\], \[data-skin-background-mode\]\) \[data-skin-role="settings-sidebar"\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!videoSettingsSidebarCss.includes("background-image: none !important") ||
    !videoSettingsSidebarCss.includes("color-mix(in srgb, var(--skin-sidebar-surface) 52%, transparent)") ||
    !videoSettingsSidebarCss.includes("border-right: 0 !important") ||
    !videoSettingsSidebarCss.includes("box-shadow: none !important") ||
    !videoSettingsSidebarCss.includes("text-shadow: none !important")) {
  fail("Settings video mode must reveal the persistent video without boundary or inherited text shadows");
}
for (const marker of ["library-shell", "library-search-header", "library-search", "library-search-input"]) {
  if (!renderer.includes(`"${marker}"`) || !css.includes(`data-skin-role="${marker}"`)) {
    fail(`Missing video library route coverage: ${marker}`);
  }
}
if (!renderer.includes('data-skin-library-route') ||
    !renderer.includes('"sites"') || !renderer.includes('"scheduled"') || !renderer.includes('"plugins"')) {
  fail("Sites, Scheduled and Plugins must receive explicit runtime route markers");
}
const libraryShellCss = css.match(/:is\(\[data-skin-video="enabled"\], \[data-skin-background-mode\]\) \[data-skin-role="library-shell"\] \{([\s\S]*?)\n\}/)?.[1] || "";
const librarySearchHeaderCss = css.match(/:is\(\[data-skin-video="enabled"\], \[data-skin-background-mode\]\) \[data-skin-role="library-search-header"\],([\s\S]*?)\n\}/)?.[1] || "";
const librarySearchCss = css.match(/:is\(\[data-skin-video="enabled"\], \[data-skin-background-mode\]\) \[data-skin-role="library-search"\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!libraryShellCss.includes("background-color: transparent !important") ||
    !libraryShellCss.includes("box-shadow: none !important") ||
    !librarySearchHeaderCss.includes("background-color: transparent !important") ||
    !librarySearchCss.includes("var(--skin-composer-surface)") ||
    /\b(width|height|padding|margin|inset|border-radius|transform)\s*:/.test(`${libraryShellCss}\n${librarySearchHeaderCss}\n${librarySearchCss}`)) {
  fail("Video library routes may only change paint and must share the Composer reading surface");
}
const videoSettingsBoundaryCss = css.match(/:is\(\[data-skin-video="enabled"\], \[data-skin-background-mode\]\)\[data-skin-route="settings"\][\s\S]*?\[data-skin-role="settings-sidebar"\]::after \{([\s\S]*?)\n\}/)?.[1] || "";
if (!videoSettingsBoundaryCss.includes('content: none !important') ||
    !videoSettingsBoundaryCss.includes('display: none !important') ||
    !videoSettingsBoundaryCss.includes('background: none !important') ||
    !videoSettingsBoundaryCss.includes('box-shadow: none !important') ||
    /\b(width|height|margin|inset|left|right|transform)\s*:/.test(videoSettingsBoundaryCss)) {
  fail("Settings video mode must suppress only the semantic Sidebar's protruding paint layer without changing layout");
}
const videoSettingsShellCss = css.match(/:is\(\[data-skin-video="enabled"\], \[data-skin-background-mode\]\) \[data-skin-role="settings-shell"\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!videoSettingsShellCss.includes("background: transparent !important")) {
  fail("Settings video mode must not hide the persistent video behind an opaque route shell");
}
const videoSettingsContentCss = css.match(/:is\(\[data-skin-video="enabled"\], \[data-skin-background-mode\]\) \[data-skin-role="settings-content"\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!videoSettingsContentCss.includes("color-mix(in srgb, var(--skin-surface-base) 46%, transparent)") ||
    !videoSettingsContentCss.includes("border-left: 0 !important") ||
    !videoSettingsContentCss.includes("box-shadow: none !important") ||
    !videoSettingsContentCss.includes("scrollbar-color: var(--skin-border-default) transparent")) {
  fail("Settings video mode must reveal the root video across the content column without a boundary shadow");
}
const browserPortalCss = css.match(/body > \[data-browser-sidebar-webview-host-root\] \{([\s\S]*?)\n\}/)?.[1] || "";
if (!browserPortalCss.includes("z-index: 2 !important")) {
  fail("The native Browser webview portal must paint above the raised app mount");
}
if (!renderer.includes("ownedVideoToggleWrapper.className !== summaryActionWrapper.className") ||
    !renderer.includes("ownedVideoToggle.className !== pinnedSummaryButton.className")) {
  fail("Owned toolbar class mirroring must be idempotent under the class MutationObserver");
}

for (const selector of [
  '[data-app-shell-focus-area="bottom-panel"]',
  '[data-app-shell-tabs="true"]',
  '[data-app-shell-tab-strip-controller="bottom"]',
  '[data-app-shell-tab-panel-controller="bottom"]',
  '[data-codex-terminal][data-codex-xterm]',
  "[id^='terminal-panel-']",
]) {
  if (!renderer.includes(selector)) fail(`Missing stable bottom panel selector: ${selector}`);
}
for (const marker of [
  "bottom-panel-shell", "bottom-panel-surface", "bottom-panel-header", "bottom-panel-tablist",
  "bottom-panel-tab", "bottom-panel-body", "bottom-panel-terminal-shell",
  "bottom-panel-terminal-padding", "bottom-panel-terminal", "bottom-panel-terminal-viewport",
  "bottom-panel-terminal-screen", "bottom-panel-sash",
]) {
  if (!renderer.includes(`"${marker}"`)) fail(`Missing bottom panel marker: ${marker}`);
  if (!css.includes(`data-skin-role="${marker}"`)) fail(`Missing bottom panel CSS coverage: ${marker}`);
}
if (!css.includes('data-skin-role="bottom-panel-terminal-shell"')) {
  fail("Terminal host white-gap regression coverage is missing");
}
if (!css.includes('[data-codex-terminal][data-codex-xterm]')) {
  fail("Stable terminal host must be styled before delayed markers are attached");
}
for (const selector of [
  '[data-app-shell-focus-area="bottom-panel"]',
  '[data-app-shell-tabs="true"]',
  '[data-app-shell-tab-strip-controller="bottom"]',
  '[data-app-shell-tab-panel-controller="bottom"]',
]) {
  if (!css.includes(selector)) fail(`Missing first-paint bottom panel CSS selector: ${selector}`);
}
for (const variable of [
  "--vscode-terminal-background", "--vscode-terminal-foreground", "--vscode-terminalCursor-foreground",
  "--vscode-terminal-selectionBackground", "--vscode-terminal-ansiBlack",
  "--vscode-terminal-ansiBrightWhite", "--vscode-terminalCommandDecoration-errorBackground",
]) {
  if (!css.includes(`${variable}:`)) fail(`Missing nested terminal host variable: ${variable}`);
}
if (!css.includes("--vscode-terminal-tab\\.activeBorder:")) {
  fail("Dotted terminal tab custom property must be CSS-escaped");
}
if (css.includes('[data-skin-role="bottom-panel-terminal-padding"] {\n  padding-bottom: 0')) {
  fail("Bottom panel fix must preserve native terminal padding");
}
const videoBottomPanelCss = css.match(/\/\* Playing and paused video states[\s\S]*?\[data-skin-role="bottom-panel-terminal-screen"\]/)?.[0] || "";
if (!videoBottomPanelCss.includes('[data-skin-video="enabled"]') ||
    !videoBottomPanelCss.includes('[data-skin-background-mode]') ||
    !videoBottomPanelCss.includes('color-mix(in srgb, var(--skin-surface-base) 56%, transparent)') ||
    !videoBottomPanelCss.includes('color-mix(in srgb, var(--skin-surface-code) 64%, transparent)') ||
    !videoBottomPanelCss.includes('--vscode-terminal-background: transparent !important') ||
    !videoBottomPanelCss.includes('scrollbar-color: var(--skin-border-default) transparent !important')) {
  fail("Playing and paused video modes must flatten Bottom Panel layers into a readable translucent surface");
}
if (/\[data-skin-video="disabled"\][\s\S]{0,400}bottom-panel/.test(css)) {
  fail("Disabled video mode must leave Bottom Panel paint on the restored native path");
}
NODE

"$NODE" - "$ROOT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
for (const file of fs.readdirSync(root, { recursive: true })) {
  if (!file.endsWith(".json") || file.startsWith("release/")) continue;
  read(file);
}
const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
const projectManifest = read("PROJECT_MANIFEST.json");
const packageManifest = read("package.json");
const capability = read("contracts/adapter-capability.json");
const releaseManifest = read("contracts/adapter-release-manifest.json");
const packageContract = read("contracts/cc-theme-package.json");
const releaseRevision = releaseManifest.adapterReleaseRevision;
const assetIdentity = `mac-codex-${version}-r${releaseRevision}-macos-arm64`;
const sourceArtifact = `${assetIdentity}.zip`;
const clientArtifact = `cc-theme-${assetIdentity}.zip`;
if (!/^\d+(?:\.\d+){2}$/.test(version) || !Number.isSafeInteger(releaseRevision) || releaseRevision < 1 ||
    packageManifest.version !== version || packageManifest.ccThemeAdapter?.adapterVersion !== version ||
    packageManifest.ccThemeAdapter?.adapterReleaseRevision !== releaseRevision ||
    packageManifest.ccThemeAdapter?.assetIdentity !== assetIdentity ||
    projectManifest.productVersion !== version || projectManifest.adapterVersion !== version ||
    projectManifest.adapterReleaseRevision !== releaseRevision || projectManifest.client?.supportedShortVersion !== version ||
    projectManifest.releaseTarget?.assetIdentity !== assetIdentity ||
    projectManifest.releaseTarget?.sourceArtifact !== sourceArtifact ||
    projectManifest.releaseTarget?.clientArtifact !== clientArtifact ||
    capability.adapterVersion !== version || capability.adapterReleaseRevision !== releaseRevision ||
    capability.releaseTarget?.assetIdentity !== assetIdentity ||
    releaseManifest.adapterVersion !== version || releaseManifest.assetIdentity !== assetIdentity ||
    releaseManifest.artifacts?.source !== sourceArtifact || releaseManifest.artifacts?.client !== clientArtifact ||
    packageContract.target?.adapterId !== "mac-codex" || packageContract.target?.version !== version) {
  throw new Error("Repository versions disagree");
}
const uiEvidenceCatalog = read(projectManifest.contracts.uiEvidenceCatalog);
if (projectManifest.client.versionPolicy !== "always-latest" ||
    projectManifest.securityBoundary.blocksByClientVersion !== false ||
    projectManifest.securityBoundary.requiresCurrentSurfaceEvidence !== true ||
    capability.compatibility?.currentEvidence?.clientVersion !== version ||
    capability.compatibility?.currentEvidence?.clientBuild !== "5628" ||
    capability.compatibility?.currentEvidence?.surfaceCatalogVersion !== 1 ||
    uiEvidenceCatalog.client?.version !== version ||
    uiEvidenceCatalog.client?.build !== "5628" ||
    uiEvidenceCatalog.admission?.status !== "verified" ||
    uiEvidenceCatalog.admission?.failClosed !== true ||
    uiEvidenceCatalog.bundleEvidence.stableSelectorCounts?.["data-settings-panel-slug"] < 1 ||
    uiEvidenceCatalog.bundleEvidence.stableSelectorCounts?.["data-codex-composer-root"] < 1) {
  throw new Error("Always-latest runtime policy or current UI evidence admission is inconsistent");
}
NODE

if /usr/bin/find "$ROOT" -type d -name .git -print -quit | /usr/bin/grep -q .; then
  printf 'Legacy Git metadata is present in the clean repository.\n' >&2
  exit 1
fi
if /usr/bin/find "$ROOT" -type l -print -quit | /usr/bin/grep -q .; then
  printf 'Symlinks are not allowed in the clean source package.\n' >&2
  exit 1
fi
if /usr/bin/find "$ROOT" -type f \( -name '.DS_Store' -o -name '._*' -o -name '*.docx' \) \
  ! -path '*/release/*' -print -quit | /usr/bin/grep -q .; then
  printf 'Generated or macOS metadata remains in the clean repository.\n' >&2
  exit 1
fi
private_pattern='jay''zhou|周''杰伦|test''\.mp4|/Users/''felix|/Volumes/''本地磁盘'
if /usr/bin/grep -R -n -E --exclude-dir=release "$private_pattern" "$ROOT" >/dev/null; then
  printf 'Private media names or one-time absolute paths remain in the clean repository.\n' >&2
  exit 1
fi
if [ -e "$ROOT/menubar" ] || [ -e "$ROOT/scripts/install-menubar-macos.sh" ] || \
   [ -e "$ROOT/scripts/apply-from-menubar-macos.sh" ]; then
  printf 'Menu-bar or tray implementation remains in the macOS-only repository.\n' >&2
  exit 1
fi

printf 'PASS: clean Adapter repository, external package validation, native fallback, runtime overrides, semantic UI, lifecycle, and theme-free release ownership.\n'
