import { invoke } from "@tauri-apps/api/core";
import { cloneDemoDashboard, DEMO_DIAGNOSTICS, demoResult } from "./demo-data";
import type {
  ClientId,
  ClientRuntimeState,
  DashboardState,
  DiagnosticReport,
  OperationResult,
} from "./types";

const DEMO_LATENCY_MS = 260;

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function demoDelay(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, DEMO_LATENCY_MS));
}

async function call<T>(command: string, args?: Record<string, unknown>, fallback?: () => T | Promise<T>): Promise<T> {
  if (inTauri()) return invoke<T>(command, args);
  if (!fallback) throw new Error(`命令 ${command} 只能在桌面应用中运行`);
  await demoDelay();
  return fallback();
}

export const desktopApi = {
  getDashboardState(): Promise<DashboardState> {
    return call("get_dashboard_state", undefined, cloneDemoDashboard);
  },

  getClientRuntimeStates(): Promise<ClientRuntimeState[]> {
    return call("get_client_runtime_states", undefined, () => cloneDemoDashboard().clients.map(({ id, runState }) => ({ id, runState })));
  },

  refreshClient(clientId: ClientId): Promise<OperationResult> {
    return call("refresh_client", { clientId }, () => demoResult("客户端状态已刷新"));
  },

  applyTheme(clientId: ClientId, themeId: string, launch = true): Promise<OperationResult> {
    return call("apply_theme", { clientId, themeId, launch }, () => demoResult(launch ? "主题已应用，客户端已启动" : "主题已应用"));
  },

  launchClient(clientId: ClientId): Promise<OperationResult> {
    return call("launch_client", { clientId }, () => demoResult("客户端已启动"));
  },

  pauseTheme(clientId: ClientId): Promise<OperationResult> {
    return call("pause_theme", { clientId }, () => demoResult("主题注入已暂停"));
  },

  restoreTheme(clientId: ClientId): Promise<OperationResult> {
    return call("restore_theme", { clientId }, () => demoResult("已恢复原生外观"));
  },

  importThemePackage(packagePath: string): Promise<OperationResult<{ themeId: string }>> {
    return call("import_theme_package", { packagePath }, () => ({
      status: "success",
      code: "theme-imported",
      message: "主题包已安全导入",
      details: { themeId: "demo-theme" },
    }));
  },

  installLocalAdapter(clientId: ClientId, packagePath: string): Promise<OperationResult<{
    adapterId: string;
    adapterVersion: string;
    adapterReleaseRevision: number;
    replacedLocalAdapter: boolean;
  }>> {
    return call("install_local_adapter", { clientId, packagePath }, () => ({
      status: "success",
      code: "adapter-installed",
      message: "Adapter 已完成校验并安全安装",
      details: {
        adapterId: clientId,
        adapterVersion: "0.0.0",
        adapterReleaseRevision: 1,
        replacedLocalAdapter: false,
      },
    }));
  },

  deleteLocalTheme(themeId: string): Promise<OperationResult<{ removedEntries: number }>> {
    return call("delete_local_theme", { themeId }, () => ({
      status: "success",
      code: "theme-deleted",
      message: "本地主题及其关联数据已删除",
      details: { removedEntries: 1 },
    }));
  },

  runDiagnostics(clientId?: ClientId): Promise<OperationResult<DiagnosticReport>> {
    return call("run_diagnostics", { clientId: clientId ?? null }, () => ({
      status: "success",
      code: "demo-ok",
      message: "诊断完成",
      details: { ...structuredClone(DEMO_DIAGNOSTICS), clientId: clientId ?? null },
    }));
  },
};

export type DesktopApi = typeof desktopApi;
