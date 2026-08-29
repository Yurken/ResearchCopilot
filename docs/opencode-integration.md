# OpenCode Web 接入

小妍直接托管 OpenCode 官方 `opencode web` 页面，不修改其 Web 前端、会话内核或模型配置。

## 启动方式

运行时优先从 `PATH`、`~/.opencode/bin` 和常见 Homebrew/npm 目录查找 `opencode`。未找到时可一键安装到小妍应用数据目录；其他可执行文件路径位于高级设置。选定运行时后，在工作目录执行无头服务，避免官方 `opencode web` 额外打开系统浏览器：

```bash
opencode serve --hostname 127.0.0.1 --port <random-port>
```

端口真正开始监听后，小妍才把状态切换为“运行中”，并在 iframe 中打开当前工作目录对应的会话页（`/{base64url(workspace)}/session`），而不是空的首页。停止和重启会终止由小妍启动的 OpenCode 子进程。

## 复用小妍 API

启动页的“配置小妍 API”先保存当前运行方式，再把小妍代码角色实际生效的主模型同步为 OpenCode 的 `xiaoyan` provider。

- 目前只支持 OpenAI 兼容接口，写入 `xiaoyan.opencode.json` 覆盖层，启动时通过 `OPENCODE_CONFIG` 加载。
- API Key 以 `XIAOYAN_API_KEY` 引用写入覆盖层，并合并进 OpenCode 原生 `auth.json`；Unix 下文件以 `0600` 权限原子替换，不经过前端状态或日志。
- 同步只允许在小妍管理的 OpenCode 进程停止时执行，避免与运行中的配置写入竞争。

## 边界与升级

- 固定使用 loopback，不启用 `0.0.0.0` 或 mDNS。
- 桌面安装包不包含 OpenCode；一键安装使用官网安装命令，将其安装到小妍私有目录并校验，且不修改系统 PATH。
- 小妍拒绝启动低于 `1.1.10` 的 OpenCode Web；这些版本处于官方已公开本地代码执行漏洞的影响范围。
- 升级后至少验证 `opencode --version`、`opencode serve --help`、随机端口启动、不弹出系统浏览器、iframe 加载工作目录会话页、停止和重启。
