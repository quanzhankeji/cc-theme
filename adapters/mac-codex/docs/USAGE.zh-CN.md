# 使用说明

## 安装 Adapter

```bash
./scripts/install-skin-macos.sh --port 9341 --no-launch
```

安装不会附带主题。没有活动主题时 Codex 保持原生外观。

## 应用外部主题

```bash
./scripts/apply-cc-theme-macos.sh --file /path/to/example.cctheme
```

## 本地深度编辑

应用主题后打开 Codex Settings → cc-theme。颜色、字体、透明度与当前背景呈现参数会
即时预览并自动持久化，不需要保存按钮。修改只进入本机 Runtime Overrides。

## 验证、暂停与恢复

```bash
./scripts/verify-skin-macos.sh --reload
./scripts/pause-skin-macos.sh
./scripts/restore-skin-macos.sh --restore-base-theme --restart-codex
```

恢复不删除用户已下载的主题、私人素材或已修改宠物。要重新启用主题，请由 CC Theme
Manager 选择已下载资源，或再次应用外部 `.cctheme`。
