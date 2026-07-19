# Win-Claude task record

## 2026-07-18 — project initialization

- Created an independent `win-claude/` project; no sibling project was modified.
- Recorded reporting relationships and write boundaries.
- Declared the Windows runtime capability fail closed while environment facts are
  unverified.
- Identified the running Parallels Desktop 26.4.0 Windows 11 ARM64 VM and its
  read-only control channels. An official Claude Setup UAC prompt was not
  approved; no installation was performed.
- Assigned an independent acceptance reviewer. The first review found that the
  initial Style Catalog paths and speculative Target Profile fields were not
  evidence-backed; both were corrected, and missing baseline contracts were
  added without opening compilation or runtime apply.
- Next: collect privacy-safe VM facts, finalize catalogs/contracts, and obtain an
  independent acceptance review.

## 2026-07-18 — installed client and authentication gate

- Win lead verified the official Microsoft Store/MSIX ARM64 Claude Desktop
  `1.22209.0` installation and a valid Anthropic signature.
- Windows `app.asar` uses `.vite/build/index.pre.js` and rejects remote-debugging
  port/pipe startup without the official fresh, user-data-bound, Anthropic-signed
  CDP token. No bypass is permitted.
- The official `CLAUDE_DEV_TOOLS=detach` path will be used only for a manual,
  removable Console proof. Production apply remains unavailable.
- Independent review required the proof to fail without mutation when its owned
  namespace is occupied, to close DevTools and verify process-scoped launch state
  before a normal cold start, and to keep Surface evidence separate from verified
  host identity. The corrected proof passed a second independent review with no
  remaining P0 findings.
- Runtime ordering identity was separated from release provenance: renderer
  `sessionNonce`/`generation`/`revision` are session-scoped and not cross-process
  digests; file/manifest/archive SHA-256 values alone provide deterministic
  artifact identity. Capability, transaction, Compile Context, operation result,
  WYSIWYG, and runtime override contracts enforce the split.
- Static runtime-Seam assessment rejected CLI unpacked-extension loading for
  Claude `1.22209.0`: Chromium has a switch, but Electron documents a main-process
  Session API and Claude exposes no generic caller. React DevTools, DXT/MCP,
  preload replacement, Node inspector, package edits, CDP bypass, and HTTPS
  interception remain forbidden. The extension assets are an inactive,
  digest-pinned security fixture only; forced dark mode is at most an
  approximated visual fallback with no CC Theme marker.
