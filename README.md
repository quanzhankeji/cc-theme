# CC Theme

[简体中文](README.zh-CN.md)

[![CI](https://github.com/quanzhankeji/cc-theme/actions/workflows/ci.yml/badge.svg)](https://github.com/quanzhankeji/cc-theme/actions/workflows/ci.yml)

CC Theme provides ready-to-use, reproducible theme packages and unified theme management for supported macOS AI desktop clients. Import a versioned `.cctheme`, apply it through a verified host Adapter, and restore the native appearance—without asking an AI model to generate the theme, rewriting prompts, or spending generation tokens.

It is an independent, unofficial, open-source project—not a prompt library, concept gallery, or general-purpose AI theme generator. This repository contains the CC Theme app, host-specific Adapters, shared contracts, and release metadata. Production theme packages are maintained in the separate [CC Theme Themes](https://github.com/quanzhankeji/cc-theme-themes) registry and published as Release assets; theme media does not enter this Git source tree.

## Demo

https://github.com/user-attachments/assets/5877f113-c50f-4457-84e1-89fb7c195df8

## Why CC Theme

Some theme products provide a concept image and a prompt, leaving the user to ask Codex, WorkBuddy, or another AI to generate the actual result. That workflow is model-dependent: it can consume additional tokens, require repeated prompt changes and regeneration, and produce different results from the same starting idea.

CC Theme distributes the actual declarative package—prepared assets, semantic theme data, integrity metadata, and tested host mappings. Within a documented Adapter and client-version boundary, the same package follows the same validated application path. This makes a published theme ready to use, deterministic at the package level, and reproducible without a “prompt lottery.” It does not promise identical rendering on untested client versions or unsupported platforms.

| | Prompt-based theme generation | CC Theme |
| --- | --- | --- |
| What you receive | A concept image and instructions for an AI | A versioned `.cctheme` package |
| Final output | Generated at use time and dependent on the model and context | Prepared assets and declared settings applied by a host Adapter |
| AI usage | May require generation tokens and repeated prompt iterations | Theme application does not invoke AI generation or consume generation tokens |
| Reproducibility | Output can vary between runs | The same package and supported Adapter use the same validated inputs |
| Compatibility | Depends on what the generated result happens to change | Recorded and tested per Adapter and supported client version |

## How it works

1. Download a versioned `.cctheme` package from an official Release.
2. Import it into CC Theme. The Manager validates the manifest, declared digests, allowlisted contents, and bounded local media before installation.
3. Choose a detected, supported client. CC Theme uses that client's verified Adapter to apply the selected theme and, when requested, launch the client.
4. Pause the theme or restore the client's native appearance from the same Manager.

“Apply directly” is deliberately narrow: it means applying a validated package through a compatible CC Theme Adapter. It does not mean unconditional injection into arbitrary third-party applications.

## System requirements

**CC Theme 0.2.0 currently supports Apple Silicon only.**

- macOS 13.5 or later
- M1, M2, M3, M4, or a later Apple chip
- Intel / x86_64 Macs are not supported
- Windows is not supported

The `0.2.0` source line is being prepared for its first public `CC Theme` application Release. The
earlier notarized `CC Theme Manager` image predates this rename and must not be presented as the
current application. The formal build uses `CC Theme.app`; GitHub exposes the notarized DMG as
`CC.Theme_0.2.0_aarch64.dmg` after normalizing the local filename's space to a period.

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

Compatibility is evaluated across the theme package, Adapter, client, and client version. In the current preset release, EVA media is verified on WorkBuddy but is not yet visually verified on CodeX; the package remains downloadable, but that combination must not be presented as tested compatibility.

## Themes and downloads

Themes use the declarative `.cctheme` format. A theme may contain allowlisted JSON and bounded local media, but never JavaScript, CSS, HTML, shaders, selectors, commands, remote URLs, absolute paths, or traversal paths.

Current preset packages and their first-frame preview images are available from
[CC Theme Preset Themes v1.0.0](https://github.com/quanzhankeji/cc-theme-themes/releases/tag/themes-v1.0.0).
The [machine-readable catalog](https://github.com/quanzhankeji/cc-theme-themes/blob/main/catalog.json) records the immutable asset name, byte size, and SHA-256 for every package. Packages are published as GitHub Release assets and remain outside both repositories' Git source trees.

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

Applying an existing CC Theme package does not send a generation prompt to an AI model. CC Theme does not include a feature intended to collect or upload credentials, conversations, code, user media, or private local data. Adapters still need local access to perform their documented work and can affect startup, rendering, performance, or usability. Back up important data, use trusted Releases, and restore the native appearance if anything behaves unexpectedly.

The project does not redistribute official client applications, modify their signed application bundles, or imply affiliation with their vendors. The MIT License warranty and liability limitations apply.

## Third-party media

Some community theme media may originate from public Internet sources. Public availability does not itself grant a redistribution license, and CC Theme does not claim ownership of third-party material. Rights holders can open an Issue identifying the exact theme, asset, or Release and provide sufficient ownership/contact information; maintainers will review and remove or replace the material when appropriate. See GitHub's [copyright removal guide](https://docs.github.com/en/site-policy/content-removal-policies/guide-to-submitting-a-dmca-takedown-notice).

## Development

```bash
npm test
```

The root command runs repository gates, shared Interface tests, Manager tests, and all active macOS Adapter suites. Windows projects are intentionally excluded while paused.

Contributions are welcome under [CONTRIBUTING.md](CONTRIBUTING.md). Security reports must follow [SECURITY.md](SECURITY.md). Unless a file says otherwise, this repository is licensed under the [MIT License](LICENSE).
