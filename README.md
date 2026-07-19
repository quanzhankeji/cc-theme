# CC Theme

[简体中文](README.zh-CN.md)

[![CI](https://github.com/quanzhankeji/cc-theme/actions/workflows/ci.yml/badge.svg)](https://github.com/quanzhankeji/cc-theme/actions/workflows/ci.yml)

CC Theme is an independent, unofficial, open-source macOS theme tool for supported desktop AI clients. It provides one place to discover compatible clients, download verified themes and Adapter Engines, apply a selected theme, launch the client, and restore the native appearance.

The source repository contains the CC Theme app, host-specific Adapters, shared contracts, and release metadata. It does not contain production theme packages or theme media.

## System requirements

**CC Theme 0.1.0 currently supports Apple Silicon only.**

- macOS 13.5 or later
- M1, M2, M3, M4, or a later Apple chip
- Intel / x86_64 Macs are not supported
- Windows is not supported

There is no current public release artifact. The earlier notarized `CC Theme Manager` image predates
this rename and must not be presented as the current application. A future public build will use
`CC Theme.app` / `CC Theme_0.1.0_aarch64.dmg`, receive new hashes, and complete a new notarization.

## Current client support

| Adapter | Current boundary |
| --- | --- |
| [`mac-codex`](adapters/mac-codex/README.md) | CC Theme apply and restore verified on the documented Codex build |
| [`mac-workbuddy`](adapters/mac-workbuddy/README.md) | CC Theme apply and restore verified on WorkBuddy 5.2.6 |
| `win-*` | `paused-by-user`; excluded from active CI, packaging, and Releases |

Claude is not a current CC Theme integration. [`adapters/mac-claude`](adapters/mac-claude/README.md)
is retained as `preserved-source / manager-registration-paused`, but is absent from client discovery,
the active Registry, compilation, packaging, UI, and CC Theme runtime resources. It may be registered
again only after a production, machine-callable Seam is formally accepted.

Exact evidence and capability limits are recorded in [COMPATIBILITY.md](COMPATIBILITY.md). A client update can invalidate an Adapter until it is verified again.

## Themes and downloads

Themes use the declarative `.cctheme` format. A theme may contain allowlisted JSON and bounded local media, but never JavaScript, CSS, HTML, shaders, selectors, commands, remote URLs, absolute paths, or traversal paths.

Current preset packages and their first-frame preview images are available from
[CC Theme Preset Themes v1.0.0](https://github.com/quanzhankeji/cc-theme/releases/tag/themes-v1.0.0).
They are published as GitHub Release assets and remain outside the Git source tree.

A `.cctheme` file is a ZIP-compatible container with exactly `family.json`,
`unified-theme.json`, and `assets/` at its root. `family.json` owns localized
Chinese/English display metadata, licensing, asset roles, byte sizes, and
SHA-256 digests; `unified-theme.json` owns stable semantic theme data. Maintainers may use a local
`themes/` directory for authoring and validation. Only its neutral `example/`, `tools/`, `tests/`,
and README are published; real theme sources, previews, media, generated archives, and release
staging remain local and are ignored by Git.

CC Theme may consume separately published download metadata that pins immutable theme assets by filename, byte size, SHA-256, minimum application/contract version, and required Adapter capabilities. The local `catalog/` workspace, production `.cctheme` packages, previews, and media are intentionally excluded from this source repository.

Network failure may prevent browsing or downloading a new theme, but it must not block an already installed theme, native client launch, or last-known-good recovery.

## Repository layout

```text
app/                       CC Theme application, shared packages, Registry, and scripts
adapters/mac-codex/       active Codex Adapter source
adapters/mac-workbuddy/   active WorkBuddy Adapter source
adapters/mac-claude/      preserved source; CC Theme registration paused
adapters/win-*/           preserved Windows work, paused-by-user
themes/                    public example, authoring tool, and package tests only
docs/ tests/               public ownership notes and repository gates
```

See the [repository ownership rules](docs/OWNERSHIP.md).

## Safety and privacy

CC Theme does not include a feature intended to collect or upload credentials, conversations, code, user media, or private local data. Adapters still need local access to perform their documented work and can affect startup, rendering, performance, or usability. Back up important data, use trusted Releases, and restore the native appearance if anything behaves unexpectedly.

The project does not redistribute official client applications, modify their signed application bundles, or imply affiliation with their vendors. The MIT License warranty and liability limitations apply.

## Third-party media

Some community theme media may originate from public Internet sources. Public availability does not itself grant a redistribution license, and CC Theme does not claim ownership of third-party material. Rights holders can open an Issue identifying the exact theme, asset, or Release and provide sufficient ownership/contact information; maintainers will review and remove or replace the material when appropriate. See GitHub's [copyright removal guide](https://docs.github.com/en/site-policy/content-removal-policies/guide-to-submitting-a-dmca-takedown-notice).

## Development

```bash
npm test
```

The root command runs repository gates, shared Interface tests, Manager tests, and all active macOS Adapter suites. Windows projects are intentionally excluded while paused.

Contributions are welcome under [CONTRIBUTING.md](CONTRIBUTING.md). Security reports must follow [SECURITY.md](SECURITY.md). Unless a file says otherwise, this repository is licensed under the [MIT License](LICENSE).
