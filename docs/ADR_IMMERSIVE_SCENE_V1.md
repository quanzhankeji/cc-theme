# ADR: `immersive-scene-v1` Presentation Profile

**Status:** accepted for the macOS pilot: mac-codex, mac-workbuddy, and
mac-doubao.

## Context

The [Gothic Void Crusade source theme](https://github.com/Fei-Away/Codex-Dream-Skin)
achieves its appearance by injecting a large, Codex-specific CSS program through
the Chrome DevTools Protocol. Its visual language is useful: a protected reading
area over a background safe zone, layered panels, and route-aware treatment.
Its implementation is not portable: it depends on deep host selectors, structural
and locale-sensitive selectors, custom chrome, and persistent DOM observers.

CC Theme packages must not carry selectors, CSS, script, DOM geometry, or host
facts. Adapters retain ownership of their host evidence, runtime lifecycle,
native controls, focus, window behavior, and cleanup.

## Decision

Extend the existing Unified Theme contract with an **optional** `presentation`
object. Existing themes remain valid without it.

The initial profile is `immersive-scene-v1`, version `1`:

- It declares seven semantic scene surfaces: `shell`, `navigation`, `home`,
  `conversation`, `composer`, `cards`, and `overlays`.
- It accepts only bounded paint parameters, one semantic backdrop slot
  (`scene.backdrop`), static Reduced Motion fallback, and the constrained
  `scene-bounded` geometry policy.
- It rejects direct CSS, selectors, scripts, URL-like payloads, host dimensions,
  and arbitrary layout properties.
- A theme can apply only when every selected Adapter publishes the same profile
  version and an `exact` consumer decision for every declared scene surface.

An Adapter implements the profile through an internal, versioned Presentation
Recipe that uses its own Surface Catalog. Recipes may paint verified containers
and preserve normal native behavior. They may not replace title bars, window
controls, drag targets, keyboard focus, scrolling, or host-owned controls.

`gothic-void-crusade` is the first profile consumer. It uses original,
redistributable void-cathedral artwork and a dark charcoal, old-gold, and muted
red palette. No upstream text, logo, franchise asset, or source CSS is included.

## Consequences

- Presentation intent is shared; selectors and layout implementation are never
  shared across mac-codex, mac-workbuddy, and mac-doubao.
- Capability and diagnostics are evaluated per target. A missing or stale
  surface blocks this profile rather than silently applying a similar one.
- System palette, Reduced Motion, and host interaction safety may reduce paint
  locally; this is a host safety override, not a package escape hatch.
- New structural semantics require a new profile version or a new profile. They
  are not added as arbitrary theme parameters.

## Validation gate

The profile has contract tests for backward compatibility, unsafe fields, asset
binding, and missing consumers. Each macOS Adapter runs its own Surface, runtime,
style-catalog, lifecycle, restore, and native-control tests. The package is
created only after all selected targets report `exact` for the profile's required
surfaces.
