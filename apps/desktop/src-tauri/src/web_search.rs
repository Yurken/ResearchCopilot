use anyhow::Result;
use chrono::{Duration as ChronoDuration, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::state::AppState;
use tauri::State;

/// 多 Key 轮询游标：每次取一个起始 Key，跨调用轮换以分摊各 Key 的额度。
static TAVILY_CURSOR: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
struct DuckDuckGoResponse {
    #[serde(default)]
    AbstractText: String,
    #[serde(default)]
    AbstractSource: String,
    #[serde(default)]
    AbstractURL: String,
    #[serde(default)]
    Heading: String,
    #[serde(default)]
    Answer: String,
    #[serde(default)]
    RelatedTopics: Vec<DuckDuckGoTopic>,
    #[serde(default)]
    Results: Vec<DuckDuckGoResult>,
}

#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
struct DuckDuckGoTopic {
    #[serde(default)]
    Text: String,
    #[serde(default)]
    FirstURL: String,
}

#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
struct DuckDuckGoResult {
    #[serde(default)]
    Text: String,
    #[serde(default)]
    FirstURL: String,
}

#[derive(Debug, Deserialize)]
struct TavilyResponse {
    #[serde(default)]
    answer: Option<String>,
    #[serde(default)]
    results: Vec<TavilyResult>,
}

#[derive(Debug, Deserialize)]
struct TavilyResult {
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    content: String,
}

/// 单条联网检索结果，供前端结构化渲染（标题 / 链接 / 摘要）。
#[derive(Debug, Clone, Serialize)]
pub struct WebSearchItem {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// 一次联网检索的结构化产物：来源、概要回答、回退提示与结果列表。
#[derive(Debug, Clone, Default, Serialize)]
pub struct WebSearchOutcome {
    pub provider: String,
    pub answer: Option<String>,
    pub note: Option<String>,
    pub items: Vec<WebSearchItem>,
}

/// 前端可直接调用的联网检索命令，返回结构化结果（论文检索「网络补充」等场景复用）。
#[tauri::command]
pub async fn web_search_query(
    state: State<'_, AppState>,
    query: String,
    cutoff_date: Option<String>,
) -> Result<WebSearchOutcome, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("搜索词不能为空".into());
    }
    let cutoff_date = normalize_cutoff_date(cutoff_date.as_deref())?;
    let settings = state.settings.read().await.clone();
    web_search_structured_with_cutoff(trimmed, &settings, cutoff_date.as_deref())
        .await
        .map_err(|err| err.to_string())
}

/// 联网搜索入口（文本形态，供对话工具使用）：在结构化结果之上渲染为纯文本。
pub async fn web_search(query: &str, settings: &HashMap<String, String>) -> Result<String> {
    let outcome = web_search_structured(query, settings).await?;
    Ok(render_outcome_text(&outcome, query))
}

/// 联网搜索入口（结构化形态）：按 `web_search_provider` 选择来源。
/// tavily 需用户在设置里填 `tavily_api_key`；未填或选 duckduckgo 时走免费的 DuckDuckGo。
pub async fn web_search_structured(
    query: &str,
    settings: &HashMap<String, String>,
) -> Result<WebSearchOutcome> {
    web_search_structured_with_cutoff(query, settings, None).await
}

async fn web_search_structured_with_cutoff(
    query: &str,
    settings: &HashMap<String, String>,
    cutoff_date: Option<&str>,
) -> Result<WebSearchOutcome> {
    let provider = settings
        .get("web_search_provider")
        .map(|value| value.trim())
        .unwrap_or("duckduckgo");

    if provider == "tavily" {
        let keys = settings
            .get("tavily_api_key")
            .map(|raw| parse_tavily_keys(raw))
            .unwrap_or_default();
        if !keys.is_empty() {
            return tavily_search_rotating(query, &keys, cutoff_date).await;
        }
        // 选了 Tavily 但一个 Key 都没填：回退到免费的 DuckDuckGo，保证搜索不中断。
    }

    duckduckgo_search(query, cutoff_date).await
}

fn normalize_cutoff_date(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let parsed = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| "网络检索截止日期格式无效，请使用 YYYY-MM-DD".to_string())?;
    Ok(Some(parsed.format("%Y-%m-%d").to_string()))
}

fn exclusive_end_date(cutoff_date: &str) -> Result<String> {
    let cutoff = NaiveDate::parse_from_str(cutoff_date, "%Y-%m-%d")?;
    Ok((cutoff + ChronoDuration::days(1))
        .format("%Y-%m-%d")
        .to_string())
}

/// 把结构化结果渲染为对话工具消费的纯文本，尽量保持与旧版一致的可读格式。
fn render_outcome_text(outcome: &WebSearchOutcome, query: &str) -> String {
    let mut parts: Vec<String> = Vec::new();

    if let Some(note) = outcome
        .note
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        parts.push(format!("（{note}）"));
    }

    if let Some(answer) = outcome
        .answer
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        parts.push(format!("摘要回答: {answer}"));
    }

    for item in &outcome.items {
        if item.title.is_empty() && item.snippet.is_empty() {
            continue;
        }
        let snippet: String = item.snippet.chars().take(300).collect();
        parts.push(format!("- {} ({})\n  {}", item.title, item.url, snippet));
    }

    if parts.is_empty() {
        format!("未找到与「{query}」相关的搜索结果。")
    } else {
        parts.join("\n\n")
    }
}

/// 从多行/逗号分隔的文本里解析出去重后的 Key 列表。
pub(crate) fn parse_tavily_keys(raw: &str) -> Vec<String> {
    let mut keys: Vec<String> = Vec::new();
    for token in raw.split(['\n', ',']) {
        let key = token.trim();
        // 跳过空串与掩码占位；避免把 "***" 当成真实 Key。
        if key.is_empty() || key == "***" {
            continue;
        }
        if !keys.iter().any(|existing| existing == key) {
            keys.push(key.to_string());
        }
    }
    keys
}

/// 轮询多个 Key：从一个轮换起点开始依次尝试，命中即返回；单个 Key 失败（额度/鉴权/网络）就换下一个。
/// 全部失败时回退 DuckDuckGo，保证搜索不中断。
async fn tavily_search_rotating(
    query: &str,
    keys: &[String],
    cutoff_date: Option<&str>,
) -> Result<WebSearchOutcome> {
    let start = TAVILY_CURSOR.fetch_add(1, Ordering::Relaxed) % keys.len();
    let mut last_err = String::new();
    for offset in 0..keys.len() {
        let key = &keys[(start + offset) % keys.len()];
        match tavily_search_once(query, key, cutoff_date).await {
            Ok((answer, items)) => {
                return Ok(WebSearchOutcome {
                    provider: "tavily".into(),
                    answer,
                    note: None,
                    items,
                });
            }
            Err(e) => last_err = e.to_string(),
        }
    }

    let mut fallback = duckduckgo_search(query, cutoff_date).await?;
    let tavily_note = format!(
        "Tavily 的 {} 个 Key 均不可用：{}，已回退 DuckDuckGo",
        keys.len(),
        last_err
    );
    fallback.note = Some(match fallback.note.take() {
        Some(date_note) => format!("{tavily_note}；{date_note}"),
        None => tavily_note,
    });
    Ok(fallback)
}

/// 轻量校验单个 Tavily Key：打一次最小搜索，2xx 视为可用。
pub async fn tavily_check_key(api_key: &str) -> Result<()> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;

    let resp = client
        .post("https://api.tavily.com/search")
        .json(&serde_json::json!({
            "api_key": api_key,
            "query": "ping",
            "search_depth": "basic",
            "max_results": 1,
            "include_answer": false,
        }))
        .send()
        .await?;

    if resp.status().is_success() {
        Ok(())
    } else {
        anyhow::bail!("HTTP {}", resp.status().as_u16());
    }
}

/// 单次 Tavily 搜索：成功返回（概要回答, 结果列表）；非 2xx 以 Err 抛出，便于上层轮换 Key。
async fn tavily_search_once(
    query: &str,
    api_key: &str,
    cutoff_date: Option<&str>,
) -> Result<(Option<String>, Vec<WebSearchItem>)> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;

    let mut payload = serde_json::json!({
        "api_key": api_key,
        "query": query,
        "search_depth": "basic",
        "max_results": 5,
        "include_answer": true,
    });
    if let Some(cutoff_date) = cutoff_date {
        payload["end_date"] = serde_json::json!(exclusive_end_date(cutoff_date)?);
    }

    let resp = client
        .post("https://api.tavily.com/search")
        .json(&payload)
        .send()
        .await?;

    if !resp.status().is_success() {
        anyhow::bail!("HTTP {}", resp.status().as_u16());
    }

    let data: TavilyResponse = resp.json().await?;

    let answer = data
        .answer
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let mut items: Vec<WebSearchItem> = Vec::new();
    for item in &data.results {
        if item.title.is_empty() && item.content.is_empty() {
            continue;
        }
        let snippet: String = item.content.chars().take(300).collect();
        items.push(WebSearchItem {
            title: item.title.clone(),
            url: item.url.clone(),
            snippet,
        });
    }

    Ok((answer, items))
}

async fn duckduckgo_search(query: &str, cutoff_date: Option<&str>) -> Result<WebSearchOutcome> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent("xiaoyan-desktop/0.3.3")
        .build()?;

    let dated_query = match cutoff_date {
        Some(cutoff_date) => format!("{query} before:{}", exclusive_end_date(cutoff_date)?),
        None => query.to_string(),
    };
    let resp = client
        .get("https://api.duckduckgo.com/")
        .query(&[
            ("q", dated_query.as_str()),
            ("format", "json"),
            ("no_html", "1"),
            ("skip_disambig", "1"),
        ])
        .send()
        .await?;

    if !resp.status().is_success() {
        return Ok(WebSearchOutcome {
            provider: "duckduckgo".into(),
            answer: None,
            note: Some(format!(
                "搜索请求失败（HTTP {}），请稍后重试。",
                resp.status().as_u16()
            )),
            items: Vec::new(),
        });
    }

    let data: DuckDuckGoResponse = resp.json().await?;

    let answer = if !data.AbstractText.is_empty() {
        let mut summary = data.AbstractText.clone();
        if !data.AbstractSource.is_empty() {
            summary.push_str(&format!("（来源：{}）", data.AbstractSource));
        }
        Some(summary)
    } else if !data.Answer.is_empty() {
        Some(data.Answer.clone())
    } else if !data.Heading.is_empty() {
        Some(data.Heading.clone())
    } else {
        None
    };

    let mut items: Vec<WebSearchItem> = Vec::new();

    if !data.AbstractURL.is_empty() {
        let title = if !data.Heading.is_empty() {
            data.Heading.clone()
        } else {
            query.to_string()
        };
        items.push(WebSearchItem {
            title,
            url: data.AbstractURL.clone(),
            snippet: data.AbstractText.clone(),
        });
    }

    for topic in &data.RelatedTopics {
        if topic.Text.is_empty() {
            continue;
        }
        items.push(WebSearchItem {
            title: ddg_title(&topic.Text),
            url: topic.FirstURL.clone(),
            snippet: topic.Text.clone(),
        });
    }

    for result in &data.Results {
        if result.Text.is_empty() {
            continue;
        }
        items.push(WebSearchItem {
            title: ddg_title(&result.Text),
            url: result.FirstURL.clone(),
            snippet: result.Text.clone(),
        });
    }

    Ok(WebSearchOutcome {
        provider: "duckduckgo".into(),
        answer,
        note: cutoff_date.map(|date| {
            format!("DuckDuckGo 回退检索已附加截止日期 {date}，日期精度受来源页面元数据影响。")
        }),
        items,
    })
}

/// DuckDuckGo 条目的标题往往是「标题 - 描述」，取破折号前一段并截断为短标题。
fn ddg_title(text: &str) -> String {
    let head = text.split(" - ").next().unwrap_or(text).trim();
    head.chars().take(80).collect()
}

#[cfg(test)]
mod tests {
    use super::{exclusive_end_date, normalize_cutoff_date};

    #[test]
    fn cutoff_date_is_normalized_and_converted_to_an_exclusive_end() {
        assert_eq!(
            normalize_cutoff_date(Some("2023-05-02")).unwrap(),
            Some("2023-05-02".to_string())
        );
        assert_eq!(exclusive_end_date("2023-05-02").unwrap(), "2023-05-03");
        assert!(normalize_cutoff_date(Some("2023-02-30")).is_err());
    }
}
