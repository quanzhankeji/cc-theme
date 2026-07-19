# Mac-Claude contracts

- `adapter-capability.json`: machine-readable discovery, availability, Shared
  Core supported/approximated/unsupported decisions, Target Profile whitelist,
  editable local tokens, compatibility policy and apply gate.
- `adapter-projection-request.schema.json` / `adapter-projection-result.schema.json`:
  serialized Manager → Adapter projection boundary and explicit diagnostics.
- `claude-target-profile.schema.json`: the namespaced, closed Claude profile.
- `runtime-overrides-interface.json` / `adapter-transaction.json`: hash-bound
  replay/quarantine and one cross-process Adapter transaction Seam.
- `cc-theme-package.json`: public lowercase `.cctheme` ZIP contract. It targets
  `claude + macos + mac-claude capability 1.0.0` and compiles to
  `targets/macos/theme.json`; exact client versions stay out of theme data.
- `skin-theme.schema.json`: the only portable runtime theme Interface. It accepts
  allowlisted semantic values and local image/video/directional-atlas references;
  executable content and host selectors are impossible by schema and validator.
- `theme-style-catalog.json`: editor token → semantic role → fixed adapter CSS
  variable mapping. Geometry remains native. The settings page knows token ids,
  never Claude selectors.
- `claude-locale-catalog.json`: the versioned set of locales actually declared
  and selectable by Claude Desktop, its `DesktopIntl` effective-locale authority,
  aliases, direction, formatting and bounded fallback policy. Chromium `.lproj`
  directories are explicitly not product-language evidence.
- `theme-editor-locales.json`: complete deterministic localization projection for
  every Catalog locale and all entry/page/status/a11y/editor messages, groups and
  tokens. `scripts/claude-locale-runtime.mjs` consumes only Claude's effective
  locale and owns initial/event/fallback/cleanup behavior.
- `live-surface-evidence.json`: privacy-safe structure-only evidence schema.
- `theme-lifecycle-result.json`: detect/preflight/apply/verify/pause/restore result
  and failure-category Interface.
- `adapter-resource-ownership.json`: external resource-layer ownership, the
  Adapter release allowlist and native-state failure fallback.

Minimal neutral contract data lives only under `tests/fixtures` and is excluded
from every release. Production Theme Packages are owned by the independent resource layer.

The version-scoped UI Surface Catalog under
`compatibility/claude-macos/1.22209.3/` is Adapter evidence, not theme data. It
owns Claude-specific selectors, hierarchy, native General-entry state classes,
mount policy and unverified page families.

Style overrides are stored separately below Application Support. Each record is
theme/hash-bound, validated through the Style Catalog and written atomically
under the Adapter transaction lock. Compatible stable token ids replay after a
base change; incompatible values are quarantined with diagnostics. They never
modify the base theme or enter a `.cctheme` package.

Public theme distributions are `.cctheme`; engine installer ZIPs are separate.
No contract may require a sibling repository or developer-home dependency.
