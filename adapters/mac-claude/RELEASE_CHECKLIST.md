# Release checklist

## Source and package

- [ ] `VERSION`, package metadata and renderer version agree.
- [ ] Full automated suite passes.
- [ ] Client ZIP contains only the Adapter runtime, contracts, Catalog, Interpreter
      and lifecycle dependencies from the explicit release allowlist.
- [ ] Repository/staging/archive scans contain no `presets`, `themes`, `theme-sources`,
      production identity, theme media, installable Theme Package or test fixture.
- [ ] No sibling-project paths, runtime state, logs, screenshots, private media,
      resource forks or extended metadata are included.
- [ ] Asset identity is `mac-claude-v<adapterVersion>-r<adapterReleaseRevision>-macos-arm64` (optionally prefixed by `cc-theme-` for the client wrapper) with matching SHA-256.
- [ ] `adapterVersion` exactly equals the supported Claude `CFBundleShortVersionString`; build remains evidence only.
- [ ] Before first publication, a development revision rebuild atomically replaces the asset and regenerates every digest/sidecar; after publication, the same revision is immutable.
- [ ] `managerRegistration.status=paused` blocks all Engine and client-wrapper builds; no prepare-ready result is published.

## Exact client evidence

- [ ] Bundle id, version/build, Team ID and signature verify.
- [ ] Electron, Chromium, remote renderer build/hash/timestamp and debug entry are recorded.
- [ ] ASAR SHA-256 and Info.plist ASAR integrity match the Catalog.
- [ ] Before/after official app hash and signature are identical.

## Lifecycle and surfaces

- [ ] Capability truthfully distinguishes projection-only from runtime apply.
- [ ] Manager reports Claude `allowed=false` whenever runtime apply is unavailable;
      this Adapter-local gate does not block another requested Adapter.
- [ ] Official authenticated transport exists; otherwise apply/deep settings are
      blocked and all live surface items below stay explicitly unverified.
- [ ] detect/preflight/apply/verify/pause/restore all return conforming JSON.
- [ ] Main shell, sidebar, conversation, Composer, owned CC Theme page and one
      privacy-safe overlay pass.
- [ ] Horizontal overflow, light/dark, display zoom and Reduced Motion pass.
- [ ] Theme replacement and complete restore release all owned resources.

## WYSIWYG and native entry

Historical manual diagnostic evidence on Claude 1.22209.0 verified placement immediately
below Desktop app → General, the C icon container, independent page activation,
keyboard focus, native-tab return, Settings close/reopen and absence of a Save
button. The boxes remain release gates until an authorized persistent Seam repeats
the full matrix.

- [ ] There is no Save button.
- [ ] First edit previews immediately and persists automatically.
- [ ] Rapid input is latest-write-wins; failure rolls UI/renderer/disk back.
- [ ] External package replacement cannot cross-write; reload/restart/reopen preserves last success.
- [ ] CC Theme is immediately below General and opens an independent page.
- [ ] General/CC Theme match at default, hover, pressed, selected, focus-visible,
      keyboard activation, light/dark, zoom and Reduced Motion.
- [ ] Closing/reopening Settings and returning to native tabs restores native state.

## Host language

- [ ] Locale Catalog exactly matches Claude's signed selectable locale resources.
- [ ] Every locale has complete entry/page/control/status/validation/a11y translations;
      no raw key, mixed-language fallback or independent language selector remains.
- [ ] `getInitialLocale` and `onLocaleChanged` are the only locale authorities;
      system/navigator/content inference and Adapter host-locale writes are absent.
- [ ] Immediate host switching refreshes the full owned page atomically without
      changing focus, draft, revision, queued write or active theme.
- [ ] Aliases, unknown fallback diagnostics, localized numbers, long text and
      direction metadata pass; RTL is N/A until Claude declares an RTL locale.
- [ ] Locale listener is unsubscribed during replacement, pause and restore.

## Four-party data contract

- [ ] Capability, Target Profile schema and editable token list validate together.
- [ ] Every Shared Core and Target Profile field is exact, approximate or unsupported
      with diagnostics consistent with Projection.
- [ ] Theme design data carries no exact client version or Surface Catalog fact;
      version-bearing packages and non-canonical Adapter ids fail closed.
- [ ] Shared Core → Target Profile → Local Overrides → runtime safety precedence passes.
- [ ] Manager and local editor share one serialized transaction Seam.
- [ ] Compatible overrides replay after base-hash change; incompatible values are
      quarantined and visibly diagnosed without silent dropping.

## Privacy

- [ ] Evidence contains no chat/rendered text, input value, accessible name,
      URL/query/hash, link destination or media location.
- [ ] No raw acceptance screenshot is committed.
- [ ] Unverified pages remain explicitly listed in the Catalog and release report.
