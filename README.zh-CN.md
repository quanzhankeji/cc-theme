# CC Theme

[English](README.md)

官方网站：[cc-theme.app](https://cc-theme.app)

[![CI](https://github.com/quanzhankeji/cc-theme/actions/workflows/ci.yml/badge.svg)](https://github.com/quanzhankeji/cc-theme/actions/workflows/ci.yml)

CC Theme 为已支持的 macOS 桌面 AI 客户端提供开箱即用、可复现的主题包和统一主题管理。用户导入有版本的 `.cctheme`，即可通过经过验证的宿主 Adapter 应用主题并恢复原生外观，不需要再让 AI 生成主题、反复修改提示词或消耗生成 Token。

这是一个独立、非官方、开源的项目，不是提示词库、概念图库或通用 AI 主题生成器。本仓库保存 CC Theme 应用、各宿主 Adapter、共享契约和发布元数据；生产主题包由独立的 [CC Theme Themes](https://github.com/quanzhankeji/cc-theme-themes) 仓库维护并作为 Release 资产发布，主题媒体不进入本 Git 源码树。

## 演示视频

https://github.com/user-attachments/assets/7549701d-924d-4a12-a977-06a48b08ba43

## 为什么选择 CC Theme

部分主题产品提供的是一张概念效果图和一段提示词，再由用户交给 Codex、WorkBuddy 或其他 AI 生成最终效果。这种流程依赖具体模型与上下文，可能消耗额外 Token，还经常需要反复修改提示词、重新生成和“抽卡”；即使从相同想法开始，也不一定得到相同结果。

CC Theme 发布的是实际可用的声明式主题包，包括已经制作的素材、语义主题数据、完整性元数据以及经过测试的宿主映射。在文档明确的 Adapter 和客户端版本边界内，同一主题包会走同一条经过校验的应用路径。因此，已发布主题可以直接使用，在包级别具有确定性和可复现性，不需要“提示词抽卡”。这不代表未经测试的客户端版本或平台也能得到相同效果。

| | 基于提示词生成主题 | CC Theme |
| --- | --- | --- |
| 用户获得的内容 | 概念图和交给 AI 的操作提示 | 有明确版本的 `.cctheme` 主题包 |
| 最终结果 | 使用时临时生成，依赖模型和上下文 | 由宿主 Adapter 应用已经制作的素材和声明式配置 |
| AI 消耗 | 可能需要生成 Token，并反复调整提示词 | 应用主题时不调用 AI 生成，也不消耗生成 Token |
| 可复现性 | 不同生成过程可能得到不同输出 | 相同主题包与已支持 Adapter 使用相同的校验输入 |
| 兼容性 | 取决于生成结果实际修改了什么 | 按 Adapter 和已支持客户端版本记录并测试 |

## 工作方式

1. 从官方 Release 下载有明确版本的 `.cctheme` 主题包。
2. 将主题包导入 CC Theme。Manager 会在安装前校验 Manifest、声明的摘要、白名单内容和有界本地媒体。
3. 选择已经识别且受支持的客户端。CC Theme 通过该客户端经过验证的 Adapter 应用主题，并可按用户选择启动客户端。
4. 用户可以在同一个 Manager 中暂停主题或恢复客户端原生外观。

这里的“直接应用”有严格边界：它只表示通过兼容的 CC Theme Adapter 应用经过校验的主题包，不代表可以无条件注入任意第三方应用。

## 系统要求

**CC Theme 0.2.0 当前仅支持 Apple Silicon。**

- macOS 13.5 或更高版本
- M1、M2、M3、M4 或后续 Apple 芯片
- 暂不支持 Intel / x86_64 Mac
- 暂不支持 Windows

当前正式应用版本为 [CC Theme 0.2.0](https://github.com/quanzhankeji/cc-theme/releases/tag/cc-theme-v0.2.0)。
正式应用名为 `CC Theme.app`；本地 DMG 文件名中的空格经 GitHub 规范化后，线上下载名为
`CC.Theme_0.2.0_aarch64.dmg`。

## 当前客户端支持

| Adapter | 当前边界 |
| --- | --- |
| [`mac-codex`](adapters/mac-codex/README.md) | 已在文档所列 Codex 版本验证 CC Theme 应用与恢复 |
| [`mac-workbuddy`](adapters/mac-workbuddy/README.md) | 已在 WorkBuddy 5.2.6 验证 CC Theme 应用与恢复 |
| `win-*` | `paused-by-user`；不进入活跃 CI、打包和 Release |

Claude 当前不属于 CC Theme 支持范围。[`adapters/mac-claude`](adapters/mac-claude/README.md)
仅以 `preserved-source / manager-registration-paused` 状态保留源码，不进入客户端扫描、活跃
Registry、编译、打包、界面或 CC Theme 运行资源。只有正式、可由机器调用的 Seam 通过评审后，
才会重新注册。

准确证据和能力限制见 [COMPATIBILITY.md](COMPATIBILITY.md)。客户端升级后，Adapter 可能需要重新验证。

兼容性需要同时考虑主题包、Adapter、客户端及客户端版本。在当前预制主题 Release 中，EVA 媒体主题已在 WorkBuddy 验证，但尚未在 CodeX 完成视觉验证；主题包仍可下载，但不能把该组合宣传为已经测试通过。

## 主题与下载

主题使用声明式 `.cctheme` 格式。主题只能包含白名单 JSON 和有界本地媒体，禁止 JavaScript、CSS、HTML、Shader、选择器、命令、远程 URL、绝对路径和路径穿越。

当前预制主题包及其视频第一帧封面可从
[CC Theme Preset Themes v1.0.0](https://github.com/quanzhankeji/cc-theme-themes/releases/tag/themes-v1.0.0)
下载。[机器可读 Catalog](https://github.com/quanzhankeji/cc-theme-themes/blob/main/catalog.json) 记录每个主题包不可变的文件名、字节数和 SHA-256。主题包以 GitHub Release 资产发布，不进入两个仓库的 Git 源码树。

`.cctheme` 是标准 ZIP 兼容容器，根目录固定为 `family.json`、`unified-theme.json` 和 `assets/`，
不再额外套一层目录。`family.json` 维护中英文名称/简介、许可证、素材角色、字节数和 SHA-256；
`unified-theme.json` 只维护稳定的语义主题数据。`themes/` 仅公开通用的 `example/`、`tools/`、
`tests/` 和 README；真实主题源、预览、媒体、生成包和发布暂存内容只保留在本地并由 Git 忽略。

CC Theme 可以消费单独发布的下载元数据；其中通过固定文件名、字节数、SHA-256、最低应用/契约版本和所需 Adapter 能力指向不可变主题资产。本地 `catalog/` 工作区、生产 `.cctheme`、预览和媒体均不进入本源码仓库。

网络故障可以影响浏览和下载新主题，但不得阻断已安装主题、客户端原生启动或 last-known-good 恢复。

## 仓库结构

```text
app/                       CC Theme 应用、共享 Package、Registry 与脚本
adapters/mac-codex/       活跃 Codex Adapter 源码
adapters/mac-workbuddy/   活跃 WorkBuddy Adapter 源码
adapters/mac-claude/      保留源码，CC Theme 注册暂停
adapters/win-*/           保留的 Windows 工作，paused-by-user
themes/                    仅公开示例、制作工具与主题包测试
docs/ tests/               公开所有权说明与仓库阻断检查
```

详见 [目录所有权规则](docs/OWNERSHIP.md)。

## 安全与隐私

应用现有 CC Theme 主题包不会向 AI 模型发送生成提示词。CC Theme 不包含用于收集或上传凭据、对话、代码、用户媒体或其他私人本地数据的功能。Adapter 仍需要本地访问权限来完成文档所述工作，并可能影响启动、渲染、性能或可用性。请备份重要数据，只使用可信 Release；出现异常时恢复原生外观。

项目不分发官方客户端、不修改其签名应用包，也不暗示与相关厂商存在隶属或背书关系。MIT License 中的无担保和责任限制适用。

## 第三方媒体

部分社区主题媒体可能来自公开网络。公开可访问并不等于获得再分发许可，CC Theme 也不主张拥有第三方素材。权利人可以通过 Issue 指明准确主题、资产或 Release，并提供足以核验的权属与联系信息；维护者将在适当情况下审查、移除或替换相关内容。参见 GitHub 的 [版权移除指南](https://docs.github.com/en/site-policy/content-removal-policies/guide-to-submitting-a-dmca-takedown-notice)。

## 开发

```bash
npm test
```

根命令会运行仓库级阻断、共享 Interface 测试、Manager 测试和全部活跃 macOS Adapter 测试。Windows 项目在暂停期间明确排除。

贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题按 [SECURITY.md](SECURITY.md) 私下报告。除文件另有说明外，本仓库采用 [MIT License](LICENSE)。
