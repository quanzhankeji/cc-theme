import { invoke } from "@tauri-apps/api/core";
import { cloneDemoDashboard, DEMO_DIAGNOSTICS, demoResult } from "./demo-data";
import type {
  AdapterCatalogStatus,
  AdapterDownloadDetails,
  AdapterInstallDetails,
  ClientId,
  ClientRuntimeState,
  DashboardState,
  DiagnosticReport,
  OperationResult,
} from "./types";
import type { ThemeWorkbenchDraft } from "./theme-workbench";

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

  installLocalAdapter(clientId: ClientId, packagePath: string): Promise<OperationResult<AdapterInstallDetails>> {
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

  checkAdapterUpdates(force = false): Promise<OperationResult<AdapterCatalogStatus>> {
    return call("check_adapter_updates", { force }, () => ({
      status: "success",
      code: "adapter-catalog-ready",
      message: "已通过官方签名清单检查 Adapter",
      details: {
        sequence: 1,
        source: "cache",
        checkedAt: new Date().toISOString(),
        adapters: cloneDemoDashboard().clients.map((client) => ({
          adapterId: client.id,
          status: "current" as const,
          latestVersion: client.adapterVersion ?? null,
          latestReleaseRevision: client.adapterReleaseRevision ?? null,
          source: "cache" as const,
          message: "已安装签名清单中的最新 Adapter",
        })),
      },
    }));
  },

  downloadLatestAdapter(clientId: ClientId): Promise<OperationResult<AdapterDownloadDetails>> {
    return call("download_latest_adapter", { clientId }, () => ({
      status: "success",
      code: "adapter-downloaded-installed",
      message: "已从官方签名清单下载并安全安装 Adapter",
      details: {
        adapterId: clientId,
        adapterVersion: "0.0.0",
        adapterReleaseRevision: 1,
        assetIdentity: `${clientId}-0.0.0-r1-macos-arm64`,
        archiveSha256: "0".repeat(64),
        replacedLocalAdapter: false,
        catalogSequence: 1,
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

  saveThemeSurfaceOpacity(themeId: string, surfaceOpacity: number): Promise<OperationResult<{ themeId: string; surfaceOpacity: number }>> {
    return call("save_theme_surface_opacity", { themeId, surfaceOpacity }, () => ({
      status: "success",
      code: "theme-local-override-saved",
      message: "主内容背景透明度已保存到本地主题",
      details: { themeId, surfaceOpacity },
    }));
  },

  saveThemeWorkbenchDraft(draft: ThemeWorkbenchDraft, mediaBytes: Uint8Array | null): Promise<OperationResult<{ themeId: string }>> {
    return call("save_theme_workbench_draft", { draft, mediaBytes }, () => ({
      status: "success",
      code: "theme-workbench-draft-saved",
      message: "主题编辑已安全保存到本地，将在下次应用主题时生效",
      details: { themeId: draft.base.themeId },
    }));
  },

  resetThemeWorkbenchDraft(themeId: string): Promise<OperationResult<{ themeId: string; removed: boolean }>> {
    return call("reset_theme_workbench_draft", { themeId }, () => ({
      status: "success",
      code: "theme-workbench-draft-reset",
      message: "已恢复导入主题的原始设置；本地编辑副本已移除",
      details: { themeId, removed: true },
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
