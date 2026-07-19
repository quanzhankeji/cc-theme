# 安全边界

## 适配器会做什么

- 只连接 `127.0.0.1` 上由 WorkBuddy 进程树持有的 CDP 端口。
- 校验 bundle id `com.workbuddy.workbuddy`、签名团队 `FN2V63AD2J` 和完整代码签名。
- 只接受本地 `skin.theme`、适配器自带 CSS、固定 renderer/Canvas 引擎及本地媒体。
- 强制 `backgroundVideo` 与 `interactiveBackground` 互斥；方向背景只接受同目录静态 WebP，方向数仅 8/16/32，网格必须精确匹配。
- 对方向图集执行 32 MiB、32MP、16384px 单边上限和 RIFF/WebP 静态容器检查，再以有界 CDP 分块创建 renderer-local Blob。
- 早期载荷只预注册到版本化 Catalog 记录的 WorkBuddy 本地 renderer 路径；任何已填充但冲突的宿主身份都会拒绝。角色协调和最终成功仍要求严格 DOM Surface 探测。
- 启动顺序固定为停止旧 watcher、启动唯一媒体 watcher、再启动/接入 WorkBuddy；视频首代与长期监控属于同一 generation。可见视频只有达到 ready + playing 且前台交接确认后才算启动成功。
- 所有创建的 DOM 都有 owner 标记，可被 `pause`/`restore` 清理。
- Settings 自动保存绑定使用独立 renderer-generation nonce、当前主题 ID 和单调写入 revision；只接收完整的 Catalog 白名单状态。每主题设置以 `0700` 目录、`0600` 文件和临时文件 fsync + rename 原子持久化。
- Renderer `revision` 把当前内容与 renderer session nonce 组合成进程/会话作用域 generation，用于幂等安装、热替换和阻止旧 generation 复用；它不是确定性源码或制品摘要。确定性发布溯源只使用文件清单、包内文件或归档 SHA-256。
- Manager apply 与 Settings 自动保存共用按主题跨进程锁；base hash 改变后拒绝旧 renderer 的迟到写入。兼容覆盖按稳定 token 和控件指纹重验，不兼容值只保留 token、原因和 value SHA-256 隔离记录，不把原始值或未知字段送入 renderer。
- 外部 `.cctheme` 只能由 Manager 或显式本地命令进入；每次都执行目标应用/版本、清单、哈希、路径、媒体和 staging 校验。renderer 不提交或解析本地文件路径。
- Adapter 发布由机器可读 allowlist 组装并二次扫描；拒绝生产主题目录、主题文档、可安装主题包、图片和视频。测试夹具不进入发布。
- Adapter 制品由 `adapterId + adapterVersion + adapterReleaseRevision + OS + arch` 唯一标识。首次正式发布前，清单显式标记的未发布开发 revision 可以原位原子重建且旧摘要立即失效；首次发布后，同一 revision 拒绝覆盖。精确宿主 build 不进入公开版本号。
- Live Surface Evidence 只输出稳定属性、语义角色/类、父子结构、计数、几何、交互状态和必要计算样式；不输出页面文字、输入值、accessible name、窗口标题、URL/query/hash、链接或媒体来源。

## UI 解释边界

WorkBuddy 的页面选择器、挂载关系和宿主展示类名只能来自通过校验的 Version Adapter；
`renderer-inject.js` 不保存翻译选择器或版本类名。固定 UI Interpreter 只应用
Style Catalog 中声明的 CSS 变量，保留修改前的值并在暂停时恢复。Style Catalog 固定
`geometryPolicy: native`，拒绝 URL、分号、规则块和未知角色，不能通过主题包扩展。

Locale Catalog 只进入自有 CC-Theme 设置节点的 `textContent`、`title` 和 ARIA 文案，
不参与 `querySelector`、路径解析或后端动作。Host Locale Runtime 只读取 Version Adapter 声明的
宿主 locale storage/attribute 状态，不读取 macOS、`navigator.language`、DOM 文案、输入值或用户内容；
未知值只输出有界诊断码。动态占位符在每种语言中由契约校验。

CC Theme 导航条目的原生相邻项只作为计算后的展示与行为参考。自有节点保持独立 ownership、
不复制 ID 或事件处理器、不修改相邻原生节点，并在 pause/restore/uninstall 时完整删除。

## 适配器不会做什么

- 不修改或重签名 `WorkBuddy.app`。
- 不解包、覆盖或绕过 `app.asar` 完整性。
- 不注入远程 JavaScript，不读取网络主题，不执行主题内代码。
- 不接受主题提供的脚本、CSS、HTML、Shader、远程 URL、绝对路径、路径穿越、符号链接或动画 WebP。
- 不接受目标 `skin.theme` 中未声明的颜色、语义色、字体或 appearance 字段；Unified Theme 的近似与不支持字段必须在投影结果中显式诊断。
- 不读取、迁移或导出 WorkBuddy 登录凭证与 Cookie。
- 可选 MP4 只通过随机回环端口和不可预测路径提供；不监听局域网地址，不提供主题目录中的其他文件。直接媒体源被 WorkBuddy 拒绝时，只允许同一 generation 对该已验证端点执行有界 fetch→Blob 回退，并复核 MIME、长度和最终 Blob；失败立即回到静态图。
- 不穿透第三方 webview/iframe。
- 不让 Canvas 接收点击，也不改动 Sidebar、聊天区、Side/Bottom Panel 或原生控件的尺寸。
- 不保存、发现、内置、发布或管理生产预制主题及其媒体；没有有效外部输入时恢复宿主原生状态。

## CDP 风险

CDP 能控制渲染页，因此只应在本机回环地址短期使用。`restore-skin-macos.sh` 会移除注入并正常重启 WorkBuddy，从而关闭调试端口。不要把端口代理到局域网或公网，也不要禁用端口所有权校验。

WorkBuddy 更新后，签名团队、bundle 结构或 DOM 可能变化。适配器会优先失败关闭；先运行 `doctor-macos.sh`，确认兼容性后再启动。
