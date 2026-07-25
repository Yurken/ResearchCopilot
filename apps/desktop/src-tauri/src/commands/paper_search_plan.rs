use crate::llm::{resolve_temperature, LlmClient, LlmMessage};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

const MAX_SEARCH_QUERIES: usize = 4;

pub(crate) struct PaperSearchPlan {
    pub queries: Vec<String>,
    pub llm_used: bool,
    pub note: String,
}

#[derive(Deserialize)]
struct LlmSearchPlan {
    queries: Vec<String>,
}

pub(crate) async fn plan_paper_search_queries(
    settings: &HashMap<String, String>,
    natural_language: &str,
    structured_terms: &[String],
) -> PaperSearchPlan {
    let fallback = build_fallback_search_queries(natural_language, structured_terms);
    if natural_language.trim().is_empty() {
        return local_plan(fallback, "已根据结构化检索条件生成检索式。");
    }

    let (client, model) = match LlmClient::literature_client_with_main_fallback(settings) {
        Ok(resolved) => resolved,
        Err(_) => {
            return local_plan(
                fallback,
                "未检测到可用的论文检索模型或小妍主模型，已使用本地规则拆分查询。",
            );
        }
    };
    let prompt = format!(
        "把下面的自然语言论文检索需求拆分为 2-4 条互补的英文学术检索式。每条应是简洁的关键词短语，覆盖研究对象、方法和任务，不要保留 Could you、请帮我等对话措辞。不要虚构用户未提及的约束。\n\n自然语言需求：{}\n结构化补充词：{}\n\n只返回 JSON：{{\"queries\":[\"query 1\",\"query 2\"]}}",
        natural_language.trim(),
        structured_terms.join(", "),
    );
    let messages = vec![
        LlmMessage::system("你是论文检索式规划器，只输出严格 JSON。"),
        LlmMessage::user(prompt),
    ];
    let temperature = resolve_temperature(settings, "copilot_simple_temperature", 0.1);

    let planned = match client.chat(&messages, model.as_deref(), temperature).await {
        Ok(raw) => {
            let clean = crate::commands::papers::extract_json_pub(&raw);
            serde_json::from_str::<LlmSearchPlan>(&clean)
                .ok()
                .map(|value| normalize_queries(value.queries))
                .unwrap_or_default()
        }
        Err(_) => Vec::new(),
    };

    let model_plan_valid = planned.len() >= 2;
    let queries = merge_queries(planned, fallback);
    if model_plan_valid {
        PaperSearchPlan {
            note: format!("小妍已将自然语言需求拆分为 {} 条检索式。", queries.len()),
            queries,
            llm_used: true,
        }
    } else {
        local_plan(
            queries,
            "小妍主模型未返回有效检索计划，已使用本地规则生成检索式。",
        )
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
        candidates.push(combine_query(&focus, &structured));
        let keywords = extract_english_keywords(&focus);
        if !keywords.is_empty() {
            candidates.push(combine_query(&keywords, &structured));
        }
        candidates.extend(
            split_clauses(&focus)
                .into_iter()
                .map(|clause| combine_query(&clause, &structured)),
        );
    }
    if !structured.is_empty() {
        candidates.push(structured);
    }

    normalize_queries(candidates)
}

fn local_plan(queries: Vec<String>, note: &str) -> PaperSearchPlan {
    PaperSearchPlan {
        queries,
        llm_used: false,
        note: note.to_string(),
    }
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

fn extract_english_keywords(value: &str) -> String {
    const STOP_WORDS: &[&str] = &[
        "a", "an", "and", "are", "as", "at", "be", "been", "by", "can", "capture", "could", "for",
        "from", "have", "in", "into", "is", "it", "me", "of", "on", "or", "paper", "papers",
        "please", "proposed", "provide", "some", "studies", "study", "that", "the", "their",
        "these", "those", "to", "using", "was", "were", "which", "with", "would", "you",
    ];
    let tokens = value
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '-')
        .map(|token| token.trim().to_lowercase())
        .filter(|token| token.len() >= 3 && !STOP_WORDS.contains(&token.as_str()))
        .collect::<Vec<_>>();
    if tokens.len() < 2 {
        String::new()
    } else {
        tokens.join(" ")
    }
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
        assert_eq!(
            queries[0],
            "proposed hierarchical neural models to capture spatiotemporal features in signvideos"
        );
        assert!(queries[1].contains("hierarchical neural models"));
        assert!(!queries[1].contains("could you"));
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
}
