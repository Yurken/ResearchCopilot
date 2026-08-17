# DeepSeek Harness 接入与升级

小妍代码页直接运行 DeepSeek 官方 Harness。小妍只维护进程生命周期、运行时选择和 Web 页面容器，不修改 DSH 内核。

## 版本边界

- 官方源码通过 `vendor/deepseek-harness` Git submodule 固定到准确 commit。
- `apps/desktop/src-tauri/resources/dsh/manifest.json` 记录版本、commit 和 Node 要求。
- 内置运行时是只读发布资源，只随小妍发版更新。
- profile、插件、凭据和会话位于用户可写的 `DSH_HOME`，不会因应用升级而被覆盖。

运行以下命令检查 submodule 与 manifest 是否一致：

```bash
pnpm dsh:verify-pin
```

## 构建内置运行时

发布构建必须显式提供与目标平台匹配的独立 Node 可执行文件：

```bash
DSH_NODE_BINARY=/absolute/path/to/node pnpm dsh:prepare-runtime
```

脚本使用固定的 pnpm 11.7.0，并从锁定 submodule 创建隔离的本地临时 clone，避免小妍 monorepo 的依赖参与上游模块解析。随后从该源码执行安装、构建和 `pnpm deploy`，递归物化 workspace 运行依赖并拒绝残留 symlink，最终生成：

```text
apps/desktop/src-tauri/resources/dsh/runtime/
├── node                         # Windows 为 node.exe
├── app/                         # DSH CLI 与生产依赖闭包
├── LICENSE.node
├── LICENSE.deepseek-harness
├── THIRD_PARTY_NOTICES.deepseek-harness.md
└── build.json
```

本地开发可以临时复制当前 Node：

```bash
pnpm dsh:prepare-runtime:dev
```

该方式只适合开发验证。发布流水线使用固定 Node 24，并把 Node.js 许可证一起写入安装资源，分别生成 macOS、Windows 和 Linux 安装包。若 Node 二进制旁没有 `LICENSE`，必须通过 `DSH_NODE_LICENSE` 显式指定对应文件。

## 应用运行方式

内置模式执行：

```text
<resource>/dsh/runtime/node <resource>/dsh/runtime/app/lib/bin.js web --host 127.0.0.1 --port 0
```

外部模式执行用户选择的 `dsh` 文件，并使用相同的 loopback 和随机端口参数。后端只接受 DSH 输出的 `http://127.0.0.1:<port>` URL，再交给页面 iframe。

内置模式使用小妍应用数据目录下的独立 `DSH_HOME`。外部模式默认使用用户的 `~/.dsh`，也可在代码页指定其他目录。

## 复用小妍 API

代码页的“配置小妍 API”先保存当前运行方式，再把小妍代码角色实际生效的主模型同步为 DSH 的 `xiaoyan` provider。代码角色没有独立端点时，沿用全局 API，并保留代码角色的模型覆盖。

- OpenAI-compatible 端点映射为 `openai-completions`。
- Anthropic-compatible 端点映射为 `anthropic-messages`。
- provider 与模型写入当前 `DSH_HOME/settings.yaml`，不删除其他 provider。
- API Key 以 `XIAOYAN_API_KEY` 写入当前 `DSH_HOME/.credentials.yaml`，不经过前端状态或日志；Unix 下文件以 `0600` 权限原子替换。
- 同步只允许在小妍管理的 DSH 进程停止时执行，避免与运行中的配置写入竞争。

## 升级流程

1. 更新 submodule 到待评估的官方 commit。
2. 同步修改 `resources/dsh/manifest.json` 的版本和 commit。
3. 运行 `pnpm dsh:verify-pin`。
4. 为每个目标平台构建内置运行时。
5. 验证版本输出、Web 页面启动、随机端口、工作目录、模型凭据和至少一轮工具审批。
6. 运行桌面端 `type-check`、Rust 测试、仓库级 `pnpm type-check` 和 `pnpm lint`。
7. 在小妍发布说明中记录 DSH 上游 commit 和已知兼容性变化。

如 DSH 升级引入破坏性变化，保留上一版小妍的锁定运行时，不在已发布版本中静默替换。
