# Mac-CodeX contracts

These contracts are published from `adapters/mac-codex/contracts`. Repository
location is not part of the stable machine identity: every invocation continues
to use `adapterId: mac-codex`. Manager and Shared Core callers consume these
published Interfaces and must not depend on a sibling checkout path.

`mac-codex` is the only accepted Adapter identity. Contracts do not expose an
alias list, and the package importer does not provide alternate-id reads.

Machine-readable Adapter contracts live here:

- `adapter-capability.json`: per-field support and diagnostics;
- `adapter-projection.json`: Shared Core and Target Profile projection rules;
- `adapter-release-manifest.json`: fixed Manager/runtime release allowlist;
- `target-profile.schema.json`: Codex-only white-listed semantics;
- `skin-theme.schema.json`: the sole compiled target contract;
- `cc-theme-package.json`: external portable package container;
- `theme-style-catalog.json`: local deep-edit token catalog;
- `runtime-override-transaction.json`: serialized local writes;
- `theme-editor-locales.json`: host-locale-following editor strings;
- `live-surface-evidence.json`: privacy-safe evidence;
- `theme-lifecycle-result.json`: lifecycle result semantics.

This directory contains no production theme document, preset manifest or media.
Contract examples belong in neutral test code or `tests/fixtures`, which are
excluded from release. Theme identity and production assets belong to the
independent CC Theme Theme Package/catalog Module.
