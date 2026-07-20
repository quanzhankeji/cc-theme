# Adapter 独立分发开发记录

## 目标

让 Adapter Engine 可以独立于 Theme Manager 和 `.cctheme` 更新，同时保持当前双端 Mac 调用路径、
主题语义结构和 fail-closed apply gate 不变。

## 阶段状态

### 阶段 0：真实运行基线

- [x] Registry 驱动 mac-codex、mac-workbuddy；
- [x] Adapter release manifest 白名单构建 Engine；
- [x] Manager bundle 不包含生产主题或媒体；
- [x] WOLP 使用完整九键 Compile Context 编译 WorkBuddy；
- [x] 2026-07-19 新签名 Manager 完成 WOLP → WorkBuddy apply / verify / pause / reapply /
  restore / cleanup；
- [ ] 当前制品未 notarize、未生成正式 DMG，不作为公开发行物。

### 阶段 1：Adapter Release Catalog

- [x] 第一版 closed Schema；
- [x] 两个已注册 Mac Adapter 的确定性版本记录；
- [x] `adapterVersion + adapterReleaseRevision` 双轴 current/release 身份；
- [x] exact asset name / bytes / SHA-256 / package manifest digest；
- [x] 发布清单重新验证 Archive，并绑定 ZIP 内真实 `adapter.json` 与 sidecar；
- [x] Manager、Capability、Unified Theme、Package contract 分离版本；
- [x] Windows entry 为 0；
- [x] 生成器重复执行字节一致；
- [x] 非法 ID、平台、架构、URL、重复版本和未知字段负例。

### 阶段 2：`.ccadapter` Package

- [x] `adapter.json + payload/` 第一版格式；
- [x] 两个已注册 Mac Engine 可确定性打包；
- [x] 离线 verify 对文件集合、bytes、SHA-256、平台、架构和契约版本 fail closed；
- [x] 拒绝符号链接、目录穿越、重复 ZIP entry、未知根文件、主题、媒体、fixture、staging 和旧 ID；
- [x] 拒绝伪装扩展名的媒体/归档 magic，并正确比较 SemVer 数字预发布段；
- [x] 同输入两次打包的 archive SHA-256 一致；
- [x] 包内 Engine 可被现有 Registry/Projector/Normalizer Interface 加载。
- [x] 三包和 Catalog 在临时目录完成后原子发布；后段失败不留下部分分发目录。

2026-07-19 本地 ARM64 确定性制品：

| Adapter | Archive bytes | Archive SHA-256 | Manifest SHA-256 |
| --- | ---: | --- | --- |
| `mac-codex-26.715.31925-r1-macos-arm64` | 1,077,102 | `cfe6c79099afba3a1580612566b570b1483ba26a4c3c85f863c3ec30a64e3c0e` | `803a16abd2116a7d34e17c41b82224830b454c03475fc56210f7e03ebc494feb` |
| `mac-workbuddy-5.2.6-r1-macos-arm64` | 695,974 | `bc61ab0c5ce40fcfb9105a0bb4febf9abcd374489b58bc76b2f81adea8e1f6bb` | `6deacb922493f04cecf268c791fb547be8855f588d89887c1dff39b53aa1b811` |

这些是本地开发制品身份，不是已上传、签名或公开发布的下载入口。`registry/adapter-versions.json`
因此继续标记 `development-local` 且不伪造 packages/URL；实际发布时由同一生成器读取最终 Release
资产后生成 `published` Catalog。

2026-07-19 双轴契约并发分叉修复：Manager 不再读取 Adapter `productVersion` 作为唯一版本事实；
Package、sidecar 与 Catalog 统一校验两端冻结的 `adapterVersion`、正整数 `adapterReleaseRevision`、
平台、架构和 `assetIdentity`。Manager Node 48/48、UI 24/24 已通过；其余全矩阵以本次最终验收记录为准。

2026-07-19 阶段 1/2 初始验收：Manager Node 48/48、UI 21/21、Rust 49/49、typecheck、Vite build、
Cargo check/fmt、仓库合同 18/18、Shared/Registry 5/5 全部通过；独立 QA 复现并确认拒绝 Catalog/ZIP
manifest 分叉、SemVer `beta.2 < beta.11` 与伪装媒体三类攻击，结论 ACCEPT。

### 阶段 3A：本地安全安装与回滚

- [x] `.ccadapter` 本地选择入口和中英文状态界面；
- [x] 严格校验扩展名、ZIP、closed manifest、目标 Adapter、宿主版本、平台、架构、契约版本、
  文件集合、bytes、SHA-256、文件模式、媒体/归档 magic、旧公开 ID 和安全路径；
- [x] 私有 transaction staging 与 content-addressed `store/<archive-sha256>/payload`；
- [x] staged Capability、release identity、运行脚本、Projector/Normalizer 静态健康检查；
- [x] `active` / `previous` 指针原子切换、目录同步和失败前滚保护；
- [x] 新激活内容损坏时自动回退到上一份已验证本地 Adapter；没有可用 previous 时回退应用内置 Engine；
- [x] Registry、Capability loader 和主题 Compiler 按当前已激活 Adapter 根目录消费，不在业务层按目标写映射；
- [x] UI 展示 Adapter 版本、release revision、应用内置/本地来源、安装/导入更新和宿主版本等待状态；
- [x] 正在运行的客户端不被重启，更新在下次主题操作使用；
- [x] 覆盖 host mismatch、staged health failure、路径逃逸、payload 篡改、pre-release 同 revision
  原位更新和 previous fallback 的故障注入测试。

当前 3A 只接受用户明确选择的本地包，不联网，也不把本地开发包描述为官方更新。

### 阶段 3B：线上可信更新（核心链路完成，待新版本实机发布验收）

- [x] Ed25519 离线根密钥与 App 内置公钥；私钥只存在发布机 Keychain，不进入 Git/Actions/env/log；
- [x] detached raw-byte 签名、signed SHA-256、keyId、sequence、expiry 和 rollback protection；
- [x] `stable.json` 固定 bootstrap → exact-commit Catalog → exact Release asset 的两阶段信任链；
- [x] ETag、12 小时 TTL、离线 last-known-good 与完整快照后原子 active 切换；
- [x] 只允许官方 GitHub 路径、官方 Release 资产重定向、5 次跳转、HTTPS、大小/超时/SHA 上限；
- [x] 下载结果接入现有 `verified → staged → health-checked → activated → committed` 事务；
- [x] 正在运行的客户端不被更新流程重启，新 Engine 在下次主题操作使用；
- [x] UI：启动后低频检查、最新版/可下载状态、一键下载、下载失败保留现状及本地包兜底；
- [x] 单元故障注入：签名篡改、未知字段、过期、降级、revocation、hash/bytes drift、损坏缓存；
- [x] 公开网络 smoke：正式 pointer/Catalog 签名、exact raw、Release redirect、bytes/SHA 全部通过；
- [ ] 新版本签名 App 的干净 Mac 断网/LKG、真实一键安装、运行中延迟生效与断电点最终 QA；
- [ ] 可选的大包下载进度/取消；当前两个 Adapter 均小于 1.1 MiB，不作为首版阻断。

第三阶段建议稳定错误码：`catalog-signature-invalid`、`catalog-expired`、`catalog-rollback-blocked`、
`adapter-download-failed`、`adapter-package-invalid`、`adapter-incompatible`、`adapter-stage-failed`、
`adapter-health-check-failed`、`adapter-rollback-complete`、`adapter-rollback-failed`、
`adapter-quarantined`。错误详情继续使用净化、长度有界字段，不回放 URL、路径、命令、环境变量或
Adapter 原始输出。

## 发布边界

- Claude 源码保留为 `manager-registration-paused`，不进入 Catalog、Package 或 Manager 资源；
- stable-token/base-hash production rebase/quarantine 与跨进程单一事务仍按原门禁记录；
- Windows 只记录未来适配项，用户明确恢复前不注册、不实现、不构建、不测试；
- 第一版在线更新 Manager 继续携带 bundle 内已验证 Engine；只有官方签名下载或用户明确导入且通过
  全部本地校验的 `.ccadapter` 才能成为激活版本。待干净 Mac、断网、LKG、撤回与真实宿主回归全部
  通过后，后续版本才可删除 bundle 内 bootstrap Engine。

## 继续开发入口

继续完成发布验收时，先读取：

1. `docs/adr/0001-adapter-distribution.md`；
2. Adapter Release Catalog Schema 与生成器；
3. `.ccadapter` Schema、打包器和离线 verifier；
4. `docs/adapter-lifecycle.md` 的现有主题事务；
5. 本文件中阶段 3 的未完成门禁。

网络失败不得阻断已安装 Adapter、bundle fallback 或正常启动；线上测试始终独立于默认离线测试矩阵。
