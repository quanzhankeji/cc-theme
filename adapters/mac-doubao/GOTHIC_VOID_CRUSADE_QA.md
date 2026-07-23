# Gothic Void Crusade — mac-doubao QA record

## Scope and source

- Theme identity: `gothic-void-crusade` / `1.0.0`.
- QA package checked on 2026-07-22:
  `themes/dist/gothic-void-crusade-1.0.0.cctheme`, SHA-256
  `31ada36fb16215ed29a01a8e0a004acd2fe394d73e3f2cc45bce36e8980e06b0`.
- Host: Doubao for macOS `2.19.9`, using the Manager bundle's verified Node
  runtime. This record does not assert a result for other hosts or versions.

## Adapter-owned result

`immersive-scene-v1` now accepts only the closed, fixed profile envelope and
uses only engine-owned role attributes. It does not accept selectors, CSS,
scripts, host paths, or arbitrary layout values.

The bounded recipe consumes:

- `text` and `textMuted` for semantic scene text only;
- `surfaceOpacity` and `textureIntensity` as bounded scene variables;
- fixed `etched`, `framed`, `anchored`, and `elevated` recipe choices through
  role-frame borders and panels; and
- `scene.backdrop` as the validated local static image.

The renderer does **not** take ownership of native font families or metrics,
icon glyphs, control interaction, focus rings, host geometry, or animation.
Those remain explicitly host-owned/unsupported rather than being implied by
the profile's role-frame paint fidelity.

## Live verification

In the light-host QA session, the imported package applied and verified with
one owned style, one owned background, 92 reconciled roles, and no video or
object URL. A chat conversation, the composer input, sidebar history rows,
and the account popover were visually checked. Text and input values rendered
in the theme's cream foreground against the dark scene frame; the host popup
remained interactive and readable. The static backdrop means reduced-motion
does not initiate media playback, and the existing reduced-motion CSS path
continues to suppress optional transitions.

## Accessibility and remaining limits

- The exact package checked here uses action `#8F6431` with foreground
  `#FFF8E9` (4.92:1). The Adapter intentionally does not repurpose these as
  a generic native button fill/foreground pair.
- No host-wide dark-mode switch was changed during QA. The role recipe uses a
  self-contained dark scene frame; a separately controlled dark-host visual
  pass remains advisable when a non-disruptive test account/session is
  available.
- Unrecognised dialogs, portals, custom controls, or DOM nodes without a
  verified `data-cc-theme-doubao-role` remain native. They are not silently
  claimed as themed. Any future stable role must receive its own bounded
  renderer mapping, CSS consumer, and regression before its capability is
  promoted.
