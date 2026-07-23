import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { AdapterPackagePicker } from "./adapter-package-picker";
import type { DesktopApi } from "./api";
import { cloneDemoDashboard, DEMO_DIAGNOSTICS } from "./demo-data";
import type { ThemePackagePicker } from "./theme-package-picker";
import type { ThemePackageDropEvent, ThemePackageDropTarget } from "./theme-package-drop";
import type { ManagerWindowApi } from "./window-api";

function success(message: string) {
  return Promise.resolve({ status: "success" as const, code: "ok", message });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function makeApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    getDashboardState: vi.fn(() => Promise.resolve(cloneDemoDashboard())),
    getClientRuntimeStates: vi.fn(() => Promise.resolve([])),
    refreshClient: vi.fn(() => success("状态已刷新")),
    applyTheme: vi.fn(() => success("主题已应用，客户端已启动")),
    launchClient: vi.fn(() => success("客户端已启动")),
    pauseTheme: vi.fn(() => success("主题已暂停")),
    restoreTheme: vi.fn(() => success("已恢复原生外观")),
    importThemePackage: vi.fn(() => Promise.resolve({ status: "success" as const, code: "theme-imported", message: "主题包已安全导入", details: { themeId: "example" } })),
    installLocalAdapter: vi.fn((clientId) => Promise.resolve({ status: "success" as const, code: "adapter-installed", message: "Adapter 已完成校验并安全安装", details: { adapterId: clientId, adapterVersion: "1.0.0", adapterReleaseRevision: 1, replacedLocalAdapter: false } })),
    checkAdapterUpdates: vi.fn(() => Promise.resolve({
      status: "success" as const,
      code: "adapter-catalog-ready",
      message: "已通过官方签名清单检查 Adapter",
      details: {
        sequence: 1,
        source: "cache" as const,
        checkedAt: "2026-07-20T15:40:00Z",
        adapters: cloneDemoDashboard().clients.map((client) => ({
          adapterId: client.id,
          status: "current" as const,
          latestVersion: client.adapterVersion ?? null,
          latestReleaseRevision: client.adapterReleaseRevision ?? null,
          source: "cache" as const,
          message: "已安装签名清单中的最新 Adapter",
        })),
      },
    })),
    downloadLatestAdapter: vi.fn((clientId) => Promise.resolve({
      status: "success" as const,
      code: "adapter-downloaded-installed",
      message: "已从官方签名清单下载并安全安装 Adapter",
      details: {
        adapterId: clientId,
        adapterVersion: clientId === "mac-codex" ? "26.715.61943" : "5.2.6",
        adapterReleaseRevision: 1,
        assetIdentity: `${clientId}-test-r1-macos-arm64`,
        archiveSha256: "0".repeat(64),
        replacedLocalAdapter: false,
        catalogSequence: 1,
      },
    })),
    deleteLocalTheme: vi.fn(() => Promise.resolve({ status: "success" as const, code: "theme-deleted", message: "本地主题及其关联数据已删除", details: { removedEntries: 3 } })),
    saveThemeSurfaceOpacity: vi.fn((themeId, surfaceOpacity) => Promise.resolve({ status: "success" as const, code: "theme-local-override-saved", message: "主内容背景透明度已保存到本地主题", details: { themeId, surfaceOpacity } })),
    saveThemeWorkbenchDraft: vi.fn((draft) => Promise.resolve({ status: "success" as const, code: "theme-workbench-draft-saved", message: "主题编辑已安全保存到本地", details: { themeId: draft.base.themeId } })),
    resetThemeWorkbenchDraft: vi.fn((themeId) => Promise.resolve({ status: "success" as const, code: "theme-workbench-draft-reset", message: "已恢复导入主题的原始设置", details: { themeId, removed: true } })),
    runDiagnostics: vi.fn(() => Promise.resolve({ status: "success" as const, code: "ok", message: "诊断完成", details: structuredClone(DEMO_DIAGNOSTICS) })),
    ...overrides,
  };
}

function makeWindowApi() {
  let closeHandler = () => {};
  const api: ManagerWindowApi = {
    onCloseRequested: vi.fn(async (handler) => {
      closeHandler = handler;
      return () => {};
    }),
    setLocale: vi.fn(() => Promise.resolve()),
    minimizeToMenuBar: vi.fn(() => Promise.resolve()),
    quitManager: vi.fn(() => Promise.resolve()),
  };
  return { api, requestClose: () => closeHandler() };
}

function makeDropTarget() {
  let handler: (event: ThemePackageDropEvent) => void = () => {};
  const target: ThemePackageDropTarget = {
    onThemePackageDrop: vi.fn(async (nextHandler) => {
      handler = nextHandler;
      return () => {};
    }),
  };
  return { target, emit: (event: ThemePackageDropEvent) => handler(event) };
}

describe("CC Theme desktop dashboard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("cc-theme.locale", "zh-CN");
    delete document.documentElement.dataset.appearance;
    document.documentElement.removeAttribute("lang");
    Object.defineProperty(window.navigator, "languages", {
      configurable: true,
      value: ["zh-CN"],
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });
  });

  it("支持中文和 English 切换，并同步保存主窗口与菜单栏语言", async () => {
    const managerWindow = makeWindowApi();
    const user = userEvent.setup();
    render(<App api={makeApi()} windowApi={managerWindow.api} />);

    await screen.findByRole("heading", { name: "主题与应用" });
    expect(document.documentElement).toHaveAttribute("lang", "zh-CN");
    expect(screen.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "English" }));

    expect(await screen.findByRole("heading", { name: "Themes & Apps" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("lang", "en-US");
    expect(window.localStorage.getItem("cc-theme.locale")).toBe("en-US");
    expect(screen.getByRole("button", { name: "Rescan" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Installed clients" })).toBeInTheDocument();
    expect(screen.queryByTestId("tool-status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("client-mac-claude")).not.toBeInTheDocument();
    await waitFor(() => expect(managerWindow.api.setLocale).toHaveBeenLastCalledWith("en-US"));

    act(() => managerWindow.requestClose());
    const dialog = screen.getByRole("dialog", { name: "Close CC Theme" });
    expect(dialog).toHaveTextContent("Themes already applied will remain active");
    expect(within(dialog).getByRole("button", { name: "Keep in Menu Bar" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Quit App" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "中文" }));
    expect(await screen.findByRole("heading", { name: "主题与应用" })).toBeInTheDocument();
    expect(window.localStorage.getItem("cc-theme.locale")).toBe("zh-CN");
  });

  it("没有保存语言时跟随系统英文，且不主动写入用户选择", async () => {
    window.localStorage.removeItem("cc-theme.locale");
    Object.defineProperty(window.navigator, "languages", {
      configurable: true,
      value: ["en-US", "en"],
    });

    render(<App api={makeApi()} />);

    expect(await screen.findByRole("heading", { name: "Themes & Apps" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("lang", "en-US");
    expect(window.localStorage.getItem("cc-theme.locale")).toBeNull();
  });

  it("在 Light 和 Dark 应用主题间切换并记住用户选择", async () => {
    window.localStorage.setItem("cc-theme.appearance", "light");
    const user = userEvent.setup();

    render(<App api={makeApi()} />);

    await screen.findByRole("heading", { name: "主题与应用" });
    expect(document.documentElement).toHaveAttribute("data-appearance", "light");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Dark" }));

    expect(document.documentElement).toHaveAttribute("data-appearance", "dark");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("cc-theme.appearance")).toBe("dark");
  });

  it("没有保存选择时跟随 macOS 的 Light 外观", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });

    render(<App api={makeApi()} />);

    await screen.findByRole("heading", { name: "主题与应用" });
    expect(document.documentElement).toHaveAttribute("data-appearance", "light");
    expect(window.localStorage.getItem("cc-theme.appearance")).toBeNull();
  });

  it("在单屏工具界面展示主题、客户端和启动操作", async () => {
    render(<App api={makeApi()} />);

    expect(await screen.findByRole("heading", { name: "主题与应用" })).toBeInTheDocument();
    expect(screen.queryByText(/一个控制台/)).not.toBeInTheDocument();
    expect(screen.queryByText("本地主题工具")).not.toBeInTheDocument();
    expect(screen.queryByText("仅在本机运行")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新扫描" })).toBeInTheDocument();
    expect(screen.getByTestId("client-mac-codex")).toHaveTextContent("26.715.61943");
    expect(screen.queryByTestId("client-mac-claude")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /作为应用目标/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/所选目标/)).not.toBeInTheDocument();
    expect(screen.getByTestId("client-mac-workbuddy")).toHaveTextContent("5.2.6");
    expect(screen.getByTestId("client-icon-mac-codex")).toBeInTheDocument();
    expect(screen.getByTestId("client-icon-mac-doubao")).toBeInTheDocument();
    expect(screen.getByTestId("client-icon-mac-workbuddy")).toBeInTheDocument();
    expect(screen.queryByTestId("tool-status")).not.toBeInTheDocument();
    expect(screen.queryByText("客户端内编辑")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "活动" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "诊断" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "运行全部诊断" })).not.toBeInTheDocument();
    const themeCard = screen.getByRole("button", { name: /午夜墨水/ });
    expect(themeCard).toHaveTextContent("午夜墨水");
    expect(themeCard).not.toHaveTextContent("CC Theme Studio");
    expect(themeCard).not.toHaveTextContent("已适配");
    expect(screen.queryByText("应用签名")).not.toBeInTheDocument();
    expect(screen.queryByText("所选主题")).not.toBeInTheDocument();
    const themeContainer = screen.getByTestId("theme-midnight-ink");
    expect(themeContainer).toHaveClass("theme-card");
    expect(within(themeContainer).getByRole("button", { name: "删除主题" })).toBeInTheDocument();
    expect(themeContainer.querySelector(".selected-indicator")).toBeInTheDocument();
  });

  it("全新安装没有生产预制主题，仍可正常启动已发现客户端", async () => {
    const dashboard = cloneDemoDashboard();
    dashboard.themes = [];
    dashboard.clients.find((client) => client.id === "mac-codex")!.runState = "stopped";
    const api = makeApi({ getDashboardState: vi.fn(() => Promise.resolve(dashboard)) });

    render(<App api={api} />);

    expect(await screen.findByText("暂无已下载主题")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /午夜墨水|纸月 Paper Moon/ })).not.toBeInTheDocument();
    expect(within(screen.getByTestId("client-mac-codex")).getByRole("button", { name: "正常启动 Codex" })).toBeEnabled();
    expect(within(screen.getByTestId("client-mac-codex")).getByRole("button", { name: "注入主题并启动 Codex" })).toBeDisabled();
  });

  it("导入本地 .cctheme 后按 Manager 当前语言展示主题包双语元数据", async () => {
    const initial = cloneDemoDashboard();
    initial.themes = [];
    const imported = cloneDemoDashboard();
    imported.themes = [{
      id: "example",
      name: "Example Theme",
      author: "CC Theme Contributors",
      description: "Fallback description",
      defaultLocale: "en-US",
      localizations: {
        "zh-CN": { name: "示例主题", description: "中文主题说明" },
        "en-US": { name: "Example Theme", description: "English theme description" },
      },
      colors: ["#10151F", "#2F7D57", "#E9EEF7"],
      previewUrl: "cc-theme-preview://localhost/example?revision=1",
      installed: true,
      updatedAt: "2026-07-19T00:00:00.000Z",
      compatibility: imported.themes[0].compatibility,
    }];
    const api = makeApi({
      getDashboardState: vi.fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValue(imported),
    });
    const packagePicker: ThemePackagePicker = {
      chooseThemePackage: vi.fn(() => Promise.resolve("/Users/example/Example.cctheme")),
    };
    const user = userEvent.setup();

    render(<App api={api} packagePicker={packagePicker} />);
    await screen.findByText("暂无已下载主题");
    await user.click(screen.getByRole("button", { name: "导入本地主题" }));

    const zhTheme = await screen.findByRole("button", { name: "示例主题" });
    expect(zhTheme).toHaveTextContent("示例主题");
    expect(zhTheme).not.toHaveTextContent("中文主题说明");
    expect(screen.getByTestId("theme-example").querySelector(".theme-cover img")).toHaveAttribute("src", imported.themes[0].previewUrl);
    expect(api.importThemePackage).toHaveBeenCalledWith("/Users/example/Example.cctheme");
    expect(screen.queryByText("主题导入完成")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(await screen.findByRole("button", { name: "Example Theme" })).toHaveTextContent("Example Theme");
    expect(screen.queryByText("中文主题说明")).not.toBeInTheDocument();
    expect(screen.queryByText("English theme description")).not.toBeInTheDocument();
  });

  it("为 presentation 合同失败显示精确的主题导入诊断", async () => {
    const api = makeApi({
      importThemePackage: vi.fn(() => Promise.resolve({
        status: "failed" as const,
        code: "theme-package-presentation-invalid",
        message: "主题 presentation 合同无效",
      })),
    });
    const packagePicker: ThemePackagePicker = {
      chooseThemePackage: vi.fn(() => Promise.resolve("/Users/example/GothicVoidCrusade.cctheme")),
    };
    const user = userEvent.setup();
    render(<App api={api} packagePicker={packagePicker} />);

    await screen.findByRole("heading", { name: "主题与应用" });
    await user.click(screen.getByRole("button", { name: "导入本地主题" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("主题的沉浸式展示档案不符合支持的安全规范");
    expect(screen.queryByText("主题包未通过安全校验，格式不正确，或同名主题已经安装")).not.toBeInTheDocument();
  });

  it("主题封面发生一次瞬时加载错误时重试，连续失败后才回退占位图", async () => {
    const dashboard = cloneDemoDashboard();
    dashboard.themes = [{
      ...dashboard.themes[0],
      id: "preview-retry",
      previewUrl: "cc-theme-preview://localhost/preview-retry?revision=1",
    }];

    render(<App api={makeApi({ getDashboardState: vi.fn(() => Promise.resolve(dashboard)) })} />);

    const card = await screen.findByTestId("theme-preview-retry");
    const firstImage = card.querySelector<HTMLImageElement>(".theme-cover img");
    expect(firstImage).not.toBeNull();
    expect(firstImage).toHaveAttribute("src", dashboard.themes[0].previewUrl);

    fireEvent.error(firstImage!);

    const retryImage = card.querySelector<HTMLImageElement>(".theme-cover img");
    expect(retryImage).not.toBeNull();
    expect(retryImage?.src).toContain("ccThemePreviewRetry=1");
    expect(card.querySelector(".theme-cover__placeholder")).not.toBeInTheDocument();

    fireEvent.error(retryImage!);

    expect(card.querySelector(".theme-cover img")).not.toBeInTheDocument();
    expect(card.querySelector(".theme-cover__placeholder")).toBeInTheDocument();
  });

  it("把单个 .cctheme 拖入窗口时显示接收提示，并通过同一安全导入流程安装", async () => {
    const initial = cloneDemoDashboard();
    initial.themes = [];
    const imported = cloneDemoDashboard();
    imported.themes = [{
      ...imported.themes[0],
      id: "dropped-theme",
      name: "Dropped Theme",
      localizations: {
        "zh-CN": { name: "拖入的主题", description: "" },
        "en-US": { name: "Dropped Theme", description: "" },
      },
    }];
    const api = makeApi({
      getDashboardState: vi.fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValue(imported),
      importThemePackage: vi.fn(() => Promise.resolve({
        status: "success" as const,
        code: "theme-imported",
        message: "主题包已安全导入",
        details: { themeId: "dropped-theme" },
      })),
    });
    const drop = makeDropTarget();
    render(<App api={api} dropTarget={drop.target} />);

    await screen.findByText("暂无已下载主题");
    await waitFor(() => expect(drop.target.onThemePackageDrop).toHaveBeenCalledTimes(1));
    act(() => drop.emit({ type: "enter", paths: ["/Users/example/Dropped.cctheme"] }));
    expect(screen.getByRole("status")).toHaveTextContent("松开以导入主题");
    expect(screen.getByRole("status")).toHaveTextContent("仅支持单个 .cctheme 文件");

    act(() => drop.emit({ type: "drop", paths: ["/Users/example/Dropped.cctheme"] }));

    await waitFor(() => expect(api.importThemePackage).toHaveBeenCalledWith("/Users/example/Dropped.cctheme"));
    expect(await screen.findByRole("button", { name: "拖入的主题" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("拒绝拖入多个文件或非 .cctheme 文件，且不调用主题导入", async () => {
    const api = makeApi();
    const drop = makeDropTarget();
    render(<App api={api} dropTarget={drop.target} />);

    await screen.findByRole("heading", { name: "主题与应用" });
    await waitFor(() => expect(drop.target.onThemePackageDrop).toHaveBeenCalledTimes(1));
    act(() => drop.emit({ type: "drop", paths: ["/tmp/One.cctheme", "/tmp/Two.cctheme"] }));
    expect(await screen.findByRole("alert")).toHaveTextContent("每次只能拖入一个 .cctheme 主题包");
    expect(api.importThemePackage).not.toHaveBeenCalled();

    act(() => drop.emit({ type: "drop", paths: ["/tmp/not-a-theme.zip"] }));
    expect(await screen.findByRole("alert")).toHaveTextContent("拖入的文件不是 .cctheme 主题包");
    expect(api.importThemePackage).not.toHaveBeenCalled();
  });

  it("删除主题前二次确认，确认后移除条目并刷新本地状态", async () => {
    window.localStorage.setItem("cc-theme.last-client-themes", JSON.stringify({
      "mac-codex": "midnight-ink",
      "mac-workbuddy": "paper-moon",
    }));
    const initial = cloneDemoDashboard();
    const deleted = cloneDemoDashboard();
    deleted.themes = deleted.themes.filter((theme) => theme.id !== "midnight-ink");
    const api = makeApi({
      getDashboardState: vi.fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValue(deleted),
    });
    const user = userEvent.setup();
    render(<App api={api} />);

    const theme = await screen.findByTestId("theme-midnight-ink");
    await user.click(within(theme).getByRole("button", { name: "删除主题" }));

    let dialog = screen.getByRole("dialog", { name: "删除“午夜墨水”？" });
    expect(dialog).toHaveTextContent("主题包、编译副本及该主题的本地设置和覆盖记录");
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(api.deleteLocalTheme).not.toHaveBeenCalled();
    expect(screen.getByTestId("theme-midnight-ink")).toBeInTheDocument();

    await user.click(within(screen.getByTestId("theme-midnight-ink")).getByRole("button", { name: "删除主题" }));
    dialog = screen.getByRole("dialog", { name: "删除“午夜墨水”？" });
    await user.click(within(dialog).getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(api.deleteLocalTheme).toHaveBeenCalledWith("midnight-ink"));
    await waitFor(() => expect(screen.queryByTestId("theme-midnight-ink")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "删除“午夜墨水”？" })).not.toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("cc-theme.last-client-themes") ?? "{}")).toEqual({
      "mac-codex": "paper-moon",
      "mac-workbuddy": "paper-moon",
    }));
  });

  it("选择主题后可在客户端卡片直接注入主题并启动", async () => {
    const api = makeApi();
    const user = userEvent.setup();
    render(<App api={api} />);

    const workbuddy = await screen.findByTestId("client-mac-workbuddy");
    const injectAndLaunch = within(workbuddy).getByRole("button", { name: "注入主题并启动 WorkBuddy" });
    expect(injectAndLaunch).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /纸月 Paper Moon/ }));
    expect(injectAndLaunch).toBeEnabled();
    await user.click(injectAndLaunch);

    await waitFor(() => expect(api.applyTheme).toHaveBeenCalledWith("mac-workbuddy", "paper-moon", true));
    expect(api.applyTheme).toHaveBeenCalledTimes(1);
    expect(workbuddy).toHaveTextContent("纸月 Paper Moon");
    expect(screen.queryByText(/所选目标/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /作为应用目标/ })).not.toBeInTheDocument();
  });

  it("注入启动期间在对应客户端卡片立即显示反馈并锁定启动按钮，完成后自动收敛", async () => {
    const operation = deferred<Awaited<ReturnType<DesktopApi["applyTheme"]>>>();
    const api = makeApi({ applyTheme: vi.fn(() => operation.promise) });
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: /纸月 Paper Moon/ }));
    const workbuddy = screen.getByTestId("client-mac-workbuddy");
    await user.click(within(workbuddy).getByRole("button", { name: "注入主题并启动 WorkBuddy" }));

    expect(workbuddy).toHaveAttribute("aria-busy", "true");
    const feedback = within(workbuddy).getByRole("status");
    expect(feedback).toHaveTextContent("正在注入主题并启动 WorkBuddy…");
    expect(within(feedback).getByTestId("client-operation-spinner")).toBeInTheDocument();
    expect(within(workbuddy).getByRole("button", { name: "正常启动 WorkBuddy" })).toBeDisabled();
    expect(within(workbuddy).getByRole("button", { name: "注入主题并启动 WorkBuddy" })).toBeDisabled();
    expect(screen.getByTestId("client-mac-codex")).not.toHaveAttribute("aria-busy");
    expect(within(screen.getByTestId("client-mac-codex")).queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "活动" })).not.toBeInTheDocument();

    await act(async () => operation.resolve({ status: "success", code: "ok", message: "主题已应用，客户端已启动" }));

    await waitFor(() => expect(within(workbuddy).queryByRole("status")).not.toBeInTheDocument());
    expect(workbuddy).not.toHaveAttribute("aria-busy");
    expect(workbuddy).toHaveTextContent("运行中");
  });

  it("按客户端保存最后成功使用的主题，并在 Manager 重启后分别恢复", async () => {
    const initial = cloneDemoDashboard();
    initial.clients.forEach((client) => {
      client.runState = "stopped";
      client.currentThemeId = null;
      client.currentThemeName = "原生外观";
    });
    const firstApi = makeApi({ getDashboardState: vi.fn(() => Promise.resolve(initial)) });
    const user = userEvent.setup();
    const firstRender = render(<App api={firstApi} />);

    const codex = await screen.findByTestId("client-mac-codex");
    await user.click(screen.getByRole("button", { name: "午夜墨水" }));
    await user.click(within(codex).getByRole("button", { name: "注入主题并启动 Codex" }));
    await waitFor(() => expect(firstApi.applyTheme).toHaveBeenCalledWith("mac-codex", "midnight-ink", true));

    const workbuddy = screen.getByTestId("client-mac-workbuddy");
    await user.click(screen.getByRole("button", { name: /纸月 Paper Moon/ }));
    await user.click(within(workbuddy).getByRole("button", { name: "注入主题并启动 WorkBuddy" }));
    await waitFor(() => expect(firstApi.applyTheme).toHaveBeenCalledWith("mac-workbuddy", "paper-moon", true));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("cc-theme.last-client-themes") ?? "{}")).toEqual({
      "mac-codex": "midnight-ink",
      "mac-workbuddy": "paper-moon",
    }));

    firstRender.unmount();
    const restarted = cloneDemoDashboard();
    restarted.clients.forEach((client) => {
      client.runState = "stopped";
      client.currentThemeId = null;
      client.currentThemeName = "原生外观";
    });
    const restartedApi = makeApi({ getDashboardState: vi.fn(() => Promise.resolve(restarted)) });
    render(<App api={restartedApi} />);

    const restartedCodex = await screen.findByTestId("client-mac-codex");
    const restartedWorkbuddy = screen.getByTestId("client-mac-workbuddy");
    expect(within(restartedCodex).getByRole("button", { name: "注入主题并启动 Codex" })).toBeEnabled();
    expect(within(restartedWorkbuddy).getByRole("button", { name: "注入主题并启动 WorkBuddy" })).toBeEnabled();

    await user.click(within(restartedCodex).getByRole("button", { name: "注入主题并启动 Codex" }));
    await user.click(within(restartedWorkbuddy).getByRole("button", { name: "注入主题并启动 WorkBuddy" }));
    await waitFor(() => expect(restartedApi.applyTheme).toHaveBeenCalledWith("mac-codex", "midnight-ink", true));
    await waitFor(() => expect(restartedApi.applyTheme).toHaveBeenCalledWith("mac-workbuddy", "paper-moon", true));
  });

  it("正常启动会先清理当前主题并恢复原生外观", async () => {
    const dashboard = cloneDemoDashboard();
    dashboard.clients.find((client) => client.id === "mac-codex")!.runState = "stopped";
    const api = makeApi({ getDashboardState: vi.fn(() => Promise.resolve(dashboard)) });
    const user = userEvent.setup();
    render(<App api={api} />);

    await screen.findByTestId("client-mac-codex");
    await user.click(screen.getByRole("button", { name: "正常启动 Codex" }));
    await waitFor(() => expect(api.restoreTheme).toHaveBeenCalledWith("mac-codex"));
    expect(api.launchClient).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("client-mac-codex")).toHaveTextContent("原生外观");
    expect(screen.getByTestId("client-mac-codex")).toHaveTextContent("运行中");
  });

  it("正常启动期间只反馈用户选择的启动动作，不暴露内部恢复阶段", async () => {
    const dashboard = cloneDemoDashboard();
    dashboard.clients.find((client) => client.id === "mac-codex")!.runState = "stopped";
    const operation = deferred<Awaited<ReturnType<DesktopApi["restoreTheme"]>>>();
    const api = makeApi({
      getDashboardState: vi.fn(() => Promise.resolve(dashboard)),
      restoreTheme: vi.fn(() => operation.promise),
    });
    const user = userEvent.setup();
    render(<App api={api} />);

    const codex = await screen.findByTestId("client-mac-codex");
    await user.click(within(codex).getByRole("button", { name: "正常启动 Codex" }));

    const feedback = within(codex).getByRole("status");
    expect(feedback).toHaveTextContent("正在正常启动 Codex…");
    expect(feedback).not.toHaveTextContent(/恢复|校验|注入器|阶段/);
    within(codex).getAllByRole("button").forEach((button) => expect(button).toBeDisabled());

    await act(async () => operation.resolve({ status: "success", code: "ok", message: "已恢复原生外观" }));

    await waitFor(() => expect(within(codex).queryByRole("status")).not.toBeInTheDocument());
    expect(codex).not.toHaveAttribute("aria-busy");
    expect(codex).toHaveTextContent("原生外观");
    expect(codex).toHaveTextContent("运行中");
  });

  it("客户端运行时同时禁用正常启动和注入启动，并在窗口重新聚焦时及时更新", async () => {
    const dashboard = cloneDemoDashboard();
    dashboard.clients.forEach((client) => { client.runState = "stopped"; });
    const runtimeStates = vi.fn().mockResolvedValue([{ id: "mac-workbuddy", runState: "running" }]);
    const api = makeApi({
      getDashboardState: vi.fn(() => Promise.resolve(dashboard)),
      getClientRuntimeStates: runtimeStates,
    });
    const user = userEvent.setup();
    render(<App api={api} />);

    const workbuddy = await screen.findByTestId("client-mac-workbuddy");
    await user.click(screen.getByRole("button", { name: /纸月 Paper Moon/ }));
    expect(within(workbuddy).getByRole("button", { name: "正常启动 WorkBuddy" })).toBeEnabled();
    expect(within(workbuddy).getByRole("button", { name: "注入主题并启动 WorkBuddy" })).toBeEnabled();

    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(runtimeStates).toHaveBeenCalledTimes(1));
    expect(workbuddy).toHaveTextContent("运行中");
    const runningButtons = within(workbuddy).getAllByRole("button", { name: "WorkBuddy 正在运行" });
    expect(runningButtons).toHaveLength(2);
    runningButtons.forEach((button) => expect(button).toBeDisabled());
    expect(within(workbuddy).getAllByText("正在运行")).toHaveLength(2);
  });

  it("过期的后台检测结果不会覆盖刚完成操作的运行状态", async () => {
    const dashboard = cloneDemoDashboard();
    const workbuddyState = dashboard.clients.find((client) => client.id === "mac-workbuddy")!;
    workbuddyState.runState = "stopped";
    let resolveRuntime!: (states: Array<{ id: string; runState: "stopped" }>) => void;
    const staleRuntime = new Promise<Array<{ id: string; runState: "stopped" }>>((resolve) => { resolveRuntime = resolve; });
    const api = makeApi({
      getDashboardState: vi.fn(() => Promise.resolve(dashboard)),
      getClientRuntimeStates: vi.fn(() => staleRuntime),
    });
    const user = userEvent.setup();
    render(<App api={api} />);

    const workbuddy = await screen.findByTestId("client-mac-workbuddy");
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(api.getClientRuntimeStates).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: /纸月 Paper Moon/ }));
    await user.click(within(workbuddy).getByRole("button", { name: "注入主题并启动 WorkBuddy" }));
    await waitFor(() => expect(api.applyTheme).toHaveBeenCalledTimes(1));
    expect(workbuddy).toHaveTextContent("运行中");

    await act(async () => {
      resolveRuntime([{ id: "mac-workbuddy", runState: "stopped" }]);
      await staleRuntime;
    });

    expect(workbuddy).toHaveTextContent("运行中");
    within(workbuddy).getAllByRole("button", { name: "WorkBuddy 正在运行" }).forEach((button) => expect(button).toBeDisabled());
  });

  it("运行状态未知时保持启动操作关闭", async () => {
    const dashboard = cloneDemoDashboard();
    const workbuddyState = dashboard.clients.find((client) => client.id === "mac-workbuddy")!;
    workbuddyState.runState = "unknown";
    const api = makeApi({ getDashboardState: vi.fn(() => Promise.resolve(dashboard)) });
    const user = userEvent.setup();
    render(<App api={api} />);

    const workbuddy = await screen.findByTestId("client-mac-workbuddy");
    await user.click(screen.getByRole("button", { name: /纸月 Paper Moon/ }));
    expect(workbuddy).toHaveTextContent("状态未知");
    expect(within(workbuddy).getByRole("button", { name: "正常启动 WorkBuddy" })).toBeDisabled();
    expect(within(workbuddy).getByRole("button", { name: "注入主题并启动 WorkBuddy" })).toBeDisabled();
  });

  it("关闭窗口时可选择保留在菜单栏或完全退出，且不会恢复已注入主题", async () => {
    const desktop = makeApi();
    const window = makeWindowApi();
    const user = userEvent.setup();
    render(<App api={desktop} windowApi={window.api} />);

    await screen.findByRole("heading", { name: "主题与应用" });
    await waitFor(() => expect(window.api.onCloseRequested).toHaveBeenCalledTimes(1));

    act(() => window.requestClose());
    let dialog = screen.getByRole("dialog", { name: "关闭 CC Theme" });
    expect(dialog).toHaveTextContent("已经注入的主题会继续生效");
    expect(within(dialog).getByRole("button", { name: "最小化到菜单栏" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => window.requestClose());
    dialog = screen.getByRole("dialog", { name: "关闭 CC Theme" });
    await user.click(within(dialog).getByRole("button", { name: "最小化到菜单栏" }));
    await waitFor(() => expect(window.api.minimizeToMenuBar).toHaveBeenCalledTimes(1));
    expect(desktop.restoreTheme).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => window.requestClose());
    dialog = screen.getByRole("dialog", { name: "关闭 CC Theme" });
    await user.click(within(dialog).getByRole("button", { name: "退出应用" }));
    await waitFor(() => expect(window.api.quitManager).toHaveBeenCalledTimes(1));
    expect(desktop.restoreTheme).not.toHaveBeenCalled();
  });

  it("操作失败时展示可读错误，同时不显示诊断侧栏", async () => {
    const failing = vi.fn(() => Promise.resolve({ status: "failed" as const, code: "transport-unavailable", message: "无法连接本地注入端口" }));
    const api = makeApi({ launchClient: failing });
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: "正常启动 WorkBuddy" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("WorkBuddy：无法连接本地注入端口");
    expect(screen.queryByRole("button", { name: "运行全部诊断" })).not.toBeInTheDocument();
  });

  it("英文界面的启动反馈在失败后消失并恢复可操作状态", async () => {
    window.localStorage.setItem("cc-theme.locale", "en-US");
    const operation = deferred<Awaited<ReturnType<DesktopApi["launchClient"]>>>();
    const api = makeApi({ launchClient: vi.fn(() => operation.promise) });
    const user = userEvent.setup();
    render(<App api={api} />);

    const workbuddy = await screen.findByTestId("client-mac-workbuddy");
    const launch = within(workbuddy).getByRole("button", { name: "Launch WorkBuddy normally" });
    await user.click(launch);

    expect(within(workbuddy).getByRole("status")).toHaveTextContent("Launching WorkBuddy normally…");
    expect(launch).toBeDisabled();

    await act(async () => operation.resolve({ status: "failed", code: "transport-unavailable", message: "无法连接本地注入端口" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("WorkBuddy: Could not connect to the local theme service");
    await waitFor(() => expect(within(workbuddy).queryByRole("status")).not.toBeInTheDocument());
    expect(workbuddy).not.toHaveAttribute("aria-busy");
    expect(launch).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "Activity" })).not.toBeInTheDocument();
  });

  it("Adapter 编译上下文不兼容时显示净化后的说明和稳定诊断码", async () => {
    const dashboard = cloneDemoDashboard();
    dashboard.clients.find((client) => client.id === "mac-workbuddy")!.runState = "stopped";
    const api = makeApi({
      getDashboardState: vi.fn(() => Promise.resolve(dashboard)),
      applyTheme: vi.fn(() => Promise.resolve({
        status: "failed" as const,
        code: "adapter-compile-context-incompatible",
        message: "Adapter 编译上下文不兼容，请更新对应解释器后重试",
        details: {
          stage: "adapter-projector",
          adapterId: "mac-workbuddy",
          unsupportedFields: ["detectedClientBuild"],
        },
      })),
    });
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: /纸月 Paper Moon/ }));
    await user.click(within(screen.getByTestId("client-mac-workbuddy")).getByRole("button", { name: "注入主题并启动 WorkBuddy" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Adapter 编译上下文不兼容，请更新对应解释器后重试");
    expect(alert).toHaveTextContent("adapter-compile-context-incompatible");
    expect(alert).not.toHaveTextContent("detectedClientBuild");
  });

  it("Adapter 场景映射不完整时显示可行动的说明和稳定诊断码", async () => {
    const dashboard = cloneDemoDashboard();
    dashboard.clients.find((client) => client.id === "mac-workbuddy")!.runState = "stopped";
    const api = makeApi({
      getDashboardState: vi.fn(() => Promise.resolve(dashboard)),
      applyTheme: vi.fn(() => Promise.resolve({
        status: "failed" as const,
        code: "adapter-presentation-mapping-incomplete",
        message: "Adapter 的主题映射尚不完整，请更新对应解释器后重试",
        details: {
          stage: "adapter-projector",
          adapterId: "mac-workbuddy",
          mappingScope: "presentation",
        },
      })),
    });
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: /纸月 Paper Moon/ }));
    await user.click(within(screen.getByTestId("client-mac-workbuddy")).getByRole("button", { name: "注入主题并启动 WorkBuddy" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Adapter 的主题映射尚不完整，请更新对应解释器后重试");
    expect(alert).toHaveTextContent("adapter-presentation-mapping-incomplete");
    expect(alert).not.toHaveTextContent("mappingScope");
  });

  it("动态渲染后端新增的第五个 unavailable capability，并以能力声明阻断操作", async () => {
    const dashboard = cloneDemoDashboard();
    dashboard.capabilities.push({
      adapterId: "orbit",
      displayName: "Orbit",
      availability: "available",
      runtimeApplyAvailable: true,
      runtimeLaunchAvailable: true,
      deepSettingsAvailable: false,
      capabilityVersion: "1.0.0",
      catalogVersion: "2026-07",
      reason: "可逆应用 Seam 已验证",
    }, {
      adapterId: "nebula",
      displayName: "Nebula",
      availability: "unavailable",
      runtimeApplyAvailable: false,
      runtimeLaunchAvailable: false,
      deepSettingsAvailable: false,
      capabilityVersion: "1.0.0",
      catalogVersion: "2026-07",
      reason: "尚未发布安全应用 Seam",
    });
    dashboard.clients.push({
      id: "orbit",
      name: "Orbit",
      bundleId: "dev.example.orbit",
      discovered: true,
      version: "1.0.0",
      signature: { status: "verified", teamId: "TEAMID", label: "签名已验证" },
      runState: "stopped",
      currentThemeId: null,
      currentThemeName: "原生外观",
      themePaused: false,
      adapterReady: true,
      detail: "适配器已就绪",
    }, {
      id: "nebula",
      name: "Nebula",
      bundleId: "dev.example.nebula",
      discovered: true,
      version: "2.4.0",
      signature: { status: "verified", teamId: "TEAMID", label: "签名已验证" },
      runState: "stopped",
      currentThemeId: null,
      currentThemeName: "原生外观",
      themePaused: false,
      adapterReady: true,
      detail: "适配器已就绪",
    });
    dashboard.themes[0].compatibility.orbit = { status: "ready", adapterVersion: "1.0.0", note: "完全适配" };
    dashboard.themes[0].compatibility.nebula = { status: "ready", adapterVersion: "1.0.0", note: "完全适配" };
    const api = makeApi({ getDashboardState: vi.fn(() => Promise.resolve(dashboard)) });
    const user = userEvent.setup();

    render(<App api={api} />);

    const card = await screen.findByTestId("client-nebula");
    expect(card).toHaveTextContent("Nebula");
    expect(card).toHaveTextContent("2.4.0");
    expect(card).not.toHaveTextContent("尚未发布安全应用 Seam");
    await user.click(screen.getByRole("button", { name: /纸月 Paper Moon/ }));
    expect(within(card).getByRole("button", { name: "正常启动 Nebula" })).toBeDisabled();
    const unavailable = within(card).getByRole("button", { name: "注入主题并启动 Nebula" });
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveTextContent("暂不可用");
    expect(screen.getByRole("heading", { name: "主题与应用" })).toBeInTheDocument();
    expect(screen.queryByTestId("tool-status")).not.toBeInTheDocument();
  });

  it("本地 Adapter 缺失时优先从官方签名清单一键下载，并保留本地导入入口", async () => {
    const dashboard = cloneDemoDashboard();
    const workbuddy = dashboard.clients.find((client) => client.id === "mac-workbuddy")!;
    workbuddy.adapterReady = false;
    workbuddy.adapterStatus = "missing";
    workbuddy.runState = "stopped";
    const api = makeApi({
      getDashboardState: vi.fn(() => Promise.resolve(dashboard)),
      checkAdapterUpdates: vi.fn(() => Promise.resolve({
        status: "success" as const,
        code: "adapter-catalog-ready",
        message: "已通过官方签名清单检查 Adapter",
        details: {
          sequence: 1,
          source: "network" as const,
          checkedAt: "2026-07-20T15:40:00Z",
          adapters: [{
            adapterId: "mac-workbuddy",
            status: "update-available" as const,
            latestVersion: "5.2.6",
            latestReleaseRevision: 1,
            source: "network" as const,
            message: "可从官方签名清单安全下载",
          }],
        },
      })),
    });
    const adapterPicker: AdapterPackagePicker = {
      chooseAdapterPackage: vi.fn(() => Promise.resolve("/Downloads/mac-workbuddy.ccadapter")),
    };
    const user = userEvent.setup();
    render(<App api={api} adapterPicker={adapterPicker} />);

    const card = await screen.findByTestId("client-mac-workbuddy");
    expect(within(card).queryByRole("button", { name: "注入主题并启动 WorkBuddy" })).not.toBeInTheDocument();
    const download = await within(card).findByRole("button", { name: "下载 WorkBuddy Adapter" });
    expect(download).toBeEnabled();
    await user.click(download);
    await waitFor(() => expect(api.downloadLatestAdapter).toHaveBeenCalledWith("mac-workbuddy"));

    const importLocal = within(card).getByRole("button", { name: "为 WorkBuddy 导入本地 Adapter 包" });
    await user.click(importLocal);
    await waitFor(() => expect(api.installLocalAdapter).toHaveBeenCalledWith(
      "mac-workbuddy",
      "/Downloads/mac-workbuddy.ccadapter",
    ));
    expect(within(card).getByRole("button", { name: "正常启动 WorkBuddy" })).toBeEnabled();
  });

  it("启动时自动检查签名清单并为 Doubao 展示一键更新", async () => {
    const dashboard = cloneDemoDashboard();
    const doubao = dashboard.clients.find((client) => client.id === "mac-doubao")!;
    doubao.adapterVersion = "2.19.8";
    doubao.adapterReleaseRevision = 1;
    doubao.adapterReady = true;
    doubao.adapterStatus = "compatibility-candidate";
    const checkAdapterUpdates = vi.fn(() => Promise.resolve({
      status: "success" as const,
      code: "adapter-catalog-ready",
      message: "已通过官方签名清单检查 Adapter",
      details: {
        sequence: 2,
        source: "network" as const,
        checkedAt: "2026-07-21T10:00:00Z",
        adapters: [{
          adapterId: "mac-doubao",
          status: "update-available" as const,
          latestVersion: "2.19.9",
          latestReleaseRevision: 1,
          source: "network" as const,
          message: "可从官方签名清单安全下载",
        }],
      },
    }));
    const api = makeApi({
      getDashboardState: vi.fn(() => Promise.resolve(dashboard)),
      checkAdapterUpdates,
    });

    render(<App api={api} />);

    const card = await screen.findByTestId("client-mac-doubao");
    await waitFor(() => expect(checkAdapterUpdates).toHaveBeenCalledWith(false));
    expect(await within(card).findByRole("button", { name: "下载 Doubao Adapter 更新" })).toBeEnabled();
  });

  it("允许用户主动绕过缓存检查 Adapter 更新，并在发现新版后显示下载入口", async () => {
    const dashboard = cloneDemoDashboard();
    const checkAdapterUpdates = vi.fn()
      .mockResolvedValueOnce({
        status: "success" as const,
        code: "adapter-catalog-ready",
        message: "已从缓存读取 Adapter 清单",
        details: {
          sequence: 2,
          source: "cache" as const,
          checkedAt: "2026-07-21T10:00:00Z",
          adapters: [{
            adapterId: "mac-codex",
            status: "current" as const,
            latestVersion: "26.715.61943",
            latestReleaseRevision: 1,
            source: "cache" as const,
            message: "缓存清单中已是最新版",
          }],
        },
      })
      .mockResolvedValueOnce({
        status: "success" as const,
        code: "adapter-catalog-ready",
        message: "已刷新官方签名清单",
        details: {
          sequence: 3,
          source: "network" as const,
          checkedAt: "2026-07-22T06:00:00Z",
          adapters: [{
            adapterId: "mac-codex",
            status: "update-available" as const,
            latestVersion: "26.715.71837",
            latestReleaseRevision: 1,
            source: "network" as const,
            message: "发现官方 Adapter 更新",
          }],
        },
      });
    const api = makeApi({
      getDashboardState: vi.fn(() => Promise.resolve(dashboard)),
      checkAdapterUpdates,
    });
    const user = userEvent.setup();

    render(<App api={api} />);

    const card = await screen.findByTestId("client-mac-codex");
    await waitFor(() => expect(checkAdapterUpdates).toHaveBeenCalledWith(false));
    expect(within(card).getByText("已是最新版")).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "检查 Codex Adapter 更新" }));

    await waitFor(() => expect(checkAdapterUpdates).toHaveBeenLastCalledWith(true));
    expect(await within(card).findByRole("button", { name: "下载 Codex Adapter 更新" })).toBeEnabled();
  });

  it("主动检查时只在所选客户端显示进度，并保持现有状态和操作布局", async () => {
    const check = deferred<Awaited<ReturnType<DesktopApi["checkAdapterUpdates"]>>>();
    const initial = makeApi().checkAdapterUpdates();
    const checkAdapterUpdates = vi.fn()
      .mockImplementationOnce(() => initial)
      .mockImplementationOnce(() => check.promise);
    const api = makeApi({ checkAdapterUpdates });
    const user = userEvent.setup();

    render(<App api={api} />);

    const codex = await screen.findByTestId("client-mac-codex");
    const doubao = screen.getByTestId("client-mac-doubao");
    const workbuddy = screen.getByTestId("client-mac-workbuddy");
    await waitFor(() => expect(checkAdapterUpdates).toHaveBeenCalledWith(false));
    await within(codex).findByText("已是最新版");

    const checkButton = within(codex).getByRole("button", { name: "检查 Codex Adapter 更新" });
    await user.click(checkButton);

    await waitFor(() => expect(checkAdapterUpdates).toHaveBeenLastCalledWith(true));
    expect(within(codex).getByText("已是最新版")).toBeInTheDocument();
    expect(checkButton).toHaveTextContent("检查更新");
    expect(checkButton).toHaveAttribute("aria-busy", "true");
    expect(checkButton.querySelector(".spinner")).toBeInTheDocument();
    expect(doubao.querySelector(".spinner")).not.toBeInTheDocument();
    expect(workbuddy.querySelector(".spinner")).not.toBeInTheDocument();

    check.resolve(await makeApi().checkAdapterUpdates());
    await waitFor(() => expect(checkButton).not.toHaveAttribute("aria-busy"));
  });

  it("已就绪的 Adapter 展示版本与来源，并允许导入本地更新", async () => {
    const dashboard = cloneDemoDashboard();
    const api = makeApi({ getDashboardState: vi.fn(() => Promise.resolve(dashboard)) });
    const adapterPicker: AdapterPackagePicker = {
      chooseAdapterPackage: vi.fn(() => Promise.resolve("/Downloads/mac-workbuddy-5.2.6-r1.ccadapter")),
    };
    const user = userEvent.setup();
    render(<App api={api} adapterPicker={adapterPicker} />);

    const card = await screen.findByTestId("client-mac-workbuddy");
    expect(card).toHaveTextContent("5.2.6 · r1");
    expect(card).toHaveTextContent("应用内置");
    expect(within(card).getByText("已是最新版")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "检查 WorkBuddy Adapter 更新" })).toBeEnabled();
    await user.click(within(card).getByRole("button", { name: "为 WorkBuddy 导入本地 Adapter 包" }));
    await waitFor(() => expect(api.installLocalAdapter).toHaveBeenCalledWith(
      "mac-workbuddy",
      "/Downloads/mac-workbuddy-5.2.6-r1.ccadapter",
    ));
  });

  it("Adapter 已是 Catalog 最新但宿主版本更新后明确阻断应用", async () => {
    const dashboard = cloneDemoDashboard();
    const codex = dashboard.clients.find((client) => client.id === "mac-codex")!;
    codex.version = "26.715.52143";
    codex.runState = "stopped";
    codex.adapterReady = true;
    codex.adapterVersion = "26.715.31925";
    codex.adapterStatus = "compatibility-candidate";
    const api = makeApi({ getDashboardState: vi.fn(() => Promise.resolve(dashboard)) });
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(await screen.findByRole("button", { name: /纸月 Paper Moon/ }));
    const card = screen.getByTestId("client-mac-codex");
    expect(card).toHaveTextContent("Adapter 已是清单最新版，但当前客户端版本尚无精确界面证据");
    const apply = within(card).getByRole("button", { name: "Codex 当前版本尚未验证主题应用" });
    expect(apply).toBeDisabled();
    expect(apply).toHaveTextContent("当前版本尚未验证");
    expect(api.applyTheme).not.toHaveBeenCalled();
  });

  it("主题卡片的眼睛入口直接打开工作台，不改变当前选择或运行时主题", async () => {
    const dashboard = cloneDemoDashboard();
    const api = makeApi({ getDashboardState: vi.fn(() => Promise.resolve(dashboard)) });
    const user = userEvent.setup();
    render(<App api={api} />);

    const card = await screen.findByTestId("theme-paper-moon");
    const selection = card.querySelector<HTMLButtonElement>(".theme-card__select");
    expect(selection).toHaveAttribute("aria-pressed", "false");
    const preview = within(card).getByRole("button", { name: "预览和编辑主题" });
    expect(preview).toHaveAttribute("title", "预览和编辑主题");

    await user.click(preview);

    expect(await screen.findByRole("region", { name: "主题工作台" })).toHaveTextContent("纸月 Paper Moon");
    expect(selection).toHaveAttribute("aria-pressed", "false");
    expect(api.applyTheme).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.queryByRole("region", { name: "主题工作台" })).not.toBeInTheDocument();
  });
});
