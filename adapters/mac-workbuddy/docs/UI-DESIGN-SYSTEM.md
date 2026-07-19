# WorkBuddy UI 语义样式规划规范

本文定义外部主题语义如何通过 `mac-workbuddy` 的固定解释器连接到 WorkBuddy UI。生产主题及媒体属于独立 CC Theme 资源层，本仓库不保存或发布主题。

权威来源按职责分开：

- `compatibility/workbuddy-macos/<version>/ui-surface-catalog.json`：UI Surface Catalog，保存特定 WorkBuddy 版本的 DOM、原生计算样式、页面状态和匹配证据。
- `docs/UI-SURFACE-CATALOG.md`：由 Catalog 自动生成的人类可读索引。
- `assets/ui-interpreter.js`：固定 UI Interpreter Module，负责把版本配置连接到 DOM 角色、挂载点和受控样式。
- `contracts/theme-style-catalog.json`：Style Catalog，保存样式来源、CSS 属性和 Skin Surface Role 的连接。
- `contracts/theme-settings-locales.json`：Locale Catalog，只保存 CC-Theme 自有设置文案。
- `assets/renderer-inject.js`：组织外部主题背景和 Settings 深度编辑生命周期，不保存 WorkBuddy 页面选择器或翻译。
- `assets/skin.css`：仅负责角色和状态的最终视觉 Implementation。

## 统一样式链路

```text
Skin Theme token
  -> Skin Surface Role
    -> versioned DOM matcher
      -> page/state regression
```

外部主题不应直接理解某个页面的全部 DOM。版本选择器和内容匹配集中在 UI Surface Catalog 与 Adapter；主题只需要表达稳定角色、状态和视觉层级。

## 配色来源策略

| `paletteStrategy` | 默认 | 颜色来源 | 媒体处理 |
| --- | --- | --- | --- |
| `system` | 是 | WorkBuddy 当前亮色/深色原生变量 | 不读取像素，不抽首帧 |
| `adaptive` | 否 | 外部 Theme Package 投影的已验证自适应基底 | Adapter 不制作或分析主题媒体 |
| `custom` | 否 | 外部投影或本地深度设置的 allowlist token | Adapter 只验证和消费 |

系统模式不等于放弃已收集节点。Catalog 角色仍负责消除 Shell 和页面根的白/黑遮挡，并在 Navigation、Content 与 Composer 层形成必要的透明承载。Floating/Modal 只做分类，不接管原生外观。媒体负责背景，WorkBuddy 原生变量负责文字、图标、交互态和控件对比度。主题已有颜色字段保留但不参与系统模式渲染。

## Surface 分类

| 层级 | 角色范围 | 原生规律 | 外部主题语义 |
| --- | --- | --- | --- |
| Shell | 应用画布、路由容器 | `#FAFAFA`，无阴影 | 统一全局背景、字体和透明策略 |
| Navigation | 左侧栏、顶栏、分组 | `#F2F2F2`，无阴影 | 独立于内容区设置表面、边框和玻璃效果 |
| Content | 卡片、表格、表单、产物 | 白色或浅灰，默认无阴影 | 优先使用色阶与 1px 边框，不普遍抬升 |
| Composer | 首页输入框、会话输入框 | 白色、16px、极弱阴影 | 保持固定焦点层级，统一工具栏和编辑区 |
| Floating | menu、listbox、popover | 白色、10–16px、轻阴影 | 使用一套浮层色、边框和 elevation 梯度 |
| Modal | 设置、新建、详情弹窗 | 遮罩 + 白色对话框 | 遮罩、表面、阴影分别配置 |
| Detail | 右侧详情、灵感全屏详情 | 独立表面或局部遮罩 | 与主内容保持边界，不继承普通卡片阴影 |

## 背景规划

外部主题可通过 Shared Core / Target Profile 暴露以下语义 token：

| Token | 用途 | 原生参考 |
| --- | --- | --- |
| `canvas` | 主页面画布 | `#FAFAFA` |
| `navigation` | 左侧栏和导航分组 | `#F2F2F2` |
| `surface` | 卡片、输入框、弹层 | `#FFFFFF` |
| `surface-subtle` | 表头、弱分区 | `#F7F7F7` |
| `surface-muted` | 选中项、用户消息、弱卡片 | `#EBEBEB` |
| `hover` | 非选中交互态 | 5% 黑色混合 |
| `active` | 按下或选中交互态 | 8% 黑色混合 |
| `scrim-modal` | 阻塞弹窗遮罩 | 60% 黑 |
| `scrim-detail` | 局部详情遮罩 | 34% 黑 |

约束：

- Shell、Navigation、Content 必须是三个独立表面，不能用一个全局 `div` 规则覆盖。
- 普通内容卡片默认不加阴影；先使用背景色阶和边框表达层级。
- iframe/webview 只修改宿主外壳，不尝试穿透第三方文档。
- 背景图模式下，决定透明的必须是已知结构类或明确的 Skin Surface Role，不能使用全局 `div`/`span` 透明规则。

## 阴影与 elevation

原生 WorkBuddy 的阴影不是一条统一数值，而是一组按用途变化的 elevation。主题语义应抽象用途，不能逐节点复制数值。

| Elevation | 适用范围 | 原生参考 |
| --- | --- | --- |
| `flat` | 页面、表格、普通卡片 | `none` |
| `input` | 首页/会话输入框 | 2–3% 黑的双层弱阴影 |
| `popover` | 下拉框、通知、消息菜单 | 4% 黑的双层阴影 |
| `menu-strong` | 账户菜单、二维码 | 15–16% 黑 |
| `modal` | 设置、专家详情 | 10% + 5% 双层阴影 |
| `modal-strong` | 新建项目 | 20% 黑、32px 模糊 |
| `detail-strong` | 灵感详情 | 22% 黑、80px 模糊 |
| `collaboration` | 项目成员浮层 | 双层 8% 黑，并有 `blur(48px)` |

约束：

- `backdrop-filter` 不是全局效果。原生采样中只有项目成员浮层使用 `blur(48px)`。
- 输入框聚焦阴影与浮层阴影分开，避免 composer 看起来像 modal。
- 阴影颜色应由受支持的主题 token 提供，不能继续散落为 CSS 硬编码。

## 文字、图标与控件色阶

深色主题不能只修改浮层外壳。WorkBuddy 在 `light cb-light vscode-light` 状态下会给菜单标签、辅助值、分段选择器和开关轨道直接写入浅色主题颜色，因此以下 token 必须由 Adapter 映射到组件级角色：

| Token | 用途 |
| --- | --- |
| `textStrong` | 标题、账户名、强调数字 |
| `textSecondary` | 描述、菜单右侧值、小程序说明 |
| `textDisabled` | 真正不可交互的菜单项 |
| `iconPrimary` / `iconMuted` | 当前操作与普通菜单图标 |
| `divider` | 菜单和弹窗内部的分隔线 |
| `controlTrack` / `controlTrackActive` | 开关与分段控件轨道 |
| `controlThumb` | 开关滑块和高对比控件前景 |

约束：

- 不通过全局 `span`、`div` 或 `body *` 覆盖文字颜色。
- 浮层外壳、文字叶子、图标、值文本、控件轨道分别匹配角色。
- 二维码画布是语义例外：即使外层是深色，画布仍保持白色，避免降低扫码识别率。
- `.user-menu-item--disabled` 可能只是禁用整行点击；包含外观选择器时仍使用正常文字色，由内部控件表达状态。
- 复合导航项必须给完整 row 着色，不能只修改较窄的 button，否则右侧 actions 会保留浅色原生背景。

## 圆角规划

统一圆角尺度：`2 / 4 / 6 / 8 / 12 / 16 / 24 / full`。

- 6–8px：按钮、输入控件、小菜单项。
- 10–12px：消息菜单、二维码容器、设置弹窗。
- 16px：输入框、普通 popover、卡片和详情表面。
- 24px：全局搜索、新建项目等主要 modal。
- `full`：头像、开关、pill、圆形操作按钮。

主题的 `radiusScale` 只缩放普通层级；modal 24px 与 `full` 是语义例外，不能机械缩放到不可识别。

## 页面家族

### Shell 与导航

- 展开状态存在 `[data-view-id="sidebar"]`，宽约 264px。
- 收起状态使用 `.teams-container.sidebar-collapsed`；侧栏节点退出布局，主内容从 `x=0` 占满窗口。
- 展开和收起必须分别回归，不能把收起理解为保留 48px 的同一侧栏表面。

### 新建任务与会话

- 首页 composer 与会话 composer 是同一语义角色的两个布局变体。
- 模型、附件、工作空间、权限、技能、连接器都是锚定 composer 的 floating surface。
- 项目会话另有表格、产物卡、用户气泡、消息操作和右侧详情面板。
- Markdown 表格不依赖页面路由或原生亮暗差异：根层使用 28% 系统表面，表头使用 52% raised surface，正文单元格透明，边框使用当前文字色的 10%，保持无阴影、无背景模糊和原生 16px 圆角。

### 项目

- 项目总览：项目卡、模板卡、搜索和卡片菜单。
- 项目会话：面包屑、协同状态、成员浮层、消息、产物和固定 composer。
- 新建项目是 60% 黑遮罩的 24px modal；不要复用普通 popover 样式。

### 专家、技能与连接器

- 专家中心使用大图场景卡和 16px 专家卡；专家详情是 modal。
- 技能详情是路由页面，不是 modal；安装按钮为 full pill。
- 连接器列表和授权页属于资源家族，第三方授权内容保持独立。

### 自动化

- 自动化首页包含 tab、空状态、模板卡。
- 新建自动化是全页表单路由，包含 composer 变体、连接器、周期选择和日期控件。
- 表单控件以 6–8px 圆角、1px 边框为主，不应套用内容卡片的 16px 圆角。

### 资源与灵感

- 我的文件包含 tab、筛选、搜索、复选框和空状态。
- 腾讯文档与 ima 知识库是授权页面，主操作按钮使用高对比实色。
- 灵感首页是 masonry 卡片网格，卡片使用 1px 边框、8px 圆角、无阴影。
- 灵感详情是局部全屏 detail overlay，使用 34% 遮罩和最强 elevation。

### 设置

- 设置是全局 modal，左侧二级导航 + 右侧滚动表单。
- 已采集分区：账户、系统、智能体、快捷键、记忆、模型、助理、个性化、数据、安全、帮助与反馈。
- 开关、滑杆、分组卡和输入框应使用 controls token，不继承 modal 容器样式。

## 浮层统一规则

所有浮层必须被归入以下一种：

1. `listbox`：模型、附件、工作空间、权限等选择器。
2. `menu`：更多、筛选、项目卡、消息操作。
3. `popover`：账户、通知、二维码、协作成员。
4. `modal`：搜索、设置、新建项目、专家详情。
5. `detail-overlay`：灵感详情。

每种浮层分别配置：surface、border、radius、shadow、scrim、blur、z-index。禁止只写一个宽泛的 `[role="menu"], [role="dialog"]` 规则，因为相同 ARIA role 在不同页面有不同层级。

`system` 配色策略只分类浮层节点，不接管浮层外观：账户活动卡、按钮、菜单文字与图标、外观选择器、二维码、任务流转、列表框和各种 modal 必须继续使用 WorkBuddy 原生亮/暗样式。上述浮层 token 仅供媒体启用时的 `adaptive` 与 `custom` 使用；媒体禁用后，页面级宿主变量桥接与所有自定义浮层外观同时停用。Portal 宿主（例如 `.workbuddy-collab--portal`）不得匹配页面根角色，否则会把半透明页面变量泄漏给弹窗。

## DOM 匹配策略

优先级从高到低：

1. `data-view-id` 和 WorkBuddy body dataset。
2. 可读的 BEM/语义类名，例如 `.settings-modal`、`.task-collab-popover`。
3. 页面稳定根 + ARIA role/label 的组合。
4. 内容/结构匹配后写入 Skin Surface Role。

禁止：

- Vite/CSS-module 生成类名。
- 仅凭中文文本匹配页面表面。
- 未限定页面根的 `[role="menu"]` 或 `[role="dialog"]`。
- 全局覆盖 `div`、`span` 或所有透明背景。

## 外部主题一致性检查矩阵

每个外部主题至少验证：

- 导航：展开、收起、选中、hover。
- 首页：场景 tab、快捷入口、composer 默认/聚焦。
- 会话：助手消息、用户消息、表格、产物、固定 composer、详情栏。
- 页面：项目、专家、技能、连接器、自动化、文件、授权、灵感。
- 浮层：menu、listbox、popover、modal、detail-overlay。
- 设置：浅内容、分组卡、开关、滑杆、滚动区。
- 可访问性：焦点环、禁用态、危险态、减少动效。

当前 55 个可视状态和 65 个计算样式快照构成 WorkBuddy 5.2.6 的回归基线。新增证据覆盖完整导航行、账户菜单文字/副标题/操作/控件、小程序弹窗文字/开关，以及媒体禁用时任务流转弹窗的原生白色表面；原始截图不提交到仓库，以避免保存账户、项目内容、邀请信息和二维码，Catalog 只保存去隐私化后的结构与视觉数值。
