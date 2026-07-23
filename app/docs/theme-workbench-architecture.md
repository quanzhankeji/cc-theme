# Theme Workbench：静态预览与公共主题编辑

## 产品边界

Theme Workbench 把“查看主题效果”和“从公共主题开始定制”放在同一个界面中，但两件事都
不能触碰正在运行的宿主，也不能原地改写公共主题包。

主题卡片中的眼睛入口直接打开工作台；它不会改变当前选择主题、各客户端记住的主题或任何
已注入主题。右侧的 Codex / WorkBuddy 目标切换只改变静态模拟预览，始终共享同一份草稿。

## 草稿模型

前端工作的唯一可变对象是派生草稿，而不是 `ThemeFamily`：

```ts
{
  kind: "cc-theme.theme-workbench-draft",
  revision: 1,
  base: { themeId },
  previewAdapterId: "mac-codex" | "mac-workbuddy",
  patch: {
    textColors: { lightText: "#RRGGBB", darkText: "#RRGGBB" },
    surfaceOpacity: 0.00..1.00,
    backgroundAsset: {
      source: "inherit" | "uploaded",
      mediaType: "image" | "video" | null,
      fileName?: string,
      mimeType?: string,
    },
  },
}
```

映射关系固定如下：

| 工作台字段 | Unified Theme 目标 | 说明 |
|---|---|---|
| 主要文字颜色 | `sharedCore.tokens.colors.text` | 有 complete appearance variants 时分别更新 light/dark 的 `colors.text`；没有 variants 的主题只拥有一个 Shared Core token，工作台会把同一个颜色写入两种预览，不能制造不一致的双外观值。 |
| 背景图片 / 视频 | `sharedCore.background` | 图片仅 PNG/JPEG/WebP，视频仅 MP4；视频仍必须有静态图片作为底图。 |
| 主内容背景透明度 | `presentation.parameters.surfaceOpacity` | 合法范围 0–1（0–100%）。它缩放主内容层及主题定义的 `mainScrimStart/Mid/End` 场景遮罩；0% 时工作台不再额外暗化或模糊背景。它不是 `background.scrimOpacity`，后者只属于背景遮罩。 |

草稿内的 `fileName` 和 MIME 仅是展示与保存意图，绝不是可被 Renderer 解释的路径。即时预览
使用浏览器的 Blob URL；Blob URL 不会被序列化、发送给宿主或写入主题库。

## 本地可编辑版本（已实现）

保存不是覆盖导入的 `.cctheme`，也不是只保留内存里的 UI 状态。Manager 为每个主题在自己的
Application Support 空间维护一个原子、可校验的本地编辑版本：

```text
themes/<theme-id>/                         # 导入后的只读基线；family.json 校验保持有效
theme-overrides/<theme-id>/
  override.json                            # 闭合元数据、基线 SHA-256、媒体摘要
  local-unified-theme.json                 # 由基线 + 受限草稿生成的完整有效主题源
  cc-theme-local-background.<ext>          # 可选：经 magic/大小/SHA 校验的本地背景副本
```

保存步骤是：验证导入包 → 验证草稿及媒体 → 从基线生成完整 `local-unified-theme.json` → 校验其
Shared Core / Presentation 合同 → 写入临时目录 → 原子替换本地编辑目录。失败会清理临时目录，
不会改动基线或先前有效的本地版本。

本地编辑版本绑定导入基线的 SHA-256；若基线发生变化，Manager 会拒绝静默 rebase。用户可以先
“恢复原始主题”，再对新基线重新编辑。恢复只删除 `theme-overrides/<theme-id>`，不删除导入主题、
不删除 Adapter、也不触碰已注入的运行时状态。

编译和随后应用主题时，Manager 只会使用这个已验证的本地完整主题源；没有本地编辑版本时才使用
导入基线。因此保存的属性会真正进入 Adapter 的 Projector/Normalizer 链路，而不是只影响预览。
目前本地版本只用于本机管理，尚未提供“导出为新的 `.cctheme`”功能；那会是独立的显式导出流程。

## 已实现的工作台

- 左侧可收起的手风琴抽屉，包含三项受限编辑；
- 右侧 Codex Desktop / WorkBuddy 静态模拟器，修改立即反映；
- “保存更改”只有草稿与已保存版本不同才可点击，保存成功后会回到禁用态；
- 有本地编辑版本时，显示“恢复原始主题”；它删除本地副本并回到导入基线；
- 主题卡片眼睛入口具备 tooltip、`aria-label`、禁用态和回归测试；
- 工作台不调用 `apply_theme`，不启动客户端。

## Adapter 责任

当前 UI 的两个预览均明确标为 static simulation，不能被理解为真实宿主截图或应用结果。
生产保真预览应由 Adapter 发布：输入只能是已校验的临时 `skin.theme` 与包内受控媒体 URL，输出
包括 preview fidelity / diagnostics。Manager 负责工作台、草稿和会话，不得硬编码宿主 DOM、
选择器、注入方式或版本判断。

真实预览入口应由所选 Adapter 的 preview capability 决定；不能从另一个客户端的映射或名称推断
支持情况。
