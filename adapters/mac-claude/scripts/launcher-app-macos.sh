#!/bin/bash

set -euo pipefail

MODE="${1:-}"
[ -n "$MODE" ] || { printf 'Usage: launcher-app-macos.sh <install|validate|remove> [options]\n' >&2; exit 1; }
shift

OUTPUT="${HOME}/Applications/CC Theme.app"
ENGINE_ROOT="${HOME}/.claude/cc-theme-studio"
PORT="9451"
ICON=""
MARKER_RELATIVE="Contents/Resources/CCThemeLauncher.marker"
BUNDLE_ID="app.cc-theme.launcher"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) OUTPUT="${2:-}"; shift 2 ;;
    --engine-root) ENGINE_ROOT="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --icon) ICON="${2:-}"; shift 2 ;;
    *) printf 'Unknown launcher app argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

fail() {
  printf 'CC Theme launcher: %s\n' "$*" >&2
  exit 1
}

case "$MODE" in install|validate|remove) ;; *) fail "Mode must be install, validate, or remove." ;; esac
case "$OUTPUT" in /*.app) ;; *) fail "--output must be an absolute .app path." ;; esac
case "$OUTPUT$ENGINE_ROOT$ICON" in *$'\n'*|*$'\r'*) fail "Paths must not contain line breaks." ;; esac
case "$PORT" in ''|*[!0-9]*) fail "Invalid port: $PORT" ;; esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || fail "Port must be between 1024 and 65535."

is_owned_bundle() {
  local bundle="$1"
  [ ! -L "$bundle" ] && [ -f "$bundle/$MARKER_RELATIVE" ] \
    && /usr/bin/grep -Fxq 'kind=cc-theme-launcher' "$bundle/$MARKER_RELATIVE"
}

validate_bundle() {
  local bundle="$1"
  local executable="$bundle/Contents/MacOS/cc-theme-launcher"
  local plist="$bundle/Contents/Info.plist"
  [ -d "$bundle" ] && [ ! -L "$bundle" ] || fail "Launcher bundle is missing or unsafe: $bundle"
  is_owned_bundle "$bundle" || fail "Launcher ownership marker is missing: $bundle"
  [ -x "$executable" ] || fail "Launcher executable is missing: $executable"
  [ -f "$plist" ] && [ ! -L "$plist" ] || fail "Launcher Info.plist is missing or unsafe."
  /usr/bin/plutil -lint "$plist" >/dev/null || fail "Launcher Info.plist is invalid."
  [ "$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$plist")" = "$BUNDLE_ID" ] \
    || fail "Launcher bundle identifier is invalid."
  if [ -d "$bundle/Contents/_CodeSignature" ]; then
    /usr/bin/codesign --verify --deep --strict "$bundle" >/dev/null 2>&1 \
      || fail "Launcher ad-hoc signature is invalid."
  fi
}

if [ "$MODE" = "validate" ]; then
  validate_bundle "$OUTPUT"
  /usr/bin/printf 'Validated %s\n' "$OUTPUT"
  exit 0
fi

if [ "$MODE" = "remove" ]; then
  [ -e "$OUTPUT" ] || { /usr/bin/printf 'Launcher already absent: %s\n' "$OUTPUT"; exit 0; }
  is_owned_bundle "$OUTPUT" || fail "Refusing to remove an unrelated app: $OUTPUT"
  /bin/rm -R "$OUTPUT"
  /usr/bin/printf 'Removed %s\n' "$OUTPUT"
  exit 0
fi

case "$ENGINE_ROOT" in /*) ;; *) fail "--engine-root must be absolute." ;; esac
[ -d "$ENGINE_ROOT" ] && [ ! -L "$ENGINE_ROOT" ] || fail "Engine root is missing or unsafe: $ENGINE_ROOT"
ENGINE_ROOT="$(cd "$ENGINE_ROOT" && pwd -P)"
[ -x "$ENGINE_ROOT/scripts/start-skin-macos.sh" ] \
  || fail "Engine start script is missing or not executable."
[ -f "$ENGINE_ROOT/VERSION" ] || fail "Engine VERSION is missing."
VERSION="$(/usr/bin/tr -d '[:space:]' < "$ENGINE_ROOT/VERSION")"
[[ "$VERSION" =~ ^[0-9]+([.][0-9]+){1,3}$ ]] || fail "Engine VERSION is invalid: $VERSION"
if [ -n "$ICON" ]; then
  case "$ICON" in /*) ;; *) fail "--icon must be absolute." ;; esac
  [ -f "$ICON" ] && [ ! -L "$ICON" ] || fail "Launcher icon source is missing or unsafe."
fi

PARENT="$(/usr/bin/dirname "$OUTPUT")"
BASENAME="$(/usr/bin/basename "$OUTPUT")"
/bin/mkdir -p "$PARENT"
PARENT="$(cd "$PARENT" && pwd -P)"
OUTPUT="$PARENT/$BASENAME"
STAGING="$PARENT/.${BASENAME}.installing.$$"
PREVIOUS="$PARENT/.${BASENAME}.previous.$$"
[ ! -e "$STAGING" ] && [ ! -e "$PREVIOUS" ] || fail "Temporary launcher paths already exist."

cleanup() {
  [ ! -e "$STAGING" ] || /bin/rm -R "$STAGING"
  [ ! -e "$PREVIOUS" ] || /bin/rm -R "$PREVIOUS"
}
trap cleanup EXIT

/bin/mkdir -p "$STAGING/Contents/MacOS" "$STAGING/Contents/Resources"
EXECUTABLE="$STAGING/Contents/MacOS/cc-theme-launcher"
RESOURCES="$STAGING/Contents/Resources"
printf -v ENGINE_LITERAL '%q' "$ENGINE_ROOT"

cat > "$EXECUTABLE" <<EOF_LAUNCHER
#!/bin/bash
set -u
ENGINE_ROOT=$ENGINE_LITERAL
PORT=$PORT
STATE_ROOT="\${HOME}/Library/Application Support/CCTheme/claude"
LOG="\${STATE_ROOT}/launcher.log"
/bin/mkdir -p "\${STATE_ROOT}"
/bin/chmod 700 "\${STATE_ROOT}" 2>/dev/null || true
START_SCRIPT="\${ENGINE_ROOT}/scripts/start-skin-macos.sh"
if [ ! -x "\${START_SCRIPT}" ]; then
  /usr/bin/osascript -e 'display alert "CC Theme" message "本地 Theme 引擎不存在，请重新运行安装器。"' >/dev/null 2>&1 || true
  exit 1
fi
# LaunchServices may choose the x86_64 slice for a script-only app bundle on
# Apple Silicon. Prefer a native arm64 shell when the machine supports it so
# the signed arm64 runtime bundled with Claude is validated in the right ABI.
if /usr/bin/arch -arm64 /usr/bin/true >/dev/null 2>&1; then
  START_RUNNER=(/usr/bin/arch -arm64 /bin/bash)
else
  START_RUNNER=(/bin/bash)
fi
if ! "\${START_RUNNER[@]}" "\${START_SCRIPT}" --port "\${PORT}" --prompt-restart >>"\${LOG}" 2>&1; then
  FAILURE_DETAIL="\$(/usr/bin/tail -n 8 "\${LOG}" 2>/dev/null | /usr/bin/tr '\n' ' ' | /usr/bin/cut -c 1-1000)"
  /usr/bin/osascript - "\${LOG}" "\${FAILURE_DETAIL}" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  display alert "CC Theme 启动失败" message ("已停止主题加载并保留客户端原始外观。" & return & return & item 2 of argv & return & return & "日志：" & item 1 of argv)
end run
APPLESCRIPT
  exit 1
fi
if [ "\${CC_THEME_LAUNCHER_SKIP_ACTIVATE:-false}" != "true" ]; then
  /usr/bin/open -b com.anthropic.claudefordesktop >/dev/null 2>&1 || true
fi
EOF_LAUNCHER
/bin/chmod 755 "$EXECUTABLE"
/usr/bin/printf 'kind=cc-theme-launcher\nversion=%s\n' "$VERSION" > "$STAGING/$MARKER_RELATIVE"

ICON_PLIST=""
if [ -n "$ICON" ] && [ -x /usr/bin/sips ] && [ -x /usr/bin/iconutil ]; then
  ICONSET="$RESOURCES/AppIcon.iconset"
  BASE="$RESOURCES/.icon-base.png"
  SQUARE="$RESOURCES/.icon-square.png"
  /bin/mkdir -p "$ICONSET"
  if /usr/bin/sips -s format png -Z 1024 "$ICON" --out "$BASE" >/dev/null 2>&1 \
    && /usr/bin/sips -p 1024 1024 --padColor 02162D "$BASE" --out "$SQUARE" >/dev/null 2>&1; then
    for spec in '16 icon_16x16.png' '32 icon_16x16@2x.png' '32 icon_32x32.png' \
      '64 icon_32x32@2x.png' '128 icon_128x128.png' '256 icon_128x128@2x.png' \
      '256 icon_256x256.png' '512 icon_256x256@2x.png' '512 icon_512x512.png' \
      '1024 icon_512x512@2x.png'; do
      size="${spec%% *}"
      name="${spec#* }"
      /usr/bin/sips -z "$size" "$size" "$SQUARE" --out "$ICONSET/$name" >/dev/null 2>&1 || true
    done
    if /usr/bin/iconutil -c icns "$ICONSET" -o "$RESOURCES/AppIcon.icns" >/dev/null 2>&1; then
      ICON_PLIST=$'  <key>CFBundleIconFile</key>\n  <string>AppIcon</string>'
    fi
  fi
  /bin/rm -R "$ICONSET"
  /bin/rm -f "$BASE" "$SQUARE"
fi

cat > "$STAGING/Contents/Info.plist" <<EOF_PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>CC Theme</string>
  <key>CFBundleExecutable</key>
  <string>cc-theme-launcher</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
$ICON_PLIST
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>CC Theme</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>$VERSION</string>
  <key>LSUIElement</key>
  <true/>
  <key>LSArchitecturePriority</key>
  <array>
    <string>arm64</string>
    <string>x86_64</string>
  </array>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
EOF_PLIST

/bin/chmod 644 "$STAGING/Contents/Info.plist" "$STAGING/$MARKER_RELATIVE"
/usr/bin/plutil -lint "$STAGING/Contents/Info.plist" >/dev/null || fail "Generated launcher Info.plist is invalid."
/usr/bin/codesign --force --deep --sign - "$STAGING" >/dev/null 2>&1 \
  || fail "Could not create the local ad-hoc launcher signature."
validate_bundle "$STAGING"

if [ -e "$OUTPUT" ]; then
  is_owned_bundle "$OUTPUT" || fail "Refusing to replace an unrelated app: $OUTPUT"
  /bin/mv "$OUTPUT" "$PREVIOUS"
fi
if ! /bin/mv "$STAGING" "$OUTPUT"; then
  [ ! -e "$PREVIOUS" ] || /bin/mv "$PREVIOUS" "$OUTPUT"
  fail "Could not atomically install the launcher app."
fi
[ ! -e "$PREVIOUS" ] || /bin/rm -R "$PREVIOUS"
trap - EXIT
validate_bundle "$OUTPUT"
/usr/bin/printf 'Installed %s\n' "$OUTPUT"
