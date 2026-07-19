# 阶段验收清单

> 下面 2026-07-18/19 的签名与公证记录是迁移前制品的历史归档。Manager 已迁移到
> `app`，且运行时资源合同已改为 Package Interface + Adapter Engine 白名单；在新目录
> 完成重新构建、签名和公证前，旧 `.app`/DMG 不能作为当前源码或“无内置主题”合同的发布证据。

## 2026-07-19 Monorepo 路径迁移源码验收

- 状态：`source-validated / artifact-not-rebuilt`；唯一 Manager 工作目录为 `app`；
- JS 与 Rust 都从 `.cc-theme-workspace.json` 向上发现工作区，不按固定父目录层数定位；
- Tauri 只消费 Manager 本地 `.runtime-resources`：Adapter SDK、Shared Core、Contracts、派生 Registry、
  文件摘要清单和两个 macOS Adapter Engine；制品目标仍为 `Contents/Resources/adapters/<id>`；
- Engine 输入来自 CodeX 与 WorkBuddy 发布构建接口，均经过路径、普通文件、
  SHA-256/发布清单与禁止主题资源检查；没有整仓复制 Adapter；
- Node 合同 25/25、UI 9/9、Rust 31/31、typecheck、Vite build、cargo check 与 fmt 全部通过；
- 独立只读 QA 复跑上述矩阵并核对 Registry、Engine、Tauri resources 与禁止载荷，结论 PASS、无阻断；
- Windows 为 `paused-by-user`，未注册、未实现、未测试；生产 Theme Package、预览图和媒体均未进入
  Manager runtime resources；
- 本轮按要求没有执行 `tauri build`、签名、公证或 DMG 生成，因此不得沿用下方历史制品摘要。

## 历史归档：2026-07-19 ARM64 公证 DMG 发布制品

- 状态：`notarized-arm64-dmg-gatekeeper-passed`；
- DMG：`src-tauri/target/release/bundle/dmg/CC Theme Manager_0.1.0_aarch64.dmg`；
- DMG SHA-256：`348c4106759195f70f9b9a56299c773b9af6f6dd4b3d43d3761b72f67c005343`；
- `.app` bundle manifest SHA-256：`9e8f174187deed24466082abafecee56d3d3a04ebbdaff6e167df3428a5b25af`；
- 主二进制 SHA-256：`3c77652d01384cd6039a61003de6c3fc7d17937e365d99ece568a508a2e6d8fe`；
- WorkBuddy renderer SHA-256：`f295c3a7e17c946ca7506e72a046d9e8b996e2ac1ae2f98af27af95f8a3018b3`；
- Apple Notary Service submission：`e0eca22a-3768-4472-a3a7-b907627354e2`，最终状态 `Accepted`；
- DMG 已使用 Team `8UPRU238P7` 的 Developer ID 签名并完成 stapling；`hdiutil verify`、
  `codesign --verify`、`stapler validate` 全部通过，`spctl` 返回
  `accepted / source=Notarized Developer ID`；
- 最终 APFS 镜像只含 `CC Theme Manager.app`、`Applications` 拖放入口与卷图标；镜像内应用
  深度严格验签通过，内置 Node 保持 Node.js Foundation `HX7739G8FX` 上游签名；
- 发布前回归：Node 22/22、UI 8/8、Rust 29/29、typecheck、cargo check 与 fmt 全部通过；
- 该制品为 Apple Silicon ARM64，最低 macOS 13.5。Intel/Universal、干净 Mac 全链路和升级/回滚
  演练仍需作为后续发布矩阵执行；Claude 继续保持 `runtimeApplyAvailable=false`，M4 边界不变。

公证票据已经绑定当前 DMG；任何重新构建、签名或修改都会产生新制品，必须重新提交公证、staple
并记录新的 SHA-256。

## 2026-07-18 语义契约、诊断预览与恢复链路制品快照

- 状态：`codex-workbuddy-cross-validation-passed`；
- `.app`：`src-tauri/target/release/bundle/macos/CC Theme Manager.app`；
- bundle manifest SHA-256：`2fa4a956494df0961e8f83b420c151bc9198887a924097a7fa3b388088a0a841`；
- 主二进制 SHA-256：`b7bafd815d824ce9c3938e28b81e36681c89d1a4987a43d57e4bc3dfb4913ba6`；
- WorkBuddy renderer SHA-256：`f295c3a7e17c946ca7506e72a046d9e8b996e2ac1ae2f98af27af95f8a3018b3`；
- 菜单栏图标使用用户批准的透明 PNG，源码 SHA-256 为
  `3705ba7d644d117893809fe55c1cdbe607375a73ffb466b87ce1d06c8ed6091b`；图标编译进主二进制，
  `icon_as_template=true`，由 macOS 按当前系统外观显示为单色模板；Finder / Dock 应用图标不变；
- 包内 Node、Registry 与三个 Adapter 的目标限定编译通过：Codex/WorkBuddy `allowed=true`，Claude
  `allowed=false`、`reasonCode=official-cdp-auth-required`；WorkBuddy preflight 为 `payload-valid`，并
  声明 `revisionScope=renderer-session-generation`、`releaseTraceability=file-manifest-sha256`；
- Node 22/22、UI 8/8、Rust 29/29、typecheck、cargo check 与 fmt 全部通过；
- Theme Package 清单校验 Unified Theme、受限媒体的固定路径、普通文件边界、字节数与
  SHA-256，并拒绝预编译 Adapter target 或清单外载荷；三端 target 由当前 Adapter 从同一源
  投影，并分别通过目标 normalizer；
- Claude 卡片真实显示“仅支持诊断预览 / Manager 自动应用尚未开放”，主题兼容状态显示“仅预览”，
  注入按钮保持禁用；手动 DevTools/CDP 会话不能被误报为 Manager 自动应用；
- 最终包真实验收：Codex 连续 Restore 两次均成功，缺少 selective backup 时安全幂等且仍清理 owned
  watcher；随后 Apply/verify 通过，语义角色、焦点、Surface、Reduced Motion 与视频 blob/playing
  证据有效。WorkBuddy Apply/verify/Restore 通过，恢复后 9342 不可用且 watcher 停止；
- Adapter 超时使用独立进程组收敛；测试覆盖后代忽略 TERM、父进程先成功退出但后代持有输出管道，
  以及无关进程不被误杀。该保证不扩展到主动 `setsid/setpgid` 逃离进程组的后代；
- 上一双按钮制品已真实验证卡片双按钮、主题选择后按能力启用、关闭双选弹窗、隐藏到菜单栏、重新
  打开和完全退出；Manager 退出前后的同一主题 injector PID 保持存活，没有触发 pause/restore。
  本次只替换菜单栏图标资源与 PNG 解码 feature，没有修改上述窗口/进程生命周期实现；
- WorkBuddy renderer 继续保持已批准的 MutationObserver 幂等修复摘要；Codex 的 missing-backup
  恢复幂等补丁已同步进本包；此前未校验 target 摘要的制品与菜单栏图标快照均已被本次重建取代；
- 该状态不代表 M4 或正式发布完成。

任何重新构建、重新签名或资源变化都会使以上制品摘要失效，必须生成新的验收快照，不能沿用本记录。

## M1：统一契约与注册发现

- `cc-theme.unified-theme` 只包含 Shared Core、目标 ID 和 Adapter 白名单约束的 Target Profile；
- 每个对象关闭未知字段，URL、脚本、选择器、命令、绝对路径和路径穿越 fail closed；
- Manager 从 Registry 发现 Adapter，不在 compiler、Schema 和界面多处重复维护目标列表；
- Capability 的 exact、approximated、unsupported、apply gate 与 Projection 结果一致；
- 合同测试通过。

## M2：运行时编译

- 同一输入确定性生成当前已注册目标的 `skin.theme`；
- 输出分别通过对应 Adapter 的 Schema/normalizer 二次验证；
- Target Profile 只能使用 Adapter 发布的白名单字段，不能携带注入逻辑；
- WorkBuddy 不静默丢弃 Manager 认为已映射的字段；
- accessibility 的 exact、approximate、unsupported 决策进入 Projection 与可见诊断；
- Theme Package 清单、统一主题和素材摘要验证通过，摘要不匹配时拒绝发布；
- 编译输入不回退到 Adapter preset，编译器测试通过。

## M3：一屏桌面工具

- 启动后扫描 ChatGPT / Codex 与 WorkBuddy 的安装、版本、运行、签名与 Adapter 状态；
- 默认窗口内可见扫描摘要、主题选择、客户端卡片，以及每端“正常启动 / 注入主题并启动”按钮；
- 不存在目标勾选、所选目标汇总或批量按钮；选择主题后可直接在任一能力可用的客户端卡片注入
  并启动，主要流程无需滚动；
- 未注册目标不扫描、不展示，也不进入编译、Package 或运行资源；
- 有活动主题时点击“正常启动”会通过 Adapter restore Seam 恢复原生外观并启动；无活动主题或
  没有 restore 能力时走原生 bundle 启动；
- 关闭窗口会显示“最小化到菜单栏 / 退出应用”双选弹窗；菜单栏菜单只有“打开窗口 / 退出”；
  两种退出方式均不得调用主题 pause/restore，已有注入继续运行；
- 只允许固定的 apply、launch、pause、restore、verify、doctor 动作；
- 前端不能传入 Shell、脚本路径、启动参数或任意文件路径；
- Rust 单元测试、类型检查和前端交互测试通过。

## M4：真实客户端闭环

- Codex 与 WorkBuddy 分别完成 apply → launch → verify，失败时恢复上一有效值；
- 暂停后客户端保持可用且主题 marker 移除，重新应用可以恢复；
- 卡片“正常启动”在有活动主题时直接通过 Adapter 恢复原生外观，并能回到上一有效快照；
- 本地深度覆盖在 base hash 变化后正确 preserve/replay，或显式 quarantine 并提示；
- Manager 与宿主本地编辑器的并发写入由单一串行事务 Seam 协调；
- 公开诊断不包含 token、完整用户路径、完整进程命令行、环境变量或未清洗输出。

当前 M4 **未完成**：stable-token/base-hash production entries、override rebase/quarantine 与 Manager ↔
宿主跨进程单一串行事务 Seam 尚未端到端接通；
Codex Settings 内 CC Theme 相邻条目的真实逐状态视觉验收也不在本快照的完成声明中。

## M5：零依赖发布

- release `.app` 内含固定 Adapter Engine、运行时与 Capability/Catalog，但不内置生产主题或媒体；
- 在没有 Node.js、Rust、Homebrew、源码仓库和命令行配置的干净 Mac 上完成 M3/M4 验收；
- 内嵌文件摘要、应用签名与 Hardened Runtime 验证通过；
- 生成 DMG 或 ZIP，并在 Apple Notary Service `Accepted` 后完成 stapling 与 Gatekeeper 验收；
- 记录 Manager、Adapter、Runtime 与 Theme Package 版本，完成升级与回滚演练。

当前 M5 的 ARM64 分发制品门禁已完成：DMG 已签名、公证、staple 并通过 Gatekeeper。M5 整体仍
需补充无开发环境的干净 Mac 全链路、Intel/Universal 决策，以及升级与回滚演练；这些边界不能由
当前 ARM64 公证结果外推。
