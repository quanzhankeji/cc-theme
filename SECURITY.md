# Security Policy

## Supported code

CC Theme is currently pre-1.0. Security fixes are applied to the latest code on
the default branch and, once CC Theme releases exist, the latest release of each
affected subproject. Retired-format releases, older snapshots, and unverified
client versions are not supported.

| Area | Supported |
| --- | --- |
| `app/` default branch and latest release | Yes |
| `adapters/mac-codex/` and `adapters/mac-workbuddy/` | Yes |
| `adapters/mac-claude/` preserved source | Source review only; not a supported Manager integration |
| `adapters/win-*/` while paused-by-user | No |
| Older releases or unverified client builds | No |
| Future adapters marked experimental | Best effort |

## Reporting a vulnerability

Do **not** create a public Issue, Discussion, or Pull Request containing exploit
details, tokens, private paths, user media, or account information.

Use GitHub's **Security → Report a vulnerability** flow for this repository. If
private vulnerability reporting is not yet available, create a minimal public
Issue asking the maintainers to provide a private contact channel; do not include
technical details in that Issue.

Please include, when safe:

- affected subproject, version, operating system, and client version;
- impact and realistic attack prerequisites;
- minimal reproduction steps or a proof of concept;
- whether secrets, local files, or remote code execution are involved;
- a suggested mitigation, if known.

Maintainers will acknowledge a complete report when capacity permits, validate
the issue, coordinate a fix and release, and credit the reporter if requested.
Please allow a reasonable remediation window before public disclosure.

## High-priority areas

- path traversal, symlink races, unsafe archive extraction, or arbitrary file
  writes;
- exposure of local media, drafts, logs, credentials, or runtime state;
- accepting or executing remote or theme-supplied code;
- bypassing application identity, signature, loopback, or media validation;
- incomplete restore behavior that changes the official application or user
  configuration outside the documented owned scope;
- `.cctheme` import integrity or unsafe local file handling.

General compatibility breakage without a security impact should use the client
compatibility Issue form instead.
