use crate::ccf::match_venue;
use crate::commands::paper_search_plan::plan_paper_search_queries;
use crate::llm::{resolve_temperature, LlmClient, LlmMessage};
use crate::semantic_scholar::throttle_semantic_scholar_request;
use crate::state::AppState;
use anyhow::Context;
use chrono::{Duration as ChronoDuration, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tauri::State;

const SEMANTIC_SCHOLAR_API_URL: &str = "https://api.semanticscholar.org/graph/v1/paper/search";
const SEMANTIC_SCHOLAR_USER_AGENT: &str = "xiaoyan-desktop/0.5.2";

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", default)]
pub struct PaperSearchRequest {
    topic: String,
    all_terms: Vec<String>,
    title_terms: Vec<String>,
    abstract_terms: Vec<String>,
    authors: Vec<String>,
    categories: Vec<String>,
    comments_terms: Vec<String>,
    journal_ref_terms: Vec<String>,
    exclude_terms: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RankingMode {
    Relevance,
    Quality,
}

impl RankingMode {
    fn from_value(value: Option<&str>) -> Self {
        match value.unwrap_or("relevance").trim() {
            "quality" => Self::Quality,
            _ => Self::Relevance,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Relevance => "relevance",
            Self::Quality => "quality",
        }
    }
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
    title: String,
    #[serde(default)]
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
    pub(crate) title: String,
    pub(crate) authors: String,
    pub(crate) venue: String,
    pub(crate) year: Option<i32>,
    pub(crate) published_at: String,
    pub(crate) abstract_text: String,
    pub(crate) detail_url: String,
    pub(crate) pdf_url: String,
    pub(crate) citation_count: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct PaperRecommendation {
    arxiv_id: String,
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
    cutoff_date: String,
    limit: usize,
    ranking_mode: String,
    candidate_count: usize,
    llm_used: bool,
    ranking_note: String,
    overall_summary: String,
    disclaimer: String,
    papers: Vec<PaperRecommendation>,
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
) -> Result<serde_json::Value, String> {
    let request = request.normalize();
    if !request.has_search_terms() {
        return Err("请至少填写一个检索条件".into());
    }

    let cutoff_date = normalize_cutoff_date(cutoff_date.as_deref(), Local::now().date_naive())?;
    let result_limit = limit.unwrap_or(6).clamp(1, 50) as usize;
    let mode = RankingMode::from_value(ranking_mode.as_deref());
    let settings = state.settings.read().await.clone();

    let query = describe_request(&request);
    let keywords = collect_keywords(&request);
    let structured_terms = collect_structured_search_terms(&request);
    let search_plan = plan_paper_search_queries(&settings, &request.topic, &structured_terms).await;
    if search_plan.queries.is_empty() {
        return Err("无法从当前输入生成有效检索式，请补充更具体的自然语言需求或关键词".into());
    }
    let search_expression = search_plan.queries.join("\n");

    let publication_date_range = format!(":{cutoff_date}");
    let mut candidates = Vec::new();
    let mut seen_candidates = HashSet::new();
    let mut successful_queries = 0usize;
    let mut last_search_error = None;
    for search_query in &search_plan.queries {
        match fetch_semantic_scholar_candidates_with_date_range(
            &settings,
            search_query,
            &request.exclude_terms,
            Some(&publication_date_range),
            candidate_pool_size(result_limit),
        )
        .await
        {
            Ok(query_candidates) => {
                successful_queries += 1;
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
            }
            Err(error) => last_search_error = Some(error),
        }
    }
    if successful_queries == 0 {
        return Err(last_search_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "联网学术检索失败".to_string()));
    }

    if candidates.is_empty() {
        let empty = PaperSearchResponse {
            query,
            keywords,
            applied_filters: request.clone(),
            search_expression,
            search_queries: search_plan.queries,
            query_plan_llm_used: search_plan.llm_used,
            query_plan_note: search_plan.note,
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
        };
        return Ok(json!(empty));
    }

    // 对全部候选做启发式排序，既用于无 LLM 时的降级，也用于 LLM 返回不足时的兜底回填。
    let heuristic = heuristic_rank_papers(
        &candidates,
        &request,
        &search_plan.queries,
        mode,
        candidates.len().max(result_limit),
    );
    let (llm_used, ranking_note, overall_summary, mut papers) =
        match rerank_with_xiaoyan(&settings, &query, &request, mode, result_limit, &candidates)
            .await
        {
            Ok(Some((note, summary, ranked))) => (true, note, summary, ranked),
            Ok(None) => (
                false,
                format!(
                    "未检测到可用的论文检索模型或小妍主模型，{}",
                    fallback_ranking_note(mode)
                ),
                fallback_overall_summary(mode, candidates.len(), result_limit),
                heuristic.iter().take(result_limit).cloned().collect(),
            ),
            Err(error) => {
                eprintln!("小妍论文重排失败，使用启发式排序：{error}");
                (
                    false,
                    format!("小妍模型重排未完成，{}", fallback_ranking_note(mode)),
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

    let response = PaperSearchResponse {
        query,
        keywords,
        applied_filters: request,
        search_expression,
        search_queries: search_plan.queries,
        query_plan_llm_used: search_plan.llm_used,
        query_plan_note: search_plan.note,
        cutoff_date,
        limit: result_limit,
        ranking_mode: mode.as_str().to_string(),
        candidate_count: candidates.len(),
        llm_used,
        ranking_note,
        overall_summary,
        disclaimer: "检索结果来自联网学术数据源，覆盖范围与实时性受第三方接口影响。".into(),
        papers,
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
    let client = reqwest::Client::new();
    let mut builder = client
        .get(SEMANTIC_SCHOLAR_API_URL)
        .header("User-Agent", SEMANTIC_SCHOLAR_USER_AGENT)
        .query(&[
            ("query", query.to_string()),
            ("limit", max_results.to_string()),
            (
                "fields",
                "paperId,title,abstract,year,venue,url,citationCount,publicationDate,authors,openAccessPdf"
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

    const MAX_RETRIES: u32 = 3;
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
            let wait_secs = 2u64.pow(attempt);
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

    let payload: SemanticScholarSearchResponse =
        response.json().await.context("解析联网检索结果失败")?;

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
            title: item.title,
            authors,
            venue,
            year: item.year,
            published_at,
            abstract_text: item.abstract_text.unwrap_or_default(),
            detail_url,
            pdf_url,
            citation_count: item.citation_count.unwrap_or(0),
        });
    }

    Ok(result)
}

async fn rerank_with_xiaoyan(
    settings: &HashMap<String, String>,
    query: &str,
    request: &PaperSearchRequest,
    mode: RankingMode,
    limit: usize,
    candidates: &[PaperCandidate],
) -> anyhow::Result<Option<(String, String, Vec<PaperRecommendation>)>> {
    let (client, model) = match LlmClient::literature_client_with_main_fallback(settings) {
        Ok(resolved) => resolved,
        Err(_) => return Ok(None),
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
            })
        })
        .collect::<Vec<_>>();

    let ranking_focus = match mode {
        RankingMode::Relevance => "与用户问题的贴合度、研究问题匹配度、可读性",
        RankingMode::Quality => "方法与实验信号、影响力、研究完整性",
    };

    let prompt = format!(
        "你是小妍的论文检索子助手。请基于联网候选论文，输出最终推荐结果。\n\n用户问题：{query}\n检索约束：{filters}\n排序偏好：{ranking_focus}\n返回数量：{limit}\n\n候选论文（JSON）：\n{payload}\n\n只返回 JSON，不要额外解释，格式必须是：\n{{\n  \"overall_summary\": \"...\",\n  \"ranking_note\": \"...\",\n  \"papers\": [\n    {{\n      \"id\": \"候选 id\",\n      \"score\": 0-100 整数,\n      \"reason\": \"推荐理由\",\n      \"title_zh\": \"可选\",\n      \"tldr_zh\": \"可选\",\n      \"tags\": [\"标签1\", \"标签2\"]\n    }}\n  ]\n}}",
        filters = describe_request(request),
        payload = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "[]".to_string()),
    );

    let messages = vec![
        LlmMessage::system("你是科研论文检索助手，输出必须严格遵守 JSON 格式。"),
        LlmMessage::user(prompt),
    ];

    let raw = client
        .chat(&messages, model.as_deref(), temperature)
        .await?;
    let clean = crate::commands::papers::extract_json_pub(&raw);
    let parsed: LlmRankingResponse = match serde_json::from_str(&clean) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };

    let mut by_id = HashMap::new();
    for candidate in candidates {
        by_id.insert(candidate.id.clone(), candidate.clone());
    }

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

        selected.push(PaperRecommendation {
            arxiv_id: candidate.id.clone(),
            title: candidate.title.clone(),
            title_zh: item.title_zh,
            authors: candidate.authors.clone(),
            category: candidate.venue.clone(),
            published_at: candidate.published_at.clone(),
            updated_at: candidate.published_at.clone(),
            abstract_text: candidate.abstract_text.clone(),
            abs_url: candidate.detail_url.clone(),
            pdf_url: candidate.pdf_url.clone(),
            score: item.score.unwrap_or(75).clamp(0, 100),
            reason: item
                .reason
                .unwrap_or_else(|| "与当前研究主题相关".to_string()),
            tldr_zh: item.tldr_zh,
            tags: item.tags.unwrap_or_default(),
        });
    }

    if selected.is_empty() {
        return Ok(None);
    }

    Ok(Some((
        parsed
            .ranking_note
            .unwrap_or_else(|| fallback_ranking_note(mode).to_string()),
        parsed
            .overall_summary
            .unwrap_or_else(|| fallback_overall_summary(mode, candidates.len(), limit)),
        selected,
    )))
}

fn heuristic_rank_papers(
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
        .map(|token| token.trim().to_lowercase())
        .filter(|token| token.chars().count() >= 3)
        .collect::<HashSet<_>>();
    let mut scored = candidates
        .iter()
        .map(|paper| {
            let mut score = 55_i32;
            let text = format!(
                "{}\n{}\n{}\n{}",
                paper.title, paper.abstract_text, paper.authors, paper.venue
            )
            .to_lowercase();

            let add_match_score = |terms: &[String], weight: i32| -> i32 {
                terms
                    .iter()
                    .filter(|term| {
                        let t = term.trim().to_lowercase();
                        !t.is_empty() && text.contains(&t)
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
            score += (query_tokens
                .iter()
                .filter(|token| text.contains(token.as_str()))
                .count() as i32
                * 2)
            .min(18);
            score += (paper.citation_count / 200).clamp(0, 12);

            if mode == RankingMode::Quality {
                score += (paper.citation_count / 120).clamp(0, 16);
            }

            (
                score.clamp(0, 100),
                PaperRecommendation {
                    arxiv_id: paper.id.clone(),
                    title: paper.title.clone(),
                    title_zh: None,
                    authors: paper.authors.clone(),
                    category: paper.venue.clone(),
                    published_at: paper.published_at.clone(),
                    updated_at: paper.published_at.clone(),
                    abstract_text: paper.abstract_text.clone(),
                    abs_url: paper.detail_url.clone(),
                    pdf_url: paper.pdf_url.clone(),
                    score: 0,
                    reason: match mode {
                        RankingMode::Relevance => "与当前检索条件的关键词匹配度较高。".to_string(),
                        RankingMode::Quality => {
                            "在候选论文中具备更强的影响力与研究信号。".to_string()
                        }
                    },
                    tldr_zh: None,
                    tags: Vec::new(),
                },
            )
        })
        .collect::<Vec<_>>();

    scored.sort_by(|a, b| b.0.cmp(&a.0));

    scored
        .into_iter()
        .take(limit)
        .map(|(score, mut paper)| {
            paper.score = score;
            paper
        })
        .collect()
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

fn fallback_ranking_note(mode: RankingMode) -> &'static str {
    match mode {
        RankingMode::Relevance => "已使用启发式相关性排序。",
        RankingMode::Quality => "已使用启发式质量信号排序。",
    }
}

fn fallback_overall_summary(mode: RankingMode, candidates: usize, limit: usize) -> String {
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
    use super::{collect_survey_search_terms, normalize_cutoff_date};
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
}
