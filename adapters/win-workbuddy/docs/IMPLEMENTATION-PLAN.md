# Risk-ordered executable plan

## Phase 0 — complete baseline

- Keep the proposed Adapter ID local until Win and CC Theme leads approve registration.
- Run static projector, normalizer, capability gate and privacy tests on every change.
- Keep `runtimeApplyAvailable=false` and the live Catalog at `identity-only`.

## Phase 1 — read-only live surface discovery

1. Capture signed executable identity and exact version with the bounded probe.
2. Discover a local-only control channel without altering the installed app or user profile.
3. Bind the channel to the signed WorkBuddy main process and an exact renderer identity.
4. Inventory Windows 5.2.6 page families, Settings navigation, dialogs, portals, webviews and
   keyboard focus behavior. Record role cardinality and privacy-safe screenshots/hashes.
5. Publish a new Catalog version; do not edit Catalog v0 evidence in place.

Exit: independent acceptance can reproduce landmarks without reading conversations or account
data.

## Phase 2 — reversible proof Seam

1. Add a fixed, version-pinned interpreter; the theme supplies values only.
2. Apply a harmless canary to an adapter-owned marker and verify it from the live renderer.
3. Pause and restore, then verify official appearance and absence of adapter artifacts.
4. Exercise crash, stale renderer, wrong version, wrong signature and partial-cleanup paths.

Exit: apply/pause/restore succeeds repeatedly and rollback is complete. Otherwise remain closed.

## Phase 3 — Settings → CC Theme

1. Clone the adjacent native navigation item's element type, layout metrics, roles, states and
   transition contract through the fixed interpreter.
2. Verify hover, pressed, selected, focus-visible, disabled, light/dark, 100/125/150% scale,
   keyboard traversal and Reduced Motion.
3. Implement immediate preview, 180 ms debounced atomic save, monotonic revision/LWW and
   three-state rollback. There is no save button.
4. Run screen and keyboard parity snapshots beside the actual adjacent native entry.

Exit: independent acceptance finds no adapter-specific layout or interaction deviation.

## Phase 4 — controlled runtime enablement

- Change the version Catalog to verified and `runtimeApplyAvailable` to true in the same reviewed
  change as transport, cleanup and VM evidence.
- Re-run the full field projection matrix for `system`, `adaptive`, and `custom`.
- Submit any Shared Interface change as a proposal before touching the registry or Manager.
