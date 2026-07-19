# 导入 `.cctheme`

```bash
./scripts/apply-cc-theme-macos.sh --file /absolute/path/theme.cctheme --no-apply
```

导入器会：

1. 限制 ZIP 体积、条目数和解压后总量；
2. 拒绝绝对路径、路径穿越、控制字符、符号链接和清单外文件；
3. 流式核对每个条目的长度与 SHA-256；
4. 要求目标为 `claude + macos + mac-claude capability 1.0.0`，且 manifest 只能包含这一个规范 Adapter id；客户端版本字段和其他 id 直接拒绝；
5. 通过 `skin.theme` Schema、Style Catalog 以及图片/视频/图集验证；
6. 将结果原子替换为 Adapter 唯一活动主题快照；
7. 通过 Adapter 单一串行事务 Seam 处理 Manager 与本地编辑器写入；
8. 当前只原子导入和离线切换；`--no-apply` 不宣称 renderer 成功。官方授权 Seam可用后，
   才会结算待写入状态、应用并运行 renderer 地标与资源验证。

主题包只允许声明式白名单值与本地媒体。CSS、JavaScript、HTML、Shader、宿主选择器、远程
资源和官方应用修改均会被拒绝。导入不会采集 Claude 聊天、输入、URL 或账户内容。
