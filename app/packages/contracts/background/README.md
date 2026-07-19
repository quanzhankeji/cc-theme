# Repository-level contracts

本目录只保存能够跨平台复用的数据与状态约束，不保存任何客户端注入代码或渲染器。
具体适配器仍独立拥有客户端识别、进程生命周期、DOM/窗口挂载、图形后端和恢复流程。

## 文件

- `background-capability.schema.json`：从 `skin.theme` 中提取的背景能力片段；
- `../../test-kit/fixtures/background-capability.vectors.json`：跨端必须复用的中性正反测试向量；
- `background-state-machine.json`：交互控制、静态降级和生命周期状态；
- `media-limits.json`：跨端一致的媒体上限；
- `client-capabilities.json`：经过证据分级的多端能力快照，不是发布承诺。

## 规范语义

背景模式严格三选一：静态/视频 `media`、`ripple`、`directional`。主题必须有本地基础图片，
`backgroundVideo` 与 `interactiveBackground` 不得同时出现。

- `ripple` 只读取本地基础图片和白名单数值；主题不能提供 Shader、脚本或 CSS。
- `directional` 只读取静态本地 WebP 图集；方向数仅为 8、16 或 32，且
  `columns × rows = directions`。
- 图集不得超过 32 MiB、32 MP 或任一边 16384 px；必须按内容检查 RIFF/WebP，拒绝
  `ANIM`/`ANMF`、远程 URL、绝对路径、路径穿越和链接。
- macOS 的符号链接和 Windows 的符号链接、junction/reparse point 都按“链接”处理并拒绝。
- Reduce Motion 强制进入静态状态。用户关闭交互后，主题透明样式和基础图片继续保留；
  ripple 显示静态图片，directional 显示 `idleFrame`。

JSON Schema 负责字段白名单、数值范围、互斥和图集网格组合；文件签名、动画块、真实尺寸、
链接和文件大小必须由包导入器在可信暂存目录中再次验证，不能只相信扩展名或 MIME。

## 消费规则

1. Skin Document/Package 编译器输出这些字段，但不能输出运行时代码。
2. 适配器先验证包目标和资源，再把规范化配置交给自身的固定渲染器。
3. 固定渲染器实现统一状态语义，但不得跨客户端复制平台专属 DOM/CDP 挂载逻辑。
4. 新消费者必须运行根级向量，并在真实客户端保存版本与验收证据，之后才能把兼容矩阵
   从 `integration-in-progress` 或 `not-started` 改为 `verified`。

当前 `mac-codex` 与 `mac-workbuddy` 已在各自适配器边界内验证 `media`、`ripple`、
`directional` 和 Reduce Motion 强制静态行为；运行时仍以每个客户端自己的实机证据
为准。完整状态见根目录 `COMPATIBILITY.md`。
