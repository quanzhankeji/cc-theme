# mac-workbuddy

`mac-workbuddy` 是 WorkBuddy Desktop for macOS 的可逆主题解释器与 Skin Adapter。它通过本地 CDP
把固定 CSS/JavaScript 引擎注入 WorkBuddy 主 renderer，不修改 `WorkBuddy.app`、`app.asar` 或代码签名。

本项目在 CC Theme monorepo 中的唯一源码位置是 `adapters/mac-workbuddy`。公开 canonical Adapter ID
为 `mac-workbuddy`；目标名和 Release 名称不随仓库目录迁移而改变。客户端 ZIP 内的
`.mac-workbuddy` 是刻意保留的私有运行引擎目录，不是旧源码路径，也不能改名或当作第二份项目副本。
公开 Theme Interface、Target Profile、Capability、Catalog、操作结果和新持久化状态只接受并写入
canonical ID，不提供旧 ID alias。本机若存在预发布阶段遗留状态，首次运行时只会在 canonical 状态目录
尚不存在的前提下执行一次安全目录迁移；之后所有读写均使用 canonical 目录。

`skin.theme` 是 WorkBuddy 目标文档种类，`workbuddy-skin-*` / `data-workbuddy-skin-*` 是 renderer 内部
DOM/CSS ownership 标记；它们属于 Adapter 私有 Implementation，不是公开 Adapter ID。

当前验证基线为 WorkBuddy `5.2.6`、Electron `37.10.3`、macOS。主窗口中的第三方 `webview` 属于独立
文档域，不在本 Adapter 的样式范围内。

公开 `adapterVersion` 严格跟随宿主 `CFBundleShortVersionString`，当前为 `5.2.6`；精确
`CFBundleVersion` 只保存在兼容证据与 Manager compile context。相同宿主版本下的 Adapter 修复通过
正整数 `adapterReleaseRevision` 区分，当前为 `4`。本轮制品身份固定为
`mac-workbuddy-5.2.6-r4-macos-arm64`，单一机器源见 `PROJECT_MANIFEST.json`。

## 主题资产所有权

本仓库不保存、发现、内置、发布或管理任何生产预制主题，也不携带主题图片、视频、poster、可安装
主题包或默认 fallback 主题。生产主题资产属于独立的 CC Theme Theme Package / catalog 资源层。

Adapter 只接受外部且已经过验证的 Unified Theme / WorkBuddy `skin.theme` 输入，并保留以下能力：

- Capability、Projector、目标 Schema 与 normalizer；
- Version Adapter、UI Surface Catalog、Theme Style Catalog 和 Locale Catalog；
- WorkBuddy Settings → CC Theme 深度自定义、即时预览、短防抖原子持久化；
- 外部 `.cctheme` 的目标、完整性、路径、媒体与禁止载荷校验，以及原子 staging/activation；
- media、ripple、directional 固定背景引擎；
- apply、verify、pause、restore、rollback、cleanup 生命周期 Seam；
- Local Runtime Overrides 的稳定 token、base hash、rebase/quarantine 与按主题事务。

测试只能在 `tests/fixtures` 使用最小、合成、无品牌、不可发布的合同夹具；发布白名单不会复制测试目录。
输入缺失、无效或运行失败时，Adapter fail closed 并恢复 WorkBuddy 原生状态，不会切换到其他主题。
本次源码清理不会删除用户机器中已有的私人素材或已安装主题。

## 功能边界

- Settings 左栏的 `CC-Theme` 条目与相邻原生条目同构，支持宿主亮/暗模式、缩放、键盘焦点和
  Reduce Motion。
- 自有设置完整跟随 WorkBuddy effective locale。5.2.6 当前声明 `zh-CN` 与 `en-US`，不另设语言选择器。
- 所有受支持的颜色、字体、透明度、配色策略和背景参数均所见即所得；不提供“保存”按钮。
- 写入、验证或 renderer 应用失败时，页面、内存和磁盘共同回滚到最后有效状态。
- `system`、`adaptive`、`custom` 继续由固定 Style Catalog 和 UI Interpreter 白名单解释。
- 支持本地静音 MP4，以及与 MP4 严格互斥的 `ripple` 和 `directional` 背景。
- 顶栏媒体按钮有播放、暂停、禁用三态；禁用会移除媒体表现并恢复原生表面。
- 不实现宠物、伴生角色或独立 Hero。

## 安装与运行

安装 Adapter 不会附带或自动应用主题：

```bash
bash scripts/install-skin-macos.sh --no-start
```

应用外部 `.cctheme`：

```bash
bash scripts/apply-cc-theme-macos.sh --file /absolute/path/theme.cctheme
```

开发或诊断时也可以显式传入已经验证的主题目录：

```bash
bash scripts/start-skin-macos.sh --theme-dir /absolute/path/to/theme --restart
```

无显式路径时，`start-skin-macos.sh` 只会恢复上一次成功选择的外部主题；若不存在有效状态则停止，
不会使用仓库默认主题。

常用命令：

```bash
npm test
bash scripts/doctor-macos.sh
bash scripts/status-skin-macos.sh
bash scripts/pause-skin-macos.sh
bash scripts/restore-skin-macos.sh
```

`pause` 只移除当前 renderer 中的注入；`restore` 清理注入器状态并恢复正常方式启动 WorkBuddy。

视频冷启动只使用一个长寿命 watch injector generation：先安全停止旧 watcher，再启动持有随机回环媒体
服务的新 watcher，最后启动或接入 WorkBuddy。启动成功要求 WorkBuddy 已完成前台交接，并且可见、未开启
Reduced Motion、未由用户暂停的视频达到 `videoReady=true` 且 `playing`；后台、Reduced Motion 和用户暂停
分别返回结构化降级状态，`loading` 不会被报告为成功。Adapter 优先尝试受信 Range URL；WorkBuddy 5.2.6
若拒绝该媒体源，会在同一 generation 内使用经过大小、类型和来源校验的 Blob 回退，不再二次注入。

## 外部主题 Interface

主题目录至少包含 `theme.json` 和其 `image` 指定的本地 PNG/JPEG/WebP。三种背景模式互斥：

- `media`：可选同目录本地 MP4；静态图片同时作为 poster 与 Reduced Motion 回退。
- `ripple`：静态图片作为底图，主题只提供白名单水波参数。
- `directional`：提供静态 WebP 图集；方向数只允许 8、16 或 32，且 `columns × rows = directions`。

所有资源必须是主题目录内的普通文件。远程 URL、绝对媒体路径、路径穿越、符号链接、动画 WebP、
CSS、JavaScript、HTML、Shader 和命令都会被拒绝。方向图集上限为 32 MiB、32 MP、单边 16384px。
Reduced Motion 强制静态，运行时 override 不能重新播放；窗口隐藏或失焦会停止动画，资源失败回退静态图。

`.cctheme` 必须明确目标 `workbuddy + macos + 5.2.6`，并携带
`targets/macos-workbuddy/theme.json`。导入器会校验 manifest、SHA-256、目标版本、媒体格式和禁止载荷，
在私有 staging 中写入 `theme.json` 作为最后提交标记，再原子替换目标。失败不会破坏上一份有效状态。

## 配色与本地深度设置

`appearance.paletteStrategy: "system"` 沿用 WorkBuddy 当前有效亮/暗外观；背景透明化只发生在已验证
的页面 Surface，账户菜单、二维码、任务流转、列表选择器和原生 modal 保持宿主样式。媒体禁用时，
所有策略都恢复原生弹窗和页面表面。

`adaptive` 与 `custom` 只消费目标 Schema 和 Style Catalog 声明的字段。主题不能携带选择器或任意
CSS/JS。WorkBuddy Settings 中的本地修改按以下顺序生效：

`Shared Core → Target Profile → Local Runtime Overrides → 无障碍/宿主安全降级`

本地控件同步预览，180ms 防抖后串行原子持久化。快速连续写入遵循 latest-write-wins；基础主题变化后，
兼容 token 重验并保留，不兼容 token 隔离并显示本地化诊断。

## 固定解释架构

WorkBuddy Version Adapter 是 DOM、挂载点、宿主 locale 与原生状态证据的单一来源；Theme Style Catalog
是样式 token 与 CSS 变量/Surface Role 连接的单一来源；Locale Catalog 只保存 CC Theme 自有文案。
主题数据不携带宿主选择器、版本事实或解释代码。

背景 Canvas 点击穿透并位于应用 UI 下方，不改变 Sidebar、聊天区、Side/Bottom Panel 或原生控件尺寸。
pause/restore 会释放 RAF、监听器、WebGL 资源、Blob URL 和自有 DOM，并恢复注入前状态。

Preflight `revision` 是 injector 进程/会话作用域的 renderer generation，不是源码或制品摘要；相同源的
不同进程允许不同 revision。确定性发布溯源使用逐文件/清单 SHA-256。

详细资料：

- [架构](docs/ARCHITECTURE.md)
- [安全边界](docs/SECURITY.md)
- [UI Surface Catalog](docs/UI-SURFACE-CATALOG.md)
- [UI 设计系统](docs/UI-DESIGN-SYSTEM.md)
- [机器契约](contracts/README.md)
- [兼容性修复 Skill](skills/repair-workbuddy-compatibility/SKILL.md)

## 发布

```bash
npm run build:client
npm run build:source
```

两个构建都读取 `contracts/adapter-release-manifest.json` 的显式白名单，不再复制整个仓库。发布合同会
拒绝 `presets/`、`themes/`、`theme-sources/`、测试夹具、主题文档、`.cctheme` 与图片/视频媒体。
发布 ZIP 只包含 Adapter 固定引擎、契约、Catalog、兼容证据、生命周期脚本和中性自有 UI 资源。
当前源码包为 `mac-workbuddy-5.2.6-r4-macos-arm64.zip`，客户端包为
`cc-theme-mac-workbuddy-5.2.6-r4-macos-arm64.zip`。当前 r4 仍是未正式发布的开发制品，prepare
可以原位重建并使旧摘要立即失效；首次正式发布后，同 revision 不可覆盖，后续修复必须递增
`adapterReleaseRevision`。
历史 staging/ZIP 属于变更前制品，已从工作区移除且永久不可发布。
