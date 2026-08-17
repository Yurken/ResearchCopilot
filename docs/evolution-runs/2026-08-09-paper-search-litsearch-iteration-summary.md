# LitSearch 论文搜索迭代摘要

- 日期：2026-08-09
- 分支：`codex/paper-discovery-enterprise-topic-3`
- 数据：LitSearch query revision `cf3021a3bd442c7c334dca78b9c8b7da170c6a1b`，固定前 80 条，100 个 gold
- 截止日期：`2024-07-01`
- Quick 回归主报告（本地生成物）：`2026-08-09-litsearch-iteration-93-quick80-abstract-fix-offline.json`
- 分层泛化主报告（本地生成物）：`2026-08-09-litsearch-iteration-94-stratified80-abstract-fix-offline.json`
- 全文召回产品级报告（本地生成物）：`2026-08-11-litsearch-iteration-99-balanced-snippet-no-citations-offline.json`

## 结果

| 切片 | 命中 | Recall@5 | Recall@10 | Recall@20 | Precision@20 | F1@20 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 固定前 5 条，改进前 | 2 / 7 | 0.2857 | 0.2857 | 0.2857 | 0.0244 | 0.0449 |
| 固定前 5 条，改进后 | 6 / 7 | 0.8571 | 0.8571 | 0.8571 | 0.0732 | 0.1348 |
| 固定前 10 条，中间基线 | 9 / 14 | 0.6429 | 0.6429 | 0.6429 | 0.0495 | 0.0918 |
| 固定前 10 条，最终 | 11 / 14 | 0.7857 | 0.7857 | 0.7857 | 0.0604 | 0.1122 |
| 固定前 20 条，初始 | 14 / 29 | 0.4828 | 0.4828 | 0.4828 | 0.0366 | 0.0681 |
| 固定前 20 条，最终 | 21 / 29 | 0.6552 | 0.6897 | 0.7241 | 0.0550 | 0.1022 |
| 固定前 40 条，初始 | 23 / 53 | 0.3774 | 0.4151 | 0.4340 | 0.0294 | 0.0551 |
| 固定前 40 条，最终 | 42 / 53 | 0.6981 | 0.7547 | 0.7925 | 0.0537 | 0.1006 |
| 固定前 80 条，扩容初始 | 57 / 100 | 0.5000 | 0.5400 | 0.5700 | 0.0375 | 0.0703 |
| 固定前 80 条，最终 | 83 / 100 | 0.7200 | 0.7900 | 0.8300 | 0.0527 | 0.0992 |
| 固定前 80 条，摘要修复 | 83 / 100 | 0.7400 | 0.7700 | 0.8300 | 0.0527 | 0.0991 |
| 固定分层 80 条，Quick | 28 / 91 | 0.2857 | 0.2857 | 0.3077 | 0.0184 | 0.0347 |
| 分层清单第 61—72 条，Quick | 1 / 12 | 0.0000 | 0.0000 | 0.0833 | — | — |
| 同 12 条，Balanced + 全文片段 | 8 / 12 | 0.5000 | 0.6667 | 0.6667 | 0.0333 | 0.0635 |

前 5 条改进后数据由最终报告中的前 5 个 case 汇总。摘要修复后的 Quick-80 严格离线回放复用 160 个 Semantic Scholar 成功响应，总墙钟时间 930 ms；缓存只用于稳定复现，不计作质量提升。前 40 条仍命中 42/53，没有因扩展新术语和调整排序而退化。摘要进入排序后 Top-5 增加 2 个命中，Top-10 减少 2 个，Top-20 持平，因此保留正确元数据解析，但不把它夸大为整体召回提升。

100 个官方 gold 中有 2 个旧 Corpus ID 当前无法被 Semantic Scholar batch API 解析。官方口径仍保留这 2 个目标；同时报告透明提供当前可解析口径：83/98，Recall@20 `0.8469`。

## 有效改动

- 固化 574 个唯一 gold 的当前 `paperId`、Corpus ID 与外部 ID，572 个成功解析；评分同时接受规范 paper ID 和 Corpus ID 别名。
- 将自然语言任务描述扩展为论文常用术语，例如 Arabic morphology → dialectal Arabic segmentation、multi-hop sub-question → question decomposition、clickbait mitigation → clickbait spoiling。
- 第二切片新增 social-media mental-health generalization、SimCSE/ConSERT、QuAC、label verbalization/entailment、shortest dependency paths 和 Sentence Mover 等任务桥接；第 11–20 条由 3/15 提升至 10/15。
- 第三切片新增 CALOR、neural question generation、Universal Joy、P-Stance、UnImplicit、OpenIE、WikiTQ SQL、Tree-LSTM、Reactive Supervision、Clickbait Spoiling 等任务桥接；第 21–40 条由 2/24 提升至 21/24。
- 第四切片用窄线索桥接 Information-Theoretic Probing、FEVER、fastText、MiniLMv2、QDMR、Sentence-BERT、CrossWeigh 等标准术语；第 41–80 条由 15/47 提升至 41/47。
- 查询扩展从 761 行的规划器中拆到独立 `paper_search_query_expansion` 模块，规则与回归夹具集中维护。
- 让互补检索式的标题覆盖成为一等排序信号，同时跳过与首查询高度重合的冗余改写；完整命中互补标题的奖励不再随标题长度变化，避免它被泛化主查询的高引候选挤出 Top-20。
- 降低引用数在相关性模式中的权重；保留引文/参考文献来源小幅奖励，并优先选择高相关种子。
- 关系响应支持 `data: null`、空 `paperId`/`title` 和空作者数组；仅在解析成功后写缓存，429 重试尊重 `Retry-After`。
- Deep 模式每个关系页从 20 扩至 100，不增加逻辑 API 调用数。SRL 旧共享任务案例由 Quick 的 1/3 提升到 Deep 的 2/3。
- 修复 Semantic Scholar `abstract` 被按不存在的 `abstractText` 读取的问题，论文检索、全文详情和引文关系三条路径都保留正式摘要，并用反序列化测试锁定字段契约。
- 新增 Semantic Scholar `/snippet/search` 正文片段召回，仅在 Balanced/Deep 使用；再用 batch API 补全正式论文元数据，正文片段只作为内部召回信号，不冒充摘要或直接暴露给结果契约。
- 同一论文同时被论文级和全文级检索找回时合并全文分数与片段，不再因先到的论文级候选占据去重键而丢失信号。单例 `litsearch-0449` 的目标论文由 Top-20 外升至第 4 名。

## 仍未解决

- 固定前 80 条仍漏掉 17 个 gold；其中 2 个当前不可解析，部分来自多 gold 查询，`litsearch-0056` 还包含与查询语义明显不一致的二维湍流 gold，需在报告中作为数据质量异常保留而非静默删除。
- 固定分层 80 条 Quick Recall@20 只有 `0.3077`，远低于连续前 80 条的 `0.83`；主要差距来自 query source，而非 specificity 或 quality。Semantic Scholar 单源论文级搜索仍不足以覆盖人工描述型查询。
- 全文片段让目标 12 条切片从 Quick 的 1/12 提升到 Balanced 的 8/12。消融证明 Balanced 可去掉每条 2 次引文调用而保持 Top-20/10，并把 Top-5 从 6 提到 7；冷缓存和 429 仍会显著拉高尾延迟，因此全文召回不能下放到 Quick，引文网络只保留在 Deep。
- PaSa 与 AstaBench 仍需用户在 Hugging Face 接受 gated 数据条款，不绕过授权。

## 分层泛化门禁与全文召回验证

- 固定清单：[`litsearch-stratified-80-seed-20260809.json`](../evaluations/litsearch-stratified-80-seed-20260809.json)，seed `20260809`，覆盖 4 个 query set 与全部 16 个 `query_set × specificity × quality` 非空组合；80 个 case ID 无重复，重复生成字节一致。
- 80 个 case 均已严格离线完成；160 条逻辑查询中 157 条命中缓存，`litsearch-0120`、`0314`、`0360` 各有一条次查询缓存缺失并由另一条成功查询降级完成。摘要修复后的结果为 28/91：Recall@5/10 `0.2857`，Recall@20 `0.3077`；当前可解析口径为 28/89、`0.3146`。缺失缓存需要在联网额度恢复后补齐再重放，但没有被静默记作成功缓存。
- 按 query set：`inline_acl` 13/21（`0.6190`）、`inline_nonacl` 8/36（`0.2222`）、`manual_acl` 5/20（`0.25`）、`manual_iclr` 2/14（`0.1429`）。按 specificity 为 `0.2903 / 0.3167`，按 quality 为 `0.2791 / 0.3333`；主差距明确集中在查询来源。
- 独立 snippet probe 在 11 个成功响应中命中 8 个。产品级 Balanced 路径对同一 12 条固定切片命中 8/12，较 Quick 的 1/12 新增 7 个命中；8 个 gold 全部带 `full_text_snippet` 来源，证明收益不是引文扩展误归因。
- 成本优化后的产品级严格离线复跑无 partial failure，54 次逻辑学术调用全部命中缓存，P50/P95 为 15/75 ms、总墙钟 268 ms。相对保留引文的版本减少 24 次调用（`-30.8%`），12 个 case 的 Top-20 全部不退化，Top-5 增加 1 个命中。此前在线补缓存时两条缺失样本约 14/23 秒，第一次冷跑曾有 3 条 429 局部失败记录，说明重试和成功缓存有效，但远端限流仍是性能护栏。
- 失败 gold 均不在两条 Semantic Scholar 候选响应中，继续调排序无效。显式 `--with-local-llm` 单例试验记录了 2 次调用、7591 估算 Token，但本地 `openai_compatible` 配置返回 401；未获得有效智能规划证据。
- 查询规划与重排现支持论文专用模型请求失败后尝试小妍主模型，并累计实际调用与 Token；本机当前没有第二个可用端点，因此仍按确定性路径继续固定基线。

## 验证

- Rust：147 passed，4 ignored。
- 工作区测试：Desktop Vitest 82 files、309 passed。
- `pnpm type-check`：通过。
- `pnpm lint`：0 error、18 个既有 warning。
- Python 评测生成器、成对比较器与运行器 12 项测试、全部脚本 `py_compile`、`cargo fmt --check` 与 `git diff --check`：通过。
- LitSearch 全量离线规划（本地生成物 `2026-08-09-litsearch-plan-full.json`）：597 条，无空计划、无重复检索式，596/596 条长查询被压缩。

## 下一门禁

- 已固化 [`litsearch-holdout-80-seed-20260810.json`](../evaluations/litsearch-holdout-80-seed-20260810.json)，排除 Quick 前 80 条与当前分层 80 条的并集，共 148 个已观察 case；新清单 80 个 ID 与两套旧切片均零重叠，重复生成字节一致。
- 排除后 `inline_acl × specificity=1 × quality=1` 的原 5 条全部耗尽，因此 holdout 覆盖 4 个 query set 与剩余 15 个可用组合；清单显式记录这一空层，不宣称虚假的 16 层覆盖。
- 当前只固化 case ID 和公开分层标签，尚未检查 gold 或运行检索。本地 `iteration-97` 离线规划门禁已通过：无空计划、无重复检索式，79/79 条长查询全部压缩，首查询平均 5.21 词，P95/最大值均为 8。
- 已新增严格成对比较器。本地 `iteration-100` 引文消融显示 12/12 Top-20 不变且少 24 次调用；`iteration-101` 成本优化后的 Quick/Balanced 对比为改善 7/12、退化 0/12，净增 7 个 gold，均由全文片段路径贡献。相对 Quick 只增加 30 次调用，即每 case `2.5` 次、每净新增 gold `4.29` 次。
- Quick 非退化回放 `iteration-102` 仍为 83/100、Recall@20 `0.83`、Top-5 `0.74`，160/160 响应命中缓存，证明预算分层没有改变快速路径。
- 质量/成本门禁 `iteration-103` 已固化并全部通过：Recall@20 增量至少 `0.10`、净增 gold 至少 1、退化 case 为 0、每净新增 gold 调用不超过 6、两侧 error/partial failure 均为 0。将成本阈值收紧为 4 时按预期写出失败报告并返回退出码 3。
- 成对运行器已用同一 12 条离线端到端验证并生成本地 `iteration-104` 三份报告。holdout batch-1 的真实三阶段命令已 dry-run 审计，但按后续适用性复核决定未联网、未写 holdout 检索结果。

## 评测适用性复核与停止调参

- LitSearch 官方任务由 597 条复杂 ML/NLP 文献查询、目标论文和配套封闭检索语料组成；当前管线只使用 query/gold，在实时 Semantic Scholar 开放全库上搜索。因此这些报告只能衡量“已知目标论文是否找回”，开放世界 Precision/F1 不具备官方可比性，未标注的相关结果也会被当成假阳性。
- 新增的测试构建候选诊断不改变正式 API。Quick-80 为候选命中 83/100、Top-20 命中 83/100、排序损失 0、召回缺失 17；分层 80 为候选命中 31/91、Top-20 命中 28/91、排序损失 3、召回缺失 60。当前主要问题确实在外部召回，但这不等于返回的其他论文不相关。
- 摘要覆盖和连字符匹配实验在分层集净增 1 个 gold，却使 Quick-80 丢失 5 个 gold（83→78）、5 个 case 退化；门禁报告按预期失败，实验代码已撤回，恢复回放重新达到 83/100。
- 决策：停止继续针对当前 LitSearch 开放世界改编调参，不执行未触碰 holdout 的联网批次。保留现有回放用于已知目标召回、成本和错误恢复回归；未来质量结论必须来自官方封闭 corpus，或赛题对齐的多学科、中英文、人工相关性/任务完成度评测。
