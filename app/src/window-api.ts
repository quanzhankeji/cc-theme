import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ManagerLocale } from "./i18n";

export const MANAGER_CLOSE_REQUESTED_EVENT = "manager-close-requested";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface ManagerWindowApi {
  onCloseRequested(handler: () => void): Promise<UnlistenFn>;
  setLocale(locale: ManagerLocale): Promise<void>;
  minimizeToMenuBar(): Promise<void>;
  quitManager(): Promise<void>;
}

export const managerWindowApi: ManagerWindowApi = {
  async onCloseRequested(handler) {
    if (!inTauri()) return () => {};
    return listen(MANAGER_CLOSE_REQUESTED_EVENT, handler);
  },

  async setLocale(locale) {
    if (!inTauri()) return;
    await invoke("set_manager_locale", { locale });
  },

  async minimizeToMenuBar() {
    if (!inTauri()) return;
    await invoke("minimize_to_menu_bar");
  },

  async quitManager() {
    if (!inTauri()) return;
    await invoke("quit_manager");
  },
};
