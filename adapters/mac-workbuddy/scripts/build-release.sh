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
        'Usage: build-release.sh [output-directory] [--skip-tests]' \
        "Default asset: $ROOT/release/$(node "$ROOT/scripts/release-identity.mjs" --field sourceArchive)"
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

ASSET_ID="$(node "$ROOT/scripts/release-identity.mjs" --field assetIdentity)"
ASSET_NAME="$(node "$ROOT/scripts/release-identity.mjs" --field sourceArchive)"
/bin/mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd -P)"
ARCHIVE="$OUTPUT_DIR/$ASSET_NAME"
ARCHIVE_TEMPORARY="$OUTPUT_DIR/.$ASSET_NAME.new.$$"
SIDECAR_TEMPORARY="$OUTPUT_DIR/.$ASSET_NAME.sha256.new.$$"
LOCK="$OUTPUT_DIR/.$ASSET_NAME.build-lock"
TMP="$(/usr/bin/mktemp -d /tmp/mac-workbuddy-source.XXXXXX)"
STAGING="$TMP/$ASSET_ID"
LOCK_ACQUIRED="false"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1704067200}"
STAMP="$(/bin/date -u -r "$SOURCE_DATE_EPOCH" +%Y%m%d%H%M.%S)"
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
/bin/mkdir -p "$STAGING"
node "$ROOT/scripts/adapter-release.mjs" "$STAGING" >/dev/null
/usr/bin/find "$STAGING/scripts" -type f -name '*.sh' -exec /bin/chmod 755 {} +
/usr/bin/find "$STAGING" -exec /usr/bin/touch -h -t "$STAMP" {} +
(
  cd "$TMP"
  /usr/bin/find "$ASSET_ID" -print | LC_ALL=C /usr/bin/sort | /usr/bin/zip -X -q "$ARCHIVE_TEMPORARY" -@
)
HASH="$(/usr/bin/shasum -a 256 "$ARCHIVE_TEMPORARY" | /usr/bin/awk '{print $1}')"
printf '%s  %s\n' "$HASH" "$(basename "$ARCHIVE")" >"$SIDECAR_TEMPORARY"
/bin/mv "$ARCHIVE_TEMPORARY" "$ARCHIVE"
/bin/mv "$SIDECAR_TEMPORARY" "$ARCHIVE.sha256"
/usr/bin/printf 'Created %s\nSHA-256 %s\n' "$ARCHIVE" "$HASH"
