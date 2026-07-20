#!/bin/bash

set -euo pipefail

APP_BUNDLE="${1:?usage: verify-packaged-runtime.sh <CC Theme.app>}"
NODE="$APP_BUNDLE/Contents/Resources/runtime/node/bin/node"

[ -x "$NODE" ] || {
  printf 'Packaged Node runtime is missing or not executable.\n' >&2
  exit 1
}

/usr/bin/codesign --verify --strict "$NODE"

smoke="$("$NODE" --input-type=module -e '
  const values = Array.from({ length: 64 }, (_, index) => index + 1);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total !== 2080) process.exit(2);
  console.log("cc-theme-packaged-node-smoke-ok");
')"
[ "$smoke" = "cc-theme-packaged-node-smoke-ok" ] || {
  printf 'Packaged Node runtime could not execute the compiler smoke test.\n' >&2
  exit 1
}

/usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"
printf 'Packaged Node runtime verified: JavaScript execution and deep signature PASS.\n'
