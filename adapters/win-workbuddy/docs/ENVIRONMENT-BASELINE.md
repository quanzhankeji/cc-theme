# Environment baseline — 2026-07-18

Status labels in this document are mandatory: **VM verified**, **static analysis**, or
**unverified**.

## VM verified

- Hypervisor: Parallels Desktop 26.4.0.
- VM: `Windows 11`, running, Parallels Tools guest execution available.
- Guest: Windows 11 Pro 24H2, build 26100, ARM64.
- WorkBuddy: installed per-user and running, product 5.2.6 / file 5.2.6.
- Executable: x64 process on ARM64 Windows; Authenticode status valid.
- Publisher: Tencent Technology (Shenzhen) Company Limited.
- Packaging: Electron application with `resources/app.asar`, unpacked resources, Chromium packs,
  and V8 snapshot.
- Electron: 37.10.3.
- Control channels: privacy-bounded Parallels Tools guest execution and visual access to the
  Parallels VM window.

## Static analysis

- Root package identity: `@genie/workbuddy-desktop` 5.2.6, entry `main/index.js`.
- Renderer: local `renderer/index.html`, module entry with hashed JS/CSS assets.
- UI library markers: `react-dom` and `createRoot` present in the packaged renderer entry; Vue and
  Svelte markers were not found by the bounded probe.
- This proves the package technology, not live DOM compatibility or a transport.

## VM verified proof Seam

- The official `WORKBUDDY_REMOTE_DEBUGGING_PORT` path launched a signed WorkBuddy 5.2.6 process.
- The listener was loopback-only and its owning process identity/signature passed the bounded gate.
- The production renderer was selected by URL suffix plus title, application, desktop, platform,
  product-version and unique-root conditions; cardinality was exactly one.
- `launch → preflight → apply → verify → pause → restore` all returned success.
- Apply, pause and restore were visually checked; restore removed every proof-owned marker.
- This verifies the reversible proof transport, not full theme projection or Settings integration.

## Partial-live-verified xtxg theme

- The Windows-owned Surface Catalog was built from privacy-bounded live probes for 5.2.6.
- `xtxg` Revision 3 completed preflight, apply, verify, pause, and restore on the VM.
- The background image, dark sidebar, readable main title/composer, and owned marker were visually
  verified. Revision 4 re-apply and verify were idempotent and left the theme visible.
- A white main-grid wrapper was identified by a read-only layer probe and is targeted only by an
  exact-version parent/item/child selector. The same hashed item class used by the sidebar is not
  targeted globally.
- This evidence is proof-only and does not enable the production capability.

## Unverified

- No Settings navigation mount point or native row parity has been verified.
- Settings apply, observer convergence, launch-with-theme persistence, long-duration CPU stability,
  keyboard/focus parity, contrast, debug-listener cleanup and production cleanup remain blocked.
  Neither the canary nor xtxg proof enables `runtimeApplyAvailable`.

## Privacy note

An early exploratory process query demonstrated why full command lines are prohibited: WorkBuddy
child arguments can contain private local paths and credentials. All committed probes now derive
only bounded facts and never emit the source command line.
