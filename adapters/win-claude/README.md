# CC Theme Adapter for Claude Desktop on Windows 11

`win-claude` is the independent Windows 11 adapter project for Claude Desktop.
It reuses CC Theme's declarative product interfaces, but owns every Windows- and
Claude-specific fact: client discovery, process lifecycle, UI surface evidence,
runtime transport, apply/verify/pause/restore seams, and rollback.

## Current status

**`paused-by-user`** — preserved for reference only. This project is excluded from active workspace, CI, Manager resources, signing, notarization, and Releases. No further implementation or VM validation is authorized while paused.

- Project skeleton: created.
- Windows 11 platform: Parallels Desktop 26.4.0, Windows 11 Pro ARM64 build
  26100.
- Claude Desktop: official Microsoft Store/MSIX ARM64 build `1.22209.0` is
  installed and running; the Anthropic signature is valid.
- Host shell evidence: `app.asar` uses `.vite/build/index.pre.js`. Exact Electron
  and remote-renderer versions, live UI surfaces, and a safe production runtime
  seam remain unverified.
- Runtime apply: disabled. The adapter fails closed until a reversible seam is
  proven in the real Windows 11 VM.

No macOS process, path, injection, DOM, transport, or recovery implementation is
copied into this project.

## Boundaries

- Theme inputs are declarative data only.
- Arbitrary CSS, JavaScript, HTML, Shader code, selectors, commands, URLs, and
  arbitrary or absolute paths are forbidden.
- Host facts belong to this adapter and versioned compatibility evidence, never
  to a theme.
- Settings -> CC Theme is WYSIWYG, autosaves each accepted change, and has no
  Save button. Native layout, state, animation, focus, and keyboard parity must
  be proven in the real client before release.

See `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION-PLAN.md`, and
`docs/ACCEPTANCE.md`.

## Current executable gate

The lifecycle entry is intentionally non-mutating until the Windows seam is
verified. It returns bounded JSON and exit code `2`:

```text
node scripts/theme-lifecycle.mjs apply
node scripts/theme-lifecycle.mjs launch
node scripts/theme-lifecycle.mjs verify
node scripts/theme-lifecycle.mjs pause
node scripts/theme-lifecycle.mjs restore
```

No command currently claims that a theme is visible. The future live visual gate
requires all three signals: an adapter-owned `CC Theme` Settings entry, a visible
theme surface change, and a live marker bound to theme ID, base hash, and revision.

The official `CLAUDE_DEV_TOOLS=detach` path may be used for a one-time manual,
fully removable proof. It is explicitly not a production apply mechanism; see
`docs/DEVTOOLS-PROOF.md`.
