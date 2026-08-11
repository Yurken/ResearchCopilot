# 论文搜索公开集评测

## LitSearch

> 适用边界：LitSearch 官方评测把 query/gold 与封闭论文 corpus 配套使用；本仓库当前运行器在实时 Semantic Scholar 开放全库上搜索，因此只把它作为“已知目标论文召回”和成本/故障回归，不把开放世界 Precision/F1 当作官方可比结果。2026-08-11 起暂停继续用该改编集调参，也不执行下述 holdout 联网批次；命令保留用于复现实验历史。恢复质量迭代前，应先接入官方封闭 corpus，或建立多学科、中英文的人工相关性与任务完成度评测。

1. `pnpm eval:paper-search:prepare`
2. `pnpm eval:paper-search:gold`
3. `pnpm eval:paper-search:plan -- --output docs/evolution-runs/YYYY-MM-DD-litsearch-plan.json`
4. `pnpm eval:paper-search:litsearch -- --samples 80 --depth quick`
5. `pnpm eval:paper-search:litsearch -- --samples 80 --depth quick --offline`

跨查询来源验证使用固定种子分层清单：

1. `pnpm eval:paper-search:stratify -- --samples 80 --seed 20260809`
2. `pnpm eval:paper-search:litsearch -- --case-manifest docs/evaluations/litsearch-stratified-80-seed-20260809.json --depth quick`
3. 缓存补齐后，在上一步末尾增加 `--offline` 做严格离线回放。

分层器按 `query_set × specificity × quality` 的 16 个非空组合分配样本，每层至少一条，其余按剩余总体比例分配；同一数据、样本数与 seed 会产生字节级一致的清单。清单固定 case ID 与数据集 SHA-256，避免后续评测因随机抽样漂移。
若需要控制限流，可在 `--case-manifest` 后增加 `--offset 12 --samples 12` 分批补缓存；最终指标仍应对完整清单做一次 `--offline` 回放。

建立未触碰门禁时，可显式排除连续基线和已经分析过的清单：

```bash
pnpm eval:paper-search:stratify -- \
  --samples 80 \
  --seed 20260810 \
  --exclude-first 80 \
  --exclude-manifest docs/evaluations/litsearch-stratified-80-seed-20260809.json \
  --output docs/evaluations/litsearch-holdout-80-seed-20260810.json
```

输出会记录排除 ID 数量、SHA-256 和因排除而耗尽的分层，不把缺失层静默伪装成完整覆盖。本仓库当前 holdout 排除 148 个已观察 case，与两套旧切片均零重叠；`inline_acl × specificity=1 × quality=1` 的 5 条原始样本已全部被旧切片使用，因此新清单覆盖剩余 15 个可用组合。生成器回归测试运行 `pnpm eval:paper-search:test`。

失败分析可运行 `pnpm eval:paper-search:inspect -- --offset 0 --samples 5`。该命令默认只读本地 `gold_metadata.jsonl` 快照，可严格离线使用，也不会读取或输出 API Key；仅在显式传入 `--online-details` 时查询摘要、年份和刊会。

准备脚本会校验官方文件的 SHA-256，并把 Parquet 转为 Rust 评测读取的 JSONL。原始数据和转换结果都位于 `data/evaluations/`，不会进入 Git。

`eval:paper-search:gold` 使用 Semantic Scholar 官方 batch API，把 LitSearch 发布时的 Corpus ID 解析为当前规范 `paperId`、Corpus ID 与外部 ID；原始响应和 JSONL 快照同样只保存在忽略目录。这样可识别第三方知识图谱合并或迁移 ID，避免把已找回的同一论文误判成漏召回。

运行器调用与桌面命令相同的 Rust 检索管线，按 Semantic Scholar Corpus ID 计算 Precision、Recall、F1，同时记录 API、LLM、Token 和延时。默认固定截止日期为 `2024-07-01`，避免未来论文改变测试边界。

官方 Recall 始终使用数据集原始 gold 分母。若 gold 元数据快照中存在当前无法解析的旧 Corpus ID，报告会额外给出 `currently_resolvable_gold_count` 和 `recall_resolvable_at_*`，用于区分检索失败与第三方知识图谱不可达；该辅助口径不会覆盖或替代官方指标。

测试构建还会输出候选级诊断：每个 gold 的启发式候选排名、最终排名、分数与发现来源，以及聚合的 `candidate_recall`、`ranking_loss_count` 和 `retrieval_miss_count`。这些字段用于判断失败发生在召回还是 Top-K 排序，不进入正式桌面端响应契约。

成功的 Semantic Scholar JSON 响应默认缓存到 `data/evaluations/paper-search-cache/semantic-scholar/`。同一查询、截止日期、返回数量和引文关系会优先复用缓存，降低限流与实时排序波动；缓存目录不会进入 Git。使用 `--offline` 可做严格离线回放，缺少任一响应时会失败且不会读取 API Key；`--no-cache` 可显式禁用。报告中的 `academic_api_calls` 是策略预算内的逻辑调用数，`response_cache.hits/misses` 用于区分缓存复用与需要联网的请求。

`eval:paper-search:plan` 不访问网络，会遍历全部查询并检查空计划、重复检索式、首查询长度与长问题压缩率；适合每次修改查询规划器后先做全量回归。传入 `--case-manifest` 可只评测固定清单并保持清单顺序，例如：`pnpm eval:paper-search:plan -- --case-manifest docs/evaluations/litsearch-holdout-80-seed-20260810.json --output docs/evolution-runs/YYYY-MM-DD-litsearch-holdout-plan.json`。

同一 case 集上的策略对比使用成对比较器：

```bash
pnpm eval:paper-search:compare -- \
  --baseline docs/evolution-runs/quick.json \
  --candidate docs/evolution-runs/balanced.json \
  --output docs/evolution-runs/quick-vs-balanced.json
```

两份报告必须具有相同 case ID/顺序、截止日期、返回上限、查询和 gold；基线为候选集超集时必须显式传 `--allow-baseline-superset`。输出同时报告聚合指标差、改善/退化 case、净新增 gold 的召回来源，以及每 case、每净新增 gold 的额外 API 调用。源报告缓存统计如果不等于成对比较范围，会标记为不可直接归因，避免把全量缓存口径误套到子集。

需要直接运行同一切片的 Quick/Balanced 并执行门禁时，使用成对运行器：

```bash
pnpm eval:paper-search:paired -- \
  --case-manifest docs/evaluations/litsearch-holdout-80-seed-20260810.json \
  --offset 0 \
  --samples 12 \
  --run-name 2026-08-16-litsearch-holdout-batch1
```

运行器按顺序生成 `*-quick.json`、`*-balanced.json` 和 `*-paired.json`，三阶段任一失败即停止；默认拒绝覆盖已有输出。可先加 `--dry-run` 审计命令，不会联网或写报告。默认采用当前小批量推广门槛：Recall@Top-K 增量至少 `0.10`、净新增 gold 至少 1、退化 case 为 0、每净新增 gold 额外学术调用不超过 6，且两条路径均不得有 error/partial failure。比较器始终先写报告；门禁失败时退出码为 3。阈值均可通过对应参数调整，探索性运行可显式使用 `--no-gate`。

运行器优先使用 `SEMANTIC_SCHOLAR_API_KEY`；未设置时会只读复用小妍数据库中的 Semantic Scholar Key，不打印或写入报告。可传 `--no-local-api-key` 禁用。仍建议从 5 条烟雾切片逐步扩大。

默认评测只使用确定性本地查询规划，避免无意产生模型费用。需要验证竞赛形态的智能规划与重排时，显式增加 `--with-local-llm`；运行器只读复用小妍的论文检索模型或主模型配置，不把 API Key 写入报告，并记录模型名、LLM 调用数和估算 Token。建议先在失败小批次上运行，再决定是否扩展到完整分层样本。

针对人工描述型查询，可独立测量 Semantic Scholar 正文片段检索：`pnpm eval:paper-search:snippets -- --case-manifest docs/evaluations/litsearch-stratified-80-seed-20260809.json --offset 60 --samples 12`。该探针按 gold Corpus ID 报告 Recall@5/10/20，响应缓存与论文搜索缓存隔离。固定样本验证增益后，产品管线已把 snippet 召回接入 Balanced/Deep；端到端复现使用 `pnpm eval:paper-search:litsearch -- --case-manifest docs/evaluations/litsearch-stratified-80-seed-20260809.json --offset 60 --samples 12 --depth balanced --result-limit 20`。Quick 不调用全文接口，Balanced 不扩展引文，Deep 才保留引文网络；正文片段只参与内部召回和排序，不会伪装成论文摘要。

PaSa 和 AstaBench 都要求登录 Hugging Face 并接受数据条款；不要通过镜像绕过授权。接受条款并提供本地文件后，再增加对应适配器。
