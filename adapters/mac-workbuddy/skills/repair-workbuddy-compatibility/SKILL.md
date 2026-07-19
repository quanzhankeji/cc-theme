---
name: repair-workbuddy-compatibility
description: Instruction-only workflow for repairing mac-workbuddy after a WorkBuddy client update or DOM/UI drift. Uses content-free live-surface evidence, classifies adapter landmark, theme contract, and visual verification failures, and updates only the versioned Adapter/Catalog layer.
---

# Repair WorkBuddy compatibility

This Skill is instruction-only. Do not mutate the live client, apply a theme, or edit a compatibility file until the user has authorized that action. Never copy selectors into a theme.

## Preserve the architecture boundary

- The fixed UI Interpreter owns traversal, role reconciliation, controlled style bindings, cleanup, and Reduced Motion behavior.
- A version-scoped UI Surface Catalog is the only place for WorkBuddy DOM landmarks, anchors, targets, mounts, and semantic-role mappings.
- The Style Catalog maps semantic roles to allowlisted paint variables. Themes contain media and allowlisted values only: no selector, arbitrary CSS/JS, URL, HTML, shader, or host geometry.
- Evidence from `injector.mjs --inspect` must have `kind: workbuddy.surface-evidence` and `privacy: content-free`. Reject evidence containing page text, input values, accessible names, window titles, URLs/query/hash, links, or media sources.

## Classify before editing

1. **Adapter landmark failure — `adapter-landmark-failure`**: the verified WorkBuddy renderer is present, but identity landmarks, a required anchor/target/mount, or the minimum role count is missing. Update or add the version-specific UI Surface Catalog and its Adapter tests. Do not edit a theme.
2. **Theme contract failure — `theme-contract-failure`**: offline check, stage, import, media integrity, size, palette, or mutual-exclusion validation fails. Repair only the theme/package or the fixed contract validator. Never add a selector to make validation pass.
3. **Visual verification failure — `visual-verification-failure`**: Adapter landmarks and theme validation pass, but a supported surface remains opaque, unreadable, incorrectly layered, or fails cleanup/Reduced Motion. Add a semantic role or controlled paint binding through the versioned Catalog/Style Catalog, then verify the fixed Interpreter behavior. Do not change native Sidebar, chat, panel, Composer, modal, or control dimensions.

## Evidence and repair sequence

1. Record the signed WorkBuddy version and supported renderer identity without recording window title or URL.
2. Capture content-free evidence with `node scripts/injector.mjs --inspect --port <loopback-port>`. Store it only in a private temporary run directory; do not commit it.
3. Run offline preflight. If it fails, classify `theme-contract-failure` and stop before live mutation.
4. Compare stable roles/classes, parent-child structure, counts, geometry, interaction state, and necessary computed styles with the current version Catalog.
5. Make the narrowest version-scoped Catalog/Adapter change. A new WorkBuddy version gets a new compatibility directory; never broaden an old version silently.
6. Regenerate Catalog documentation, run all tests and Doctor, then verify main shell, sidebar, Composer, one dense page, side/bottom panel, one popover and one modal. Verify light/dark, pause, restore, disabled background, and Reduced Motion as relevant.
7. Report the classification code separately from contract and visual results. A screenshot is visual evidence only and must be reviewed for user content before sharing.

If the privacy-safe evidence cannot identify a stable landmark, report `adapter-landmark-failure` and request a local visual inspection; do not fall back to text matching, accessible-name matching, or theme selectors.
