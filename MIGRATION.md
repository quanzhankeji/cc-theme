# CC Theme breaking migration

CC Theme is the new project and repository identity. This is an intentional breaking format change,
not a compatibility alias for the former project name.

## New public identity

| Boundary | New value |
| --- | --- |
| Display name | `CC Theme` |
| Repository | `quanzhankeji/cc-theme` |
| Theme extension | `.cctheme` |
| Theme MIME | `application/vnd.cc-theme.theme+zip` |
| JavaScript/environment prefix | `CC_THEME_*` |

Source modules now live under `app/` and `adapters/`; shared packages and the Registry are nested
under `app/`. Source directory names and
published Adapter IDs are separate contracts.

## What remains stable

The declarative document identities remain `skin.document`, `skin.package`, and `skin.theme`.
The only active Manager Adapter IDs are `mac-codex` and `mac-workbuddy`. `mac-claude` remains the
canonical identity inside its preserved source Module, but is not accepted by the Manager Registry,
Theme/Compile Interface, packaging, UI, or runtime resources. Pre-canonical Adapter IDs were never
published and are not Registry or protocol aliases. Codex has no local legacy state to migrate;
WorkBuddy may read its existing pre-canonical local directory exactly once and must persist only the
canonical ID afterward.

## Retired format

`.codexskin` is no longer a supported theme extension. Both macOS adapters reject it; renaming an old
file to `.cctheme` is not a migration because its MIME, package contract,
filenames, and integrity metadata still belong to the retired format.

Theme authors must rebuild and export a new `.cctheme` from source media and declarative theme data.
Old installer archives also remain historical artifacts and must not be presented as CC Theme
releases. The first CC Theme release must be rebuilt from the renamed source, receive new checksums,
and document its exact client versions.

## Release order

1. Make the Manager, two active macOS Adapters, Packages, Registry, Catalog, tests, and documentation agree on the new identity while keeping Claude source unregistered.
2. Run repository, Manager, macOS Adapter, package round-trip, release payload, and old-format rejection
   checks.
3. Commit the rebrand as one reviewable change.
4. Publish the newly built CC Theme artifact and immutable Theme/Adapter assets only after coordinated release review.
5. Publish standalone `.cctheme` themes only after a
   production local exporter creates them and both target adapters pass
   round-trip import verification; test-only package helpers are not release tooling.

Do not publish mixed archives containing both old and new transport identities.
The first release tag should use the new namespace (for example `cc-theme-v0.1.0`) because the
historical repository already contains a retired `v0.1.0` tag.

## History boundary

The Monorepo migration is local only. It does not force-push `main`, remove old tags or Releases,
rebuild/sign/notarize the Manager, or rewrite remote history. A future parentless-history switch
requires a clean final tree, two-client re-verification, and separate user approval.
