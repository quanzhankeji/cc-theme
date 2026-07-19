# CC Theme 主题契约

## 核心原则

Mac-Claude 只消费一份 `skin.theme`。主题描述“语义值与本地媒体”，不描述 Claude DOM。
客户端选择器、状态属性、挂载方式和样式解释全部属于版本化 UI Surface Catalog 与固定
Interpreter Adapter。

主题禁止包含 CSS、JavaScript、HTML、Shader、selector、远程 URL、绝对路径、可执行文件
或符号链接。包中没有宠物、宿主进程控制或客户端补丁能力。

## 最小主题

```json
{
  "kind": "skin.theme",
  "id": "my-theme",
  "name": "My Theme",
  "image": "background.png",
  "art": {
    "analysis": "off",
    "paletteMode": "system"
  },
  "appearance": {
    "shellMode": "auto",
    "backdropBlurPx": 18,
    "backdropSaturation": 1,
    "radiusScale": 1
  }
}
```

目录只包含实际引用的白名单文件：

```text
theme.json
background.png
background.mp4       # 可选，仅 media 模式
background-motion.gif # 可选，宿主拒绝视频 URL 时的受控动态降级
directions.webp      # 可选，仅 directional 模式
```

## 字段

- `kind`: 固定 `skin.theme`；
- `id`: 1–80 位字母、数字、下划线或连字符；
- `name`: 1–80 字符；
- `image`: 必需的本地 PNG/JPEG/静态 WebP basename；
- `homeHeroImage`: 仅为旧包向后读取字段；当前 Capability 判定为 unsupported，新 Projection 不生成；
- `backgroundVideo`: 可选本地 H.264 MP4，与交互背景互斥；
- `backgroundMotionFallback`: 可选本地 GIF basename；仅在同时声明 `backgroundVideo` 时有效，
  由 Adapter 在宿主媒体安全策略拒绝视频 URL 时使用并产生可见诊断；
- `colors` / `semanticColors`: 白名单颜色值；
- `fonts.ui/display/code`: 1–8 个安全本机字体名；
- `art`: 分析、焦点、安全区、任务模式和配色策略；
- `appearance`: 外观极性、媒体位置、模糊、饱和度、圆角尺度和视频遮罩；
- `interactiveBackground`: 固定引擎的 `ripple` 或 `directional` 参数。

颜色只允许 `#RRGGBB`、`rgb(...)` 或 `rgba(...)`。字体名不能变成 CSS 片段。数字字段
均受 Schema 和 Theme Style Catalog 双重范围限制。

## 背景模式

- `media`: 静态图或可选静音循环 MP4；Claude `1.22209.0` 的真实诊断 renderer 会拒绝
  Blob、loopback 和 data 视频 URL，因此当前以本地 GIF 近似保持运动；
- `ripple`: 固定引擎对顶层 `image` 运行 WebGL2 水波；
- `directional`: 固定引擎按指针方向选择静态 WebP 图集帧。

主题不能携带 renderer、Shader 或 Canvas 代码。Reduced Motion 时固定引擎暂停持续动画并
回退静态画面；主题无权覆盖系统偏好。

## Theme Style Catalog

设置页只提交 Catalog token，例如 `text.primary`、`font.ui`、
`effect.backdropBlur`。Catalog 定义类型、范围、语义 Surface Role 和固定 adapter binding。
所有值先验证，再即时预览并自动持久化。覆盖记录不改原始 `theme.json`，并绑定主题 id 与
规范化哈希。

## `.cctheme`

公开主题使用 lowercase `.cctheme` ZIP，MIME 为
`application/vnd.cc-theme.theme+zip`。当前包清单目标为能力契约，不携带精确客户端版本：

- client: `claude`；
- platform: `macos`；
- adapter id: `mac-claude`；
- capability version: `1.0.0`；
- Target Profile schema: `claude-target-profile.schema.json`；
- compiled theme: `targets/macos/theme.json`。

导入器限制条目、体积、路径、类型与 SHA-256，验证所有媒体后再原子切换。
主题包只声明 capability 版本，不携带 Claude 精确版本事实；manifest 只能包含规范
`mac-claude` Adapter id。客户端版本字段和其他 Adapter id 不做迁移读取，直接 fail closed。
精确版本、Surface Catalog 与 probe 结果只属于 Adapter capability/编译上下文。

## 三层数据与覆盖

- Shared Core：跨客户端稳定的身份、语义颜色、字体、有限 appearance、背景与无障碍策略；
- Target Profile：仅允许 `mac-claude` schema 声明的 Claude 字段；
- Local Runtime Overrides：只在 Claude 深度设置中编辑的稳定 Style Catalog token。

最终顺序为 Shared Core → Target Profile → Local Runtime Overrides → 运行时无障碍/宿主安全
降级。Manager 与本地编辑器通过同一个 Adapter 串行事务 Seam 写入。base hash 变化时，兼容值
校验后重放；不兼容值隔离并提示，不能静默清空、迁移或覆盖。

## 资源层所有权

主题制作、媒体加工、预览图和可安装包发布属于独立 CC Theme 主题资源层。Mac-Claude 只保留
外部包验证、Projection、Schema/normalizer、Catalog、Local Runtime Overrides 和生命周期
Implementation；Adapter 发布包不携带 Authoring、生产主题或主题媒体。
