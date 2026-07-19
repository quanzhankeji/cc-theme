#!/bin/bash

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
OUTPUT_DIR="$ROOT/release"
OUTPUT_SET="false"
SKIP_TESTS="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-tests) SKIP_TESTS="true"; shift ;;
    --help)
      /usr/bin/printf '%s\n' \
        'Usage: build-client-release.sh [output-directory] [--skip-tests]' \
        "Default asset: $ROOT/release/$(node "$ROOT/scripts/release-identity.mjs" --field clientArchive)"
      exit 0 ;;
    -*) /usr/bin/printf 'Unknown option: %s\n' "$1" >&2; exit 1 ;;
    *)
      [ "$OUTPUT_SET" = "false" ] || {
        /usr/bin/printf 'Only one output directory may be provided.\n' >&2
        exit 1
      }
      OUTPUT_DIR="$1"
      OUTPUT_SET="true"
      shift ;;
  esac
done

/bin/mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd -P)"
VERSION="$(node "$ROOT/scripts/release-identity.mjs" --field adapterVersion)"
RELEASE_REVISION="$(node "$ROOT/scripts/release-identity.mjs" --field adapterReleaseRevision)"
ASSET_NAME="$(node "$ROOT/scripts/release-identity.mjs" --field clientArchive)"
ARCHIVE="$OUTPUT_DIR/$ASSET_NAME"
ARCHIVE_TEMPORARY="$OUTPUT_DIR/.$ASSET_NAME.new.$$"
SIDECAR_TEMPORARY="$OUTPUT_DIR/.$ASSET_NAME.sha256.new.$$"
LOCK="$OUTPUT_DIR/.$ASSET_NAME.build-lock"
TMP="$(/usr/bin/mktemp -d /tmp/cc-theme-mac-workbuddy-client.XXXXXX)"
CLIENT_ROOT="$TMP/CC Theme - mac-workbuddy"
ENGINE="$CLIENT_ROOT/.mac-workbuddy"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1704067200}"
ARCHIVE_TIMESTAMP="$(/bin/date -u -r "$SOURCE_DATE_EPOCH" '+%Y%m%d%H%M.%S')"
LOCK_ACQUIRED="false"
cleanup() {
  /bin/rm -rf "$TMP"
  /bin/rm -f "$ARCHIVE_TEMPORARY" "$SIDECAR_TEMPORARY"
  if [ "$LOCK_ACQUIRED" = "true" ]; then /bin/rmdir "$LOCK" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

if ! /bin/mkdir "$LOCK" 2>/dev/null; then
  /usr/bin/printf 'Release revision is already building: %s\n' "$ASSET_NAME" >&2
  exit 1
fi
LOCK_ACQUIRED="true"
DEVELOPMENT_REPLACE="$(node -e '
  const fs = require("fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(value?.release?.publicationStatus === "unpublished-development" &&
    value?.release?.overwritePolicy === "replace-unpublished-development-revision" ? "true" : "false");
' "$ROOT/PROJECT_MANIFEST.json")"
if { [ -e "$ARCHIVE" ] || [ -e "$ARCHIVE.sha256" ]; } && [ "$DEVELOPMENT_REPLACE" != "true" ]; then
  /usr/bin/printf 'Published release revision already exists and cannot be overwritten: %s\n' "$ASSET_NAME" >&2
  exit 1
fi

[ "$SKIP_TESTS" = "true" ] || "$ROOT/tests/run-tests.sh"
/bin/mkdir -p "$ENGINE"
node "$ROOT/scripts/adapter-release.mjs" "$ENGINE" >/dev/null

/usr/bin/printf '%s\n' \
  '#!/bin/bash' \
  'set -uo pipefail' \
  'ROOT="$(cd "$(dirname "$0")" && pwd -P)"' \
  'STATUS=0' \
  '/bin/bash "$ROOT/.mac-workbuddy/scripts/install-skin-macos.sh" --no-start || STATUS=$?' \
  'if [ "$STATUS" -eq 0 ]; then' \
  '  /usr/bin/printf "\\nCC Theme Adapter 已安装；WorkBuddy 保持原生界面，等待外部主题。\\n"' \
  'else' \
  '  /usr/bin/printf "\\n安装失败，请保留本窗口中的错误信息。\\n" >&2' \
  'fi' \
  'if [ -t 0 ]; then /usr/bin/printf "按回车键关闭窗口…"; IFS= read -r _ || true; fi' \
  'exit "$STATUS"' \
  >"$CLIENT_ROOT/安装 CC Theme.command"

/usr/bin/printf '%s\n' \
  '#!/bin/bash' \
  'set -uo pipefail' \
  'ROOT="$(cd "$(dirname "$0")" && pwd -P)"' \
  'STATUS=0' \
  '/bin/bash "$ROOT/.mac-workbuddy/scripts/restore-skin-macos.sh" || STATUS=$?' \
  'if [ "$STATUS" -eq 0 ]; then' \
  '  /usr/bin/printf "\\nWorkBuddy 已恢复为原生界面。\\n"' \
  'else' \
  '  /usr/bin/printf "\\n恢复失败，请保留本窗口中的错误信息。\\n" >&2' \
  'fi' \
  'if [ -t 0 ]; then /usr/bin/printf "按回车键关闭窗口…"; IFS= read -r _ || true; fi' \
  'exit "$STATUS"' \
  >"$CLIENT_ROOT/恢复 WorkBuddy.command"

/usr/bin/printf '%s\n' \
  "CC Theme for mac-workbuddy $VERSION" \
  "Adapter release revision: $RELEASE_REVISION (macOS arm64)" \
  '' \
  '支持 macOS 上的 WorkBuddy 5.2.6，需要 Node.js 22 或更高版本。Windows 暂不支持。' \
  '' \
  '安装：完整解压 ZIP 后，双击“安装 CC Theme.command”。安装不会附带或自动应用任何主题。' \
  '主题由独立 CC Theme 资源层提供；经过验证的外部主题可由 Manager 或 apply-cc-theme-macos.sh 应用。' \
  '恢复：双击“恢复 WorkBuddy.command”可恢复 WorkBuddy 原生界面。' \
  '' \
  '隐藏目录 .mac-workbuddy 是完整运行引擎，请勿移动、改名或删除。' \
  'CC Theme 主题使用 .cctheme；退休的 .codexskin 文件不受支持。' \
  >"$CLIENT_ROOT/使用说明.txt"

/bin/chmod 755 "$CLIENT_ROOT/安装 CC Theme.command" "$CLIENT_ROOT/恢复 WorkBuddy.command"
/usr/bin/find "$ENGINE/scripts" -type f \
  \( -name '*.sh' -o -name '*.command' \) -exec /bin/chmod 755 {} +
/usr/bin/xattr -cr "$CLIENT_ROOT"
/usr/bin/find "$CLIENT_ROOT" -type f \( -name '.DS_Store' -o -name '._*' \) -delete
/usr/bin/find "$CLIENT_ROOT" -exec /usr/bin/touch -h -t "$ARCHIVE_TIMESTAMP" {} +
(
  cd "$TMP"
  COPYFILE_DISABLE=1 /usr/bin/find "$(/usr/bin/basename "$CLIENT_ROOT")" -print \
    | LC_ALL=C /usr/bin/sort \
    | COPYFILE_DISABLE=1 /usr/bin/zip -X -q "$ARCHIVE_TEMPORARY" -@
)
SHA256="$(/usr/bin/shasum -a 256 "$ARCHIVE_TEMPORARY" | /usr/bin/awk '{print $1}')"
/usr/bin/printf '%s  %s\n' "$SHA256" "$ASSET_NAME" >"$SIDECAR_TEMPORARY"
/bin/mv "$ARCHIVE_TEMPORARY" "$ARCHIVE"
/bin/mv "$SIDECAR_TEMPORARY" "$ARCHIVE.sha256"
/usr/bin/printf 'Created %s\nSHA-256 %s\n' "$ARCHIVE" "$SHA256"
