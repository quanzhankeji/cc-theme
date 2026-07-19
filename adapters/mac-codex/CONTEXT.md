# Mac-CodeX Adapter context

This document defines the local domain language and repository locality for the
Mac-CodeX Adapter Module. Cross-product theme semantics remain owned by CC Theme
Manager; this file only records the Codex-specific Interface and Implementation.

## Stable identity and locality

- Monorepo source location: `adapters/mac-codex`.
- Stable Adapter and Capability identity: `mac-codex`.
- Installed engine directory: `.mac-codex`.
- Source release root: `mac-codex`.
- Asset identity: `<adapterId>-<adapterVersion>-r<adapterReleaseRevision>-<os>-<arch>`.
- Source artifact: `<assetIdentity>.zip`.
- Client artifact: `cc-theme-<assetIdentity>.zip`.

Moving the source directory must never migrate runtime state, rename a machine
Interface, or change package identity. Scripts resolve Adapter-owned files from
their own location; they do not assume a checkout path or reach into sibling
Modules.

Theme, IPC and package Interfaces accept only the canonical Adapter identity.
The Adapter publishes no alternate-id list and provides no alias migration
reader.

`adapterVersion` is exactly the supported host `CFBundleShortVersionString`.
The precise host build belongs only to compatibility evidence and Manager
compile context. Repeated Adapter fixes under one ShortVersion increment the
positive `adapterReleaseRevision`; a published revision is immutable.

## Module ownership

The Adapter Module owns:

- Capability and Projection Interfaces for `adapterId: mac-codex`;
- the target `skin.theme` Schema, normalizer, media validation and staging;
- Theme Style Catalog, UI Surface Catalog and privacy-safe Surface evidence;
- Settings → cc-theme deep editing and Local Runtime Overrides;
- apply, verify, pause, restore, rollback and cleanup Seams.

CC Theme Manager owns Shared Core authoring semantics, Theme Package inventory,
production presets and production media. Manager calls the Adapter through its
published machine-readable Interface. Mac-CodeX does not import Manager source
files or use a relative path into another Module.

## Runtime layers

- **Engine**: fixed Codex-specific renderer and validation Implementation.
- **External Theme Package**: declarative input selected outside this Adapter.
- **Runtime State**: active snapshot, local overrides, process records and
  explicit pet ownership records on the user's machine.

Without a validated external theme, the Adapter restores or preserves the
native Codex appearance. It never selects a bundled fallback theme.

## Maintenance invariants

- Stable token changes update Projection, target Schema, normalizer, renderer,
  Settings editor, locale Catalog and tests together.
- Current Codex Surface evidence is required for apply admission; always-latest
  launch policy does not make stale Surface evidence valid.
- Theme input cannot carry CSS, JavaScript, HTML, Shader, selectors, commands,
  URLs, absolute paths or host-version facts.
- Production Theme Packages and media never enter this source Module or its
  releases. Tests use only small neutral fixtures under `tests/fixtures`.
- Reduced Motion and host accessibility decisions remain runtime authorities.
