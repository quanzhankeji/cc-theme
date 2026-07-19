# Mac-CodeX Adapter architecture

## Module ownership

Mac-CodeX contains one deep Adapter Module. Its Interface accepts externally
compiled and verified Unified Theme / `skin.theme` inputs. Its Implementation
owns Codex-specific projection, normalization, Surface interpretation, local
Runtime Overrides, and the reversible renderer lifecycle.

Production Theme Packages and catalog inventory are a separate Module owned by
CC Theme Manager. The Adapter repository and its distributions contain no
production theme identity or media.

## Interfaces

- Capability Interface: `contracts/adapter-capability.json` and
  `scripts/adapter-capability.mjs`.
- Projection Interface: `contracts/adapter-projection.json` and Codex target
  schema validation.
- Theme input Interface: `contracts/cc-theme-package.json`,
  `scripts/import-cc-theme.mjs`, `scripts/stage-theme.mjs`.
- Runtime Override Interface: `contracts/theme-style-catalog.json`,
  `scripts/theme-style-overrides.mjs`, and the serialized transaction Seam.
- Surface evidence Interface: versioned UI Surface Catalog plus privacy-safe
  Live Surface Evidence. Evidence is an apply gate, not theme data.
- Lifecycle Interface: detect, preflight, apply, verify, pause, restore,
  rollback, and cleanup.

## Engine / external input / runtime state

The fixed Engine owns renderer code and CSS variables. External Theme Package
input owns declarative values and media. Runtime State owns the current active
snapshot, local overrides, process records, and explicit pet ownership records.
These three layers never share arbitrary code, selectors, or host version facts.

The Adapter may consume a Manager-selected direct child from Manager runtime
state, but it does not discover, download, publish, or curate that inventory.
Settings → cc-theme edits only the current active theme.

## Apply Seam

1. Validate current signed Codex runtime and current Surface evidence.
2. Validate package container, manifest, target identity, entry count, sizes,
   SHA-256, safe paths, media signatures and target schema.
3. Stage an immutable target snapshot.
4. Atomically replace the active snapshot; retain the prior snapshot until the
   transaction and optional pet ownership record succeed.
5. Apply through a verified loopback CDP renderer session.
6. Verify owned markers. On failure remove owned presentation and restore the
   prior selection or native host appearance.

No fallback selects another theme.

## Settings → cc-theme

The local editor is intentionally part of the Adapter Implementation. It maps
stable Theme Style Catalog token ids to current Codex Surface Roles, previews
immediately, serializes writes, persists atomically, and rolls back invalid
updates. It follows host locale, effective appearance, focus rules, and Reduced
Motion. It does not mutate the external package or expose a downloadable theme
library.

## Release locality

`copy_adapter_release_tree` copies an explicit allowlist. A distribution scan
then rejects theme directories, installable package files, theme media and test
content. Adapter-owned renderer JavaScript and CSS are fixed implementation
assets, not theme content. The launcher uses no theme-derived icon.

Tests may use only neutral synthetic fixtures under `tests/fixtures`; this path
is absent from every release allowlist.

## Monorepo locality

The source Module lives at `adapters/mac-codex`. This is repository locality,
not machine identity: `adapterId: mac-codex`, Capability decisions, `.mac-codex`
installed engines and release names remain stable.

The Capability and Projection Interfaces are published from this Adapter's
`contracts/` directory. Schema `$id` values use the canonical
`adapters/mac-codex/contracts/` repository URL. The Implementation resolves only
Adapter-owned files from its own script location; it does not import Manager or
Shared Core source through sibling-directory paths. Manager supplies input at
the machine Interface and remains free to use a different repository layout.
