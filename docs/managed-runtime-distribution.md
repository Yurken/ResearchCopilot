# 托管运行时分发

Codex、DSH、OpenCode 和 Pi Web 不进入小妍桌面安装包。应用找不到本机 Harness 时，用户可以一键从独立运行时清单下载对应平台的压缩包。小妍校验大小与 SHA-256 后，将其安装到应用数据目录的 `managed-runtimes/<provider>/runtime/`。

## 用户侧来源

- **自动选择**：优先发现 PATH / 常见安装位置中的本机版本；没有本机版本时使用小妍私有目录中的版本。
- **一键安装**：只写入小妍应用数据目录，不执行 `npm -g`、Homebrew 或管理员安装，也不修改用户的 PATH。
- **高级设置**：需要固定其他可执行文件时可手动指定路径。原来的“已安装”和“自定义”入口已合并。

主界面不再要求用户先理解“托管 / 本机”的来源差异，而是直接显示本次将使用的准确路径。

## 独立发布

运行时通过 `.github/workflows/runtime-release.yml` 的 `Managed Runtime Release` 手动流水线发布，生命周期与桌面版本解耦。流水线为 macOS Apple Silicon、Windows x64 和 Linux x64 分别构建四套固定版本运行时，上传到 R2，并更新：

- `runtimes/<runtime-release>/manifest.json`：不可变版本清单；
- `runtimes/latest.json`：客户端默认读取的最新清单。

桌面发版流水线不执行运行时构建，`tauri.conf.json` 也不声明 Harness 资源目录，因此安装器不会包含这些构建产物。

## 安全与恢复

- 清单与压缩包只接受 HTTPS 地址（本地测试允许 `127.0.0.1`）。
- 下载时流式计算 SHA-256，并同时检查字节数。
- 解压后检查每个运行时的必需入口文件。
- 新运行时先进入暂存目录；替换失败时恢复上一份运行时。
- 可用 `XIAOYAN_RUNTIME_MANIFEST_URL` 覆盖清单地址，便于本地和预发布验证。

首次发布包含该功能的桌面版本前，必须先成功执行一次 `Managed Runtime Release`，确保默认 `runtimes/latest.json` 与四个平台包已经可访问。桌面发版的 `pnpm runtime:verify-published` 门禁会检查清单结构、12 个产物的可访问性和远端字节数；未发布完整时不能继续发版。
