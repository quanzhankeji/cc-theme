(() => {
  "use strict";

  if (location.origin !== "https://claude.ai") return;

  const styleId = "cc-theme-extension-proof-style";
  const markerId = "cc-theme-extension-proof-marker";
  const datasetKey = "ccThemeExtensionProof";

  const namespaceOccupied =
    document.getElementById(styleId) ||
    document.getElementById(markerId) ||
    Object.hasOwn(document.documentElement.dataset, datasetKey);

  if (namespaceOccupied) {
    console.warn("[CC Theme proof] owned namespace is occupied; no mutation performed");
    return;
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
  marker.setAttribute("role", "status");
  marker.setAttribute("aria-label", "CC Theme extension proof only");
  Object.assign(marker.style, {
    position: "fixed",
    inset: "12px 12px auto auto",
    zIndex: "2147483647",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 10px",
    border: "2px solid #63e6be",
    borderRadius: "8px",
    background: "#101827",
    color: "#f3f7ff",
    font: "600 12px/1.4 system-ui",
  });

  const label = document.createElement("span");
  label.textContent = "CC Theme — extension proof only";

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Remove proof";
  removeButton.setAttribute("aria-label", "Remove CC Theme extension proof");
  Object.assign(removeButton.style, {
    padding: "3px 7px",
    border: "1px solid #63e6be",
    borderRadius: "5px",
    background: "transparent",
    color: "#f3f7ff",
    font: "inherit",
    cursor: "pointer",
  });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    removeButton.removeEventListener("click", cleanup);
    window.removeEventListener("pagehide", cleanup);
    style.remove();
    marker.remove();
    delete document.documentElement.dataset[datasetKey];
  };

  removeButton.addEventListener("click", cleanup, { once: true });
  window.addEventListener("pagehide", cleanup, { once: true });
  marker.append(label, removeButton);
  document.head.append(style);
  document.documentElement.append(marker);
  document.documentElement.dataset[datasetKey] = "1.22209.0";
})();
