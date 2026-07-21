# Mac Doubao Adapter

This macOS Adapter applies CC Theme `skin.theme` output to the verified Doubao
chat renderer through a loopback-only Chrome DevTools Protocol session. It does
not modify `Doubao.app`, its built-in extension, or the user profile.

The current compatibility baseline is Doubao 2.19.9, signed by team
`96L78H6LMH`. Runtime apply fails closed for other versions or missing structural
landmarks.

Use `scripts/doctor-macos.sh` for identity diagnostics, and the Manager command
surface `switch-theme-macos.sh`, `pause-skin-macos.sh`,
`restore-skin-macos.sh`, and `verify-skin-macos.sh` for lifecycle operations.

The runtime consumes a static PNG/JPEG/WebP background or a generation-bound
MP4, structural surface tints, backdrop blur/saturation, and background
position. The default `system` palette preserves Doubao's native typography,
icons, control colors, borders, focus, overlays, shadows, and animations. The
optional `adaptive` palette adds only a bounded Light/Dark-safe tint to large
structural surfaces. Ripple and directional backgrounds remain static image
approximations with visible diagnostics; unsupported control colors and fonts
are diagnosed instead of being silently applied.

The Manager compile context is an exact nine-key contract:
`detectedClientVersion`, `detectedClientBuild`, `surfaceCatalogId`,
`surfaceCatalogVersion`, `probeStatus`, `compileAllowed`, `applyAllowed`,
`reasonCode`, and `localRuntimeOverrides`. The optional `mac-doubao` Target
Profile may select `system` or `adaptive`; missing means `system`. The
persistent watcher is an owned, fixed-argument user LaunchAgent and is removed
by pause, restore, or rollback.
