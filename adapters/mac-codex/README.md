# Mac-CodeX

Mac-CodeX 是 Codex Desktop for macOS 的可逆 Theme Adapter。它负责解释、验证、
投影和应用外部 CC Theme 包，并在 Codex 的 Settings → cc-theme 中提供本机深度编辑。
它不是主题商店，也不保存、制作或发布任何生产预设与主题媒体。

## 所有权

项目保留：

- Capability、Projector、目标 `skin.theme` Schema 与 normalizer；
- Theme Style Catalog、UI Surface Catalog、当前宿主证据和隐私化诊断；
- Settings → cc-theme、本地 Runtime Overrides、即时预览和原子持久化；
- 外部 `.cctheme` 的路径、哈希、媒体格式、尺寸、符号链接和禁止载荷验证；
- apply、verify、pause、restore、rollback、cleanup Seam；
- 图片、视频、方向图集和宠物资源的安全读取与运行时验证。

独立 CC Theme Theme Package/catalog 层负责：主题身份、生产预设、主题制作、主题发现、
可下载库存，以及图片、视频、poster、方向图集和宠物媒体。Mac-CodeX 的发布包不携带
这些资源。没有外部主题时，唯一回退是恢复 Codex 原生外观。

## 本地运行

先退出 Codex，然后在本目录运行：

```bash
./tests/run-tests.sh
./scripts/install-skin-macos.sh --port 9341 --no-launch
```

安装只部署 Adapter，不会安装或选择主题。应用一个由 CC Theme Manager 导出的外部包：

```bash
./scripts/apply-cc-theme-macos.sh --file /path/to/example.cctheme
```

之后可从 `~/Applications/CC Theme.app` 启动，或运行：

```bash
./scripts/start-skin-macos.sh --port 9341 --restart-existing
./scripts/verify-skin-macos.sh --port 9341 --reload
```

如果尚未激活外部主题，安装器不会自动启动注入，`start` 也会在碰触客户端前停止并提示；
Codex 保持原生状态。

## Settings → cc-theme

外部主题成功应用后，Settings 中的 cc-theme 页面继续支持：

- Catalog 白名单内的颜色、字体、透明度和背景呈现设置；
- 所见即所得预览、短防抖、latest-write-wins 和原子落盘；
- 失败回滚到最后有效值；
- 跟随宿主 effective locale、亮/暗模式和 Reduce Motion；
- 与相邻原生设置条目一致的键盘、焦点、选中和动画行为。

这些修改写入本机 Runtime Overrides，不修改外部主题包，不写入官方应用，也不由发布包
带走。主题库存与下载切换应回到 CC Theme Manager；Adapter 页面只编辑当前主题。

## 图片、视频和宠物

Adapter 验证外部包内的本地图片、H.264 MP4、静态 WebP 方向图集及可选 Codex v2
宠物。远程 URL、绝对路径、路径穿越、CSS、JavaScript、HTML、Shader、命令和符号链接
都会被拒绝。视频比图片持续占用更多解码、内存带宽和 GPU；Reduce Motion 时运行时强制
使用静态回退。

主题附带宠物时，安装结果会提示宠物状态。Codex 目前没有稳定的公开接口让 Adapter
自动选中宠物，因此还需在 Codex 的宠物设置中手动选择对应宠物。冲突 ID 不会被覆盖；
恢复只删除有明确所有权记录且内容未变化的宠物。

## 暂停与恢复

```bash
./scripts/pause-skin-macos.sh
./scripts/restore-skin-macos.sh --restore-base-theme --restart-codex
```

`pause` 只移除实时呈现并停止注入器；`restore` 恢复宿主原生状态。两者不会删除用户机器
上已经下载的外部主题、私人素材或已被用户修改的宠物。完整卸载可额外传入 `--uninstall`。

## 发布

```bash
./scripts/build-client-release.sh
./scripts/build-release.sh
```

当前 arm64 用户包为
`cc-theme-mac-codex-26.715.71837-r3-macos-arm64.zip`，源码包为
`mac-codex-26.715.71837-r3-macos-arm64.zip`，校验文件分别为
`cc-theme-mac-codex-26.715.71837-r3-macos-arm64.zip.sha256` 和
`mac-codex-26.715.71837-r3-macos-arm64.zip.sha256`。
`adapterVersion` 严格跟随 Codex `CFBundleShortVersionString`；同版本再发布时递增
`adapterReleaseRevision`，构建器拒绝覆盖已有同修订制品。精确 build 只存在
compatibility evidence 和 Manager compile context，不进入资产名。

构建采用显式 Adapter allowlist，并在压缩前扫描：发布包不得包含测试夹具、
生产主题目录、主题媒体、可安装 `.cctheme` 或已知生产主题身份。

## 安全与协议说明

本项目不会修改 `ChatGPT.app`、`app.asar`、官方签名或 CSP；它通过只绑定回环地址的
Chromium DevTools Protocol，把固定 Adapter 代码注入正在运行的 renderer。注入、自动化
或非官方修改仍可能不受 OpenAI 支持，并可能受到届时适用的服务条款、企业政策或客户端
更新影响。项目不代表 OpenAI，也不保证这种使用获得官方许可。用于个人或组织环境前，
请自行核对最新条款、数据政策和管理员规则；重要账号或受管设备应先取得授权。

详见 [架构](docs/ARCHITECTURE.md)、[主题输入合同](docs/THEME-CONTRACT.zh-CN.md)、
[导入流程](docs/CC-THEME-IMPORT.zh-CN.md) 与 [安全恢复](docs/SECURITY.md)。

仓库中的源码位置为 `adapters/mac-codex`；发布身份和机器接口继续稳定使用
`adapterId: mac-codex`，安装后的引擎目录名也继续为 `.mac-codex`。
