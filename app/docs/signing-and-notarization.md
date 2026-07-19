# macOS 签名与公证

CC Theme 使用独立的 `Developer ID Application` 身份签名。它通过内置白名单调用已批准的
Adapter Engine，不修改 ChatGPT / Codex 或 WorkBuddy 的 `.app`、`app.asar` 与代码签名。

签名只能证明发布者和包完整性，不能替代 Adapter 的 Capability、宿主签名校验、兼容证据、
apply gate 或失败回滚。未注册目标不会因为 Manager 已签名而获得扫描、启动或主题应用能力。

## 当前机器与发布状态

本机钥匙串可以识别以下身份：

- 开发调试：`Apple Development: heng xiao (QZ8GD5GA3N)`；
- 站外分发：`Developer ID Application: Chengdu Quanzhan Technology Co., Ltd (8UPRU238P7)`。

发布包已经内置固定 ARM64 Node 运行时；它是用户侧零外部依赖的一部分，不是以后再下载的组件。
构建产物仍须逐次完成 Developer ID 验证。Apple 公证只有在 Notary Service 返回 `Accepted` 且最终
分发包完成 stapling 后才算完成；仅有证书或 `codesign` 成功不能写成“已公证”。

迁移前曾生成并公证过一份 ARM64 DMG；它的源码布局、运行时资源和摘要均已被当前 Monorepo
工作区取代，只作为历史验收记录保存在 `docs/acceptance.md`，不能代表当前源码，也不能作为新的
下载或发布入口复用。

当前工作区状态为 `internal-local-rebuild / not-notarized / ARM64 / macOS 13.5+`。下一次正式分发
必须针对当前源码重新构建、签名、提交公证、staple、验证 Gatekeeper，并记录新的制品摘要和
Notary submission；在这些步骤全部完成前，不得把本地 `.app` 或任何旧 DMG 描述为正式发布包。

不要把私钥、App Store Connect API Key、issuer、密码或公证凭证提交进仓库。公证凭证应放在
本机钥匙串或 CI 的受保护秘密存储中。

## 发布流程

1. 锁定 Manager、Node、Rust、Tauri、Adapter Engine、Capability/Catalog 与 Theme Package 版本，
   执行合同、前端、Rust、真实 Adapter 和隐私回归测试；
2. 生成 release `.app`，确认内嵌 Node 的架构、上游签名和摘要与批准清单一致；
3. 用 Developer ID 和 Hardened Runtime 签名外层应用，不用递归重签覆盖内嵌 Node 的上游签名；
4. 用 `codesign --verify --deep --strict --verbose=2` 检查完整签名链，并用 `spctl --assess` 模拟
   Gatekeeper；
5. 生成只读 DMG 或 ZIP，提交 Apple Notary Service，等待状态为 `Accepted`；
6. 对最终分发包和适用的 `.app` 执行 stapling，再次运行 `stapler validate` 与 `spctl`；
7. 在没有开发环境、源码仓库和额外命令行工具的干净 Mac 上验证首次启动、客户端扫描、运行时
   编译、Codex/WorkBuddy 应用与恢复，以及关闭窗口/菜单栏打开与退出。

外层应用签名示例：

```bash
APP="CC Theme.app"
IDENTITY="Developer ID Application: Chengdu Quanzhan Technology Co., Ltd (8UPRU238P7)"

codesign --force --options runtime --timestamp --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute --verbose=4 "$APP"
```

推荐把公证凭证保存为钥匙串 profile，例如：

```bash
xcrun notarytool store-credentials "cc-theme-notary" \
  --key /secure/path/AuthKey_XXXXXXXXXX.p8 \
  --key-id XXXXXXXXXX \
  --issuer XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
```

提交和装订：

```bash
xcrun notarytool submit "CC Theme.dmg" \
  --keychain-profile "cc-theme-notary" --wait
xcrun stapler staple "CC Theme.dmg"
xcrun stapler validate "CC Theme.dmg"
```

## 权限边界

首版不申请相机、麦克风、通讯录、日历、位置等隐私权限。客户端探测只读取已批准位置的 bundle
元数据和 CC Theme 自己的 Application Support 状态；主题操作只能调用内置白名单中的固定
Adapter action。前端不能传入脚本路径、Shell 参数、任意启动参数或任意文件路径。

如果未来启用 App Sandbox，需要重新设计 Adapter Engine 的安装位置、进程启动与 Application
Support 访问授权。当前站外 Developer ID 分发采用 Hardened Runtime，但不启用 App Sandbox。
