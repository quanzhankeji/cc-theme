# Privacy-safe evidence plan

Each evidence record uses one of three classifications: `vm-verified`, `static-analysis`, or
`unverified`. The record includes the probe version, client version, Catalog version, bounded
observations and SHA-256 values where useful.

## Allowed evidence

- executable product/file version, publisher and Authenticode status;
- OS edition/build/architecture and hypervisor/tool version;
- process running boolean and sanitized install scope;
- Electron/renderer/framework markers derived without emitting source content;
- role counts, ARIA role names, adapter marker state and computed allowlisted style values;
- cropped synthetic screenshots and their hashes;
- operation status, stable code, failed phase and cleanup completeness.

## Forbidden evidence

- complete process command lines or environment blocks;
- access tokens, cookies, authorization headers or ports embedded in private arguments;
- complete HOME/profile paths, arbitrary file listings or registry exports;
- conversation text, account identifiers, filenames, notifications or media bytes;
- raw DOM dumps, raw screenshots, crash uploads or unbounded command output.

The evidence sanitizer is tested with Windows paths, bearer tokens and command-line-like strings.
Any forbidden pattern replaces the whole value with `[REDACTED]`; it is not partially retained.
