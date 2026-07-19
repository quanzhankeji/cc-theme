# Security and recovery

- Only the signed local `com.openai.codex` bundle and its bundled Node runtime
  are accepted.
- Current, privacy-safe Surface evidence is required before apply. The
  always-latest policy describes update behavior; stale evidence never grants
  admission to a changed host.
- CDP binds only to loopback. The official application, `app.asar`, signature,
  CSP and remote-origin policy are never modified.
- Theme packages accept only allowlisted declarative data and contained local
  media. CSS, scripts, HTML, Shader, selectors, commands, URLs, absolute paths,
  traversal and symlinks are rejected.
- Media dimensions, formats, counts, sizes and hashes are verified before an
  immutable staging snapshot can become active.
- Settings → cc-theme writes only allowlisted Runtime Override tokens through a
  serialized, atomic transaction and restores the last valid value on failure.
- Live Surface Evidence excludes chat text, inputs, accessible names, URLs,
  queries, hashes and media sources.
- A failed apply never selects a bundled fallback. Owned renderer nodes are
  removed and the prior valid snapshot or native host appearance is restored.
- Pet removal requires an explicit ownership record and matching content hash;
  user-edited or unowned pets are preserved.
- Source and release ownership scans reject production themes, media,
  installable packages and test fixtures from Adapter distributions.

Runtime state and private assets under the user profile are never source-cleanup
targets. Repository cleanup must not delete downloaded Theme Packages, local
overrides, private media or pets.
