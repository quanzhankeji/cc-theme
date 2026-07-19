# Settings -> CC Theme native parity plan

The placement and host implementation are unverified. Once Claude is installed,
the exact supported build's adjacent native Settings entry becomes the comparison
oracle. CC Theme must match it without copying host handlers or exposing host
landmarks to theme data.

For both entries, independent acceptance records only bounded structural facts:

- row and icon-container geometry at 100%, 125%, 150%, and 200% DPI;
- control type, enabled/selected state, focusability, tab index, and supported UIA
  patterns;
- default, hover, pressed, selected, selected-hover, focus-visible, and disabled
  appearance;
- transition properties/duration and Reduced Motion behavior;
- Tab, Shift+Tab, native directional navigation, Enter, Space, and Escape;
- page switch, focus restoration, reopen, renderer reload, and app restart.

The editor page is generated from the Style Catalog. Each legal input previews
immediately, is scheduled with a 180 ms debounce, receives a monotonic revision
within the current renderer session and theme nonce, and saves atomically. A stale
ack can commit only when session nonce, generation, and revision all match the
current renderer session. Cross-process values are not ordered against each
other. There is no Save button. Failure restores the last valid controls,
renderer, and disk state and exposes a localized non-blocking diagnostic.
