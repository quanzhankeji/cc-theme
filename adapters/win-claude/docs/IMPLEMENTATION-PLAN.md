# Executable implementation plan

1. **Environment gate** — VM, Windows build, MSIX/ARM64 client version and
   Anthropic signature are verified. Complete process/window identity, exact
   Electron/renderer versions, and UI technology landmarks with redacted evidence.
2. **Catalog gate** — inventory Settings and chat surfaces for the exact build;
   publish semantic roles and observable native-row parity requirements.
3. **Contract gate** — finalize Target Profile, Style Catalog, `skin.theme`,
   runtime overrides, bounded operation results, and negative security vectors.
4. **Seam gate** — compare candidate Windows-only apply seams. Proceed only with
   a fixed, reversible, version-gated, serialized seam; otherwise remain
   projection-only/unavailable.

The official detached DevTools path is allowed only for a manual disposable
proof and can never satisfy gate 4 by itself.
5. **Lifecycle gate** — implement detect/preflight/stage/apply/verify/pause/restore
   with atomic snapshots and fail-closed cleanup.
6. **WYSIWYG gate** — add Settings -> CC Theme with live application, debounce,
   last-write-wins coordination, autosave, no Save button, and full native
   layout/state/motion/focus/keyboard parity.
7. **Real acceptance** — an independent tester runs clean-install, apply, live
   edit, restart persistence, pause, re-apply, restore, upgrade, rollback, reduced
   motion, keyboard, and privacy checks in the real Windows 11 VM.

Each gate must have deterministic local contract tests plus versioned VM evidence.
Later gates cannot turn green from static analysis alone.
