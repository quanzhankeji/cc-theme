# Mac-CodeX Adapter Capability v2

Mac-CodeX 是 `adapterId: mac-codex` 的可用 Adapter。统一 CC Theme 客户端只通过
`contracts/adapter-capability.json` 发现能力，通过
`scripts/adapter-capability.mjs` 编译；它不需要知道 Codex DOM、选择器、CDP、进程或本机
版本。Theme、IPC 和 `.cctheme` 的新读写都只接受 `mac-codex`；不提供普通
Adapter alias 或迁移读取入口。

## 单一 Projection

`contracts/adapter-projection.json` 是 Shared Core → `skin.theme` 的唯一字段决策源。
capability 只引用它，compiler 在运行时读取并核对决策；字段不允许同时在 capability 和
compiler 维护两份含义。

`node scripts/adapter-capability.mjs describe` 会在读取时解析这一个 Projection、Target
Profile Schema 与 Style Catalog，返回 `resolved.sharedCoreFieldDecisions`、可编辑 token id
和 runtime control id。统一客户端无需硬编码目标清单，而磁盘上仍然只有一份映射事实。

| Shared Core | 决策 | Codex Projection |
|---|---|---|
| `identity.id/name` | exact | `skin.theme.id/name` |
| `tokens.colors.text/textMuted` | exact | `colors.text/muted`，由 normalizer 和 renderer 实际消费 |
| 其余 `tokens.colors.*` | exact | `semanticColors.*` |
| `tokens.fonts.display` | exact | `fonts.display` |
| `tokens.fonts.ui` | approximate | 仅覆盖已验证的 CC Theme 自有 Home Surface，并返回 `font-ui-owned-surfaces-only` |
| `tokens.fonts.code` | unsupported | 当前没有真实消费者，省略并返回 `font-code-runtime-unavailable` |
| `tokens.appearance.shellMode` | exact | `appearance.shellMode` |
| `background.position` | exact | 当前背景的权威 `appearance.backgroundPosition` |
| 历史 `tokens.appearance.backgroundPosition` | approximate | 仅在权威位置缺失时回退并返回兼容诊断；冲突拒绝编译 |
| 图片、视频、poster、水波、方向图集与 scrim | exact | 白名单媒体字段或 `interactiveBackground` |
| `accessibility.reducedMotion=static` | exact | 不写入主题，由 Codex 运行时最终执行 |
| 其余可选 accessibility 字段 | unsupported | 省略并返回各自稳定诊断码，不伪装成运行时已执行 |
| `targetProfiles.mac-codex.copy.tagline` | unsupported | 当前无 renderer consumer，省略并返回可见诊断 |

Target Profile 只允许 `contracts/target-profile.schema.json` 中的 `copy`、`art`、有限
`appearance` 和 Hero 资产 id。设计层只保存稳定资产 id；Adapter 编译上下文使用
`assetBindings` 把 id 解析成安全的包内文件名。设计数据不包含 URL、绝对路径、路径穿越、
CSS、脚本、HTML、Shader、选择器、命令或宿主版本事实。

## 本地深度覆盖与并发

最终顺序是：Shared Core → Target Profile → Local Runtime Overrides → Reduced Motion/宿主
安全降级。Style Catalog token 是本地深度覆盖的稳定 id。

基础 Theme hash 变化后，Adapter 逐 token 重新验证：仍兼容的值直接重放；不兼容值不应用，
只把 token、固定原因和原值 SHA-256 写入 `quarantine`，CC Theme 页面显示本地设置已调整。
不会静默清空，也不会把未验证原值重新写回主题。

`scripts/runtime-override-transaction.mjs` 是统一客户端与宿主内编辑器共同使用的单一事务
Seam。它按 Theme 使用跨进程文件锁，把调用方从 base snapshot 到 desired snapshot 的实际
token 变化合并到当前记录；不同 token 同时修改会保留两边，同一 token 的竞争按串行顺序
处理并返回 conflict 诊断。记录以 `0600` 原子替换。常驻 injector 监听验证后的记录并广播
到当前 renderer，因此统一客户端写入同样即时生效，不需要保存按钮或整页重载。

运行时请求中的 `themeDir` 是 Adapter 本地执行上下文，不属于 Shared Core、Target Profile
或主题包；它必须是无符号链接的绝对本地目录。主题设计数据本身始终无路径。

## Apply / Restore 边界

Capability 声明 `runtimeApplyAvailable=true`，但实际 apply 仍必须经过官方应用签名、当前
客户端 Surface Catalog、对应 ASAR 结构标记、回环 CDP、目标 Theme 白名单和注入后自有
节点验证。`always-latest` 只表示项目面向用户当前安装的最新版，不是沿用旧版成功证据的
豁免：版本、build、Chromium 或 ASAR 变化会使旧证据失效，缺少新证据时 apply fail closed。
Manager 的 compile context 必须同时携带精确的 `detectedClientVersion`、
`detectedClientBuild`、`surfaceCatalogId` 和通过的隐私化 `probeStatus`；字段缺失与值不匹配
同样拒绝 apply。注入后的 `verify` 还必须通过 `semanticStyleEvidence`，确认当前结构节点、
颜色别名、标题/正文消费、表面、背景位置和 Reduced Motion 状态，而不是仅凭注入容器存在。
restore 只清除 Adapter 自有节点、变量和运行状态，不修改官方应用、`app.asar` 或签名。

当前 `26.715.31925 / build 5551` 的隐私化语义角色与视觉消费结果保存在
`compatibility/chatgpt-macos/26.715.31925/semantic-role-visual-report.json`。报告明确把移动背景
Home 的验收定义为“保留当前原生布局且 Home 根节点、标题、Composer 可见”，不再要求旧 Demo
固定出现四张建议卡。报告只记录结构、几何、状态和必要计算样式，不记录任何页面文案、账户、
对话、输入、accessible name、URL 或媒体来源。
