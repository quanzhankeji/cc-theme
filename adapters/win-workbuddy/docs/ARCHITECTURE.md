# Architecture baseline

## Ownership split

| Layer | Shared Interface | Windows WorkBuddy Implementation |
| --- | --- | --- |
| Theme family | Unified Theme v2, Shared Core order, visible diagnostics | `win-workbuddy-skin` Target Profile and deterministic projector |
| Capability | discovery, exact/approximate/unsupported, runtime gate | Windows identity, version Catalog, Authenticode and Seam evidence |
| Theme | declarative `skin.theme`, local media names only | Windows normalizer and fixed style snapshot interpreter |
| UI | semantic Surface Roles and Catalog versions | Windows 5.2.6 locators, landmarks, native Settings parity |
| Lifecycle | bounded operation names/results | Windows process, transport, lock, rollback and cleanup |
| Settings | WYSIWYG, auto-save, no save button | immediate preview, 180 ms debounce, monotonic revision/LWW, atomic port |
| Evidence | bounded status and stable error codes | redaction of paths, tokens, command lines and private content |

The Shared Interface does not contain Windows paths, process arguments, selectors, transport
details, registry keys, VM facts, or client version facts. The Windows implementation does not
change Unified Theme semantics.

## Data flow

1. Validate Unified Theme v2 and the `win-workbuddy-skin` Target Profile.
2. Project every present Shared Core leaf according to the versioned field-decision table.
3. Emit a diagnostic for every exact, approximate, or unsupported field; required unsupported
   fields fail projection.
4. Normalize the target `skin.theme`; unknown or executable input fails closed.
5. Run the capability gate with observed OS, executable, signature, version, Catalog and transport
   evidence.
6. Only a fully verified compile context may enter the serialized lifecycle transaction.
7. Apply Local Runtime Overrides after the base theme and Target Profile, then enforce Reduced
   Motion, High Contrast and host safety last.

Static projection fidelity and live runtime availability are separate. An `exact` projection does
not enable apply while `runtimeApplyAvailable` is false.

## Fixed interpreter

The fixed interpreter accepts only a normalized theme, a version-exact UI Surface Catalog and the
adapter-owned Theme Style Catalog. A theme cannot supply locators, CSS variables, markup, code, or
paths. The current Catalog is deliberately `identity-only`; the interpreter rejects it before any
mount or drawing work.

## Lifecycle transaction

The public Seam is `detect → preflight → install/apply → launch → verify`, plus `pause` and
`restore`. Mutating operations require one adapter lock and a pre-operation snapshot. A future
runtime implementation must prove atomic persistence and complete rollback. Until that proof is
versioned, this baseline returns `runtime-seam-unverified` without changing WorkBuddy.

Runtime ordering and release identity are separate. `rendererGeneration` is monotonic only inside
one renderer session and rejects stale writes. `artifactManifestSha256` identifies deterministic
theme/Catalog/style/media content. A settings `revision` orders the persisted settings lineage.
No generation, revision, or session nonce may stand in for a file, manifest, or archive SHA-256.
