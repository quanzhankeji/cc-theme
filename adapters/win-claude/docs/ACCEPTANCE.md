# Windows 11 acceptance baseline

Release requires independent, real-VM evidence for all items below:

- exact supported Claude version and trusted package identity;
- capability gate blocks unknown versions and missing landmarks;
- Settings -> CC Theme matches adjacent native rows in layout, properties,
  state, animation, focus order, keyboard activation, and accessibility naming;
- every accepted edit is visible immediately and autosaved without a Save button;
- restart preserves compatible overrides; a base-hash mismatch quarantines them;
- theme data rejects executable content, selectors, commands, URLs, absolute
  paths, traversal, symlinks, junctions, and reparse points;
- apply/verify/pause/re-apply/restore are serialized, reversible, and truthful;
- failed verification restores the last known-good snapshot or reports a partial
  cleanup failure;
- Reduce Motion and runtime safety downgrade retain a readable static theme;
- evidence exports contain no conversation, account, token, private path, or
  media bytes.

If no safe reversible seam is found, the correct acceptance result is
`runtimeApplyAvailable=false`.
