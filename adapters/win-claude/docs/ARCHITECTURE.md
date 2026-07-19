# Architecture baseline

## Reusable interfaces

Win-Claude may reuse these product meanings as data contracts:

1. Shared Core semantic tokens, background modes, and accessibility policy;
2. adapter-owned Target Profile validation and projection diagnostics;
3. stable style token IDs plus base-theme hash for Local Runtime Overrides;
4. detect, preflight, install, apply, launch, verify, pause, and restore lifecycle
   meanings;
5. bounded, privacy-safe operation results and fail-closed capability decisions.

## Windows-owned adapter boundary

The adapter must independently implement and prove:

- Windows installation and version discovery;
- Authenticode/package identity verification;
- process and window discovery;
- the actual Claude UI technology and surface landmarks;
- fixed rendering/attachment transport;
- serialized stage/apply/verify/rollback transaction;
- pause and official-appearance restore;
- Windows links, junctions, reparse points, ACLs, atomic replacement, and cleanup;
- live evidence collection and redaction.

No macOS process name, bundle path, launch argument, injection transport, DOM
landmark, filesystem location, or restore procedure is a valid Windows fact.

## Verified Windows host gate

The official Windows `1.22209.0` MSIX/ARM64 shell is `app.asar`-backed and uses
`.vite/build/index.pre.js`. Remote-debugging port/pipe startup terminates unless
the official authentication verifier accepts a fresh three-segment token bound
to the selected user-data directory and signed by Anthropic's Ed25519 key.
Win-Claude does not create, request, copy, forge, replay, or bypass that token.

`CLAUDE_DEV_TOOLS=detach` is an official interactive developer-tools path. A
manual Console proof through that path is evidence that the renderer can be
temporarily styled by an operator; it is not evidence of an automated,
authenticated, reversible production transport and cannot open the capability
gate by itself.

## Precedence

`Shared Core -> Win-Claude Target Profile -> Local Runtime Overrides -> runtime
accessibility and host safety downgrade`.

The final layer always wins. A missing transaction seam, stale base hash,
unrecognized surface catalog, Reduce Motion, or failed live probe can only reduce
capability. It cannot be overridden by theme data.

## Runtime ordering versus artifact provenance

Runtime ordering and release identity are separate namespaces:

- `sessionNonce`, `generation`, and `revision` are scoped to one renderer
  session. They coordinate preview acknowledgements and latest-write-wins only
  when the session nonce matches. Values from different renderer processes or
  sessions are not comparable.
- `fileSha256`, `manifestSha256`, and `archiveSha256` identify exact staged files,
  canonical release manifests, and release archives. These deterministic digests
  support installation checks and release provenance across processes.

A session nonce, generation, or revision can never be serialized as a release
digest. A SHA-256 digest can never decide renderer message ordering.
