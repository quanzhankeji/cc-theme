# mac-claude

> 项目状态：`preserved-source / manager-registration-paused`。Claude Adapter 暂时退出
> CC Theme Manager；当前不生成、不交付 Engine，也不提供 prepare-ready 状态。
> 机器与维护边界见 [`docs/STATUS.md`](docs/STATUS.md)。

`mac-claude` 是 CC Theme 面向 macOS Claude Desktop 的独立 Skin Adapter。它拥有自己的
Capability、Target Profile、Theme Style Catalog、UI Surface Catalog、Projection、Runtime
Overrides 与 apply/restore Seam；不会修改 `/Applications/Claude.app`、`app.asar` 或官方签名。
Monorepo 中唯一源码位置为 `adapters/mac-claude`；发布包内部的稳定目录 `.mac-claude`、
Adapter/Capability id 与发布文件名不随工作区目录迁移而改变。

当前 Adapter 公开版本严格跟随受支持宿主 ShortVersion `1.22209.3`，本次发布修订为 `1`。
只读证据已重新确认 bundle id `com.anthropic.claudefordesktop`、build `1.22209.3`、
Team ID `Q6L2SF6YDW`、Hardened Runtime、stapled notarization、Electron `42.5.1`、
Chromium `148.0.7778.271` 及新的 ASAR digest/integrity。精确 build 只属于兼容证据，
不会拼入 `adapterVersion`。该客户端会拒绝未携带 Anthropic 签名 `CLAUDE_CDP_AUTH`
令牌的远程调试参数；Mac-Claude 不伪造或绕过它。因此当前 capability 是
`projection-only`，`runtimeApplyAvailable=false`、`deepSettingsAvailable=false`。版本相近、
同为 Electron 或离线 Catalog 通过都不代表已具备真实 apply Seam。
Manager 对 Claude 的机器可读门禁同样为 `managerApplyAllowed=false`，且作用域仅为
`mac-claude`；Claude 的投影结果不会授权 apply，也不会把不可用状态传播给用户选择的其他 Adapter。

Claude `1.22209.0` 曾通过官方 `CLAUDE_DEV_TOOLS=detach` 诊断入口完成一次中性外部主题样例的原生
New chat 会话预览，背景、侧栏、主区域和 Composer 绘制成功。这个结果只在当前 renderer
会话存在，不会跨重载/重启，也无法承载自动保存和完整恢复，因此只作为视觉映射证据，
不会把 `managerApplyAllowed` 改为 `true`。该手动结果在 `1.22209.3` 仅作为历史候选映射；
当前远端 UI build 与 live landmarks 尚未通过授权方式重新采集，因此 Surface admission fail closed。

Theme Manager 现在可通过独立的
[`diagnostic-preview-interface.json`](contracts/diagnostic-preview-interface.json) 准备这条诊断路径。
它必须先取得用户对“重启 Claude 并打开官方 DevTools”的明确确认，然后引导用户把固定 Adapter
bootstrap 复制到 DevTools Console 执行；Claude 的 CSP 不会被削弱，也不会打开远程 CDP。
连接成功后只回传主壳、侧栏、Composer、Settings 与自有节点计数等结构摘要，不读取或保存用户内容。
Manager 必须把它显示为“仅支持诊断预览 / 自动应用尚未开放”。

同一官方诊断入口还完成了真实 Settings 弹窗的手动会话验收：`CC Theme` 位于
`Desktop app → General` 正下方，字母 `C` 保留在 General 的原生图标容器副本中；点击后
打开独立自有页面而不是嵌入 General。已验证切回 Extensions、关闭并重开 Settings 和键盘
焦点状态；未提交原始截图或读取用户内容。该入口仍仅存在于当前 renderer 会话，不构成
自动、持久或已授权的生产 Seam。

后续真实回归已把占位诊断页替换为完整的 8 分组编辑器，并验证
`Developer → CC Theme → Developer → CC Theme` 往返时严格只有一个条目处于选中状态。
这项回归同时收紧了 Desktop app 三项列表识别，避免顶部 Settings → General 被误认为
Desktop app → General。诊断编辑仍只使用会话内存，不代表重启持久化已经解除门禁。

历史真实媒体诊断还确认 Claude `1.22209.0` 会以 URL safety policy 拒绝 MP4 的 Blob、loopback
和 data 来源。外部 Theme Package 可以声明受大小与格式白名单约束的动态 GIF 降级；Adapter 仅在
该宿主限制下验证并使用它，同时显示 `video-media-policy-animated-image-fallback`。它是近似降级，
不是“视频播放成功”，也不改变 `runtimeApplyAvailable=false`。CC Theme 自有页面的几何、字体和
间距不随主题视觉开关变化；关闭视觉时只恢复宿主并在自有页面保留私有布局变量。独立页面底部
状态栏为透明，popover 形态仍保留自己的面板背景。

## 用户界面

离线实现及上述手动诊断验收均确认：Claude 的 Settings 左侧 `Desktop app`
分组应在 `General` 下方出现独立
`CC Theme` tab。它的图标是字母 `C`，但 `C` 位于 General 的原生图标容器副本中；条目
复用相邻原生条目的尺寸、布局、颜色、状态与动画。点击后打开由 CC Theme 自己维护的
独立页面，不嵌入 General。

该自有页面的实现是完全所见即所得的：主题、颜色、字体、透明度与背景效果改变后立即预览，并在短防抖
后原子保存。没有“保存”按钮。连续输入采用 latest-write-wins；失败时 UI、renderer 与磁盘
一起回滚到最后有效状态。外部主题包替换会先处理待写入状态，renderer 重载或 Claude 重启后仍恢复
最后一次成功修改。

语言完全跟随 Claude 自身的当前 effective locale，而不是 macOS 或
`navigator.language`。`claude.hybrid.DesktopIntl.getInitialLocale()` 是初始唯一来源，
`onLocaleChanged()` 是运行时唯一切换信号；Adapter 从不调用宿主语言写接口，也不保存独立语言偏好。
Claude `1.22209.3` 的签名资源重新确认 11 个 locale：`en-US`、`fr-FR`、`de-DE`、`hi-IN`、
`id-ID`、`it-IT`、`ja-JP`、`ko-KR`、`pt-BR`、`es-419`、`es-ES`。本版本宿主切换即时
生效，因此入口、页面、状态、校验、辅助功能文案和数字格式会在同一任务内原位刷新，不销毁页面、
不清空草稿，也不打断待写事务。未知 locale 整页回退 `en-US` 并产生有界诊断；页面不提供语言选择器。
机器可读来源见 [`contracts/claude-locale-catalog.json`](contracts/claude-locale-catalog.json)。

## 安装与运行

若未来重新通过注册门禁，保留的资产身份为（当前没有可交付 r1 Engine）：

- `cc-theme-mac-claude-v1.22209.3-r1-macos-arm64.zip`
- `cc-theme-mac-claude-v1.22209.3-r1-macos-arm64.zip.sha256`
- `mac-claude-v1.22209.3-r1-macos-arm64.zip`
- Release tag：`mac-claude-v1.22209.3-r1`

当前仍是首次正式发布前的 `development-unpublished` 状态，开发态 r1 允许原位重建并重新生成
全部摘要；首次正式发布后同 revision 才永久不可变。由于 Manager 注册现已暂停，当前构建入口
会在生成 Engine 前直接失败，以上规则只保留为未来重新提案后的发布合同。

当前版本只应进行离线部署，不创建会误导为可用的启动器，也不启动注入：

```bash
./scripts/install-skin-macos.sh --port 9451 --no-launchers --no-launch
node ./scripts/adapter-capability.mjs --validate
```

安装器要求官方 Claude 已退出。`doctor` 会返回机器可读的
`transport-unavailable / official-cdp-auth-required` 并以非零状态结束，这是当前预期结果：

```bash
./scripts/doctor-macos.sh
```

## 用户确认的诊断预览

诊断预览与正式 apply 是两个不同接口。Manager 调用
`scripts/diagnostic-preview.mjs prepare` 时使用已验证的唯一活动主题快照，并提交 `userConfirmed=true` 和
`restartClaude=true`。返回值会包含两个受限用户动作：先在 Claude DevTools Console 复制固定
bootstrap，再粘贴并执行。状态可通过 `status` 轮询；出现
`diagnostic-preview-connected` 只表示当前 renderer 已连通，不表示生产 Seam 可用。

结束时 Manager 应调用 `stop` 并传入 `restartNormalClaude=true`。这会关闭 tokenized loopback
服务、销毁诊断 renderer，并以普通模式重新启动 Claude，从而完整移除自有主题、tab、样式、媒体、
监听器和 Blob URL。诊断中的白名单深度编辑仍会原子保存到 Adapter 本地覆盖，但主题绘制本身仅持续
到当前 renderer 会话；正式门禁始终保持 `runtimeApplyAvailable=false`。

以下 runtime 命令当前会在启动或修改 renderer 前失败关闭；待 capability 明确升级后才可使用：

```bash
./scripts/start-skin-macos.sh --port 9451 --restart-existing
./scripts/verify-skin-macos.sh --port 9451
```

解除 Manager/runtime 门禁必须同时取得：官方授权且可逆的 renderer Seam、精确签名构建与
live probe、隐私安全的 live surface 地标、真实 apply/verify/pause/restore 矩阵，以及完整
资源清理和独立 QA。Capability 在这些证据齐全前保持 `allowed=false`。

暂停与完全恢复仍然可用：

```bash
./scripts/pause-skin-macos.sh --port 9451
./scripts/restore-skin-macos.sh --uninstall
```

生命周期结果均为机器可读 JSON，阶段固定为
`detect → preflight → apply → verify → pause → restore`，失败分为
`adapter-landmark`、`theme-contract` 与 `visual`。

## CC Theme 页面

独立页面包含当前外部主题信息、背景播放/交互效果状态和 Theme Style Catalog 中的全部
可编辑项。编辑器按语义分组展示颜色、字体、背景模糊、饱和度和遮罩透明度；所有输入只会
变成白名单值，再由 Claude Interpreter Adapter 映射到 renderer。设置页面从不持有宿主
选择器，也不能注入 CSS、JavaScript、HTML、Shader、远程 URL 或媒体来源。

本地状态位于：

```text
~/Library/Application Support/CCTheme/claude/
├── theme/
├── style-overrides/<theme-id>.json
└── reports/
```

每份覆盖记录绑定主题 id 与规范化主题哈希，使用私有权限和 `fsync + rename` 原子写入。
Shared Core、Target Profile 和本地深度覆盖经过 Adapter 的同一串行事务 Seam；base hash
变化时仍兼容的稳定 token 会重放，不兼容值会隔离并显示诊断，绝不静默丢弃。

## 外部主题输入

生产主题、预览图、媒体和可安装 Theme Package 由独立 CC Theme 主题资源层拥有。Mac-Claude
不提供预设制作、主题发现或主题库管理，也不内置默认/fallback 主题。它只接受外部、已验证的
Unified Theme Projection 或 `.cctheme`，并把选中包原子替换为唯一活动快照：

```bash
./scripts/apply-cc-theme-macos.sh --file /absolute/path/theme.cctheme --no-apply
```

主题包只能包含白名单 `skin.theme` JSON 和本地受限媒体；设置页继续提供 Theme Style Catalog
与 Local Runtime Overrides 驱动的深度编辑。主题包与设置页都不能携带宿主选择器或可执行内容。详细契约见
[`contracts/README.md`](contracts/README.md) 与
[`docs/THEME-CONTRACT.zh-CN.md`](docs/THEME-CONTRACT.zh-CN.md)。

## 隐私与证据

Live Surface Evidence 从第一天按结构采集：稳定属性、语义 role/类、父子结构、计数、
几何、布尔状态和必要的计算样式。它禁止采集或保存聊天文本、`innerText`、`textContent`、
输入值、accessible name、URL/query/hash、链接或媒体来源。原始截图不进入仓库。

宿主二进制/签名证据列在
[`host-evidence.json`](compatibility/claude-macos/1.22209.3/host-evidence.json)，候选 Surface 与仍未验证页面列在
[`ui-surface-catalog.json`](compatibility/claude-macos/1.22209.3/ui-surface-catalog.json)。

## 开发、测试与发布

```bash
./tests/run-tests.sh
./scripts/build-release.sh
./scripts/build-client-release.sh
```

发布包是自包含的 Adapter：运行时、契约、Catalog、Interpreter 与生命周期依赖都来自当前目录。
它不包含生产主题、媒体、Theme Package、测试夹具或 Authoring Skill，也不会从 sibling 项目加载实现。
当前 Manager 注册暂停，因此这些源码能力不构成可分发 Engine 或可用 apply 声明。

## 安全恢复

`pause`、主题替换和 `restore` 会撤销自有 DOM、样式、监听器、定时器、Blob URL、
WebGL/Canvas 资源和 CDP 注册脚本。恢复只处理 CC Theme 自有状态，官方应用包始终只读。
若签名、版本、ASAR 指纹、官方授权传输或必要地标不匹配，适配器拒绝应用并保持原生界面。
当前已验证的是拒绝路径、离线 Projection 与恢复边界；真实主壳、设置 tab、弹窗及逐状态视觉
验收仍明确列为未验证，直到官方授权 Seam 可用。
