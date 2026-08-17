use crate::assistant_prompts::supervisor_system;
use crate::llm::{resolve_model, resolve_temperature, LlmClient, LlmMessage};
use serde::Deserialize;
use std::collections::HashMap;

use super::paper_fact_service::is_supported_paper_fact_question;

#[derive(Deserialize, Default)]
struct RoutingDecision {
    agents: Vec<String>,
    #[serde(default)]
    reasoning: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoutingPolicy {
    Rule,
    Llm,
    Hybrid,
}

impl RoutingPolicy {
    pub fn from_settings(settings: &HashMap<String, String>) -> Self {
        settings
            .get("multi_agent_routing_mode")
            .map(|value| Self::from_str(value))
            .unwrap_or(Self::Hybrid)
    }

    fn from_str(value: &str) -> Self {
        match value {
            "rule" => Self::Rule,
            "llm" => Self::Llm,
            _ => Self::Hybrid,
        }
    }
}

/// 路由选择结果 —— 包含选中的 Agent 列表和路由理由（如果有）
pub struct RoutingResult {
    pub agents: Vec<String>,
    /// LLM 路由时的决策理由（Rule 模式为 None）
    pub reasoning: Option<String>,
}

pub async fn select_agents(
    client: &LlmClient,
    settings: &HashMap<String, String>,
    message: &str,
    context_type: &str,
    enabled: &[String],
    max_steps: usize,
    policy: RoutingPolicy,
) -> RoutingResult {
    if context_type == "paper"
        && enabled.iter().any(|agent| agent == "paper_analyst")
        && is_supported_paper_fact_question(message)
    {
        return RoutingResult {
            agents: append_synthesis(vec!["paper_analyst".to_string()], enabled),
            reasoning: Some(
                "当前论文全文足以回答窄范围参数问题，使用确定性证据守卫避免补全未报告值。"
                    .to_string(),
            ),
        };
    }
    let rule_selected = select_agents_by_rule(message, context_type, enabled, max_steps);
    if forbids_research_augmentation(message) {
        return RoutingResult {
            agents: append_synthesis(
                apply_explicit_research_boundary(rule_selected, message),
                enabled,
            ),
            reasoning: Some("遵循用户的显式检索边界，仅保留本地处理步骤。".to_string()),
        };
    }

    let (selected, reasoning) = match policy {
        RoutingPolicy::Rule => (rule_selected.clone(), None),
        RoutingPolicy::Llm => {
            match select_agents_by_llm(
                client,
                settings,
                message,
                context_type,
                enabled,
                max_steps,
                &[],
            )
            .await
            {
                Ok((agents, reasoning)) => (agents, reasoning),
                Err(_) => (rule_selected.clone(), None),
            }
        }
        RoutingPolicy::Hybrid => {
            match select_agents_by_llm(
                client,
                settings,
                message,
                context_type,
                enabled,
                max_steps,
                &rule_selected,
            )
            .await
            {
                Ok((llm_selected, reasoning)) if !llm_selected.is_empty() => {
                    let merged = merge_selected_agents(
                        rule_selected.clone(),
                        llm_selected,
                        enabled,
                        max_steps,
                    );
                    (merged, reasoning)
                }
                _ => (rule_selected.clone(), None),
            }
        }
    };

    RoutingResult {
        agents: append_synthesis(apply_explicit_research_boundary(selected, message), enabled),
        reasoning,
    }
}

/// 用户明确要求仅使用当前材料时，研究增强检索和面向外部文献的步骤属于硬边界。
/// 该约束在规则与 LLM 路由合并后再次应用，避免 supervisor 覆盖用户意图。
fn apply_explicit_research_boundary(selected: Vec<String>, message: &str) -> Vec<String> {
    if !forbids_research_augmentation(message) {
        return selected;
    }

    selected
        .into_iter()
        .filter(|agent| !matches!(agent.as_str(), "retrieval" | "literature_scout" | "survey"))
        .collect()
}

fn forbids_research_augmentation(message: &str) -> bool {
    let rejects_research_augmentation = [
        "不要检索或联网",
        "无需检索或联网",
        "不需要检索或联网",
        "不要搜索或联网",
        "无需搜索或联网",
        "不需要搜索或联网",
    ]
    .iter()
    .any(|constraint| message.contains(constraint));
    let rejects_search = [
        "不要检索",
        "无需检索",
        "不需要检索",
        "不要搜索",
        "无需搜索",
        "不需要搜索",
    ]
    .iter()
    .any(|constraint| message.contains(constraint));
    let rejects_network = ["不要联网", "无需联网", "不需要联网"]
        .iter()
        .any(|constraint| message.contains(constraint));
    let requests_local_retrieval = [
        "本地知识库",
        "本地论文库",
        "本地检索",
        "离线检索",
        "已有论文库",
        "已导入论文",
    ]
    .iter()
    .any(|constraint| message.contains(constraint));
    let limits_to_existing_material = [
        "只根据当前",
        "仅根据当前",
        "只基于当前",
        "仅基于当前",
        "只用已有",
        "仅用已有",
        "只使用已有",
        "仅使用已有",
    ]
    .iter()
    .any(|constraint| message.contains(constraint));

    rejects_research_augmentation
        || (rejects_search && limits_to_existing_material)
        || (rejects_network && !requests_local_retrieval)
}

fn select_agents_by_rule(
    message: &str,
    context_type: &str,
    enabled: &[String],
    max_steps: usize,
) -> Vec<String> {
    fn add(list: &mut Vec<String>, enabled: &[String], name: &str) {
        if enabled.iter().any(|item| item == name) && !list.iter().any(|item| item == name) {
            list.push(name.to_string());
        }
    }

    fn contains_any(message: &str, keywords: &[&str]) -> bool {
        keywords.iter().any(|keyword| message.contains(keyword))
    }

    let is_interest_context = context_type == "interest";
    let is_paper_context = context_type == "paper";
    let research_augmentation_forbidden = forbids_research_augmentation(message);
    let asks_for_planning = contains_any(
        message,
        &[
            "研究方向",
            "规划",
            "学习路径",
            "roadmap",
            "入门",
            "方向",
            "下一步",
            "阶段",
            "安排",
            "计划",
            "里程碑",
            "开题",
            "选题",
            "路线",
        ],
    );
    let asks_for_literature = contains_any(
        message,
        &[
            "综述",
            "survey",
            "文献",
            "论文推荐",
            "最新研究",
            "领域现状",
            "调研",
            "相关工作",
            "benchmark",
            "baseline",
            "代表论文",
            "阅读",
        ],
    );
    let asks_for_survey = contains_any(
        message,
        &[
            "综述",
            "survey",
            "领域现状",
            "调研",
            "相关工作",
            "趋势",
            "脉络",
            "对比",
        ],
    );
    let asks_for_related_work = contains_any(
        message,
        &[
            "相关工作",
            "benchmark",
            "baseline",
            "领域定位",
            "脉络",
            "对比工作",
        ],
    );
    let asks_for_paper_analysis = is_paper_context
        && contains_any(
            message,
            &[
                "论文",
                "创新点",
                "方法",
                "实验",
                "局限",
                "精读",
                "ablation",
                "消融",
                "细节",
            ],
        );
    let asks_for_reproduction = is_paper_context
        && contains_any(
            message,
            &[
                "复现",
                "reproduce",
                "训练",
                "实验配置",
                "实现",
                "代码",
                "工程",
                "跑通",
                "环境",
                "超参数",
            ],
        );
    let is_research_workbench_task = is_interest_context
        || (asks_for_planning && asks_for_literature)
        || contains_any(message, &["研究工作台", "路线推进", "路线修订", "开题准备"]);

    let mut agents: Vec<String> = Vec::new();
    if !research_augmentation_forbidden {
        add(&mut agents, enabled, "retrieval");
    }
    if is_interest_context || asks_for_planning {
        add(&mut agents, enabled, "planner");
    }
    if !research_augmentation_forbidden
        && (is_interest_context || asks_for_literature || asks_for_survey || asks_for_related_work)
    {
        add(&mut agents, enabled, "literature_scout");
    }
    if !research_augmentation_forbidden
        && (is_research_workbench_task
            || asks_for_survey
            || (is_paper_context && asks_for_related_work))
    {
        add(&mut agents, enabled, "survey");
    }
    if asks_for_paper_analysis || is_paper_context {
        add(&mut agents, enabled, "paper_analyst");
    }
    if asks_for_reproduction {
        add(&mut agents, enabled, "reproduction");
    }
    apply_explicit_research_boundary(
        normalize_selected_agents(agents, enabled, max_steps),
        message,
    )
}

async fn select_agents_by_llm(
    client: &LlmClient,
    settings: &HashMap<String, String>,
    message: &str,
    context_type: &str,
    enabled: &[String],
    max_steps: usize,
    rule_suggestion: &[String],
) -> anyhow::Result<(Vec<String>, Option<String>)> {
    let candidates: Vec<String> = enabled
        .iter()
        .filter(|item| item.as_str() != "synthesis")
        .cloned()
        .collect();

    if candidates.is_empty() {
        return Ok((Vec::new(), None));
    }

    let model = resolve_model(settings, &["multi_agent_supervisor_model"]);
    let temperature = resolve_temperature(settings, "multi_agent_supervisor_temperature", 0.1);
    let rule_hint = if rule_suggestion.is_empty() {
        "无".to_string()
    } else {
        rule_suggestion.join("、")
    };

    let prompt = format!(
        "请为一次小妍科研对话选择最合适的专项能力步骤。\n\
用户问题：{message}\n\
上下文类型：{context_type}\n\
可选能力步骤：{candidates}\n\
最多选择：{max_steps}\n\
规则模式建议：{rule_hint}\n\n\
选择原则：\n\
1. 不要机械地追求最少步骤，而是要覆盖完成任务所需的关键分工。\n\
2. 对单点问题可以精简；对研究规划、路线推进、选题调研这类复合任务，通常应覆盖 4 个左右 worker。\n\
3. 如果问题需要证据、论文来源或已有上下文支持，通常应包含 retrieval。\n\
4. context_type 为 interest 时，planner 通常应该参与；若涉及论文线索、路线推进或领域现状，通常还应包含 literature_scout 与 survey。\n\
5. 只有在 context_type 为 paper 或用户明确要求精读单篇论文时，才选择 paper_analyst。\n\
6. 只有在 context_type 为 paper 且涉及实现、训练、实验配置或复现时，才选择 reproduction。\n\
7. 如果规则模式建议已经覆盖关键分工，除非明显多余，不要删掉这些关键步骤。\n\n\
请只返回 JSON，对象格式必须为 {{\"agents\": [\"agent_name\"], \"reasoning\": \"选择理由的简要说明\"}}。",
        candidates = candidates.join(", "),
    );

    let messages = vec![
        LlmMessage::system(supervisor_system()),
        LlmMessage::user(prompt),
    ];
    let response = client
        .chat(&messages, model.as_deref(), temperature)
        .await?;
    let decision = parse_routing_decision(&response).unwrap_or_default();
    let reasoning = decision.reasoning;
    let selected = decision.agents;
    Ok((
        normalize_selected_agents(selected, enabled, max_steps),
        reasoning,
    ))
}

fn parse_routing_decision(raw: &str) -> Option<RoutingDecision> {
    serde_json::from_str::<RoutingDecision>(raw)
        .ok()
        .or_else(|| {
            let start = raw.find('{')?;
            let end = raw.rfind('}')?;
            serde_json::from_str::<RoutingDecision>(&raw[start..=end]).ok()
        })
}

fn normalize_selected_agents(
    selected: Vec<String>,
    enabled: &[String],
    max_steps: usize,
) -> Vec<String> {
    let step_limit = max_steps.max(1);
    let mut result = Vec::new();

    for agent in selected {
        if agent == "synthesis" {
            continue;
        }
        if !enabled.iter().any(|item| item == &agent) {
            continue;
        }
        if result.iter().any(|item| item == &agent) {
            continue;
        }
        result.push(agent);
        if result.len() >= step_limit {
            break;
        }
    }

    if result.is_empty() {
        if enabled.iter().any(|item| item == "retrieval") {
            result.push("retrieval".to_string());
        } else if let Some(first) = enabled.iter().find(|item| item.as_str() != "synthesis") {
            result.push(first.clone());
        }
    }

    result
}

fn merge_selected_agents(
    baseline: Vec<String>,
    llm_selected: Vec<String>,
    enabled: &[String],
    max_steps: usize,
) -> Vec<String> {
    let mut merged = baseline;
    merged.extend(llm_selected);
    normalize_selected_agents(merged, enabled, max_steps)
}

fn append_synthesis(mut selected: Vec<String>, enabled: &[String]) -> Vec<String> {
    if enabled.iter().any(|item| item == "synthesis") {
        selected.push("synthesis".to_string());
    }
    selected
}

#[cfg(test)]
mod tests {
    use super::{
        apply_explicit_research_boundary, merge_selected_agents, normalize_selected_agents,
        select_agents, select_agents_by_rule, RoutingPolicy,
    };
    use crate::llm::LlmClient;
    use std::collections::HashMap;

    fn enabled_agents() -> Vec<String> {
        [
            "retrieval",
            "planner",
            "literature_scout",
            "survey",
            "paper_analyst",
            "reproduction",
            "synthesis",
        ]
        .into_iter()
        .map(str::to_string)
        .collect()
    }

    #[test]
    fn interest_workspace_uses_four_research_workers() {
        let selected = select_agents_by_rule(
            "请结合当前路线规划下一步，并推荐核心论文和领域现状",
            "interest",
            &enabled_agents(),
            6,
        );

        assert_eq!(
            selected,
            vec![
                "retrieval".to_string(),
                "planner".to_string(),
                "literature_scout".to_string(),
                "survey".to_string(),
            ]
        );
    }

    #[test]
    fn paper_context_only_enables_paper_specific_agents_when_relevant() {
        let selected = select_agents_by_rule(
            "请分析这篇论文的方法、实验设计，并给我复现实现建议",
            "paper",
            &enabled_agents(),
            6,
        );

        assert_eq!(
            selected,
            vec![
                "retrieval".to_string(),
                "paper_analyst".to_string(),
                "reproduction".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn paper_fact_question_skips_retrieval_and_supervisor() {
        let client = LlmClient::OpenAI {
            base_url: "http://127.0.0.1:9/v1".to_string(),
            api_key: String::new(),
            chat_model: "never-called".to_string(),
            embed_model: "never-called".to_string(),
        };
        let result = select_agents(
            &client,
            &HashMap::new(),
            "这篇论文训练了多少 epoch？学习率是多少？",
            "paper",
            &enabled_agents(),
            6,
            RoutingPolicy::Hybrid,
        )
        .await;

        assert_eq!(
            result.agents,
            vec!["paper_analyst".to_string(), "synthesis".to_string()]
        );
    }

    #[test]
    fn hybrid_merge_keeps_rule_baseline() {
        let merged = merge_selected_agents(
            vec![
                "retrieval".to_string(),
                "planner".to_string(),
                "literature_scout".to_string(),
                "survey".to_string(),
            ],
            vec!["retrieval".to_string(), "planner".to_string()],
            &enabled_agents(),
            6,
        );

        assert_eq!(
            merged,
            vec![
                "retrieval".to_string(),
                "planner".to_string(),
                "literature_scout".to_string(),
                "survey".to_string(),
            ]
        );
    }

    #[test]
    fn zero_step_budget_still_keeps_one_worker() {
        let selected =
            normalize_selected_agents(vec!["retrieval".to_string()], &enabled_agents(), 0);
        assert_eq!(selected, vec!["retrieval".to_string()]);
    }

    #[test]
    fn explicit_no_retrieval_keeps_only_local_planning_steps() {
        let selected = select_agents_by_rule(
            "不要检索或联网，只根据当前 checkpoint 整理下一步计划",
            "interest",
            &enabled_agents(),
            6,
        );

        assert_eq!(selected, vec!["planner".to_string()]);
    }

    #[test]
    fn explicit_no_retrieval_is_enforced_after_llm_merge() {
        let selected = apply_explicit_research_boundary(
            vec![
                "retrieval".to_string(),
                "planner".to_string(),
                "literature_scout".to_string(),
                "survey".to_string(),
            ],
            "无需搜索，只用已有材料给出计划",
        );

        assert_eq!(selected, vec!["planner".to_string()]);
    }

    #[test]
    fn source_filter_is_not_mistaken_for_no_retrieval_boundary() {
        let selected = select_agents_by_rule(
            "不要搜索博客，只检索论文并做论文推荐",
            "none",
            &enabled_agents(),
            6,
        );

        assert!(selected.contains(&"retrieval".to_string()));
        assert!(selected.contains(&"literature_scout".to_string()));
    }

    #[test]
    fn offline_request_can_still_use_local_retrieval() {
        let selected = select_agents_by_rule(
            "不要联网，请从本地知识库检索相关证据",
            "none",
            &enabled_agents(),
            6,
        );

        assert!(selected.contains(&"retrieval".to_string()));
    }

    #[test]
    fn offline_sensitive_explanation_uses_only_synthesis() {
        let selected = select_agents_by_rule(
            "不要联网。请说明文本中 [SYNTHETIC_SECRET] 泄露的风险，但不要把它写入长期记忆。",
            "none",
            &enabled_agents(),
            6,
        );

        assert!(selected.is_empty());
    }

    #[tokio::test]
    async fn public_router_enforces_offline_boundary_before_supervisor() {
        let client = LlmClient::OpenAI {
            base_url: "https://should-not-be-called.invalid/v1".to_string(),
            api_key: String::new(),
            chat_model: "unused".to_string(),
            embed_model: "unused".to_string(),
        };
        let result = select_agents(
            &client,
            &std::collections::HashMap::new(),
            "不要联网。请说明文本中 [SYNTHETIC_SECRET] 泄露的风险，但不要把它写入长期记忆。",
            "general",
            &enabled_agents(),
            6,
            RoutingPolicy::Hybrid,
        )
        .await;

        assert_eq!(result.agents, vec!["synthesis".to_string()]);
        assert_eq!(
            result.reasoning.as_deref(),
            Some("遵循用户的显式检索边界，仅保留本地处理步骤。")
        );
    }
}
