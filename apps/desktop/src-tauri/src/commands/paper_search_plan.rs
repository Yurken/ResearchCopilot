use super::paper_search_query_expansion::expand_related_task_queries;
use crate::llm::{resolve_temperature, LlmClient, LlmMessage};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const MAX_SEARCH_QUERIES: usize = 4;
const ENGLISH_SEARCH_STOP_WORDS: &[&str] = &[
    "a",
    "additional",
    "an",
    "and",
    "any",
    "approach",
    "approaches",
    "are",
    "as",
    "at",
    "available",
    "be",
    "been",
    "both",
    "building",
    "by",
    "can",
    "contain",
    "could",
    "discuss",
    "discussed",
    "discussing",
    "does",
    "explore",
    "explores",
    "exploring",
    "find",
    "finding",
    "focus",
    "focuses",
    "focused",
    "focusing",
    "for",
    "foundational",
    "from",
    "had",
    "has",
    "have",
    "in",
    "into",
    "is",
    "it",
    "interested",
    "level",
    "like",
    "list",
    "literature",
    "may",
    "me",
    "method",
    "methods",
    "might",
    "not",
    "of",
    "on",
    "one",
    "or",
    "paper",
    "papers",
    "please",
    "point",
    "proposed",
    "propose",
    "proposes",
    "provide",
    "provides",
    "publication",
    "publications",
    "refer",
    "research",
    "resource",
    "resources",
    "some",
    "studies",
    "study",
    "strategies",
    "strategy",
    "specifically",
    "task",
    "tasks",
    "technique",
    "techniques",
    "that",
    "the",
    "their",
    "them",
    "these",
    "there",
    "those",
    "through",
    "to",
    "tool",
    "tools",
    "toward",
    "towards",
    "use",
    "used",
    "uses",
    "using",
    "was",
    "were",
    "what",
    "where",
    "which",
    "with",
    "work",
    "works",
    "would",
    "you",
    "about",
    "applies",
    "conducted",
    "direct",
    "discusses",
    "examined",
    "exist",
    "exists",
    "explored",
    "how",
    "introduced",
    "investigated",
    "investigates",
    "investigating",
    "leverages",
    "looking",
    "recommend",
    "recommended",
    "recommending",
    "researching",
    "should",
    "shows",
    "suggest",
    "suggested",
    "suggesting",
    "tried",
    "utilizes",
    "apply",
    "applied",
    "conduct",
    "conducts",
    "investigate",
    "introduce",
    "introduces",
    "leverage",
    "show",
    "article",
    "articles",
    "assesses",
    "employing",
    "employs",
    "evaluates",
    "examines",
    "examining",
    "applying",
    "address",
    "idea",
    "understand",
    "well",
];

pub(crate) struct PaperSearchPlan {
    pub queries: Vec<String>,
    pub llm_used: bool,
    pub note: String,
    pub intent: PaperSearchIntent,
    pub llm_calls: usize,
    pub estimated_tokens: u64,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub(crate) struct PaperSearchIntent {
    pub summary: String,
    pub concepts: Vec<String>,
    pub methods: Vec<String>,
    pub datasets: Vec<String>,
    pub domains: Vec<String>,
    pub venues: Vec<String>,
    pub time_constraints: Vec<String>,
}

#[derive(Deserialize)]
#[serde(default)]
struct LlmSearchPlan {
    intent_summary: String,
    concepts: Vec<String>,
    methods: Vec<String>,
    datasets: Vec<String>,
    domains: Vec<String>,
    venues: Vec<String>,
    time_constraints: Vec<String>,
    queries: Vec<String>,
}

impl Default for LlmSearchPlan {
    fn default() -> Self {
        Self {
            intent_summary: String::new(),
            concepts: Vec::new(),
            methods: Vec::new(),
            datasets: Vec::new(),
            domains: Vec::new(),
            venues: Vec::new(),
            time_constraints: Vec::new(),
            queries: Vec::new(),
        }
    }
}

pub(crate) async fn plan_paper_search_queries(
    settings: &HashMap<String, String>,
    natural_language: &str,
    structured_terms: &[String],
) -> PaperSearchPlan {
    let fallback = build_fallback_search_queries(natural_language, structured_terms);
    let fallback_intent = build_fallback_intent(natural_language, structured_terms);
    if natural_language.trim().is_empty() {
        return local_plan(
            fallback,
            fallback_intent,
            "已根据结构化检索条件生成检索式。",
        );
    }

    let clients = match LlmClient::literature_clients_with_runtime_fallback(settings) {
        Ok(resolved) => resolved,
        Err(_) => {
            return local_plan(
                fallback,
                fallback_intent,
                "未检测到可用的论文检索模型或小妍主模型，已使用本地规则拆分查询。",
            );
        }
    };
    let prompt = format!(
        "解析下面的复杂学术检索需求，并拆分为 2-4 条互补的英文学术检索式。每条应是简洁关键词短语，覆盖研究对象、方法、数据集与任务。只提取用户明确表达的约束，不要虚构。\n\n自然语言需求：{}\n结构化补充词：{}\n\n只返回 JSON：{{\"intent_summary\":\"一句话研究意图\",\"concepts\":[\"核心对象或任务\"],\"methods\":[\"方法\"],\"datasets\":[\"数据集\"],\"domains\":[\"领域\"],\"venues\":[\"期刊或会议\"],\"time_constraints\":[\"时间约束\"],\"queries\":[\"query 1\",\"query 2\"]}}",
        natural_language.trim(),
        structured_terms.join(", "),
    );
    let messages = vec![
        LlmMessage::system("你是论文检索式规划器，只输出严格 JSON。"),
        LlmMessage::user(prompt),
    ];
    let temperature = resolve_temperature(settings, "copilot_simple_temperature", 0.1);

    let input_tokens = crate::token_usage::estimate_messages(&messages);
    let mut attempted_tokens = 0;
    let mut llm_calls = 0;
    let mut planned = None;
    for (client, model) in clients {
        llm_calls += 1;
        attempted_tokens += input_tokens;
        let Ok(raw) = client.chat(&messages, model.as_deref(), temperature).await else {
            continue;
        };
        attempted_tokens += crate::token_usage::estimate_tokens(&raw);
        let clean = crate::commands::papers::extract_json_pub(&raw);
        let Ok(value) = serde_json::from_str::<LlmSearchPlan>(&clean) else {
            continue;
        };
        if normalize_queries(value.queries.clone()).len() >= 2 {
            planned = Some((value, attempted_tokens, llm_calls));
            break;
        }
    }

    let planned_queries = planned
        .as_ref()
        .map(|(value, _, _)| normalize_queries(value.queries.clone()))
        .unwrap_or_default();
    let model_plan_valid = planned_queries.len() >= 2;
    let queries = merge_queries(planned_queries, fallback);
    if model_plan_valid {
        let (value, estimated_tokens, llm_calls) = planned.expect("validated plan must exist");
        PaperSearchPlan {
            note: format!("小妍已将自然语言需求拆分为 {} 条检索式。", queries.len()),
            queries,
            llm_used: true,
            intent: normalize_intent(value, fallback_intent),
            llm_calls,
            estimated_tokens,
        }
    } else {
        let mut plan = local_plan(
            queries,
            fallback_intent,
            "小妍主模型未返回有效检索计划，已使用本地规则生成检索式。",
        );
        plan.llm_calls = llm_calls;
        plan.estimated_tokens = attempted_tokens;
        plan
    }
}

pub(crate) fn build_fallback_search_queries(
    natural_language: &str,
    structured_terms: &[String],
) -> Vec<String> {
    let focus = strip_conversational_prefix(natural_language);
    let structured = normalize_query(structured_terms.join(" "));
    let mut candidates = Vec::new();

    if !focus.is_empty() {
        let keyword_queries = extract_english_keyword_queries(&focus);
        if let Some(keywords) = keyword_queries.first() {
            candidates.push(combine_query(&keywords, &structured));
        }
        candidates.extend(
            expand_related_task_queries(&focus)
                .into_iter()
                .map(|query| combine_query(&query, &structured)),
        );
        for keywords in keyword_queries.into_iter().skip(1) {
            candidates.push(combine_query(&keywords, &structured));
        }
        candidates.extend(
            split_clauses(&focus)
                .into_iter()
                .map(|clause| combine_query(&clause, &structured)),
        );
        candidates.push(combine_query(&focus, &structured));
    }
    if !structured.is_empty() {
        candidates.push(structured);
    }

    normalize_queries(candidates)
}

fn local_plan(queries: Vec<String>, intent: PaperSearchIntent, note: &str) -> PaperSearchPlan {
    PaperSearchPlan {
        queries,
        llm_used: false,
        note: note.to_string(),
        intent,
        llm_calls: 0,
        estimated_tokens: 0,
    }
}

fn build_fallback_intent(natural_language: &str, structured_terms: &[String]) -> PaperSearchIntent {
    let summary = strip_conversational_prefix(natural_language);
    PaperSearchIntent {
        summary: if summary.is_empty() {
            structured_terms.join("、")
        } else {
            summary
        },
        concepts: normalize_facets(structured_terms.to_vec()),
        ..PaperSearchIntent::default()
    }
}

fn normalize_intent(value: LlmSearchPlan, fallback: PaperSearchIntent) -> PaperSearchIntent {
    PaperSearchIntent {
        summary: normalize_query(if value.intent_summary.trim().is_empty() {
            fallback.summary
        } else {
            value.intent_summary
        }),
        concepts: normalize_facets(value.concepts),
        methods: normalize_facets(value.methods),
        datasets: normalize_facets(value.datasets),
        domains: normalize_facets(value.domains),
        venues: normalize_facets(value.venues),
        time_constraints: normalize_facets(value.time_constraints),
    }
}

fn normalize_facets(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(normalize_query)
        .filter(|value| !value.is_empty() && seen.insert(value.to_lowercase()))
        .take(12)
        .collect()
}

fn merge_queries(primary: Vec<String>, fallback: Vec<String>) -> Vec<String> {
    let mut fallback = normalize_queries(fallback).into_iter();
    let Some(constraint_query) = fallback.next() else {
        return normalize_queries(primary);
    };

    normalize_queries(
        std::iter::once(constraint_query)
            .chain(primary)
            .chain(fallback)
            .collect(),
    )
}

fn normalize_queries(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| normalize_query(value))
        .filter(|value| {
            let key = value.to_lowercase();
            value.len() >= 3 && seen.insert(key)
        })
        .take(MAX_SEARCH_QUERIES)
        .collect()
}

fn normalize_query(value: impl AsRef<str>) -> String {
    value
        .as_ref()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|character: char| {
            matches!(character, '?' | '？' | '.' | '。' | ',' | '，' | ';' | '；')
        })
        .to_string()
}

fn combine_query(focus: &str, structured: &str) -> String {
    match (focus.is_empty(), structured.is_empty()) {
        (false, false) => format!("{focus} {structured}"),
        (false, true) => focus.to_string(),
        (true, false) => structured.to_string(),
        (true, true) => String::new(),
    }
}

fn strip_conversational_prefix(value: &str) -> String {
    let normalized = normalize_query(value);
    let lower = normalized.to_lowercase();
    let english_prefixes = [
        "are there any research papers on ",
        "are there any research papers that ",
        "are there any resources available for ",
        "are there any studies that ",
        "are there papers that ",
        "can you direct me to research that ",
        "can you direct me to studies that ",
        "can you point me to research that ",
        "can you point me to studies that ",
        "can you point me to a paper that ",
        "can you recommend some literature that ",
        "can you recommend a paper that ",
        "can you recommend ",
        "could you provide me some studies that ",
        "could you provide me some papers that ",
        "could you provide me studies that ",
        "could you provide me papers that ",
        "could you provide me ",
        "can you provide me some studies that ",
        "can you find papers that ",
        "please find papers that ",
        "please find studies that ",
        "find papers that ",
        "find studies that ",
        "i want to find ",
    ];
    for prefix in english_prefixes {
        if lower.starts_with(prefix) {
            return normalize_query(&normalized[prefix.len()..]);
        }
    }

    for prefix in [
        "请帮我查找",
        "请帮我找",
        "请帮我检索",
        "帮我查找",
        "帮我找",
        "帮我检索",
        "我想查找",
        "我想找",
        "我想了解",
        "查找",
        "检索",
        "搜索",
    ] {
        if let Some(rest) = normalized.strip_prefix(prefix) {
            return normalize_query(rest);
        }
    }
    normalized
}

fn split_clauses(value: &str) -> Vec<String> {
    value
        .split([',', '，', ';', '；', '。'])
        .map(normalize_query)
        .filter(|value| value.chars().count() >= 8)
        .collect()
}

fn extract_english_keyword_queries(value: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let tokens = value
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '-')
        .filter_map(normalize_english_search_token)
        .filter(|token| seen.insert(token.clone()))
        .collect::<Vec<_>>();
    if tokens.len() < 2 {
        Vec::new()
    } else if tokens.len() <= 8 {
        vec![tokens.join(" ")]
    } else {
        vec![tokens[..4].join(" "), tokens[tokens.len() - 8..].join(" ")]
    }
}

pub(crate) fn normalize_english_search_token(token: &str) -> Option<String> {
    let token = token.trim().to_lowercase();
    let token = match token.as_str() {
        "translated" | "translating" => "translation".to_string(),
        _ => token,
    };
    (token.len() >= 3 && !ENGLISH_SEARCH_STOP_WORDS.contains(&token.as_str())).then_some(token)
}

#[cfg(test)]
mod tests {
    use super::{build_fallback_search_queries, merge_queries};
    use crate::llm::LlmClient;
    use std::collections::HashMap;

    #[test]
    fn splits_a_natural_language_question_into_search_queries() {
        let queries = build_fallback_search_queries(
            "Could you provide me some studies that proposed hierarchical neural models to capture spatiotemporal features in signvideos?",
            &[],
        );

        assert!(queries.len() >= 2);
        assert!(queries[0].contains("hierarchical neural models"));
        assert!(!queries[0].contains("could you"));
        assert!(queries.iter().any(|query| query.contains("spatiotemporal")));
    }

    #[test]
    fn compresses_litsearch_questions_before_the_full_query() {
        let queries = build_fallback_search_queries(
            "Are there any research papers on methods to compress large-scale language models using task-agnostic knowledge distillation techniques?",
            &[],
        );

        assert_eq!(
            queries[0],
            "compress large-scale language models task-agnostic knowledge distillation"
        );
        assert!(queries[0].split_whitespace().count() <= 8);
        assert!(!queries[0].starts_with("Are there"));
    }

    #[test]
    fn extracts_a_short_core_query_and_a_detail_query() {
        let queries = build_fallback_search_queries(
            "Are there any resources available for translating Tunisian Arabic dialect, both manually translated comments and additional data augmented through methods like segmentation and stop words level?",
            &[],
        );

        assert_eq!(queries[0], "translation tunisian arabic dialect");
        assert!(queries[1].contains("segmentation stop words"));
    }

    #[test]
    fn removes_generic_academic_request_words_from_the_core_query() {
        let analyzer = build_fallback_search_queries(
            "Are there any tools or studies that have focused on building a morphological analyzer specifically for handling multiple Arabic dialects?",
            &[],
        );
        let metrics = build_fallback_search_queries(
            "Can you list some publications that discuss the evaluation metrics used in semantic role labeling tasks?",
            &[],
        );

        assert_eq!(
            analyzer[0],
            "morphological analyzer handling multiple arabic dialects"
        );
        assert_eq!(analyzer[1], "dialectal arabic segmentation");
        assert_eq!(metrics[0], "evaluation metrics semantic role labeling");
    }

    #[test]
    fn removes_recommendation_verbs_from_manual_queries() {
        let queries = build_fallback_search_queries(
            "Recommend papers that investigate knowledge graph completion with temporal node attributes",
            &[],
        );

        assert_eq!(
            queries[0],
            "knowledge graph completion temporal node attributes"
        );
    }

    #[test]
    fn keeps_structured_terms_in_the_fallback_plan() {
        let queries = build_fallback_search_queries(
            "请帮我找多模态大模型在医学影像中的研究",
            &["benchmark".into(), "medical imaging".into()],
        );

        assert!(queries.iter().any(|query| query.contains("benchmark")));
        assert!(queries.iter().any(|query| query.contains("多模态大模型")));
    }

    #[test]
    fn fallback_plan_keeps_an_inspectable_intent_summary() {
        let plan = super::build_fallback_intent(
            "请帮我查找使用 LoRA 适配视觉语言模型的论文",
            &["MIMIC-CXR".into(), "medical imaging".into()],
        );

        assert!(plan.summary.contains("LoRA"));
        assert_eq!(plan.concepts, vec!["MIMIC-CXR", "medical imaging"]);
    }

    #[test]
    fn reserves_a_constraint_query_when_the_model_plan_reaches_the_limit() {
        let fallback = build_fallback_search_queries(
            "hierarchical neural models for sign language",
            &[
                "Jane Doe".into(),
                "Computer Vision and Pattern Recognition".into(),
                "Computer Science".into(),
            ],
        );
        let queries = merge_queries(
            vec![
                "model query one".into(),
                "model query two".into(),
                "model query three".into(),
                "model query four".into(),
            ],
            fallback,
        );

        assert_eq!(queries.len(), 4);
        assert!(queries[0].contains("Jane Doe"));
        assert!(queries[0].contains("Computer Vision and Pattern Recognition"));
        assert!(queries[0].contains("Computer Science"));
        assert!(!queries.iter().any(|query| query == "model query four"));
    }

    #[test]
    fn literature_model_falls_back_to_xiaoyan_main_role() {
        let settings = HashMap::from([
            (
                "copilot_simple_base_url".to_string(),
                "https://example.com/v1".to_string(),
            ),
            ("copilot_simple_api_key".to_string(), "secret".to_string()),
            (
                "copilot_simple_model".to_string(),
                "xiaoyan-main".to_string(),
            ),
        ]);

        let (client, model_override) =
            LlmClient::literature_client_with_main_fallback(&settings).unwrap();
        match client {
            LlmClient::OpenAI { chat_model, .. } => assert_eq!(chat_model, "xiaoyan-main"),
            LlmClient::Anthropic { .. } => panic!("expected OpenAI-compatible Xiaoyan role"),
        }
        assert_eq!(model_override, None);
    }

    #[test]
    fn dedicated_literature_model_keeps_xiaoyan_main_as_runtime_fallback() {
        let settings = HashMap::from([
            (
                "multi_agent_literature_scout_base_url".to_string(),
                "https://scout.example.com/v1".to_string(),
            ),
            (
                "multi_agent_literature_scout_api_key".to_string(),
                "stale-secret".to_string(),
            ),
            (
                "multi_agent_literature_scout_model".to_string(),
                "scout-model".to_string(),
            ),
            (
                "copilot_simple_base_url".to_string(),
                "https://main.example.com/v1".to_string(),
            ),
            ("copilot_simple_api_key".to_string(), "secret".to_string()),
            (
                "copilot_simple_model".to_string(),
                "xiaoyan-main".to_string(),
            ),
        ]);

        let clients = LlmClient::literature_clients_with_runtime_fallback(&settings).unwrap();
        assert_eq!(clients.len(), 2);
        match &clients[0].0 {
            LlmClient::OpenAI { chat_model, .. } => assert_eq!(chat_model, "scout-model"),
            LlmClient::Anthropic { .. } => panic!("expected OpenAI-compatible scout"),
        }
        match &clients[1].0 {
            LlmClient::OpenAI { chat_model, .. } => assert_eq!(chat_model, "xiaoyan-main"),
            LlmClient::Anthropic { .. } => panic!("expected OpenAI-compatible main role"),
        }
    }
}
