# Detached DevTools proof — manual and non-production

## Purpose and boundary

This is a one-time, operator-driven proof against the official Windows Claude
Desktop `1.22209.0` renderer. It may demonstrate a visible temporary style and a
complete cleanup through the official `CLAUDE_DEV_TOOLS=detach` path.

It is **not** a production apply Seam, automation transport, compatibility claim,
or theme format. The Console snippet below must never enter a `skin.theme`,
`.cctheme`, preset, runtime asset, installer, or automatic command. It uses no
remote-debugging port/pipe, authentication token, DLL injection, persistence, or
official-file modification.

## Preconditions

1. Confirm the exact client is the signed Microsoft Store/MSIX ARM64 build
   `1.22209.0`.
2. Use the official detached DevTools environment path with a process-scoped
   environment value only. Never use `setx`, Registry persistence, a system/user
   environment setting, startup task, or shortcut modification. Do not add any
   remote-debugging arguments or inspect/copy authentication material.
3. Open a blank, non-sensitive Claude surface. Do not capture conversation text,
   input values, account data, accessible names, URLs, tokens, or complete paths.
4. Keep the normal client restart path available as the final cleanup check.

## Apply the disposable proof

Select the Claude renderer context in detached DevTools and paste this whole
snippet once:

```js
(() => {
  const styleId = "cc-theme-devtools-proof-style";
  const markerId = "cc-theme-devtools-proof-marker";

  const occupied =
    document.getElementById(styleId) ||
    document.getElementById(markerId) ||
    Object.hasOwn(document.documentElement.dataset, "ccThemeDevtoolsProof");
  if (occupied) {
    return {
      applied: false,
      code: "proof-namespace-occupied",
    };
  }

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    html, body {
      background: #101827 !important;
      color: #f3f7ff !important;
    }
    button, input, textarea {
      border-color: #63e6be !important;
      outline-color: #63e6be !important;
    }
  `;

  const marker = document.createElement("div");
  marker.id = markerId;
  marker.textContent = "CC Theme — DevTools proof only";
  Object.assign(marker.style, {
    position: "fixed",
    inset: "12px 12px auto auto",
    zIndex: "2147483647",
    padding: "8px 12px",
    border: "2px solid #63e6be",
    borderRadius: "8px",
    background: "#101827",
    color: "#f3f7ff",
    font: "600 12px/1.4 system-ui",
    pointerEvents: "none",
  });

  document.head.append(style);
  document.documentElement.append(marker);
  document.documentElement.dataset.ccThemeDevtoolsProof = "1.22209.0";

  return {
    applied: true,
    version: document.documentElement.dataset.ccThemeDevtoolsProof,
    stylePresent: Boolean(document.getElementById(styleId)),
    markerPresent: Boolean(document.getElementById(markerId)),
  };
})()
```

If the result is `proof-namespace-occupied`, stop without deleting or replacing
anything. Investigate outside this proof; do not run cleanup against state this
proof did not create.

Pass requires a visible dark canvas or affected native controls, the fixed proof
marker, and a returned object with all three booleans true. A marker alone proves
only renderer Console mutation; record separately whether native surfaces changed.

## Verify without collecting user content

Run:

```js
({
  applied: document.documentElement.dataset.ccThemeDevtoolsProof === "1.22209.0",
  stylePresent: Boolean(document.getElementById("cc-theme-devtools-proof-style")),
  markerPresent: Boolean(document.getElementById("cc-theme-devtools-proof-marker")),
})
```

Record only the three booleans, whether native surfaces visibly changed, the exact
client version, and a UTC timestamp. Do not persist a raw screenshot.

## Restore

Paste:

```js
(() => {
  document.getElementById("cc-theme-devtools-proof-style")?.remove();
  document.getElementById("cc-theme-devtools-proof-marker")?.remove();
  delete document.documentElement.dataset.ccThemeDevtoolsProof;
  return {
    restored:
      !document.getElementById("cc-theme-devtools-proof-style") &&
      !document.getElementById("cc-theme-devtools-proof-marker") &&
      !document.documentElement.dataset.ccThemeDevtoolsProof,
  };
})()
```

Pass requires `restored: true` and immediate native appearance restoration. Then:

1. close the detached DevTools window;
2. exit Claude completely;
3. confirm the proof launch used only a process-scoped environment value and did
   not create `setx`, Registry, shortcut, task, or system/user environment state;
4. cold-start Claude normally with no proof environment value;
5. confirm no detached DevTools window, marker, dataset, or proof style returns.

If cleanup, DevTools closure, or cold restart does not restore the exact native
state, stop, record `cleanup-incomplete`, and do not repeat the proof.

## Interpretation

- Console could not reach the target renderer: `adapter-landmark-missing`.
- Proof applied but native surfaces did not change: `visual-regression`; renderer
  mutation is proven but theming is not.
- Cleanup or restart failed: `cleanup-incomplete`.
- Proof namespace already occupied: `adapter-landmark-missing`; no mutation is
  permitted.
- Full apply/pause/restore capability: still unavailable in every outcome.
