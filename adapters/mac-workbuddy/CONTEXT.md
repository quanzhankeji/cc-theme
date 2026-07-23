# Mac WorkBuddy CC Theme

本上下文描述 WorkBuddy 客户端主题适配器中稳定解释逻辑与版本差异数据之间的分工。

## Repository location and stable identity

本 Adapter 在 CC Theme monorepo 中只存在于 `adapters/mac-workbuddy`。公开 canonical Adapter ID 是
`mac-workbuddy`；仓库移动不改变 `targets/macos-workbuddy/theme.json` 目标路径、Release 名称或用户侧
制品结构。发布包内部的 `.mac-workbuddy` 仅是私有运行引擎目录；它不是源码目录，也不表示项目仍位于
monorepo 顶层。项目内跨 Module 引用必须从当前目录解析，不能假设旧顶层布局存在。

所有跨端输出和新持久化记录只使用 canonical ID，不接受永久 alias。预发布本机状态仅允许一次性迁入
canonical 目录；canonical 与旧目录同时存在时只信任 canonical，旧目录不会被读取或合并。Renderer 的
`workbuddy-skin-*` DOM/CSS 标记和 `skin.theme` 文档种类保持私有，不参与公开 ID 命名。

公开版本轴不使用 Adapter 自有 SemVer：`adapterVersion` 必须等于受支持 WorkBuddy 的
`CFBundleShortVersionString`，当前是 `5.2.6`。`CFBundleVersion=5.2.6` 只属于兼容证据与 Manager
compile context；同一 ShortVersion 下的修复以 `adapterReleaseRevision=1` 起始递增。当前 macOS arm64
资产身份为 `mac-workbuddy-5.2.6-r4-macos-arm64`，由根目录 `PROJECT_MANIFEST.json` 统一约束。

## Theme asset ownership

`mac-workbuddy` 只拥有 WorkBuddy **Skin Adapter** 与固定 **UI Interpreter**。生产主题身份、Theme
Package、catalog、图片、视频和 poster 属于独立 CC Theme 资源层，不进入本仓库或发布包。Adapter
保留外部主题验证/投影/原子激活、Settings 深度自定义和完整生命周期；输入缺失或失败时恢复宿主原生状态。

## Project status

截至 2026-07-19，本端版本轴与制品身份已在源码中对齐为 `5.2.6 / r2 / macOS arm64`；Capability、
UI Surface/Style/Locale Catalog、package contract 和发布清单均由合同测试交叉核验。同 revision 构建
不可覆盖，确定性溯源继续使用 ZIP/文件清单 SHA-256。此项状态为 `source-fixed / manager-sync-required`；
它不改变九键 compile context、verified-only apply gate 或既有真实客户端功能结论。

截至 2026-07-18，WorkBuddy Settings 的 MutationObserver 自激循环与持续 CPU 占用 P0 已关闭，状态为 `rebuilt-and-real-qa-passed`。CC Theme Manager 已使用当时冻结的 `mac-workbuddy` 源完成重建、重签和独立真实客户端复验；旧 Manager bundle 永久禁止使用。2026-07-19 的版本轴更新仍需 Manager 重新同步本端清单与制品哈希。

闭环证据：包内关键输入与当前源逐文件 SHA-256 全部匹配；renderer SHA-256 为 `f295c3a7e17c946ca7506e72a046d9e8b996e2ac1ae2f98af27af95f8a3018b3`；preflight 为 `payload-valid`、`settingsLocales=2`，并正确声明 `revisionScope=renderer-session-generation` 与 `releaseTraceability=file-manifest-sha256`。真实客户端中 Apply/launch、Settings 连续开闭 5 次、宿主语言多次切换、原生/CC 页面协调 10 次、pause/reapply/restore 与完整清理均通过；CC active 20 秒 renderer CPU 为 1.71% avg / 5.10% max，未出现节点增长。

本状态只关闭上述 P0，不表示正式发布完成。Manager 尚未 notarize/DMG；stable-token/base-hash production entries、override rebase/quarantine 和跨进程单一事务 Seam 仍未完成端到端验收；Claude 仍为 `runtimeApply=false`，不属于 WorkBuddy 完成范围。

### Shared Core semantic contract P0

截至 2026-07-18，本端 `actionPressed`、`shellMode`、背景位置优先级和 capability version target 四项语义合同问题已完成源码修复、全量自动化与独立真实 WorkBuddy 验收，状态为 `source-fixed / independent-qa-passed / manager-revalidation-pending`。Capability 矩阵从 55 exact / 4 approximate / 8 unsupported 收敛为 53 / 5 / 9：`actionPressed` 保持 exact 并连接可信 pressed Surface；`shellMode` 改为 `host-shell-mode-authority` unsupported；legacy background position 改为带诊断 approximate；权威位置冲突以 `conflicting-background-position` fail closed；version target 统一为 `sourceVersion`。

独立 QA 在真实客户端验证 custom/adaptive 使用 actionPressed，system/disabled 保持原生；背景位置四态、Target Profile 视频隔离、宿主 light/dark、zh-CN/en-US、失败 rollback、apply/verify/pause/reapply/restore 与 60 秒 CPU/MutationObserver 稳定性均 PASS，最终 9342、injector、owned DOM、roles、styles 与测试状态全部清理。该结论仍不能解除 Manager 制品门禁；Manager 必须同步本端文件并完成包内 SHA-256、compile/preflight 和真实客户端复验。

## Language

**UI Interpreter**:
把已验证的版本配置解释为宿主身份、DOM 角色、挂载点和受控 CSS 变量的固定运行模块。
_Avoid_: injector logic, selector helper, theme script

**Version Adapter**:
只描述某一 WorkBuddy 版本的稳定选择器、锚点、挂载关系和原生类名的配置。
_Avoid_: renderer selectors, compatibility hacks

**Style Catalog**:
把语义样式来源连接到 CSS 自定义属性和 Skin Surface Role 的只绘制配置。
_Avoid_: CSS dump, inline style map

**Locale Catalog**:
保存 CC-Theme 自有设置文案、占位符和确定性语言回退的完整翻译配置。
_Avoid_: hard-coded labels, translated selectors

**Host Locale Runtime**:
只解释 Version Adapter 声明的 WorkBuddy effective locale，并使自有设置展示整页切换。
_Avoid_: system locale, DOM text inference, independent language preference

**Skin Surface Role**:
由 **UI Interpreter** 写入宿主节点、供稳定样式规则消费的语义视觉角色。
_Avoid_: CSS class alias, page selector

**Adapter Capability**:
WorkBuddy 向统一 CC Theme 入口发布的版本化机器契约，声明字段映射、Target Profile、Catalog、
兼容性、apply 状态与事务 Seam。
_Avoid_: shared adapter implementation, handwritten target list

**Target Profile**:
仅属于 `mac-workbuddy` 命名空间、适合由统一入口编辑的窄白名单配置。
_Avoid_: arbitrary override bag, host selector

**Local Runtime Override**:
只在 WorkBuddy Settings 深度编辑、以稳定 token 保存并在 base 变化时重验的本地设置。
_Avoid_: theme package field, unversioned preference

## Relationships

- 一个 **Version Adapter** 由一个 **UI Interpreter** 解释。
- 一个 **Style Catalog** 可以把一个样式来源连接到一个或多个 **Skin Surface Role**。
- 一个 **Locale Catalog** 只控制 CC-Theme 自有界面文案，不能参与宿主 DOM 匹配。
- 一个 **Host Locale Runtime** 只读取宿主稳定 locale 状态；语言切换不重建 Runtime Settings Session。
- 一个 **Skin Surface Role** 可以随 WorkBuddy 版本匹配不同 DOM，但语义保持不变。
- **Shared Core → Target Profile → Local Runtime Override → Runtime Safety** 是唯一生效顺序。
- **Adapter Capability** 拥有映射和近似/不支持决策；统一入口不拥有 WorkBuddy DOM 或 apply 逻辑。

## Example dialogue

> **Dev:** “WorkBuddy 新版本修改了设置导航类名，需要改 **UI Interpreter** 吗？”
> **Domain expert:** “不需要。更新对应 **Version Adapter**；只有解释规则本身发生变化时才修改 **UI Interpreter**。”

## Flagged ambiguities

- “Catalog” 曾同时表示 DOM 事实和主题颜色；现明确拆分为 **Version Adapter** 与 **Style Catalog**。
- “国际化选择器”不是受支持概念；宿主定位必须结构化，**Locale Catalog** 只负责自有文案。
