#!/bin/bash

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
NODE_RUNTIME="${NODE:-$(command -v node 2>/dev/null || true)}"
[ -x "$NODE_RUNTIME" ] || { printf 'Node.js was not found.\n' >&2; exit 1; }
TEMPORARY="$(/usr/bin/mktemp -d /tmp/mac-workbuddy-tests.XXXXXX)"
trap '/usr/bin/find "$TEMPORARY" -depth -delete 2>/dev/null || true' EXIT

while IFS= read -r file; do /bin/bash -n "$file"; done < <(
  /usr/bin/find "$ROOT" -type f \( -name '*.sh' -o -name '*.command' \) ! -path '*/release/*' -print
)
while IFS= read -r file; do "$NODE_RUNTIME" --check "$file" >/dev/null; done < <(
  /usr/bin/find "$ROOT/scripts" "$ROOT/assets" "$ROOT/tests" -type f \( -name '*.mjs' -o -name '*.js' \) -print
)

if /usr/bin/grep -R -n -E '(writeFile|rename|copyFile|rm).*app\.asar' "$ROOT/scripts" >/dev/null; then
  printf 'A runtime script appears to mutate app.asar.\n' >&2
  exit 1
fi
for needle in 'INSTALL_OWNER_MARKER' 'validate_install_destination' 'install_root_is_owned'; do
  /usr/bin/grep -F -- "$needle" "$ROOT/scripts/common-macos.sh" "$ROOT/scripts/install-skin-macos.sh" "$ROOT/scripts/uninstall-skin-macos.sh" >/dev/null || {
    printf 'Safe install ownership coverage is missing: %s\n' "$needle" >&2
    exit 1
  }
done
/usr/bin/grep -F -- '--remote-debugging-address=127.0.0.1' "$ROOT/scripts/common-macos.sh" >/dev/null || {
  printf 'WorkBuddy CDP must bind explicitly to the loopback address.\n' >&2
  exit 1
}
if /usr/bin/grep -F -- '--remote-allow-origins=*' "$ROOT/scripts/common-macos.sh" >/dev/null; then
  printf 'WorkBuddy CDP must not allow arbitrary WebSocket origins.\n' >&2
  exit 1
fi
if /usr/bin/find "$ROOT/assets" "$ROOT/scripts" -type f ! -name 'import-cc-theme.mjs' -print0 | /usr/bin/xargs -0 /usr/bin/grep -n -E '(pet|mascot|companion|宠物)' >/dev/null; then
  printf 'A pet/companion implementation leaked into the WorkBuddy adapter.\n' >&2
  exit 1
fi
if /usr/bin/grep -R -n -E '\._[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9]+_[0-9]+' \
  "$ROOT/assets/skin.css" "$ROOT/assets/renderer-inject.js" >/dev/null; then
  printf 'A generated Vite/CSS-module class leaked into the runtime selector contract.\n' >&2
  exit 1
fi
for selector in \
  'data-view-id="sidebar"' \
  'data-view-id="main-content"' \
  '.teams-container' \
  '.workbuddy-topbar' \
  '.wb-home-composer' \
  '.detail-panel-container'; do
  /usr/bin/grep -F -- "$selector" "$ROOT/assets/renderer-inject.js" "$ROOT/assets/skin.css" >/dev/null || {
    printf 'Stable WorkBuddy selector coverage is missing: %s\n' "$selector" >&2
    exit 1
  }
done
for needle in \
  'WORKBUDDY_REMOTE_DEBUGGING_PORT' \
  'com.workbuddy.workbuddy' \
  'Page.addScriptToEvaluateOnNewDocument' \
  'composer-main-area' \
  'workbuddy-skin-background-art' \
  'stage-theme.mjs' \
  'setDeferredInteractiveAtlasSource'; do
  /usr/bin/grep -R -F -- "$needle" "$ROOT/scripts" "$ROOT/assets" >/dev/null || {
    printf 'Core WorkBuddy adapter coverage is missing: %s\n' "$needle" >&2
    exit 1
  }
done
for marker in \
  '__WORKBUDDY_SKIN_CSS_JSON__' \
  '__WORKBUDDY_SKIN_ART_JSON__' \
  '__WORKBUDDY_SKIN_VIDEO_JSON__' \
  '__WORKBUDDY_SKIN_INTERACTIVE_ATLAS_JSON__' \
  '__WORKBUDDY_SKIN_BACKGROUND_EFFECT_FACTORY__' \
  '__WORKBUDDY_SKIN_UI_INTERPRETER_FACTORY__' \
  '__WORKBUDDY_SKIN_THEME_JSON__' \
  '__WORKBUDDY_SKIN_CATALOG_JSON__' \
  '__WORKBUDDY_SKIN_STYLE_CATALOG_JSON__' \
  '__WORKBUDDY_SKIN_SETTINGS_LOCALES_JSON__' \
  '__WORKBUDDY_SKIN_THEME_SETTINGS_SESSION_FACTORY__' \
  '__WORKBUDDY_SKIN_THEME_SETTINGS_LOCALE_FACTORY__' \
  '__WORKBUDDY_SKIN_THEME_SETTINGS_COLOR_FACTORY__' \
  '__WORKBUDDY_SKIN_THEME_SETTINGS_STATE_JSON__' \
  '__WORKBUDDY_SKIN_THEME_SETTINGS_DIAGNOSTICS_JSON__' \
  '__WORKBUDDY_SKIN_THEME_SETTINGS_NONCE_JSON__' \
  '__WORKBUDDY_SKIN_THEME_SETTINGS_BINDING_JSON__' \
  '__WORKBUDDY_SKIN_VERSION_JSON__' \
  '__WORKBUDDY_SKIN_REVISION_JSON__'; do
  count="$(/usr/bin/grep -o -- "$marker" "$ROOT/assets/renderer-inject.js" | /usr/bin/wc -l | /usr/bin/tr -d ' ')"
  [ "$count" = "1" ] || { printf 'Payload marker must occur once: %s\n' "$marker" >&2; exit 1; }
done

"$NODE_RUNTIME" --input-type=module -e '
  const { createSyntheticTheme } = await import(process.argv[1]);
  await createSyntheticTheme(process.argv[2]);
' "file://$ROOT/tests/helpers/synthetic-theme.mjs" "$TEMPORARY/theme"
"$NODE_RUNTIME" "$ROOT/scripts/injector.mjs" --check-payload --theme-dir "$TEMPORARY/theme" >/dev/null
for test in "$ROOT"/tests/*.test.mjs; do "$NODE_RUNTIME" "$test"; done
printf 'mac-workbuddy tests: ok\n'
