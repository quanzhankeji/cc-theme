#!/bin/bash

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
VERSION="$(/usr/bin/tr -d '[:space:]' < "$ROOT/VERSION")"
MANIFEST="$ROOT/PROJECT_MANIFEST.json"
ADAPTER_ID="$(/usr/bin/plutil -extract releaseIdentity.adapterId raw -o - "$MANIFEST")"
RELEASE_REVISION="$(/usr/bin/plutil -extract releaseIdentity.adapterReleaseRevision raw -o - "$MANIFEST")"
RELEASE_OS="$(/usr/bin/plutil -extract releaseIdentity.os raw -o - "$MANIFEST")"
RELEASE_ARCH="$(/usr/bin/plutil -extract releaseIdentity.arch raw -o - "$MANIFEST")"
RELEASE_STATUS="$(/usr/bin/plutil -extract releaseIdentity.releaseStatus raw -o - "$MANIFEST")"
MANAGER_REGISTRATION_STATUS="$(/usr/bin/plutil -extract managerRegistration.status raw -o - "$MANIFEST")"
ENGINE_DELIVERY_ALLOWED="$(/usr/bin/plutil -extract managerRegistration.engineDeliveryAllowed raw -o - "$MANIFEST")"
ASSET_STEM="${ADAPTER_ID}-v${VERSION}-r${RELEASE_REVISION}-${RELEASE_OS}-${RELEASE_ARCH}"
EXPECTED_ASSET_NAME="cc-theme-${ASSET_STEM}.zip"
[ "$MANAGER_REGISTRATION_STATUS" != "paused" ] && [ "$ENGINE_DELIVERY_ALLOWED" = "true" ] || {
  /usr/bin/printf 'Mac-Claude Manager registration is paused; client Engine delivery is disabled.\n' >&2
  exit 1
}
OUTPUT=""
SKIP_TESTS="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-tests) SKIP_TESTS="true"; shift ;;
    --help)
      /usr/bin/printf '%s\n' \
        'Usage: build-client-release.sh [output.zip] [--skip-tests]' \
        "Default output: ~/Desktop/cc-theme-${ASSET_STEM}.zip"
      exit 0 ;;
    -*) /usr/bin/printf 'Unknown option: %s\n' "$1" >&2; exit 1 ;;
    *)
      [ -z "$OUTPUT" ] || { /usr/bin/printf 'Only one output path may be provided.\n' >&2; exit 1; }
      OUTPUT="$1"
      shift ;;
  esac
done
OUTPUT="${OUTPUT:-$HOME/Desktop/$EXPECTED_ASSET_NAME}"
TMP="$(/usr/bin/mktemp -d /tmp/cc-theme-client.XXXXXX)"
CLIENT_ROOT="$TMP/CC Theme - mac-claude"
ENGINE="$CLIENT_ROOT/.mac-claude"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1784246400}"
ARCHIVE_TIMESTAMP="$(/bin/date -u -r "$SOURCE_DATE_EPOCH" '+%Y%m%d%H%M.%S')"
trap '/bin/rm -rf "$TMP"' EXIT

[ "$SKIP_TESTS" = "true" ] || "$ROOT/tests/run-tests.sh"
[ "$VERSION" = "$(/usr/bin/plutil -extract adapterVersion raw -o - "$MANIFEST")" ] || {
  /usr/bin/printf 'VERSION and PROJECT_MANIFEST adapterVersion differ.\n' >&2
  exit 1
}
[ "$(/usr/bin/uname -m)" = "$RELEASE_ARCH" ] || {
  /usr/bin/printf 'Release target architecture %s does not match this Mac.\n' "$RELEASE_ARCH" >&2
  exit 1
}
/bin/mkdir -p "$ENGINE"
for directory in assets compatibility contracts docs scripts; do
  /bin/mkdir -p "$ENGINE/$directory"
  /usr/bin/rsync -a "$ROOT/$directory/" "$ENGINE/$directory/"
done
for file in CHANGELOG.md CLIENT_DEPLOY_PROMPT.md LICENSE MIGRATION.md NOTICE.md \
  PROJECT_MANIFEST.json README.md RELEASE_CHECKLIST.md SOURCE_ATTRIBUTION.md VERSION package.json; do
  /bin/cp -p "$ROOT/$file" "$ENGINE/$file"
done
"${CC_THEME_NODE:-${NODE:-node}}" "$ROOT/scripts/validate-adapter-resources.mjs" \
  --release-directory "$ENGINE" >/dev/null

/usr/bin/printf '%s\n' \
  '#!/bin/bash' \
  'set -euo pipefail' \
  'ROOT="$(cd "$(dirname "$0")" && pwd -P)"' \
  'exec "$ROOT/.mac-claude/scripts/install-skin-macos.sh" --no-launchers --no-launch' \
  > "$CLIENT_ROOT/安装 CC Theme.command"

/usr/bin/printf '%s\n' \
  "CC Theme for mac-claude $VERSION" \
  '' \
  '推荐方式：把这个完整 ZIP、你喜欢的图片和“给 Claude 的部署提示词.md”一起发给自己的 Claude。' \
  '' \
  '手动方式：双击“安装 CC Theme.command”仅离线部署 Adapter 契约和引擎；当前不会创建启动器或修改 Claude renderer。' \
  '' \
  'Theme Manager 可在你明确确认后启动“诊断预览”：它会打开 Claude 官方 DevTools，并要求你手动运行固定 Adapter bootstrap。预览仅持续当前 renderer 会话。' \
  '' \
  '原因：官方 Claude 要求 Anthropic 签名的 CDP 授权；在安全 Seam 验证前，Mac-Claude 明确保持 projection-only，诊断预览不等于自动应用。' \
  '' \
  '不要只复制图片或 CSS。隐藏目录 .mac-claude 是完整运行引擎，请勿删除。' \
  > "$CLIENT_ROOT/使用说明.txt"

/bin/cp "$ROOT/CLIENT_DEPLOY_PROMPT.md" "$CLIENT_ROOT/给 Claude 的部署提示词.md"
/bin/chmod 755 "$CLIENT_ROOT/安装 CC Theme.command"
/usr/bin/find "$ENGINE/scripts" -type f \
  \( -name '*.sh' -o -name '*.command' \) -exec /bin/chmod 755 {} +
/usr/bin/xattr -cr "$CLIENT_ROOT"
/usr/bin/find "$CLIENT_ROOT" -type f \( -name '.DS_Store' -o -name '._*' \) -delete
/bin/mkdir -p "$(dirname "$OUTPUT")"
OUTPUT_DIR="$(cd "$(dirname "$OUTPUT")" && pwd -P)"
OUTPUT="$OUTPUT_DIR/$(/usr/bin/basename "$OUTPUT")"
PUBLISH_STAGE="$(/usr/bin/mktemp -d "$OUTPUT_DIR/.cc-theme-publish.XXXXXX")"
OUTPUT_STAGE="$PUBLISH_STAGE/$EXPECTED_ASSET_NAME"
CHECKSUM_STAGE="$PUBLISH_STAGE/$EXPECTED_ASSET_NAME.sha256"
trap '/bin/rm -rf "$TMP" "${PUBLISH_STAGE:-}"' EXIT
if { [ -e "$OUTPUT" ] || [ -e "$OUTPUT.sha256" ]; } &&
   { [ "$RELEASE_STATUS" != "development-unpublished" ] || [ "$(/usr/bin/basename "$OUTPUT")" != "$EXPECTED_ASSET_NAME" ]; }; then
  /usr/bin/printf 'Refusing to overwrite a published revision or a non-canonical output: %s\n' "$OUTPUT" >&2
  exit 1
fi
/usr/bin/find "$CLIENT_ROOT" -exec /usr/bin/touch -h -t "$ARCHIVE_TIMESTAMP" {} +
(
  cd "$TMP"
  COPYFILE_DISABLE=1 /usr/bin/find "$(/usr/bin/basename "$CLIENT_ROOT")" -print \
    | LC_ALL=C /usr/bin/sort \
    | COPYFILE_DISABLE=1 /usr/bin/zip -X -q "$OUTPUT_STAGE" -@
)
"${CC_THEME_NODE:-${NODE:-node}}" "$ROOT/scripts/validate-adapter-resources.mjs" \
  --release-archive "$OUTPUT_STAGE" >/dev/null
SHA256="$(/usr/bin/shasum -a 256 "$OUTPUT_STAGE" | /usr/bin/awk '{print $1}')"
/usr/bin/printf '%s  %s\n' "$SHA256" "$(/usr/bin/basename "$OUTPUT")" > "$CHECKSUM_STAGE"
/bin/mv -f "$OUTPUT_STAGE" "$OUTPUT"
/bin/mv -f "$CHECKSUM_STAGE" "$OUTPUT.sha256"
/usr/bin/printf 'Created %s\nSHA-256 %s\n' "$OUTPUT" "$SHA256"
