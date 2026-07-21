# Adapter and Manager release order

This runbook is the normative publication order for adding `mac-doubao` to the signed stable Adapter
channel. It protects the already published CC Theme 0.2.0 application while newer Manager builds move
from two to three official Adapter entries.

## Compatibility boundary

- CC Theme 0.2.0 accepts at most two Adapter Catalog entries and recognizes only `mac-codex` and
  `mac-workbuddy`. It cannot consume a three-entry Catalog.
- An existing 0.2.0 installation may continue using an unexpired, previously verified sequence 1
  last-known-good Catalog after rejecting a newer incompatible pointer or Catalog.
- A fresh 0.2.0 installation without that last-known-good cache will fail its online Adapter check
  closed after stable moves to three entries. Its bundled Adapter Engines and native client launch
  remain available; an online metadata failure must not disable them.
- The published 0.2.0 Release, tag, DMG, and assets are immutable and must not be modified.
- Stable must remain on sequence 1 until a newer Manager that accepts all three official Adapter IDs
  has been published and its DMG is publicly downloadable.

## Required publication sequence

These phases are ordered. A maintainer must stop at the first failed gate and must not skip ahead.

1. **Phase 1 — source-freeze.** Freeze one reviewed commit containing the three compatible Adapter
   sources, the three-entry Manager consumer, the download/rollback implementation, and passing source
   contracts. All following tags and builds must resolve to this reviewed source state or to an
   explicitly reviewed descendant.
2. **Phase 2 — adapter-release.** Create an exact Adapter-only tag and use the controlled workflow to
   rebuild `mac-codex`, `mac-doubao`, and `mac-workbuddy`. Publish the closed three-asset draft only
   after exact-tag, cross-Release identity, byte-for-byte, and repository immutability gates pass.
3. **Phase 3 — manager-release.** Build, sign, notarize, staple, verify, and publish the new Manager DMG
   with the three-entry Catalog consumer. Confirm the public Release URL downloads the exact accepted
   DMG before changing any stable metadata. Merely creating a draft is not sufficient.
4. **Phase 4 — catalog-first.** Generate and offline-sign stable Catalog sequence 2. It must reference
   the exact immutable Adapter Release assets by tag, asset name, byte size, archive SHA-256, and
   manifest SHA-256. Commit the Catalog and detached signature first; verify their public raw URLs at
   the exact 40-character commit. This commit must not change `stable.json`.
5. **Phase 5 — pointer-second.** Only after phases 1–4 pass, offline-sign and commit the sequence 2
   stable pointer as a second commit. It must bind the exact Catalog commit, URL, byte size, SHA-256,
   key ID, validity window, and monotonically increasing sequence. Verify the public pointer and
   Catalog graph after the commit lands.

## Failure and rollback rules

- Before Phase 5, failure leaves the public stable pointer on sequence 1; no old client sees a partial
  three-entry publication.
- After Phase 5, do not overwrite an immutable Release, Catalog, signature, or pointer and do not
  decrement the sequence. Correct or revoke affected entries in a newly signed, higher sequence.
- Network or metadata failure must remain isolated from installed Adapter Engines, bundled fallback
  Engines, last-known-good state, and native client launch.
- Offline Ed25519 private key material never enters GitHub Actions, Git, logs, or Release assets.
- Claude and Windows remain outside this publication sequence.
