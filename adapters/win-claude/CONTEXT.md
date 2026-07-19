# Win-Claude working context

## Ownership

- Project owner: Win-Claude project lead.
- Unified Windows lead task: `019f7491-6126-7203-97e1-9ed0a5541632`.
- CC Theme client lead task: `019f7437-da59-7932-abf4-3728345ad858`.
- Peer Win-WorkBuddy task: `019f7491-69ae-76e0-90e5-75e9fb8f8e02`.

All implementation writes are confined to `win-claude/`. Changes to Shared
Core, Target Profile, Capability interfaces, `mac-app`, or other adapters must
be proposed to the unified Windows lead before any shared edit.

## Evidence labels

Every claim uses one of these labels:

- `vm-verified`: observed in the real Windows 11 VM with privacy-safe evidence;
- `static-analysis`: derived from local source/artifact inspection only;
- `unverified`: a hypothesis or required check with no sufficient evidence yet.

## Non-negotiable gate

Runtime apply remains unavailable until the exact Claude build, surface catalog,
transport, transactional apply seam, live verification, pause, and rollback are
all demonstrated as safe and reversible. Missing evidence is a failure, not a
warning.
