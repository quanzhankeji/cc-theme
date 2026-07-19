# Theme authoring

This directory publishes only the neutral authoring scaffold: this README,
`example/`, `tools/`, and `tests/`. Real theme sources, working media, generated
archives, and release staging remain local and are ignored by Git. Reusable
host-neutral contract fixtures belong in `app/packages/test-kit/`.

`themes/example/` is the canonical synthetic template for a CC Theme package.
Additional theme directories are private local workspaces used to exercise the
Manager and macOS Adapters. Generated `.cctheme` archives stay in ignored
`themes/dist/` and may later be uploaded as immutable Release assets.

The package format is ZIP-compatible and has no extra wrapper directory:

```text
family.json
unified-theme.json
assets/<allowlisted-media>
```

`family.json` owns localized presentation metadata and file integrity.
`unified-theme.json` owns stable design semantics. Adapter engines are never
included in a theme package. The public theme resource format is the single
first version (`schemaVersion: 1`).

Build a local theme package:

```sh
npm run theme:pack -- themes/example themes/dist/example-1.0.0.cctheme
```

In CC Theme Manager, choose **导入本地主题 / Import local theme**, select the
archive from `themes/dist/`, and the verified theme is installed, displayed,
and selected immediately. Source directories are never imported directly.
