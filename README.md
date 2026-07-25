<p align="center">
  <img src="apps/desktop/public/xiaoyan_poster.png" alt="小妍 — AI 科研工作台" width="760" />
</p>

<h1 align="center">小妍</h1>

<p align="center">
  本地优先的 AI 科研工作台，把选题、检索、阅读、实验、写作与投稿串成一条可追溯的工作流。
</p>

<p align="center">
  <a href="https://github.com/Yurken/xiaoyan/releases/latest"><img src="https://img.shields.io/github/v/release/Yurken/xiaoyan?display_name=tag&style=flat-square" alt="Latest release" /></a>
  <a href="https://github.com/Yurken/xiaoyan/actions/workflows/ci.yml"><img src="https://github.com/Yurken/xiaoyan/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/Yurken/xiaoyan/stargazers"><img src="https://img.shields.io/github/stars/Yurken/xiaoyan?style=flat-square&logo=github" alt="GitHub stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="Apache License 2.0" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-333?style=flat-square" alt="Platforms" />
  <img src="https://img.shields.io/badge/Tauri-v2-24C8DB?style=flat-square&logo=tauri" alt="Tauri v2" />
</p>

<p align="center">
  <a href="#为什么选择小妍">产品亮点</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#技术架构">技术架构</a> ·
  <a href="#参与贡献">参与贡献</a> ·
  <a href="CHANGELOG.md">更新日志</a>
</p>

> 当前版本：**v0.5.2**。小妍仍处于快速迭代阶段，升级前建议备份重要数据。

## 为什么选择小妍

- **完整科研链路**：研究规划、文献综述、论文精读、知识沉淀、实验记录、LaTeX 写作和投稿管理集中在一个工作台。
- **本地优先**：核心业务由 Tauri/Rust 与本地 SQLite 承载，研究资产默认保存在你的设备上。
- **可观测的多 Agent 协作**：复杂任务先规划再执行，可查看节点、过程、来源与中间产物，而不是只得到一个黑盒答案。
- **证据可追溯**：论文、笔记、实验、知识主张与投稿相互关联，Graph RAG 会沿证据关系召回上下文。
- **模型可选择**：支持 OpenAI、Anthropic 及 OpenAI 兼容接口，可按快速分析、深度研究、写作和视觉任务分配模型。

> [!IMPORTANT]
> “本地优先”不等于“完全离线”。当你启用云端模型、联网搜索、WebDAV 或其他第三方服务时，相关请求内容会发送给你配置的服务商。请在提交敏感、未公开或受约束的研究材料前核对服务商条款。

## 功能概览

| 模块 | 能力 |
| --- | --- |
| 工作台 | 聚合研究主题、论文、笔记、实验、投稿、风险提醒与下一步行动 |
| 研究规划 | 多 Agent 生成学习路线、代表论文、开放问题与领域动态 |
| 文献与精读 | PDF 管理、全文提取、语义检索、图表识别、翻译与复现指南 |
| 小妍协同 | 直接对话、任务拆解、技能模板、附件、来源引用与任务中止 |
| 知识库 | Markdown 笔记、小妍内部自动 LLM Wiki、知识图谱、证据关系与混合 Graph RAG |
| 实验与代码 | 结构化实验记录、代码工作区、Git 审查、快照与差异对比 |
| 学术写作 | 多文件 LaTeX、预览、诊断、统计、润色、续写与学术翻译 |
| 投稿管理 | 刊会追踪、投稿看板、版本快照、角色化预审与审稿意见跟踪 |
| 数据与同步 | 本地数据库、加密配置导出、备份恢复及可选的加密同步 |

<details>
<summary><strong>查看 v0.5.2 主要更新</strong></summary>

- 论文阅读器新增目录导航、文本批注和独立问答侧栏
- 支持携带当前论文上下文继续研究
- 论文检索支持自然语言需求自动拆分、高级条件折叠、学术与网络来源统一截止日期，并保留填写内容和最近一次结果
- 论文列表复用缓存与快照，切换时加载更高效
- 修复实验代码消息显示与工作目录持久化问题
- 减少专利检索和文档格式比对误判

</details>

## 快速开始

### 下载桌面版

前往 [Releases](https://github.com/Yurken/xiaoyan/releases/latest) 下载对应平台的安装包。

macOS 如果提示应用“已损坏”，确认安装包来自本仓库 Release 后执行：

```bash
xattr -cr /Applications/小妍.app
```

### 从源码运行

环境要求：Node.js 18+、pnpm 9+、[Rust 工具链](https://rustup.rs/) 以及 Tauri v2 对应平台依赖。

```bash
git clone https://github.com/Yurken/xiaoyan.git
cd xiaoyan
pnpm install
pnpm dev:desktop
```

常用命令：

```bash
pnpm type-check       # 全工作区类型检查
pnpm lint             # 全工作区 lint
pnpm test             # 单元与组件测试
pnpm test:e2e         # 桌面端端到端测试
pnpm build:desktop    # 构建桌面应用
```

## 模型配置

首次启动后在“设置”中添加模型服务：

1. 配置主模型；仅这一项即可使用主要 AI 功能。
2. 按需为快速分析、深度研究、写作、代码和视觉任务配置独立模型。
3. 需要联网检索时，再配置 Tavily 等搜索服务。

配置优先级为：`Agent 覆盖 → 任务分工 → 默认执行模型 → 主模型`。API Key 不应写入仓库文件或提交到 Issue；请只通过应用设置或本机环境变量提供。

## 技术架构

```text
React + Vite
    ↕ Tauri invoke / event
Rust 本地内核
    ├── commands      参数校验与命令边界
    ├── services      设置、论文、知识、投稿、同步等领域服务
    ├── agent runtime 多 Agent 编排、工具注册与事件流
    ├── RAG / Wiki    小妍后台自动编译、语义与关键词混合召回
    ├── Graph         引用图与证据图谱
    └── SQLite        本地持久化
```

```text
apps/
├── desktop/          # Tauri v2 桌面端（旗舰端）
├── web/              # Next.js 展示 / 远程协作端
└── mobile/           # Expo 轻量陪伴端
packages/
├── api-sdk/          # API SDK
├── config/           # 共享配置
├── types/            # 跨端领域类型
└── ui/               # 共享 UI 组件
```

桌面端是核心产品，新能力默认先在桌面端实现。详细设计见 [桌面端系统介绍](docs/system-introduction-desktop.md) 与 [开发原则](docs/development-principles.md)。

小妍内部 LLM Wiki 的自动整理流程、数据模型和检索边界见 [LLM Wiki 与混合检索](docs/llm-wiki-and-hybrid-retrieval.md)。

## 数据与隐私

- 桌面端业务数据默认存入本地 SQLite，PDF 原文件保留在用户选择的位置。
- 模型密钥通过应用设置管理；界面中的 `***` 代表已保存但不回显明文。
- 启用云模型、搜索或同步服务会产生对外网络请求，数据处理规则由对应服务商决定。
- 发布日志、Issue、截图与诊断文件可能包含路径、论文标题或其他研究信息，分享前请先脱敏。

## 参与贡献

欢迎提交 Issue 和 Pull Request。开始前请先阅读 [参与贡献](CONTRIBUTING.md)、[社区行为准则](CODE_OF_CONDUCT.md) 与 [开发原则](docs/development-principles.md)：页面只负责组合，功能进入 `features/<domain>/`，副作用与状态机逻辑进入 hook。

提交信息使用 `type: 中文描述`，例如：

```text
feat: 支持批量导入论文
fix: 修复切换论文后阅读位置丢失
docs: 补充本地开发说明
```

提交 PR 前至少运行与改动范围相符的检查；跨工作区修改需运行 `pnpm type-check` 和 `pnpm lint`。一般使用问题请查看 [获取帮助](SUPPORT.md)；安全漏洞请不要创建公开 Issue，按照 [安全政策](SECURITY.md) 私下报告。

## Star History

如果小妍对你有帮助，欢迎点一个 Star。它会帮助更多研究者发现项目。

<a href="https://www.star-history.com/?type=date&repos=Yurken%2Fxiaoyan">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Yurken/xiaoyan&type=date&theme=dark&legend=top-left&sealed_token=x85YP6wH0H_fYrh94oYtmnIyStrNxFHtj61xHIGYKjPB8Qdy29vTA3irisqFtyM67s1VvYoRyVJGGdWcs3a9H6kF0tymBrZtooxNKTXn9c77rkdN9J9afD9XQEIX1FlPRgHer8BxtCYPPWQukbhLw-hkQuktrEUeEyqpe0g8FKDZbIGtsF80R7AXoRV8" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Yurken/xiaoyan&type=date&legend=top-left&sealed_token=x85YP6wH0H_fYrh94oYtmnIyStrNxFHtj61xHIGYKjPB8Qdy29vTA3irisqFtyM67s1VvYoRyVJGGdWcs3a9H6kF0tymBrZtooxNKTXn9c77rkdN9J9afD9XQEIX1FlPRgHer8BxtCYPPWQukbhLw-hkQuktrEUeEyqpe0g8FKDZbIGtsF80R7AXoRV8" />
    <img alt="小妍 GitHub Star 历史曲线" src="https://api.star-history.com/chart?repos=Yurken/xiaoyan&type=date&legend=top-left&sealed_token=x85YP6wH0H_fYrh94oYtmnIyStrNxFHtj61xHIGYKjPB8Qdy29vTA3irisqFtyM67s1VvYoRyVJGGdWcs3a9H6kF0tymBrZtooxNKTXn9c77rkdN9J9afD9XQEIX1FlPRgHer8BxtCYPPWQukbhLw-hkQuktrEUeEyqpe0g8FKDZbIGtsF80R7AXoRV8" />
  </picture>
</a>

## 许可证

项目代码与文档采用 [Apache License 2.0](LICENSE)。`vendor/opencode/` 保留其原始 MIT License。

“XiaoYan / 小妍”名称、Logo、海报、应用图标和角色形象不包含在代码许可证的品牌授权中；分发修改版时请使用不同的名称与视觉标识。详见 [商标政策](TRADEMARKS.md)、[素材授权说明](ASSETS_LICENSE.md) 和 [NOTICE](NOTICE)。第三方图标、字体及其他素材仍受各自权利人的条款约束。

---

<p align="center">🏆 <a href="https://mp.weixin.qq.com/s/Gm-srG5ZGqIFbDmf7MJM1Q">哈尔滨工业大学首届AI智能创新大赛</a> · 学习科研赛道 · 冠军</p>
