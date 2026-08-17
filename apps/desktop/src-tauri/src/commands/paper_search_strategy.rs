use crate::commands::paper_search::PaperCandidate;
use crate::commands::paper_search_response_cache;
use crate::semantic_scholar::throttle_semantic_scholar_request;
use anyhow::{Context, Result};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::Duration;

const SEMANTIC_SCHOLAR_GRAPH_URL: &str = "https://api.semanticscholar.org/graph/v1/paper";
const SEMANTIC_SCHOLAR_USER_AGENT: &str = "xiaoyan-desktop/0.5.2";
const PAPER_FIELDS: &str =
    "paperId,corpusId,title,abstract,year,venue,url,citationCount,publicationDate,authors,openAccessPdf";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SearchDepth {
    Quick,
    Balanced,
    Deep,
}

impl SearchDepth {
    pub(crate) fn from_value(value: Option<&str>) -> Self {
        match value.unwrap_or("balanced").trim() {
            "quick" => Self::Quick,
            "deep" => Self::Deep,
            _ => Self::Balanced,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Quick => "quick",
            Self::Balanced => "balanced",
            Self::Deep => "deep",
        }
    }

    pub(crate) fn query_limit(self) -> usize {
        match self {
            Self::Quick => 2,
            Self::Balanced | Self::Deep => 4,
        }
    }

    pub(crate) fn seed_limit(self) -> usize {
        match self {
            Self::Quick | Self::Balanced => 0,
            Self::Deep => 2,
        }
    }

    pub(crate) fn uses_full_text_snippets(self) -> bool {
        !matches!(self, Self::Quick)
    }

    pub(crate) fn uses_citation_network(self) -> bool {
        matches!(self, Self::Deep)
    }

    fn relation_limit(self) -> usize {
        match self {
            Self::Quick | Self::Balanced => 0,
            Self::Deep => 100,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct SearchStep {
    pub stage: &'static str,
    pub label: String,
    pub status: &'static str,
    pub query: Option<String>,
    pub candidate_count: Option<usize>,
    pub duration_ms: u64,
    pub note: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct SearchMetrics {
    pub academic_api_calls: usize,
    pub web_api_calls: usize,
    pub llm_calls: usize,
    pub estimated_tokens: u64,
    pub duration_ms: u64,
    pub iterations: usize,
    pub filtered_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct PaperRelation {
    pub source_id: String,
    pub target_id: String,
    pub kind: &'static str,
}

pub(crate) struct CitationExpansion {
    pub candidates: Vec<PaperCandidate>,
    pub relations: Vec<PaperRelation>,
    pub steps: Vec<SearchStep>,
    pub api_calls: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelatedPaper {
    #[serde(default, deserialize_with = "deserialize_nullable_string")]
    paper_id: String,
    #[serde(default)]
    corpus_id: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_nullable_string")]
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
    #[serde(default, deserialize_with = "deserialize_nullable_vec")]
    authors: Vec<RelatedAuthor>,
    #[serde(default)]
    open_access_pdf: Option<RelatedPdf>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelatedAuthor {
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelatedPdf {
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceRecord {
    #[serde(default)]
    cited_paper: Option<RelatedPaper>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CitationRecord {
    #[serde(default)]
    citing_paper: Option<RelatedPaper>,
}

#[derive(Debug, Clone, Deserialize)]
struct ReferenceResponse {
    #[serde(default)]
    data: Option<Vec<ReferenceRecord>>,
}

#[derive(Debug, Clone, Deserialize)]
struct CitationResponse {
    #[serde(default)]
    data: Option<Vec<CitationRecord>>,
}

fn deserialize_nullable_string<'de, D>(deserializer: D) -> std::result::Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

fn deserialize_nullable_vec<'de, D, T>(deserializer: D) -> std::result::Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(deserializer)?.unwrap_or_default())
}

pub(crate) fn filter_low_quality_candidates(
    candidates: Vec<PaperCandidate>,
) -> (Vec<PaperCandidate>, usize) {
    let before = candidates.len();
    let filtered = candidates
        .into_iter()
        .filter(|paper| {
            let title = paper.title.trim();
            if title.chars().count() < 6 {
                return false;
            }
            if paper.abstract_text.trim().is_empty()
                && paper.citation_count <= 0
                && (paper.venue.trim().is_empty() || paper.venue == "Unknown venue")
            {
                return false;
            }
            let lower = format!("{} {}", title, paper.venue).to_lowercase();
            ![
                "retracted article",
                "withdrawn",
                "editorial board",
                "table of contents",
            ]
            .iter()
            .any(|marker| lower.contains(marker))
        })
        .collect::<Vec<_>>();
    let removed = before.saturating_sub(filtered.len());
    (filtered, removed)
}

pub(crate) async fn expand_citation_network(
    settings: &HashMap<String, String>,
    seed_ids: &[String],
    depth: SearchDepth,
) -> CitationExpansion {
    if seed_ids.is_empty() || !depth.uses_citation_network() {
        return CitationExpansion {
            candidates: Vec::new(),
            relations: Vec::new(),
            steps: vec![SearchStep {
                stage: "citation_expand",
                label: "引文网络扩展".into(),
                status: "skipped",
                query: None,
                candidate_count: Some(0),
                duration_ms: 0,
                note: "当前搜索深度跳过引文扩展，以控制 API 调用和延时。".into(),
            }],
            api_calls: 0,
        };
    }

    let mut candidates = Vec::new();
    let mut relations = Vec::new();
    let mut steps = Vec::new();
    let mut api_calls = 0usize;
    let mut seen = HashSet::new();
    let limit = depth.relation_limit();

    for seed_id in seed_ids.iter().take(depth.seed_limit()) {
        let started = std::time::Instant::now();
        let references = fetch_references(settings, seed_id, limit).await;
        api_calls += 1;
        let citations = fetch_citations(settings, seed_id, limit).await;
        api_calls += 1;

        let mut found = 0usize;
        let mut errors = Vec::new();
        match references {
            Ok(items) => {
                for paper in items {
                    relations.push(PaperRelation {
                        source_id: seed_id.clone(),
                        target_id: paper.paper_id.clone(),
                        kind: "cites",
                    });
                    if seen.insert(paper.paper_id.clone()) {
                        candidates.push(to_candidate(paper, "reference"));
                        found += 1;
                    }
                }
            }
            Err(error) => errors.push(format!("参考文献：{error:#}")),
        }
        match citations {
            Ok(items) => {
                for paper in items {
                    relations.push(PaperRelation {
                        source_id: seed_id.clone(),
                        target_id: paper.paper_id.clone(),
                        kind: "cited_by",
                    });
                    if seen.insert(paper.paper_id.clone()) {
                        candidates.push(to_candidate(paper, "citation"));
                        found += 1;
                    }
                }
            }
            Err(error) => errors.push(format!("引用论文：{error:#}")),
        }

        steps.push(SearchStep {
            stage: "citation_expand",
            label: "引文网络扩展".into(),
            status: if errors.is_empty() {
                "completed"
            } else {
                "partial"
            },
            query: Some(seed_id.clone()),
            candidate_count: Some(found),
            duration_ms: started.elapsed().as_millis() as u64,
            note: if errors.is_empty() {
                format!("围绕种子论文扩展参考文献与引用论文，新增 {found} 篇候选。")
            } else {
                format!("已保留成功扩展的结果；{}", errors.join("；"))
            },
        });
    }

    CitationExpansion {
        candidates,
        relations,
        steps,
        api_calls,
    }
}

async fn fetch_references(
    settings: &HashMap<String, String>,
    paper_id: &str,
    limit: usize,
) -> Result<Vec<RelatedPaper>> {
    let response: ReferenceResponse =
        fetch_relation(settings, paper_id, "references", limit).await?;
    Ok(response
        .data
        .unwrap_or_default()
        .into_iter()
        .filter_map(|record| record.cited_paper)
        .filter(has_required_relation_metadata)
        .collect())
}

async fn fetch_citations(
    settings: &HashMap<String, String>,
    paper_id: &str,
    limit: usize,
) -> Result<Vec<RelatedPaper>> {
    let response: CitationResponse = fetch_relation(settings, paper_id, "citations", limit).await?;
    Ok(response
        .data
        .unwrap_or_default()
        .into_iter()
        .filter_map(|record| record.citing_paper)
        .filter(has_required_relation_metadata)
        .collect())
}

fn has_required_relation_metadata(paper: &RelatedPaper) -> bool {
    !paper.paper_id.trim().is_empty() && !paper.title.trim().is_empty()
}

async fn fetch_relation<T: for<'de> Deserialize<'de>>(
    settings: &HashMap<String, String>,
    paper_id: &str,
    relation: &str,
    limit: usize,
) -> Result<T> {
    let cache_key =
        format!("semantic-scholar-relation-v1|{paper_id}|{relation}|{limit}|{PAPER_FIELDS}");
    if let Some(payload) = paper_search_response_cache::load(&cache_key)? {
        return serde_json::from_slice(&payload)
            .with_context(|| format!("解析论文评测引文响应缓存失败：{cache_key}"));
    }
    let client = reqwest::Client::new();
    let url = format!("{SEMANTIC_SCHOLAR_GRAPH_URL}/{paper_id}/{relation}");
    let mut request = client
        .get(url)
        .header("User-Agent", SEMANTIC_SCHOLAR_USER_AGENT)
        .query(&[
            ("limit", limit.to_string()),
            ("fields", PAPER_FIELDS.to_string()),
        ]);
    if let Some(api_key) = settings
        .get("semantic_scholar_api_key")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        request = request.header("x-api-key", api_key);
    }

    const MAX_RETRIES: u32 = 4;
    for attempt in 0..MAX_RETRIES {
        throttle_semantic_scholar_request().await;
        let response = request
            .try_clone()
            .context("引文网络请求克隆失败")?
            .send()
            .await
            .context("引文网络请求失败")?;
        if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS && attempt + 1 < MAX_RETRIES
        {
            let retry_after = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok());
            let wait_secs = retry_after
                .unwrap_or_else(|| 2u64.pow(attempt + 1))
                .clamp(2, 30);
            tokio::time::sleep(Duration::from_secs(wait_secs)).await;
            continue;
        }
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Semantic Scholar 返回 {status}: {body}"));
        }
        let response_bytes = response.bytes().await.context("读取引文网络结果失败")?;
        let parsed = serde_json::from_slice(&response_bytes).context("解析引文网络结果失败")?;
        paper_search_response_cache::store(&cache_key, &response_bytes)?;
        return Ok(parsed);
    }
    Err(anyhow::anyhow!("Semantic Scholar 引文网络请求超过重试上限"))
}

fn to_candidate(paper: RelatedPaper, discovered_via: &str) -> PaperCandidate {
    let detail_url = paper
        .url
        .clone()
        .unwrap_or_else(|| format!("https://www.semanticscholar.org/paper/{}", paper.paper_id));
    let pdf_url = paper
        .open_access_pdf
        .and_then(|pdf| pdf.url)
        .unwrap_or_else(|| detail_url.clone());
    let authors = paper
        .authors
        .into_iter()
        .filter_map(|author| author.name)
        .filter(|name| !name.trim().is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    let published_at = paper.publication_date.unwrap_or_else(|| {
        paper
            .year
            .map(|year| format!("{year}-01-01"))
            .unwrap_or_default()
    });

    PaperCandidate {
        id: paper.paper_id,
        corpus_id: paper.corpus_id,
        title: paper.title,
        authors,
        venue: paper.venue.unwrap_or_else(|| "Unknown venue".into()),
        year: paper.year,
        published_at,
        abstract_text: paper.abstract_text.unwrap_or_default(),
        detail_url,
        pdf_url,
        citation_count: paper.citation_count.unwrap_or(0),
        discovered_via: discovered_via.to_string(),
        retrieval_text: String::new(),
        retrieval_score: None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        filter_low_quality_candidates, has_required_relation_metadata, PaperCandidate,
        ReferenceResponse, RelatedPaper, SearchDepth,
    };

    fn candidate(title: &str, abstract_text: &str, citations: i32, venue: &str) -> PaperCandidate {
        PaperCandidate {
            id: title.to_string(),
            corpus_id: None,
            title: title.to_string(),
            authors: String::new(),
            venue: venue.to_string(),
            year: Some(2025),
            published_at: "2025-01-01".into(),
            abstract_text: abstract_text.to_string(),
            detail_url: String::new(),
            pdf_url: String::new(),
            citation_count: citations,
            discovered_via: "search".into(),
            retrieval_text: String::new(),
            retrieval_score: None,
        }
    }

    #[test]
    fn search_depth_enforces_api_budget() {
        assert_eq!(SearchDepth::Quick.query_limit(), 2);
        assert_eq!(SearchDepth::Quick.seed_limit(), 0);
        assert_eq!(SearchDepth::Balanced.seed_limit(), 0);
        assert_eq!(SearchDepth::Deep.seed_limit(), 2);
        assert!(!SearchDepth::Quick.uses_full_text_snippets());
        assert!(SearchDepth::Balanced.uses_full_text_snippets());
        assert!(SearchDepth::Deep.uses_full_text_snippets());
        assert!(!SearchDepth::Quick.uses_citation_network());
        assert!(!SearchDepth::Balanced.uses_citation_network());
        assert!(SearchDepth::Deep.uses_citation_network());
        assert_eq!(SearchDepth::Deep.relation_limit(), 100);
    }

    #[test]
    fn removes_candidates_without_any_quality_signal() {
        let (kept, removed) = filter_low_quality_candidates(vec![
            candidate("Useful academic paper", "Detailed abstract", 0, "SIGIR"),
            candidate("Metadata only paper", "", 0, "Unknown venue"),
            candidate("Influential legacy paper", "", 120, "Unknown venue"),
        ]);

        assert_eq!(removed, 1);
        assert_eq!(kept.len(), 2);
    }

    #[test]
    fn null_relation_data_is_treated_as_an_empty_page() {
        let response: ReferenceResponse =
            serde_json::from_str(r#"{"data":null}"#).expect("null data should be accepted");

        assert!(response.data.unwrap_or_default().is_empty());
    }

    #[test]
    fn incomplete_relation_paper_is_parsed_then_rejected() {
        let response: ReferenceResponse = serde_json::from_str(
            r#"{"data":[{"citedPaper":{"paperId":null,"title":null,"authors":null}}]}"#,
        )
        .expect("nullable paper metadata should not reject the whole page");
        let paper = response
            .data
            .unwrap_or_default()
            .into_iter()
            .next()
            .and_then(|record| record.cited_paper)
            .expect("record should remain available for filtering");

        assert!(!has_required_relation_metadata(&paper));
    }

    #[test]
    fn related_paper_abstract_field_is_preserved() {
        let paper: RelatedPaper = serde_json::from_str(
            r#"{"paperId":"paper-1","title":"A cited paper","abstract":"Published abstract"}"#,
        )
        .expect("related paper should deserialize");

        assert_eq!(paper.abstract_text.as_deref(), Some("Published abstract"));
    }
}
