# Release checklist

## Automated

- [ ] `./tests/run-tests.sh` passes.
- [ ] Repository ownership report is allowed.
- [ ] Source and client builds use the explicit Adapter allowlist.
- [ ] Extracted archives contain no production theme directory, theme media,
      installable `.cctheme`, test fixture or known production theme identity.
- [ ] Launcher contains no theme-derived icon.
- [ ] ZIP timestamps are deterministic and each client ZIP has a SHA-256 sidecar.
- [ ] `adapterVersion` exactly equals the supported host ShortVersion; the host
      build remains only in compatibility evidence.
- [ ] `adapterReleaseRevision` is a positive integer and the frozen asset name is
      `<adapterId>-<adapterVersion>-r<revision>-<os>-<arch>`.
- [ ] Two clean builds produce byte-identical archives and a second publication
      attempt for the same revision is rejected without changing the first file.

## Runtime

- [ ] Empty installation leaves Codex in native appearance.
- [ ] External package validation, stage, atomic activation and verify pass.
- [ ] Invalid package and stale Surface evidence fail closed.
- [ ] Settings → cc-theme immediate preview, persistence and rollback pass.
- [ ] pause, restore, rollback and cleanup remove only Adapter-owned state.
- [ ] User-downloaded themes, private media, local overrides and changed pets
      remain untouched.
