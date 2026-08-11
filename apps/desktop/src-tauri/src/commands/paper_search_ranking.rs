use crate::commands::paper_search::{PaperCandidate, PaperSearchRequest};
use crate::commands::paper_search_plan::normalize_english_search_token;
use crate::llm::{resolve_temperature, LlmClient, LlmMessage};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RankingMode {
    Relevance,
    Quality,
}

impl RankingMode {
    pub(crate) fn from_value(value: Option<&str>) -> Self {
        match value.unwrap_or("relevance").trim() {
            "quality" => Self::Quality,
            _ => Self::Relevance,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Relevance => "relevance",
            Self::Quality => "quality",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct PaperRecommendation {
    pub(crate) arxiv_id: String,
    corpus_id: Option<i64>,
    title: String,
    title_zh: Option<String>,
    authors: String,
    category: String,
    published_at: String,
    updated_at: String,
    abstract_text: String,
    abs_url: String,
    pdf_url: String,
    score: i32,
    reason: String,
    tldr_zh: Option<String>,
    tags: Vec<String>,
    citation_count: i32,
    relevance_band: String,
    matched_queries: Vec<String>,
    discovered_via: String,
}

#[cfg(test)]
impl PaperRecommendation {
    pub(crate) fn evaluation_score(&self) -> i32 {
        self.score
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct LlmRankingResponse {
    overall_summary: Option<String>,
    ranking_note: Option<String>,
    papers: Vec<LlmRankingPaper>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct LlmRankingPaper {
    id: String,
    score: Option<i32>,
    reason: Option<String>,
    title_zh: Option<String>,
    tldr_zh: Option<String>,
    tags: Option<Vec<String>>,
}

pub(crate) struct RerankOutcome {
    pub(crate) ranking: Option<(String, String, Vec<PaperRecommendation>)>,
    pub(crate) llm_calls: usize,
    pub(crate) estimated_tokens: u64,
    pub(crate) error: Option<String>,
}

impl RerankOutcome {
    fn unavailable() -> Self {
        Self {
            ranking: None,
            llm_calls: 0,
            estimated_tokens: 0,
            error: None,
        }
    }

    fn failed(llm_calls: usize, estimated_tokens: u64, error: impl Into<String>) -> Self {
        Self {
            ranking: None,
            llm_calls,
            estimated_tokens,
            error: Some(error.into()),
        }
    }
}

pub(crate) async fn rerank_with_xiaoyan(
    settings: &HashMap<String, String>,
    query: &str,
    filter_description: &str,
    search_queries: &[String],
    mode: RankingMode,
    limit: usize,
    candidates: &[PaperCandidate],
) -> RerankOutcome {
    let clients = match LlmClient::literature_clients_with_runtime_fallback(settings) {
        Ok(resolved) => resolved,
        Err(_) => return RerankOutcome::unavailable(),
    };
    let temperature =
        resolve_temperature(settings, "multi_agent_literature_scout_temperature", 0.2);

    let payload = candidates
        .iter()
        .take(40)
        .map(|paper| {
            json!({
                "id": paper.id,
                "title": paper.title,
                "authors": paper.authors,
                "year": paper.year,
                "venue": paper.venue,
                "abstract": paper.abstract_text,
                "url": paper.detail_url,
                "pdf_url": paper.pdf_url,
                "citation_count": paper.citation_count,
                "discovered_via": paper.discovered_via,
            })
        })
        .collect::<Vec<_>>();

    let ranking_focus = match mode {
        RankingMode::Relevance => "与用户问题的贴合度、研究问题匹配度、可读性",
        RankingMode::Quality => "方法与实验信号、影响力、研究完整性",
    };
    let prompt = format!(
        "你是小妍的论文检索子助手。请基于联网候选论文输出最终推荐结果。必须优先满足用户的研究对象、方法、数据集、时间和刊会约束；区分完整命中与只命中部分子问题的论文。\n\n用户问题：{query}\n检索约束：{filter_description}\n排序偏好：{ranking_focus}\n返回数量：{limit}\n\n候选论文（JSON）：\n{payload}\n\n只返回 JSON，不要额外解释，格式必须是：\n{{\n  \"overall_summary\": \"...\",\n  \"ranking_note\": \"...\",\n  \"papers\": [\n    {{\n      \"id\": \"候选 id\",\n      \"score\": 0-100 整数,\n      \"reason\": \"明确说明命中与未命中的约束\",\n      \"title_zh\": \"可选\",\n      \"tldr_zh\": \"可选\",\n      \"tags\": [\"标签1\", \"标签2\"]\n    }}\n  ]\n}}",
        payload = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "[]".to_string()),
    );
    let messages = vec![
        LlmMessage::system("你是科研论文检索助手，输出必须严格遵守 JSON 格式。"),
        LlmMessage::user(prompt),
    ];
    let estimated_input_tokens = crate::token_usage::estimate_messages(&messages);
    let mut estimated_tokens = 0;
    let mut llm_calls = 0;
    let mut last_error = None;
    let mut response = None;
    for (client, model) in clients {
        llm_calls += 1;
        estimated_tokens += estimated_input_tokens;
        match client.chat(&messages, model.as_deref(), temperature).await {
            Ok(raw) => {
                estimated_tokens += crate::token_usage::estimate_tokens(&raw);
                response = Some(raw);
                break;
            }
            Err(error) => last_error = Some(error),
        }
    }
    let Some(raw) = response else {
        return RerankOutcome::failed(
            llm_calls,
            estimated_tokens,
            format!(
                "模型请求失败：{}",
                last_error
                    .map(|error| error.to_string())
                    .unwrap_or_else(|| "没有可用模型".into())
            ),
        );
    };
    let clean = crate::commands::papers::extract_json_pub(&raw);
    let parsed: LlmRankingResponse = match serde_json::from_str(&clean) {
        Ok(value) => value,
        Err(error) => {
            return RerankOutcome::failed(
                llm_calls,
                estimated_tokens,
                format!("模型返回不是有效的排序 JSON：{error}"),
            )
        }
    };

    let by_id = candidates
        .iter()
        .map(|candidate| (candidate.id.clone(), candidate.clone()))
        .collect::<HashMap<_, _>>();
    let mut selected = Vec::new();
    let mut seen = HashSet::new();
    for item in parsed.papers {
        if selected.len() >= limit {
            break;
        }
        let Some(candidate) = by_id.get(&item.id) else {
            continue;
        };
        if !seen.insert(candidate.id.clone()) {
            continue;
        }
        let score = item.score.unwrap_or(75).clamp(0, 100);
        selected.push(PaperRecommendation {
            arxiv_id: candidate.id.clone(),
            corpus_id: candidate.corpus_id,
            title: candidate.title.clone(),
            title_zh: item.title_zh,
            authors: candidate.authors.clone(),
            category: candidate.venue.clone(),
            published_at: candidate.published_at.clone(),
            updated_at: candidate.published_at.clone(),
            abstract_text: candidate.abstract_text.clone(),
            abs_url: candidate.detail_url.clone(),
            pdf_url: candidate.pdf_url.clone(),
            score,
            reason: item
                .reason
                .unwrap_or_else(|| "与当前研究主题相关".to_string()),
            tldr_zh: item.tldr_zh,
            tags: item.tags.unwrap_or_default(),
            citation_count: candidate.citation_count,
            relevance_band: relevance_band(score).into(),
            matched_queries: matched_queries(candidate, search_queries),
            discovered_via: candidate.discovered_via.clone(),
        });
    }
    if selected.is_empty() {
        return RerankOutcome::failed(llm_calls, estimated_tokens, "模型没有返回可用候选论文");
    }

    RerankOutcome {
        ranking: Some((
            parsed
                .ranking_note
                .unwrap_or_else(|| fallback_ranking_note(mode).to_string()),
            parsed
                .overall_summary
                .unwrap_or_else(|| fallback_overall_summary(mode, candidates.len(), limit)),
            selected,
        )),
        llm_calls,
        estimated_tokens,
        error: None,
    }
}

pub(crate) fn heuristic_rank_papers(
    candidates: &[PaperCandidate],
    request: &PaperSearchRequest,
    search_queries: &[String],
    mode: RankingMode,
    limit: usize,
) -> Vec<PaperRecommendation> {
    let query_tokens = search_queries
        .iter()
        .flat_map(|query| {
            query.split(|character: char| !character.is_alphanumeric() && character != '-')
        })
        .filter_map(normalize_english_search_token)
        .collect::<HashSet<_>>();
    let mut seen_primary_tokens = HashSet::new();
    let primary_query_tokens = search_queries
        .first()
        .into_iter()
        .flat_map(|query| {
            query.split(|character: char| !character.is_alphanumeric() && character != '-')
        })
        .filter_map(normalize_english_search_token)
        .filter(|token| seen_primary_tokens.insert(token.clone()))
        .collect::<Vec<_>>();
    let mut scored = candidates
        .iter()
        .map(|paper| {
            let mut score = 55_i32;
            let title = paper.title.to_lowercase();
            let text = format!(
                "{}\n{}\n{}\n{}\n{}",
                paper.title, paper.abstract_text, paper.authors, paper.venue, paper.retrieval_text
            )
            .to_lowercase();
            let add_match_score = |terms: &[String], weight: i32| -> i32 {
                terms
                    .iter()
                    .filter(|term| {
                        let term = term.trim().to_lowercase();
                        !term.is_empty() && text.contains(&term)
                    })
                    .count() as i32
                    * weight
            };

            score += add_match_score(&request.all_terms, 6);
            score += add_match_score(&request.title_terms, 8);
            score += add_match_score(&request.abstract_terms, 6);
            score += add_match_score(&request.authors, 10);
            score += add_match_score(&request.journal_ref_terms, 8);
            score += add_match_score(&request.categories, 4);
            let primary_title_matches = primary_query_tokens
                .iter()
                .filter(|token| ranking_token_matches(&title, token))
                .count();
            score += primary_query_tokens
                .iter()
                .enumerate()
                .filter(|(_, token)| ranking_token_matches(&title, token))
                .map(|(index, _)| (6_i32 - index as i32).max(2))
                .sum::<i32>()
                .min(20);
            if primary_query_tokens.len() >= 2
                && primary_title_matches == primary_query_tokens.len()
            {
                score += 8;
            }
            let complementary_title_bonus = search_queries
                .iter()
                .skip(1)
                .filter_map(|query| {
                    let tokens = query
                        .split(|character: char| !character.is_alphanumeric() && character != '-')
                        .filter_map(normalize_english_search_token)
                        .collect::<Vec<_>>();
                    if tokens.len() < 2 {
                        return None;
                    }
                    let overlap_with_primary = tokens
                        .iter()
                        .filter(|token| primary_query_tokens.contains(token))
                        .count();
                    if overlap_with_primary * 2 >= tokens.len() {
                        return None;
                    }
                    let matched = tokens
                        .iter()
                        .filter(|token| ranking_token_matches(&title, token))
                        .count();
                    if tokens.len() >= 3 && matched == tokens.len() {
                        Some(32)
                    } else {
                        Some((matched as i32 * 4).min(24))
                    }
                })
                .max()
                .unwrap_or_default();
            score += complementary_title_bonus;
            if matches!(paper.discovered_via.as_str(), "reference" | "citation") {
                score += 4;
            }
            score += (query_tokens
                .iter()
                .filter(|token| ranking_token_matches(&text, token))
                .count() as i32)
                .min(10);
            score += (paper.citation_count / 500).clamp(0, 4);
            if paper.discovered_via.contains("full_text_snippet") {
                score += paper
                    .retrieval_score
                    .map(|value| (value * 20.0).round() as i32)
                    .unwrap_or_default()
                    .clamp(0, 20);
            }
            if mode == RankingMode::Quality {
                score += (paper.citation_count / 120).clamp(0, 16);
            }
            let score = score.clamp(0, 100);
            PaperRecommendation {
                arxiv_id: paper.id.clone(),
                corpus_id: paper.corpus_id,
                title: paper.title.clone(),
                title_zh: None,
                authors: paper.authors.clone(),
                category: paper.venue.clone(),
                published_at: paper.published_at.clone(),
                updated_at: paper.published_at.clone(),
                abstract_text: paper.abstract_text.clone(),
                abs_url: paper.detail_url.clone(),
                pdf_url: paper.pdf_url.clone(),
                score,
                reason: match mode {
                    RankingMode::Relevance => "与当前检索条件的关键词匹配度较高。".into(),
                    RankingMode::Quality => "在候选论文中具备更强的影响力与研究信号。".into(),
                },
                tldr_zh: None,
                tags: Vec::new(),
                citation_count: paper.citation_count,
                relevance_band: relevance_band(score).into(),
                matched_queries: matched_queries(paper, search_queries),
                discovered_via: paper.discovered_via.clone(),
            }
        })
        .collect::<Vec<_>>();
    scored.sort_by(|left, right| right.score.cmp(&left.score));
    scored.into_iter().take(limit).collect()
}

pub(crate) fn select_citation_seed_ids(
    candidates: &[PaperCandidate],
    request: &PaperSearchRequest,
    search_queries: &[String],
    limit: usize,
) -> Vec<String> {
    if limit == 0 {
        return Vec::new();
    }
    let relevance_ranking = heuristic_rank_papers(
        candidates,
        request,
        search_queries,
        RankingMode::Relevance,
        candidates.len(),
    );
    let mut selected = Vec::new();
    if let Some(paper) = relevance_ranking.first() {
        selected.push(paper.arxiv_id.clone());
    }
    if selected.len() >= limit {
        return selected;
    }

    let quality_pool_ids = relevance_ranking
        .iter()
        .take((limit + 1).max(3))
        .map(|paper| paper.arxiv_id.as_str())
        .collect::<HashSet<_>>();
    let quality_pool = candidates
        .iter()
        .filter(|candidate| quality_pool_ids.contains(candidate.id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    for paper in heuristic_rank_papers(
        &quality_pool,
        request,
        search_queries,
        RankingMode::Quality,
        quality_pool.len(),
    ) {
        if !selected.contains(&paper.arxiv_id) {
            selected.push(paper.arxiv_id);
            if selected.len() >= limit {
                return selected;
            }
        }
    }

    for paper in relevance_ranking {
        if !selected.contains(&paper.arxiv_id) {
            selected.push(paper.arxiv_id);
            if selected.len() >= limit {
                return selected;
            }
        }
    }
    selected
}

fn relevance_band(score: i32) -> &'static str {
    if score >= 75 {
        "high"
    } else {
        "partial"
    }
}

fn ranking_token_matches(text: &str, token: &str) -> bool {
    if text.contains(token) {
        return true;
    }
    let stem = if token.starts_with("calibrat") {
        "calibrat"
    } else if token.starts_with("compress") {
        "compress"
    } else if token.starts_with("distill") {
        "distill"
    } else if token.starts_with("translat") {
        "translat"
    } else if token.len() >= 6 && token.ends_with("ing") {
        &token[..token.len() - 3]
    } else if token.len() >= 5 && token.ends_with("ed") {
        &token[..token.len() - 2]
    } else if token.len() >= 5 && token.ends_with('s') {
        &token[..token.len() - 1]
    } else {
        token
    };
    stem.len() >= 4 && text.contains(stem)
}

fn matched_queries(candidate: &PaperCandidate, search_queries: &[String]) -> Vec<String> {
    let haystack = format!(
        "{} {} {} {} {}",
        candidate.title,
        candidate.abstract_text,
        candidate.authors,
        candidate.venue,
        candidate.retrieval_text
    )
    .to_lowercase();
    search_queries
        .iter()
        .filter(|query| {
            let tokens = query
                .split(|character: char| !character.is_alphanumeric() && character != '-')
                .map(|token| token.trim().to_lowercase())
                .filter(|token| token.chars().count() >= 3)
                .collect::<Vec<_>>();
            let required = tokens.len().clamp(1, 2);
            tokens
                .iter()
                .filter(|token| haystack.contains(token.as_str()))
                .count()
                >= required
        })
        .take(4)
        .cloned()
        .collect()
}

pub(crate) fn fallback_ranking_note(mode: RankingMode) -> &'static str {
    match mode {
        RankingMode::Relevance => "已使用启发式相关性排序。",
        RankingMode::Quality => "已使用启发式质量信号排序。",
    }
}

pub(crate) fn fallback_overall_summary(
    mode: RankingMode,
    candidates: usize,
    limit: usize,
) -> String {
    match mode {
        RankingMode::Relevance => format!(
            "从 {} 篇联网候选论文中筛选出最相关的 {} 篇，建议先读前 2 篇建立问题框架。",
            candidates,
            candidates.min(limit)
        ),
        RankingMode::Quality => format!(
            "从 {} 篇联网候选论文中筛选出研究信号更强的 {} 篇，建议优先关注方法与实验部分。",
            candidates,
            candidates.min(limit)
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{heuristic_rank_papers, select_citation_seed_ids, RankingMode};
    use crate::commands::paper_search::{PaperCandidate, PaperSearchRequest};

    fn candidate(title: &str, abstract_text: &str, citation_count: i32) -> PaperCandidate {
        PaperCandidate {
            id: title.to_string(),
            corpus_id: None,
            title: title.to_string(),
            authors: "Researcher".into(),
            venue: "SIGIR".into(),
            year: Some(2025),
            published_at: "2025-01-01".into(),
            abstract_text: abstract_text.to_string(),
            detail_url: String::new(),
            pdf_url: String::new(),
            citation_count,
            discovered_via: "search".into(),
            retrieval_text: String::new(),
            retrieval_score: None,
        }
    }

    #[test]
    fn assigns_relevance_bands_and_exposes_matched_subqueries() {
        let request = PaperSearchRequest {
            all_terms: vec!["query evolution".into()],
            title_terms: vec!["academic search".into()],
            ..PaperSearchRequest::default()
        };
        let ranked = heuristic_rank_papers(
            &[
                candidate(
                    "Academic search with query evolution",
                    "Citation-aware paper retrieval and query evolution.",
                    240,
                ),
                candidate(
                    "General information retrieval",
                    "A broad retrieval overview.",
                    1,
                ),
            ],
            &request,
            &["academic search query evolution".into()],
            RankingMode::Relevance,
            2,
        );

        assert_eq!(ranked[0].relevance_band, "high");
        assert_eq!(
            ranked[0].matched_queries,
            vec!["academic search query evolution"]
        );
        assert_eq!(ranked[1].relevance_band, "partial");
    }

    #[test]
    fn exact_core_title_match_beats_a_highly_cited_partial_match() {
        let target = candidate(
            "Parallel resources for Tunisian Arabic Dialect Translation",
            "A translated comments corpus for Tunisian Arabic.",
            5,
        );
        let distractor = candidate(
            "Normalization of Tunisian Arabic",
            "A widely cited survey of dialect processing.",
            5_000,
        );
        let ranked = heuristic_rank_papers(
            &[distractor, target],
            &PaperSearchRequest::default(),
            &[
                "translation tunisian arabic dialect".into(),
                "comments native speakers data augmented segmentation stop words".into(),
            ],
            RankingMode::Relevance,
            2,
        );

        assert_eq!(
            ranked[0].title,
            "Parallel resources for Tunisian Arabic Dialect Translation"
        );
        assert_eq!(ranked[0].relevance_band, "high");
    }

    #[test]
    fn complementary_query_title_match_is_ranked_as_a_first_class_intent() {
        let target = candidate(
            "A Neural Architecture for Dialectal Arabic Segmentation",
            "A segmentation model for Arabic dialects.",
            20,
        );
        let distractor = candidate(
            "Graph-Based Arabic Summarization Using Multiple Morphological Analyzers",
            "Uses morphological analyzers as preprocessing tools.",
            200,
        );
        let ranked = heuristic_rank_papers(
            &[distractor, target],
            &PaperSearchRequest::default(),
            &[
                "morphological analyzer handling multiple arabic dialects".into(),
                "dialectal arabic segmentation".into(),
            ],
            RankingMode::Relevance,
            2,
        );

        assert!(ranked[0].title.starts_with("A Neural Architecture"));
    }

    #[test]
    fn exact_complementary_title_match_survives_a_large_primary_result_pool() {
        let target = candidate(
            "CrossWeigh: Training Named Entity Tagger from Imperfect Annotations",
            "A robust named entity tagger for noisy annotations.",
            20,
        );
        let mut candidates = (0..25)
            .map(|index| {
                candidate(
                    &format!("Context Named Entity Recognition Study {index}"),
                    "A generic context-based named entity recognition system.",
                    5_000,
                )
            })
            .collect::<Vec<_>>();
        candidates.push(target);

        let ranked = heuristic_rank_papers(
            &candidates,
            &PaperSearchRequest::default(),
            &[
                "context named entity recognition".into(),
                "crossweigh training named entity tagger imperfect annotations".into(),
            ],
            RankingMode::Relevance,
            20,
        );

        assert!(ranked
            .iter()
            .any(|paper| paper.title.starts_with("CrossWeigh:")));
        assert!(ranked[0].title.starts_with("CrossWeigh:"));
    }

    #[test]
    fn shorter_exact_complementary_title_match_gets_the_same_intent_priority() {
        let target = candidate(
            "Making Sense of Word Embeddings",
            "Matches word senses without external lexical resources.",
            20,
        );
        let mut candidates = (0..25)
            .map(|index| {
                candidate(
                    &format!("Matching Word Senses in Contexts Study {index}"),
                    "A generic contextual word sense matching system.",
                    5_000,
                )
            })
            .collect::<Vec<_>>();
        candidates.push(target);

        let ranked = heuristic_rank_papers(
            &candidates,
            &PaperSearchRequest::default(),
            &[
                "matching word senses contexts".into(),
                "making sense of word embeddings".into(),
            ],
            RankingMode::Relevance,
            20,
        );

        assert!(ranked
            .iter()
            .any(|paper| paper.title == "Making Sense of Word Embeddings"));
    }

    #[test]
    fn quality_mode_can_prioritize_an_influential_citation_seed() {
        let exact = candidate(
            "Parallel resources for Tunisian Arabic Dialect Translation",
            "A translated comments corpus for Tunisian Arabic.",
            5,
        );
        let influential = candidate(
            "Normalization of Tunisian Arabic",
            "A widely cited survey of dialect processing.",
            5_000,
        );
        let ranked = heuristic_rank_papers(
            &[exact, influential],
            &PaperSearchRequest::default(),
            &["translation tunisian arabic dialect".into()],
            RankingMode::Quality,
            2,
        );

        assert_eq!(ranked[0].title, "Normalization of Tunisian Arabic");
    }

    #[test]
    fn citation_connected_candidates_receive_a_small_relevance_bonus() {
        let direct = candidate(
            "Distilling BERT for Language Understanding",
            "Knowledge distillation for model compression.",
            100,
        );
        let mut connected = direct.clone();
        connected.id = "connected".into();
        connected.discovered_via = "reference".into();
        let ranked = heuristic_rank_papers(
            &[direct, connected],
            &PaperSearchRequest::default(),
            &["knowledge distillation language model compression".into()],
            RankingMode::Relevance,
            2,
        );

        assert_eq!(ranked[0].arxiv_id, "connected");
        assert_eq!(ranked[0].score - ranked[1].score, 4);
    }

    #[test]
    fn early_specific_terms_beat_common_language_model_words() {
        let specific = candidate(
            "Calibrate Before Use: Improving Few-Shot Performance of Language Models",
            "Contextual calibration corrects answer probability biases.",
            500,
        );
        let common = candidate(
            "Universal and Transferable Adversarial Attacks on Aligned Language Models",
            "An unrelated but highly cited language model paper.",
            5_000,
        );
        let ranked = heuristic_rank_papers(
            &[common, specific],
            &PaperSearchRequest::default(),
            &["contextualized calibration probability answers language models".into()],
            RankingMode::Relevance,
            2,
        );

        assert!(ranked[0].title.starts_with("Calibrate Before Use"));
    }

    #[test]
    fn citation_seeds_mix_relevance_and_graph_quality() {
        let specific = candidate(
            "Calibrate Before Use: Improving Few-Shot Performance of Language Models",
            "Contextual calibration corrects answer probability biases.",
            500,
        );
        let common = candidate(
            "Universal and Transferable Adversarial Attacks on Aligned Language Models",
            "An unrelated but highly cited language model paper.",
            5_000,
        );
        let ids = select_citation_seed_ids(
            &[common, specific],
            &PaperSearchRequest::default(),
            &["contextualized calibration probability answers language models".into()],
            2,
        );

        assert!(ids[0].starts_with("Calibrate Before Use"));
        assert!(ids[1].starts_with("Universal and Transferable"));
    }
}
