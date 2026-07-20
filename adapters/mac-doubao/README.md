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

The frozen runtime consumes a static PNG/JPEG/WebP background, verified color
roles, the UI font, backdrop blur/saturation, radius scale, and background
position. Video, ripple, and directional background inputs are projected to a
static image with visible approximation diagnostics. Display/code fonts,
`shellMode`, and unbound semantic roles are unsupported and diagnosed; required
unsupported inputs fail closed.

The Manager compile context is an exact nine-key contract:
`detectedClientVersion`, `detectedClientBuild`, `surfaceCatalogId`,
`surfaceCatalogVersion`, `probeStatus`, `compileAllowed`, `applyAllowed`,
`reasonCode`, and `localRuntimeOverrides`. The `mac-doubao` Target Profile must
be an empty object. The persistent watcher is an owned, fixed-argument user
LaunchAgent and is removed by pause, restore, or rollback.
