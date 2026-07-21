# Repository ownership and path contracts

- `app/` owns the CC Theme application. It bundles only an allowlisted Adapter runtime subset and must not copy an entire Adapter source tree.
- `adapters/` owns host-specific detection, projection, validation, application, pause, restore, and evidence. Production `presets/`, `themes/`, `theme-sources/`, and theme media are forbidden.
- `app/packages/` owns stable host-neutral Interfaces used by more than one caller. It must not contain host DOM/process implementations or production themes.
- `app/registry/` maps stable Adapter IDs to Adapter-owned capability and projector files.
- Local `catalog/` metadata is ignored with production theme assets and is not a repository Module.
- `themes/` publishes only its neutral `example/`, `tools/`, `tests/`, and README. Real theme sources, media, generated packages, and release staging remain local and ignored; reusable host-neutral contract fixtures belong in `app/packages/test-kit/`.
- `tests/` verifies repository-wide ownership, path, identity, and release gates.
- `app/scripts/` contains Manager and local development commands.

Git tracks only reproducible Adapter source inputs: source, declarative contracts/schema/catalog,
release allowlists/manifests, tests, necessary documentation, and version files. `.ccadapter`, ZIP,
runtime resources, build output, staging, generated payloads/sidecars, installed applications, and
caches are never source Modules. A public Adapter package may only be rebuilt by controlled CI from
an exact tag and uploaded as an immutable GitHub Release asset; it must never be written back into
the Git tree. If Release assets are prohibited as well, Manager online Adapter download is not an
available product Interface.

Windows Adapter work is `paused-by-user`. Existing evidence and fail-closed implementation are preserved, but Windows is excluded from active workspaces, CI, Manager resources, signing, notarization, and Release assets until the user resumes it.

The ordered compatibility boundary for publishing Adapter assets, a three-entry Manager, signed
Catalog metadata, and the stable pointer is normative in
[`ADAPTER_RELEASE_ORDER.md`](ADAPTER_RELEASE_ORDER.md).
