# win-workbuddy

Independent Windows 11 adapter baseline for CC Theme and WorkBuddy Desktop.

Current status: **`paused-by-user`**. Existing static projection, contracts, and historical evidence
are preserved without further development. The project is excluded from active workspace, CI,
Manager resources, signing, notarization, and Releases. A loopback, signed-process
bound canary Seam has completed `launch/apply/verify/pause/restore` on the lab VM, including visual
checks and exact renderer-DOM restore. Debug-listener shutdown/relaunch cleanup is not yet verified.
The xtxg proof-theme completed live `preflight/apply/verify/pause/restore` acceptance against the
Windows-owned Surface Catalog. The background, dark sidebar, readable main content, marker, pause,
restore, and idempotent re-apply were visually verified. This is still `partial-live-verified`:
independent cleanup, Settings parity, observer convergence, long-duration stability, keyboard/focus,
and contrast remain gated. Production `runtimeApplyAvailable` remains false. The VM
also confirms WorkBuddy 5.2.6, a valid Tencent Authenticode signature, Electron 37.10.3, an ASAR
renderer, and React.

## Verify the baseline

```bash
npm test
npm run check
```

## Run the xtxg proof theme

From PowerShell in this directory, with the already verified loopback debug session running on
port 9223:

```powershell
.\scripts\theme-seam.ps1 -Operation preflight -Port 9223 -Generation 1
.\scripts\theme-seam.ps1 -Operation apply -Port 9223 -Generation 1
.\scripts\theme-seam.ps1 -Operation verify -Port 9223 -Generation 1
.\scripts\theme-seam.ps1 -Operation pause -Port 9223 -Generation 1
.\scripts\theme-seam.ps1 -Operation restore -Port 9223 -Generation 1
```

If a new debug session is required, fully exit WorkBuddy first and run:

```powershell
.\scripts\start-proof-workbuddy.ps1 -Port 9223
```

The default preset is `presets/xtxg/unified-theme.json`. Theme input contains values and local
asset basenames only. It cannot carry CSS, selectors, JavaScript, HTML, shaders, commands, URLs,
or arbitrary paths. Results emit no full user path, command line, token, environment block, or
conversation data.

## Project boundaries

- `contracts/`: Adapter Capability, Target Profile, target theme, settings, and operation results.
- `compatibility/`: exact Windows WorkBuddy version catalogs; unverified catalogs cannot apply.
- `src/`: fixed projector, normalizer, capability gate, UI interpreter, settings session, and
  lifecycle seam.
- Historical xtxg evidence is retained as a read-only record; no preset or production media is stored in this Adapter.
- `evidence/`: redacted facts and evidence classifications.
- `docs/`: architecture, safety, test matrix, and risk-ordered delivery plan.

Nothing in this directory modifies WorkBuddy, `app.asar`, another adapter, or the shared Manager.
