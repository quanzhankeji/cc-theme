# Mac-Claude architecture

Project state is `preserved-source / manager-registration-paused`. Source,
contracts and sanitized evidence remain available for maintenance, but Manager
Engine delivery and prepare-ready registration are disabled.

## Boundary

Mac-Claude treats Claude Desktop as a new host, not as a compatible variant of
another Electron client. The official bundle, signature and `app.asar` are
read-only evidence. Runtime compatibility is granted only to an exact
fingerprint, an officially authorized reversible transport, and successful live
renderer landmarks.

Its monorepo source Module lives only at `adapters/mac-claude`. That repository
location is not part of the runtime Interface: the stable Adapter id remains
`mac-claude`, and client releases continue to install their engine as `.mac-claude`.

```text
external Unified Theme projection / Skin Package
              │ package integrity + allowlist validation
              │ atomic local theme snapshot
              ▼
Claude Skin Adapter (single serialized transaction seam)
  UI Surface Catalog → Interpreter Adapter → semantic Skin Surface Roles
              │ official authenticated CDP only; currently unavailable
              ▼
Claude renderer + owned CC Theme settings page
```

The Adapter release owns the interpreter, validation and lifecycle Implementation,
but never owns production Theme Packages or their media. Those belong to the
independent CC Theme resource layer. It never imports an Implementation from a sibling workspace.

## Verified host evidence

The `1.22209.3` profile records bundle id, ShortVersion, exact build, Team ID,
Hardened Runtime, notarization, Electron, Chromium, process ownership, ASAR
SHA-256 and ASAR integrity. Its `adapterVersion` is exactly the host ShortVersion;
the build remains compatibility evidence and `adapterReleaseRevision=1` identifies
this unpublished development line. Development r1 may be atomically rebuilt with
fresh digests before first publication; after first publication the revision is
immutable. Manager registration is currently paused, so no Engine is built or delivered. The local ASAR
supplies the Electron shell and loads a remote Claude renderer. The supported
debug route is `CLAUDE_DEV_TOOLS=detach`, but that opens developer tools and does
not authorize CDP. The official shell rejects remote-debugging arguments unless
`CLAUDE_CDP_AUTH` is an Anthropic-signed token bound to the selected user-data
directory and freshness window. Mac-Claude does not forge or bypass this check.
Claude `1.22209.0` previously used the same diagnostic entry for a privacy-safe, one-session
a neutral external-theme paint proof on the native new-conversation surface: background, sidebar,
primary pane and Composer rendered successfully, and no screenshot or user
content was retained. That result is historical candidate mapping for `1.22209.3`, not
current Surface admission. The current remote UI build and live landmarks remain
unverified without an authorized seam, so runtime admission fails closed. The old result is
manual, non-persistent and cannot drive the WYSIWYG editor lifecycle, so it is
explicitly not a capability upgrade or a production Seam.
The same diagnostic route has also mounted the owned `CC Theme` navigation item in
the live Settings dialog immediately after `Desktop app → General`, with the C icon
inside the cloned native icon container, and opened the independent owned page.
Native-tab return, Settings close/reopen and keyboard focus were verified without
retaining screenshots or user content. This remains current-renderer-session evidence
only and does not relax the runtime capability gate.
The live regression now mounts the complete eight-group editor rather than a placeholder,
and verifies strict single selection through a Developer → CC Theme round trip. The
interpreter admits the Desktop app list only when its direct native button count matches
the Catalog, so the top-level Settings General list cannot be selected accidentally.
The current capability therefore publishes `runtimeApplyAvailable=false` and
`managerApplyAllowed=false` and `deepSettingsAvailable=false`. The Manager gate
is Adapter-local: a Claude projection can be produced for packaging, but it cannot
authorize Claude apply or alter another requested Adapter's availability. These facts are diagnostic evidence, not a
cross-version or runtime-compatibility claim.

The same diagnostic renderer rejects MP4 Blob, loopback and data URLs with its
media URL-safety policy. A validated external package may therefore declare a bounded local
animated-GIF fallback. The fixed Adapter owns its Blob URL and image node, pauses
it for Reduced Motion, visibility and user pause, removes it during cleanup, and
exposes `video-media-policy-animated-image-fallback`. This is an explicit runtime
approximation in a manual diagnostic session, not evidence of an authorized Seam.

The gate can only be upgraded after an official authorized reversible renderer
Seam, an exact signed-build live probe, privacy-safe live landmarks, the real
apply/verify/pause/restore matrix, and complete cleanup plus independent QA all
pass. Capability validation makes this evidence list machine-readable and keeps
Manager permission equal to runtime availability.

Re-entry into the Manager registry requires a production machine-callable
apply/verify/pause/restore/rollback Seam and completed real-client QA. Projection,
offline normalization or historical DevTools evidence cannot satisfy that gate.

Future-only constraint: if an official production Seam later permits a dormant
media path, readiness must be bounded by signature, process, authenticated CDP
and live Surface gates. Work must be single-flight per renderer document and
generation, and a stale generation must never commit. This is not implemented or
advertised while `runtimeApplyAvailable=false`.

## User-confirmed diagnostic preview

`contracts/diagnostic-preview-interface.json` is a separate, machine-callable
Manager surface. `prepare` verifies the exact signed client, starts a random-token
loopback server, restarts Claude through its official `CLAUDE_DEV_TOOLS=detach`
entry, and returns an explicit two-step Console action. The first step copies the
fixed Adapter bootstrap; the second pastes and runs it in DevTools. This respects
Claude's CSP and does not request remote CDP or synthesize authorization.

The bootstrap reuses the same validated Adapter payload as the offline projector.
Its receipt contains only landmark booleans and owned-node counts. `status`
distinguishes `awaiting-user-action` from `connected`; neither state changes
`runtimeApplyAvailable`. `stop` with a normal Claude restart is the complete
renderer cleanup boundary. The preview is intentionally renderer-session-only,
while allowlisted WYSIWYG overrides use the existing serialized atomic Adapter
transaction.

## Capability and data layers

`contracts/adapter-capability.json` is the machine-readable discovery record.
`scripts/project-unified-theme.mjs` owns the Claude projection decisions and
diagnostics. Effective values are resolved in this order:

1. Shared Core;
2. the namespaced `mac-claude` Target Profile;
3. theme-bound Local Runtime Overrides;
4. runtime accessibility and host-safety degradation.

The manager never supplies Claude selectors or exact client facts in theme
design data. Package import is canonical-only: capability `1.0.0`, exactly one
Adapter id `mac-claude`, and no client-version fields. All manager and local-editor writes use
the Adapter-owned cross-process lock. Base-hash changes replay compatible stable
tokens and quarantine invalid tokens with a visible diagnostic.

## Catalog and interpreter

`compatibility/claude-macos/1.22209.3/ui-surface-catalog.json` is the only place
for version-dependent landmarks, hierarchy, native state classes and mount
rules. `assets/ui-interpreter.js` consumes that config, recognizes Claude, and
projects host elements into stable roles such as `main-content`, `sidebar`,
`primary-pane`, `composer-input`, `settings-content-owned` and `overlay-surface`.

Themes and the settings page know role/token ids only. They never own host
selectors.

## Host locale authority

`contracts/claude-locale-catalog.json` is derived from the 11 signed Claude
locale JSON resources and the native Language menu, not from Chromium `.lproj`
folders. `claude.hybrid.DesktopIntl.getInitialLocale()` supplies the initial
effective locale and `onLocaleChanged()` supplies immediate host changes. The
Adapter never calls `requestLocaleChange`, reads conversation/UI text, consults
`navigator.language`, or persists a second locale preference.

The locale callback updates every owned label, status, validation message,
tooltip/a11y label, `lang`, `dir`, and localized number in one synchronous
in-place pass. It retains the editor DOM, focus, draft, monotonic revision,
debounce timer, pending acknowledgement and current theme snapshot. Unknown
locales use one page-wide `en-US` fallback plus a bounded machine-readable
diagnostic. The current 11 locales are all LTR; RTL remains a Catalog-driven
capability rather than a hard-coded assumption.

## Independent CC Theme tab

The interpreter resolves the Settings dialog and its Desktop app list. The
renderer clones the adjacent General list item as a structural/style template,
then replaces only owned identity, label and icon contents. The result:

- is inserted immediately after General;
- owns a unique id and all of its listeners;
- places one letter `C` in the native icon container;
- uses the captured native active/inactive classes and native transition;
- opens an owned direct-child page of the Settings dialog;
- restores the original native content when another tab is chosen.

The implementation never copies a native event handler or mutates the General
node. Pause, replacement and restore remove the owned entry/page and restore the
original content exactly.

## WYSIWYG state machine

The page maintains three synchronized views of state: controls, renderer CSS
variables/preferences, and a theme-bound disk record.

```text
input → validate Catalog value → immediate renderer preview
      → 180 ms debounce → monotonic revision → atomic write → verified ack
      └─ failure/timeout → last valid values + preferences restored everywhere
```

Only the latest revision may commit. An external-package replacement flushes the pending revision
before atomically replacing the active snapshot, resets nonce/revision scope, reloads controls,
and reapplies the selected theme. Reopening Settings, renderer reload and app restart
load the last verified disk record. There is no Save action.

## Lifecycle

`scripts/theme-lifecycle.mjs` exposes six phases with one result schema:

1. `detect`: collect exact read-only application identity;
2. `preflight`: validate signature, fingerprint, runtime, theme and catalog;
3. `apply`: require the official authorized transport, then start/apply the fixed adapter;
4. `verify`: check renderer landmarks and owned resources;
5. `pause`: remove live Adapter resources without deleting the active external snapshot;
6. `restore`: remove owned runtime/launcher state and restore native appearance.

Failures are categorized as `adapter-landmark`, `theme-contract`, or `visual`.
The current real-client preflight fails closed as `adapter-landmark /
transport-unavailable` before renderer mutation. Reports contain structure and
status only.

## Resource ownership

The repository has no production `presets`, `themes` or `theme-sources` directory.
Production discovery, authoring, catalog distribution, preview art and media inventory
belong to the independent resource layer. The Adapter accepts one validated external
package at its package Interface and atomically replaces one active snapshot. A missing
or failed theme restores the native Claude state; there is no preset fallback.

Release staging is an explicit allowlist and is checked against
`contracts/adapter-resource-ownership.json`. Test-only fixtures never enter an archive.

The adapter tracks its style elements, DOM nodes, mutation/media-query
observers, listeners, timers, animation frames, pending persistence requests,
Blob URLs, video nodes, WebGL contexts/textures/buffers/programs and Canvas
controllers. Generation replacement, pause and restore release all of them.
Official Claude files are never cleanup targets.

## Acceptance surface

The machine-readable acceptance contract requires the main shell, sidebar,
conversation, Composer, independent CC Theme page, at least one overlay,
horizontal overflow, light/dark, display scaling, Reduced Motion, theme
replacement and complete restore. The entry is compared with General for
default, hover, pressed, selected, focus-visible, keyboard activation and page
switching. Screenshots may be temporary and privacy-safe; none are committed.

The current Catalog lists all live visual/runtime families as unverified because
the official authenticated Seam is unavailable. Offline structure contracts,
Projection, persistence, concurrency, rejection and cleanup are tested; no live
surface inherits compatibility merely because its renderer technology matches.
