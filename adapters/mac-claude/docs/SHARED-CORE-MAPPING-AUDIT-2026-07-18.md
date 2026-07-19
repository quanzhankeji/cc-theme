# Mac-Claude Shared Core A–H 只读审计

核验日期：2026-07-18。审计对象是当前共享工作区中的机器可读契约与真实本机证据；没有修改
`app` Manager Module 或 `app/packages/contracts` Shared Core Schema，也没有把手动
DevTools 诊断视作生产 Runtime Seam。

## A. 结论

**ACCEPT** Unified Theme v2 / Shared Core 与 Adapter 所有权共识。当前 Mac-Claude 实现仍有
必须在本端修复后才能解除的 contract blocker：Capability wildcard、若干无真实 CSS consumer
的静默 token、`homeHeroPosition` 静默遗漏，以及 background position 权威/兼容优先级错误。
因此继续保持 `projection-only`、`runtimeApplyAvailable=false`、`managerApplyAllowed=false`。

## B. 宿主、Capability 与 Catalog

| 项目 | 当前证据 |
|---|---|
| Claude | `1.22209.0` / build `1.22209.0` |
| Bundle / Team | `com.anthropic.claudefordesktop` / `Q6L2SF6YDW` |
| Electron / Chromium | `42.5.1` / `148.0.7778.271` |
| 签名 / ASAR | `codesign --deep --strict` 通过；ASAR SHA-256 `fe6e6b0d0d3fa8f7e0ce48e0b2da03262e032fc8865b266be4a96b2087cb6a6a` |
| Remote UI | build `23ece27bf4`，git `23ece27bf458411b259240769f0b1985192f532e` |
| Capability | schema `1`，capability `1.0.0` |
| Theme Style Catalog | capability 声明 version `1`；Catalog 文件自身没有 `schemaVersion/version`，是契约缺口 |
| UI Surface Catalog | schema `2`，Interpreter config version `1` |
| Runtime | `official-cdp-auth-required`；apply/deep settings 均 unavailable |

证据：`PROJECT_MANIFEST.json`、`contracts/adapter-capability.json`、
`contracts/theme-style-catalog.json`、
该历史证据的 lineage 现由 `compatibility/claude-macos/1.22209.3/ui-surface-catalog.json`
显式标记为 `historical-reference-only`；不能用于 1.22209.3 的 live Surface admission。

## C. Shared Core 全 token 映射矩阵

缩写：`S` = `app/packages/contracts/unified-theme-v2.schema.json` 与 v1 `$defs`；
`P` = `scripts/project-unified-theme.mjs`；`N` = `contracts/skin-theme.schema.json` +
`scripts/skin-theme.mjs`；`C` = Theme Style Catalog + `assets/renderer-inject.js` +
`assets/skin.css`。所有“exact”仅表示 Projection/离线 consumer；生产 runtime 仍 blocked。

### 身份、颜色与字体

| token path | req | 决策 | target skin.theme | Surface Role / 真实 consumer | 证据 | diagnostic | 测试 |
|---|---:|---|---|---|---|---|---|
| `identity.id` | R | exact | `id` | 主题事务身份 | S/P/N | — | family/compiler + projection |
| `identity.name` | R | exact | `name` | 活动外部主题与自有设置页 | S/P/N | — | family/compiler + projection |
| `tokens.colors.surfaceBase` | R | exact | `semanticColors.surfaceBase` | main/settings base | S/P/N/C | — | golden + style catalog |
| `tokens.colors.surfaceRaised` | O | exact | `semanticColors.surfaceRaised` | composer/自有控件 | S/P/N/C | — | golden + style catalog |
| `tokens.colors.surfaceElevated` | O | exact | `semanticColors.surfaceElevated` | dialog/menu/listbox | S/P/N/C | — | style catalog |
| `tokens.colors.surfaceCode` | O | **unsupported silent** | `semanticColors.surfaceCode` | 变量被设置，但 CSS 无 consumer | S/P/N/C | **缺失** | blocker probe |
| `tokens.colors.text` | R | exact | `colors.text` | 普通标题、正文、图标 | S/P/N/C | — | golden + style catalog |
| `tokens.colors.textStrong` | O | exact | `semanticColors.textStrong` | 一级强调、Composer、自有标题 | S/P/N/C | — | style catalog |
| `tokens.colors.textMuted` | R | exact | `colors.muted` | 次级文字 | S/P/N/C | — | golden + style catalog |
| `tokens.colors.placeholder` | O | exact | `semanticColors.placeholder` | Composer placeholder | S/P/N/C | — | style catalog |
| `tokens.colors.borderSubtle` | O | exact | `semanticColors.borderSubtle` | sidebar/header/自有行分隔 | S/P/N/C | — | style catalog |
| `tokens.colors.borderDefault` | O | exact | `semanticColors.borderDefault` | composer/overlay/settings | S/P/N/C | — | style catalog |
| `tokens.colors.borderStrong` | O | exact | `semanticColors.borderStrong` | 自有 hover/native-entry reference | S/P/N/C | — | style catalog |
| `tokens.colors.action` | R | exact | `semanticColors.action` | send/action + caret | S/P/N/C | — | golden + style catalog |
| `tokens.colors.actionHover` | O | exact | `semanticColors.actionHover` | send hover | S/P/N/C | — | style catalog |
| `tokens.colors.actionPressed` | O | **unsupported silent** | `semanticColors.actionPressed` | 变量被设置，无 `:active` consumer | S/P/N/C | **缺失** | blocker probe |
| `tokens.colors.actionForeground` | R | exact | `semanticColors.actionForeground` | send foreground | S/P/N/C | — | golden + style catalog |
| `tokens.colors.hoverSurface` | O | exact | `semanticColors.hoverSurface` | settings nav / 自有控件 hover | S/P/N/C | — | style catalog |
| `tokens.colors.pressedSurface` | O | **unsupported silent** | `semanticColors.pressedSurface` | 变量被设置，无 pressed consumer | S/P/N/C | **缺失** | blocker probe |
| `tokens.colors.selectedSurface` | O | exact | `semanticColors.selectedSurface` | settings nav current | S/P/N/C | — | settings tab + style catalog |
| `tokens.colors.selectedHoverSurface` | O | **unsupported silent** | `semanticColors.selectedHoverSurface` | 变量被设置，无 selected-hover consumer | S/P/N/C | **缺失** | blocker probe |
| `tokens.colors.focusRing` | R | exact | `semanticColors.focusRing` | composer、自有 focus-visible | S/P/N/C | — | golden + settings tab |
| `tokens.colors.link` | O | **unsupported silent** | `semanticColors.link` | 变量被设置，无 link consumer | S/P/N/C | **缺失** | blocker probe |
| `tokens.colors.danger` | O | exact | `semanticColors.danger` | invalid/error state | S/P/N/C | — | style catalog |
| `tokens.colors.success` | O | **unsupported silent** | `semanticColors.success` | 变量被设置，无 success consumer | S/P/N/C | **缺失** | blocker probe |
| `tokens.colors.warning` | O | exact | `semanticColors.warning` | fallback/quarantine/status | S/P/N/C | — | style catalog |
| `tokens.colors.sidebarSurface` | O | exact | `semanticColors.sidebarSurface` | sidebar/settings sidebar | S/P/N/C | — | style catalog |
| `tokens.colors.headerSurface` | O | exact | `semanticColors.headerSurface` | header / CC Theme page header | S/P/N/C | — | style catalog |
| `tokens.colors.mainScrimStart` | O | exact | `semanticColors.mainScrimStart` | primary-pane gradient start | S/P/N/C | — | style catalog |
| `tokens.colors.mainScrimMid` | O | exact | `semanticColors.mainScrimMid` | primary-pane gradient middle | S/P/N/C | — | style catalog |
| `tokens.colors.mainScrimEnd` | O | exact | `semanticColors.mainScrimEnd` | primary-pane gradient end | S/P/N/C | — | style catalog |
| `tokens.colors.composerSurface` | O | exact | `semanticColors.composerSurface` | composer | S/P/N/C | — | style catalog |
| `tokens.fonts.ui` | O | exact | `fonts.ui` | host root/sidebar/content/Composer/settings | S/P/N/C | — | normalizer + style catalog |
| `tokens.fonts.display` | O | approximated | `fonts.display` | 仅 CC Theme 自有 H2；未覆盖宿主一级标题 | S/P/N/C | **缺失** | blocker probe |
| `tokens.fonts.code` | O | approximated | `fonts.code` | 仅自有编辑输入；未覆盖 conversation code | S/P/N/C | **缺失** | blocker probe |

Capability 仍只发布 `colors.*` / `semanticColors.*`，Manager registry 原样保留 wildcard；上表是
从 S/P/N/C 重新推导的事实，不是当前 Capability 已正确逐 token 声明。

### Appearance、背景与无障碍

| token path | req | 决策 | target skin.theme | Surface Role / 真实 consumer | 证据 | diagnostic | 测试 |
|---|---:|---|---|---|---|---|---|
| `tokens.appearance.shellMode` | O | exact | `appearance.shellMode` | palette/color-scheme | S/P/N/C | — | golden + normalizer |
| `tokens.appearance.backdropBlurPx` | O | exact | same | sidebar/header/composer/settings/overlay | S/P/N/C | — | golden + style catalog |
| `tokens.appearance.backdropSaturation` | O | exact | same | sidebar/composer/settings | S/P/N/C | — | golden + style catalog |
| `tokens.appearance.radiusScale` | O | approximated | same | 仅自有 surface，原生导航保持 native | S/P/N/C | `approximate-owned-radius-only` | projection |
| `tokens.appearance.backgroundPosition` | O/legacy | compatibility path | `appearance.backgroundPosition` | 历史入口；当前静默生效 | S/P/N/C | **缺 legacy diagnostic** | 四向量 probe |
| `tokens.appearance.homeHeroPosition` | O/legacy | **unsupported silent** | 被丢弃 | wrapper allowlist 接受但无投影 | S/P | **缺失** | homeHeroPosition probe |
| `background.mode` | R | exact | `interactiveBackground.type` 或 media | 固定 media/ripple/directional engine | S/P/N/C | — | family/compiler + background engine |
| `background.image` | R | exact | `image` | 静态/poster/交互 source | S/P/N/C | — | golden + media tests |
| `background.homeHeroImage` | O | unsupported | omitted | Claude 无稳定独立 Hero Surface | S/P | `unsupported-separate-home-hero-surface` | family/compiler |
| `background.video` | O | exact projection；runtime blocked | `backgroundVideo` | MP4 URL 被 1.22209.0 拒绝；手动诊断用 GIF 近似 | S/P/N/C | runtime fallback code；生产仍 unavailable | deferred media + manual diagnostic |
| `background.posterMode` | O/media | exact | `appearance.backgroundVideoPosterMode` | media poster | S/P/N/C | — | family/compiler |
| `background.scrimOpacity` | O | exact | video/interactive scrim | overlay scrim | S/P/N/C | — | background engine |
| `background.position` | O | **unsupported/incomplete** | 仅 media+video 回填 `backgroundVideoPosition` | 静态、ripple、directional 的权威位置被丢弃 | S/P | **缺失** | 四向量 probe |
| `background.intensity` | O/ripple | exact | `interactiveBackground.intensity` | ripple engine | S/P/N/C | — | background engine |
| `background.radiusPx` | O/ripple | exact | `interactiveBackground.radiusPx` | ripple engine | S/P/N/C | — | background engine |
| `background.quality` | O/ripple | exact | `interactiveBackground.quality` | ripple engine | S/P/N/C | — | background engine |
| `background.atlas` | R/directional | exact | `interactiveBackground.atlas` | directional atlas | S/P/N/C | — | background engine + deferred media |
| `background.directions` | R/directional | exact | same | directional engine | S/P/N/C | — | background engine |
| `background.columns` | R/directional | exact | same | directional engine | S/P/N/C | — | background engine |
| `background.rows` | R/directional | exact | same | directional engine | S/P/N/C | — | background engine |
| `background.firstDirectionDegrees` | O/directional | exact | same | directional engine | S/P/N/C | — | background engine |
| `background.idleFrame` | O/directional | exact | same | directional engine | S/P/N/C | — | background engine |
| `background.origin` | O/directional | exact | same | directional engine | S/P/N/C | — | background engine |
| `accessibility.reducedMotion` | R | exact semantic | runtime safety owner | matchMedia 后静态降级 | S/P/N/C | `host-reduced-motion-owner` | background engine + projection |
| `accessibility.minimumTextContrast` | O | unsupported | omitted | 无经验证 projection | S/P | `unsupported-accessibility-minimum-text-contrast` | family/compiler |
| `accessibility.minimumLargeTextContrast` | O | unsupported | omitted | 无经验证 projection | S/P | `unsupported-accessibility-minimum-large-text-contrast` | family/compiler |
| `accessibility.preserveSystemFocusRing` | O | unsupported | omitted | 无经验证 projection | S/P | `unsupported-accessibility-preserve-system-focus-ring` | family/compiler |
| `accessibility.transparencyFallback` | O | unsupported | omitted | 无经验证 projection | S/P | `unsupported-accessibility-transparency-fallback` | family/compiler |

## D. Projector → Schema → normalizer → renderer 一致性

- 未知字段在 Manager Schema、Projector `keys()`、target schema/normalizer 均会 fail closed。
- 一般字段由 Projector 复制到 closed `skin.theme`，normalizer 合并默认值并记录 explicit keys，
  renderer 再写 `--skin-*`。但 C 中六个颜色 token 与两个字体角色缺真实/完整 CSS consumer，属于
  “Schema 接受、normalizer 接受、变量赋值，但视觉 Implementation 静默不消费/只部分消费”。
- `homeHeroPosition`：Manager schema 接受，wrapper allowlist 接受，随后无输出、无诊断。
- Background position 当前实际结果：

| 输入 | 当前输出 | 当前诊断 | 共识要求 |
|---|---|---|---|
| 仅 `background.position` | 成功；静态/ripple/directional `backgroundPosition` 丢失 | 无 | 权威采用 current |
| 仅 legacy `tokens.appearance.backgroundPosition` | 成功；静默采用 legacy | 无 | 采用并显示 compatibility diagnostic |
| 两者同值 | 成功；输出 legacy 值 | 无 | 规范化为 current |
| 两者冲突 | 成功；legacy 静默胜出 | 无 | fail closed，`conflicting-background-position` |

需要修正：`scripts/project-unified-theme.mjs` 及 `tests/adapter-capability-projection.test.mjs`；
先由 Manager owner 补 Shared Core contract/compiler baseline，再对齐本端 Projector。

## E. 关键视觉语义

- 已有真实离线 consumer：textStrong、text、textMuted；action/actionHover/focus；border
  subtle/default/strong；surface base/raised/elevated；sidebar/header/composer 与主区域 scrim；
  danger/warning；font.ui；Reduced Motion。
- 不完整或静默：surfaceCode、actionPressed、pressedSurface、selectedHoverSurface、link、success；
  display/code 字体仅覆盖自有编辑器；minimum contrast、system focus-ring policy、transparency
  fallback 未投影。
- 手动 DevTools 诊断已看到主壳、侧栏、Composer、设置页与动态背景，但不等于生产
  apply/verify/pause/restore。

## F. 升级触发、失效与 owner

下列任一变化都使旧证据失效：bundle/version/build、Team/signature、ASAR hash、remote UI
build/hash、Catalog landmark/cardinality/state class、官方 transport/auth 规则。现有 preflight 会校验
signature、Team、version 与 ASAR；remote UI 可独立更新，因生产 Seam 缺失目前不能完成自动 live
build/landmark 复核，这本身是继续 fail closed 的原因。

Owner 是 Mac-Claude Adapter。维护位置：`PROJECT_MANIFEST.json`、Capability、UI Surface Catalog、
`docs/ARCHITECTURE.md`、`scripts/common-macos.sh`。任何未知/变化构建都不得复用旧兼容结论。

## G. 测试与真实客户端边界

- `adapters/mac-claude/tests/run-tests.sh`：全量通过，包括 projection、schema/normalizer、禁止载荷、
  background engine、deferred media、privacy evidence、WYSIWYG、transaction、cleanup、lifecycle。
- Claude-only Manager compile：通过；`allowed=false`，reason `official-cdp-auth-required`。
- Manager 交叉子集：17 项中 14 通过、3 失败；失败来自共享工作区当前 Codex capability/golden/
  legacy copy 基线变化，未修改 sibling 目录，不能归因成 Claude runtime success。
- 真实客户端：签名/ASAR 未变；手动诊断已验证独立 tab、布局在 playing/paused/disabled 间稳定、
  footer 透明，以及 owned GIF fallback 正在运动。生产 apply/verify/pause/restore/rollback 仍 blocked。

## H. Blocker、approximation 与未验证项

1. 把 Capability wildcard 改为逐 token 决策，并让 validator 对照 Shared Core 枚举检查完整性。
2. 为静默视觉 token 增加真实 consumer，或改成 explicit approximated/unsupported + visible diagnostic。
3. 修复 `homeHeroPosition` 静默遗漏。
4. 按统一裁决实现 current/legacy position 优先级、compat diagnostic 与冲突 fail closed。
5. Style Catalog 文件补自身版本事实，并与 Capability 声明交叉校验。
6. 取得官方授权且可逆的生产 Seam 后，才可做真正 restart persistence、失败 rollback、主题替换
   cleanup、所有 11 locale、light/dark/zoom/Reduced Motion、深对话/文件/语音/overlay 的完整验收。

以上 blocker 未清除前，编译成功只能表示 projection artifact 合法，不能宣称 Claude 可 apply。
