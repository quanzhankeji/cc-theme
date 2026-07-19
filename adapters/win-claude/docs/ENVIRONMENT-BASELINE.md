# Windows 11 environment baseline

## VM-verified

- Hypervisor: Parallels Desktop 26.4.0.
- VM: `Windows 11`, UUID `{008be7ac-e2cd-4249-be2c-c9f917fd23a1}`, running.
- Guest: Windows 11 Pro, ARM64, version `10.0.26100`, build `26100`.
- Parallels Tools `26.4.0-57513` is installed. `prlctl guest exec` works as a
  read-only system evidence channel; the Parallels window is available for later
  visual and interaction acceptance.
- An Anthropic-signed `Claude Setup.exe` is present and displayed a UAC approval
  prompt. The Win lead subsequently completed the official installation.
- Claude Desktop `1.22209.0` is installed and running as a Microsoft Store/MSIX
  ARM64 package. Its Anthropic signature is valid.
- Windows `app.asar` declares `.vite/build/index.pre.js` as its package main.
- Remote-debugging port/pipe startup is blocked unless the official authentication
  gate succeeds. The gate requires both `CLAUDE_CDP_AUTH` and
  `CLAUDE_USER_DATA_DIR`; the three-segment token is bound to the user-data
  directory, limited to a five-minute freshness window, and verified with an
  Anthropic Ed25519 public key.
- The official `CLAUDE_DEV_TOOLS=detach` code path exists without a Windows-only
  platform restriction. This proves an official manual DevTools path, not a
  production automation transport.

## Static analysis

- None recorded yet.

## Unverified

- exact Electron and remote-renderer versions, process topology, and window
  ownership landmarks;
- Settings surfaces and a safe reversible runtime seam.
- whether the detached DevTools Console is attached to the target renderer and
  can perform and fully remove the planned proof.

## Evidence provenance

The installed-package and `app.asar` facts above were verified in the VM by the
Win lead on 2026-07-18 and relayed to this project. No authentication token,
command line, environment dump, complete user path, or raw `app.asar` content is
stored here.

These facts are not yet an exact-build allowlist: package full/family names,
bounded signer subject, and binary SHA-256 remain missing. The versioned Surface
Catalog stays `unverified` until real structure evidence exists.

Privacy-safe evidence must not include account data, conversations, tokens,
private file contents, full user paths, environment variables, or raw dumps.
