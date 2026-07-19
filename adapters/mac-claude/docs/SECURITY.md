# Security and privacy model

## Read-only host

`/Applications/Claude.app`, its signature and `app.asar` are read-only. Install,
apply, verify, pause and restore compare their identity but never patch, resign,
replace or back up official application files.

## Theme capability

Production Theme Packages, preview images and media are owned by the independent
CC Theme resource layer. The Adapter repository and release contain none of them,
do not discover a production catalog, and do not select a bundled default. The
only failure fallback is complete restoration of the native Claude appearance.

A theme may provide only allowlisted semantic color/font/number values and local
raster image, bounded animated-GIF fallback, H.264 MP4 or static directional-atlas media. A theme cannot provide
CSS, JavaScript, HTML, Shader, selectors, remote resources, absolute paths,
symlinks or executables. WebGL/Canvas code belongs to the fixed signed release,
not to theme content.

The `.cctheme` importer applies entry-count, size, path, type and SHA-256 checks,
then requires capability `1.0.0` and exactly one canonical `mac-claude` Adapter
before staging an atomic single active theme snapshot. It does not install or scan
a theme library. Client-version package fields and non-canonical Adapter ids fail closed.

## Live Surface Evidence privacy

Evidence collection is deny-by-default. It never reads or persists:

- chat or rendered copy, including `innerText` and `textContent`;
- input values or accessible names;
- URL, query, hash or navigation payloads;
- link destinations or media locations.

Only stable attributes, semantic roles/classes, parent-child structure, counts,
geometry, boolean state and an allowlist of computed style properties may leave
the renderer. Reports use private permissions and atomic writes. Raw screenshots
are not committed.

Locale is never inferred from rendered copy, accessible names, conversation
content, the macOS language or `navigator.language`. The Adapter consumes only
the bounded locale id published by Claude's `DesktopIntl` bridge, never invokes
its locale writer, never persists a second language preference, and unsubscribes
the locale listener with every other owned runtime resource.

## Transport and storage

Any future authorized CDP and media delivery is constrained to loopback only.
The verified official client currently requires an Anthropic-signed
`CLAUDE_CDP_AUTH`, so runtime apply fails before opening a transport and no bypass
token is generated. When available, media endpoints use per-run tokens, bounded
chunks and strict content types. Runtime state lives below
`~/Library/Application Support/CCTheme/claude`, uses private directories/files,
and contains no account or chat content. Style override records are bound to a
theme id and normalized theme hash. All Manager/editor writes share one Adapter
transaction lock; compatible tokens replay after a base change and incompatible
tokens are quarantined without application or silent dropping.

Claude `1.22209.0` rejects Blob, loopback and data video sources in the diagnostic
renderer. The Adapter therefore permits a bounded local GIF only as an owned,
reversible fallback for an already declared local video. It publishes
`video-media-policy-animated-image-fallback` instead of claiming equivalent video playback.

The optional diagnostic preview does not alter this gate. It uses Claude's
official user-visible DevTools entry after explicit user confirmation and requires
the user to execute the fixed Adapter bootstrap in the Console. Its temporary
HTTP server binds only to `127.0.0.1`, uses an unguessable per-session token,
serves no theme-provided code, accepts an exact structural receipt schema, and is
removed before normal Claude restarts. It neither exposes a remote CDP endpoint
nor reads rendered text, inputs, accessible names, navigation data, links or media
sources. A connected diagnostic receipt is never accepted as production apply
authorization.

## Failure and cleanup

An unknown build, signature/ASAR mismatch, missing landmark, invalid theme,
persistence failure or verification failure fails closed. WYSIWYG persistence
failure rolls controls, renderer and disk view back to the last valid state and
shows a non-blocking localized error.

Pause, replacement and restore remove only owned nodes, styles, observers,
listeners, timers, CDP registrations, Blob URLs, media elements and WebGL/Canvas
resources. Native settings nodes and unrelated user/application state are never
cleanup targets.
