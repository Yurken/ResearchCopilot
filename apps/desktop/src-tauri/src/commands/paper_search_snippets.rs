use super::paper_search::PaperCandidate;
use super::paper_search_response_cache;
use crate::semantic_scholar::throttle_semantic_scholar_request;
use anyhow::{Context, Result};
use reqwest::Request;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::time::Duration;

const SNIPPET_SEARCH_URL: &str = "https://api.semanticscholar.org/graph/v1/snippet/search";
const PAPER_BATCH_URL: &str = "https://api.semanticscholar.org/graph/v1/paper/batch";
const USER_AGENT: &str = "xiaoyan-desktop/0.5.2";
const PAPER_FIELDS: &str =
    "paperId,corpusId,title,abstract,year,venue,url,citationCount,publicationDate,authors,openAccessPdf";

pub(crate) struct SnippetExpansion {
    pub(crate) candidates: Vec<PaperCandidate>,
    pub(crate) api_calls: usize,
    pub(crate) error: Option<String>,
}

pub(crate) fn merge_full_text_retrieval_signal(
    existing: &mut PaperCandidate,
    snippet_candidate: &PaperCandidate,
) {
    let incoming_score = snippet_candidate.retrieval_score.unwrap_or_default();
    let existing_score = existing.retrieval_score.unwrap_or_default();
    if incoming_score >= existing_score {
        existing.retrieval_score = snippet_candidate.retrieval_score;
        existing.retrieval_text = snippet_candidate.retrieval_text.clone();
    }
    if !existing.discovered_via.contains("full_text_snippet") {
        existing.discovered_via = format!("{}+full_text_snippet", existing.discovered_via);
    }
}

#[derive(Debug, Deserialize)]
struct SnippetResponse {
    #[serde(default)]
    data: Vec<SnippetMatch>,
}

#[derive(Debug, Deserialize)]
struct SnippetMatch {
    #[serde(default)]
    score: f64,
    paper: SnippetPaper,
    #[serde(default)]
    snippet: Option<SnippetText>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnippetPaper {
    corpus_id: String,
}

#[derive(Debug, Deserialize)]
struct SnippetText {
    #[serde(default)]
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaperDetail {
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
    authors: Vec<PaperAuthor>,
    #[serde(default)]
    open_access_pdf: Option<PaperPdf>,
}

#[derive(Debug, Deserialize)]
struct PaperAuthor {
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PaperPdf {
    #[serde(default)]
    url: Option<String>,
}

pub(crate) async fn fetch_semantic_scholar_snippet_candidates(
    settings: &HashMap<String, String>,
    query: &str,
    exclude_terms: &[String],
    cutoff_date: &str,
    limit: usize,
) -> SnippetExpansion {
    let query = query.trim();
    if query.is_empty() {
        return SnippetExpansion {
            candidates: Vec::new(),
            api_calls: 0,
            error: None,
        };
    }

    let limit = limit.clamp(1, 100);
    let client = reqwest::Client::new();
    let mut snippet_request = client
        .get(SNIPPET_SEARCH_URL)
        .header("User-Agent", USER_AGENT)
        .query(&[
            ("query", query.to_string()),
            ("limit", limit.to_string()),
            ("publicationDateOrYear", format!(":{}", cutoff_date.trim())),
        ]);
    if let Some(api_key) = semantic_scholar_api_key(settings) {
        snippet_request = snippet_request.header("x-api-key", api_key);
    }
    let snippet_cache_key = format!("semantic-scholar-snippet-v1|{query}|:{cutoff_date}|{limit}");
    let snippets: SnippetResponse = match fetch_cached_json(
        &snippet_cache_key,
        snippet_request.build().context("构建全文片段检索请求失败"),
        "全文片段检索",
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            return SnippetExpansion {
                candidates: Vec::new(),
                api_calls: 1,
                error: Some(format!("{error:#}")),
            }
        }
    };

    let mut snippet_by_corpus_id = HashMap::<i64, (f64, String)>::new();
    let mut corpus_ids = Vec::new();
    for item in snippets.data {
        let Ok(corpus_id) = item.paper.corpus_id.parse::<i64>() else {
            continue;
        };
        let text = item.snippet.map(|snippet| snippet.text).unwrap_or_default();
        match snippet_by_corpus_id.get_mut(&corpus_id) {
            Some((score, existing_text)) if item.score > *score => {
                *score = item.score;
                *existing_text = text;
            }
            Some(_) => {}
            None => {
                corpus_ids.push(corpus_id);
                snippet_by_corpus_id.insert(corpus_id, (item.score, text));
            }
        }
    }
    if corpus_ids.is_empty() {
        return SnippetExpansion {
            candidates: Vec::new(),
            api_calls: 1,
            error: None,
        };
    }

    let ids = corpus_ids
        .iter()
        .map(|corpus_id| format!("CorpusId:{corpus_id}"))
        .collect::<Vec<_>>();
    let mut detail_request = client
        .post(PAPER_BATCH_URL)
        .header("User-Agent", USER_AGENT)
        .query(&[("fields", PAPER_FIELDS)])
        .json(&json!({"ids": ids}));
    if let Some(api_key) = semantic_scholar_api_key(settings) {
        detail_request = detail_request.header("x-api-key", api_key);
    }
    let detail_cache_key = format!(
        "semantic-scholar-snippet-details-v1|{}|{PAPER_FIELDS}",
        corpus_ids
            .iter()
            .map(i64::to_string)
            .collect::<Vec<_>>()
            .join(",")
    );
    let details: Vec<Option<PaperDetail>> = match fetch_cached_json(
        &detail_cache_key,
        detail_request.build().context("构建全文片段详情请求失败"),
        "全文片段论文详情",
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            return SnippetExpansion {
                candidates: Vec::new(),
                api_calls: 2,
                error: Some(format!("{error:#}")),
            }
        }
    };

    let candidates = merge_snippet_details(details, &snippet_by_corpus_id, exclude_terms);
    SnippetExpansion {
        candidates,
        api_calls: 2,
        error: None,
    }
}

fn merge_snippet_details(
    details: Vec<Option<PaperDetail>>,
    snippet_by_corpus_id: &HashMap<i64, (f64, String)>,
    exclude_terms: &[String],
) -> Vec<PaperCandidate> {
    let mut candidates = details
        .into_iter()
        .flatten()
        .filter(|paper| !paper.paper_id.trim().is_empty() && !paper.title.trim().is_empty())
        .filter_map(|paper| {
            let corpus_id = paper.corpus_id?;
            let (retrieval_score, retrieval_text) = snippet_by_corpus_id.get(&corpus_id)?.clone();
            let lower_text = format!(
                "{}\n{}\n{}",
                paper.title,
                paper.abstract_text.as_deref().unwrap_or_default(),
                retrieval_text
            )
            .to_lowercase();
            if exclude_terms
                .iter()
                .any(|term| !term.is_empty() && lower_text.contains(&term.to_lowercase()))
            {
                return None;
            }
            let authors = paper
                .authors
                .iter()
                .filter_map(|author| author.name.clone())
                .filter(|name| !name.trim().is_empty())
                .collect::<Vec<_>>()
                .join(", ");
            let published_at = paper.publication_date.clone().unwrap_or_else(|| {
                paper
                    .year
                    .map(|year| format!("{year}-01-01"))
                    .unwrap_or_default()
            });
            let detail_url = paper.url.clone().unwrap_or_else(|| {
                format!("https://www.semanticscholar.org/paper/{}", paper.paper_id)
            });
            let pdf_url = paper
                .open_access_pdf
                .and_then(|pdf| pdf.url)
                .unwrap_or_else(|| detail_url.clone());
            Some(PaperCandidate {
                id: paper.paper_id,
                corpus_id: Some(corpus_id),
                title: paper.title,
                authors,
                venue: paper.venue.unwrap_or_else(|| "Unknown venue".into()),
                year: paper.year,
                published_at,
                abstract_text: paper.abstract_text.unwrap_or_default(),
                detail_url,
                pdf_url,
                citation_count: paper.citation_count.unwrap_or(0),
                discovered_via: "full_text_snippet".into(),
                retrieval_text,
                retrieval_score: Some(retrieval_score),
            })
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .retrieval_score
            .partial_cmp(&left.retrieval_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    candidates
}

async fn fetch_cached_json<T: DeserializeOwned>(
    cache_key: &str,
    request: Result<Request>,
    label: &str,
) -> Result<T> {
    if let Some(payload) = paper_search_response_cache::load(cache_key)? {
        return serde_json::from_slice(&payload).with_context(|| format!("解析{label}缓存失败"));
    }
    let request = request?;
    let client = reqwest::Client::new();
    const MAX_RETRIES: u32 = 4;
    for attempt in 0..MAX_RETRIES {
        throttle_semantic_scholar_request().await;
        let response = client
            .execute(
                request
                    .try_clone()
                    .context("克隆 Semantic Scholar 请求失败")?,
            )
            .await
            .with_context(|| format!("{label}请求失败"))?;
        let retryable = response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
            || response.status().is_server_error();
        if retryable && attempt + 1 < MAX_RETRIES {
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
            anyhow::bail!("{label}返回 {status}: {body}");
        }
        let bytes = response
            .bytes()
            .await
            .with_context(|| format!("读取{label}响应失败"))?;
        let parsed =
            serde_json::from_slice(&bytes).with_context(|| format!("解析{label}响应失败"))?;
        paper_search_response_cache::store(cache_key, &bytes)?;
        return Ok(parsed);
    }
    anyhow::bail!("{label}超过重试上限")
}

fn semantic_scholar_api_key(settings: &HashMap<String, String>) -> Option<&str> {
    settings
        .get("semantic_scholar_api_key")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::{
        merge_full_text_retrieval_signal, merge_snippet_details, PaperAuthor, PaperDetail, PaperPdf,
    };
    use crate::commands::paper_search::PaperCandidate;
    use std::collections::HashMap;

    #[test]
    fn snippet_details_keep_full_text_retrieval_signal_separate_from_abstract() {
        let details = vec![Some(PaperDetail {
            paper_id: "paper-id".into(),
            corpus_id: Some(42),
            title: "Target Paper".into(),
            abstract_text: Some("Published abstract".into()),
            year: Some(2024),
            venue: Some("ACL".into()),
            url: None,
            citation_count: Some(12),
            publication_date: Some("2024-01-01".into()),
            authors: vec![PaperAuthor {
                name: Some("Researcher".into()),
            }],
            open_access_pdf: Some(PaperPdf { url: None }),
        })];
        let snippets = HashMap::from([(42, (0.8, "Matched body passage".into()))]);

        let candidates = merge_snippet_details(details, &snippets, &[]);

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].abstract_text, "Published abstract");
        assert_eq!(candidates[0].retrieval_text, "Matched body passage");
        assert_eq!(candidates[0].retrieval_score, Some(0.8));
        assert_eq!(candidates[0].discovered_via, "full_text_snippet");
    }

    #[test]
    fn duplicate_search_candidate_keeps_the_stronger_full_text_signal() {
        let mut existing = PaperCandidate {
            id: "paper-id".into(),
            corpus_id: Some(42),
            title: "Target Paper".into(),
            authors: String::new(),
            venue: "ACL".into(),
            year: Some(2024),
            published_at: "2024-01-01".into(),
            abstract_text: "Published abstract".into(),
            detail_url: String::new(),
            pdf_url: String::new(),
            citation_count: 10,
            discovered_via: "search".into(),
            retrieval_text: String::new(),
            retrieval_score: None,
        };
        let mut snippet = existing.clone();
        snippet.discovered_via = "full_text_snippet".into();
        snippet.retrieval_text = "Matched passage".into();
        snippet.retrieval_score = Some(0.8);

        merge_full_text_retrieval_signal(&mut existing, &snippet);

        assert_eq!(existing.abstract_text, "Published abstract");
        assert_eq!(existing.retrieval_text, "Matched passage");
        assert_eq!(existing.retrieval_score, Some(0.8));
        assert_eq!(existing.discovered_via, "search+full_text_snippet");
    }
}
