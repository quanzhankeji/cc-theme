# Client compatibility

Audit date: 2026-07-19. The machine-readable snapshot is [`app/registry/client-capabilities.json`](app/registry/client-capabilities.json).

| Adapter | Verified host | media | ripple | directional | Reduce Motion | Manager auto-apply |
| --- | --- | --- | --- | --- | --- | --- |
| `mac-codex` | Codex `26.715.31925 (5551)` | verified | verified | verified | verified | enabled |
| `mac-workbuddy` | WorkBuddy `5.2.6` | verified | verified | verified | verified | enabled |
| `win-codex` | none | paused-by-user | paused-by-user | paused-by-user | paused-by-user | disabled |
| `win-workbuddy` | none | paused-by-user | paused-by-user | paused-by-user | paused-by-user | disabled |

Claude source is preserved under `adapters/mac-claude/` and `adapters/win-claude/`, but neither is a
registered Manager integration or a compatibility claim. `mac-claude` is excluded from discovery,
the active Registry, compile/package output, UI, runtime resources, CI, and Releases until a formal
production Seam is accepted. Client upgrades require new Adapter-owned evidence before any support
claim moves forward.

## Shared state semantics

- `media`: a local static image or mutually exclusive muted looping video.
- `ripple`: “ripple enabled / static image.” Disabling interaction or enabling Reduce Motion keeps the theme appearance and shows the base image.
- `directional`: “direction follow / default direction.” Disabling interaction or enabling Reduce Motion keeps the theme appearance and shows `idleFrame`.
- `fallback`: renderer or resource failure returns to the base image without weakening validation.

The authoritative fields, media limits, and state machine live in [`app/packages/contracts/background/`](app/packages/contracts/background/). Neutral positive and negative vectors live in [`app/packages/test-kit/fixtures/background-capability.vectors.json`](app/packages/test-kit/fixtures/background-capability.vectors.json). Theme packages carry resources and parameters only; rendering engines remain trusted Adapter code.

## Windows boundary

Windows source and historical evidence are preserved under `adapters/win-*`, but all three projects are `paused-by-user`. They are excluded from active workspaces, CI, Manager Registry/resources, signing, notarization, and Releases. Preserved files do not establish runtime support.

When the user resumes Windows work, each Adapter must independently verify official application identity, Authenticode/install scope, Windows path and ACL handling, reparse-point/UNC/device-path/ADS rejection, process and window lifecycle, fixed rendering, Reduce Motion, pause, restore, and uninstall in a real environment. macOS DOM/CDP/process code must not be copied as a Windows runtime.
