# Example `.cctheme` source

Copy this directory to start a theme. Keep the structure and replace only the
identity, localized display text, semantic values, and allowlisted media:

- `family.json`: package identity, `zh-CN` / `en-US` display metadata, licensing,
  and the generated integrity manifest.
- `unified-theme.json`: the single first-version Unified Theme Shared Core and optional namespaced
  Target Profiles. It never contains CSS, JavaScript, selectors, commands, URLs,
  absolute paths, or host-version facts.
- `assets/`: flat, local-only PNG/JPEG/WebP/MP4 files referenced by basename.

From the repository root, package a copied theme with:

```bash
npm run theme:pack -- themes/your-theme
```

The command validates the theme, refreshes `family.json` byte counts and
SHA-256 values, and writes `themes/dist/<id>-<version>.cctheme`. The output is a
deterministic ZIP-compatible archive with the `.cctheme` extension.
