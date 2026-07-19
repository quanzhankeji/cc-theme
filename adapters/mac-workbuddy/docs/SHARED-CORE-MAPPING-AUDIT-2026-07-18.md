# Mac-WorkBuddy Shared Core Mapping Audit

核验日期：2026-07-18  
范围：`mac-workbuddy`；核对并修复 CC Theme Unified Theme v2 / Shared Core 到 WorkBuddy Adapter 的 Projection、目标 Schema、Normalizer、UI Interpreter 与 Renderer 消费链。未修改 `mac-app` Shared Core Schema。

## A. 结论

**ACCEPT** 长期分层契约，无冲突条款。Shared Core 继续只拥有跨端稳定语义；WorkBuddy Adapter 独立拥有目标映射、版本证据、诊断、apply/restore Seam 与 fail-closed 决策。

当前 capability 共声明 67 个 Shared Core 字段决策：53 exact、5 approximate、9 optional unsupported；11 个 required 字段全部 exact，没有 required unsupported。历史高风险字段 `surfaceCode`、`borderStrong`、`selectedHoverSurface`、`success`、`warning`、`homeHeroImage` 已有显式决策和诊断，projector golden test 可证明不会被静默复制或丢弃。

后续 P0 已在 WorkBuddy Adapter 责任域闭环：`actionPressed` 连接到版本化可信按压 Surface，并由 Catalog→CSS 反向合同防止再次出现“声明 exact 但无消费者”；`shellMode` 下调为 unsupported，目标 Schema/Normalizer/authoring 只允许宿主权威的 `auto`；背景位置已实现 authority、legacy fallback、同值规范化与冲突 fail closed；`version` 的 capability target 已统一为实际 `sourceVersion`。没有发现目标 Schema 接受后被 Normalizer 整字段丢弃的 Shared Core 字段。

## B. 宿主与契约证据

### 当前真实宿主

- 应用：`/Applications/WorkBuddy.app`
- `CFBundleShortVersionString` / `CFBundleVersion`：`5.2.6`
- Bundle ID：`com.workbuddy.workbuddy`
- 架构：arm64；Electron `37.10.3`（版本证据来自 UI Surface Catalog）
- 签名：`Developer ID Application: Tencent Technology (Shanghai) Company Limited (FN2V63AD2J)`
- Hardened Runtime：启用；`codesign --verify --deep --strict` 通过；Apple notarization ticket 已 stapled
- P0 独立 QA 结束后的现场：官方 restore 为 `ok / restore-complete`；WorkBuddy 原生进程与窗口各 1 个，`127.0.0.1:9342` 关闭，源码版与旧 Manager injector 均为 0，状态目录与测试前备份一致，本地测试 override 为 0。

### 当前机器契约

| 契约 | Schema / Catalog version | 机器源 |
| --- | --- | --- |
| Adapter Capability | schema 1 / capability 1 | `contracts/adapter-capability.json` |
| Target Profile | schema 1 | `contracts/target-profile.schema.json` |
| target `skin.theme` | unnumbered strict contract / JSON Schema 2020-12 | `contracts/skin-theme.schema.json`、`scripts/skin-theme.mjs` |
| Theme Style Catalog | schema 1 / catalog 1 | `contracts/theme-style-catalog.json` |
| UI Surface Catalog | schema 2 / catalog 2 / Interpreter 2 | `compatibility/workbuddy-macos/5.2.6/ui-surface-catalog.json` |
| Runtime Settings | schema 2 | `contracts/theme-runtime-settings.schema.json` |
| Settings Locale Catalog | schema 2 / catalog 2 | `contracts/theme-settings-locales.json` |

UI Surface Catalog 于 2026-07-18 采集：55 个 visual states、65 个 computed-style snapshots、98 个 runtime roles、15 类 surfaces；原始隐私截图不入库。Capability 使用 `verified-only`，只允许 WorkBuddy `5.2.6`，要求 runtime probe；版本或 Surface Catalog 不匹配时 apply code 为 `client-version-unsupported`。

### 证据缩写

- `CAP`：`contracts/adapter-capability.json`
- `PROJ`：`scripts/workbuddy-theme-projection.mjs`
- `SCH/NORM`：`contracts/skin-theme.schema.json` + `scripts/skin-theme.mjs`
- `STYLE/SURF`：`contracts/theme-style-catalog.json` + `compatibility/workbuddy-macos/5.2.6/ui-surface-catalog.json`
- `RUN`：`assets/renderer-inject.js` + `assets/skin.css` + `assets/background-effects.js`
- `T-PROJ`：`tests/workbuddy-theme-projection.test.mjs`
- `T-CONTRACT`：`tests/adapter-capability.test.mjs`、`tests/theme.test.mjs`、`tests/theme-style-catalog.test.mjs`、`tests/ui-interpreter-runtime.test.mjs`、`tests/surface-role-contract.test.mjs`
- `T-BG`：`tests/interactive-background*.test.mjs`、`tests/background-effects-runtime.test.mjs`、`tests/video-media.test.mjs`
- `LIVE`：Manager 新包真实 WorkBuddy 复验闭环（Apply/launch、Settings、locale、CPU、pause/reapply/restore）

## C. Shared Core 全 token 映射矩阵

“用途”列是 Adapter 当前承诺的 WorkBuddy Surface Role 或运行职责。

| token path | R/O | 决策 | target skin.theme / runtime path | Surface Role / 真实用途 | 证据 | diagnostic code | 自动 / 真实测试 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | R | exact | `id` | theme identity、Settings/current theme、runtime state | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `name` | R | exact | `name` | Settings 当前主题名称 | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `version` | R | exact | `sourceVersion` | projection source metadata；capability 与实际结果路径一致 | CAP/PROJ | `mapped-exact` | T-PROJ/T-CONTRACT |
| `tokens.colors.surfaceBase` | R | exact | `semanticColors.surfaceBase` | `main-content`、`settings-content` base surface | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.colors.surfaceRaised` | O | exact | `semanticColors.surfaceRaised` | `artifact-card`、settings/card raised surface | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.colors.surfaceElevated` | O | exact | `semanticColors.surfaceElevated` | popover、settings modal elevated surface | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.colors.surfaceCode` | O | approximate | `semanticColors.surfaceRaised` | 无独立 code surface；仅在 `surfaceRaised` 缺失时复用 raised | CAP/PROJ/SCH/NORM/STYLE/RUN | `approximated-surface-code` | T-PROJ golden |
| `tokens.colors.text` | R | exact | `colors.text` | main/sidebar 普通标题与正文 | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.colors.textStrong` | O | exact | `semanticColors.textStrong` | `home-heading`、Settings 一级强调/主标题 | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.colors.textMuted` | R | exact | `colors.muted` | main 次级文本；亦为若干缺省 secondary/icon 值的基底 | CAP/PROJ/SCH/NORM/STYLE/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.colors.placeholder` | O | exact | `semanticColors.placeholder` | `composer-input` placeholder | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-CONTRACT/LIVE |
| `tokens.colors.borderSubtle` | O | exact | `semanticColors.borderSubtle` | main/settings 弱边框、divider-like edges | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-CONTRACT/LIVE |
| `tokens.colors.borderDefault` | O | exact | `semanticColors.borderDefault` | main/settings 默认边框 | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.colors.borderStrong` | O | approximate | `semanticColors.borderDefault` | 无独立 strong 通道；仅在 default 缺失时复用 default | CAP/PROJ/SCH/NORM/STYLE/RUN | `approximated-border-strong` | T-PROJ golden |
| `tokens.colors.action` | R | exact | `semanticColors.action` | composer/settings 主动作、active pill | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.colors.actionHover` | O | exact | `semanticColors.actionHover` | 主动作 hover | CAP/PROJ/SCH/NORM/STYLE/RUN | `mapped-exact` | T-CONTRACT/LIVE |
| `tokens.colors.actionPressed` | O | exact | `semanticColors.actionPressed` | `scene-tab` 与 `account-plan-action` 的可信 `:active` paint；system/disabled 保留宿主原生 | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-CONTRACT Catalog→consumer 反向合同 |
| `tokens.colors.actionForeground` | R | exact | `semanticColors.actionForeground` | 主动作前景文字/图标 | CAP/PROJ/SCH/NORM/STYLE/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.colors.hoverSurface` | O | exact | `semanticColors.hoverSurface` | sidebar/settings nav、quick action hover | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-CONTRACT/LIVE |
| `tokens.colors.pressedSurface` | O | exact | `semanticColors.pressedSurface` | sidebar/settings nav、video/quick action pressed | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-CONTRACT/LIVE |
| `tokens.colors.selectedSurface` | O | exact | `semanticColors.selectedSurface` | sidebar/settings selected/current | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.colors.selectedHoverSurface` | O | approximate | `semanticColors.selectedSurface` | 无独立 selected-hover；仅在 selected 缺失时复用 selected | CAP/PROJ/SCH/NORM/STYLE/RUN | `approximated-selected-hover` | T-PROJ golden |
| `tokens.colors.focusRing` | R | exact | `semanticColors.focusRing` | composer、Settings、button focus-visible | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.colors.link` | O | exact | `semanticColors.link` | main content links | CAP/PROJ/SCH/NORM/STYLE/RUN | `mapped-exact` | T-CONTRACT/LIVE |
| `tokens.colors.danger` | O | exact | `semanticColors.danger` | account/settings destructive actions | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-CONTRACT/LIVE |
| `tokens.colors.success` | O | unsupported | — | WorkBuddy Adapter 无稳定 success surface token | CAP/PROJ | `optional-field-unsupported` | T-PROJ golden |
| `tokens.colors.warning` | O | unsupported | — | WorkBuddy Adapter 无稳定 warning surface token | CAP/PROJ | `optional-field-unsupported` | T-PROJ golden |
| `tokens.colors.sidebarSurface` | O | exact | `semanticColors.sidebarSurface` | `sidebar` surface | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-CONTRACT/LIVE |
| `tokens.colors.headerSurface` | O | exact | `semanticColors.headerSurface` | `topbar` surface | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-CONTRACT/LIVE |
| `tokens.colors.mainScrimStart` | O | exact | `semanticColors.mainScrimStart` | main background top scrim | CAP/PROJ/SCH/NORM/STYLE/RUN | `mapped-exact` | T-CONTRACT/LIVE |
| `tokens.colors.mainScrimMid` | O | exact | `semanticColors.mainScrimMid` | main background middle scrim | CAP/PROJ/SCH/NORM/STYLE/RUN | `mapped-exact` | T-CONTRACT/LIVE |
| `tokens.colors.mainScrimEnd` | O | exact | `semanticColors.mainScrimEnd` | main background bottom scrim | CAP/PROJ/SCH/NORM/STYLE/RUN | `mapped-exact` | T-CONTRACT/LIVE |
| `tokens.colors.composerSurface` | O | exact | `semanticColors.composerSurface` | composer surface | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-CONTRACT/LIVE |
| `tokens.fonts.ui` | O | exact | `fonts.ui` | shell 普通 UI 字体 | CAP/PROJ/SCH/NORM/STYLE/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.fonts.display` | O | exact | `fonts.display` | `home-heading` display/主标题字体 | CAP/PROJ/SCH/NORM/STYLE/SURF/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.fonts.code` | O | exact | `fonts.code` | main markdown/code/pre | CAP/PROJ/SCH/NORM/STYLE/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.appearance.shellMode` | O | unsupported | — | WorkBuddy effective light/dark 是唯一 authority；目标 authoring 仅允许 `auto` | CAP/PROJ/SCH/NORM | `host-shell-mode-authority` | T-PROJ/T-CONTRACT |
| `tokens.appearance.backdropBlurPx` | O | exact | `appearance.backdropBlurPx` | shell/cards/composer backdrop blur | CAP/PROJ/SCH/NORM/STYLE/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.appearance.backdropSaturation` | O | exact | `appearance.backdropSaturation` | shell/cards/composer saturation | CAP/PROJ/SCH/NORM/STYLE/RUN | `mapped-exact` | T-CONTRACT/LIVE |
| `tokens.appearance.radiusScale` | O | exact | `appearance.radiusScale` | paint-layer radius scaling；不改变宿主尺寸 | CAP/PROJ/SCH/NORM/STYLE/RUN | `mapped-exact` | T-PROJ/T-CONTRACT/LIVE |
| `tokens.appearance.backgroundPosition` | O | approximate | `appearance.backgroundPosition` | 历史兼容入口；仅权威字段缺失时 fallback；冲突拒绝 | CAP/PROJ/SCH/NORM/STYLE/RUN | `legacy-background-position-fallback` | T-PROJ 三态合同 |
| `tokens.appearance.homeHeroPosition` | O | unsupported | — | WorkBuddy 不实现独立 Hero | CAP/PROJ | `home-hero-unsupported` | T-PROJ |
| `background.image` | R | exact | `image` | Adapter-owned background `<img>` / poster / static fallback | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-PROJ/T-BG/LIVE |
| `background.video` | O | exact | `backgroundVideo` | 本地回环 MP4 background layer | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-PROJ/T-BG/LIVE |
| `background.posterMode` | O | exact | `appearance.backgroundVideoPosterMode` | video poster image/none；Target Profile 同名值按显式层级优先 | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-PROJ/T-BG/LIVE |
| `background.position` | O | exact | `appearance.backgroundPosition` + video fallback | v2 权威媒体位置；同值规范化，冲突在投影前 fail closed | CAP/PROJ/SCH/NORM/STYLE/RUN | `mapped-exact` / conflict `conflicting-background-position` | T-PROJ/T-BG 三态合同 |
| `background.homeHeroImage` | O | unsupported | — | WorkBuddy 不实现 Hero media | CAP/PROJ | `home-hero-unsupported` | T-PROJ golden |
| `background.scrimOpacity` | O | exact | media `appearance.backgroundScrimOpacity`; interactive `interactiveBackground.scrimOpacity` | shell scrim / Canvas effect scrim | CAP/PROJ/SCH/NORM/STYLE/RUN | `mapped-exact` | T-PROJ/T-BG/LIVE |
| `background.mode.media` | O | exact | derived `backgroundRenderMode=media` | img/video fixed background engine | CAP/PROJ/NORM/RUN | `mapped-exact` | T-PROJ/T-BG/LIVE |
| `background.mode.ripple` | O | exact | `interactiveBackground` | click-through ripple Canvas | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-BG/LIVE |
| `background.ripple.intensity` | O | exact | `interactiveBackground.intensity` | ripple amplitude | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-BG |
| `background.ripple.radiusPx` | O | exact | `interactiveBackground.radiusPx` | ripple radius | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-BG |
| `background.ripple.quality` | O | exact | `interactiveBackground.quality` | bounded Canvas quality | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-BG |
| `background.mode.directional` | O | exact | `interactiveBackground` | click-through directional Canvas | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-BG/LIVE |
| `background.directional.atlas` | O | exact | `interactiveBackground.atlas` | local static WebP atlas | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-BG |
| `background.directional.directions` | O | exact | `interactiveBackground.directions` | direction count 8/16/32 | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-BG |
| `background.directional.columns` | O | exact | `interactiveBackground.columns` | atlas grid columns | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-BG |
| `background.directional.rows` | O | exact | `interactiveBackground.rows` | atlas grid rows；columns×rows=directions | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-BG |
| `background.directional.firstDirectionDegrees` | O | exact | `interactiveBackground.firstDirectionDegrees` | atlas direction origin angle | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-BG |
| `background.directional.idleFrame` | O | exact | `interactiveBackground.idleFrame` | static/reduced-motion/error fallback frame | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-BG |
| `background.directional.origin` | O | exact | `interactiveBackground.origin` | direction calculation origin | CAP/PROJ/SCH/NORM/RUN | `mapped-exact` | T-BG |
| `accessibility.reducedMotion` | R | exact | runtime `forceStatic` / `prefers-reduced-motion` safety | video pause、ripple/directional static fallback、RAF stop | CAP/PROJ/RUN | `runtime-safety-applied` | T-PROJ/T-BG/T-CONTRACT/LIVE |
| `accessibility.minimumTextContrast` | O | unsupported | — | Adapter 无自动 contrast auditor | CAP/PROJ | `contrast-audit-unavailable` | T-PROJ |
| `accessibility.minimumLargeTextContrast` | O | unsupported | — | Adapter 无自动 large-text contrast auditor | CAP/PROJ | `contrast-audit-unavailable` | T-PROJ |
| `accessibility.preserveSystemFocusRing` | O | approximate | `semanticColors.focusRing` / host focus | system 保留宿主；adaptive/custom 使用 semantic focus ring | CAP/PROJ/STYLE/RUN | `focus-ring-strategy-approximate` | T-PROJ/T-CONTRACT/LIVE |
| `accessibility.transparencyFallback` | O | unsupported | — | 当前无宿主 Reduce Transparency authority | CAP/PROJ | `transparency-preference-unavailable` | T-PROJ |
| `copy.*` | O | unsupported | — | WorkBuddy 不用 Shared Core 改写宿主 copy | CAP/PROJ | `copy-surface-unsupported` | T-PROJ |

## D. Projector → Schema → Normalizer → Renderer 一致性

### 已确认闭环

1. Projector 对 Unified v2 root、tokens、background、accessibility 和 Target Profile 都执行 exact-key 白名单；远程 URL、路径、选择器和未知字段 fail closed。
2. `skin-theme.schema.json` 的 top-level、`colors`、`semanticColors`、`fonts`、`appearance` 均为 `additionalProperties: false`；`normalizeSkinTheme` 再次用同一组固定 key 集拒绝未知字段。
3. `loadTheme()` 使用 `normalizeSkinTheme()` 的返回值构建 renderer payload，因此不是“只做验证后仍把原对象传入”。
4. `surfaceCode`、`borderStrong`、`selectedHoverSurface` 仅在精确目标缺失时写入近似目标；精确字段存在时保持精确值并输出“近似字段被更精确值省略”的 warning。
5. `success`、`warning`、Hero、contrast、transparency 与 copy 均不进入目标 theme，并输出可见 diagnostics。
6. Target Schema 与 Normalizer 不接受 `success`、`warning`、Hero、任意 CSS/JS/selector 等未实现通道，避免“Schema 通过但 runtime 静默忽略”重新出现。

### P0 修复后的闭环

- **D1 actionPressed**：Style Catalog 将该 token 限定到 `scene-tab` 与 `account-plan-action`；Surface Catalog v2 提供 `.wb-scene-tabs__pill--active`、`.plan-action-btn` 的版本证据。adaptive/custom 消费 Shared Core actionPressed；system/disabled 全部保留宿主原生。独立真实验收曾捕获 scene tab 缺少 system 门控，现已加入双重 selector 门禁；反向合同同时要求所有 exact Shared Core paint binding 必须存在 CSS 或显式 host consumer。
- **D2 shellMode**：capability 改为 unsupported 并输出 `host-shell-mode-authority`。Projector 不再投影该字段；目标 Schema/Normalizer 只接受 `auto`，palette authoring 对 system/adaptive/custom 均写入 `auto`，避免保留无效果的 light/dark 路径。
- **D3 background position**：仅 authority、仅 legacy、两者同值、两者冲突四态均有合同；legacy fallback 与同值 compatibility 输出 `legacy-background-position-fallback`，冲突抛出 code=`conflicting-background-position`。2026-07-19 起 Target Profile 不再接受 `backgroundVideoPosition`；图像、视频、poster、Reduced Motion 静态 fallback 与互动背景只消费 `appearance.backgroundPosition`。
- **D4 version path**：capability target 和 projector result 统一为顶层 `sourceVersion`，并由一致性测试锁定。

## E. 关键视觉语义验收

- **textStrong/display**：`textStrong` → `--wbs-text-strong`，用于 home heading 与 Settings 一级强调；`fonts.display` → `--wbs-font-display`，用于 home heading。adaptive/custom 为 exact；system 下颜色使用宿主基底，Shared Core 颜色作为 dormant intent。
- **text/ui**：`text` → main/sidebar `--wbs-text`；`fonts.ui` → shell `--wbs-font-ui`。普通标题与正文已消费。
- **textMuted/ui**：`textMuted` → main 次级文本 `--wbs-muted`，并作为若干未单列 secondary/icon token 的 Normalizer fallback。
- **selected/hover/pressed/focus/action/link**：selected、hover、pressed、focus、action、actionForeground、link 均有 Style binding 与 CSS consumer；actionHover/actionPressed 均有版本化受控消费者。
- **border subtle/default/strong**：subtle/default exact；strong 无独立 WorkBuddy 通道，缺省时 approximate 到 default，并输出 `approximated-border-strong`。
- **surface base/raised/elevated**：分别用于 main/settings、artifact/card、popover/modal。sidebar/header/composer 和三段 main scrim 均有独立 exact 通道。
- **背景/scrim**：media、ripple、directional 互斥；Canvas 点击穿透；scrim、位置、poster 和 Reduced Motion 有固定引擎消费。禁用背景时弹窗恢复宿主原生样式。
- **danger/success/warning**：danger exact 并用于 account/settings destructive surface；success/warning optional unsupported，有 warning diagnostics，不进入目标 schema。
- **字体**：只支持 UI/display/code family roles；不把字体尺寸、字重或宿主几何塞进 Shared Core。Settings 本地 override 仍经 allowlist。
- **accessibility**：Reduced Motion exact；focus preservation approximate；两类 contrast threshold 与 transparency fallback 显式 unsupported。system palette 保持原生 overlay 和 focus 行为。

### paletteStrategy 语义

- **system**：Target Profile 选择 exact；WorkBuddy 原生 light/dark colors 是视觉基底。Shared Core colors 仍被完整验证和投影，但在 renderer 中保持 dormant，输出 `system-shared-colors-dormant`。字体、媒体位置、blur/saturation/radius 等非颜色 allowlist 设置仍可生效；颜色 Local Overrides 保留但在 system 下不激活。
- **adaptive**：Target Profile 选择 exact；Shared Core colors 作为 active custom palette 基底，Target Profile 调整策略，本地 allowlisted colors 最后覆盖。Standalone WorkBuddy 不执行媒体分析，输出 `adaptive-shared-core-base`，并声明 `adaptiveAuthoringAvailable=false`、`adaptiveRuntimeAvailable=true`；由可信上游提供自适应 Shared Core 时可运行。
- **custom**：Target Profile 选择 exact；Shared Core colors 是初始 active palette，本地细粒度颜色最后覆盖。与 adaptive 的 renderer paint path 相同，区别属于上游产生语义与诊断，不伪装为运行期图像分析。
- 三种策略最终都受 Reduced Motion 和宿主安全降级覆盖。当前颜色 precedence 为 Shared Core → Target Profile strategy → Local Runtime Override → runtime accessibility/host safety。

## F. 宿主升级、证据失效与 fail closed

### 触发器

- WorkBuddy bundle version、Bundle ID、Team Identifier、Electron 主 renderer identity 或 body dataset 变化。
- required selectors、Settings mount、video toggle anchor、最低 role/cardinality 或 computed-style evidence 不再成立。
- UI Surface Catalog schema/catalog/Interpreter version 与 capability 不一致。
- 原生 CSS variable、surface layering、portal/modal 行为或 locale authority 改变。
- apply/verify 出现 `adapter-landmark-failure`、`visual-verification-failure`、`client-version-unsupported` 或清理残留。
- Projector 收到冲突的权威/legacy background position 时，在进入目标 Schema 前以 `conflicting-background-position` fail closed。

### fail-closed

- Capability 只列 `5.2.6`；新版本不在 verified list 时 projector `applyAllowed=false`。
- runtime probe required；client version 与 Surface Catalog v2 不同时 `client-version-unsupported`。
- renderer 同时核对 body identity、required selectors 和 `productVersion`，不匹配则不安装。
- 缺少稳定 landmark 时停止，不回退到 DOM 文本、accessible name、用户内容或主题内 selector。
- 新 WorkBuddy 版本必须新增独立 `compatibility/workbuddy-macos/<version>/`，不得静默扩宽旧 Catalog。

Owner：Mac-WorkBuddy Adapter owner。维护流程位于 `skills/repair-workbuddy-compatibility/SKILL.md`；机器事实位于版本化 UI Surface Catalog；固定解释器位于 `assets/ui-interpreter.js`；分类/架构位于 `docs/ARCHITECTURE.md`、`docs/UI-SURFACE-CATALOG.md`。

## G. 自动化与真实客户端结果

### 本次自动化

- `npm test`：PASS（P0 修复后全量）。
- `node scripts/injector.mjs --check-payload`：PASS；`payload-valid`、98 runtime roles、93 style bindings、2 settings locales；revision 仅为 renderer session generation。
- Capability/catalog version consistency、Target Profile unknown field、strict schema/normalizer、projection determinism、historical risky token diagnostics、禁止远程/selector/可执行载荷：PASS。
- Style role linkage、Catalog→consumer 反向合同、UI Interpreter apply/restore、background position 四态、background runtime/资源释放、Reduced Motion、locale、WYSIWYG/LWW/rollback、revision scope、pause/restore result semantics：PASS。

### P0 独立真实 QA

- 独立验收 Agent 未修改源码或测试；focused、完整 `npm test`、payload preflight、禁止载荷和独立发布/Skill 依赖均 PASS。
- 背景位置：仅 authority 无 fallback diagnostic；仅 legacy 与同值 legacy 均输出 `legacy-background-position-fallback`；冲突以 `conflicting-background-position` fail closed；Target Profile 视频位置未改变图片权威位置。
- `sourceVersion` 的 capability/result 路径一致；Shared Core `shellMode` 从目标投影省略并输出 `host-shell-mode-authority`，真实宿主 dark/light 仍决定 `nativeShellMode`。
- scene-tab 持续按压 500ms：custom/adaptive 消费 `--wbs-action-pressed`；system/background-disabled 保持原生。验收先发现 system selector 缺口，修复双重门控并重新跑完整矩阵后 PASS。
- 真实 apply=`apply-active`、verify=`verify-ok`；zh-CN/en-US 全页切换 PASS；英文失败 rollback 后 UI、内存与已提交状态一致；pause、reapply、restore 与 owned 节点/角色/样式/背景/根标记/重复 ID 清理均 PASS。
- 60 秒稳定性：system idle 主进程 0.2% avg / 0.6% max、renderer 1.6% / 2.4%；custom home 0.9% / 3.0%、renderer 2.8% / 5.7%；英文 Settings 0.2% / 0.6%、renderer 3.5% / 7.1%。无持续单核高占用，MutationObserver 未造成 owned、roles、revision、generation 或 duplicate ID 波动。
- QA 不采集用户文字、URL、输入值、accessible name 或截图；最终现场已恢复为原生 WorkBuddy，9342 与 injector 清零。

### 已闭环真实新包 QA

- Manager 包内 WorkBuddy 关键文件与当前源 SHA-256 全部匹配；renderer SHA-256：`f295c3a7e17c946ca7506e72a046d9e8b996e2ac1ae2f98af27af95f8a3018b3`。
- Manager Apply + launch：PASS；Settings 开闭 5 次、原生/CC 协调 10 次无节点增长。
- zh-CN/en-US 多次切换：CC Theme 全页跟随；幂等 text/aria 守卫有效。
- CC-active 20 秒 renderer CPU：1.71% avg / 5.10% max；结构、revision、67 active role counts 稳定。
- pause 清除 owned nav/panel；reapply PASS；restore 在 30 秒内成功，launch agent/state/pid/9342/bundled Node 清零，WorkBuddy 原生模式运行。
- 之前独立 QA 的失败写入 rollback、background 三态、Reduced Motion 和完整 cleanup 也已 PASS。

真实边界：上述 P0 真实 QA 验证的是当前 `mac-workbuddy` 源码注入路径，不等于 Manager 已同步的新制品。Manager 尚未对本轮语义修复完成包内 SHA-256 与真实复验，且尚未 notarize/DMG；因此不能据此宣称发布制品已经解禁或正式发布完成。

## H. 剩余 blocker、approximation 与未验证项

### 门禁状态

本端四项语义 blocker 已完成源码修复、全量自动化与独立真实 QA，状态为 `source-fixed / independent-qa-passed / manager-revalidation-pending`。Manager 必须同步这些 WorkBuddy Adapter 文件并完成包内 SHA-256、compile/preflight 与真实客户端复验后，才能解除跨产品 `semantic-contract-blocked` 门禁；本端结果不能替代 Manager 的发布制品验收。

### 已接受 approximation

- `surfaceCode` → `surfaceRaised`（仅 exact raised 缺失时）。
- `borderStrong` → `borderDefault`（仅 exact default 缺失时）。
- `selectedHoverSurface` → `selectedSurface`（仅 exact selected 缺失时）。
- `preserveSystemFocusRing`：system 原生，adaptive/custom 使用 semantic focus ring。

### 显式 unsupported

- shellMode（宿主模式为唯一 authority）、success、warning、homeHeroImage/homeHeroPosition、minimum text/large text contrast enforcement、transparencyFallback、Shared Core copy。

### 未完成产品边界

- stable-token/base-hash production entries、override rebase/quarantine、跨进程单一事务 Seam 尚未完成端到端生产验收。
- Manager notarize/DMG 未完成。
- 本报告不覆盖 Claude；其 `runtimeApply=false` 与 WorkBuddy mapping 无关。

## 后续动作

1. 向 Manager 提交本端文件清单、矩阵差异、诊断向量、全量结果和真实边界。
2. Manager 以制品逐文件 SHA-256 与自身 session revision 重新验收；旧制品不得因源码测试通过而自动解禁。
