# Windows WorkBuddy domain context

`win-workbuddy` owns the Windows 11 WorkBuddy adapter only. Its proposed Adapter ID is
`win-workbuddy-skin`; registration remains a Shared Core decision owned by the Win and CC Theme
leads.

## Shared interface

- Input: Unified Theme v2 Shared Core plus the namespaced Target Profile.
- Output: a declarative, normalized `skin.theme` and visible projection diagnostics.
- Lifecycle: `detect`, `preflight`, `install`, `apply`, `launch`, `verify`, `pause`, and `restore`
  return bounded operation results.
- Precedence: Shared Core → Target Profile → Local Runtime Override → runtime accessibility and
  host safety.
- Themes never contain CSS, JavaScript, HTML, Shader, selectors, commands, URLs, absolute paths,
  path traversal, environment variables, or process arguments.

## Windows implementation boundary

The Windows adapter owns executable identity, Authenticode checks, install scope, process
identity, transport discovery, Windows-specific version catalogs, fixed UI interpretation,
Settings integration, transactions, rollback, and privacy-safe evidence. It does not inherit
macOS process names, application paths, environment variables, launch flags, selectors, DOM
landmarks, injection, or recovery steps.

## Current gate

WorkBuddy 5.2.6 identity and its Electron/React packaging have been observed on the Windows 11 VM.
No reversible runtime transport, live UI Surface Catalog, Settings mount, or rollback has been
verified. Consequently `runtimeApplyAvailable` is false and every mutating lifecycle operation
fails closed.
