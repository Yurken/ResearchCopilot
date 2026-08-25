# Pi Web 接入

小妍直接启动并嵌入社区项目 `agegr/pi-web` 的完整 Web 工作台，不复制其会话、模型、技能或文件浏览界面。

## 启动结构

1. 从 `PATH`、npm/pnpm 常见全局目录或用户指定路径查找 `pi-web`。
2. 在所选工作目录执行：

   ```bash
   pi-web --hostname 127.0.0.1 --port <random-port> --no-open
   ```

3. 端口开始监听后，小妍在 iframe 中加载该页面。
4. 停止或重启时，小妍回收自己启动的 Pi Web 子进程。

默认沿用 `~/.pi/agent`，因此 CLI 与 Web 能看到同一批会话和配置。用户也可以指定 `PI_CODING_AGENT_DIR` 对应的数据目录。

## 边界

- 服务固定监听随机 loopback 端口，不暴露到局域网。
- 设置 `PI_WEB_NO_OPEN=1` 并传入 `--no-open`，不会额外拉起系统浏览器。
- Pi Web 和 Pi agent 以当前用户权限运行，能够读写所选项目并执行命令；小妍的 iframe 不是系统权限沙箱。
- Pi Web 要求 Node.js 22.19.0 或更高版本。推荐使用 `npm install -g @agegr/pi-web` 安装发行版。
- Pi 内核与 Web 上游分别固定在 `vendor/pi-harness`、`vendor/pi-web` submodule；统一升级流程见 `docs/harness-sources.md`。
