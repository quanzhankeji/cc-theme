# 给 Codex 的部署提示词

请把本目录视为 Mac-CodeX Adapter，不要在其中创建或保存生产主题、图片或视频。

1. 运行 `./tests/run-tests.sh`。
2. 确认 Codex Desktop 已退出。
3. 运行 `./scripts/install-skin-macos.sh --port 9341 --no-launch`。
4. 如果用户提供由 CC Theme Manager 导出的 `.cctheme`，运行
   `./scripts/apply-cc-theme-macos.sh --file <相对路径>`。
5. 没有外部主题时不要启动注入；保持 Codex 原生外观。
6. 不修改 `app.asar`、签名或 CSP，不接收远程主题代码。
7. 不删除用户本机已下载主题、Runtime Overrides、私人素材或宠物。
