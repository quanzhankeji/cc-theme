# CC Theme

[English](README.md)

[![CI](https://github.com/quanzhankeji/cc-theme/actions/workflows/ci.yml/badge.svg)](https://github.com/quanzhankeji/cc-theme/actions/workflows/ci.yml)

CC Theme 是一个独立、非官方、开源的 macOS 主题工具，面向已支持的桌面 AI 客户端。它提供统一入口，用于识别兼容客户端、下载经过校验的主题和 Adapter Engine、应用主题、启动客户端以及恢复原生外观。

本仓库保存 CC Theme 应用、各宿主 Adapter、共享契约和发布元数据，不保存生产主题包或主题媒体。

## 系统要求

**CC Theme 0.1.0 当前仅支持 Apple Silicon。**

- macOS 13.5 或更高版本
- M1、M2、M3、M4 或后续 Apple 芯片
- 暂不支持 Intel / x86_64 Mac
- 暂不支持 Windows

当前尚未发布正式安装制品。此前已公证的 `CC Theme Manager` 镜像早于本次改名，不能继续作为
当前应用发布。未来正式制品将使用 `CC Theme.app` / `CC Theme_0.1.0_aarch64.dmg`，重新生成摘要并
完成新的 Apple 公证。

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

## 主题与下载

主题使用声明式 `.cctheme` 格式。主题只能包含白名单 JSON 和有界本地媒体，禁止 JavaScript、CSS、HTML、Shader、选择器、命令、远程 URL、绝对路径和路径穿越。

当前预制主题包及其视频第一帧封面可从
[CC Theme Preset Themes v1.0.0](https://github.com/quanzhankeji/cc-theme/releases/tag/themes-v1.0.0)
下载。它们以 GitHub Release 资产发布，不进入 Git 源码树。

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

CC Theme 不包含用于收集或上传凭据、对话、代码、用户媒体或其他私人本地数据的功能。Adapter 仍需要本地访问权限来完成文档所述工作，并可能影响启动、渲染、性能或可用性。请备份重要数据，只使用可信 Release；出现异常时恢复原生外观。

项目不分发官方客户端、不修改其签名应用包，也不暗示与相关厂商存在隶属或背书关系。MIT License 中的无担保和责任限制适用。

## 第三方媒体

部分社区主题媒体可能来自公开网络。公开可访问并不等于获得再分发许可，CC Theme 也不主张拥有第三方素材。权利人可以通过 Issue 指明准确主题、资产或 Release，并提供足以核验的权属与联系信息；维护者将在适当情况下审查、移除或替换相关内容。参见 GitHub 的 [版权移除指南](https://docs.github.com/en/site-policy/content-removal-policies/guide-to-submitting-a-dmca-takedown-notice)。

## 开发

```bash
npm test
```

根命令会运行仓库级阻断、共享 Interface 测试、Manager 测试和全部活跃 macOS Adapter 测试。Windows 项目在暂停期间明确排除。

贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题按 [SECURITY.md](SECURITY.md) 私下报告。除文件另有说明外，本仓库采用 [MIT License](LICENSE)。
