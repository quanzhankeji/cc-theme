#!/bin/bash

# Build-time only: pin and verify the standalone Node runtime bundled inside the
# signed macOS app. End users never need Homebrew, nvm, Node, or a shell setup.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
VERSION="24.17.0"
ARCH="$(/usr/bin/uname -m)"

case "$ARCH" in
  arm64)
    DIST_ARCH="arm64"
    EXPECTED_SHA256="4fc3266a3702eebc39cc37661cf4eeceeade307e242ab64e4d7ce7949197e11f"
    EXPECTED_BINARY_SHA256="f5f9b9db4d95f5e0340982685f083de654c21eef9d9122cab5321081ccaa2601"
    ;;
  *)
    printf 'Unsupported macOS build architecture: %s\n' "$ARCH" >&2
    exit 1
    ;;
esac

validate_runtime() {
  local node="$1"
  [ -x "$node" ] || return 1
  [ "$(/usr/bin/shasum -a 256 "$node" | /usr/bin/awk '{print $1}')" = "$EXPECTED_BINARY_SHA256" ] || return 1
  /usr/bin/file "$node" | /usr/bin/grep -q 'arm64' || return 1
  /usr/bin/codesign --verify --strict "$node" >/dev/null 2>&1 || return 1
  local team
  team="$(/usr/bin/codesign -dv --verbose=4 "$node" 2>&1 | /usr/bin/sed -n 's/^TeamIdentifier=//p')"
  [ "$team" = "HX7739G8FX" ] || return 1
  [ "$($node --version)" = "v$VERSION" ] || return 1
}

RUNTIME_ROOT="$APP_ROOT/.runtime-cache/node-current"
if [ -e "$RUNTIME_ROOT" ]; then
  if [ -x "$RUNTIME_ROOT/bin/node" ] &&
     [ "$(cat "$RUNTIME_ROOT/VERSION" 2>/dev/null || true)" = "$VERSION-$DIST_ARCH" ] &&
     validate_runtime "$RUNTIME_ROOT/bin/node"; then
    actual="$($RUNTIME_ROOT/bin/node --version)"
    printf 'Bundled Node runtime ready: %s (%s)\n' "$actual" "$DIST_ARCH"
    exit 0
  fi
  printf 'Cached Node runtime failed version, integrity, architecture, or signature validation; rebuilding it.\n' >&2
  /bin/rm -rf "$RUNTIME_ROOT"
fi

ARCHIVE="node-v${VERSION}-darwin-${DIST_ARCH}.tar.gz"
URL="https://nodejs.org/download/release/v${VERSION}/${ARCHIVE}"
WORK="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/cc-theme-node.XXXXXX")"
cleanup() { /bin/rm -rf "$WORK"; }
trap cleanup EXIT

/usr/bin/curl --fail --location --silent --show-error "$URL" --output "$WORK/$ARCHIVE"
actual_sha256="$(/usr/bin/shasum -a 256 "$WORK/$ARCHIVE" | /usr/bin/awk '{print $1}')"
[ "$actual_sha256" = "$EXPECTED_SHA256" ] || {
  printf 'Node runtime checksum mismatch.\n' >&2
  exit 1
}

/usr/bin/tar -xzf "$WORK/$ARCHIVE" -C "$WORK"
SOURCE="$WORK/node-v${VERSION}-darwin-${DIST_ARCH}"
[ -x "$SOURCE/bin/node" ] || exit 1

STAGE="$APP_ROOT/.runtime-cache/.node-current.$$"
/bin/rm -rf "$STAGE"
/bin/mkdir -p "$STAGE/bin"
/bin/cp "$SOURCE/bin/node" "$STAGE/bin/node"
/bin/cp "$SOURCE/LICENSE" "$STAGE/LICENSE"
/bin/chmod 755 "$STAGE" "$STAGE/bin" "$STAGE/bin/node"
/bin/chmod 644 "$STAGE/LICENSE"
printf '%s\n' "$VERSION-$DIST_ARCH" > "$STAGE/VERSION"
validate_runtime "$STAGE/bin/node" || {
  printf 'Prepared Node runtime failed binary integrity or signature validation.\n' >&2
  exit 1
}

/bin/mkdir -p "$APP_ROOT/.runtime-cache"
/bin/rm -rf "$RUNTIME_ROOT"
/bin/mv "$STAGE" "$RUNTIME_ROOT"
printf 'Bundled Node runtime prepared: v%s (%s)\n' "$VERSION" "$DIST_ARCH"
