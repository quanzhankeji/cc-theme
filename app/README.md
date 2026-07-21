# CC Theme for macOS

CC Theme 是一个本地主题工具。打开应用后，用户可以在同一屏完成：

1. 查看已扫描到的本机客户端；
2. 选择一个主题；
3. 在任一客户端卡片直接点击“正常启动”或“注入主题并启动”。

当前 macOS 产品范围为：

- ChatGPT / Codex（`com.openai.codex`）：支持主题应用与启动；
- WorkBuddy（`com.workbuddy.workbuddy`）：支持主题应用与启动。

Claude Adapter 当前不注册、不扫描、不展示，也不会进入 Manager 安装资源；其源码仅保留在仓库，
等待正式、可机器调用的运行 Seam 完成验证后再重新接入。

未来目标通过通用 Adapter 注册机制接入，不在 Manager 中增加目标专属判断。

## 用户侧运行条件

当前过渡版 `.app` 内置固定版本的 Adapter Engine 与运行时，但不再内置任何生产预制主题或
主题媒体。全新安装的主题库为空；主题由独立 CC Theme 主题资源层按需下载。最终用户不需要
安装 Node.js、Rust、Homebrew、命令行工具，也不需要保留源码仓库。

最终最小化架构会进一步把 Adapter Engine 从 Manager 安装包剥离：用户选择目标客户端后再按
`OS × client` 下载经签名验证的引擎。Adapter 包只允许包含 Capability、Schema、Catalog、投影器
和运行 Seam，不得包含 `xtxg`、WOLP 或其他生产主题及媒体。

Manager 不修改官方客户端的 `.app`、`app.asar` 或代码签名。主题应用由对应 Adapter 在其已
验证的边界内完成；Capability 声明不可用时，界面会关闭相关操作并显示诊断，不会假装成功。

## 主题与 Adapter 边界

Manager 内的 [`packages/contracts/unified-theme.schema.json`](packages/contracts/unified-theme.schema.json)
定义统一主题的设计数据。
主题只包含跨客户端稳定的语义颜色、字体角色、有限外观、背景、无障碍策略以及经过白名单约束
的 Target Profile，不包含宿主 DOM、选择器、进程、注入方式或精确版本事实。

Manager 内的 [`registry/adapter-capabilities.json`](registry/adapter-capabilities.json) 是目标发现
入口。每个 Adapter 自己发布 Capability、投影器、目标 Schema、兼容证据和应用事务；Manager
只根据注册信息展示能力、组织编译并调用固定操作，不重新解释宿主映射。

用户选择主题并点击某个客户端的“注入主题并启动”后，Manager 以该卡片的 Adapter ID、Theme
Package、Capability 与运行时 Compile Context 调用对应投影器，生成并二次验证目标
`skin.theme`，再把该目标原子写入本地主题库。统一主题始终是设计源，Adapter 自带 preset 不是
运行时编译输入。Manager 构建时通过 `app/packages/adapter-sdk` 发现工作区和 Registry，再只消费
`app/packages/shared-core`、`app/packages/contracts` 与各 Adapter 发布的 Engine；不会整仓复制 Adapter。

关闭主窗口时可选择退出，或隐藏到 macOS 顶部菜单栏。菜单栏图标只提供“打开窗口”和“退出”；
退出 Manager 不会调用暂停或恢复操作，已经注入的主题与独立运行的 Adapter injector 会继续生效。

主题数据保持声明式。远程 URL、任意 CSS、JavaScript、HTML、Shader、Shell 命令、选择器、
绝对路径和路径穿越都会被拒绝。

Manager 界面支持中文和 English。首次启动跟随 macOS 语言，用户切换后保存在本机；该设置只
控制 Manager 自身窗口与顶部菜单栏，不覆盖宿主客户端自己的语言。

主题使用 ZIP 兼容的 `.cctheme` 文件。界面的“导入 .cctheme”会先验证固定目录结构、文件数与
解压大小、媒体 magic、完整性清单和 SHA-256，再原子安装到 Manager 的本地主题库。主题包的
`family.json` 可提供 `zh-CN` / `en-US` 名称与简介，Manager 按当前界面语言显示并回退到英文。
标准模板和打包命令由本地、Git 忽略的 `themes/` 制作区维护。

更多细节见：

- [统一主题架构](docs/unified-theme-architecture.md)
- [Adapter 生命周期](docs/adapter-lifecycle.md)
- [阶段验收](docs/acceptance.md)
- [签名与公证](docs/signing-and-notarization.md)
- [Adapter 独立分发决策](docs/adr/0001-adapter-distribution.md)
- [Adapter 分发开发记录](docs/adapter-distribution-progress.md)

## 本地开发

开发者需要：

- macOS 13.5 或更高版本；
- Node.js 22 或更高版本；
- Rust stable；
- Xcode Command Line Tools。

安装依赖并运行检查：

```bash
npm ci
npm --prefix app run prepare:resources
npm --prefix app test
npm --prefix app run typecheck
npm --prefix app run tauri:dev
```

以上命令从仓库根目录执行；Monorepo 统一使用根目录的 `package-lock.json`。
`tauri:dev` 会先下载并校验固定版本的 Apple Silicon Node 运行时；缓存保存在忽略目录中，
不会提交到 Git。

生成三个独立、确定性的本机 Adapter Package 与本地版本清单：

```bash
npm run adapter:catalog:check
npm run adapter:build -- --out /tmp/cc-theme-adapters
```

`.ccadapter` 使用固定 `adapter.json + payload/` 结构。构建命令要求输出目录为空，避免旧包进入新
Catalog；每个包会同时生成 sidecar，记录 archive bytes/SHA-256、manifest SHA-256 和完整 Package
身份。Package 文件名使用 `<adapterId>-<adapterVersion>-r<adapterReleaseRevision>-<platform>-<architecture>.ccadapter`；
`adapterVersion` 跟随宿主应用版本，release revision 独立递增。当前命令只生成本地开发制品，
不上传、不签名、不安装，也不会改变 Manager 正在使用的
bundle Engine。发布 Catalog 必须额外提供 HTTPS Release 基址，并留待第三阶段信任链启用后消费。

生成 macOS 应用包：

```bash
npm run tauri:build -- --bundles app
```

正式 0.2.1 过渡基线只能使用固定入口构建：

```bash
npm --prefix app run tauri:build:transition -- --bundles app,dmg
```

该入口会在整个 Tauri 构建（包括 `beforeBuildCommand`）中固定
`CC_THEME_RUNTIME_PROFILE=transition-baseline`，从三个经过固定 URL、bytes、archive SHA-256 与
`adapter.json` SHA-256 约束的公开 Release 资产构造 runtime；不得先手工准备旧 Adapter 后再调用普通
`tauri:build`，否则 Tauri 会重新生成 source-build runtime。包内 `runtime-attestation.json` 由
`artifact-manifest.json` 覆盖，正式 Release workflow 会再次核对完整受管文件集合与三项 Engine 身份。

以上依赖只用于开发和构建，不是发布版应用的用户依赖。

`prepare:resources` 会从工作区标记自动定位仓库根目录，把稳定 Package Interface 和已构建的
Adapter Engine 暂存到 `.runtime-resources`。Tauri 只打包这个白名单目录，制品内路径保持为
`Contents/Resources/adapters/<id>`。Windows 当前按用户要求暂停，不注册、不实现也不测试。
