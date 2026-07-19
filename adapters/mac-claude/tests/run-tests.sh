#!/bin/bash

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
NODE="${CC_THEME_NODE:-${NODE:-}}"
for candidate in "$NODE" /opt/homebrew/bin/node /usr/local/bin/node "$(/usr/bin/which node 2>/dev/null || true)"; do
  [ -n "$candidate" ] && [ -x "$candidate" ] && { NODE="$candidate"; break; }
done
[ -x "$NODE" ] || { printf 'Node.js 20 or newer is required.\n' >&2; exit 1; }

for file in "$ROOT"/scripts/*.mjs "$ROOT"/assets/*.js "$ROOT"/tests/fixtures/*.mjs; do
  "$NODE" --check "$file"
done
for file in "$ROOT"/scripts/*.sh "$ROOT"/tests/*.sh; do
  /bin/bash -n "$file"
done
for file in "$ROOT"/PROJECT_MANIFEST.json "$ROOT"/package.json "$ROOT"/contracts/*.json \
  "$ROOT"/tests/fixtures/*.json "$ROOT"/compatibility/claude-macos/1.22209.3/*.json; do
  "$NODE" -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$file"
done

"$NODE" "$ROOT/scripts/ui-surface-catalog.mjs" validate \
  "$ROOT/compatibility/claude-macos/1.22209.3/ui-surface-catalog.json" >/dev/null
RUNTIME_FIXTURE="$(/usr/bin/mktemp -d /tmp/mac-claude-runtime-fixture.XXXXXX)"
trap '/bin/rm -rf "$RUNTIME_FIXTURE"' EXIT
"$NODE" "$ROOT/tests/fixtures/synthetic-media.mjs" "$RUNTIME_FIXTURE"
"$NODE" "$ROOT/scripts/injector.mjs" --check-payload --theme-dir "$RUNTIME_FIXTURE" >/dev/null
"$NODE" "$ROOT/scripts/theme-lifecycle.mjs" describe >/dev/null
"$NODE" "$ROOT/scripts/adapter-capability.mjs" --validate >/dev/null
"$NODE" "$ROOT/scripts/validate-adapter-resources.mjs" --repository "$ROOT" >/dev/null

while IFS= read -r test_file; do
  "$NODE" "$test_file"
done < <(/usr/bin/find "$ROOT/tests" -maxdepth 1 -name '*.test.mjs' -type f | LC_ALL=C /usr/bin/sort)

if /usr/bin/grep -R -n -E '/mac-(codex|workbuddy)/|\.\./mac-(codex|workbuddy)' \
  "$ROOT/scripts" "$ROOT/assets" "$ROOT/contracts" >/dev/null; then
  printf 'A runtime or Skill file depends on a sibling client project.\n' >&2
  exit 1
fi
if /usr/bin/grep -R -n -E 'document\.(body|documentElement)\.(innerText|textContent)|location\.(href|search|hash)' \
  "$ROOT/scripts/live-surface-evidence.mjs" "$ROOT/scripts/injector.mjs" >/dev/null; then
  printf 'Live Surface Evidence contains a forbidden privacy read.\n' >&2
  exit 1
fi

printf 'PASS: all Mac-Claude tests completed.\n'
