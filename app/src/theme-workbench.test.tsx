import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneDemoDashboard } from "./demo-data";
import { ThemeWorkbench, type ThemeWorkbenchDraft } from "./theme-workbench";

const theme = cloneDemoDashboard().themes[0];

describe("ThemeWorkbench", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:theme-workbench-test");
    URL.revokeObjectURL = vi.fn();
  });

  it("tracks the complete draft, persists it only after a change, and confirms the saved state", async () => {
    const user = userEvent.setup();
    const onSaveDraft = vi.fn();
    render(<ThemeWorkbench theme={theme} locale="zh-CN" onClose={vi.fn()} onSaveDraft={onSaveDraft} />);

    expect(screen.getByRole("region", { name: "主题工作台" })).toBeInTheDocument();
    const preview = screen.getByTestId("static-client-preview");
    expect(preview).toHaveStyle({ "--workbench-text": "#E9EEF7" });
    expect(screen.getByRole("button", { name: "保存更改" })).toBeDisabled();

    const colour = screen.getByRole("button", { name: "主要文字颜色" });
    await user.clear(screen.getByLabelText("主要文字颜色 hex"));
    await user.type(screen.getByLabelText("主要文字颜色 hex"), "#FF00AA");
    expect(colour).toHaveAttribute("aria-expanded", "false");
    expect(preview).toHaveStyle({ "--workbench-text": "#FF00AA" });
    expect(screen.getByRole("button", { name: "保存更改" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "保存更改" }));
    expect(onSaveDraft).toHaveBeenCalledWith(expect.objectContaining({
      kind: "cc-theme.theme-workbench-draft",
      base: { themeId: theme.id },
      patch: expect.objectContaining({ textColors: { lightText: "#203041", darkText: "#FF00AA" }, surfaceOpacity: 0.72 }),
    } satisfies Partial<ThemeWorkbenchDraft>), null);
    await screen.findByText("已保存到本地；下次应用主题时会使用这些设置。");
    expect(screen.getByRole("button", { name: "保存更改" })).toBeDisabled();
  });

  it("keeps one shared text token for a Theme Family without Light/Dark variants", async () => {
    const user = userEvent.setup();
    const onSaveDraft = vi.fn(() => Promise.resolve());
    const singlePaletteTheme = { ...theme, appearanceVariants: undefined, colors: ["#10151F", "#7B63ED", "#E9EEF7"] as [string, string, string] };
    render(<ThemeWorkbench theme={singlePaletteTheme} locale="en-US" onClose={vi.fn()} onSaveDraft={onSaveDraft} />);

    fireEvent.change(screen.getByLabelText("Main content surface opacity"), { target: { value: "0" } });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSaveDraft).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({
        textColors: { lightText: "#E9EEF7", darkText: "#E9EEF7" },
        surfaceOpacity: 0,
      }),
    }), null);
    expect(await screen.findByText("Saved locally. These settings will be used the next time the theme is applied.")).toBeInTheDocument();
  });

  it("lets the editor drawer collapse and close without changing the theme", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ThemeWorkbench theme={theme} locale="en-US" onClose={onClose} />);

    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Close edit drawer" }));
    expect(screen.getByTestId("theme-workbench")).toHaveClass("theme-workbench--drawer-closed");
    await user.click(screen.getByRole("button", { name: "Open edit drawer" }));
    expect(screen.getByTestId("theme-workbench")).not.toHaveClass("theme-workbench--drawer-closed");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("switches preview targets while retaining the same current draft", async () => {
    const user = userEvent.setup();
    render(<ThemeWorkbench theme={theme} locale="en-US" onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText("Primary text colour hex"));
    await user.type(screen.getByLabelText("Primary text colour hex"), "#35C7A5");
    await user.click(screen.getByRole("button", { name: "WorkBuddy" }));

    const preview = screen.getByTestId("static-client-preview");
    expect(preview).toHaveAttribute("data-preview-target", "mac-workbuddy");
    expect(preview).toHaveStyle({ "--workbench-text": "#35C7A5" });
    expect(screen.getByRole("button", { name: "WorkBuddy" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches the preview between the Theme Family's complete light and dark palette summaries", async () => {
    const user = userEvent.setup();
    render(<ThemeWorkbench theme={theme} locale="en-US" onClose={vi.fn()} />);

    const preview = screen.getByTestId("static-client-preview");
    expect(preview).toHaveAttribute("data-preview-appearance", "dark");
    expect(preview).toHaveStyle({ "--workbench-theme-base": "#10151F", "--workbench-text": "#E9EEF7" });

    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(preview).toHaveAttribute("data-preview-appearance", "light");
    expect(preview).toHaveStyle({ "--workbench-theme-base": "#F4F7FA", "--workbench-text": "#203041" });
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  });

  it("links main content surface opacity to the preview and persists it with the complete draft", async () => {
    const user = userEvent.setup();
    const onSaveDraft = vi.fn(() => Promise.resolve());
    render(<ThemeWorkbench theme={theme} locale="en-US" onClose={vi.fn()} onSaveDraft={onSaveDraft} />);

    const control = screen.getByLabelText("Main content surface opacity");
    expect(control).toHaveAttribute("min", "0");
    expect(control).toHaveAttribute("max", "100");
    fireEvent.change(control, { target: { value: "84" } });
    expect(screen.getByTestId("static-client-preview")).toHaveStyle({ "--workbench-surface-opacity": "0.84" });

    fireEvent.change(control, { target: { value: "0" } });
    expect(screen.getByTestId("static-client-preview")).toHaveStyle({
      "--workbench-surface-opacity": "0",
      "--workbench-surface-opacity-percent": "0%",
      "--workbench-surface-blur": "0px",
    });

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSaveDraft).toHaveBeenCalledWith(expect.objectContaining({
      base: { themeId: theme.id },
      patch: expect.objectContaining({ surfaceOpacity: 0 }),
    }), null);
  });

  it("keeps the save action enabled after a failure and explains that no existing draft was changed", async () => {
    const user = userEvent.setup();
    const onSaveDraft = vi.fn(() => Promise.reject(new Error("storage unavailable")));
    render(<ThemeWorkbench theme={theme} locale="en-US" onClose={vi.fn()} onSaveDraft={onSaveDraft} />);

    await user.clear(screen.getByLabelText("Primary text colour hex"));
    await user.type(screen.getByLabelText("Primary text colour hex"), "#00AAFF");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("The local editable copy could not be written. The original theme and existing local version were not changed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("can remove a saved local editable copy without deleting the imported theme", async () => {
    const user = userEvent.setup();
    const onRestoreOriginal = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    render(<ThemeWorkbench theme={{ ...theme, hasLocalDraft: true }} locale="en-US" onClose={onClose} onRestoreOriginal={onRestoreOriginal} />);

    await user.click(screen.getByRole("button", { name: "Restore original theme" }));
    expect(onRestoreOriginal).toHaveBeenCalledWith(theme.id);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens a browser-style colour card and keeps the board, hue, RGB, and hex values in sync", async () => {
    const user = userEvent.setup();
    render(<ThemeWorkbench theme={theme} locale="en-US" onClose={vi.fn()} />);

    await user.clear(screen.getByLabelText("Primary text colour hex"));
    await user.type(screen.getByLabelText("Primary text colour hex"), "#FF0000");
    await user.click(screen.getByRole("button", { name: "Primary text colour" }));
    expect(screen.getByRole("dialog", { name: "Text colour picker" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Hue"), { target: { value: "120" } });
    expect(screen.getByLabelText("Primary text colour hex")).toHaveValue("#00FF00");
    expect(screen.getByRole("button", { name: "Colour palette" })).toBeInTheDocument();
    expect(screen.getByLabelText("Primary text colour R")).toHaveValue(0);
    expect(screen.getByLabelText("Primary text colour G")).toHaveValue(255);
    expect(screen.getByLabelText("Primary text colour B")).toHaveValue(0);
  });

  it("keeps the preview canvas focused on target tags instead of a static-preview heading", () => {
    render(<ThemeWorkbench theme={theme} locale="en-US" onClose={vi.fn()} />);

    expect(screen.queryByText("Static preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Preview never launches, injects, or changes a real client. It does not claim runtime fidelity.")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Preview target" })).toHaveTextContent("Codex");
    expect(screen.getByRole("group", { name: "Preview target" })).toHaveTextContent("WorkBuddy");
  });
});
