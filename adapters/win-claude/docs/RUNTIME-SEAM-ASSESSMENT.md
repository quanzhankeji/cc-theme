# Windows Claude 1.22209.0 runtime Seam assessment

## Decision

No new production injection Seam is available. The unpacked-extension command
line candidate is a static failure and must not be run against the VM.

## A. Unpacked extension / content script

Chromium source contains the `--load-extension` switch and code for command-line
unpacked extension loading. That is not sufficient evidence for packaged Electron:

- Electron's documented extension entry is the main-process
  `session.extensions.loadExtension(path)` API;
- Electron warns that unsupported command-line switches have no effect;
- Claude `1.22209.0` has five `loadExtension` occurrences, attributable to React
  DevTools/electron-devtools-installer and Anthropic DXT installation flows;
- no `--load-extension`, `disable-extensions-except`, `content_scripts`, or generic
  official extension-loader hook was observed.

Therefore a CLI unpacked-extension marker proof has no supported loader and is
not authorized. There is no minimal VM launch command for A. The bounded fixture
under `proofs/electron-extension/` remains inactive so its permissions and cleanup
can be reviewed if Claude later publishes a generic hook.

React DevTools profile fallback and DXT/MCP permissions are purpose-specific,
privileged surfaces. They must not be repurposed for themes.

Primary references:

- Electron Chrome Extension Support:
  https://www.electronjs.org/docs/latest/api/extensions/
- Electron supported command-line switches:
  https://www.electronjs.org/docs/latest/api/command-line-switches
- Chromium command-line extension loader:
  https://chromium.googlesource.com/chromium/src/+/master/chrome/browser/extensions/extension_service.cc
- Chrome content-script isolation and match patterns:
  https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

## B. Official CLI/env, DevTools extension, or preload

- `CLAUDE_DEV_TOOLS=detach` is reachable but remains an interactive disposable
  proof, not a serialized automated transport.
- Electron's `session.extensions.loadExtension` and preload registration are
  main-process APIs. Claude exposes no generic caller for CC Theme.
- The observed preload `webFrame.insertCSS` call injects fixed scrollbar CSS and
  accepts no external theme parameter. Its existence is not a parameterized Seam.
- No official Claude theme CLI/environment variable is verified.

App package edits, React DevTools fallback, DXT/MCP permissions, preload
replacement, Node inspector, DLL injection, or CDP auth bypass are rejected.

## C. System appearance / forced dark

`--force-dark-mode` or an already-selected Windows dark appearance may provide a
limited visual experiment if the verified executable accepts the Chromium switch.
It has no owned marker and cannot express CC Theme colors, fonts, background,
Settings entry, or lifecycle.

Minimal process-scoped template, not executed by this project:

```powershell
& $VerifiedClaudeExecutable '--force-dark-mode' "--user-data-dir=$OwnedTemporaryProfile"
```

Preconditions: exact signed executable, Claude fully exited, a newly created owned
temporary profile with no account data, and no persistent shortcut/environment
change. Expected marker: none. A visible dark result is only
`approximated-dark-only`; no change means the switch is unsupported/ignored.

Cleanup: exit Claude, reject any reparse point below the owned temporary profile,
delete that profile, cold-start normally without switches, and confirm the prior
appearance returns. This candidate cannot open `runtimeApplyAvailable`.

## Permanently rejected

- modifying `app.asar` or any WindowsApps package file;
- breaking/replacing certificates or signatures;
- forging, copying, replaying, or bypassing CDP authentication;
- DLL injection, Node inspector, or preload replacement;
- React DevTools profile fallback or DXT/MCP permission reuse;
- HTTPS proxying, TLS interception, or ignored certificate errors.
