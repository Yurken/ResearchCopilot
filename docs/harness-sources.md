# Harness 上游源码管理

小妍将四套代码 Harness 的上游源码固定为 Git submodule。主仓库只记录上游 commit 指针，避免复制源码历史，也便于审计和升级：

| Harness | 子模块 | 上游 |
| --- | --- | --- |
| DeepSeek Harness | `vendor/deepseek-harness` | `deepseek-ai/deepseek-harness` |
| Codex | `vendor/codex-harness` | `openai/codex` |
| OpenCode | `vendor/opencode-harness` | `anomalyco/opencode` |
| Pi | `vendor/pi-harness` | `earendil-works/pi` |
| Pi Web | `vendor/pi-web` | `agegr/pi-web` |

首次检出后初始化全部源码：

```bash
pnpm harness:sources:init
```

按各子模块配置的远端分支获取最新 commit：

```bash
pnpm harness:sources:update
```

更新会让主仓库中的 submodule 指针产生变更。升级 PR 必须检查上游 changelog、许可证和安全公告，再提交这些指针；不要在 submodule 工作区直接堆叠小妍补丁。四套 Harness 的桌面内置运行时都从对应 submodule 的固定提交构建：DSH、Codex、OpenCode 和 Pi Web 各自的 `resources/<name>/manifest.json` 锁定版本与提交，`pnpm <name>:verify-pin` 执行固定版本验证，`pnpm <name>:prepare-runtime` 生成 `resources/<name>/runtime/` 构建产物（已被 gitignore，打包时经 tauri resources 带入安装包）。Pi Web 发布包锁定兼容的 Pi 内核依赖（`@earendil-works/pi-*` npm 版本），升级 `vendor/pi-harness` 不会绕过该依赖锁直接替换运行时。
