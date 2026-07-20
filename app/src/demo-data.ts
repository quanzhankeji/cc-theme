import type { DashboardState, DiagnosticReport, OperationResult } from "./types";

export const DEMO_DASHBOARD: DashboardState = {
  lastRefreshedAt: new Date().toISOString(),
  capabilities: [
    {
      adapterId: "mac-codex",
      displayName: "Codex",
      availability: "available",
      runtimeApplyAvailable: true,
      runtimeLaunchAvailable: true,
      deepSettingsAvailable: true,
      capabilityVersion: "1.0.0",
      catalogVersion: "2026-07",
      reason: "可逆应用 Seam 已验证",
    },
    {
      adapterId: "mac-doubao",
      displayName: "Doubao",
      availability: "available",
      runtimeApplyAvailable: true,
      runtimeLaunchAvailable: true,
      deepSettingsAvailable: false,
      capabilityVersion: "1.0.0",
      catalogVersion: "1",
      reason: "Doubao 2.19.9 可逆 CDP 应用已验证",
    },
    {
      adapterId: "mac-workbuddy",
      displayName: "WorkBuddy",
      availability: "available",
      runtimeApplyAvailable: true,
      runtimeLaunchAvailable: true,
      deepSettingsAvailable: true,
      capabilityVersion: "1.0.0",
      catalogVersion: "2026-07",
      reason: "可逆应用 Seam 已验证",
    },
  ],
  clients: [
    {
      id: "mac-codex",
      name: "Codex",
      bundleId: "com.openai.codex",
      discovered: true,
      version: "26.715.31925",
      signature: { status: "verified", teamId: "2DC432GLL2", label: "签名已验证" },
      runState: "running",
      currentThemeId: "paper-moon",
      currentThemeName: "纸月 Paper Moon",
      themePaused: false,
      adapterReady: true,
      adapterVersion: "26.715.31925",
      adapterReleaseRevision: 1,
      adapterSource: "bundled",
      adapterStatus: "ready",
      detail: "运行中 · 端口 9341 · 始终适配最新版",
    },
    {
      id: "mac-doubao",
      name: "Doubao",
      bundleId: "com.bot.pc.doubao",
      discovered: true,
      version: "2.19.9",
      signature: { status: "verified", teamId: "96L78H6LMH", label: "签名已验证" },
      runState: "running",
      currentThemeId: null,
      currentThemeName: "原生外观",
      themePaused: false,
      adapterReady: true,
      adapterVersion: "2.19.9",
      adapterReleaseRevision: 1,
      adapterSource: "bundled",
      adapterStatus: "ready",
      detail: "已验证 · 端口 9343 · 本地 CDP 可用",
    },
    {
      id: "mac-workbuddy",
      name: "WorkBuddy",
      bundleId: "com.workbuddy.desktop",
      discovered: true,
      version: "5.2.6",
      signature: { status: "verified", teamId: null, label: "签名已验证" },
      runState: "stopped",
      currentThemeId: null,
      currentThemeName: "原生外观",
      themePaused: false,
      adapterReady: true,
      adapterVersion: "5.2.6",
      adapterReleaseRevision: 1,
      adapterSource: "bundled",
      adapterStatus: "ready",
      detail: "已验证 · 端口 9342 · 等待启动",
    },
  ],
  themes: [
    {
      id: "paper-moon",
      name: "纸月 Paper Moon",
      author: "CC Theme Studio",
      description: "温柔的暖白画布、墨色文字与低饱和靛蓝，适合长时间阅读。",
      colors: ["#f0eadb", "#6366a8", "#25263a"],
      installed: true,
      updatedAt: "2026-07-18T09:30:00.000Z",
      compatibility: {
        "mac-codex": { status: "ready", adapterVersion: "1.0.0", note: "完全适配" },
        "mac-doubao": { status: "ready", adapterVersion: "1.0.0", note: "完全适配" },
        "mac-workbuddy": { status: "ready", adapterVersion: "1.0.0", note: "完全适配" },
      },
    },
    {
      id: "midnight-ink",
      name: "午夜墨水",
      author: "CC Theme Studio",
      description: "深蓝黑背景搭配薄荷绿强调色，保留清晰的信息层级。",
      colors: ["#111525", "#58c6a9", "#dce9ed"],
      installed: true,
      updatedAt: "2026-07-16T10:00:00.000Z",
      compatibility: {
        "mac-codex": { status: "ready", adapterVersion: "1.1.0", note: "完全适配" },
        "mac-doubao": { status: "ready", adapterVersion: "1.0.0", note: "静态背景适配" },
        "mac-workbuddy": { status: "needs-update", adapterVersion: "0.9.0", note: "适配器待更新" },
      },
    },
    {
      id: "amber-terminal",
      name: "琥珀终端",
      author: "Community Lab",
      description: "受经典终端启发的高对比琥珀配色，控制台信息更醒目。",
      colors: ["#17120a", "#f0a84b", "#ffe6b8"],
      installed: true,
      updatedAt: "2026-07-12T08:00:00.000Z",
      compatibility: {
        "mac-codex": { status: "ready", adapterVersion: "1.0.0", note: "完全适配" },
        "mac-doubao": { status: "ready", adapterVersion: "1.0.0", note: "静态背景适配" },
        "mac-workbuddy": { status: "unavailable", adapterVersion: null, note: "暂不支持" },
      },
    },
  ],
  activities: [
    {
      id: "demo-ready",
      clientId: null,
      title: "本地服务已就绪",
      message: "已完成客户端与主题库扫描",
      status: "success",
      timestamp: new Date(Date.now() - 48_000).toISOString(),
    },
  ],
};

export const DEMO_DIAGNOSTICS: DiagnosticReport = {
  clientId: null,
  summary: "基础检查完成，WorkBuddy 当前未启动。",
  generatedAt: new Date().toISOString(),
  checks: [
    { id: "theme-store", label: "主题仓库", status: "pass", detail: "3 个主题家族可用" },
    { id: "runtime", label: "内置运行时", status: "pass", detail: "Node Sidecar 与签名均有效" },
    { id: "workbuddy", label: "WorkBuddy", status: "pass", detail: "5.2.6 · 签名与适配器已验证" },
  ],
};

export function demoResult(message: string): OperationResult {
  return { status: "success", code: "demo-ok", message, details: { demo: true } };
}

export function cloneDemoDashboard(): DashboardState {
  return structuredClone(DEMO_DASHBOARD);
}
