# Independent Windows 11 VM test matrix

All rows start `unverified` and require an implementer-independent result.

| Area | Required vectors | Pass gate |
| --- | --- | --- |
| VM/control | exact VM, guest build/arch, Tools, session ambiguity, guest exec, UI control | one unambiguous target and bounded evidence |
| Package identity | absent, trusted, unsigned, wrong publisher, EXE/MSIX/AppX/Store | exact version, publisher, signature, hash, scope |
| Process/UI identity | process tree, binary signature, window owner, modules/framework | real UI technology proven; no macOS inference |
| Version/Catalog | supported, unknown, upgraded, missing landmark, wrong catalog | exact build + live probe or apply blocked |
| Projection | required unsupported, optional unsupported, approximated, deterministic output | visible diagnostics and target normalization |
| Theme security | CSS/JS/HTML/Shader/selector/command/URL/path/ZIP/media attacks | all forbidden values fail closed |
| Windows filesystem | drive/UNC/device paths, ADS, traversal, case collision, symlink, junction, reparse, hardlink, ACL, file lock, AV | no escape; atomicity or truthful failure |
| WYSIWYG/concurrency | rapid input, stale ack, Manager collision, theme switch, disk full, crash | single lock, monotonic LWW, full-state rollback |
| Settings parity | states, motion, UIA, keyboard, DPI, light/dark, locales | exact adjacent-native parity |
| Lifecycle | every phase failure, cleanup, pause, re-apply, restore, uninstall | reversible and truthful; incomplete cleanup is partial |
| Accessibility | Reduce Motion, focus ring, contrast, static downgrade | readable static theme; safety layer wins |
| Privacy | conversations, account, token, paths, environment, raw dumps/screenshots | none enters persisted/exported evidence |

Roles are separated into environment/signature audit, contract/security vectors,
UI/accessibility, lifecycle/fault recovery, and final release sign-off. Final
sign-off cannot be performed by the Adapter implementer.
