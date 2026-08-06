# Agent Rules

所有代理在修改本仓库前，先遵守 [docs/development-principles.md](docs/development-principles.md)。

本仓库的强约束：

- 不要继续把功能直接堆进超大页面或超大组件。
- 如果目标文件已经超过合理规模，先拆当前触达的逻辑，再继续改功能。
- 页面负责组合，`features/<domain>/` 负责功能，`shared.ts` 负责共享常量和纯函数。
- 远程调用、文件系统、Tauri、副作用、节流与状态机逻辑默认进入 hook，不直接留在页面 JSX 中。
- 完成结构性修改后，至少跑相关包 `type-check`；跨工作区修改时补跑 `pnpm type-check` 和 `pnpm lint`。
- Codex 开发模型或关键代理能力升级时，必须遵守 [小妍持续进化规划](docs/xiaoyan-continuous-evolution-plan.md) 的升级流程：先做固定评测和能力差异记录，再同步迭代规划文档、小妍代码与测试。若没有评测证据支持有效代码改进，则暂缓采用升级，不为升级制造空改动。
