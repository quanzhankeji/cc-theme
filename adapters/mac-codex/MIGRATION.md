# Repository ownership migration

Mac-CodeX now owns only the Codex Adapter Module. Production Theme Packages,
catalog inventory, authoring workflows and theme media are owned by the
independent CC Theme resource layer.

Existing user runtime state is intentionally untouched. Previously downloaded
themes, active snapshots, Runtime Overrides, private media and pets remain on
the user's machine. A new Adapter install adds no default theme; without an
external active input it preserves the native Codex appearance.

The source module now lives at `adapters/mac-codex` in the monorepo. This is a
repository-layout change only: the stable Adapter identity remains
`mac-codex`, and the installed engine directory remains `.mac-codex`.

Adapter identity is intentionally strict. External Theme Packages, Manager
invocations and runtime transactions must use `mac-codex`; this Adapter does
not publish alternate ids or provide a migration reader. Recompile any package
that does not carry the canonical id before importing it.

The public Adapter version now equals the supported Codex ShortVersion. Build
numbers remain compatibility evidence only. Artifact names include the Adapter
id, ShortVersion, positive release revision, OS and architecture; publishing a
new fix requires a new revision instead of replacing an existing artifact.
