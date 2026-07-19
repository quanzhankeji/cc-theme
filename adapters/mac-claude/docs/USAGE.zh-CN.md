# 使用说明

## 前置条件

- macOS 上安装官方 `/Applications/Claude.app`；
- 当前精确版本、签名与 ASAR 指纹在 Claude UI Surface Catalog 中验证通过；
- 本机可用 Node.js 20 或更高版本；
- 安装时 Claude 已完全退出。

当前官方客户端还要求 Anthropic 签名的 `CLAUDE_CDP_AUTH` 才允许远程调试。Mac-Claude
不会绕过该控制，所以自动应用仍不可用。除离线部署、投影、校验、导入外部 Theme Package 和测试恢复外，
当前还提供一条需要用户确认和手动 DevTools 动作的临时诊断预览；它不能跨 renderer 重载或
Claude 重启，也不会显示深度设置已正式可用。

## 安装

```bash
./scripts/install-skin-macos.sh --port 9451 --no-launchers --no-launch
node ./scripts/adapter-capability.mjs --validate
```

`doctor` 当前会以机器可读 `transport-unavailable` 失败，这是预期的安全阻断：

```bash
./scripts/doctor-macos.sh
```

## 由 Theme Manager 启动诊断预览

Manager 会先明确提示将重启 Claude 并打开官方 DevTools。用户确认后，Manager 调用 Mac-Claude
的 `diagnosticPreview.prepare`，再引导完成两步 Console 动作：复制固定 Adapter bootstrap、粘贴并
运行。页面出现当前已验证的外部主题且 Manager 收到 `diagnostic-preview-connected` 后，只能显示
“仅支持诊断预览 / 自动应用尚未开放”。

结束诊断时选择“恢复普通 Claude”。Manager 会停止本地 tokenized 服务并重启普通 Claude；
重启后主题、CC Theme 入口和全部自有 renderer 资源应消失。诊断过程中在 CC Theme 页完成的
白名单编辑会原子保存为本地覆盖，但不会让临时注入自动跨重启恢复。

## 应用内编辑

授权 Seam 验证通过后，打开 Settings，在 `Desktop app` 分组中选择 General 下方的独立 `CC Theme` tab。字母 C
入口与 General 同构，页面为 CC Theme 自有页面。

直接修改主题、颜色、字体、模糊、饱和度或遮罩值即可。renderer 会立即预览，磁盘在短
防抖后自动保存；页面没有保存按钮。快速连续输入只保留最后一次，失败会回滚并显示非阻塞
错误。关闭/重开设置、renderer 重载或 Claude 重启后会恢复最后成功值。

Manager 用另一个外部 Theme Package 替换活动快照时，Adapter 会先结算当前待写入状态，避免跨主题覆盖。

## 脚本

```bash
./scripts/apply-cc-theme-macos.sh --file /absolute/path/theme.cctheme --no-apply
./scripts/pause-skin-macos.sh --port 9451
./scripts/restore-skin-macos.sh --uninstall
```

预设制作、媒体加工、主题发现和 catalog 发布由独立 CC Theme 主题资源层负责；Mac-Claude
只验证外部输入并维护唯一活动快照与本地深度覆盖。

## 可访问性与恢复

CC Theme 不覆盖系统 Reduced Motion。键盘焦点、Tab/Shift-Tab、Enter/Space、原生方向键
行为和亮/暗模式跟随相邻原生设置条目。恢复会移除 CC Theme 自有页面、入口和所有运行资源，
但不会修改官方应用或其他设置 tab。
