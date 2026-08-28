# 托管运行时安装

Codex、DSH、OpenCode 和 Pi Web 不进入小妍桌面安装包。应用找不到本机 Harness 时，用户可以一键使用各项目官网推荐的命令将其安装到小妍私有目录。

## 用户侧来源

- **自动选择**：优先发现 PATH / 常见安装位置中的本机版本；没有本机版本时使用小妍私有目录中的版本。
- **一键安装**：调用各 Harness 官方安装命令（Codex / OpenCode 使用官网 shell 安装脚本，Pi Web / DSH 使用 npm 安装并自带 Node 二进制），只写入小妍应用数据目录，不执行全局 `npm -g`、Homebrew 或管理员安装，也不修改用户的 PATH。
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
| Codex    | `https://chatgpt.com/codex/install.sh` / `install.ps1`，设置 `CODEX_INSTALL_DIR` 与 `CODEX_HOME` 到小妍私有目录 |
| OpenCode | `https://opencode.ai/install`（macOS / Linux），Windows 使用 `npm install --prefix` |
| Pi Web   | `npm install --prefix <managed-dir> @agegr/pi-web@<version>`，并下载 Node.js 官方二进制 |
| DSH      | `npm install --prefix <managed-dir> @deepseek-ai/dsh@<version>`，并下载 Node.js 官方二进制 |

## 安全与恢复

- 所有下载来源均为 HTTPS：官网安装脚本、GitHub Releases、Node.js 官方分发站、npm registry。
- 安装前将现有 `runtime` 备份到 `.previous-runtime`，安装失败时自动恢复。
- 安装后校验每个运行时的必需入口文件。
- Codex / OpenCode 安装完成后校验可执行权限（Unix）。

## 升级流程

1. 更新 `vendor/<provider>` submodule 到待评估的官方 commit。
2. 同步修改 `resources/<provider>/manifest.json` 中的 `version` 和 `commit`。
3. 运行 `pnpm <provider>:verify-pin` 确认一致性。
4. 验证安装命令、启动、随机端口、工作目录、模型凭据和至少一轮工具审批。
5. 运行桌面端 `type-check`、Rust 测试、仓库级 `pnpm type-check` 和 `pnpm lint`。
