# Codex Web 接入

小妍的 Codex 页面由两部分组成：官方 `codex app-server` 负责线程与执行内核，小妍的静态 Web 页面负责交互。桌面端只管理进程、loopback 服务和 iframe，不复制 Codex 内核。

## 运行结构

1. 小妍优先从 `PATH` 和常见安装目录发现本机 `codex`；未找到时可一键安装到小妍私有目录，手动路径位于高级设置。
2. 启动 `codex app-server --listen ws://127.0.0.1:<random-port>`。
3. 同时启动仅监听 `127.0.0.1` 的小妍静态 Web 服务。
4. iframe 加载静态页面；页面按官方 JSON-RPC 协议连接 app-server。
5. 停止、重启或 app-server 异常退出时，两项本地服务一起回收。

Web 页面完成 `initialize` / `initialized` 握手后使用 `thread/list`、`thread/start`、`thread/resume`、`turn/start` 与 `turn/interrupt`。命令和文件审批通过 app-server 的 server request 返回决定，不经过 Tauri 事件旁路。

## 安全边界

- HTTP 与 WebSocket 均只绑定 loopback 随机端口，不监听局域网地址。
- `/runtime.json` 只包含 app-server 地址和工作目录，不包含 API Key。
- 静态服务只响应固定资源路径，并发送 CSP、`nosniff`、`no-referrer` 和 `no-store` 头。
- 默认使用 `workspace-write` 沙箱和 `on-request` 审批策略。
- 小妍 API 凭据仍通过环境变量引用写入 Codex 配置，不进入前端状态、URL 或日志。

## 协议升级

升级 Codex CLI 时，先执行：

```bash
codex app-server generate-ts --out /tmp/codex-app-server-types
```

对照生成类型检查初始化参数、线程来源、`ThreadItem`、通知名和审批响应，再运行 Rust 测试、Desktop 单测、类型检查与 lint。若协议发生破坏性变化，应先保持上一版可用 Codex，再适配 Web 页面。
