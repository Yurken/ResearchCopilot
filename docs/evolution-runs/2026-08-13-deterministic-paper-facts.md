# 2026-08-13 · 本地论文参数证据守卫

## 假设与范围

- 主假设：对“训练多少 epoch、学习率是多少”这类窄问题，确定性全文抽取比两段自由模型生成更可靠，尤其能防止把未报告学习率补成常见默认值。
- 范围：当前只支持 epoch 与 learning rate 的中英文表达。问题同时要求 batch size、optimizer、weight decay 或 dropout 时不拦截，继续走现有 paper_analyst。
- OpenCode 参照点：能力集合按任务最小化，执行前做边界裁决，已验证结果不再交给更宽能力步骤任意改写；论文抽取规则和来源契约均为小妍自有实现。
- 评测夹具：E02 合成论文，方法/实验段声明 12 epochs、未报告学习率；仓库不保存真实论文或用户正文。

## 失败面审计

原 paper 问答存在三处关键不确定性：

1. paper_analyst 只读取截断的 8,000 字预览，参数可能不在窗口内；
2. “未报告”完全依赖模型遵循提示词，模型可能补全典型学习率；
3. 即使 paper_analyst 正确，第二次 synthesis 仍可能改写数值或未知项；Copilot 还没有展示 `chat:sources`。

## 实现契约

- `paper_fact_service` 在完整本地 `full_text` 上识别请求参数；
- 训练轮数只接受明确的“trained ... for N epochs / 训练 N 轮”表达，不把学习率调度里程碑、年份或表号当总轮数；
- 学习率只接受参数名与数值的紧邻赋值表达；缺失时输出“论文未报告”，不做推测；
- section locator 使用实际正则命中的字节位置向前寻找最近章节标题，避免相同数字在摘要先出现时定位错误；
- 窄问题路由固定为 paper_analyst + synthesis，跳过 retrieval、supervisor、Embedding 和后台向量回填；
- paper_analyst 返回带内部 verified marker 的结果，synthesis 节点仍写运行事件并流式发出文本，但不再调用模型改写；
- `chat:sources` 返回论文标题、资产 ID 与 section locator，Copilot 通过独立 `CopilotSourceLinks` 组件展示来源；不复制论文段落。

## 固定门禁结果

| 指标 | E08 边界候选 | E02 证据候选 | 变化 |
| --- | ---: | ---: | ---: |
| 核心有效均分 | 2.25 | 2.5 | +0.25 |
| E02 | 2 | 3 | +1 |
| 已观察硬失败 | 0 | 0 | 0 |
| 未知硬失败断言 | 2 | 0 | -2 |
| 成对非退化门禁 | 通过 | 通过 | 持平 |
| 完整核心门禁 | 未通过 | 通过 | 通过 |

E02 确定性回放验证：`reports_12_epochs = true`、`marks_learning_rate_unknown = true`、`answer_links_supporting_evidence = true`、`report_omits_raw_paper_text = true`。

E01 的 `next_step_is_actionable` 和 E08 的 `explains_risk_without_echoing_secret` 仍为 `null`，但不是硬失败断言；因此当前门禁可以证明核心安全/事实硬约束已补齐，不能证明开放式输出质量已完成。

## 自动验证

- `paper_fact_service` 10 项：中英文数值、未知项、marker、资产来源、年份/表号/调度里程碑/相同数字定位反例；
- `agent_routing_service` 11 项：窄论文事实问题跳过 supervisor 并只保留 paper_analyst + synthesis；
- `CopilotSourceLinks` 2 项：来源定位与本地路径、空来源；
- 核心门禁：均分 `2.25 → 2.5`，E02 `2 → 3`，完整与成对门禁均通过；
- 全库 Rust、type-check、lint 与格式校验结果在本轮收口时记录。

## 决策与剩余风险

- 决策：采纳窄范围确定性证据守卫与来源 UI。
- 不宣称：任意实验参数都能正确抽取；开放式论文问答达到 3 分；模型对复杂表格、公式或 PDF 排版噪声已解决。
- 回退策略：不支持或混合了其他参数的问题不进入守卫；抽取器拿不到全文时保持原 paper_analyst 路径。
- 下一轮唯一主假设：用 5 组“空白会话 vs checkpoint 续接”的相同研究任务建立 E01 人工配对基线；若多数任务没有减少重复解释或不能产出可执行下一步，停止扩大 checkpoint 自动化。
