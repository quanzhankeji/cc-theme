# 外部主题输入合同

Mac-CodeX 不拥有生产主题。它只接受 CC Theme Manager 输出的 `.cctheme`，或由 Manager
在 Runtime State 中明确选择的已编译 Codex 目标。唯一目标合同是 `skin.theme`。

## 允许内容

- 主题身份、语义颜色、字体角色、有限 appearance 与 accessibility 策略；
- 包内相对文件名引用的 PNG、JPEG、静态 WebP、H.264 MP4；
- 可选的 `pet/pet.json` 与 `pet/spritesheet.webp`；
- `media`、`ripple`、`directional` 三种互斥背景模式的白名单参数。

## 禁止内容

主题不得携带 CSS、JavaScript、HTML、Shader、选择器、命令、远程 URL、绝对路径、
路径穿越、符号链接或宿主版本事实。未知字段 fail closed。

## 资源验证

Adapter 验证签名、扩展名与真实格式一致性、尺寸、像素、文件大小、总大小、条目数、
SHA-256 和稳定读取。方向图集必须是静态 WebP；宠物必须是 Codex v2 的 RGBA
1536×2288、8×11 图集。视频必须是包内 MP4，并由 Reduced Motion 的静态 poster 策略
约束。

测试合同夹具仅位于 `tests/fixtures`，使用中性身份和合成字节，不可安装，也不进入发布。

## 失败语义

包验证、投影、Surface admission 或 renderer 验证失败时，不选择其他预设。Adapter
保留上一个有效快照；若无法安全保留，则完整清除自有节点并恢复宿主原生状态。
