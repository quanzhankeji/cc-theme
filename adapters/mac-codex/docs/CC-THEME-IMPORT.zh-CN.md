# 导入外部 CC Theme 包

主题包由独立 CC Theme Theme Package/catalog 层创建和分发。Mac-CodeX 不提供生产
预设制作、库存或发布功能。

```bash
./scripts/apply-cc-theme-macos.sh --file /path/to/example.cctheme
```

只完成验证并更新活动快照、不立即启动 renderer：

```bash
./scripts/apply-cc-theme-macos.sh --file /path/to/example.cctheme --no-apply
```

导入流程会验证 ZIP 路径、条目、哈希、目标 Adapter、Schema、媒体和可选宠物，然后
原子替换当前活动快照。它不会把包复制为 Adapter 自己管理的可安装主题库存。

CC Theme Manager 也可以通过自己的已下载库存选择一个目标；Mac-CodeX 的固定入口仅
对 Manager 已选择的单个直接子目录重新 stage、验证并激活，不负责发现或下载。

失败时保留上一个有效主题或恢复原生 Codex，绝不静默改用另一套主题。
