# Windows Adapter coordination archive

Last updated: 2026-07-19  
Status: **paused-by-user**

This document preserves the current Windows boundary after the CC Theme Monorepo migration. It is not an active implementation plan and does not claim Windows compatibility.

## Preserved projects

- `adapters/win-codex`
- `adapters/win-workbuddy`
- `adapters/win-claude`

Existing source and privacy-safe evidence remain in those directories so prior work is not lost. Their presence does not mean the adapters are supported, registered, packaged, released, or covered by active CI.

## Pause boundary

Until the user explicitly resumes Windows development, the repository must not:

- add Windows implementation or reverse-engineering work;
- run VM/client compatibility probes or present historical evidence as current support;
- register a Windows adapter as available in CC Theme;
- include a Windows adapter in the active workspace, CI, packaging, signing, or release flow;
- infer Windows behavior from a macOS adapter.

The authoritative current status is recorded in:

- [`COMPATIBILITY.md`](../COMPATIBILITY.md)
- [`app/registry/client-capabilities.json`](../app/registry/client-capabilities.json)
- each Windows adapter's `STATUS.md`

## Read-only distribution impact notes

Theme Manager has completed the Mac implementation of Stage 1 Adapter Release Catalog and Stage 2 deterministic `.ccadapter` packaging/offline verification. Stage 3 online installation, atomic switching and automatic rollback are frozen interface-only future work. Public schemas separate OS × client identity, architecture, Adapter version, Capability, Unified Theme and Package contracts, but current admission, catalog, builds and tests contain only `mac-codex` and `mac-workbuddy`; Claude source is unregistered and Windows release entries remain zero.

For a possible future Windows resumption:

- manifests must identify `platform`, `clientKey`, canonical `adapterId`, supported OS/architecture and exact client compatibility explicitly;
- a Mac package, signature result or compatibility record must never imply Windows availability;
- Windows Capability, Projector, Target Profile/Catalog and runtime Seam references remain OS × client owned and cannot inherit Mac implementation artifacts;
- deterministic file/package-manifest SHA-256 is release provenance and remains separate from renderer-session generation/revision;
- offline verification must reject platform/client mismatches, unknown Adapter identities and missing Windows-owned references before any future installation stage.

These are compatibility notes only. Windows adapters remain unregistered, unbuilt and untested while paused; structural conflicts may be reported as contract suggestions without modifying Manager or Mac implementations.

After an explicit user instruction to resume Windows development, each Windows Adapter must independently publish and validate before Manager admission:

- canonical `adapterId` and `VERSION`;
- Windows architecture and exact client compatibility;
- Adapter-owned Capability and release allowlist;
- Projector and Normalizer Interface contracts;
- Windows-owned package references and offline-verification evidence.

The Win lead must review these artifacts before any registry/catalog entry is added. The extensible identity syntax alone does not establish Windows availability.

## Resume gates

If Windows development is resumed, each OS × client adapter must independently establish its stable identity, signed client detection, capability and Target Profile contracts, exact-version evidence, reversible apply/restore transaction, security boundaries, tests, and release ownership. Manager registration and CI/release inclusion require a separate reviewed change after those gates pass.
