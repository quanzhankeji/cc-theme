import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type ThemePackageDropEvent =
  | { type: "enter"; paths: string[] }
  | { type: "over" }
  | { type: "drop"; paths: string[] }
  | { type: "leave" };

export interface ThemePackageDropTarget {
  onThemePackageDrop(handler: (event: ThemePackageDropEvent) => void): Promise<UnlistenFn>;
}

export const themePackageDropTarget: ThemePackageDropTarget = {
  async onThemePackageDrop(handler) {
    if (!inTauri()) return () => {};
    return getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter" || payload.type === "drop") {
        handler({ type: payload.type, paths: payload.paths });
      } else {
        handler({ type: payload.type });
      }
    });
  },
};
