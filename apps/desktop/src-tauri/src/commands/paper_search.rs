use crate::ccf::match_venue;
use crate::commands::paper_search_plan::{plan_paper_search_queries, PaperSearchIntent};
use crate::commands::paper_search_ranking::{
    fallback_overall_summary, fallback_ranking_note, heuristic_rank_papers, rerank_with_xiaoyan,
    select_citation_seed_ids, PaperRecommendation, RankingMode,
};
use crate::commands::paper_search_response_cache;
use crate::commands::paper_search_snippets::{
    fetch_semantic_scholar_snippet_candidates, merge_full_text_retrieval_signal,
};
use crate::commands::paper_search_strategy::{
    expand_citation_network, filter_low_quality_candidates, PaperRelation, SearchDepth,
    SearchMetrics, SearchStep,
};
use crate::semantic_scholar::throttle_semantic_scholar_request;
use crate::state::AppState;
use anyhow::Context;
use chrono::{Datelike, Duration as ChronoDuration, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use tauri::State;

const SEMANTIC_SCHOLAR_API_URL: &str = "https://api.semanticscholar.org/graph/v1/paper/search";
const SEMANTIC_SCHOLAR_USER_AGENT: &str = "xiaoyan-desktop/0.5.4";

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", default)]
pub struct PaperSearchRequest {
    pub(crate) topic: String,
    pub(crate) all_terms: Vec<String>,
    pub(crate) title_terms: Vec<String>,
    pub(crate) abstract_terms: Vec<String>,
    pub(crate) authors: Vec<String>,
    pub(crate) categories: Vec<String>,
    pub(crate) comments_terms: Vec<String>,
    pub(crate) journal_ref_terms: Vec<String>,
    pub(crate) exclude_terms: Vec<String>,
}

impl PaperSearchRequest {
    fn normalize(mut self) -> Self {
        self.topic = clean_whitespace(&self.topic);
        self.all_terms = normalize_term_list(self.all_terms);
        self.title_terms = normalize_term_list(self.title_terms);
        self.abstract_terms = normalize_term_list(self.abstract_terms);
        self.authors = normalize_term_list(self.authors);
        self.categories = normalize_term_list(self.categories);
        self.comments_terms = normalize_term_list(self.comments_terms);
        self.journal_ref_terms = normalize_term_list(self.journal_ref_terms);
        self.exclude_terms = normalize_term_list(self.exclude_terms);
        self
    }

    fn has_search_terms(&self) -> bool {
        !self.topic.is_empty()
            || !self.all_terms.is_empty()
            || !self.title_terms.is_empty()
            || !self.abstract_terms.is_empty()
            || !self.authors.is_empty()
            || !self.categories.is_empty()
            || !self.comments_terms.is_empty()
            || !self.journal_ref_terms.is_empty()
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticScholarPaper {
    paper_id: String,
    #[serde(default)]
    corpus_id: Option<i64>,
    title: String,
    #[serde(default, rename = "abstract")]
    abstract_text: Option<String>,
    #[serde(default)]
    year: Option<i32>,
    #[serde(default)]
    venue: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    citation_count: Option<i32>,
    #[serde(default)]
    publication_date: Option<String>,
    #[serde(default)]
    authors: Vec<SemanticScholarAuthor>,
    #[serde(default)]
    open_access_pdf: Option<SemanticScholarPdf>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticScholarAuthor {
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticScholarPdf {
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticScholarSearchResponse {
    #[serde(default)]
    data: Vec<SemanticScholarPaper>,
}

#[derive(Debug, Clone)]
pub(crate) struct PaperCandidate {
    pub(crate) id: String,
    pub(crate) corpus_id: Option<i64>,
    pub(crate) title: String,
    pub(crate) authors: String,
    pub(crate) venue: String,
    pub(crate) year: Option<i32>,
    pub(crate) published_at: String,
    pub(crate) abstract_text: String,
    pub(crate) detail_url: String,
    pub(crate) pdf_url: String,
    pub(crate) citation_count: i32,
    pub(crate) discovered_via: String,
    pub(crate) retrieval_text: String,
    pub(crate) retrieval_score: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct PaperSearchResponse {
    query: String,
    keywords: Vec<String>,
    applied_filters: PaperSearchRequest,
    search_expression: String,
    search_queries: Vec<String>,
    query_plan_llm_used: bool,
    query_plan_note: String,
    search_intent: PaperSearchIntent,
    search_depth: String,
    strategy_trace: Vec<SearchStep>,
    metrics: SearchMetrics,
    relations: Vec<PaperRelation>,
    cutoff_date: String,
    limit: usize,
    ranking_mode: String,
    candidate_count: usize,
    llm_used: bool,
    ranking_note: String,
    overall_summary: String,
    disclaimer: String,
    papers: Vec<PaperRecommendation>,
    #[cfg(test)]
    evaluation_candidates: Vec<PaperSearchEvaluationCandidate>,
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct PaperSearchEvaluationCandidate {
    paper_id: String,
    corpus_id: Option<i64>,
    title: String,
    rank: usize,
    score: i32,
    discovered_via: String,
}

fn normalize_cutoff_date(value: Option<&str>, today: NaiveDate) -> Result<String, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(today.format("%Y-%m-%d").to_string());
    };
    let cutoff = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| "截止日期格式无效，请使用 YYYY-MM-DD".to_string())?;
    if cutoff > today {
        return Err("截止日期不能晚于今天".to_string());
    }
    Ok(cutoff.format("%Y-%m-%d").to_string())
}

#[tauri::command]
pub async fn paper_search(
    state: State<'_, AppState>,
    request: PaperSearchRequest,
    cutoff_date: Option<String>,
    limit: Option<i32>,
    ranking_mode: Option<String>,
    search_depth: Option<String>,
) -> Result<serde_json::Value, String> {
    let settings = state.settings.read().await.clone();
    execute_paper_search(
        &settings,
        request,
        cutoff_date,
        limit,
        ranking_mode,
        search_depth,
    )
    .await
}

pub(crate) async fn execute_paper_search(
    settings: &HashMap<String, String>,
    request: PaperSearchRequest,
    cutoff_date: Option<String>,
    limit: Option<i32>,
    ranking_mode: Option<String>,
    search_depth: Option<String>,
) -> Result<serde_json::Value, String> {
    let total_started = Instant::now();
    let request = request.normalize();
    if !request.has_search_terms() {
        return Err("请至少填写一个检索条件".into());
    }

    let cutoff_date = normalize_cutoff_date(cutoff_date.as_deref(), Local::now().date_naive())?;
    let result_limit = limit.unwrap_or(6).clamp(1, 50) as usize;
    let mode = RankingMode::from_value(ranking_mode.as_deref());
    let depth = SearchDepth::from_value(search_depth.as_deref());
    let query = describe_request(&request);
    let keywords = collect_keywords(&request);
    let structured_terms = collect_structured_search_terms(&request);
    let plan_started = Instant::now();
    let search_plan = plan_paper_search_queries(settings, &request.topic, &structured_terms).await;
    if search_plan.queries.is_empty() {
        return Err("无法从当前输入生成有效检索式，请补充更具体的自然语言需求或关键词".into());
    }
    let search_queries = search_plan
        .queries
        .iter()
        .take(depth.query_limit())
        .cloned()
        .collect::<Vec<_>>();
    let search_expression = search_queries.join("\n");
    let mut metrics = SearchMetrics {
        llm_calls: search_plan.llm_calls,
        estimated_tokens: search_plan.estimated_tokens,
        iterations: 1,
        ..SearchMetrics::default()
    };
    let mut strategy_trace = vec![SearchStep {
        stage: "query_plan",
        label: "查询理解与分解".into(),
        status: "completed",
        query: None,
        candidate_count: Some(search_queries.len()),
        duration_ms: plan_started.elapsed().as_millis() as u64,
        note: search_plan.note.clone(),
    }];

    let publication_date_range = format!(":{cutoff_date}");
    let mut candidates = Vec::new();
    let mut seen_candidates = HashSet::new();
    let mut successful_queries = 0usize;
    let mut last_search_error = None;
    for search_query in &search_queries {
        let query_started = Instant::now();
        metrics.academic_api_calls += 1;
        match fetch_semantic_scholar_candidates_with_date_range(
            settings,
            search_query,
            &request.exclude_terms,
            Some(&publication_date_range),
            candidate_pool_size(result_limit),
        )
        .await
        {
            Ok(query_candidates) => {
                successful_queries += 1;
                let query_candidate_count = query_candidates.len();
                for candidate in query_candidates {
                    let key = if candidate.id.trim().is_empty() {
                        format!("title:{}", candidate.title.trim().to_lowercase())
                    } else {
                        format!("id:{}", candidate.id)
                    };
                    if seen_candidates.insert(key) {
                        candidates.push(candidate);
                    }
                }
                strategy_trace.push(SearchStep {
                    stage: "academic_search",
                    label: "Semantic Scholar 学术检索".into(),
                    status: "completed",
                    query: Some(search_query.clone()),
                    candidate_count: Some(query_candidate_count),
                    duration_ms: query_started.elapsed().as_millis() as u64,
                    note: "已完成一条子查询并合并去重候选。".into(),
                });
            }
            Err(error) => {
                strategy_trace.push(SearchStep {
                    stage: "academic_search",
                    label: "Semantic Scholar 学术检索".into(),
                    status: "partial",
                    query: Some(search_query.clone()),
                    candidate_count: Some(0),
                    duration_ms: query_started.elapsed().as_millis() as u64,
                    note: format!("该子查询失败，继续保留其他查询结果：{error:#}"),
                });
                last_search_error = Some(error);
            }
        }
    }
    if depth.uses_full_text_snippets() {
        let snippet_started = Instant::now();
        let snippet_expansion = fetch_semantic_scholar_snippet_candidates(
            settings,
            &request.topic,
            &request.exclude_terms,
            &cutoff_date,
            snippet_candidate_pool_size(result_limit),
        )
        .await;
        metrics.academic_api_calls += snippet_expansion.api_calls;
        let snippet_candidate_count = snippet_expansion.candidates.len();
        if snippet_expansion.error.is_none() {
            successful_queries += 1;
        }
        for candidate in snippet_expansion.candidates {
            let key = if candidate.id.trim().is_empty() {
                format!("title:{}", candidate.title.trim().to_lowercase())
            } else {
                format!("id:{}", candidate.id)
            };
            if seen_candidates.insert(key) {
                candidates.push(candidate);
            } else if let Some(existing) = candidates
                .iter_mut()
                .find(|existing| existing.id == candidate.id)
            {
                merge_full_text_retrieval_signal(existing, &candidate);
            }
        }
        strategy_trace.push(SearchStep {
            stage: "full_text_search",
            label: "Semantic Scholar 全文片段检索".into(),
            status: if snippet_expansion.error.is_none() {
                "completed"
            } else {
                "partial"
            },
            query: Some(request.topic.clone()),
            candidate_count: Some(snippet_candidate_count),
            duration_ms: snippet_started.elapsed().as_millis() as u64,
            note: snippet_expansion.error.map_or_else(
                || "已按标题、摘要与正文片段补充描述型查询候选。".into(),
                |error| format!("全文片段检索失败，继续保留论文级结果：{error}"),
            ),
        });
    }
    if successful_queries == 0 {
        return Err(last_search_error
            .map(|error| format!("{error:#}"))
            .unwrap_or_else(|| "联网学术检索失败".to_string()));
    }

    let candidate_count_before_filter = candidates.len();
    let unfiltered_candidates = candidates.clone();
    let (filtered_candidates, filtered_count) = filter_low_quality_candidates(candidates);
    candidates = if filtered_candidates.is_empty() && candidate_count_before_filter > 0 {
        strategy_trace.push(SearchStep {
            stage: "quality_filter",
            label: "低质量候选过滤".into(),
            status: "partial",
            query: None,
            candidate_count: Some(candidate_count_before_filter),
            duration_ms: 0,
            note: "质量门槛会移除全部候选，已保留首轮结果以避免召回归零。".into(),
        });
        unfiltered_candidates
    } else {
        metrics.filtered_count += filtered_count;
        strategy_trace.push(SearchStep {
            stage: "quality_filter",
            label: "低质量候选过滤".into(),
            status: "completed",
            query: None,
            candidate_count: Some(filtered_candidates.len()),
            duration_ms: 0,
            note: format!("移除 {filtered_count} 条缺少基本学术元数据或明确异常的记录。"),
        });
        filtered_candidates
    };

    if candidates.is_empty() {
        metrics.duration_ms = total_started.elapsed().as_millis() as u64;
        let empty = PaperSearchResponse {
            query,
            keywords,
            applied_filters: request.clone(),
            search_expression,
            search_queries,
            query_plan_llm_used: search_plan.llm_used,
            query_plan_note: search_plan.note,
            search_intent: search_plan.intent,
            search_depth: depth.as_str().into(),
            strategy_trace,
            metrics,
            relations: Vec::new(),
            cutoff_date,
            limit: result_limit,
            ranking_mode: mode.as_str().to_string(),
            candidate_count: 0,
            llm_used: false,
            ranking_note: "未检索到匹配论文。".into(),
            overall_summary: "可以精简自然语言需求、补充关键词、放宽领域筛选或减少排除词后重试。"
                .into(),
            disclaimer: "检索结果来自联网学术数据源，覆盖范围与实时性受第三方接口影响。".into(),
            papers: Vec::new(),
            #[cfg(test)]
            evaluation_candidates: Vec::new(),
        };
        return Ok(json!(empty));
    }

    let seed_ids =
        select_citation_seed_ids(&candidates, &request, &search_queries, depth.seed_limit());
    let expansion = expand_citation_network(settings, &seed_ids, depth).await;
    metrics.academic_api_calls += expansion.api_calls;
    if expansion.api_calls > 0 {
        metrics.iterations += 1;
    }
    strategy_trace.extend(expansion.steps);
    let mut relations = expansion.relations;
    for candidate in expansion.candidates {
        if !candidate_matches_cutoff(&candidate, &cutoff_date)
            || candidate_matches_exclusion(&candidate, &request.exclude_terms)
        {
            metrics.filtered_count += 1;
            continue;
        }
        let key = if candidate.id.trim().is_empty() {
            format!("title:{}", candidate.title.trim().to_lowercase())
        } else {
            format!("id:{}", candidate.id)
        };
        if seen_candidates.insert(key) {
            candidates.push(candidate);
        }
    }

    let unfiltered_expanded = candidates.clone();
    let (filtered_candidates, expansion_filtered) = filter_low_quality_candidates(candidates);
    if filtered_candidates.is_empty() && !unfiltered_expanded.is_empty() {
        candidates = unfiltered_expanded;
    } else {
        candidates = filtered_candidates;
        metrics.filtered_count += expansion_filtered;
    }

    // 对全部候选做启发式排序，既用于无 LLM 时的降级，也用于 LLM 返回不足时的兜底回填。
    let heuristic = heuristic_rank_papers(
        &candidates,
        &request,
        &search_queries,
        mode,
        candidates.len().max(result_limit),
    );
    let rerank = rerank_with_xiaoyan(
        settings,
        &query,
        &query,
        &search_queries,
        mode,
        result_limit,
        &candidates,
    )
    .await;
    metrics.llm_calls += rerank.llm_calls;
    metrics.estimated_tokens += rerank.estimated_tokens;
    let (llm_used, ranking_note, overall_summary, mut papers) = match rerank.ranking {
        Some((note, summary, ranked)) => (true, note, summary, ranked),
        None => {
            let fallback_note = match rerank.error {
                Some(error) => {
                    eprintln!("小妍论文重排失败，使用启发式排序：{error}");
                    format!("小妍模型重排未完成，{}", fallback_ranking_note(mode))
                }
                None => format!(
                    "未检测到可用的论文检索模型或小妍主模型，{}",
                    fallback_ranking_note(mode)
                ),
            };
            (
                false,
                fallback_note,
                fallback_overall_summary(mode, candidates.len(), result_limit),
                heuristic.iter().take(result_limit).cloned().collect(),
            )
        }
    };

    // LLM 仅对前若干候选重排，返回不足目标篇数时用启发式结果按相关性补齐，尽量凑满 limit。
    if papers.len() < result_limit {
        let existing: HashSet<String> = papers.iter().map(|paper| paper.arxiv_id.clone()).collect();
        for candidate in &heuristic {
            if papers.len() >= result_limit {
                break;
            }
            if !existing.contains(&candidate.arxiv_id) {
                papers.push(candidate.clone());
            }
        }
    }

    strategy_trace.push(SearchStep {
        stage: "rerank",
        label: "候选综合排序".into(),
        status: "completed",
        query: None,
        candidate_count: Some(papers.len()),
        duration_ms: 0,
        note: if llm_used {
            "已结合标题、摘要、影响力与原始查询完成模型重排。".into()
        } else {
            "模型不可用或返回无效，已使用确定性启发式排序。".into()
        },
    });
    let final_ids = papers
        .iter()
        .map(|paper| paper.arxiv_id.as_str())
        .collect::<HashSet<_>>();
    // 引文扩展统一以种子论文为 source、扩展命中为 target。只要扩展论文进入最终
    // 推荐就保留发现路径；种子未进入最终列表时，前端仍可用论文 id 展示该节点。
    relations.retain(|relation| final_ids.contains(relation.target_id.as_str()));
    metrics.duration_ms = total_started.elapsed().as_millis() as u64;

    #[cfg(test)]
    let evaluation_candidates = {
        let candidates_by_id = candidates
            .iter()
            .map(|candidate| (candidate.id.as_str(), candidate))
            .collect::<HashMap<_, _>>();
        heuristic
            .iter()
            .enumerate()
            .filter_map(|(index, ranked)| {
                candidates_by_id
                    .get(ranked.arxiv_id.as_str())
                    .map(|candidate| PaperSearchEvaluationCandidate {
                        paper_id: candidate.id.clone(),
                        corpus_id: candidate.corpus_id,
                        title: candidate.title.clone(),
                        rank: index + 1,
                        score: ranked.evaluation_score(),
                        discovered_via: candidate.discovered_via.clone(),
                    })
            })
            .collect::<Vec<_>>()
    };

    let response = PaperSearchResponse {
        query,
        keywords,
        applied_filters: request,
        search_expression,
        search_queries,
        query_plan_llm_used: search_plan.llm_used,
        query_plan_note: search_plan.note,
        search_intent: search_plan.intent,
        search_depth: depth.as_str().into(),
        strategy_trace,
        metrics,
        relations,
        cutoff_date,
        limit: result_limit,
        ranking_mode: mode.as_str().to_string(),
        candidate_count: candidates.len(),
        llm_used,
        ranking_note,
        overall_summary,
        disclaimer: "检索结果来自联网学术数据源，覆盖范围与实时性受第三方接口影响。".into(),
        papers,
        #[cfg(test)]
        evaluation_candidates,
    };

    Ok(json!(response))
}

pub async fn search_survey_candidates(
    settings: &HashMap<String, String>,
    query: &str,
    search_queries: &[String],
    limit: usize,
    year_from: Option<i32>,
    year_to: Option<i32>,
) -> anyhow::Result<Vec<serde_json::Value>> {
    let search_terms = collect_survey_search_terms(query, search_queries, 8);
    if search_terms.is_empty() {
        return Ok(Vec::new());
    }

    let max_results = candidate_pool_size(limit.max(1)).max(12);
    let mut candidates = Vec::new();
    let mut seen_candidate_ids = HashSet::new();
    let mut last_error = None;
    for term in &search_terms {
        match fetch_semantic_scholar_candidates_with_date_range(
            settings,
            term,
            &[],
            None,
            max_results,
        )
        .await
        {
            Ok(term_candidates) => {
                for candidate in term_candidates {
                    let key = if candidate.id.trim().is_empty() {
                        format!("title:{}", candidate.title.trim().to_lowercase())
                    } else {
                        format!("id:{}", candidate.id)
                    };
                    if seen_candidate_ids.insert(key) {
                        candidates.push(candidate);
                    }
                }
            }
            Err(error) => {
                last_error = Some(error);
            }
        }
    }
    if candidates.is_empty() {
        if let Some(error) = last_error {
            return Err(error);
        }
    }

    let lower_terms = search_terms
        .iter()
        .map(|term| term.to_lowercase())
        .collect::<Vec<_>>();
    let mut seen_titles = HashSet::new();
    let mut filtered = candidates
        .into_iter()
        .filter(|candidate| matches_year_range(candidate.year, year_from, year_to))
        .filter(|candidate| {
            let normalized = candidate.title.trim().to_lowercase();
            !normalized.is_empty() && seen_titles.insert(normalized)
        })
        .collect::<Vec<_>>();

    filtered.sort_by(|left, right| {
        score_survey_candidate(right, &lower_terms)
            .cmp(&score_survey_candidate(left, &lower_terms))
            .then_with(|| right.citation_count.cmp(&left.citation_count))
    });

    Ok(filtered
        .into_iter()
        .take(limit.max(1))
        .map(|candidate| {
            let mut paper = json!({
                "id": candidate.id,
                "title": candidate.title,
                "authors": candidate.authors,
                "abstract": candidate.abstract_text,
                "year": candidate.year.map(i64::from),
                "venue": candidate.venue,
                "doi": "",
                "paper_url": candidate.detail_url,
                "status": "external",
            });

            if let Some(venue) = paper.get("venue").and_then(|value| value.as_str()) {
                if let Some(tag) = match_venue(venue) {
                    paper["ccf_rating"] = json!(tag.rating);
                    paper["ccf_area"] = json!(tag.area);
                    paper["ccf_type"] = json!(tag.kind);
                    paper["ccf_label"] = json!(tag.label);
                    paper["ccf_publisher"] = json!(tag.publisher);
                    paper["venue_url"] = json!(tag.url);
                }
            }

            paper
        })
        .collect())
}

fn collect_survey_search_terms(
    query: &str,
    search_queries: &[String],
    max_terms: usize,
) -> Vec<String> {
    let mut seen_terms = HashSet::new();
    std::iter::once(query.to_string())
        .chain(search_queries.iter().cloned())
        .map(|term| clean_whitespace(&term))
        .filter(|term| {
            if term.is_empty() {
                return false;
            }
            seen_terms.insert(term.to_lowercase())
        })
        .take(max_terms)
        .collect()
}

pub(crate) async fn fetch_semantic_scholar_candidates(
    settings: &HashMap<String, String>,
    query: &str,
    exclude_terms: &[String],
    days: i64,
    max_results: usize,
) -> anyhow::Result<Vec<PaperCandidate>> {
    let start_date = Local::now().date_naive() - ChronoDuration::days(days.clamp(1, 36_500));
    let publication_date_range = format!("{}:", start_date.format("%Y-%m-%d"));
    fetch_semantic_scholar_candidates_with_date_range(
        settings,
        query,
        exclude_terms,
        Some(&publication_date_range),
        max_results,
    )
    .await
}

async fn fetch_semantic_scholar_candidates_with_date_range(
    settings: &HashMap<String, String>,
    query: &str,
    exclude_terms: &[String],
    publication_date_range: Option<&str>,
    max_results: usize,
) -> anyhow::Result<Vec<PaperCandidate>> {
    let cache_key = format!(
        "semantic-scholar-search-v1|{query}|{}|{max_results}",
        publication_date_range.unwrap_or_default()
    );
    let cached_payload = paper_search_response_cache::load(&cache_key)?;
    let client = reqwest::Client::new();
    let mut builder = client
        .get(SEMANTIC_SCHOLAR_API_URL)
        .header("User-Agent", SEMANTIC_SCHOLAR_USER_AGENT)
        .query(&[
            ("query", query.to_string()),
            ("limit", max_results.to_string()),
            (
                "fields",
                "paperId,corpusId,title,abstract,year,venue,url,citationCount,publicationDate,authors,openAccessPdf"
                    .to_string(),
            ),
        ]);

    if let Some(publication_date_range) = publication_date_range {
        builder = builder.query(&[("publicationDateOrYear", publication_date_range.to_string())]);
    }

    if let Some(api_key) = settings
        .get("semantic_scholar_api_key")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        builder = builder.header("x-api-key", api_key);
    }

    let base_request = builder.build().context("联网检索请求构建失败")?;

    let payload: SemanticScholarSearchResponse = if let Some(payload) = cached_payload {
        serde_json::from_slice(&payload).context("解析论文评测响应缓存失败")?
    } else {
        const MAX_RETRIES: u32 = 4;
        let mut attempt = 0u32;
        let response = loop {
            let req = base_request.try_clone().context("联网检索请求克隆失败")?;
            throttle_semantic_scholar_request().await;
            let resp = client.execute(req).await.context("联网检索请求失败")?;
            if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                attempt += 1;
                if attempt >= MAX_RETRIES {
                    return Err(anyhow::anyhow!(
                        "Semantic Scholar 接口触发速率限制（429）。\n\
                         请在「设置 → 外部学术服务」中配置 Semantic Scholar API Key 以获得更高频次限额。\n\
                         免费 Key 申请：https://www.semanticscholar.org/product/api#api-key-form"
                    ));
                }
                let retry_after = resp
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok());
                let wait_secs = retry_after
                    .unwrap_or_else(|| 2u64.pow(attempt))
                    .clamp(2, 30);
                tokio::time::sleep(Duration::from_secs(wait_secs)).await;
                continue;
            }
            break resp;
        };
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("联网检索返回错误 {status}: {body}"));
        }
        let response_bytes = response.bytes().await.context("读取联网检索结果失败")?;
        let parsed = serde_json::from_slice(&response_bytes).context("解析联网检索结果失败")?;
        paper_search_response_cache::store(&cache_key, &response_bytes)?;
        parsed
    };

    let mut result = Vec::new();
    for item in payload.data {
        let lower_text = format!(
            "{}\n{}\n{}",
            item.title,
            item.abstract_text.clone().unwrap_or_default(),
            item.venue.clone().unwrap_or_default()
        )
        .to_lowercase();

        if exclude_terms
            .iter()
            .any(|term| !term.is_empty() && lower_text.contains(&term.to_lowercase()))
        {
            continue;
        }

        let authors = item
            .authors
            .iter()
            .filter_map(|author| author.name.clone())
            .filter(|name| !name.trim().is_empty())
            .collect::<Vec<_>>()
            .join(", ");

        let venue = item.venue.unwrap_or_else(|| "Unknown venue".to_string());
        let published_at = item
            .publication_date
            .clone()
            .unwrap_or_else(|| item.year.map(|v| format!("{v}-01-01")).unwrap_or_default());
        let detail_url = item
            .url
            .clone()
            .unwrap_or_else(|| format!("https://www.semanticscholar.org/paper/{}", item.paper_id));
        let pdf_url = item
            .open_access_pdf
            .and_then(|pdf| pdf.url)
            .unwrap_or_else(|| detail_url.clone());

        result.push(PaperCandidate {
            id: item.paper_id,
            corpus_id: item.corpus_id,
            title: item.title,
            authors,
            venue,
            year: item.year,
            published_at,
            abstract_text: item.abstract_text.unwrap_or_default(),
            detail_url,
            pdf_url,
            citation_count: item.citation_count.unwrap_or(0),
            discovered_via: "search".into(),
            retrieval_text: String::new(),
            retrieval_score: None,
        });
    }

    Ok(result)
}

fn candidate_matches_cutoff(candidate: &PaperCandidate, cutoff_date: &str) -> bool {
    let Ok(cutoff) = NaiveDate::parse_from_str(cutoff_date, "%Y-%m-%d") else {
        return true;
    };
    if let Some(prefix) = candidate.published_at.get(..10) {
        if let Ok(published) = NaiveDate::parse_from_str(prefix, "%Y-%m-%d") {
            return published <= cutoff;
        }
    }
    candidate.year.is_none_or(|year| year <= cutoff.year())
}

fn candidate_matches_exclusion(candidate: &PaperCandidate, exclude_terms: &[String]) -> bool {
    let haystack = format!(
        "{} {} {}",
        candidate.title, candidate.abstract_text, candidate.venue
    )
    .to_lowercase();
    exclude_terms
        .iter()
        .map(|term| term.trim().to_lowercase())
        .any(|term| !term.is_empty() && haystack.contains(&term))
}

fn matches_year_range(year: Option<i32>, year_from: Option<i32>, year_to: Option<i32>) -> bool {
    match year {
        Some(value) if year_from.is_some_and(|from| value < from) => false,
        Some(value) if year_to.is_some_and(|to| value > to) => false,
        _ => true,
    }
}

fn score_survey_candidate(candidate: &PaperCandidate, query_terms: &[String]) -> i32 {
    let haystack = format!(
        "{}\n{}\n{}\n{}",
        candidate.title, candidate.abstract_text, candidate.authors, candidate.venue
    )
    .to_lowercase();

    let keyword_score = query_terms
        .iter()
        .filter(|term| !term.is_empty() && haystack.contains(term.as_str()))
        .count() as i32
        * 12;

    (50 + keyword_score + (candidate.citation_count / 150).clamp(0, 16)).clamp(0, 100)
}

fn describe_request(request: &PaperSearchRequest) -> String {
    let mut parts = Vec::new();
    if !request.topic.is_empty() {
        parts.push(format!("自然语言需求：{}", request.topic));
    }
    if !request.all_terms.is_empty() {
        parts.push(format!("关键词：{}", request.all_terms.join(" / ")));
    }
    if !request.title_terms.is_empty() {
        parts.push(format!("标题词：{}", request.title_terms.join(" / ")));
    }
    if !request.abstract_terms.is_empty() {
        parts.push(format!("摘要词：{}", request.abstract_terms.join(" / ")));
    }
    if !request.authors.is_empty() {
        parts.push(format!("作者：{}", request.authors.join(" / ")));
    }
    if !request.journal_ref_terms.is_empty() {
        parts.push(format!("刊会：{}", request.journal_ref_terms.join(" / ")));
    }
    if !request.categories.is_empty() {
        parts.push(format!("领域：{}", request.categories.join(" / ")));
    }
    if !request.exclude_terms.is_empty() {
        parts.push(format!("排除：{}", request.exclude_terms.join(" / ")));
    }

    if parts.is_empty() {
        "未提供额外条件".to_string()
    } else {
        parts.join("；")
    }
}

fn collect_keywords(request: &PaperSearchRequest) -> Vec<String> {
    let mut merged = Vec::new();
    merged.extend(request.all_terms.clone());
    merged.extend(request.title_terms.clone());
    merged.extend(request.abstract_terms.clone());
    merged.extend(request.authors.clone());
    merged.extend(request.categories.clone());
    merged.extend(request.journal_ref_terms.clone());

    let mut seen = HashSet::new();
    merged
        .into_iter()
        .filter(|value| {
            let key = value.trim().to_lowercase();
            !key.is_empty() && seen.insert(key)
        })
        .collect()
}

fn collect_structured_search_terms(request: &PaperSearchRequest) -> Vec<String> {
    let mut terms = Vec::new();
    terms.extend(request.all_terms.clone());
    terms.extend(request.title_terms.clone());
    terms.extend(request.abstract_terms.clone());
    terms.extend(request.authors.clone());
    terms.extend(request.categories.clone());
    terms.extend(request.comments_terms.clone());
    terms.extend(request.journal_ref_terms.clone());

    let mut seen = HashSet::new();
    terms
        .into_iter()
        .filter(|value| {
            let key = value.trim().to_lowercase();
            !key.is_empty() && seen.insert(key)
        })
        .collect()
}

fn clean_whitespace(input: &str) -> String {
    input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn normalize_term_list(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| clean_whitespace(&value))
        .filter(|value| {
            if value.is_empty() {
                return false;
            }
            let key = value.to_lowercase();
            seen.insert(key)
        })
        .collect()
}

fn candidate_pool_size(limit: usize) -> usize {
    // Semantic Scholar 单次 limit 上限约 100，取候选池上限 100 以支撑更大的返回篇数。
    (limit.saturating_mul(4)).clamp(12, 100)
}

fn snippet_candidate_pool_size(limit: usize) -> usize {
    limit.clamp(10, 20)
}

// ── Search history persistence ─────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PaperSearchSaveHistoryRequest {
    pub draft_json: String,
    pub result_json: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PaperSearchHistoryEntry {
    pub id: String,
    pub draft_json: String,
    pub result_json: String,
    pub created_at: String,
}

#[tauri::command]
pub async fn paper_search_save_history(
    state: State<'_, AppState>,
    request: PaperSearchSaveHistoryRequest,
) -> Result<PaperSearchHistoryEntry, String> {
    let trimmed_draft = request.draft_json.trim();
    if trimmed_draft.is_empty() || trimmed_draft == "{}" {
        return Err("检索条件为空，无法保存历史记录。".into());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    let result_json = if request.result_json.trim().is_empty() {
        "{}".into()
    } else {
        request.result_json
    };

    sqlx::query(
        "INSERT INTO paper_search_history (id, draft_json, result_json, created_at)
         VALUES (?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(trimmed_draft)
    .bind(&result_json)
    .bind(&created_at)
    .execute(&state.db)
    .await
    .map_err(|e| format!("保存论文检索历史失败：{e}"))?;

    Ok(PaperSearchHistoryEntry {
        id,
        draft_json: trimmed_draft.to_string(),
        result_json,
        created_at,
    })
}

#[tauri::command]
pub async fn paper_search_get_history(
    state: State<'_, AppState>,
    limit: Option<i32>,
) -> Result<Vec<PaperSearchHistoryEntry>, String> {
    let limit = limit.unwrap_or(20).clamp(1, 100);

    let rows = sqlx::query(
        "SELECT id, draft_json, result_json, created_at
         FROM paper_search_history
         ORDER BY created_at DESC
         LIMIT ?",
    )
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .map_err(|e| format!("读取论文检索历史失败：{e}"))?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        items.push(PaperSearchHistoryEntry {
            id: row.get("id"),
            draft_json: row.get("draft_json"),
            result_json: row.get("result_json"),
            created_at: row.get("created_at"),
        });
    }

    Ok(items)
}

#[tauri::command]
pub async fn paper_search_delete_history(
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    let result = sqlx::query("DELETE FROM paper_search_history WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| format!("删除论文检索历史失败：{e}"))?;

    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::{
        collect_survey_search_terms, normalize_cutoff_date, snippet_candidate_pool_size,
        SemanticScholarPaper,
    };
    use chrono::NaiveDate;

    #[test]
    fn cutoff_date_is_an_inclusive_upper_bound() {
        let today = NaiveDate::from_ymd_opt(2026, 7, 22).unwrap();

        assert_eq!(
            normalize_cutoff_date(Some("2020-05-18"), today).unwrap(),
            "2020-05-18"
        );
        assert_eq!(normalize_cutoff_date(None, today).unwrap(), "2026-07-22");
        assert!(normalize_cutoff_date(Some("2026-07-23"), today).is_err());
        assert!(normalize_cutoff_date(Some("2026-02-30"), today).is_err());
    }

    #[test]
    fn collect_survey_search_terms_deduplicates_and_limits() {
        let terms = collect_survey_search_terms(
            "  diffusion   model  ",
            &[
                "diffusion model".to_string(),
                "text to image".to_string(),
                "  ".to_string(),
                "TEXT TO IMAGE".to_string(),
                "controlnet".to_string(),
            ],
            3,
        );

        assert_eq!(
            terms,
            vec!["diffusion model", "text to image", "controlnet"]
        );
    }

    #[test]
    fn snippet_candidate_pool_stays_in_the_validated_relevance_window() {
        assert_eq!(snippet_candidate_pool_size(6), 10);
        assert_eq!(snippet_candidate_pool_size(20), 20);
        assert_eq!(snippet_candidate_pool_size(50), 20);
    }

    #[test]
    fn semantic_scholar_abstract_field_is_preserved() {
        let paper: SemanticScholarPaper = serde_json::from_str(
            r#"{"paperId":"paper-1","title":"A paper","abstract":"Published abstract"}"#,
        )
        .expect("Semantic Scholar paper should deserialize");

        assert_eq!(paper.abstract_text.as_deref(), Some("Published abstract"));
    }
}
