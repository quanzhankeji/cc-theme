# Gothic Void Crusade — mac-workbuddy QA record

## Scope and source

- Theme identity: `gothic-void-crusade` / `1.0.0`.
- QA package checked on 2026-07-22:
  `themes/dist/gothic-void-crusade-1.0.0.cctheme`, SHA-256
  `31ada36fb16215ed29a01a8e0a004acd2fe394d73e3f2cc45bce36e8980e06b0`.
- Host: WorkBuddy for macOS `5.2.6`. This record does not assert a result for
  other WorkBuddy versions, embedded webviews, or uncatalogued documents.

## Adapter-owned result

`immersive-scene-v1` repeats the closed Shared Core presentation envelope in
the standalone normalizer. It accepts no selectors, CSS, scripts, host paths,
or layout directives. `scene.backdrop` must bind the validated theme image.

The bounded renderer recipe consumes every accepted presentation parameter:

- `density`, `borderTreatment`, `navigationTreatment`, `composerTreatment`,
  and `cardTreatment` select the fixed v1 paint recipe; and
- `textureIntensity` (`0`–`1`) and `surfaceOpacity` (`0`–`1`) are
  validated numeric values written into an owned style element and consumed by
  the scene card, composer, navigation, and overlay paint.

This adds paint only. It neither changes the host layout nor replaces native
window controls, focus semantics, keyboard handling, or unrecognised nodes.

## Live verification

A fresh restore → apply → verify session used 66 reconciled renderer roles.
The following real surfaces were checked:

- Settings modal (`1040×720`), account popover, action menu/listbox: dark
  Gothic surfaces, cream primary text, muted secondary text, etched gold edge,
  and bounded shadow;
- composer (`722×70`): default/focused text, caret, placeholder, and Chinese /
  English input; and
- CC Theme colour wells and text fields: normal input and focus behavior
  remained usable.

The session used the static image path, so no video playback was started. The
existing reduced-motion path remained static. Final `restore` returned the
host to native appearance and removed the injector state, watcher, and CDP
listener on port 9342.

## Accessibility and remaining limits

- The current source uses action `#8F6431`, hover `#795021`, pressed
  `#70482B`, and foreground `#FFF8E9`. Their foreground contrast ratios are
  respectively `4.921:1`, `6.658:1`, and `7.490:1`, satisfying the theme's
  declared `4.5:1` minimum for these button states.
- Uncatalogued portals, third-party webviews, and nodes without a verified
  `data-workbuddy-skin-role` remain native. A future surface must first obtain
  stable evidence, an owned role, a bounded consumer, and a regression before
  it can be represented as supported.
- This source change alters the unpublished `5.2.6-r4` Adapter bytes. It must
  receive a new qualified Adapter package/release before it can enter a
  signed Manager runtime; it must never overwrite an already published
  immutable Adapter identity.
