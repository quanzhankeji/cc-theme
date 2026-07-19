# WorkBuddy CC Theme Settings 控件消费审计（2026-07-19）

适用宿主：WorkBuddy macOS 5.2.6；UI Surface Catalog v2；Theme Style Catalog v2。

## 判定规则

设置页只公开同时具备以下链路的字段：版本化控件 ID、白名单 Local Runtime Override、Normalizer、
固定 Style binding/运行时状态机、可信 UI Surface。主题包仍不得携带 selector、CSS、JavaScript 或 DOM 写入。

## 保留的有效字段

| UI 字段 | Override target | Normalizer / Interpreter consumer | 真实 Surface |
| --- | --- | --- | --- |
| 配色策略 | `palette.strategy` | palette strategy 状态机 | 全局 system/adaptive/custom paint gate |
| 背景展示 | `background.presentation` | background lifecycle 状态机 | 背景 image/video/canvas |
| 基础/抬升/浮层背景色 | `foundation.surfaceBase/Raised/Elevated` | `--wbs-surface-*` | main、card、popover/settings modal |
| 主要/次要文字颜色 | `text.primary/secondary` | `--wbs-text` / `--wbs-text-secondary` | main/sidebar/settings；颜色选择器与文本输入成对同步 |
| 强调色 | `interaction.accent` | `--wbs-accent` | main action Surface |
| 默认边框色 | `border.default` | `--wbs-border` | main/settings |
| UI/标题/代码字体 | `typography.ui/display/code` | `--wbs-font-*` | shell/home heading/main code |
| 互动/媒体遮罩 | `media.interactiveScrim/backgroundScrimOpacity` | `--wbs-*-scrim-opacity` | shell background layers |
| 背景位置 | `media.backgroundPosition` | 同一设置项内 X/Y 原生 range 滑杆；`--wbs-background-x/y` + interactive `setPosition()` | image、video、poster、Reduced Motion static、interactive canvas |
| 背景模糊/饱和度 | `media.blur/saturation` | `--wbs-blur/saturation` | shell background layers |

## 移除的无效或重复字段

- `media.radiusScale`（“圆角比例 / Corner radius scale”）：不再作为 Settings Local Runtime Override
  或自动保存字段；主题级 `tokens.appearance.radiusScale` 的既有语义不在本次 Shared Core 清理范围内。
- `media.artX`、`media.artY`、`media.videoX`、`media.videoY`：停止新写入并合并为
  `media.backgroundPosition={xPercent,yPercent}`。旧值相同则一次迁移；冲突则隔离并显示诊断，不能覆盖 last-known-good。
- Target Profile `backgroundVideoPosition`：移除第二写入口。旧的新编译输入 fail closed；新目标主题只写
  `appearance.backgroundPosition`。

自动合同 `tests/settings-control-consumer-contract.test.mjs` 会反向检查每个公开控件的 binding、CSS
consumer 和 Surface role，并禁止上述旧控件、旧翻译 key 与第二位置入口重新出现。
