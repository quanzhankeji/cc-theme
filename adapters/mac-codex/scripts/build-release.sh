#!/bin/bash

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
RELEASE_DIR="$ROOT/release"
TMP="$(/usr/bin/mktemp -d /tmp/cc-theme-release.XXXXXX)"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1784246400}"
ARCHIVE_TIMESTAMP="$(/bin/date -u -r "$SOURCE_DATE_EPOCH" '+%Y%m%d%H%M.%S')"
trap '/bin/rm -rf "$TMP"' EXIT

if [ "${1:-}" != "--skip-tests" ]; then "$ROOT/tests/run-tests.sh"; fi

/bin/mkdir -p "$TMP/mac-codex" "$RELEASE_DIR"
. "$ROOT/scripts/common-macos.sh"
IDENTITY_JSON="$("$CONTRACT_NODE" "$ROOT/scripts/adapter-release.mjs" describe)"
IFS=$'\t' read -r ADAPTER_VERSION ADAPTER_RELEASE_REVISION RELEASE_OS RELEASE_ARCH ASSET_ID SOURCE_ARTIFACT <<EOF_IDENTITY
$("$CONTRACT_NODE" -e '
  const value = JSON.parse(process.argv[1]);
  process.stdout.write([value.adapterVersion, value.adapterReleaseRevision, value.os, value.arch, value.assetIdentity, value.artifacts.source].join("\t"));
' "$IDENTITY_JSON")
EOF_IDENTITY
[ "$RELEASE_ARCH" = "$(/usr/bin/uname -m)" ] || { /usr/bin/printf 'Release arch %s does not match this machine.\n' "$RELEASE_ARCH" >&2; exit 1; }
ARCHIVE="$RELEASE_DIR/$SOURCE_ARTIFACT"
CHECKSUM="$ARCHIVE.sha256"
[ ! -e "$ARCHIVE" ] && [ ! -e "$CHECKSUM" ] || {
  /usr/bin/printf 'Refusing to overwrite Adapter release revision %s: %s\n' "$ADAPTER_RELEASE_REVISION" "$ARCHIVE" >&2
  exit 1
}
copy_adapter_release_tree "$ROOT" "$TMP/mac-codex"
"$CONTRACT_NODE" "$ROOT/scripts/distribution-ownership.mjs" scan-directory "$TMP/mac-codex" --distribution
/usr/bin/find "$TMP/mac-codex" -type f \( -name '.DS_Store' -o -name '._*' \) -delete
/usr/bin/find "$TMP/mac-codex/scripts" -type f \
  \( -name '*.sh' -o -name '*.command' \) -exec /bin/chmod 755 {} +
/usr/bin/find "$TMP/mac-codex" -exec /usr/bin/touch -h -t "$ARCHIVE_TIMESTAMP" {} +
(
  cd "$TMP"
  COPYFILE_DISABLE=1 /usr/bin/find mac-codex -print \
    | LC_ALL=C /usr/bin/sort \
    | COPYFILE_DISABLE=1 /usr/bin/zip -X -q "$ARCHIVE" -@
)
SHA256="$(/usr/bin/shasum -a 256 "$ARCHIVE" | /usr/bin/awk '{print $1}')"
/usr/bin/printf '%s  %s\n' "$SHA256" "$(basename "$ARCHIVE")" > "$CHECKSUM"
/usr/bin/printf 'Created %s\nSHA-256 %s\n' "$ARCHIVE" "$SHA256"
