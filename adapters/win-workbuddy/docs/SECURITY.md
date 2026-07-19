# Security boundary

## Theme input

Themes are data, never programs. Unknown keys fail closed. The normalizer rejects CSS, JavaScript,
HTML, Shader code, selectors, commands, URLs, URI schemes, absolute paths, UNC paths, drive paths,
path traversal, environment variables and shell expansion. Media references are plain local file
names; resolving and staging them belongs to a future bounded backend.

## Runtime identity

A live operation requires an exact supported version, a valid Authenticode signature from the
expected publisher, a version-exact verified UI Catalog, a loopback/local transport bound to the
signed process, and a rollback-tested transaction Seam. A port alone is not identity. A matching
process name alone is not identity.

## Evidence privacy

Normal results may contain only OS/build/architecture, app version, publisher, signature status,
package/UI stack markers, Catalog/transport state, hashes, bounded booleans and stable error codes.
They must not contain complete user paths, command lines, tokens, environment blocks, account
identifiers, conversations, material bytes, arbitrary DOM text, or raw logs.

Screenshots must be cropped to adapter controls or synthetic fixtures. Account panes,
conversation content, filenames and personal notifications are excluded or redacted before hash
and retention.

## Failure policy

Unknown version, ambiguous process identity, missing Catalog role, unexpected cardinality,
unverified Settings anchor, stale revision, incomplete rollback, or evidence sanitization failure
blocks the operation. The adapter never falls back to a macOS Seam or a guessed Windows locator.
