# Capability and Seam file plan

## Published baseline

- Capability: `contracts/adapter-capability.json` and its local schema;
- Target Profile: `contracts/windows-claude-target-profile.schema.json`;
- Compile Context: `contracts/compile-context.schema.json`;
- Style and Settings: `contracts/theme-style-catalog.json`,
  `contracts/theme-editor-locales.json`, and
  `contracts/settings-wysiwyg-interface.json`;
- Runtime Overrides/transaction: `contracts/runtime-overrides-interface.json`
  and `contracts/adapter-transaction.json`;
- UI evidence: `contracts/ui-surface-catalog.schema.json`,
  `contracts/live-surface-evidence-policy.json`, and the unverified catalog;
- lifecycle/result: `contracts/theme-lifecycle-interface.json` and
  `contracts/operation-result.schema.json`.

## Blocked files, in dependency order

1. `contracts/adapter-projection-request.schema.json` — blocked on the exact
   Manager-to-Adapter Unified Theme v2 invocation shape;
2. `contracts/adapter-projection-result.schema.json` — blocked on the same
   diagnostic normalization agreement;
3. `contracts/skin-theme.schema.json` and `scripts/skin-theme.mjs` — follow the
   approved Shared Core projection and Windows media validation vectors;
4. `scripts/project-unified-theme.mjs` — deterministic offline projection only
   after the first three contracts are approved and tested;
5. `scripts/invoke-lifecycle.ps1` — installed identity is now known, so Windows
   detect/preflight may be implemented next; mutating operations remain
   hard-disabled until a production Seam is verified;
6. `scripts/adapter-transaction.ps1` — storage/ACL/lock/atomic replace implementation
   only after a Windows runtime location and reversible Seam are proven;
7. `scripts/live-surface-evidence.ps1` — only after the real UI technology chooses
   a bounded, privacy-safe structure collector.

The blocked state is deliberate: no placeholder projector or Mac-shaped request
is allowed to create a false compile capability.
