#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

PORT=9341
CREATE_LAUNCHERS="true"
LAUNCH_AFTER_INSTALL="true"
IN_PLACE="false"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --no-launchers) CREATE_LAUNCHERS="false"; shift ;;
    --no-launch) LAUNCH_AFTER_INSTALL="false"; shift ;;
    --in-place) IN_PLACE="true"; shift ;;
    --help)
      /usr/bin/printf '%s\n' \
        'Usage: install-skin-macos.sh [--port <1024-65535>] [--no-launch] [--no-launchers]' \
        '  default: create CC Theme.app plus Desktop maintenance utilities' \
        '  --no-launchers: install the Adapter without local launcher entries' \
        '  --no-launch: finish installation without starting or injecting Codex'
      exit 0 ;;
    *) fail "Unknown installer argument: $1" ;;
  esac
done
case "$PORT" in ''|*[!0-9]*) fail "Invalid port: $PORT" ;; esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || fail "Port must be between 1024 and 65535."

# Refuse before replacing the installed engine. A running watcher can otherwise
# observe half of an upgrade even when config.toml itself has not been touched.
cleanup_legacy_launchd_jobs
discover_codex_app
require_macos_runtime
codex_is_running && fail "Close Codex before installation so the engine and config.toml are updated as one offline operation."

deploy_project() {
  local temporary="$INSTALL_ROOT.installing.$$"
  local previous="$INSTALL_ROOT.previous.$$"
  /bin/rm -rf "$temporary"
  /bin/mkdir -p "$temporary"
  copy_adapter_release_tree "$PROJECT_ROOT" "$temporary"
  /bin/chmod 700 "$temporary"/*.command "$temporary"/scripts/*.sh 2>/dev/null || true
  if [ -e "$INSTALL_ROOT" ]; then /bin/mv "$INSTALL_ROOT" "$previous"; fi
  if ! /bin/mv "$temporary" "$INSTALL_ROOT"; then
    [ -e "$previous" ] && /bin/mv "$previous" "$INSTALL_ROOT"
    fail "Could not install the project at $INSTALL_ROOT"
  fi
  /bin/rm -rf "$previous"
}

if [ "$IN_PLACE" = "false" ] && [ "$PROJECT_ROOT" != "$INSTALL_ROOT" ]; then
  /bin/mkdir -p "$(dirname "$INSTALL_ROOT")"
  deploy_project
  install_args=(--in-place --port "$PORT")
  [ "$CREATE_LAUNCHERS" = "true" ] || install_args+=(--no-launchers)
  [ "$LAUNCH_AFTER_INSTALL" = "true" ] || install_args+=(--no-launch)
  exec "$INSTALL_ROOT/scripts/install-skin-macos.sh" "${install_args[@]}"
fi

# The installed copy rechecks the signed local runtime, independent of app version.
require_macos_runtime
ensure_state_root
[ -f "$CONFIG_PATH" ] || fail "Codex config not found: $CONFIG_PATH. Launch Codex once, close it, and rerun the installer."
if [ -f "$THEME_DIR/theme.json" ]; then
  "$NODE" "$INJECTOR" --check-payload --theme-dir "$THEME_DIR" >/dev/null \
    || fail "The existing external active theme is invalid; the Adapter was not applied."
fi
"$NODE" "$SCRIPT_DIR/theme-config.mjs" install "$CONFIG_PATH" "$THEME_BACKUP_PATH"

shell_quote() {
  "$NODE" -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

write_launcher() {
  local target="$1"
  local command="$2"
  if [ -e "$target" ] && ! /usr/bin/grep -q '^# CCTheme launcher$' "$target" 2>/dev/null; then
    fail "Refusing to overwrite an unrelated Desktop file: $target"
  fi
  /usr/bin/printf '%s\n' \
    '#!/bin/bash' \
    '# CCTheme launcher' \
    'set -e' \
    "$command" > "$target"
  /bin/chmod 700 "$target"
}

if [ "$CREATE_LAUNCHERS" = "true" ]; then
  printf 'Creating the local CC Theme.app launcher (official ChatGPT.app remains unchanged)...\n'
  /bin/mkdir -p "$HOME/Applications"
  "$SCRIPT_DIR/launcher-app-macos.sh" install \
    --output "$HOME/Applications/CC Theme.app" \
    --engine-root "$PROJECT_ROOT" \
    --port "$PORT" >/dev/null
  /bin/mkdir -p "$HOME/Desktop"
  verify_script="$(shell_quote "$SCRIPT_DIR/verify-skin-macos.sh")"
  restore_script="$(shell_quote "$SCRIPT_DIR/restore-skin-macos.sh")"
  screenshot="$(shell_quote "$HOME/Desktop/CC Theme Verification.png")"
  if [ -f "$HOME/Desktop/CC Theme.command" ] \
    && /usr/bin/grep -q '^# CCTheme launcher$' "$HOME/Desktop/CC Theme.command"; then
    /bin/rm "$HOME/Desktop/CC Theme.command"
  fi
  write_launcher "$HOME/Desktop/CC Theme - Verify.command" "$verify_script --screenshot $screenshot && /usr/bin/open $screenshot"
  write_launcher "$HOME/Desktop/CC Theme - Restore.command" "exec $restore_script --restore-base-theme --restart-codex"
  printf 'Created CC Theme.app. Pin it to the Dock and use it for themed launches.\n'
else
  printf 'Skipped CC Theme.app and Desktop utilities because --no-launchers was provided.\n'
  printf 'Start the themed client manually with scripts/start-skin-macos.sh.\n'
fi

printf 'CC Theme %s installed at %s for Codex %s using its signed Node.js %s.\n' \
  "$SKIN_VERSION" "$PROJECT_ROOT" "$CODEX_VERSION" "$NODE_VERSION"
if [ "$CREATE_LAUNCHERS" = "true" ]; then
  printf 'Open CC Theme.app from your user Applications folder and pin it to the Dock for one-click themed launches.\n'
  printf 'Use the Desktop utilities to verify or restore the official appearance.\n'
fi

if [ "$LAUNCH_AFTER_INSTALL" = "true" ]; then
  if [ -f "$THEME_DIR/theme.json" ]; then
    "$SCRIPT_DIR/start-skin-macos.sh" --port "$PORT" --prompt-restart
  else
    printf 'No external theme is active. Codex was left in its native appearance.\n'
    printf 'Apply a verified .cctheme package with scripts/apply-cc-theme-macos.sh before using CC Theme.app.\n'
  fi
fi
