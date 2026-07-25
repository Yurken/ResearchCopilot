use crate::assistant_prompts::specialist_system;
use crate::llm::{resolve_model, resolve_temperature_chain, LlmClient, LlmMessage};
use crate::semantic_scholar::throttle_semantic_scholar_request;
use crate::state::AppState;
use anyhow::{anyhow, Context};
use chrono::{DateTime, Duration, Utc};
use roxmltree::Document;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration as StdDuration, Instant};
use tauri::State;

const ARXIV_API_URL: &str = "https://export.arxiv.org/api/query";
const ARXIV_USER_AGENT: &str = "xiaoyan-desktop/0.5.2 (+https://github.com/Yurken/xiaoyan)";
const ARXIV_MIN_INTERVAL_SECS: f64 = 3.5;
const ARXIV_MAX_RETRIES: u32 = 3;

static LAST_ARXIV_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct ArxivPaper {
    arxiv_id: String,
    title: String,
    authors: String,
    category: String,
    comment: String,
    journal_ref: String,
    published_at: String,
    updated_at: String,
    abstract_text: String,
    abs_url: String,
    pdf_url: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", default)]
pub struct ArxivSearchRequest {
    pub topic: String,
    pub all_terms: Vec<String>,
    pub title_terms: Vec<String>,
    pub abstract_terms: Vec<String>,
    pub authors: Vec<String>,
    pub categories: Vec<String>,
    pub comments_terms: Vec<String>,
    pub journal_ref_terms: Vec<String>,
    pub exclude_terms: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct ArxivRecommendation {
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

#[derive(Debug, Clone)]
pub struct RecentPaperHint {
    pub title: String,
    pub authors: String,
    pub year: Option<i64>,
    pub venue: String,
    pub reason: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct ArxivSearchResponse {
    query: String,
    keywords: Vec<String>,
    applied_filters: ArxivSearchRequest,
    search_expression: String,
    days: i64,
    limit: usize,
    ranking_mode: String,
    candidate_count: usize,
    llm_used: bool,
    ranking_note: String,
    overall_summary: String,
    disclaimer: String,
    papers: Vec<ArxivRecommendation>,
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
    arxiv_id: String,
    score: Option<i32>,
    reason: Option<String>,
    title_zh: Option<String>,
    tldr_zh: Option<String>,
    tags: Option<Vec<String>>,
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

impl ArxivSearchRequest {
    fn normalize(mut self) -> Self {
        self.topic = clean_whitespace(&self.topic);
        self.all_terms = normalize_term_list(self.all_terms);
        self.title_terms = normalize_term_list(self.title_terms);
        self.abstract_terms = normalize_term_list(self.abstract_terms);
        self.authors = normalize_term_list(self.authors);
        self.categories = normalize_category_list(self.categories);
        self.comments_terms = normalize_term_list(self.comments_terms);
        self.journal_ref_terms = normalize_term_list(self.journal_ref_terms);
        self.exclude_terms = normalize_term_list(self.exclude_terms);
        self
    }

    fn has_search_terms(&self) -> bool {
        !self.all_terms.is_empty()
            || !self.title_terms.is_empty()
            || !self.abstract_terms.is_empty()
            || !self.authors.is_empty()
            || !self.categories.is_empty()
            || !self.comments_terms.is_empty()
            || !self.journal_ref_terms.is_empty()
    }
}

#[tauri::command]
pub async fn run_arxiv_search(
    settings: &HashMap<String, String>,
    request: ArxivSearchRequest,
    days: Option<i64>,
    limit: Option<i32>,
    ranking_mode: Option<String>,
) -> Result<serde_json::Value, String> {
    let request = request.normalize();
    if !request.has_search_terms() {
        return Err("请至少填写一个检索条件".into());
    }

    let day_window = days.unwrap_or(14).clamp(1, 365);
    let result_limit = limit.unwrap_or(5).clamp(1, 20) as usize;
    let mode = RankingMode::from_value(ranking_mode.as_deref());
    let query = describe_request(&request);
    let keywords = collect_keywords(&request);
    let search_expression = build_search_query(&request, day_window);

    let candidates = fetch_arxiv_candidates(
        &search_expression,
        day_window,
        candidate_pool_size(result_limit),
    )
    .await
    .map_err(|error| error.to_string())?;

    if candidates.is_empty() {
        let empty = ArxivSearchResponse {
            query,
            keywords,
            applied_filters: request.clone(),
            search_expression,
            days: day_window,
            limit: result_limit,
            ranking_mode: mode.as_str().to_string(),
            candidate_count: 0,
            llm_used: false,
            ranking_note: "当前时间窗口内没有找到匹配论文。".into(),
            overall_summary: "可以扩大最近天数，或放宽标题词、摘要词和分类条件后重试。".into(),
            disclaimer: disclaimer_for_mode(mode).into(),
            papers: Vec::new(),
        };
        return Ok(json!(empty));
    }

    let heuristic = heuristic_rank_papers(&candidates, &request, mode, result_limit);
    let (llm_used, ranking_note, overall_summary, papers) =
        match rerank_with_llm(&settings, &query, &request, mode, result_limit, &candidates).await {
            Ok(Some((note, summary, ranked))) => (true, note, summary, ranked),
            Ok(None) | Err(_) => (
                false,
                fallback_ranking_note(mode).to_string(),
                fallback_overall_summary(mode, candidates.len(), result_limit),
                heuristic,
            ),
        };

    let response = ArxivSearchResponse {
        query,
        keywords,
        applied_filters: request,
        search_expression,
        days: day_window,
        limit: result_limit,
        ranking_mode: mode.as_str().to_string(),
        candidate_count: candidates.len(),
        llm_used,
        ranking_note,
        overall_summary,
        disclaimer: disclaimer_for_mode(mode).into(),
        papers,
    };

    Ok(json!(response))
}

#[tauri::command]
pub async fn arxiv_search(
    state: State<'_, AppState>,
    request: ArxivSearchRequest,
    days: Option<i64>,
    limit: Option<i32>,
    ranking_mode: Option<String>,
) -> Result<serde_json::Value, String> {
    let settings = state.settings.read().await.clone();
    run_arxiv_search(&settings, request, days, limit, ranking_mode).await
}

fn contains_chinese(text: &str) -> bool {
    text.chars().any(|c| {
        let u = c as u32;
        (0x4E00..=0x9FFF).contains(&u)
            || (0x3400..=0x4DBF).contains(&u)
            || (0x2E80..=0x2EFF).contains(&u)
    })
}

async fn translate_search_terms(
    client: &LlmClient,
    topic: &str,
    keywords: &[String],
) -> Result<(String, Vec<String>), String> {
    let keyword_text = if keywords.is_empty() {
        "未填写。请根据研究主题补充 3-6 个英文检索关键词或短语。".to_string()
    } else {
        keywords.join("、")
    };
    let prompt = format!(
        "将以下学术搜索条件转换成英文，用于在国际学术数据库检索论文。\n\
         要求：\n\
         - topic 用一个简洁英文研究主题表达。\n\
         - keywords 输出 3-6 个英文关键词或短语；如果用户没有填写关键词，请根据主题推断。\n\
         - 不要输出中文。\n\
         仅返回合法 JSON：{{\"topic\":\"...\",\"keywords\":[\"...\",\"...\"]}}\n\n主题：{}\n关键词：{}",
        topic,
        keyword_text
    );
    let msgs = vec![
        LlmMessage::system("你是学术翻译助手，只输出 JSON。"),
        LlmMessage::user(prompt),
    ];
    let resp = client
        .chat(&msgs, None, 0.1)
        .await
        .map_err(|e| e.to_string())?;
    let clean = crate::commands::papers::extract_json_pub(&resp);
    let parsed: serde_json::Value =
        serde_json::from_str(&clean).map_err(|e| format!("解析翻译结果失败：{e}"))?;
    let en_topic = parsed
        .get("topic")
        .and_then(|v| v.as_str())
        .unwrap_or(topic)
        .to_string();
    let en_keywords = parsed
        .get("keywords")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_else(|| keywords.to_vec());
    Ok((en_topic, en_keywords))
}

pub fn build_recent_hint_request(
    search_topic: &str,
    search_keywords: &[String],
) -> ArxivSearchRequest {
    let topic = clean_whitespace(search_topic);
    let mut all_terms = Vec::new();
    if !topic.is_empty() {
        all_terms.push(topic.clone());
    }
    all_terms.extend(normalize_term_list(search_keywords.to_vec()));
    all_terms = normalize_term_list(all_terms);

    ArxivSearchRequest {
        topic,
        all_terms: all_terms.into_iter().take(8).collect(),
        title_terms: Vec::new(),
        abstract_terms: Vec::new(),
        authors: Vec::new(),
        categories: Vec::new(),
        comments_terms: Vec::new(),
        journal_ref_terms: Vec::new(),
        exclude_terms: Vec::new(),
    }
    .normalize()
}

pub async fn search_recent_paper_hints(
    settings: &HashMap<String, String>,
    topic: &str,
    keywords: &[String],
    days: i64,
    limit: usize,
) -> anyhow::Result<Vec<RecentPaperHint>> {
    let client = LlmClient::scout_client_from_settings(settings).ok();

    let (search_topic, search_keywords) =
        if contains_chinese(topic) || keywords.iter().any(|k| contains_chinese(k)) {
            if let Some(ref c) = client {
                translate_search_terms(c, topic, keywords)
                    .await
                    .unwrap_or_else(|e| {
                        eprintln!("翻译搜索词失败，使用原文：{e}");
                        (topic.to_string(), keywords.to_vec())
                    })
            } else {
                (topic.to_string(), keywords.to_vec())
            }
        } else {
            (topic.to_string(), keywords.to_vec())
        };

    let request = build_recent_hint_request(&search_topic, &search_keywords);

    if !request.has_search_terms() {
        return Ok(Vec::new());
    }

    let day_window = days.clamp(1, 3650);
    let result_limit = limit.clamp(1, 20);
    let mode = RankingMode::Relevance;
    let query = describe_request(&request);
    let mut search_expression = build_search_query(&request, day_window);
    let mut candidates = fetch_arxiv_candidates(
        &search_expression,
        day_window,
        candidate_pool_size(result_limit),
    )
    .await?;

    if candidates.is_empty() && day_window < 1095 {
        let expanded_day_window = 1095;
        search_expression = build_search_query(&request, expanded_day_window);
        candidates = fetch_arxiv_candidates(
            &search_expression,
            expanded_day_window,
            candidate_pool_size(result_limit),
        )
        .await?;
    }

    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let ranked =
        match rerank_with_llm(settings, &query, &request, mode, result_limit, &candidates).await {
            Ok(Some((_, _, papers))) => papers,
            _ => heuristic_rank_papers(&candidates, &request, mode, result_limit),
        };

    let mut hints = Vec::new();
    for paper in ranked.into_iter().take(result_limit) {
        let year = paper
            .published_at
            .get(0..4)
            .and_then(|value| value.parse::<i64>().ok());
        let venue = if paper.category.trim().is_empty() {
            "arXiv preprint".to_string()
        } else {
            format!("arXiv ({})", paper.category)
        };
        hints.push(RecentPaperHint {
            title: paper.title,
            authors: paper.authors,
            year,
            venue,
            reason: paper.reason,
            url: if paper.abs_url.trim().is_empty() {
                format!("https://arxiv.org/abs/{}", paper.arxiv_id)
            } else {
                paper.abs_url
            },
        });
    }

    Ok(hints)
}

const SEMANTIC_SCHOLAR_API_URL: &str = "https://api.semanticscholar.org/graph/v1/paper/search";
const SEMANTIC_SCHOLAR_USER_AGENT: &str = "xiaoyan-desktop/0.3.3";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticScholarSearchResponse {
    #[serde(default)]
    data: Vec<SemanticScholarPaper>,
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
    authors: Vec<SemanticScholarAuthor>,
    #[serde(default)]
    _publication_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticScholarAuthor {
    #[serde(default)]
    name: Option<String>,
}

pub async fn search_semantic_scholar_hints(
    settings: &HashMap<String, String>,
    topic: &str,
    keywords: &[String],
    _days: i64,
    limit: usize,
) -> anyhow::Result<Vec<RecentPaperHint>> {
    let client = reqwest::Client::new();
    let llm_client = LlmClient::scout_client_from_settings(settings).ok();
    let (search_topic, search_keywords) =
        if contains_chinese(topic) || keywords.iter().any(|k| contains_chinese(k)) {
            if let Some(ref c) = llm_client {
                translate_search_terms(c, topic, keywords)
                    .await
                    .unwrap_or_else(|e| {
                        eprintln!("翻译 Semantic Scholar 搜索词失败，使用原文：{e}");
                        (topic.to_string(), keywords.to_vec())
                    })
            } else {
                (topic.to_string(), keywords.to_vec())
            }
        } else {
            (topic.to_string(), keywords.to_vec())
        };
    let query = if search_topic.trim().is_empty() {
        search_keywords.join(" ")
    } else {
        format!("{} {}", search_topic, search_keywords.join(" "))
    };
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let result_limit = limit.clamp(1, 20);
    let mut builder = client
        .get(SEMANTIC_SCHOLAR_API_URL)
        .header("User-Agent", SEMANTIC_SCHOLAR_USER_AGENT)
        .query(&[
            ("query", query.trim().to_string()),
            ("limit", result_limit.to_string()),
            (
                "fields",
                "paperId,title,abstract,year,venue,url,publicationDate,authors".to_string(),
            ),
        ]);

    if let Some(api_key) = settings
        .get("semantic_scholar_api_key")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        builder = builder.header("x-api-key", api_key);
    }

    throttle_semantic_scholar_request().await;
    let resp = builder.send().await.context("Semantic Scholar 请求失败")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!(
            "Semantic Scholar 返回错误 {status}: {body}"
        ));
    }

    let payload: SemanticScholarSearchResponse = resp
        .json()
        .await
        .context("解析 Semantic Scholar 结果失败")?;

    let mut hints = Vec::new();
    for item in payload.data.into_iter().take(result_limit) {
        let authors = item
            .authors
            .into_iter()
            .filter_map(|author| author.name)
            .filter(|name| !name.trim().is_empty())
            .collect::<Vec<_>>()
            .join(", ");
        let year = item.year.map(|y| y as i64);
        let venue = item.venue.unwrap_or_else(|| "Semantic Scholar".to_string());
        let url = item
            .url
            .unwrap_or_else(|| format!("https://www.semanticscholar.org/paper/{}", item.paper_id));
        let reason = item
            .abstract_text
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "来自 Semantic Scholar 检索".to_string());
        hints.push(RecentPaperHint {
            title: item.title,
            authors,
            year,
            venue,
            reason,
            url,
        });
    }

    Ok(hints)
}

async fn fetch_arxiv_candidates(
    search_query: &str,
    days: i64,
    max_results: usize,
) -> anyhow::Result<Vec<ArxivPaper>> {
    rate_limit_arxiv().await;

    let client = reqwest::Client::new();
    let params = [
        ("search_query", search_query.to_string()),
        ("start", "0".to_string()),
        ("max_results", max_results.to_string()),
        ("sortBy", "submittedDate".to_string()),
        ("sortOrder", "descending".to_string()),
    ];

    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 0..=ARXIV_MAX_RETRIES {
        if attempt > 0 {
            let backoff = StdDuration::from_secs(2u64.saturating_pow(attempt));
            tokio::time::sleep(backoff).await;
        }

        let response = match client
            .get(ARXIV_API_URL)
            .header("User-Agent", ARXIV_USER_AGENT)
            .query(&params)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                last_err = Some(anyhow!("请求 arXiv 失败: {e}"));
                continue;
            }
        };

        let status = response.status();
        if status.is_success() {
            let xml = match response.text().await {
                Ok(x) => x,
                Err(e) => {
                    last_err = Some(anyhow!("读取 arXiv 响应失败: {e}"));
                    continue;
                }
            };
            let papers = parse_arxiv_feed(&xml)?;
            return Ok(filter_recent_papers(papers, days));
        }

        if status.as_u16() == 429 || status.as_u16() == 503 {
            last_err = Some(anyhow!("arXiv 返回 {status}（服务繁忙，将重试）"));
            continue;
        }

        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!("arXiv 返回错误 {status}: {body}"));
    }

    Err(last_err.unwrap_or_else(|| anyhow!("arXiv 请求失败，已重试 {ARXIV_MAX_RETRIES} 次")))
}

async fn rate_limit_arxiv() {
    let wait = {
        let last = LAST_ARXIV_REQUEST.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(prev) = *last {
            let elapsed = prev.elapsed().as_secs_f64();
            if elapsed < ARXIV_MIN_INTERVAL_SECS {
                Some(ARXIV_MIN_INTERVAL_SECS - elapsed)
            } else {
                None
            }
        } else {
            None
        }
    };
    if let Some(wait) = wait {
        tokio::time::sleep(StdDuration::from_secs_f64(wait)).await;
    }
    LAST_ARXIV_REQUEST
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .replace(Instant::now());
}

fn parse_arxiv_feed(xml: &str) -> anyhow::Result<Vec<ArxivPaper>> {
    let document = Document::parse(xml).context("解析 arXiv Atom XML 失败")?;
    let mut seen_ids = HashSet::new();
    let mut papers = Vec::new();

    for entry in document
        .descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "entry")
    {
        let raw_id = child_text(entry, "id");
        if raw_id.is_empty() {
            continue;
        }

        let arxiv_id = normalize_arxiv_id(&raw_id);
        if arxiv_id.is_empty() || !seen_ids.insert(arxiv_id.clone()) {
            continue;
        }

        let title = clean_whitespace(&child_text(entry, "title"));
        let abstract_text = clean_whitespace(&child_text(entry, "summary"));
        let comment = clean_whitespace(&child_text(entry, "comment"));
        let journal_ref = clean_whitespace(&child_text(entry, "journal_ref"));
        let published_at = child_text(entry, "published");
        let updated_at = child_text(entry, "updated");
        let authors = entry
            .children()
            .filter(|node| node.is_element() && node.tag_name().name() == "author")
            .map(|author| child_text(author, "name"))
            .filter(|name| !name.is_empty())
            .collect::<Vec<_>>()
            .join(", ");
        let category = entry
            .children()
            .find(|node| node.is_element() && node.tag_name().name() == "primary_category")
            .and_then(|node| node.attribute("term"))
            .unwrap_or("")
            .to_string();

        let mut abs_url = raw_id.clone();
        let mut pdf_url = String::new();
        for link in entry
            .children()
            .filter(|node| node.is_element() && node.tag_name().name() == "link")
        {
            let href = link.attribute("href").unwrap_or("").trim();
            let rel = link.attribute("rel").unwrap_or("").trim();
            let link_type = link.attribute("type").unwrap_or("").trim();
            let title_attr = link.attribute("title").unwrap_or("").trim();

            if title_attr == "pdf" || link_type == "application/pdf" {
                pdf_url = href.to_string();
            } else if rel == "alternate" {
                abs_url = href.to_string();
            }
        }

        if abs_url.is_empty() {
            abs_url = format!("https://arxiv.org/abs/{arxiv_id}");
        }
        if pdf_url.is_empty() {
            pdf_url = format!("https://arxiv.org/pdf/{arxiv_id}.pdf");
        }

        papers.push(ArxivPaper {
            arxiv_id,
            title,
            authors,
            category,
            comment,
            journal_ref,
            published_at,
            updated_at,
            abstract_text,
            abs_url,
            pdf_url,
        });
    }

    Ok(papers)
}

fn filter_recent_papers(papers: Vec<ArxivPaper>, days: i64) -> Vec<ArxivPaper> {
    let cutoff = Utc::now() - Duration::days(days.max(1));

    papers
        .into_iter()
        .filter(|paper| {
            parse_arxiv_datetime(&paper.published_at)
                .map(|published| published >= cutoff)
                .unwrap_or(true)
        })
        .collect()
}

async fn rerank_with_llm(
    settings: &HashMap<String, String>,
    query: &str,
    request: &ArxivSearchRequest,
    mode: RankingMode,
    limit: usize,
    candidates: &[ArxivPaper],
) -> anyhow::Result<Option<(String, String, Vec<ArxivRecommendation>)>> {
    let client = match LlmClient::scout_client_from_settings(settings) {
        Ok(client) => client,
        Err(_) => return Ok(None),
    };

    let model = resolve_model(
        settings,
        &[
            "multi_agent_literature_scout_model",
            "survey_planner_model",
            "copilot_simple_model",
        ],
    );
    let temperature = resolve_temperature_chain(
        settings,
        &[
            "multi_agent_literature_scout_temperature",
            "survey_planner_temperature",
        ],
        0.2,
    );
    let candidate_json = candidates
        .iter()
        .map(|paper| {
            json!({
                "arxiv_id": paper.arxiv_id,
                "title": paper.title,
                "authors": paper.authors,
                "category": paper.category,
                "comment": truncate_chars(&paper.comment, 240),
                "journal_ref": truncate_chars(&paper.journal_ref, 240),
                "published_at": paper.published_at,
                "abstract_text": truncate_chars(&paper.abstract_text, 900),
            })
        })
        .collect::<Vec<_>>();

    let filter_summary = structured_filter_summary(request);

    let prompt = format!(
        "请从给定的 arXiv 候选论文中，筛选出最适合用户需求的前 {limit} 篇论文。\n\
用户查询：{query}\n\
结构化检索条件：\n{filter_summary}\n\
筛选目标：{goal}\n\n\
限制条件：\n\
1. 只能基于标题、作者、类别、备注、期刊/会议信息、发布时间和摘要判断，不能编造不存在的信息。\n\
2. 只返回候选列表里已有的 arxiv_id。\n\
3. score 为 0-100 的整数。\n\
4. title_zh、tldr_zh、reason 必须使用简体中文。\n\
5. quality 模式下，这只是基于摘要的质量预测，不得写成“已被顶会接收”或“已有高引用”，除非候选材料明确说明。\n\
6. 若多篇论文相近，优先选择更贴合查询、信息密度更高、发布时间更新的论文。\n\n\
请只返回 JSON，结构必须为：\n\
{{\n\
  \"overall_summary\": \"一句到两句的中文总结\",\n\
  \"ranking_note\": \"说明当前排序依据\",\n\
  \"papers\": [\n\
    {{\n\
      \"arxiv_id\": \"候选中的 arxiv_id\",\n\
      \"score\": 88,\n\
      \"reason\": \"为什么入选\",\n\
      \"title_zh\": \"中文标题，可意译\",\n\
      \"tldr_zh\": \"一句话摘要\",\n\
      \"tags\": [\"标签1\", \"标签2\"]\n\
    }}\n\
  ]\n\
}}\n\n\
候选论文：\n{candidate_json}",
        filter_summary = filter_summary,
        goal = mode_prompt(mode),
        candidate_json = serde_json::to_string_pretty(&candidate_json)?,
    );

    let messages = vec![
        LlmMessage::system(specialist_system(
            "科研论文筛选助手",
            "从候选 arXiv 论文中做严格筛选和排序。",
            Some("结果必须精炼、可信、可溯源。"),
        )),
        LlmMessage::user(prompt),
    ];

    let response = client
        .chat(&messages, model.as_deref(), temperature)
        .await?;
    let parsed: LlmRankingResponse =
        serde_json::from_str(&extract_json(&response)).context("解析论文筛选 JSON 失败")?;

    let mut candidate_map = candidates
        .iter()
        .cloned()
        .map(|paper| (paper.arxiv_id.clone(), paper))
        .collect::<HashMap<_, _>>();
    let mut used = HashSet::new();
    let mut ranked = Vec::new();

    for paper in parsed.papers {
        if ranked.len() >= limit {
            break;
        }
        if !used.insert(paper.arxiv_id.clone()) {
            continue;
        }
        let Some(candidate) = candidate_map.remove(&paper.arxiv_id) else {
            continue;
        };
        ranked.push(ArxivRecommendation {
            arxiv_id: candidate.arxiv_id,
            title: candidate.title,
            title_zh: paper.title_zh.filter(|value| !value.trim().is_empty()),
            authors: candidate.authors,
            category: candidate.category,
            published_at: candidate.published_at,
            updated_at: candidate.updated_at,
            abstract_text: candidate.abstract_text,
            abs_url: candidate.abs_url,
            pdf_url: candidate.pdf_url,
            score: paper.score.unwrap_or(80).clamp(0, 100),
            reason: paper.reason.unwrap_or_else(|| "模型未返回入选理由".into()),
            tldr_zh: paper.tldr_zh.filter(|value| !value.trim().is_empty()),
            tags: paper.tags.unwrap_or_default(),
        });
    }

    if ranked.is_empty() {
        return Ok(None);
    }

    let fallback = heuristic_rank_papers(candidates, request, mode, limit);
    for paper in fallback {
        if ranked.len() >= limit {
            break;
        }
        if used.insert(paper.arxiv_id.clone()) {
            ranked.push(paper);
        }
    }

    Ok(Some((
        parsed
            .ranking_note
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| fallback_ranking_note(mode).to_string()),
        parsed
            .overall_summary
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| fallback_overall_summary(mode, candidates.len(), limit)),
        ranked,
    )))
}

fn heuristic_rank_papers(
    candidates: &[ArxivPaper],
    request: &ArxivSearchRequest,
    mode: RankingMode,
    limit: usize,
) -> Vec<ArxivRecommendation> {
    let mut ranked = candidates
        .iter()
        .map(|paper| {
            let score = heuristic_score(paper, request, mode);
            let reason = heuristic_reason(paper, request, mode);
            let title_zh = None;
            let tldr_zh = Some(match mode {
                RankingMode::Relevance => "按字段级关键词命中度和时间新近度排序。".to_string(),
                RankingMode::Quality => {
                    "按字段命中、摘要信息密度和实验信号做启发式质量预测。".to_string()
                }
            });
            let tags = heuristic_tags(paper, request, mode);

            ArxivRecommendation {
                arxiv_id: paper.arxiv_id.clone(),
                title: paper.title.clone(),
                title_zh,
                authors: paper.authors.clone(),
                category: paper.category.clone(),
                published_at: paper.published_at.clone(),
                updated_at: paper.updated_at.clone(),
                abstract_text: paper.abstract_text.clone(),
                abs_url: paper.abs_url.clone(),
                pdf_url: paper.pdf_url.clone(),
                score,
                reason,
                tldr_zh,
                tags,
            }
        })
        .collect::<Vec<_>>();

    ranked.sort_by(|left, right| right.score.cmp(&left.score));
    ranked.truncate(limit);
    ranked
}

fn heuristic_score(paper: &ArxivPaper, request: &ArxivSearchRequest, mode: RankingMode) -> i32 {
    let title = paper.title.to_lowercase();
    let abstract_text = paper.abstract_text.to_lowercase();
    let authors = paper.authors.to_lowercase();
    let comment = paper.comment.to_lowercase();
    let journal_ref = paper.journal_ref.to_lowercase();
    let recency_score = recency_score(&paper.published_at);

    let mut score = 36 + recency_score;
    score += weighted_term_hits(&title, &request.title_terms, 18, 3);
    score += weighted_term_hits(&abstract_text, &request.title_terms, 5, 3);
    score += weighted_term_hits(&abstract_text, &request.abstract_terms, 16, 3);
    score += weighted_term_hits(&title, &request.abstract_terms, 4, 3);
    score += weighted_term_hits(&title, &request.all_terms, 12, 4);
    score += weighted_term_hits(&abstract_text, &request.all_terms, 9, 4);
    score += weighted_term_hits(&authors, &request.authors, 18, 3);
    score += matched_categories(&paper.category, &request.categories).len() as i32 * 18;
    score += weighted_term_hits(&comment, &request.comments_terms, 10, 2);
    score += weighted_term_hits(&journal_ref, &request.journal_ref_terms, 10, 2);
    if has_excluded_match(paper, &request.exclude_terms) {
        score -= 40;
    }
    if mode == RankingMode::Quality {
        score += signal_score(
            &abstract_text,
            &[
                "state-of-the-art",
                "sota",
                "benchmark",
                "evaluation",
                "experiments",
                "outperform",
                "ablation",
                "analysis",
                "theoretical",
            ],
            18,
        );
        score += signal_score(
            &abstract_text,
            &["framework", "method", "approach", "algorithm", "dataset"],
            10,
        );
    }

    score.clamp(1, 100)
}

fn heuristic_reason(paper: &ArxivPaper, request: &ArxivSearchRequest, mode: RankingMode) -> String {
    let title = paper.title.to_lowercase();
    let abstract_text = paper.abstract_text.to_lowercase();
    let authors = paper.authors.to_lowercase();
    let comment = paper.comment.to_lowercase();
    let journal_ref = paper.journal_ref.to_lowercase();
    let title_hits = match_terms(&title, &request.title_terms);
    let abstract_hits = match_terms(&abstract_text, &request.abstract_terms);
    let general_hits = match_terms(&format!("{title} {abstract_text}"), &request.all_terms);
    let author_hits = match_terms(&authors, &request.authors);
    let category_hits = matched_categories(&paper.category, &request.categories);
    let comment_hits = match_terms(&comment, &request.comments_terms);
    let journal_hits = match_terms(&journal_ref, &request.journal_ref_terms);

    let mut signals = Vec::new();
    if !title_hits.is_empty() {
        signals.push(format!("标题命中 {}", title_hits.join("、")));
    }
    if !abstract_hits.is_empty() {
        signals.push(format!("摘要命中 {}", abstract_hits.join("、")));
    }
    if !general_hits.is_empty() {
        signals.push(format!("通用词命中 {}", general_hits.join("、")));
    }
    if !author_hits.is_empty() {
        signals.push(format!("作者命中 {}", author_hits.join("、")));
    }
    if !category_hits.is_empty() {
        signals.push(format!("分类匹配 {}", category_hits.join("、")));
    }
    if !comment_hits.is_empty() {
        signals.push(format!("备注命中 {}", comment_hits.join("、")));
    }
    if !journal_hits.is_empty() {
        signals.push(format!("期刊/会议信息命中 {}", journal_hits.join("、")));
    }
    if recency_score(&paper.published_at) >= 12 {
        signals.push("发布时间较新".into());
    }
    if mode == RankingMode::Quality {
        let quality_signals = collect_quality_signals(&abstract_text);
        if !quality_signals.is_empty() {
            signals.push(format!("摘要中出现 {}", quality_signals.join("、")));
        }
    }
    if signals.is_empty() {
        signals.push("满足部分结构化检索条件".into());
    }

    let suffix = if mode == RankingMode::Quality {
        "这属于基于标题和摘要的质量预测，不等同于真实引用或录用情况。"
    } else {
        "适合作为当前检索条件下的优先阅读入口。"
    };
    format!(
        "{}。{}",
        signals.into_iter().take(3).collect::<Vec<_>>().join("，"),
        suffix
    )
}

fn heuristic_tags(
    paper: &ArxivPaper,
    request: &ArxivSearchRequest,
    mode: RankingMode,
) -> Vec<String> {
    let mut tags = Vec::new();
    let title = paper.title.to_lowercase();
    let abstract_text = paper.abstract_text.to_lowercase();
    let comment = paper.comment.to_lowercase();
    let journal_ref = paper.journal_ref.to_lowercase();

    if mode == RankingMode::Relevance {
        push_unique_values(&mut tags, &match_terms(&title, &request.title_terms));
        push_unique_values(
            &mut tags,
            &match_terms(&abstract_text, &request.abstract_terms),
        );
        push_unique_values(
            &mut tags,
            &match_terms(&format!("{title} {abstract_text}"), &request.all_terms),
        );
        push_unique_values(
            &mut tags,
            &matched_categories(&paper.category, &request.categories),
        );
        push_unique_values(&mut tags, &match_terms(&comment, &request.comments_terms));
        push_unique_values(
            &mut tags,
            &match_terms(&journal_ref, &request.journal_ref_terms),
        );
    } else {
        tags.extend(collect_quality_signals(&abstract_text));
    }

    if tags.is_empty() && !paper.category.is_empty() {
        tags.push(paper.category.clone());
    }

    tags.truncate(4);
    tags
}

fn collect_quality_signals(abstract_text: &str) -> Vec<String> {
    let candidates = [
        ("benchmark", "benchmark"),
        ("experiments", "实验"),
        ("evaluation", "评测"),
        ("ablation", "消融"),
        ("state-of-the-art", "SOTA"),
        ("outperform", "性能提升"),
        ("theoretical", "理论分析"),
        ("dataset", "数据集"),
    ];

    candidates
        .iter()
        .filter_map(|(needle, label)| abstract_text.contains(needle).then(|| (*label).to_string()))
        .collect()
}

fn recency_score(published_at: &str) -> i32 {
    let Some(published) = parse_arxiv_datetime(published_at) else {
        return 8;
    };
    let age_days = (Utc::now() - published).num_days();
    if age_days <= 3 {
        20
    } else if age_days <= 7 {
        16
    } else if age_days <= 14 {
        12
    } else if age_days <= 30 {
        8
    } else {
        4
    }
}

fn signal_score(text: &str, needles: &[&str], cap: i32) -> i32 {
    let raw = needles
        .iter()
        .filter(|needle| text.contains(**needle))
        .count() as i32
        * 4;
    raw.min(cap)
}

fn describe_request(request: &ArxivSearchRequest) -> String {
    let mut sections = Vec::new();
    if !request.topic.is_empty() {
        sections.push(format!("研究主题：{}", request.topic));
    }
    if !request.all_terms.is_empty() {
        sections.push(format!("通用关键词：{}", request.all_terms.join("、")));
    }
    if !request.title_terms.is_empty() {
        sections.push(format!("标题关键词：{}", request.title_terms.join("、")));
    }
    if !request.abstract_terms.is_empty() {
        sections.push(format!("摘要关键词：{}", request.abstract_terms.join("、")));
    }
    if !request.authors.is_empty() {
        sections.push(format!("作者：{}", request.authors.join("、")));
    }
    if !request.categories.is_empty() {
        sections.push(format!("分类：{}", request.categories.join("、")));
    }
    if !request.comments_terms.is_empty() {
        sections.push(format!("备注关键词：{}", request.comments_terms.join("、")));
    }
    if !request.journal_ref_terms.is_empty() {
        sections.push(format!(
            "期刊/会议信息：{}",
            request.journal_ref_terms.join("、")
        ));
    }
    if !request.exclude_terms.is_empty() {
        sections.push(format!("排除词：{}", request.exclude_terms.join("、")));
    }
    sections.join("；")
}

fn structured_filter_summary(request: &ArxivSearchRequest) -> String {
    let mut lines = Vec::new();
    lines.push(if request.topic.is_empty() {
        "- 研究主题：未填写".to_string()
    } else {
        format!("- 研究主题：{}", request.topic)
    });
    if !request.all_terms.is_empty() {
        lines.push(format!(
            "- 通用关键词(all)：{}",
            request.all_terms.join("、")
        ));
    }
    if !request.title_terms.is_empty() {
        lines.push(format!(
            "- 标题关键词(ti)：{}",
            request.title_terms.join("、")
        ));
    }
    if !request.abstract_terms.is_empty() {
        lines.push(format!(
            "- 摘要关键词(abs)：{}",
            request.abstract_terms.join("、")
        ));
    }
    if !request.authors.is_empty() {
        lines.push(format!("- 作者(au)：{}", request.authors.join("、")));
    }
    if !request.categories.is_empty() {
        lines.push(format!("- 分类(cat)：{}", request.categories.join("、")));
    }
    if !request.comments_terms.is_empty() {
        lines.push(format!("- 备注(co)：{}", request.comments_terms.join("、")));
    }
    if !request.journal_ref_terms.is_empty() {
        lines.push(format!(
            "- 期刊/会议信息(jr)：{}",
            request.journal_ref_terms.join("、")
        ));
    }
    if !request.exclude_terms.is_empty() {
        lines.push(format!(
            "- 排除词(ANDNOT)：{}",
            request.exclude_terms.join("、")
        ));
    }
    lines.join("\n")
}

fn collect_keywords(request: &ArxivSearchRequest) -> Vec<String> {
    let mut keywords = Vec::new();
    for values in [
        &request.all_terms,
        &request.title_terms,
        &request.abstract_terms,
        &request.authors,
        &request.categories,
        &request.comments_terms,
        &request.journal_ref_terms,
    ] {
        push_unique_values(&mut keywords, values);
    }
    keywords
}

fn weighted_term_hits(text: &str, terms: &[String], weight: i32, cap: usize) -> i32 {
    let hits = terms
        .iter()
        .filter(|term| text.contains(&term.to_lowercase()))
        .count()
        .min(cap) as i32;
    hits * weight
}

fn match_terms(text: &str, terms: &[String]) -> Vec<String> {
    terms
        .iter()
        .filter(|term| text.contains(&term.to_lowercase()))
        .cloned()
        .collect()
}

fn matched_categories(category: &str, filters: &[String]) -> Vec<String> {
    let normalized = category.trim().to_lowercase();
    filters
        .iter()
        .filter(|filter| filter.to_lowercase() == normalized)
        .cloned()
        .collect()
}

fn has_excluded_match(paper: &ArxivPaper, exclude_terms: &[String]) -> bool {
    if exclude_terms.is_empty() {
        return false;
    }
    let haystack = format!(
        "{} {} {} {} {}",
        paper.title, paper.abstract_text, paper.authors, paper.comment, paper.journal_ref
    )
    .to_lowercase();
    exclude_terms
        .iter()
        .any(|term| haystack.contains(&term.to_lowercase()))
}

fn push_unique_values(target: &mut Vec<String>, values: &[String]) {
    for value in values {
        if !target
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(value))
        {
            target.push(value.clone());
        }
    }
}

fn normalize_term_list(values: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for value in values {
        for part in parse_multi_value_input(&value) {
            let key = part.to_lowercase();
            if seen.insert(key) {
                normalized.push(part);
            }
        }
    }
    normalized
}

fn normalize_category_list(values: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for value in values {
        for part in parse_multi_value_input(&value) {
            let category = normalize_category(&part);
            if category.is_empty() {
                continue;
            }
            let key = category.to_lowercase();
            if seen.insert(key) {
                normalized.push(category);
            }
        }
    }
    normalized
}

fn parse_multi_value_input(value: &str) -> Vec<String> {
    let splitters = [',', '，', ';', '；', '\n'];
    value
        .split(|ch| splitters.contains(&ch))
        .map(clean_whitespace)
        .filter(|part| !part.is_empty())
        .collect()
}

fn normalize_category(value: &str) -> String {
    let compact = clean_whitespace(value).replace(' ', "");
    if compact.is_empty() {
        return String::new();
    }
    match compact.split_once('.') {
        Some((prefix, suffix)) => format!("{}.{}", prefix.to_lowercase(), suffix.to_uppercase()),
        None => compact.to_lowercase(),
    }
}

fn build_search_query(request: &ArxivSearchRequest, days: i64) -> String {
    build_search_query_with_now(request, days, Utc::now())
}

fn build_search_query_with_now(
    request: &ArxivSearchRequest,
    days: i64,
    now: DateTime<Utc>,
) -> String {
    let mut clauses = Vec::new();

    if let Some(clause) = build_or_field_clause("all", &request.all_terms, true) {
        clauses.push(clause);
    }
    if let Some(clause) = build_or_field_clause("ti", &request.title_terms, true) {
        clauses.push(clause);
    }
    if let Some(clause) = build_or_field_clause("abs", &request.abstract_terms, true) {
        clauses.push(clause);
    }
    if let Some(clause) = build_or_field_clause("au", &request.authors, true) {
        clauses.push(clause);
    }
    if let Some(clause) = build_or_field_clause("cat", &request.categories, false) {
        clauses.push(clause);
    }
    if let Some(clause) = build_or_field_clause("co", &request.comments_terms, true) {
        clauses.push(clause);
    }
    if let Some(clause) = build_or_field_clause("jr", &request.journal_ref_terms, true) {
        clauses.push(clause);
    }
    clauses.push(submitted_date_clause(days, now));

    let mut query = clauses.join(" AND ");
    if let Some(exclude_clause) = build_or_field_clause("all", &request.exclude_terms, true) {
        query.push_str(" ANDNOT ");
        query.push_str(&exclude_clause);
    }

    query
}

fn submitted_date_clause(days: i64, now: DateTime<Utc>) -> String {
    let start = now - Duration::days(days.max(1));
    format!(
        "submittedDate:[{} TO {}]",
        start.format("%Y%m%d%H%M"),
        now.format("%Y%m%d%H%M")
    )
}

fn build_or_field_clause(prefix: &str, terms: &[String], quote_terms: bool) -> Option<String> {
    let values = terms
        .iter()
        .map(|term| format_field_term(prefix, term, quote_terms))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    if values.is_empty() {
        None
    } else if values.len() == 1 {
        values.into_iter().next()
    } else {
        Some(format!("({})", values.join(" OR ")))
    }
}

fn format_field_term(prefix: &str, term: &str, quote_terms: bool) -> String {
    if quote_terms {
        let sanitized = clean_whitespace(&term.replace('"', " "));
        if sanitized.is_empty() {
            String::new()
        } else {
            format!("{prefix}:\"{sanitized}\"")
        }
    } else {
        let sanitized = term.replace('"', "").replace(' ', "");
        if sanitized.is_empty() {
            String::new()
        } else {
            format!("{prefix}:{sanitized}")
        }
    }
}

fn candidate_pool_size(limit: usize) -> usize {
    limit.saturating_mul(4).clamp(16, 36)
}

fn parse_arxiv_datetime(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|parsed| parsed.with_timezone(&Utc))
}

fn child_text(node: roxmltree::Node<'_, '_>, child_name: &str) -> String {
    node.children()
        .find(|child| child.is_element() && child.tag_name().name() == child_name)
        .and_then(|child| child.text())
        .map(clean_whitespace)
        .unwrap_or_default()
}

fn clean_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_arxiv_id(raw_id: &str) -> String {
    let value = raw_id.trim();
    let value = value
        .rsplit("/abs/")
        .next()
        .unwrap_or(value)
        .trim_end_matches('/');
    if let Some(index) = value.rfind('v') {
        let suffix = &value[index + 1..];
        if !suffix.is_empty() && suffix.chars().all(|ch| ch.is_ascii_digit()) {
            return value[..index].to_string();
        }
    }
    value.to_string()
}

fn mode_prompt(mode: RankingMode) -> &'static str {
    match mode {
        RankingMode::Relevance => "优先挑出和用户关键词最贴合、最值得现在阅读的论文。",
        RankingMode::Quality => {
            "优先挑出从标题和摘要看研究完成度、方法信息密度和潜在影响更高的论文。"
        }
    }
}

fn fallback_ranking_note(mode: RankingMode) -> &'static str {
    match mode {
        RankingMode::Relevance => "当前按字段匹配度与发布时间进行启发式排序。",
        RankingMode::Quality => {
            "当前按字段匹配、摘要信息密度、实验信号与发布时间进行启发式质量预测排序。"
        }
    }
}

fn fallback_overall_summary(mode: RankingMode, candidate_count: usize, limit: usize) -> String {
    match mode {
        RankingMode::Relevance => format!(
            "已从最近抓到的 {candidate_count} 篇候选论文中，按相关性筛出前 {limit} 篇，适合先作为阅读入口。"
        ),
        RankingMode::Quality => format!(
            "已从最近抓到的 {candidate_count} 篇候选论文中，按质量预测筛出前 {limit} 篇。该结果只基于标题和摘要，不代表真实影响力。"
        ),
    }
}

fn disclaimer_for_mode(mode: RankingMode) -> &'static str {
    match mode {
        RankingMode::Relevance => {
            "arXiv 结果来自实时检索；推荐优先级由当前项目模型设置或本地启发式规则生成。"
        }
        RankingMode::Quality => {
            "“质量最高”是基于标题和摘要做的质量预测，不等同于真实引用、录用结果或社区长期共识。"
        }
    }
}

fn extract_json(input: &str) -> String {
    let trimmed = input.trim();
    let body = if trimmed.starts_with("```") {
        let lines = trimmed.lines().collect::<Vec<_>>();
        lines[1..lines.len().saturating_sub(1)].join("\n")
    } else {
        trimmed.to_string()
    };
    let start = body.find('{').unwrap_or(0);
    let end = body.rfind('}').map(|index| index + 1).unwrap_or(body.len());
    body[start..end].to_string()
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_recent_hint_request, build_search_query_with_now, candidate_pool_size,
        normalize_arxiv_id, parse_arxiv_feed, parse_multi_value_input, ArxivSearchRequest,
        RankingMode,
    };
    use chrono::{DateTime, Utc};

    #[test]
    fn parse_multi_value_input_supports_multiple_separators() {
        let keywords = parse_multi_value_input("agent memory，rag\nplanning; benchmark");
        assert_eq!(
            keywords,
            vec!["agent memory", "rag", "planning", "benchmark"]
        );
    }

    #[test]
    fn build_search_query_uses_structured_fields() {
        let request = ArxivSearchRequest {
            all_terms: vec!["agent memory".into(), "tool use".into()],
            title_terms: vec!["planning".into()],
            authors: vec!["Alice Smith".into()],
            categories: vec!["cs.lg".into(), "stat.ml".into()],
            exclude_terms: vec!["robotics".into()],
            ..ArxivSearchRequest::default()
        }
        .normalize();
        let now = DateTime::parse_from_rfc3339("2026-03-22T12:00:00Z")
            .expect("datetime should parse")
            .with_timezone(&Utc);

        let query = build_search_query_with_now(&request, 14, now);
        assert_eq!(
            query,
            "(all:\"agent memory\" OR all:\"tool use\") AND ti:\"planning\" AND au:\"Alice Smith\" AND (cat:cs.LG OR cat:stat.ML) AND submittedDate:[202603081200 TO 202603221200] ANDNOT all:\"robotics\""
        );
    }

    #[test]
    fn recent_hint_request_uses_topic_when_keywords_are_empty() {
        let request = build_recent_hint_request("large language model alignment", &[]);

        assert!(request.has_search_terms());
        assert_eq!(request.all_terms, vec!["large language model alignment"]);
        assert!(request.title_terms.is_empty());
        assert!(request.abstract_terms.is_empty());
    }

    #[test]
    fn recent_hint_request_keeps_keywords_as_broad_candidate_terms() {
        let request = build_recent_hint_request(
            "large language model alignment",
            &["rlhf".into(), "preference optimization".into()],
        );

        assert_eq!(
            request.all_terms,
            vec![
                "large language model alignment",
                "rlhf",
                "preference optimization"
            ]
        );
        assert!(request.title_terms.is_empty());
        assert!(request.abstract_terms.is_empty());
    }

    #[test]
    fn normalize_arxiv_id_removes_version() {
        assert_eq!(
            normalize_arxiv_id("https://arxiv.org/abs/2503.01234v2"),
            "2503.01234"
        );
    }

    #[test]
    fn candidate_pool_has_reasonable_bounds() {
        assert_eq!(candidate_pool_size(2), 16);
        assert_eq!(candidate_pool_size(10), 36);
    }

    #[test]
    fn parse_arxiv_feed_extracts_entry_fields() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2503.01234v2</id>
    <updated>2026-03-20T10:00:00Z</updated>
    <published>2026-03-19T09:00:00Z</published>
    <title>  Tool-Using Agents for Planning </title>
    <summary> A paper about tool use and planning. </summary>
    <arxiv:comment>Accepted to Demo Track</arxiv:comment>
    <arxiv:journal_ref>ACL 2026 Findings</arxiv:journal_ref>
    <author><name>Alice</name></author>
    <author><name>Bob</name></author>
    <arxiv:primary_category term="cs.AI" />
    <link rel="alternate" type="text/html" href="https://arxiv.org/abs/2503.01234v2" />
    <link title="pdf" type="application/pdf" href="https://arxiv.org/pdf/2503.01234v2.pdf" />
  </entry>
</feed>"#;

        let papers = parse_arxiv_feed(xml).expect("feed should parse");
        assert_eq!(papers.len(), 1);
        assert_eq!(papers[0].arxiv_id, "2503.01234");
        assert_eq!(papers[0].title, "Tool-Using Agents for Planning");
        assert_eq!(papers[0].authors, "Alice, Bob");
        assert_eq!(papers[0].category, "cs.AI");
        assert_eq!(papers[0].comment, "Accepted to Demo Track");
        assert_eq!(papers[0].journal_ref, "ACL 2026 Findings");
    }

    #[test]
    fn ranking_mode_defaults_to_relevance() {
        assert_eq!(RankingMode::from_value(None).as_str(), "relevance");
        assert_eq!(RankingMode::from_value(Some("quality")).as_str(), "quality");
    }
}
