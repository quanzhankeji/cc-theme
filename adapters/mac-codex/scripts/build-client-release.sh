#!/bin/bash

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
OUTPUT=""
SKIP_TESTS="false"
. "$ROOT/scripts/common-macos.sh"
IDENTITY_JSON="$("$CONTRACT_NODE" "$ROOT/scripts/adapter-release.mjs" describe)"
IFS=$'\t' read -r ADAPTER_VERSION ADAPTER_RELEASE_REVISION RELEASE_OS RELEASE_ARCH ASSET_ID CLIENT_ARTIFACT <<EOF_IDENTITY
$("$CONTRACT_NODE" -e '
  const value = JSON.parse(process.argv[1]);
  process.stdout.write([value.adapterVersion, value.adapterReleaseRevision, value.os, value.arch, value.assetIdentity, value.artifacts.client].join("\t"));
' "$IDENTITY_JSON")
EOF_IDENTITY
[ "$RELEASE_ARCH" = "$(/usr/bin/uname -m)" ] || { /usr/bin/printf 'Release arch %s does not match this machine.\n' "$RELEASE_ARCH" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-tests) SKIP_TESTS="true"; shift ;;
    --help)
      /usr/bin/printf '%s\n' \
        'Usage: build-client-release.sh [output.zip] [--skip-tests]' \
        "Default output: ~/Desktop/${CLIENT_ARTIFACT}"
      exit 0 ;;
    -*) /usr/bin/printf 'Unknown option: %s\n' "$1" >&2; exit 1 ;;
    *)
      [ -z "$OUTPUT" ] || { /usr/bin/printf 'Only one output path may be provided.\n' >&2; exit 1; }
      OUTPUT="$1"
      shift ;;
  esac
done
OUTPUT="${OUTPUT:-$HOME/Desktop/$CLIENT_ARTIFACT}"
[ "$(/usr/bin/basename "$OUTPUT")" = "$CLIENT_ARTIFACT" ] || {
  /usr/bin/printf 'Output filename must preserve the Adapter asset identity: %s\n' "$CLIENT_ARTIFACT" >&2
  exit 1
}
/bin/mkdir -p "$(dirname "$OUTPUT")"
OUTPUT_DIR="$(cd "$(dirname "$OUTPUT")" && pwd -P)"
OUTPUT="$OUTPUT_DIR/$(/usr/bin/basename "$OUTPUT")"
[ ! -e "$OUTPUT" ] && [ ! -e "$OUTPUT.sha256" ] || {
  /usr/bin/printf 'Refusing to overwrite Adapter release revision %s: %s\n' "$ADAPTER_RELEASE_REVISION" "$OUTPUT" >&2
  exit 1
}
TMP="$(/usr/bin/mktemp -d /tmp/cc-theme-client.XXXXXX)"
CLIENT_ROOT="$TMP/CC Theme - mac-codex"
ENGINE="$CLIENT_ROOT/.mac-codex"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1784246400}"
ARCHIVE_TIMESTAMP="$(/bin/date -u -r "$SOURCE_DATE_EPOCH" '+%Y%m%d%H%M.%S')"
trap '/bin/rm -rf "$TMP"' EXIT

[ "$SKIP_TESTS" = "true" ] || "$ROOT/tests/run-tests.sh"
/bin/mkdir -p "$ENGINE"
copy_adapter_release_tree "$ROOT" "$ENGINE"
"$CONTRACT_NODE" "$ROOT/scripts/distribution-ownership.mjs" scan-directory "$ENGINE" --distribution

/usr/bin/printf '%s\n' \
  '#!/bin/bash' \
  'set -euo pipefail' \
  'ROOT="$(cd "$(dirname "$0")" && pwd -P)"' \
  'exec "$ROOT/.mac-codex/scripts/install-skin-macos.sh"' \
  > "$CLIENT_ROOT/安装 CC Theme.command"

/usr/bin/printf '%s\n' \
  "CC Theme for mac-codex $ADAPTER_VERSION release $ADAPTER_RELEASE_REVISION ($RELEASE_OS/$RELEASE_ARCH)" \
  '' \
  '推荐方式：把这个完整 ZIP 和“给 Codex 的部署提示词.md”一起发给自己的 Codex。' \
  '' \
  '手动方式：双击“安装 CC Theme.command”。安装完成后会生成 CC Theme 启动器，并在桌面提供验证与恢复入口。' \
  '' \
  '主题资源由 CC Theme Manager 提供的外部 .cctheme 包管理；Adapter 不内置图片、视频或生产预设。' \
  '隐藏目录 .mac-codex 是完整运行引擎，请勿删除。' \
  > "$CLIENT_ROOT/使用说明.txt"

/bin/cp "$ROOT/CLIENT_DEPLOY_PROMPT.md" "$CLIENT_ROOT/给 Codex 的部署提示词.md"
/bin/chmod 755 "$CLIENT_ROOT/安装 CC Theme.command"
/usr/bin/find "$ENGINE/scripts" -type f \
  \( -name '*.sh' -o -name '*.command' \) -exec /bin/chmod 755 {} +
/usr/bin/xattr -cr "$CLIENT_ROOT"
/usr/bin/find "$CLIENT_ROOT" -type f \( -name '.DS_Store' -o -name '._*' \) -delete
/usr/bin/find "$CLIENT_ROOT" -exec /usr/bin/touch -h -t "$ARCHIVE_TIMESTAMP" {} +
(
  cd "$TMP"
  COPYFILE_DISABLE=1 /usr/bin/find "$(/usr/bin/basename "$CLIENT_ROOT")" -print \
    | LC_ALL=C /usr/bin/sort \
    | COPYFILE_DISABLE=1 /usr/bin/zip -X -q "$OUTPUT" -@
)
SHA256="$(/usr/bin/shasum -a 256 "$OUTPUT" | /usr/bin/awk '{print $1}')"
/usr/bin/printf '%s  %s\n' "$SHA256" "$(/usr/bin/basename "$OUTPUT")" > "$OUTPUT.sha256"
/usr/bin/printf 'Created %s\nSHA-256 %s\n' "$OUTPUT" "$SHA256"
