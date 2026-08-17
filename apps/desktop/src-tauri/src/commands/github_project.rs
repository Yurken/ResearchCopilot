use crate::llm::{resolve_model, resolve_temperature, LlmClient, LlmMessage};
use crate::state::AppState;
use crate::web_search::web_search_structured;
use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use tauri::State;

const GITHUB_API_URL: &str = "https://api.github.com/search/repositories";
const GITHUB_README_URL: &str = "https://api.github.com/repos";
const GITHUB_USER_AGENT: &str = "xiaoyan-desktop/0.4.6";

/// 轻量领域知识映射：把中文/英文用户需求扩展成 GitHub 上更可能召回优质项目的英文查询词。
/// 这是兜底知识库；LLM 会根据用户输入做动态扩展。
static DOMAIN_KNOWLEDGE: &[(&str, &[&str])] = &[
    (
        "english learning",
        &[
            "spaced repetition flashcards",
            "SRS Anki alternative",
            "language learning app",
            "vocabulary builder",
            "sentence mining",
            "subtitle language learning",
            "EPUB reader dictionary",
            "pronunciation trainer",
        ],
    ),
    (
        "machine learning",
        &[
            "deep learning framework",
            "neural network library",
            "transformer model",
            "LLM inference engine",
            "MLOps pipeline",
        ],
    ),
    (
        "data visualization",
        &[
            "interactive chart library",
            "dashboard builder",
            "plotting toolkit",
            "graph visualization",
        ],
    ),
];

/// 安全相关的高风险关键词黑名单。命中后增加风险分，但不直接删除，避免误杀。
static RISK_KEYWORDS: &[(&str, f32)] = &[
    ("democracy", 0.5),
    ("revolution", 0.6),
    ("falun", 0.9),
    ("protest", 0.5),
    ("extremism", 0.8),
    ("terrorism", 0.9),
    ("porn", 0.9),
    ("pornography", 0.9),
    ("nsfw", 0.8),
    ("violence", 0.7),
    ("hate speech", 0.8),
    ("racism", 0.8),
    ("discrimination", 0.6),
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GithubProjectSearchRequest {
    pub query: String,
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct GithubApiRepo {
    full_name: String,
    owner: GithubOwner,
    name: String,
    html_url: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    stargazers_count: i64,
    #[serde(default)]
    forks_count: i64,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    license: Option<GithubLicense>,
    #[serde(default)]
    topics: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct GithubOwner {
    login: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct GithubLicense {
    spdx_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct GithubSearchResponse {
    #[serde(default)]
    items: Vec<GithubApiRepo>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct GithubReadmeResponse {
    #[serde(default)]
    content: String,
    #[serde(default)]
    encoding: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GithubRepo {
    pub full_name: String,
    pub owner: String,
    pub name: String,
    pub html_url: String,
    pub description: String,
    pub language: String,
    pub stargazers_count: i64,
    pub forks_count: i64,
    pub updated_at: String,
    pub license: String,
    pub topics: Vec<String>,
    pub readme_snippet: String,
    pub safety_score: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GithubProjectSearchResponse {
    pub query: String,
    pub provider: String,
    pub candidate_count: usize,
    pub llm_used: bool,
    pub overall_summary: String,
    pub ranking_note: String,
    pub repos: Vec<GithubRepo>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct LlmRankingResponse {
    overall_summary: Option<String>,
    ranking_note: Option<String>,
    repos: Vec<LlmRankingRepo>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct LlmRankingRepo {
    full_name: String,
    #[allow(dead_code)]
    score: Option<i32>,
    #[allow(dead_code)]
    reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct SafetyCheckResponse {
    full_name: String,
    safe: bool,
    #[allow(dead_code)]
    category: String,
    risk_score: f32,
    #[allow(dead_code)]
    reason: String,
}

#[tauri::command]
pub async fn github_project_search(
    state: State<'_, AppState>,
    request: GithubProjectSearchRequest,
) -> Result<serde_json::Value, String> {
    let query = clean_whitespace(&request.query);
    if query.is_empty() {
        return Err("请输入研究主题或关键词。".into());
    }

    let limit = request.limit.unwrap_or(8).clamp(1, 12) as usize;
    let settings = state.settings.read().await.clone();

    // 1. Query Rewrite：把用户需求扩展成多个 GitHub 搜索查询。
    let search_queries = expand_search_queries(&settings, &query)
        .await
        .unwrap_or_else(|error| {
            eprintln!("扩展 GitHub 搜索查询失败：{}", error);
            vec![query.clone()]
        });

    // 2. 多源召回：GitHub Search API + awesome 仓库搜索 + 联网搜索降级。
    let (mut repos, provider) =
        match fetch_candidates_multi_source(&settings, &search_queries, &query, limit * 3).await {
            Ok(items) => (items, "github_api".to_string()),
            Err(github_err) => {
                let web_queries: Vec<String> = search_queries
                    .iter()
                    .map(|q| format!("{} site:github.com", q))
                    .collect();
                match fetch_repos_via_web_search_multi(&settings, &web_queries, limit * 3).await {
                    Ok(items) => (items, "web_search".to_string()),
                    Err(_) => return Err(format_github_error(&github_err)),
                }
            }
        };

    if repos.is_empty() {
        let empty = GithubProjectSearchResponse {
            query: query.clone(),
            provider,
            candidate_count: 0,
            llm_used: false,
            overall_summary: "未检索到相关 GitHub 项目，建议换一组关键词再试。".into(),
            ranking_note: "无候选项目。".into(),
            repos: Vec::new(),
        };
        return Ok(json!(empty));
    }

    // 3. 去重 + 获取 README + 安全分类。
    let mut seen = HashSet::new();
    repos.retain(|repo| seen.insert(repo.full_name.clone()));

    // 4. 安全过滤：LLM 安全分类器 + 关键词风险分。
    repos = filter_unsafe_repos(&settings, repos.clone(), &query)
        .await
        .unwrap_or(repos);

    if repos.is_empty() {
        let empty = GithubProjectSearchResponse {
            query: query.clone(),
            provider,
            candidate_count: 0,
            llm_used: true,
            overall_summary: "未通过内容安全审核的项目均被过滤，建议更换关键词后重试。".into(),
            ranking_note: "已启用安全过滤。".into(),
            repos: Vec::new(),
        };
        return Ok(json!(empty));
    }

    // 5. 按 Star 数做初排，让 LLM rerank 的候选质量更高。
    repos.sort_by(|a, b| b.stargazers_count.cmp(&a.stargazers_count));

    // 6. LLM Re-ranking：基于 README 语义、用户意图、活跃度综合排序。
    let (llm_used, overall_summary, ranking_note, ranked) =
        match rerank_with_llm(&settings, &query, limit, &repos).await {
            Ok(Some((summary, note, items))) => (true, summary, note, items),
            _ => {
                let note = "已按 Star 数、README 相关度和安全评分做启发式排序。".to_string();
                let summary = format!(
                    "从 {} 个候选项目中筛选出 {} 个，建议优先查看 Star 较高、最近仍在维护的项目。",
                    repos.len(),
                    repos.len().min(limit)
                );
                let heuristic = repos.iter().take(limit).cloned().collect();
                (false, summary, note, heuristic)
            }
        };

    let response = GithubProjectSearchResponse {
        query: query.clone(),
        provider,
        candidate_count: repos.len(),
        llm_used,
        overall_summary,
        ranking_note,
        repos: ranked,
    };

    Ok(json!(response))
}

/// 多源召回：GitHub Search API + awesome 仓库搜索。
async fn fetch_candidates_multi_source(
    settings: &HashMap<String, String>,
    queries: &[String],
    original_query: &str,
    per_query_limit: usize,
) -> anyhow::Result<Vec<GithubRepo>> {
    let mut all_repos = Vec::new();
    let mut seen = HashSet::new();

    // 源 1：基于扩展查询词的 GitHub Search API。
    for query in queries {
        let result = fetch_github_search(settings, query, per_query_limit).await;
        if let Ok(items) = result {
            for repo in items {
                if seen.insert(repo.full_name.clone()) {
                    all_repos.push(repo);
                }
            }
        }
    }

    // 源 2：awesome 仓库召回。awesome-language-learning 这类目录是高质量人工知识图谱。
    let awesome_query = format!("awesome {}", original_query);
    if let Ok(items) = fetch_github_search(settings, &awesome_query, per_query_limit).await {
        for repo in items {
            if seen.insert(repo.full_name.clone()) {
                all_repos.push(repo);
            }
        }
    }

    // 源 3：领域知识兜底扩展（不依赖 LLM，保证离线也能召回一些相关项目）。
    let fallback_queries = domain_fallback_queries(original_query);
    for query in fallback_queries {
        if let Ok(items) = fetch_github_search(settings, &query, per_query_limit / 2).await {
            for repo in items {
                if seen.insert(repo.full_name.clone()) {
                    all_repos.push(repo);
                }
            }
        }
    }

    if all_repos.is_empty() {
        return Err(anyhow!("GitHub API 未返回任何候选项目。"));
    }

    Ok(all_repos)
}

async fn fetch_github_search(
    settings: &HashMap<String, String>,
    query: &str,
    limit: usize,
) -> anyhow::Result<Vec<GithubRepo>> {
    let client = reqwest::Client::new();
    let token = settings
        .get("github_api_key")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());

    let mut builder = client
        .get(GITHUB_API_URL)
        .header("User-Agent", GITHUB_USER_AGENT)
        .query(&[
            ("q", query.to_string()),
            ("sort", "stars".to_string()),
            ("order", "desc".to_string()),
            ("per_page", limit.max(10).min(50).to_string()),
        ]);

    if let Some(t) = token {
        builder = builder.header("Authorization", format!("Bearer {}", t));
    }

    let resp = builder.send().await.context("请求 GitHub API 失败")?;
    let status = resp.status();

    if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        return Err(anyhow!(
            "GitHub API 触发速率限制。可在「设置 → 外部学术服务」配置 GitHub Personal Access Token。"
        ));
    }

    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow!("GitHub API 返回错误 {}: {}", status.as_u16(), body));
    }

    let payload: GithubSearchResponse = resp.json().await.context("解析 GitHub 响应失败")?;

    let mut repos = Vec::new();
    for api_repo in payload.items {
        let full_name = api_repo.full_name.clone();
        let mut repo = map_github_repo(api_repo);
        repo.readme_snippet = fetch_readme_snippet(settings, &full_name)
            .await
            .unwrap_or_default();
        repos.push(repo);
    }

    Ok(repos)
}

async fn fetch_repos_via_web_search_multi(
    settings: &HashMap<String, String>,
    queries: &[String],
    _limit: usize,
) -> anyhow::Result<Vec<GithubRepo>> {
    let mut all_repos = Vec::new();
    let mut seen = HashSet::new();

    for query in queries {
        let outcome = web_search_structured(query, settings)
            .await
            .map_err(|error| anyhow!("联网搜索失败：{}", error))?;

        for result in outcome.items {
            let url = result.url;
            if !url.contains("github.com/") {
                continue;
            }
            let Some(full_name) = extract_github_full_name(&url) else {
                continue;
            };
            if !seen.insert(full_name.clone()) {
                continue;
            }
            let readme = fetch_readme_snippet(settings, &full_name)
                .await
                .unwrap_or_default();
            all_repos.push(GithubRepo {
                full_name: full_name.clone(),
                owner: full_name.split('/').next().unwrap_or("").to_string(),
                name: full_name.split('/').nth(1).unwrap_or("").to_string(),
                html_url: url,
                description: result.title,
                language: String::new(),
                stargazers_count: 0,
                forks_count: 0,
                updated_at: String::new(),
                license: String::new(),
                topics: Vec::new(),
                readme_snippet: readme,
                safety_score: 0.0,
            });
        }
    }

    Ok(all_repos)
}

async fn fetch_readme_snippet(
    settings: &HashMap<String, String>,
    full_name: &str,
) -> anyhow::Result<String> {
    let client = reqwest::Client::new();
    let token = settings
        .get("github_api_key")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());

    let url = format!("{}/{}/readme", GITHUB_README_URL, full_name);
    let mut builder = client
        .get(&url)
        .header("User-Agent", GITHUB_USER_AGENT)
        .header("Accept", "application/vnd.github+json");

    if let Some(t) = token {
        builder = builder.header("Authorization", format!("Bearer {}", t));
    }

    let resp = builder.send().await.context("请求 README 失败")?;
    if !resp.status().is_success() {
        return Ok(String::new());
    }

    let payload: GithubReadmeResponse = resp.json().await.context("解析 README 失败")?;
    let decoded = if payload.encoding.eq_ignore_ascii_case("base64") {
        base64_decode(&payload.content)
    } else {
        payload.content
    };

    Ok(truncate_text(&clean_markdown(&decoded), 1200))
}

/// 基于内置领域知识库，生成兜底扩展查询。
fn domain_fallback_queries(query: &str) -> Vec<String> {
    let lower = query.to_lowercase();
    let mut result = Vec::new();

    for (domain, expansions) in DOMAIN_KNOWLEDGE {
        if lower.contains(domain) || domain.contains(&lower) {
            result.extend(expansions.iter().map(|s| s.to_string()));
        }
    }

    result
}

/// 用 LLM 做 Query Rewrite + 领域扩展。
async fn expand_search_queries(
    settings: &HashMap<String, String>,
    query: &str,
) -> anyhow::Result<Vec<String>> {
    let client = match LlmClient::from_settings(settings) {
        Ok(client) => client,
        Err(_) => return Ok(vec![query.to_string()]),
    };

    let model = resolve_model(
        settings,
        &["multi_agent_literature_scout_model", "copilot_simple_model"],
    );
    let temperature =
        resolve_temperature(settings, "multi_agent_literature_scout_temperature", 0.4);

    let prompt = format!(
        "你是 GitHub 开源项目搜索专家。用户用自然语言描述需求，请你生成 3-5 个适合 GitHub Search API 的英文搜索查询。\n\n\
         规则：\n\
         1. 不要直接翻译用户输入，要理解其真实意图，生成更可能搜到优质开源项目的查询词。\n\
         2. 每个查询应聚焦不同角度：具体工具类型、实现技术、应用场景、热门替代方案、awesome 列表等。\n\
         3. 例如用户说「英语学习」，你应该想到 flashcards、spaced repetition、Anki alternative、vocabulary builder、language learning app 等。\n\
         4. 只输出英文查询词，返回纯 JSON 数组，不要任何解释。\n\n\
         用户输入：{query}\n\n\
         输出格式：[\"query1\", \"query2\", \"query3\"]"
    );

    let messages = vec![
        LlmMessage::system("你是 GitHub 开源项目搜索专家，输出必须严格遵守 JSON 数组格式。"),
        LlmMessage::user(prompt),
    ];

    let raw = client
        .chat(&messages, model.as_deref(), temperature)
        .await?;
    let clean = crate::commands::papers::extract_json_pub(&raw);
    let parsed: Vec<String> = match serde_json::from_str(&clean) {
        Ok(v) => v,
        Err(_) => return Ok(vec![query.to_string()]),
    };

    let mut queries: Vec<String> = parsed
        .into_iter()
        .map(|s| clean_whitespace(&s))
        .filter(|s| !s.is_empty())
        .take(5)
        .collect();

    let original = clean_whitespace(query);
    if !original.is_empty() && !queries.iter().any(|q| q.eq_ignore_ascii_case(&original)) {
        queries.push(original);
    }

    if queries.is_empty() {
        queries.push(query.to_string());
    }

    Ok(queries)
}

/// 安全过滤：LLM 分类器 + 关键词风险分。
async fn filter_unsafe_repos(
    settings: &HashMap<String, String>,
    mut repos: Vec<GithubRepo>,
    query: &str,
) -> anyhow::Result<Vec<GithubRepo>> {
    // 第一层：关键词风险分。
    for repo in &mut repos {
        let text = format!(
            "{} {} {} {}",
            repo.full_name,
            repo.description,
            repo.readme_snippet,
            repo.topics.join(" ")
        )
        .to_lowercase();
        let mut risk = 0.0_f32;
        for (keyword, weight) in RISK_KEYWORDS {
            if text.contains(keyword) {
                risk += weight;
            }
        }
        repo.safety_score = risk.clamp(0.0, 1.0);
    }

    // 第二层：LLM 安全分类器（采样前 30 个做精细判断）。
    let llm_results = classify_repos_safety(settings, &repos, query)
        .await
        .unwrap_or_default();

    let mut safe_repos = Vec::new();
    for mut repo in repos {
        if let Some(classification) = llm_results.get(&repo.full_name) {
            // LLM 认为不安全，或风险分过高，直接过滤。
            if !classification.safe || classification.risk_score >= 0.6 {
                continue;
            }
            repo.safety_score = classification.risk_score;
        }

        // 关键词风险分过高也过滤。
        if repo.safety_score >= 0.7 {
            continue;
        }

        safe_repos.push(repo);
    }

    Ok(safe_repos)
}

async fn classify_repos_safety(
    settings: &HashMap<String, String>,
    repos: &[GithubRepo],
    query: &str,
) -> anyhow::Result<HashMap<String, SafetyCheckResponse>> {
    let client = match LlmClient::from_settings(settings) {
        Ok(client) => client,
        Err(_) => return Ok(HashMap::new()),
    };

    let model = resolve_model(
        settings,
        &["copilot_simple_model", "multi_agent_literature_scout_model"],
    );
    let temperature = resolve_temperature(settings, "copilot_simple_temperature", 0.1);

    // 为了控制 token，只检测前 30 个候选。
    let candidates: Vec<&GithubRepo> = repos.iter().take(30).collect();
    let payload = candidates
        .iter()
        .map(|repo| {
            json!({
                "full_name": repo.full_name,
                "description": repo.description,
                "readme_snippet": repo.readme_snippet,
                "topics": repo.topics,
            })
        })
        .collect::<Vec<_>>();

    let prompt = format!(
        "你是内容安全审核助手。用户搜索主题是「{query}」。请判断以下 GitHub 仓库是否适合作为技术/学习工具推荐。\n\n\
         分类标准：\n\
         - 安全（safe=true）：编程工具、学习工具、开源软件、库、框架、数据集、技术教程等。\n\
         - 不安全（safe=false）：政治宣传、宗教极端、色情、暴力、恐怖主义、仇恨言论、恶意软件、社会运动、抗议组织等。\n\n\
         输出 JSON 数组，每个元素：\n\
         {{\n\
           \"full_name\": \"owner/repo\",\n\
           \"safe\": true/false,\n\
           \"category\": \"Programming\" | \"AI/ML\" | \"Politics\" | \"Religion\" | \"Pornography\" | \"Violence\" | \"Extremism\" | \"Malware\" | \"Other\",\n\
           \"risk_score\": 0.0-1.0,\n\
           \"reason\": \"简短原因\"\n\
         }}\n\n\
         候选仓库：\n{payload}",
        payload = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "[]".to_string())
    );

    let messages = vec![
        LlmMessage::system("你是内容安全审核助手，输出必须严格遵守 JSON 格式。"),
        LlmMessage::user(prompt),
    ];

    let raw = client
        .chat(&messages, model.as_deref(), temperature)
        .await?;
    let clean = crate::commands::papers::extract_json_pub(&raw);
    let parsed: Vec<SafetyCheckResponse> = match serde_json::from_str(&clean) {
        Ok(v) => v,
        Err(_) => return Ok(HashMap::new()),
    };

    let mut result = HashMap::new();
    for item in parsed {
        result.insert(item.full_name.clone(), item);
    }

    Ok(result)
}

async fn rerank_with_llm(
    settings: &HashMap<String, String>,
    query: &str,
    limit: usize,
    repos: &[GithubRepo],
) -> anyhow::Result<Option<(String, String, Vec<GithubRepo>)>> {
    let client = match LlmClient::from_settings(settings) {
        Ok(client) => client,
        Err(_) => return Ok(None),
    };

    let model = resolve_model(
        settings,
        &["multi_agent_literature_scout_model", "copilot_simple_model"],
    );
    let temperature =
        resolve_temperature(settings, "multi_agent_literature_scout_temperature", 0.2);

    let payload = repos
        .iter()
        .take(20)
        .map(|repo| {
            json!({
                "full_name": repo.full_name,
                "description": repo.description,
                "readme_snippet": repo.readme_snippet,
                "language": repo.language,
                "stars": repo.stargazers_count,
                "forks": repo.forks_count,
                "topics": repo.topics,
                "updated_at": repo.updated_at,
            })
        })
        .collect::<Vec<_>>();

    let prompt = format!(
        "你是小妍的开源项目检索助手。请基于候选 GitHub 项目，输出最终推荐结果。\n\n\
         用户研究主题：{query}\n\
         返回数量：{limit}\n\n\
         候选项目（JSON）：\n{payload}\n\n\
         排序要求：\n\
         1. 优先推荐与用户真实意图相关的项目，而不是只匹配字面关键词。\n\
         2. 综合考虑：README 语义、功能匹配度、社区活跃度（Star/Fork）、最近维护情况。\n\
         3. 只返回 JSON，不要额外解释，格式必须是：\n\
         {{\n\
           \"overall_summary\": \"...\",\n\
           \"ranking_note\": \"...\",\n\
           \"repos\": [\n\
             {{\n\
               \"full_name\": \"owner/repo\",\n\
               \"score\": 0-100 整数,\n\
               \"reason\": \"推荐理由\"\n\
             }}\n\
           ]\n\
         }}",
        payload = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "[]".to_string())
    );

    let messages = vec![
        LlmMessage::system("你是开源项目检索助手，输出必须严格遵守 JSON 格式。"),
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

    let by_name: HashMap<String, GithubRepo> = repos
        .iter()
        .map(|repo| (repo.full_name.clone(), repo.clone()))
        .collect();

    let mut selected = Vec::new();
    let mut seen = HashSet::new();
    for item in parsed.repos {
        if selected.len() >= limit {
            break;
        }
        let Some(repo) = by_name.get(&item.full_name) else {
            continue;
        };
        if !seen.insert(repo.full_name.clone()) {
            continue;
        }
        selected.push(GithubRepo {
            full_name: repo.full_name.clone(),
            owner: repo.owner.clone(),
            name: repo.name.clone(),
            html_url: repo.html_url.clone(),
            description: repo.description.clone(),
            language: repo.language.clone(),
            stargazers_count: repo.stargazers_count,
            forks_count: repo.forks_count,
            updated_at: repo.updated_at.clone(),
            license: repo.license.clone(),
            topics: repo.topics.clone(),
            readme_snippet: repo.readme_snippet.clone(),
            safety_score: repo.safety_score,
        });
    }

    if selected.is_empty() {
        return Ok(None);
    }

    Ok(Some((
        parsed
            .overall_summary
            .unwrap_or_else(|| "已根据项目相关度和活跃度完成推荐。".to_string()),
        parsed
            .ranking_note
            .unwrap_or_else(|| "由模型综合匹配度与维护活跃度排序。".to_string()),
        selected,
    )))
}

fn map_github_repo(repo: GithubApiRepo) -> GithubRepo {
    GithubRepo {
        full_name: repo.full_name,
        owner: repo.owner.login,
        name: repo.name,
        html_url: repo.html_url,
        description: repo.description.unwrap_or_default(),
        language: repo.language.unwrap_or_default(),
        stargazers_count: repo.stargazers_count,
        forks_count: repo.forks_count,
        updated_at: repo.updated_at,
        license: repo.license.and_then(|l| l.spdx_id).unwrap_or_default(),
        topics: repo.topics,
        readme_snippet: String::new(),
        safety_score: 0.0,
    }
}

fn extract_github_full_name(url: &str) -> Option<String> {
    let trimmed = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("github.com/");
    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.len() >= 2 {
        Some(format!("{}/{}", parts[0], parts[1]))
    } else {
        None
    }
}

fn clean_whitespace(input: &str) -> String {
    input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn clean_markdown(input: &str) -> String {
    input
        .replace("#", " ")
        .replace("*", " ")
        .replace("`", " ")
        .replace("[", " ")
        .replace("]", " ")
        .replace("(", " ")
        .replace(")", " ")
        .replace("|", " ")
}

fn truncate_text(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

fn base64_decode(input: &str) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let cleaned: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    STANDARD
        .decode(cleaned)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_default()
}

fn format_github_error(error: &anyhow::Error) -> String {
    let msg = error.to_string();
    if msg.contains("速率限制") {
        return msg;
    }
    format!("检索失败：{}", msg)
}

// ── Search history persistence ─────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GithubProjectSaveHistoryRequest {
    pub query: String,
    pub result_json: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GithubProjectSearchHistoryEntry {
    pub id: String,
    pub query: String,
    pub result_json: String,
    pub created_at: String,
}

#[tauri::command]
pub async fn github_project_save_search_history(
    state: State<'_, AppState>,
    request: GithubProjectSaveHistoryRequest,
) -> Result<GithubProjectSearchHistoryEntry, String> {
    let trimmed_query = clean_whitespace(&request.query);
    if trimmed_query.is_empty() {
        return Err("搜索词为空，无法保存历史。".into());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    let result_json = if request.result_json.trim().is_empty() {
        "{}".into()
    } else {
        request.result_json
    };

    sqlx::query(
        "INSERT INTO github_project_search_history (id, query, result_json, created_at)
         VALUES (?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&trimmed_query)
    .bind(&result_json)
    .bind(&created_at)
    .execute(&state.db)
    .await
    .map_err(|e| format!("保存 GitHub 搜索历史失败：{e}"))?;

    Ok(GithubProjectSearchHistoryEntry {
        id,
        query: trimmed_query,
        result_json,
        created_at,
    })
}

#[tauri::command]
pub async fn github_project_get_search_history(
    state: State<'_, AppState>,
    limit: Option<i32>,
) -> Result<Vec<GithubProjectSearchHistoryEntry>, String> {
    let limit = limit.unwrap_or(20).clamp(1, 100);

    let rows = sqlx::query(
        "SELECT id, query, result_json, created_at
         FROM github_project_search_history
         ORDER BY created_at DESC
         LIMIT ?",
    )
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .map_err(|e| format!("读取 GitHub 搜索历史失败：{e}"))?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        items.push(GithubProjectSearchHistoryEntry {
            id: row.get("id"),
            query: row.get("query"),
            result_json: row.get("result_json"),
            created_at: row.get("created_at"),
        });
    }

    Ok(items)
}

#[tauri::command]
pub async fn github_project_delete_search_history(
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    let result = sqlx::query("DELETE FROM github_project_search_history WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| format!("删除 GitHub 搜索历史失败：{e}"))?;

    Ok(result.rows_affected() > 0)
}
