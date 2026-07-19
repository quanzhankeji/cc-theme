# Mac-WorkBuddy contracts

本目录只定义 WorkBuddy Adapter Interface，不拥有任何生产主题或主题媒体。

- `adapter-capability.json` / `.schema.json`：发布 Shared Core 的 exact / approximate / unsupported
  映射、Target Profile 白名单、本地 token、Catalog 版本、兼容策略和 apply gate。
- `target-profile.schema.json`：只允许 `mac-workbuddy` 命名空间的 WorkBuddy 专属语义字段。
- `skin-theme.schema.json`：外部投影结果的严格目标白名单；禁止选择器、任意 CSS/JS、命令、URL 和
  宿主版本事实。
- `cc-theme-package.json`：外部 `.cctheme` 容器、manifest、目标路径和 Adapter 目标契约；不包含
  生产 preset/distribution 声明。
- `theme-style-catalog.json`：固定 UI Interpreter 使用的只绘制 Style Catalog，以及 Settings 深度
  编辑的唯一控件白名单。
- `theme-runtime-settings.schema.json`：每主题 Local Runtime Overrides、稳定 token 指纹、base hash、
  rebase/quarantine 记录。
- `theme-settings-locales.json`：WorkBuddy effective locale 驱动的完整自有文案。
- `operation-result.schema.json`：check/preflight/apply/verify/pause/restore 的统一结果语义。
- `media-limits.json`：外部媒体格式与资源预算。
- `adapter-release-manifest.json`：源码、客户端安装和本地安装共同使用的 Adapter 发布白名单。

根目录 `PROJECT_MANIFEST.json` 是 Adapter 制品身份机器源：`adapterVersion` 跟随 WorkBuddy
`CFBundleShortVersionString`，`adapterReleaseRevision` 区分同一宿主版本下的 Adapter 修复，精确
`CFBundleVersion` 只作为兼容证据保存。Capability、Catalog、package contract 与 release manifest
必须通过 `scripts/release-identity.mjs` 保持一致。

生效顺序固定为：

`Shared Core → Target Profile → Local Runtime Overrides → Runtime Safety`

Shared Core `background.position` 是权威媒体位置；legacy appearance 位置只在 authority 缺失时带诊断
fallback，两者冲突以 `conflicting-background-position` fail closed。Target Profile 的视频位置只影响
WorkBuddy 视频 Surface。WorkBuddy effective light/dark appearance 始终是运行时 authority。

外部 `.cctheme` 必须明确目标 `workbuddy + macos + 5.2.6`，并携带
`targets/macos-workbuddy/theme.json`。`stage-theme.mjs` 先快照所有已验证媒体，最后写入 `theme.json`
作为提交标记；任何校验失败都保留上一份有效安装。

生产主题的制作、发现、catalog、发布和媒体库存属于独立 CC Theme Theme Package / catalog 资源层。
Adapter 发布包不得携带主题、媒体或可安装主题包；测试只可使用 `tests/fixtures` 的最小无品牌夹具，
且该目录不进入发布。
