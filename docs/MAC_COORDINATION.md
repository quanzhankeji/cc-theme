# Mac Adapter coordination record

Last updated: 2026-07-21
Status: **CC Theme scope: CodeX + WorkBuddy; Doubao admission in progress; Claude paused**

This document is the coordination-level status shared by CC Theme, the two active macOS
Adapter owners, and the preserved Claude source owner. Detailed implementation evidence remains owned
by the corresponding project.

## Current CC Theme product scope

- `mac-codex` and `mac-workbuddy` are the only active Adapter identities for the current final
  prepare.
- `mac-claude` must be absent from the runtime Registry, client discovery/scanning, UI, compile and
  package entry points, installation resources, and final artifact manifest.
- `adapters/mac-claude` source and privacy-safe evidence remain in the repository with status
  `preserved-source / manager-registration-paused`; they are not deleted or presented as usable.
- Claude may submit a future registration proposal only after it has a production, machine-callable
  apply/verify/pause/restore/rollback Seam, updated Capability, and real-client QA evidence.
- Windows remains `paused-by-user`.

### Open Doubao admission P0

The user has requested `mac-doubao` as the next active CC Theme Adapter. Source registration and a
Doubao 2.19.9 Adapter exist, but the currently installed `/Applications/CC Theme.app` still packages
only CodeX and WorkBuddy Engines. The installed EVA, Terrarium, and WOLP Motion themes also declare
only `mac-codex` and `mac-workbuddy`, so their themed Doubao launch action is correctly disabled.

Admission requires all of the following before `mac-doubao` becomes an active product identity:

- current Doubao application, Browser, renderer, signature/process identity, and versioned Surface
  evidence pass fail-closed verification;
- Capability, Projector, Normalizer, Style/Surface Catalog, and the complete Manager Compile Context
  agree;
- every exact/approximated/unsupported decision is backed by a real renderer/CSS consumer and visible
  diagnostics; Schema acceptance alone is not consumption;
- video, ripple, and directional backgrounds are either implemented and tested or explicitly reduced
  to a static image/poster approximation without silent field loss;
- at least one declarative theme version explicitly targets `mac-doubao` and passes target-scoped
  compile/normalize diagnostics;
- one prepared and signed CC Theme package contains the frozen Doubao Engine and then completes real
  apply-and-launch, verify, pause, reapply, restore, rollback, and cleanup testing.

Until those gates pass, normal Doubao launch may remain available, but themed launch must stay
disabled. Claude remains excluded and Windows remains paused throughout this admission work.

## WOLP → WorkBuddy P0

- The failure was caused by a Manager/WorkBuddy Compile Context contract mismatch, not by the WOLP
  `.cctheme` package or its media.
- WorkBuddy now accepts and validates the complete nine-key Manager Compile Context, including
  `detectedClientBuild` and `surfaceCatalogId`, while keeping unsupported and unknown input fail closed.
- The frozen WorkBuddy Engine was synchronized once into Manager resources and verified file by file.
- The newly signed Manager in `/Applications` completed WOLP import, apply, verify, pause, reapply,
  restore, and cleanup against the real WorkBuddy client.
- The visible background, sidebar, title, composer, and text readability passed. Restore reproduced a
  WorkBuddy graceful-exit timeout, but the bounded termination fallback completed cleanup correctly.
- Final state was native WorkBuddy UI with no owned injector, port 9342 listener, or watcher remaining.

The WOLP/WorkBuddy freeze is lifted for the current verified local build. This does not establish
compatibility with a future WorkBuddy version; normal Surface admission and fail-closed upgrade gates
continue to apply.

### Open WorkBuddy startup P0

The current verified Engine remains usable, but a new Adapter-owned startup P0 is open for the
WOLP video path. The existing cold-start sequence can create a static one-shot generation followed by
a watcher video generation; a surviving prior watcher can add a third competing generation. The
renderer also waits for a complete video fetch before creating a Blob, and `verifySession` can report
success while playback is still loading or paused because WorkBuddy has not reached the foreground.

The WorkBuddy owner has ACCEPTED the repair with these gates:

- one long-lived watcher/media-server generation owns the first video injection;
- visible, non-Reduced-Motion, non-user-paused startup requires both `videoReady=true` and `playing`;
- background, Reduced Motion, and user pause produce explicit structured degradation states;
- Manager-to-WorkBuddy foreground handoff is verifiable;
- old watcher competition and a static-first video generation are regression failures;
- trusted loopback Range streaming is evaluated without weakening token/path/codec/source checks;
- real WOLP cold-start first-frame, CPU, apply/verify/pause/reapply/restore/cleanup evidence is required.

The signed Manager real cold-start baseline is approximately 19 seconds from Apply click to a new
WorkBuddy Electron main process, 21 seconds to CDP/theme-installed with `videoReady=false`, and 33.4
seconds to `videoReady=true` plus `playing`. The first interval supports the residual-process cleanup
hypothesis; the following 12.4 seconds supports the static-first/video-second generation hypothesis.
Final acceptance requires ten clean cold-start runs with P50/P95 for host launch, CDP readiness, first
generation, first video frame, ready/playing, and foreground handoff. Residual process identity must be
based on signed executable path/process ownership rather than UI name alone.

Until the owner publishes frozen Engine hashes and a `Manager-ready-to-sync` signal, Manager may add
per-client progress feedback but must not change the bundled WorkBuddy Engine or treat progress UI as
runtime success.

### Open CodeX startup/generation P0

The CodeX owner has ACCEPTED an Adapter-owned lifecycle repair. The current cold-start path can issue
two LaunchServices `open -na` requests plus a direct executable fallback before process visibility is
settled. Hot reapply can also let the watcher and a separate one-shot injector transfer media to the
same renderer document/generation concurrently.

The repair is limited to `adapters/mac-codex` and must:

- use one bounded, verifiable LaunchServices request and wait for its process before fallback;
- bind CDP to the signed process tree created or selected by that request;
- enforce per-renderer-document/generation single-flight media transfer;
- reject a late commit from an obsolete generation;
- replace fixed startup sleeps with bounded readiness handshakes without weakening signature, port,
  Surface admission, apply, verify, or restore gates;
- cover cold launch, fallback, load-event races, hot reapply, timeout/failure, real lifecycle, CPU, and
  first-frame behavior.

CodeX `26.715.31925-r1` is still an unpublished development asset. This lifecycle fix will rebuild
that development revision in place rather than create an unnecessary `r2` migration. The previous
development hashes become invalid when it is rebuilt; it will not enter Manager until new frozen
Engine hashes and a `Manager-ready-to-sync` signal are published.

Claude source remains `runtimeApplyAvailable=false` and `official-cdp-auth-required`, but it is no
longer part of the current Manager Registry or product surface. This cross-Adapter review records
per-document/generation single-flight as a future production-Seam requirement only; it does not
authorize dormant media implementation, runtime activation, or Manager synchronization.

## Adapter distribution

### Public version policy — accepted

- An Adapter's public `adapterVersion` is exactly the supported host application's
  `CFBundleShortVersionString`.
- The exact host `CFBundleVersion`/build remains compatibility evidence and Compile Context input; it
  is not appended to `adapterVersion`.
- Before the first public Adapter release, the current development `adapterReleaseRevision` may be
  rebuilt in place. Every rebuild must regenerate archive/package manifests, sidecars, Catalog
  evidence, and hashes; prior development hashes immediately become invalid and must not be mixed
  with the new Engine.
- Starting with the first public release, a published revision is immutable. Repeated fixes for the
  same host ShortVersion must increment the positive integer `adapterReleaseRevision` and must never
  overwrite an existing release asset.
- Distribution identity is the tuple `adapterId + adapterVersion + adapterReleaseRevision + OS + arch`.
- Version equality never bypasses Capability, signature/process evidence, Surface admission, or the
  runtime apply gate.

Active owner baselines are `mac-codex` 26.715.31925 (host build 5551) and `mac-workbuddy` 5.2.6
(host build 5.2.6). CodeX evidence matches the current host, and WorkBuddy keeps its verified WOLP
Engine/gates. Preserved Claude source records host 1.22209.3, but that identity is not an active
Manager Adapter version or release candidate.

### Stage 1: Release Catalog — accepted

- Catalog records bind canonical Adapter identity, OS, architecture, version, exact archive name, byte
  count, archive SHA-256, and package-manifest SHA-256.
- Published records require HTTPS and are revalidated against the actual archive and its internal
  `adapter.json`; hashes are integrity evidence, not publisher identity.
- Windows entries remain zero while Windows development is `paused-by-user`.

### Stage 2: deterministic `.ccadapter` package — accepted

- Packages contain Adapter Engine capability, contracts, compatibility evidence, Projector,
  Normalizer, and runtime Seam only.
- Production themes, presets, theme media, test fixtures, staging content, symbolic links, unsafe paths,
  collisions, disguised media/archive files, and retired public IDs are rejected.
- Each package can be verified offline and its Projector/Normalizer can be loaded from the extracted
  payload.
- The implementation was added under `app/` without changing the Engine bundled in the Manager used
  for the WOLP real-client acceptance test.

2026-07-19 historical Stage 1/2 local macOS ARM64 artifact identities:

| Adapter | Archive SHA-256 | Manifest SHA-256 |
| --- | --- | --- |
| `mac-codex` | `e260c0c99450e6707ec882d6318fdac573c9f2da23bff0c1658b3ca1c379fa80` | `bdce6ff8c297a18cf4c0cb0671570b2d652714371d5fbd7c23699205bfd5e232` |
| `mac-claude` | `9d89f5725686474eb14021ba328c762380c3ca32134cfb7e63c22f6e01f4b009` | `b88f507bf060efef4b6cf02572f40fdaa38a40bc984f1098abac175ceffa6aee` |
| `mac-workbuddy` | `66a5e3a0b9c587ae9a31219deb074fd08f8866f7bc5e12d3a7564fddcd67951d` | `1f20d568008fb710cc59abb5a699a3dada5b23f3659d260d9809eb5c34094c07` |

The Claude row is retained only as historical development evidence for the completed packaging
experiment. It must not be copied into the current Catalog, final prepare, Manager resources, or
release output. Active CodeX/WorkBuddy development rebuilds replace their old development hashes.

Acceptance evidence: Manager Node 48/48, UI 21/21, Rust 49/49, typecheck/build/Cargo check/fmt,
repository contracts 18/18, and Shared/Registry 5/5 passed; independent QA result was ACCEPT.

## Gates that remain closed

- Stage 3 secure download, verification, installation, activation, health check, atomic rollback, and
  trusted Catalog signing are design-only and must not be presented as available.
- The current Manager continues to use its bundled verified Engine; `.ccadapter` packages are not yet
  activated at runtime.
- `mac-claude` is excluded from the current Manager and remains preserved source with
  `runtimeApplyAvailable=false`.
- This work does not complete notarization or a new formal DMG release.
- Stable-token/base-hash production rebase/quarantine and the cross-process single-transaction Seam
  remain outside the completed scope.
- Windows Adapter development remains paused until the user explicitly resumes it.

Detailed distribution design and evidence are maintained in
[`app/docs/adapter-distribution-progress.md`](../app/docs/adapter-distribution-progress.md) and
[`app/docs/adr/0001-adapter-distribution.md`](../app/docs/adr/0001-adapter-distribution.md).
