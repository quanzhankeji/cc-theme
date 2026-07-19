# Contributing to CC Theme

感谢你参与 CC Theme。我们欢迎 Bug 修复、文档改进、兼容性证据、主题格式建议和
经过讨论的新平台适配器。

## 开始之前

1. 搜索现有 Issue，确认问题没有被重复报告。
2. 小型修复可以直接提交 Pull Request；新功能、契约变更和新适配器请先创建
   Feature Request 讨论范围。
3. 安全漏洞不得公开披露，请遵循 [`SECURITY.md`](SECURITY.md)。
4. 阅读 [`SECURITY.md`](SECURITY.md) 中的安全边界和私下报告方式。

## 目录与命名

- `app/`：统一 macOS Manager；
- `adapters/mac-codex/`：macOS ChatGPT Desktop / Codex Adapter；
- 根目录 Markdown：跨项目协议、设计、路线图和发布流程；
- `adapters/mac-workbuddy/`：活跃 WorkBuddy Adapter；
- `adapters/mac-claude/`：仅保留源码，状态为 `manager-registration-paused`；
- `adapters/win-*/`：`paused-by-user`，暂停期间不接受实现或发布变更；
- `app/packages/`：只接受多个真实调用方共享的稳定 Interface；
- `app/registry/`：只保存机器可读身份和 Capability；本地 `catalog/` 不提交；
- 仅被一个子项目使用的代码留在该子项目内，至少有两个真实消费者后再提取共享包。

不要提交构建产物、依赖目录、用户媒体、真实账户信息、日志、截图、备份、Cookie、
令牌、证书或本地应用文件。

## 本地验证

跨端契约和兼容矩阵先运行不依赖客户端的根级测试：

```bash
npm run test:repository
```

macOS 适配器应在 macOS 上验证。默认测试使用已安装应用附带的 Node，也可显式指定
一个兼容的 Node 路径：

```bash
cd adapters/mac-codex
NODE="$(command -v node)" ./tests/run-tests.sh
```

涉及注入行为的改动还必须按照
[`adapters/mac-codex/RELEASE_CHECKLIST.md`](adapters/mac-codex/RELEASE_CHECKLIST.md) 完成人工验收。
`mac-workbuddy` 的改动还应在对应 Adapter 目录运行 `npm test`，并按项目 README 验证能力门控和恢复流程。Claude 源码维护不代表 Manager 支持；重新注册必须先形成正式、可由机器调用的 Seam 并单独评审。

## Pull Request 要求

- 每个 PR 聚焦一个可说明的目的；
- 描述问题、方案、风险、验证方法和受影响的客户端版本；
- 用户可见行为变化应同步更新文档或 Release notes；
- 契约变更需说明向后兼容与迁移策略；
- 背景契约变更必须更新根级 Schema、测试向量和能力矩阵；只有真实客户端证据才能把状态
  改为 `verified`；
- UI 改动可提供脱敏截图，但不得包含账户、任务、路径或私人媒体；
- 生产主题与媒体不得进入 Git；未来主题 Release 资产必须附来源、作者、许可和再分发依据；
- 不得绕过签名校验、远程代码限制、路径白名单或恢复机制。

提交 PR 即表示你有权贡献相关内容，并同意按仓库中适用的许可发布。项目当前不要求
签署 CLA。

## 提交与版本

提交信息建议使用简短祈使句，并在必要时带范围，例如：

```text
fix(mac-codex): preserve theme state after restart
docs: clarify Windows adapter boundary
```

各子项目独立验证，并在协调的 CC Theme Release 中发布。跨项目主题契约使用稳定的
`kind` 身份，当前统一为 `skin.document`、`skin.package` 与 `skin.theme`，不得仅依赖
提交时间推断兼容性。
