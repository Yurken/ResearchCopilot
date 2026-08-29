# Pi Web 接入

小妍直接启动并嵌入社区项目 `agegr/pi-web` 的完整 Web 工作台，不复制其会话、模型、技能或文件浏览界面。

## 启动结构

1. 优先从 `PATH` 和 npm/pnpm 常见全局目录查找 `pi-web`；未找到时可一键安装到小妍私有目录，其他路径位于高级设置。
2. 在所选工作目录执行：

   ```bash
   pi-web --hostname 127.0.0.1 --port <random-port> --no-open
   ```

3. 端口开始监听后，小妍在 iframe 中加载该页面。
4. 停止或重启时，小妍回收自己启动的 Pi Web 子进程。

默认沿用 `~/.pi/agent`，因此 CLI 与 Web 能看到同一批会话和配置。用户也可以指定 `PI_CODING_AGENT_DIR` 对应的数据目录。

## 复用小妍 API

启动页的“配置小妍 API”先保存当前运行方式，再把小妍代码角色实际生效的主模型同步为 Pi 的 `xiaoyan` provider。

- OpenAI-compatible 端点映射为 `openai-completions`。
- Anthropic-compatible 端点映射为 `anthropic-messages`。
- provider 与模型写入当前 Pi 数据目录的 `models.json` 和 `settings.json`，不删除其他 provider。
- API Key 写入当前数据目录的 `auth.json`，不经过前端状态或日志；Unix 下文件以 `0600` 权限原子替换。
- 同步只允许在小妍管理的 Pi 进程停止时执行，避免与运行中的配置写入竞争。

## 边界

- 服务固定监听随机 loopback 端口，不暴露到局域网。
- 设置 `PI_WEB_NO_OPEN=1` 并传入 `--no-open`，不会额外拉起系统浏览器。
- Pi Web 和 Pi agent 以当前用户权限运行，能够读写所选项目并执行命令；小妍的 iframe 不是系统权限沙箱。
- 本机 Pi Web 要求 Node.js 22.19.0 或更高版本；一键安装包自带匹配的 Node，不执行全局 npm 安装。
- Pi 内核与 Web 上游分别固定在 `vendor/pi-harness`、`vendor/pi-web` submodule；统一升级流程见 `docs/harness-sources.md`。
