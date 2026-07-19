import { open } from "@tauri-apps/plugin-dialog";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface AdapterPackagePicker {
  chooseAdapterPackage(): Promise<string | null>;
}

export const adapterPackagePicker: AdapterPackagePicker = {
  async chooseAdapterPackage() {
    if (!inTauri()) return null;
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "CC Theme Adapter", extensions: ["ccadapter"] }],
    });
    return Array.isArray(selected) ? selected[0] ?? null : selected;
  },
};
