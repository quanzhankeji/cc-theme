# 给 Claude 的部署提示词

请把本目录视为完整、独立的 `mac-claude` 发布包，只修改本项目自有状态。

1. 运行 `./tests/run-tests.sh` 和 `node ./scripts/adapter-capability.mjs --validate`。
2. 确认官方 Claude Desktop 已退出。
3. 运行 `./scripts/install-skin-macos.sh --port 9451 --no-launchers --no-launch`。
4. 运行 `./scripts/doctor-macos.sh`，确认它因 `official-cdp-auth-required` 返回机器可读阻断；
   不要伪造 `CLAUDE_CDP_AUTH` 或把阻断解释成应用成功。
5. 只运行离线 Projection、Target Profile、覆盖/并发与恢复测试。
6. 只有 capability 升级为 runtime apply 可用后，才验证 Settings → Desktop app → General
   下方独立 CC Theme tab；图标为原生容器中的 C。
7. 届时验证页面无保存按钮，修改立即预览并自动保存，重载/重启后仍保留。
8. 不修改 Claude.app、app.asar 或签名，不允许主题携带 CSS/JS/HTML/Shader/选择器。
9. 证据不得读取或保存聊天/渲染文字、输入值、accessible name、URL、链接或媒体来源。
10. 客户端指纹、官方授权 transport 或地标不满足时停止应用，不推测兼容。
