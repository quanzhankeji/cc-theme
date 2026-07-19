import { open } from "@tauri-apps/plugin-dialog";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface ThemePackagePicker {
  chooseThemePackage(): Promise<string | null>;
}

export const themePackagePicker: ThemePackagePicker = {
  async chooseThemePackage() {
    if (!inTauri()) return null;
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "CC Theme Package", extensions: ["cctheme"] }],
    });
    return Array.isArray(selected) ? selected[0] ?? null : selected;
  },
};
