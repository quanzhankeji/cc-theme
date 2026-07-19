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
RELEASE_DIR="$ROOT/release"
ARCHIVE="$RELEASE_DIR/$ASSET_STEM.zip"
[ "$MANAGER_REGISTRATION_STATUS" != "paused" ] && [ "$ENGINE_DELIVERY_ALLOWED" = "true" ] || {
  /usr/bin/printf 'Mac-Claude Manager registration is paused; Engine release delivery is disabled.\n' >&2
  exit 1
}
TMP="$(/usr/bin/mktemp -d /tmp/cc-theme-release.XXXXXX)"
/bin/mkdir -p "$RELEASE_DIR"
PUBLISH_STAGE="$(/usr/bin/mktemp -d "$RELEASE_DIR/.publish.XXXXXX")"
ARCHIVE_STAGE="$PUBLISH_STAGE/$ASSET_STEM.zip"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1784246400}"
ARCHIVE_TIMESTAMP="$(/bin/date -u -r "$SOURCE_DATE_EPOCH" '+%Y%m%d%H%M.%S')"
trap '/bin/rm -rf "$TMP" "$PUBLISH_STAGE"' EXIT

if [ "${1:-}" != "--skip-tests" ]; then "$ROOT/tests/run-tests.sh"; fi
[ "$VERSION" = "$(/usr/bin/plutil -extract adapterVersion raw -o - "$MANIFEST")" ] || {
  /usr/bin/printf 'VERSION and PROJECT_MANIFEST adapterVersion differ.\n' >&2
  exit 1
}
[ "$(/usr/bin/uname -m)" = "$RELEASE_ARCH" ] || {
  /usr/bin/printf 'Release target architecture %s does not match this Mac.\n' "$RELEASE_ARCH" >&2
  exit 1
}
if [ -e "$ARCHIVE" ] && [ "$RELEASE_STATUS" != "development-unpublished" ]; then
  /usr/bin/printf 'Refusing to overwrite a published Adapter revision asset: %s\n' "$ARCHIVE" >&2
  exit 1
fi

/bin/mkdir -p "$TMP/mac-claude"
for directory in assets compatibility contracts docs scripts; do
  /bin/mkdir -p "$TMP/mac-claude/$directory"
  /usr/bin/rsync -a "$ROOT/$directory/" "$TMP/mac-claude/$directory/"
done
for file in CHANGELOG.md CLIENT_DEPLOY_PROMPT.md LICENSE MIGRATION.md NOTICE.md \
  PROJECT_MANIFEST.json README.md RELEASE_CHECKLIST.md SOURCE_ATTRIBUTION.md VERSION package.json; do
  /bin/cp -p "$ROOT/$file" "$TMP/mac-claude/$file"
done
"${CC_THEME_NODE:-${NODE:-node}}" "$ROOT/scripts/validate-adapter-resources.mjs" \
  --release-directory "$TMP/mac-claude" >/dev/null
/usr/bin/find "$TMP/mac-claude" -type f \( -name '.DS_Store' -o -name '._*' \) -delete
/usr/bin/find "$TMP/mac-claude/scripts" -type f \
  \( -name '*.sh' -o -name '*.command' \) -exec /bin/chmod 755 {} +
/usr/bin/find "$TMP/mac-claude" -exec /usr/bin/touch -h -t "$ARCHIVE_TIMESTAMP" {} +
(
  cd "$TMP"
  COPYFILE_DISABLE=1 /usr/bin/find mac-claude -print \
    | LC_ALL=C /usr/bin/sort \
    | COPYFILE_DISABLE=1 /usr/bin/zip -X -q "$ARCHIVE_STAGE" -@
)
"${CC_THEME_NODE:-${NODE:-node}}" "$ROOT/scripts/validate-adapter-resources.mjs" \
  --release-archive "$ARCHIVE_STAGE" >/dev/null
SHA256="$(/usr/bin/shasum -a 256 "$ARCHIVE_STAGE" | /usr/bin/awk '{print $1}')"
CHECKSUMS_STAGE="$PUBLISH_STAGE/SHA256SUMS.txt"
if [ -f "$RELEASE_DIR/SHA256SUMS.txt" ]; then
  /usr/bin/awk -v asset="$(/usr/bin/basename "$ARCHIVE")" '$2 != asset { print }' \
    "$RELEASE_DIR/SHA256SUMS.txt" > "$CHECKSUMS_STAGE"
fi
/usr/bin/printf '%s  %s\n' "$SHA256" "$(/usr/bin/basename "$ARCHIVE")" >> "$CHECKSUMS_STAGE"
LC_ALL=C /usr/bin/sort -k2,2 -o "$CHECKSUMS_STAGE" "$CHECKSUMS_STAGE"
/bin/mv -f "$ARCHIVE_STAGE" "$ARCHIVE"
/bin/mv -f "$CHECKSUMS_STAGE" "$RELEASE_DIR/SHA256SUMS.txt"
/usr/bin/printf 'Created %s\nSHA-256 %s\n' "$ARCHIVE" "$SHA256"
