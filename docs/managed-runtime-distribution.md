# 托管运行时安装

Codex、DSH、OpenCode 和 Pi Web 不进入小妍桌面安装包。应用找不到本机 Harness 时，用户可以一键使用各项目官网推荐的命令将其安装到小妍私有目录。

## 用户侧来源

- **自动选择**：优先发现 PATH / 常见安装位置中的本机版本；没有本机版本时使用小妍私有目录中的版本。
- **一键安装**：调用各 Harness 官方安装渠道（Codex macOS / Linux 与 OpenCode macOS / Linux 使用官网安装脚本，其余使用官方 npm 包；Pi Web / DSH 额外自带 Node 二进制），只写入小妍应用数据目录，不执行全局 `npm -g`、Homebrew 或管理员安装，也不修改用户的 PATH（Codex 官方脚本默认会写 shell profile / 注册表 User PATH，已分别通过子进程 PATH 前置与改用 npm 渠道规避）。
- **高级设置**：需要固定其他可执行文件时可手动指定路径。原来的“已安装”和“自定义”入口已合并。

主界面不再要求用户先理解“托管 / 本机”的来源差异，而是直接显示本次将使用的准确路径。

## 安装来源与版本

每个 Harness 的安装元数据记录在 `apps/desktop/src-tauri/resources/<provider>/manifest.json`：

- `version`：要安装的固定版本。
- `commit`：对应的源码 commit，用于 `pnpm <provider>:verify-pin` 校验。
- `install.method`：`shell`（Codex / OpenCode）或 `npm`（Pi Web / DSH）。
- `install.package` / `install.nodeVersion`：npm 安装方式使用的包名和 Node 版本。

后端 `runtime_installer.rs` 在编译期嵌入这些清单，安装时直接执行官方命令，不再从远端拉取统一的 `latest.json` 清单。

| Provider | 官方安装来源 |
|----------|--------------|
| Codex    | `https://chatgpt.com/codex/install.sh`（macOS / Linux），设置 `CODEX_INSTALL_DIR`、`CODEX_HOME`、`CODEX_RELEASE`、`CODEX_NON_INTERACTIVE`，并把私有 bin 前置到子进程 PATH（官方脚本检测到 PATH 已含该目录就不会改写 shell profile）；Windows 使用官方 npm 平台包 `@openai/codex@<version>-win32-<arch>`（与 standalone 发布相同的 vendor 布局），不执行 install.ps1——它会无条件写注册表 User PATH |
| OpenCode | `https://opencode.ai/install --version <version>`（macOS / Linux）；Windows 使用 `npm install --prefix` 安装 `opencode-ai` 并部署其平台原生二进制（`opencode-windows-<arch>` 可选依赖） |
| Pi Web   | `npm install --prefix <managed-dir> @agegr/pi-web@<version>`，并下载 Node.js 官方二进制 |
| DSH      | `npm install --prefix <managed-dir> @deepseek-ai/dsh@<version>`，并下载 Node.js 官方二进制 |

### 布局约定

- **Codex（macOS / Linux）**：官方脚本把实际二进制下载到 `CODEX_HOME/packages/standalone`（provider 根目录，在 `runtime` 轮换之外持久存在），再把 `runtime/bin/codex` 装成指向那里的符号链接。必需文件校验会跟随链接。
- **Codex（Windows）**：npm 平台包的 `vendor/<target>/` 目录内容（`bin/codex.exe`、`codex-path/rg.exe`、`codex-resources/` 等）整体部署到 `runtime` 根目录。
- **Pi Web / DSH**：npm 安装后把包内容（不含 `node_modules`）整体部署到 `runtime` 根目录，保持包内相对布局——`bin/pi-web.js` 按 `__dirname/..` 定位 `.next`，`lib/bin.js` 动态 import 同目录 chunk 并读取 `../package.json`，只复制入口单文件会破坏这些相对路径。包的运行时依赖由 npm 提升到 `runtime/node_modules`。
- **OpenCode（Windows）**：直接部署 npm 平台包中的原生 `opencode.exe`，不搬运 `.bin` shim（shim 按 `%~dp0\..` 相对定位包文件，搬走即失效，且原生二进制不依赖系统 Node）。

## 安全与恢复

- 所有下载来源均为 HTTPS：官网安装脚本、GitHub Releases、Node.js 官方分发站、npm registry。
- 安装前将现有 `runtime` 备份到 `.previous-runtime`，安装失败时自动恢复；恢复失败时同时报告安装错误与恢复错误。
- 安装后校验每个运行时的必需入口文件。
- Codex / OpenCode 安装完成后校验可执行权限（Unix）。
- 安装命令统一设置 15 分钟超时（Node 下载为 10 分钟），超时即终止子进程，避免交互式提示或网络挂起长期占用安装锁。
- npm 通过 PATH 解析；GUI 进程未继承登录 shell PATH 时回退到登录 shell 中查找（与 Pi 本机发现策略一致），仍找不到则提示安装 Node.js。

## 升级流程

1. 更新 `vendor/<provider>` submodule 到待评估的官方 commit。
2. 同步修改 `resources/<provider>/manifest.json` 中的 `version` 和 `commit`。
3. 运行 `pnpm <provider>:verify-pin` 确认一致性。
4. 验证安装命令、启动、随机端口、工作目录、模型凭据和至少一轮工具审批。
5. 运行桌面端 `type-check`、Rust 测试、仓库级 `pnpm type-check` 和 `pnpm lint`。
