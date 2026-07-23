# Changelog

## Mac-CodeX 26.715.71837 r3 — Unreleased

- Added the adapter-owned `immersive-scene-v1` presentation recipe.

## Mac-CodeX 26.715.71837 r1

- Defined Mac-CodeX as a reversible Codex Theme Adapter.
- Added external package validation, target projection, current Surface
  admission, local WYSIWYG Runtime Overrides and lifecycle rollback.
- Moved production Theme Package identity, authoring, catalog inventory and all
  theme media out of the Adapter repository and distributions.
- Added explicit release allowlists and repository/distribution ownership scans.
- Changed empty-state fallback to the native Codex appearance.
- Moved the source module to `adapters/mac-codex` without changing the stable
  `mac-codex` Adapter id or the `.mac-codex` installed engine name.
- Removed non-canonical Adapter-id read paths. Theme, IPC and package inputs now
  accept only `mac-codex` and expose no alias list.
- Aligned public Adapter versioning with Codex `CFBundleShortVersionString` and
  introduced immutable positive release revisions for macOS arm64 artifacts.
- Bound cold launch to one LaunchServices request and one newly observed,
  signed Codex process tree before accepting its loopback CDP listener.
- Added per-document renderer generations so initial attach, navigation and hot
  reapply share one media-transfer flight and superseded generations cannot
  commit late.
- Replaced fixed startup delays with bounded process, renderer and media
  readiness handshakes, including deterministic cleanup when a DevTools
  WebSocket delays its close handshake.
