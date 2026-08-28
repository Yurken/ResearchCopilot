# OpenCode Web 接入

小妍直接托管 OpenCode 官方 `opencode web` 页面，不修改其 Web 前端、会话内核或模型配置。

## 启动方式

运行时优先从 `PATH`、`~/.opencode/bin` 和常见 Homebrew/npm 目录查找 `opencode`。未找到时可一键安装到小妍应用数据目录；其他可执行文件路径位于高级设置。选定运行时后，在工作目录执行：

```bash
opencode web --hostname 127.0.0.1 --port <random-port>
```

端口真正开始监听后，小妍才把状态切换为“运行中”并加载 iframe。运行环境设置 `BROWSER=/usr/bin/true`（Windows 使用无效浏览器名），避免官方命令额外弹出系统浏览器。停止和重启会终止由小妍启动的 OpenCode 子进程。

## 边界与升级

- 固定使用 loopback，不启用 `0.0.0.0` 或 mDNS。
- 小妍不读取或复制 OpenCode provider 凭据；连接模型继续使用 OpenCode 官方页面。
- 桌面安装包不包含 OpenCode；一键安装使用官网安装命令，将其安装到小妍私有目录并校验，且不修改系统 PATH。
- 小妍拒绝启动低于 `1.1.10` 的 OpenCode Web；这些版本处于官方已公开本地代码执行漏洞的影响范围。
- 升级后至少验证 `opencode --version`、`opencode web --help`、随机端口启动、iframe 加载、停止和重启。
