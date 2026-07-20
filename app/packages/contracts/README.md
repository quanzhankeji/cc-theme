# Contracts

Machine-readable CC Theme interfaces shared by the Manager, theme packages, and more than one Adapter live here. Host-specific schemas stay with the owning Adapter. `background/` contains the cross-platform background-mode Schema and state machine; neutral examples and vectors live in `app/packages/test-kit`.

`theme-package.schema.json` defines `family.json`, the manifest stored at the
root of a ZIP-compatible `.cctheme` package. Package metadata and the Unified
Theme contract have separate responsibilities: translations, licensing, asset
roles, and file digests belong to the package manifest, while semantic design
tokens remain in `unified-theme.json`. The public theme resource contract is
currently the single first version.

Public Adapter identity is currently closed to `mac-codex`, `mac-doubao`, and
`mac-workbuddy`. Shared contracts do not expose protocol aliases or local-state
migration identifiers.
