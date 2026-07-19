# WorkBuddy UI Surface Catalog

> 此文件由 `scripts/ui-surface-catalog.mjs` 从版本化 JSON 生成。不要直接编辑。

## 采集基线

- WorkBuddy `5.2.6` / Electron `37.10.3`
- Adapter: `mac-workbuddy` `5.2.6` release `r1`
- 原生主题：`light`
- 可视状态：`55`
- 计算样式快照：`65`
- 原始截图不进入仓库；仅保存去隐私化的 DOM、token 和计算样式证据。

JSON 单一数据源：`compatibility/workbuddy-macos/5.2.6/ui-surface-catalog.json`。

## System 配色边界

- 作用范围：background media plus explicitly cataloged structural transparency
- 弹窗外观保持原生：`true`
- 受保护属性：`background`、`color`、`border`、`border-radius`、`box-shadow`、`backdrop-filter`、`control colors`
- 允许接管弹窗外观的策略：`adaptive`、`custom`

## DOM 层级

| Node id | Selector | Parent | Lifecycle | Cardinality | Ownership |
| --- | --- | --- | --- | --- | --- |
| `document` | `body[data-application-name="workbuddy"][data-platform="mac"]` | — | `persistent` | `one` | `host` |
| `react-root` | `#root` | `document` | `persistent` | `one` | `host` |
| `shell` | `.teams-container` | `react-root` | `persistent` | `one` | `host` |
| `sidebar` | `[data-view-id="sidebar"]` | `shell` | `expanded-only` | `zero-or-one` | `host` |
| `conversation-sidebar` | `.conversation-sidebar` | `sidebar` | `expanded-only` | `zero-or-one` | `host` |
| `conversation-list` | `.conversation-list` | `conversation-sidebar` | `expanded-only` | `zero-or-one` | `host` |
| `main` | `[data-view-id="main-content"]` | `shell` | `persistent` | `one` | `host` |
| `content-wrapper` | `.teams-content-wrapper` | `main` | `persistent` | `one` | `host` |
| `topbar` | `.workbuddy-topbar` | `content-wrapper` | `persistent` | `one` | `host` |
| `topbar-actions` | `.task-topbar-actions` | `topbar` | `project-conversation` | `zero-or-one` | `host` |
| `flow-action` | `.task-topbar-actions > .task-header-btn[title="流转"]` | `topbar-actions` | `project-conversation` | `zero-or-one` | `host` |
| `video-playback-control` | `#workbuddy-skin-video-toggle` | `topbar-actions` | `skin-active-project-conversation` | `zero-or-one` | `skin-owned` |
| `route-content` | `.teams-main-content` | `content-wrapper` | `route` | `one` | `host` |
| `home` | `.wb-home-page` | `route-content` | `route` | `zero-or-one` | `host` |
| `home-composer` | `.wb-home-composer` | `home` | `route` | `zero-or-one` | `host` |
| `markdown-table-wrapper` | `.cb-markdown-table-wrapper` | `route-content` | `message-content` | `many` | `host` |
| `markdown-table` | `.cb-markdown-table-wrapper > table` | `markdown-table-wrapper` | `message-content` | `many` | `host` |
| `detail-panel` | `.detail-panel-container` | `route-content` | `route` | `zero-or-one` | `host` |
| `detail-panel-surface` | `.detail-panel-container > .detail-panel` | `detail-panel` | `route` | `zero-or-one` | `host` |
| `detail-panel-header` | `.detail-panel > .detail-header` | `detail-panel-surface` | `route` | `zero-or-one` | `host` |
| `detail-panel-navigation` | `.detail-panel > .compact-nav-wrapper` | `detail-panel-surface` | `route` | `zero-or-one` | `host` |
| `detail-panel-body` | `.detail-panel > .detail-layout` | `detail-panel-surface` | `route` | `zero-or-one` | `host` |
| `detail-panel-empty` | `.detail-panel .empty-content` | `detail-panel-body` | `route` | `zero-or-one` | `host` |
| `detail-sidebar` | `.detail-sidebar` | `detail-panel` | `route` | `zero-or-one` | `host` |
| `floating-portal` | `[data-floating-ui-portal]` | `document` | `portal` | `many` | `host` |
| `account-popover` | `.user-menu-popover` | `document` | `portal` | `zero-or-one` | `host` |
| `miniprogram-popover` | `.wechatmp-popup-container` | `document` | `portal` | `zero-or-one` | `host` |
| `settings-overlay` | `.settings-modal-overlay` | `document` | `portal` | `zero-or-one` | `host` |
| `settings-modal` | `.settings-modal` | `settings-overlay` | `portal` | `zero-or-one` | `host` |
| `settings-navigation` | `.settings-navigation` | `settings-modal` | `portal` | `zero-or-one` | `host` |
| `settings-content` | `.settings-modal__content` | `settings-modal` | `portal` | `zero-or-one` | `host` |
| `cc-theme-settings-nav` | `#workbuddy-cc-theme-settings-nav` | `settings-navigation` | `settings-open-and-skin-active` | `zero-or-one` | `skin-owned` |
| `cc-theme-settings-panel` | `#workbuddy-cc-theme-settings-panel` | `settings-content` | `settings-open-and-skin-active` | `zero-or-one` | `skin-owned` |
| `adapter-background` | `#workbuddy-skin-background` | `document` | `skin-active` | `zero-or-one` | `skin-owned` |

## 页面与状态

| Page id | 页面 | Family | 稳定根 | 已采集状态 |
| --- | --- | --- | --- | --- |
| `home.new-task` | 新建任务 | `home` | `.main-content--welcome`<br>`.wb-home-page` | `default`, `model-listbox`, `attachment-menu`, `workspace-selector`, `permission-popover` |
| `assistant.local` | 本地助理 | `assistant` | `.claw-workspace`<br>`.main-content--chat` | `empty`, `settings` |
| `project.index` | 项目总览 | `project` | `.main-content--projects`<br>`.workbuddy-collab:not(.workbuddy-collab--portal)`<br>`.landing` | `default`, `card-menu`, `create-modal`, `task-transfer-native-disabled` |
| `project.conversation` | 项目会话 | `conversation` | `.task-chat-topbar-breadcrumb__seg`<br>`.artifact-slot-panel__card-main` | `default`, `detail-sidebar`, `video-playing`, `video-paused`, `video-disabled`, `table-light`, `table-dark`, `message-menu`, `conversation-search`, `member-popover` |
| `catalog.expert` | 专家中心 | `expert` | `.expert-center-page`<br>`.ec-main-content` | `grid`, `detail-modal` |
| `catalog.skill` | 技能库 | `skill` | `.skillhub-install-btn`<br>`.skill-detail-content-box` | `grid`, `detail-page` |
| `catalog.connector` | 连接器 | `resources` | `[data-view-id="main-content"]` | `grid` |
| `automation.index` | 自动化 | `automation` | `.main-content--automation`<br>`.automation-main-page` | `empty`, `templates`, `run-history` |
| `automation.editor` | 自动化编辑器 | `automation` | `.atm-detail-page` | `new` |
| `resources.files` | 我的文件 | `resources` | `[data-view-id="my-files-panel"]`<br>`.my-files-panel` | `task-results-empty`, `cloud-drive` |
| `resources.tencent-docs` | 腾讯文档授权 | `resources` | `[data-view-id="tencent-lexiang-panel"]` | `authorization` |
| `resources.ima` | ima 知识库授权 | `resources` | `[data-view-id="ima-panel"]` | `authorization` |
| `inspiration.index` | 灵感 | `inspiration` | `.discover-panel-page`<br>`.dc-playbook-card` | `masonry-grid`, `favorites`, `search` |
| `inspiration.detail` | 灵感详情 | `inspiration` | `.dc-detail-overlay`<br>`.dc-detail-modal` | `open` |
| `settings` | 设置 | `settings` | `.settings-modal-overlay`<br>`.settings-modal` | `account`, `system`, `intelligence`, `shortcuts`, `memory`, `model`, `assistant`, `personalization`, `data`, `security`, `help`, `cc-theme-editor` |

## 运行时 Skin Surface Roles

| Skin Surface Role | Native selectors | Cardinality |
| --- | --- | --- |
| `shell` | `.teams-container` | `one` |
| `sidebar` | `[data-view-id="sidebar"]` | `zero-or-one` |
| `sidebar-list` | `.conversation-list` | `zero-or-one` |
| `sidebar-header` | `.conversation-list-topbar` | `zero-or-one` |
| `sidebar-brand` | `.conversation-list-logo` | `zero-or-one` |
| `sidebar-tabs` | `.conversation-list-tabs` | `zero-or-one` |
| `sidebar-nav-row` | `.conversation-list-tab-row` | `many` |
| `sidebar-nav-item` | `.conversation-list-tab-button` | `many` |
| `sidebar-nav-actions` | `.conversation-list-tab-actions` | `many` |
| `sidebar-nav-action` | `.conversation-list-tab-action-button` | `many` |
| `sidebar-section` | `.conversation-section` | `many` |
| `sidebar-collapsible` | `.collapsible-section` | `many` |
| `sidebar-footer` | `.conversation-list-footer` | `zero-or-one` |
| `sidebar-promotion` | `.daily-checkin` | `zero-or-one` |
| `main` | `[data-view-id="main-content"]` | `one` |
| `main-content` | `.teams-main-content` | `zero-or-one` |
| `topbar` | `.workbuddy-topbar` | `one` |
| `topbar-actions` | `.task-topbar-actions` | `zero-or-one` |
| `flow-action` | `.task-topbar-actions > .task-header-btn` | `zero-or-one` |
| `video-playback-control` | `#workbuddy-skin-video-toggle` | `zero-or-one` |
| `topbar-action` | `.growth-plan-entry` | `zero-or-one` |
| `page-home` | `.wb-home-page` | `zero-or-one` |
| `page-assistant` | `.claw-workspace` | `zero-or-one` |
| `page-chat` | `.main-content--chat` | `zero-or-one` |
| `page-project` | `.main-content--projects`<br>`.workbuddy-collab:not(.workbuddy-collab--portal)`<br>`.landing` | `many` |
| `page-expert` | `.expert-center-page`<br>`.ec-main-content` | `many` |
| `page-automation` | `.main-content--automation`<br>`.automation-main-page` | `many` |
| `page-automation-editor` | `.atm-detail-page` | `zero-or-one` |
| `page-inspiration` | `.discover-panel-page` | `zero-or-one` |
| `page-files` | `[data-view-id="my-files-panel"]`<br>`.my-files-panel` | `many` |
| `page-external-resource` | `[data-view-id="tencent-lexiang-panel"]`<br>`[data-view-id="ima-panel"]`<br>`[data-view-id="iframe-menu-panel"]` | `many` |
| `home-heading` | `.wb-home-header` | `zero-or-one` |
| `scene-tabs` | `.wb-scene-tabs` | `zero-or-one` |
| `scene-tab` | `.wb-scene-tabs__pill` | `many` |
| `quick-action` | `.quick-actions__item` | `many` |
| `project-card` | `.project-grid__card` | `many` |
| `project-template-card` | `.landing-template-card` | `many` |
| `project-hero-media` | `.landing-hero` | `zero-or-one` |
| `expert-scene-card` | `.ec-featured-scene-card` | `many` |
| `expert-card` | `.ec-expert-card` | `many` |
| `automation-template-card` | `.atm-template-card` | `many` |
| `artifact-card` | `.artifact-slot-panel__card-main` | `many` |
| `markdown-table-wrapper` | `.cb-markdown-table-wrapper` | `many` |
| `markdown-table` | `.cb-markdown-table-wrapper > table` | `many` |
| `markdown-table-header-cell` | `.cb-markdown-table-wrapper th` | `many` |
| `markdown-table-body-cell` | `.cb-markdown-table-wrapper td` | `many` |
| `inspiration-card` | `.dc-playbook-card` | `many` |
| `skill-detail` | `.skill-detail-content-box` | `zero-or-one` |
| `composer` | `.wb-home-composer` | `zero-or-one` |
| `composer-slot` | `.wb-home-composer__input-slot` | `zero-or-one` |
| `composer-input` | `.wb-home-composer [role="textbox"][data-slate-editor="true"]` | `zero-or-one` |
| `composer-toolbar` | `[data-cb-chat-input-toolbar-selector="true"]` | `zero-or-one` |
| `composer-footer` | `.wb-input-footer` | `zero-or-one` |
| `detail-panel` | `.detail-panel-container` | `many` |
| `detail-panel-surface` | `.detail-panel-container > .detail-panel` | `many` |
| `detail-panel-header` | `.detail-panel > .detail-header` | `many` |
| `detail-panel-tab` | `.detail-header .cb-tabs__item` | `many` |
| `detail-panel-navigation` | `.detail-panel > .compact-nav-wrapper` | `many` |
| `detail-panel-body` | `.detail-panel > .detail-layout` | `many` |
| `detail-panel-empty` | `.detail-panel .empty-content` | `many` |
| `detail-sidebar` | `.detail-sidebar`<br>`.detail-sidebar__body`<br>`.sidebar-next[data-view="artifacts"]`<br>`.sidebar-next-body` | `many` |
| `settings-navigation` | `.settings-navigation` | `zero-or-one` |
| `settings-navigation-item` | `.settings-navigation__item` | `many` |
| `settings-content` | `.settings-modal__content` | `zero-or-one` |
| `settings-native-panel` | `.settings-modal__panel` | `zero-or-one` |
| `overlay-scrim` | `.conversation-search-modal-overlay`<br>`.settings-modal-overlay`<br>`.collab-modal__overlay`<br>`.ec-modal-overlay` | `many` |
| `overlay-detail-scrim` | `.dc-detail-overlay` | `zero-or-one` |
| `overlay-search-modal` | `.conversation-search-modal-overlay [role="dialog"]` | `zero-or-one` |
| `overlay-settings-modal` | `.settings-modal` | `zero-or-one` |
| `overlay-create-modal` | `.collab-modal__overlay aside[role="dialog"]` | `zero-or-one` |
| `overlay-transfer-scrim` | `.task-transfer-overlay .plan-modal-backdrop` | `zero-or-one` |
| `overlay-transfer-modal` | `.task-transfer-popover` | `zero-or-one` |
| `overlay-expert-modal` | `.ec-modal-overlay [role="dialog"]` | `zero-or-one` |
| `overlay-detail-modal` | `.dc-detail-modal` | `zero-or-one` |
| `overlay-popover` | `.wb-popover`<br>`.wb-dropdown`<br>`.notification-panel` | `many` |
| `overlay-account` | `.user-menu-popover` | `zero-or-one` |
| `account-menu-header` | `.user-menu-header-name` | `zero-or-one` |
| `account-menu-copy-action` | `.user-menu-header-copy-uid` | `zero-or-one` |
| `account-menu-item` | `.user-menu-item` | `many` |
| `account-menu-label` | `.user-menu-item-label` | `many` |
| `account-menu-value` | `.user-menu-item-value` | `many` |
| `account-menu-subtitle` | `.user-menu-item-subtitle` | `many` |
| `account-menu-icon` | `.user-menu-item-icon` | `many` |
| `account-menu-divider` | `.user-menu-separator` | `many` |
| `account-plan-action` | `.plan-action-btn` | `many` |
| `account-theme-switcher` | `.user-menu-theme-switcher` | `zero-or-one` |
| `account-theme-thumb` | `.user-menu-theme-switcher-thumb` | `zero-or-one` |
| `account-theme-option` | `.user-menu-theme-option` | `many` |
| `overlay-collaboration` | `.task-collab-popover` | `zero-or-one` |
| `overlay-qr` | `.wechatmp-popup-container` | `zero-or-one` |
| `miniprogram-heading` | `.wechatmp-popup-header-text` | `zero-or-one` |
| `miniprogram-description` | `.wechatmp-popup-description` | `zero-or-one` |
| `miniprogram-footer` | `.wechatmp-popup-footer` | `many` |
| `miniprogram-footer-text` | `.wechatmp-popup-footer-text` | `many` |
| `miniprogram-toggle` | `.wechatmp-toggle` | `many` |
| `miniprogram-toggle-track` | `.wechatmp-toggle__slider` | `many` |
| `miniprogram-qr-canvas` | `.wechatmp-popup-qrcode-placeholder` | `zero-or-one` |
| `overlay-listbox` | `[role="listbox"]` | `many` |

## UI Interpreter 配置

- Kind: `skin.ui-interpreter-config` / version `2`
- Style Catalog: `mac-workbuddy-theme`
- Role attribute: `data-workbuddy-skin-role`

### Host Locale Authority

- Authority: `workbuddy-effective-locale`
- Selectable locales: `zh-CN` / `en-US`
- Effective storage: `CODEBUDDY_IDE_STORAGE_LANG`
- Immediate signal: `body[lang]`
- Fallback: `zh-CN`
- Evidence: `renderer/assets/i18n-BJ9li_ou.js` → `getSupportedLocales`
- Privacy: stable host locale state only; no DOM text or user content

### 锚点

| Anchor | Scope selectors | Target selectors | Selection |
| --- | --- | --- | --- |
| `videoToggle` | `.task-topbar-actions` | `:scope > .task-header-btn` | `first` |

### 动态目标

| Target | Selectors | Cardinality |
| --- | --- | --- |
| `composerEditors` | `[role="textbox"][data-slate-editor="true"]` | `many` |
| `composerKnownRoot` | `.wb-home-composer` | `zero-or-one` |
| `composerStop` | `[data-view-id="main-content"]` | `zero-or-one` |
| `composerToolbar` | `[data-cb-chat-input-toolbar-selector="true"]` | `zero-or-one` |
| `composerFooter` | `.wb-input-footer` | `zero-or-one` |

### 挂载节点

| Mount | Node | Within | Selectors | Cardinality |
| --- | --- | --- | --- | --- |
| `themeSettings` | `root` | `document` | `.settings-modal` | `zero-or-one` |
| `themeSettings` | `navigation` | `root` | `.settings-navigation` | `zero-or-one` |
| `themeSettings` | `content` | `root` | `.settings-modal__content` | `zero-or-one` |
| `themeSettings` | `nativePanel` | `content` | `:scope > .settings-modal__panel` | `zero-or-one` |
| `themeSettings` | `navigationItems` | `navigation` | `.settings-navigation__item` | `many` |

### 相邻原生条目同构契约

| Mount | Insertion slot | Relative native item | Class contract | Copied attributes |
| --- | --- | --- | --- | --- |
| `themeSettings` | `navigationItem` | `before` | copy adjacent native class list | `role`<br>`tabindex` |

## 组件级样式证据

| Evidence id | Family | 稳定节点 | 修复前计算样式 | 适配偏差 | Resolution roles |
| --- | --- | --- | --- | --- | --- |
| `sidebar.active-navigation-row` | `navigation` | `.conversation-list-tab-row.active`<br>`.conversation-list-tab-button.active`<br>`.conversation-list-tab-actions` | `rowBackground: rgb(230, 230, 230)`<br>`rowRadius: 8px`<br>`labelColor: rgb(255, 255, 255)` | The button was themed while its wider active row retained the native light surface. | `sidebar-nav-row`<br>`sidebar-nav-item`<br>`sidebar-nav-actions`<br>`sidebar-nav-action` |
| `account.menu-typography-controls` | `floating` | `.user-menu-popover`<br>`.user-menu-header-name`<br>`.user-menu-item-label`<br>`.user-menu-item-value`<br>`.user-menu-item-subtitle`<br>`.plan-action-btn`<br>`.user-menu-theme-switcher`<br>`.user-menu-theme-option` | `labelColor: rgb(59, 59, 59)`<br>`secondaryColor: rgba(0, 0, 0, 0.5)`<br>`subtitleColor: rgb(59, 59, 59)`<br>`planActionBackground: rgb(0, 0, 0)`<br>`themeOptionColor: rgba(0, 0, 0, 0.7)`<br>`themeSwitcherBackground: rgba(0, 0, 0, 0.06)`<br>`themeThumbBackground: rgb(255, 255, 255)` | Earlier system-mode rules recolored the popover, activity card, actions, menu leaves, icons, and appearance switcher even though WorkBuddy already supplied a coherent native light/dark design. System mode now keeps every account-popover appearance declaration native; the catalog roles remain available only for inspection and for explicit adaptive/custom themes. | `account-menu-header`<br>`account-menu-item`<br>`account-menu-label`<br>`account-menu-value`<br>`account-menu-subtitle`<br>`account-menu-icon`<br>`account-plan-action`<br>`account-theme-switcher`<br>`account-theme-thumb`<br>`account-theme-option` |
| `interaction.primary-action-pressed` | `content` | `.wb-scene-tabs__pill--active`<br>`.plan-action-btn` | `sceneActionState: stable active scene-tab class plus native :active interaction`<br>`planActionRestingBackground: rgb(0, 0, 0)`<br>`planActionState: native button :active interaction` | The exact Shared Core actionPressed token previously reached the Style Catalog but had no pressed-state consumer. The fixed mapping is limited to captured primary-action roles and preserves native system/disabled appearance. | `scene-tab`<br>`account-plan-action` |
| `miniprogram.popup-typography-switches` | `floating` | `.wechatmp-popup-container`<br>`.wechatmp-popup-header-text`<br>`.wechatmp-popup-description`<br>`.wechatmp-popup-footer-text`<br>`.wechatmp-toggle`<br>`.wechatmp-toggle__slider`<br>`.wechatmp-popup-qrcode-placeholder` | `surfaceBackground: rgb(255, 255, 255)`<br>`headingColor: rgba(0, 0, 0, 0.9)`<br>`descriptionColor: rgba(0, 0, 0, 0.7)`<br>`footerColor: rgba(0, 0, 0, 0.7)`<br>`toggleTrackBackground: rgb(229, 229, 229)`<br>`qrCanvasBackground: rgb(255, 255, 255)` | The dark popup surface did not override explicit light-theme copy and switch-track colors; the QR canvas must remain white. | `overlay-qr`<br>`miniprogram-heading`<br>`miniprogram-description`<br>`miniprogram-footer`<br>`miniprogram-footer-text`<br>`miniprogram-toggle`<br>`miniprogram-toggle-track`<br>`miniprogram-qr-canvas` |
| `system.background-route-shells` | `shell` | `.main-content--projects`<br>`.workbuddy-collab:not(.workbuddy-collab--portal)`<br>`.landing`<br>`.expert-center-page`<br>`.ec-main-content`<br>`.main-content--automation`<br>`.landing-hero`<br>`.landing-template-card`<br>`.ec-featured-scene-card`<br>`.ec-expert-card`<br>`.atm-template-card` | `projectShellBackgrounds: rgb(250, 250, 250),rgb(255, 255, 255),rgb(255, 255, 255)`<br>`expertShellBackgrounds: rgb(255, 255, 255),rgb(250, 250, 250)`<br>`automationShellBackground: rgb(250, 250, 250)`<br>`projectHeroBlendMode: normal`<br>`contentCardBackground: rgb(255, 255, 255)` | Inner route roles were transparent, but unmarked full-viewport shells and opaque card families still concealed the background media in Project, Expert, and Automation. | `page-project`<br>`page-expert`<br>`page-automation`<br>`project-hero-media`<br>`project-template-card`<br>`expert-scene-card`<br>`expert-card`<br>`automation-template-card` |
| `topbar.video-playback-control` | `navigation` | `.task-topbar-actions`<br>`.task-topbar-actions > .task-header-btn[title="流转"]`<br>`#workbuddy-skin-video-toggle` | `flowActionSize: 32px × 32px`<br>`flowActionRadius: 6px`<br>`flowActionBackground: transparent`<br>`lightActionColor: rgba(0, 0, 0, 0.9)`<br>`darkActionColor: rgba(255, 255, 255, 0.92)`<br>`actionGap: 4px` | The injected media control needs a stable native anchor and must preserve the neighboring action geometry and current WorkBuddy light/dark foreground instead of using a fixed absolute position or preset color. | `topbar-actions`<br>`flow-action`<br>`video-playback-control` |
| `topbar.task-transfer-native-disabled` | `overlay` | `.workbuddy-collab--portal`<br>`.task-transfer-overlay .plan-modal-backdrop`<br>`.task-transfer-popover`<br>`.task-transfer-popover .plan-new-head`<br>`.task-transfer-popover .plan-new-pane`<br>`.task-transfer-popover .plan-new-footer` | `backdropBackground: rgba(0, 0, 0, 0.6)`<br>`popoverBackground: rgb(255, 255, 255)`<br>`popoverBorder: 1px solid rgb(235, 235, 235)`<br>`popoverRadius: 18px`<br>`popoverShadow: color(srgb 0 0 0 / 0.2) 0px 8px 32px 0px`<br>`sectionBackgrounds: rgb(255, 255, 255)` | The portal host matched the broad .workbuddy-collab page selector, inherited the page-level --wb-bg-primary bridge, and changed the transfer modal and its sections from native opaque white to a 28% white surface even when video was disabled. | `page-project`<br>`overlay-transfer-scrim`<br>`overlay-transfer-modal` |
| `detail.artifact-panel-transparency` | `content` | `.detail-panel-container`<br>`.detail-panel-container > .detail-panel`<br>`.detail-panel > .detail-header`<br>`.detail-panel > .compact-nav-wrapper`<br>`.detail-panel > .detail-layout`<br>`.detail-panel .empty-content` | `outerBackground: color(srgb 1 1 1 / 0.78)`<br>`nestedSurfaceBackground: color(srgb 1 1 1 / 0.78)`<br>`headerBackground: rgb(255, 255, 255)`<br>`bodyBackground: color(srgb 1 1 1 / 0.78)`<br>`panelWidth: 440px`<br>`panelHeight: 1046px` | The same elevated 78% surface was applied to three nested full-size layers while the header remained opaque, so alpha compositing made the artifact panel visually solid and concealed the background video. | `detail-panel`<br>`detail-panel-surface`<br>`detail-panel-header`<br>`detail-panel-tab`<br>`detail-panel-navigation`<br>`detail-panel-body`<br>`detail-panel-empty` |
| `markdown.table-theme-divergence` | `conversation` | `.cb-markdown-table-wrapper`<br>`.cb-markdown-table-wrapper > table`<br>`.cb-markdown-table-wrapper th`<br>`.cb-markdown-table-wrapper td` | `lightTableBackground: rgb(255, 255, 255)`<br>`lightHeaderBackground: rgb(247, 247, 247)`<br>`lightBodyCellBackground: transparent`<br>`darkTableBackground: transparent`<br>`darkHeaderBackground: rgb(37, 37, 38)`<br>`darkBodyCellBackground: transparent`<br>`lightBorder: rgb(235, 235, 235)`<br>`darkBorder: rgb(60, 60, 60)` | The previous table normalization was scoped to page-chat while project conversations were classified as page-project, so the native light table root stayed white and the dark root stayed transparent. Semantic Markdown table roles now apply the same 28% base, 52% header, transparent body-cell, and theme-relative border hierarchy in both modes. | `markdown-table-wrapper`<br>`markdown-table`<br>`markdown-table-header-cell`<br>`markdown-table-body-cell` |

## 弹层分类

| Overlay id | 类型 | 稳定节点 | 圆角 | 阴影 | 遮罩/模糊 |
| --- | --- | --- | --- | --- | --- |
| `global-search` | modal | `.conversation-search-modal-overlay`<br>`[role="dialog"]` | `modal` | `popover` | scrim: `modal` |
| `settings` | modal | `.settings-modal-overlay`<br>`.settings-modal` | `xl` | `settingsModal` | scrim: `modal` |
| `create-project` | modal | `.collab-modal__overlay`<br>`aside[role="dialog"]` | `modal` | `createProjectModal` | scrim: `modal` |
| `task-transfer` | modal | `.task-transfer-overlay .plan-modal-backdrop`<br>`.task-transfer-popover` | `18px` | `createProjectModal` | scrim: `modal` |
| `expert-detail` | modal | `.ec-modal-overlay`<br>`.ec-modal-overlay [role="dialog"]` | `2xl` | `settingsModal` | scrim: `modal` |
| `inspiration-detail` | detail-overlay | `.dc-detail-overlay`<br>`.dc-detail-modal` | `18px 18px 0 0` | `inspirationDetail` | scrim: `detail` |
| `generic-popover` | popover | `.wb-popover`<br>`.wb-dropdown`<br>`[data-floating-ui-portal]` | `2xl` | `popover` | — |
| `task-filter` | popover | `.task-filter-trigger`<br>`[role="menu"]` | `2xl` | `menu` | — |
| `account-menu` | popover | `.user-menu-popover` | `2xl` | `accountMenu` | — |
| `collaboration-members` | popover | `.task-collab-popover` | `2xl` | `collaborationPopover` | blur: `collaborationPopover` |
| `notification-center` | popover | `.notification-panel` | `2xl` | `popover` | — |
| `wechat-mini-program` | popover | `.wechatmp-popup-overlay`<br>`.wechatmp-popup-container` | `xl` | `qrPopover` | — |
| `composer-listbox` | listbox | `.wb-home-composer [role="listbox"]`<br>`[data-cb-chat-input-toolbar-selector="true"] [role="listbox"]` | `2xl` | `popover` | — |
| `message-more` | anchored-menu | `[role="menu"]` | `10px` | `popover` | — |

## 原生背景 token

| Token | Native value |
| --- | --- |
| `sidebar` | `#F2F2F2` |
| `canvas` | `#FAFAFA` |
| `surface` | `#FFFFFF` |
| `surfaceSubtle` | `#F7F7F7` |
| `surfaceMuted` | `#EBEBEB` |
| `hover` | `color-mix(in srgb, #000000 5%, transparent)` |
| `active` | `color-mix(in srgb, #000000 8%, transparent)` |
| `selected` | `#E6E6E6` |
| `userMessage` | `#EBEBEB` |
| `tableHeader` | `#F7F7F7` |
| `artifactCard` | `#F2F2F2` |

## 原生边框 token

| Token | Native value |
| --- | --- |
| `weak` | `color-mix(in srgb, #000000 4%, transparent)` |
| `default` | `color-mix(in srgb, #000000 8%, transparent)` |
| `control` | `color-mix(in srgb, #000000 12%, transparent)` |
| `secondary` | `#EBEBEB` |
| `strong` | `#E6E6E6` |
| `focus` | `rgba(0, 0, 0, 0.75)` |

## 原生圆角 token

| Token | Native value |
| --- | --- |
| `none` | `0px` |
| `xs` | `2px` |
| `sm` | `4px` |
| `md` | `6px` |
| `lg` | `8px` |
| `xl` | `12px` |
| `2xl` | `16px` |
| `modal` | `24px` |
| `full` | `9999px` |

## 原生阴影 token

| Token | Native value |
| --- | --- |
| `none` | `none` |
| `small` | `0 1px 2px rgba(0, 0, 0, 0.08)` |
| `inputHome` | `0 12px 24px -8px rgba(0, 0, 0, 0.02), 0 2px 4px -4px rgba(0, 0, 0, 0.02)` |
| `inputConversation` | `0 6px 12px -8px rgba(0, 0, 0, 0.02), 0 2px 4px -4px rgba(0, 0, 0, 0.03)` |
| `popover` | `0 4px 12px -4px rgba(0, 0, 0, 0.04), 0 3px 6px -8px rgba(0, 0, 0, 0.04)` |
| `menu` | `0 4px 16px -4px rgba(0, 0, 0, 0.06), 0 4px 8px -8px rgba(0, 0, 0, 0.04)` |
| `accountMenu` | `0 4px 16px rgba(0, 0, 0, 0.16)` |
| `settingsModal` | `0 10px 15px -3px rgba(0, 0, 0, 0.10), 0 4px 6px -2px rgba(0, 0, 0, 0.05)` |
| `createProjectModal` | `0 8px 32px rgba(0, 0, 0, 0.20)` |
| `collaborationPopover` | `0 24px 48px 2px rgba(0, 0, 0, 0.08), 0 5px 12px 4px rgba(0, 0, 0, 0.08)` |
| `qrPopover` | `0 4px 20px rgba(0, 0, 0, 0.15)` |
| `inspirationDetail` | `0 24px 80px rgba(0, 0, 0, 0.22)` |
| `expertCard` | `0 16px 32px rgba(0, 0, 0, 0.03)` |

## DOM Surface 分组

### shell

- `.teams-container`
- `[data-view-id="main-content"]`
- `.teams-content-wrapper`
- `.teams-main-content`
- `.workbuddy-topbar`

### navigation

- `[data-view-id="sidebar"]`
- `.conversation-sidebar`
- `.conversation-list`
- `.conversation-list-topbar`
- `.conversation-list-header`
- `.conversation-list-tabs`
- `.conversation-list-tab-row`
- `.conversation-list-tab-button`
- `.conversation-list-tab-actions`
- `.conversation-list-tab-action-button`
- `.collapsible-section`
- `.conversation-list-content`
- `.conversation-list-footer`

### floating

- `.user-menu-popover`
- `.user-menu-item`
- `.user-menu-item-label`
- `.user-menu-item-subtitle`
- `.plan-action-btn`
- `.user-menu-theme-switcher`
- `.user-menu-theme-option`
- `.wechatmp-popup-container`
- `.wechatmp-popup-header-text`
- `.wechatmp-popup-description`
- `.wechatmp-popup-footer-text`
- `.wechatmp-toggle`
- `.wechatmp-toggle__slider`

### home

- `.main-content--welcome`
- `.chat-container--welcome`
- `.wb-cb-chat`
- `.wb-home-page`
- `.wb-home-header`
- `.wb-home-header__title`
- `.wb-home-header__subtitle`
- `.wb-scene-tabs`
- `.wb-scene-tabs__pill`
- `.quick-actions__item`
- `.wb-home-composer`

### assistant

- `.claw-workspace`
- `.main-content--chat`

### conversation

- `.main-content--chat`
- `.task-chat-topbar-breadcrumb__seg`
- `.artifact-slot-panel__card-main`
- `.artifact-slot-panel__action-btn`
- `.task-header-btn`

### composer

- `[role="textbox"][data-slate-editor="true"]`
- `[data-cb-chat-input-toolbar-selector="true"]`
- `[data-cb-chat-input-toolbar-right="true"]`
- `.wb-input-footer`
- `.skill-selector__btn`

### project

- `.main-content--projects`
- `.workbuddy-collab:not(.workbuddy-collab--portal)`
- `.landing`
- `.landing-hero`
- `.project-grid__card`
- `.landing-template-card`
- `.collab-modal__overlay`
- `.task-collab-popover`

### automation

- `.main-content--automation`
- `.automation-main-page`
- `.atm-template-card`
- `.atm-toolbar`
- `.atm-detail-page`
- `.atm-modal-input`
- `.atm-time-picker-trigger`
- `.atm-custom-select-trigger`

### expert

- `.expert-center-page`
- `.ec-main-content`
- `.ec-topbar`
- `.ec-featured-scenes-next`
- `.ec-featured-scene-card`
- `.ec-expert-card`
- `.ec-category-tabs-next`
- `.ec-modal-overlay`
- `.ec-card-summon-btn`

### skill

- `.skillhub-install-btn`
- `.skill-detail-content-box`

### resources

- `[data-view-id="my-files-panel"]`
- `.my-files-panel`
- `.my-files-filter-btn`
- `[data-view-id="tencent-lexiang-panel"]`
- `[data-view-id="ima-panel"]`
- `[data-view-id="iframe-menu-panel"]`

### inspiration

- `.discover-panel-page`
- `.dc-playbook-card`
- `.dc-card-cover`
- `.dc-detail-overlay`
- `.dc-detail-modal`

### settings

- `.settings-modal-overlay`
- `.settings-modal`
- `.settings-navigation`
- `.settings-navigation__item`
- `.settings-modal__content`
- `.settings-modal__panel`
- `.settings-modal__close`
- `#workbuddy-cc-theme-settings-nav`
- `#workbuddy-cc-theme-settings-panel`
- `.cb-switch__thumb`
- `.font-size-slider__track-line`

### detail

- `.detail-panel-container`
- `.sidebar-next[data-view="artifacts"]`
- `.sidebar-next-body`
- `.detail-panel`
- `.detail-header`
- `.detail-header .cb-tabs__item`
- `.compact-nav-wrapper`
- `.detail-layout`
- `.empty-content`
- `.detail-sidebar`
- `.detail-sidebar__body`

## 结构匹配角色

- `composer-main-area`：nearest large non-transparent ancestor of the Slate editor。原因：the native surface class is generated and unstable。
- `background-art`：validated local image rendered as an Adapter-owned img element。原因：large data URLs are unreliable in Chromium custom properties。
- `sidebar-state`：.teams-container.sidebar-collapsed and sidebar presence。原因：collapsed layout removes the sidebar instead of retaining a fixed-width surface。
- `anchored-menu`：semantic anchor plus visible menu/listbox portal。原因：some message and composer menus have no stable menu-specific class。

## 选择器规则

优先：

- data-view-id attributes
- semantic BEM class names
- ARIA roles and labels used together with an anchor or page root
- Adapter-assigned Skin Surface Roles for content-derived surfaces

禁止：

- generated Vite or CSS-module class names
- global div/span recoloring
- unscoped role=menu or role=dialog selectors
- text-only matching for destructive or stateful controls

## 预设约束

- Treat sidebar, canvas, and content surfaces as separate background layers.
- Keep ordinary cards and tables flat; use borders and tonal backgrounds before shadows.
- Reserve elevation shadows for composers, floating surfaces, and blocking overlays.
- Apply one radius scale across controls while preserving modal and full-pill exceptions.
- Theme overlay scrims independently from dialog surfaces.
- Do not enable backdrop blur globally; the native collaboration popover is the only observed blur surface.
- Scope page-family rules under a stable root or Skin Surface Role.
- Test expanded and collapsed sidebar states independently.
