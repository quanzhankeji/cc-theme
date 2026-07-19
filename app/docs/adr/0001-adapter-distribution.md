# ADR-0001：Adapter 独立版本与分发

- 状态：Accepted
- 日期：2026-07-19
- 决策者：CC Theme 产品负责人

## 背景

Theme Manager 的 Unified Theme Interface 比宿主 UI 稳定。ChatGPT / Codex 或 WorkBuddy
升级后，通常变化的是某一个 OS × client Adapter 的 Surface 证据、Projection、Normalizer 或运行
Seam。继续把每次 Adapter 修复都绑定到 Manager 整包发布，会放大回归范围，也会迫使用户重复下载
没有变化的主题管理界面和其他 Adapter。

当前构建已经通过 Adapter release manifest 生成白名单 Engine，并把固定版本复制进 Manager bundle。
这证明 Adapter 是真实的变化点，但“构建时 Engine 来源”“本机已安装 Registry”“线上可用版本”仍需
分成不同事实，不能继续由一个配置文件同时承担。

## 决策

建立一个深的 Adapter Distribution Module，其 Interface 只暴露两类第一版对象：

1. **Adapter Release Catalog**：静态、可缓存、确定性的可用版本清单；
2. **Adapter Package**：扩展名为 `.ccadapter` 的 ZIP 兼容不可变 Engine 制品。

本轮完整实现两者的 Schema、生成、离线验证、确定性和恶意负例。现有 Manager 运行时仍消费 bundle
内 Registry 和 Engine，不在本轮自动替换正在运行的 Adapter。

未来的 Adapter Installation Transaction Module 位于同一 Seam 后面，按以下状态推进：

```text
downloaded → verified → staged → activated → health-checked → committed
                    ↘ quarantined        ↘ rolled-back
```

只有 `committed` 可以写入本机 active pointer。任何失败都保留当前 last-known-good；下载成功、解压
成功或 SHA-256 一致都不能单独称为“已安装”或“可应用”。

## Interface 规则

- 格式使用禁止退休 `-skin` 身份的稳定 Adapter ID 语法，平台和架构是独立字段；当前 Manager 的
  admission 当前只允许 `mac-codex`、`mac-workbuddy`，未注册身份 fail closed；
- Adapter 采用双轴身份：`adapterVersion` 严格跟随目标宿主的 `CFBundleShortVersionString`，
  `adapterReleaseRevision` 表示同一宿主版本下的 Adapter 发布修订；确定性资产身份固定为
  `<adapterId>-<adapterVersion>-r<adapterReleaseRevision>-<platform>-<architecture>`；宿主 build 仅属于
  Compatibility Evidence / Compile Context，不进入公开资产身份；
- 首次公开发布前允许原子覆盖当前开发态 revision，但必须重算 Package manifest、sidecar、Catalog
  和全部 SHA-256，旧摘要立即作废；首次正式发布后，同一双轴身份不可覆盖，只能增加 revision；
- Adapter Release Catalog、Adapter Package、Capability、Unified Theme 和 Manager 的版本分别维护，
  不复用一个 `schemaVersion` 表示不同 Interface；
- Catalog 绑定 exact asset name、bytes、SHA-256 和 Adapter Package manifest 摘要；生成发布 Catalog 时
  必须重新打开 Archive、执行完整离线验包，并要求 ZIP 内 `adapter.json` 与 sidecar 完全一致；不使用
  “latest URL”作为安装事实；
- `.ccadapter` 根目录固定为 `adapter.json` 与 `payload/`，未知字段和未知文件 fail closed；
- payload 只来自 Adapter owner 的 release allowlist；禁止 themes、presets、theme-sources、tests、
  fixtures、staging、`.cctheme`、生产媒体、符号链接、目录穿越和旧公开 `-skin` ID；媒体与归档同时
  按扩展名和文件 magic 检查，改名不能绕过；
- Catalog 的 `current` 保存完整双轴指针，`releases` 保存可回滚发布；宿主版本比较遵循 SemVer
  prerelease identifier 规则，同一宿主版本再按 release revision 排序，不能用普通字符串排序；
- Package 完整性由 manifest 中每个文件的 bytes + SHA-256 以及整包 SHA-256 证明；发布者信任由第三
  阶段的签名 Catalog/根公钥证明，不能把哈希误当成发布者身份；
- Capability 和真实 Compile Context 继续决定 compile/apply；Catalog 不能把一个可下载版本直接
  宣称为 runtime apply 可用；
- Windows 全线保持 `paused-by-user`，Catalog 不发布 Windows entry，也不从 macOS 推断能力。

## 第三阶段预留

未来实现只需要在当前 Interface 后加入：可信 Catalog 验签与防回滚、下载缓存、包验证、Adapter
Installation Transaction、active/previous 指针、健康检查、失败回滚和清理。不得让前端提供 URL、
路径、命令、参数或跳过验证开关。

建议本机布局：

```text
Application Support/CC Theme/adapters/
├── store/<archive-sha256>/payload/
├── active/<adapter-id>.json
├── previous/<adapter-id>.json
├── transactions/<transaction-id>.json
└── quarantine/<archive-sha256>/reason.json
```

所有指针与事务记录使用 `0600` 临时文件、`fsync`、原子 rename；同一 Adapter 串行，不同 Adapter
可以并行。更新发生在运行会话之外；正在注入的 generation 不被原地改写，新 Engine 在下一次事务
使用。

## 结果

Manager 很少因单端宿主更新而重新发布；Adapter owner 获得自己的版本节奏。测试集中在 Catalog 和
Package Interface，调用方不需要理解 ZIP、路径、哈希和 release allowlist 的 Implementation，增加
了 leverage 和 locality。代价是必须长期维护独立的 Catalog/Package 契约和第三阶段信任根。

## 非目标

- 本轮不开放在线下载、自动更新、激活、回滚或 Catalog 签名；
- 本轮不迁移当前 bundle 内 Engine，也不改变真实 Mac apply 测试对象；
- 本轮不恢复 Windows，不把 Adapter Package 当主题包，也不把主题打进 Adapter。
- Claude Adapter 源码保留但不注册、不打包，也不进入 Manager 运行资源。
