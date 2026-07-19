# Win-Claude adapter contracts

This directory owns Windows Claude adapter data interfaces. It may consume the
CC Theme Shared Core shape and normalized lifecycle meanings, but does not share
macOS process, path, injection, DOM, transport, or rollback implementation.

Baseline contracts:

- `adapter-capability.json`: current evidence-backed capability gate;
- `adapter-capability.schema.json`: raw Adapter capability validation;
- `windows-claude-target-profile.schema.json`: adapter-owned declarative profile;
- `theme-style-catalog.json`: stable editor tokens and semantic surface roles;
- `ui-surface-catalog.schema.json`: versioned, privacy-safe client evidence;
- `runtime-overrides-interface.json`: precedence, base-hash, WYSIWYG, and LWW policy;
- `adapter-transaction.json`: single-lock, atomic snapshot, and rollback contract;
- `theme-lifecycle-interface.json`: normalized operations and transaction phases;
- `operation-result.schema.json`: bounded lifecycle result;
- `live-surface-evidence-policy.json`: evidence allowlist and privacy denylist.
- `host-evidence.schema.json`: privacy-safe host identity/auth-gate evidence;
- `runtime-seam-candidates.json`: ranked, evidence-labelled candidate decisions;
- `runtime-seam-evidence.schema.json`: closed static evidence for extension,
  preload, and official DevTools reachability;

Projection request/result, Compile Context, and the target `skin.theme` schema are
planned but intentionally not published in this baseline. Capability therefore
keeps both compilation and validation unavailable. Their exact Shared Core v2
boundary requires agreement with the Windows and CC Theme leads; Win-Claude will
not copy the older Mac-Claude projection request shape as a substitute.

All objects close unknown fields. Theme-authored executable content, selectors,
commands, URLs, and arbitrary paths are forbidden.
