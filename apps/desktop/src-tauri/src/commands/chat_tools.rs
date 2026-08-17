use crate::ccf;
use crate::commands::arxiv::run_arxiv_search;
use crate::commands::experiment::create_experiment_core;
use crate::commands::knowledge_notes::create_note_core;
use crate::commands::misc::{run_planner_generation, run_survey_generation};
use crate::journal_partitions;
use crate::llm::{ToolCall, ToolDefinition};
use serde_json::json;
use sqlx::Row;
use tauri::Emitter;

// ── Tool definitions ──────────────────────────────────────────

fn search_knowledge_tool() -> ToolDefinition {
    ToolDefinition {
        name: "search_knowledge".into(),
        description: "在本地知识库中搜索相关笔记和论文。当需要查找用户已有的研究记录、笔记或导入的论文时使用此工具。搜索结果包含匹配的内容片段及来源。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索关键词或短语"
                },
                "top_k": {
                    "type": "integer",
                    "description": "返回结果数量，默认5"
                }
            },
            "required": ["query"]
        }),
    }
}

fn search_papers_tool() -> ToolDefinition {
    ToolDefinition {
        name: "search_papers".into(),
        description: "在本地论文库中搜索已导入的论文。当需要查找用户已上传或分析的论文时使用。支持按标题、作者、摘要关键词搜索。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索关键词，匹配论文标题、作者或摘要"
                },
                "limit": {
                    "type": "integer",
                    "description": "返回结果数量，默认10"
                }
            },
            "required": ["query"]
        }),
    }
}

fn create_note_tool() -> ToolDefinition {
    ToolDefinition {
        name: "create_note".into(),
        description: "在知识库中创建一条新的研究笔记。当用户明确要求记录想法、保存分析结果、创建备忘或整理知识点时使用。创建的笔记会自动出现在知识库页面。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "笔记标题，简洁明确"
                },
                "content": {
                    "type": "string",
                    "description": "笔记正文，支持Markdown格式"
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "标签列表，如[\"论文笔记\", \"深度学习\"]"
                },
                "research_interest_id": {
                    "type": "string",
                    "description": "关联的研究主题ID（可选）"
                }
            },
            "required": ["title", "content"]
        }),
    }
}

fn create_experiment_tool() -> ToolDefinition {
    ToolDefinition {
        name: "create_experiment".into(),
        description: "在实验记录中创建一条新的实验记录。当用户描述了一个实验方案、配置参数、实验结果或观察发现时使用。创建的实验会出现在实验记录页面。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "实验标题"
                },
                "config": {
                    "type": "object",
                    "description": "实验配置参数（JSON对象）"
                },
                "result": {
                    "type": "string",
                    "description": "实验结果描述"
                },
                "notes": {
                    "type": "string",
                    "description": "实验笔记和观察"
                }
            },
            "required": ["title"]
        }),
    }
}

fn generate_survey_tool() -> ToolDefinition {
    ToolDefinition {
        name: "generate_survey".into(),
        description: "为指定的研究问题生成一篇结构化的文献综述。综述会包含研究背景、发展脉络、主要方法、研究趋势、挑战和未来方向。生成结果会显示在综述页面，可进一步编辑和导出。注意：此任务耗时较长，完成后会通知用户。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "研究问题或综述主题"
                },
                "max_papers": {
                    "type": "integer",
                    "description": "检索论文数量上限，默认20"
                },
                "language": {
                    "type": "string",
                    "description": "输出语言：zh（中文）或en（英文），默认zh"
                }
            },
            "required": ["query"]
        }),
    }
}

fn search_experiments_tool() -> ToolDefinition {
    ToolDefinition {
        name: "search_experiments".into(),
        description: "搜索本地实验记录。当需要查找用户之前记录的实验方案、结果或观察时使用。"
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索关键词，匹配实验标题和内容"
                },
                "limit": {
                    "type": "integer",
                    "description": "返回结果数量，默认10"
                }
            },
            "required": ["query"]
        }),
    }
}

pub fn generate_plan_tool() -> ToolDefinition {
    ToolDefinition {
        name: "generate_plan".into(),
        description: "为指定的研究方向生成系统化的学习路线规划。规划包含前置知识、阶段划分、经典论文推荐、研究方向和工具框架。当用户想探索某个研究主题、需要学习路线指引时使用。注意：规划生成需要调用AI模型，预计需要30-60秒，完成后结果会出现在规划页面。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "description": "研究方向主题，如'大语言模型推理优化'"
                },
                "keywords": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "相关关键词列表，如['LLM推理', 'KV缓存', '投机采样']"
                }
            },
            "required": ["topic"]
        }),
    }
}

fn search_arxiv_tool() -> ToolDefinition {
    ToolDefinition {
        name: "search_arxiv".into(),
        description: "在arXiv上检索学术论文。支持按关键词、标题词、摘要词、作者、分类等多维过滤，可设置时间窗口和排序模式（相关性/质量）。当用户需要查找最新论文、了解研究前沿时使用。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "description": "检索主题或查询语句"
                },
                "days": {
                    "type": "integer",
                    "description": "时间窗口（天），默认14天，范围1-365"
                },
                "limit": {
                    "type": "integer",
                    "description": "返回结果数量，默认5，范围1-20"
                },
                "ranking_mode": {
                    "type": "string",
                    "description": "排序模式：relevance（相关性优先）或 quality（论文质量优先），默认relevance"
                }
            },
            "required": ["topic"]
        }),
    }
}

fn query_journal_tool() -> ToolDefinition {
    ToolDefinition {
        name: "query_journal".into(),
        description: "查询期刊或会议的分区信息。返回WoS/JCR/中科院分区、影响因子、CCF等级等。当用户询问某个期刊/会议的等级或分区时使用。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "期刊或会议名称，如'Nature Communications'或'CVPR'"
                }
            },
            "required": ["query"]
        }),
    }
}

fn lookup_ccf_tool() -> ToolDefinition {
    ToolDefinition {
        name: "lookup_ccf".into(),
        description: "查询CCF（中国计算机学会）推荐的会议和期刊目录。根据关键词查找相关的CCF-A/B/C级会议和期刊。当用户询问计算机领域某个会议或期刊的CCF等级时使用。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "会议或期刊关键词，如'软件工程'、'人工智能'、'数据库'"
                }
            },
            "required": ["query"]
        }),
    }
}

fn all_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        search_knowledge_tool(),
        search_papers_tool(),
        create_note_tool(),
        create_experiment_tool(),
        generate_survey_tool(),
        search_experiments_tool(),
        generate_plan_tool(),
        search_arxiv_tool(),
        query_journal_tool(),
        lookup_ccf_tool(),
    ]
}

fn tool_requires_external_access(name: &str) -> bool {
    matches!(
        name,
        "web_search" | "generate_survey" | "generate_plan" | "search_arxiv"
    )
}

fn tool_creates_persistent_asset(name: &str) -> bool {
    matches!(name, "create_note" | "create_experiment")
}

pub fn build_chat_tools(
    settings: &std::collections::HashMap<String, String>,
    allow_external_tools: bool,
    allow_persistent_tools: bool,
) -> Vec<ToolDefinition> {
    let mut tools: Vec<ToolDefinition> = vec![];

    let web_search_enabled = settings
        .get("web_search_enabled")
        .map(|v| v == "true")
        .unwrap_or(false);
    if allow_external_tools && web_search_enabled {
        tools.push(crate::llm::web_search_tool_definition());
    }

    tools.extend(all_tool_definitions());
    if !allow_external_tools {
        tools.retain(|tool| !tool_requires_external_access(&tool.name));
    }
    if !allow_persistent_tools {
        tools.retain(|tool| !tool_creates_persistent_asset(&tool.name));
    }
    tools
}

// ── Tool dispatcher ───────────────────────────────────────────

pub async fn dispatch_tool(
    app: &tauri::AppHandle,
    db: &sqlx::SqlitePool,
    settings: &std::collections::HashMap<String, String>,
    tool_call: &ToolCall,
    request_id: &str,
    allow_external_tools: bool,
    allow_persistent_tools: bool,
) -> Result<String, String> {
    if !allow_external_tools && tool_requires_external_access(&tool_call.name) {
        return Err("本次请求已启用离线边界，不能执行联网或额外模型工具。".to_string());
    }
    if !allow_persistent_tools && tool_creates_persistent_asset(&tool_call.name) {
        return Err("本次请求已关闭长期记忆，且用户没有明确要求创建持久化产物。".to_string());
    }

    match tool_call.name.as_str() {
        "search_knowledge" => dispatch_search_knowledge(db, tool_call).await,
        "search_papers" => dispatch_search_papers(db, tool_call).await,
        "create_note" => dispatch_create_note(app, db, settings, tool_call, request_id).await,
        "create_experiment" => dispatch_create_experiment(app, db, tool_call, request_id).await,
        "generate_survey" => {
            dispatch_generate_survey(app, db, settings, tool_call, request_id).await
        }
        "search_experiments" => dispatch_search_experiments(db, tool_call).await,
        "generate_plan" => dispatch_generate_plan(app, settings, tool_call, request_id).await,
        "search_arxiv" => dispatch_search_arxiv(settings, tool_call).await,
        "query_journal" => dispatch_query_journal(tool_call).await,
        "lookup_ccf" => dispatch_lookup_ccf(tool_call).await,
        _ => Err(format!("未知工具: {}", tool_call.name)),
    }
}

#[cfg(test)]
mod tests {
    use super::build_chat_tools;
    use std::collections::HashMap;

    fn tool_names(allow_external_tools: bool, allow_persistent_tools: bool) -> Vec<String> {
        let settings = HashMap::from([("web_search_enabled".to_string(), "true".to_string())]);
        build_chat_tools(&settings, allow_external_tools, allow_persistent_tools)
            .into_iter()
            .map(|tool| tool.name)
            .collect()
    }

    #[test]
    fn offline_boundary_removes_every_external_or_nested_model_tool() {
        let names = tool_names(false, true);

        for forbidden in [
            "web_search",
            "search_arxiv",
            "generate_survey",
            "generate_plan",
        ] {
            assert!(!names.iter().any(|name| name == forbidden));
        }
        for local in [
            "search_knowledge",
            "search_papers",
            "search_experiments",
            "query_journal",
            "lookup_ccf",
        ] {
            assert!(names.iter().any(|name| name == local));
        }
    }

    #[test]
    fn ordinary_request_keeps_configured_external_tools() {
        let names = tool_names(true, true);

        for expected in [
            "web_search",
            "search_arxiv",
            "generate_survey",
            "generate_plan",
        ] {
            assert!(names.iter().any(|name| name == expected));
        }
    }

    #[test]
    fn memory_boundary_removes_implicit_persistent_asset_tools() {
        let names = tool_names(true, false);

        assert!(!names.iter().any(|name| name == "create_note"));
        assert!(!names.iter().any(|name| name == "create_experiment"));
        assert!(names.iter().any(|name| name == "search_knowledge"));
    }
}

// ── Search dispatchers ────────────────────────────────────────

fn parse_str_arg(args: &str, key: &str) -> String {
    serde_json::from_str::<serde_json::Value>(args)
        .ok()
        .and_then(|v| v.get(key).and_then(|s| s.as_str().map(|s| s.to_string())))
        .unwrap_or_default()
}

fn parse_int_arg(args: &str, key: &str, default: i64) -> i64 {
    serde_json::from_str::<serde_json::Value>(args)
        .ok()
        .and_then(|v| v.get(key).and_then(|n| n.as_i64()))
        .unwrap_or(default)
}

async fn dispatch_search_knowledge(
    db: &sqlx::SqlitePool,
    tool_call: &ToolCall,
) -> Result<String, String> {
    let query = parse_str_arg(&tool_call.arguments, "query");
    let top_k = parse_int_arg(&tool_call.arguments, "top_k", 5);

    if query.is_empty() {
        return Ok("搜索关键词为空，无法执行搜索。".into());
    }

    let rows =
        crate::services::wiki::retrieval::hybrid_search(db, &query, None, top_k.max(1) as usize)
            .await
            .map_err(|e| format!("知识库搜索失败: {}", e))?;

    if rows.is_empty() {
        return Ok(format!("在知识库中未找到与「{}」相关的内容。", query));
    }

    let results: Vec<String> = rows
        .iter()
        .enumerate()
        .map(|(i, result)| {
            let snippet: String = result.content.chars().take(200).collect();
            format!("{}. {} — {}", i + 1, result.source, snippet)
        })
        .collect();

    Ok(format!(
        "知识库搜索结果（共{}条）：\n{}",
        results.len(),
        results.join("\n")
    ))
}

async fn dispatch_search_papers(
    db: &sqlx::SqlitePool,
    tool_call: &ToolCall,
) -> Result<String, String> {
    let query = parse_str_arg(&tool_call.arguments, "query");
    let limit = parse_int_arg(&tool_call.arguments, "limit", 10);

    if query.is_empty() {
        return Ok("搜索关键词为空，无法执行搜索。".into());
    }

    let like = format!("%{}%", query);
    let rows = sqlx::query(
        "SELECT id, title, authors, year, venue, abstract
         FROM papers
         WHERE title LIKE ? OR authors LIKE ? OR abstract LIKE ?
         ORDER BY year DESC, created_at DESC LIMIT ?",
    )
    .bind(&like)
    .bind(&like)
    .bind(&like)
    .bind(limit)
    .fetch_all(db)
    .await
    .map_err(|e| format!("论文库搜索失败: {}", e))?;

    if rows.is_empty() {
        return Ok(format!("在论文库中未找到与「{}」相关的论文。", query));
    }

    let results: Vec<String> = rows
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let title: String = r.get("title");
            let authors: Option<String> = r.get("authors");
            let year: Option<i32> = r.get("year");
            let venue: Option<String> = r.get("venue");
            format!(
                "{}. {} ({}) - {} {}",
                i + 1,
                title,
                authors.as_deref().unwrap_or("未知作者"),
                year.map(|y| y.to_string())
                    .unwrap_or_else(|| "未知年份".into()),
                venue.as_deref().unwrap_or("")
            )
        })
        .collect();

    Ok(format!(
        "论文库搜索结果（共{}条）：\n{}",
        results.len(),
        results.join("\n")
    ))
}

async fn dispatch_search_experiments(
    db: &sqlx::SqlitePool,
    tool_call: &ToolCall,
) -> Result<String, String> {
    let query = parse_str_arg(&tool_call.arguments, "query");
    let limit = parse_int_arg(&tool_call.arguments, "limit", 10);

    if query.is_empty() {
        return Ok("搜索关键词为空，无法执行搜索。".into());
    }

    let like = format!("%{}%", query);
    let rows = sqlx::query(
        "SELECT id, title, result, notes, created_at
         FROM experiment_records
         WHERE title LIKE ? OR result LIKE ? OR notes LIKE ?
         ORDER BY created_at DESC LIMIT ?",
    )
    .bind(&like)
    .bind(&like)
    .bind(&like)
    .bind(limit)
    .fetch_all(db)
    .await
    .map_err(|e| format!("实验记录搜索失败: {}", e))?;

    if rows.is_empty() {
        return Ok(format!("未找到与「{}」相关的实验记录。", query));
    }

    let results: Vec<String> = rows
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let title: String = r.get("title");
            let result_text: Option<String> = r.get("result");
            let snippet: String = result_text.unwrap_or_default().chars().take(150).collect();
            format!("{}. {} — {}", i + 1, title, snippet)
        })
        .collect();

    Ok(format!(
        "实验记录搜索结果（共{}条）：\n{}",
        results.len(),
        results.join("\n")
    ))
}

// ── Write dispatchers ────────────────────────────────────────

async fn dispatch_create_note(
    app: &tauri::AppHandle,
    db: &sqlx::SqlitePool,
    settings: &std::collections::HashMap<String, String>,
    tool_call: &ToolCall,
    request_id: &str,
) -> Result<String, String> {
    let title = parse_str_arg(&tool_call.arguments, "title");
    let content = parse_str_arg(&tool_call.arguments, "content");
    let tags: Option<Vec<String>> = serde_json::from_str::<serde_json::Value>(&tool_call.arguments)
        .ok()
        .and_then(|v| {
            v.get("tags").and_then(|t| {
                t.as_array().map(|arr| {
                    arr.iter()
                        .filter_map(|s| s.as_str().map(|s| s.to_string()))
                        .collect()
                })
            })
        });
    let research_interest_id: Option<String> =
        serde_json::from_str::<serde_json::Value>(&tool_call.arguments)
            .ok()
            .and_then(|v| {
                v.get("research_interest_id")
                    .and_then(|s| s.as_str().map(|s| s.to_string()))
            });

    if title.is_empty() || content.is_empty() {
        return Err("笔记标题和内容不能为空。".into());
    }

    match create_note_core(
        db,
        settings,
        title.clone(),
        content,
        tags,
        research_interest_id,
        "chat",
        None,
    )
    .await
    {
        Ok(result) => {
            let note_id = result["id"].as_str().unwrap_or("").to_string();
            let _ = app.emit(
                "chat:tool_result",
                json!({
                    "request_id": request_id,
                    "tool_name": tool_call.name,
                    "tool_id": tool_call.id,
                    "result": format!("已创建笔记：{}", title),
                    "result_id": note_id
                }),
            );
            let _ = app.emit(
                "knowledge:note_created",
                json!({ "id": note_id, "title": title }),
            );
            Ok(format!(
                "已成功创建笔记「{}」（ID: {}）。用户可以在知识库页面查看。",
                title, note_id
            ))
        }
        Err(e) => Err(format!("创建笔记失败: {}", e)),
    }
}

async fn dispatch_create_experiment(
    app: &tauri::AppHandle,
    db: &sqlx::SqlitePool,
    tool_call: &ToolCall,
    request_id: &str,
) -> Result<String, String> {
    let title = parse_str_arg(&tool_call.arguments, "title");
    let config: Option<serde_json::Value> =
        serde_json::from_str::<serde_json::Value>(&tool_call.arguments)
            .ok()
            .and_then(|v| v.get("config").cloned());
    let result_text: Option<String> =
        serde_json::from_str::<serde_json::Value>(&tool_call.arguments)
            .ok()
            .and_then(|v| {
                v.get("result")
                    .and_then(|s| s.as_str().map(|s| s.to_string()))
            });
    let notes: Option<String> = serde_json::from_str::<serde_json::Value>(&tool_call.arguments)
        .ok()
        .and_then(|v| {
            v.get("notes")
                .and_then(|s| s.as_str().map(|s| s.to_string()))
        });

    if title.is_empty() {
        return Err("实验标题不能为空。".into());
    }

    match create_experiment_core(db, title.clone(), config, result_text, notes, None).await {
        Ok(result) => {
            let exp_id = result["id"].as_str().unwrap_or("").to_string();
            let _ = app.emit(
                "chat:tool_result",
                json!({
                    "request_id": request_id,
                    "tool_name": tool_call.name,
                    "tool_id": tool_call.id,
                    "result": format!("已创建实验记录：{}", title),
                    "result_id": exp_id
                }),
            );
            let _ = app.emit(
                "experiment:created",
                json!({ "id": exp_id, "title": title }),
            );
            Ok(format!(
                "已成功创建实验记录「{}」（ID: {}）。用户可以在实验记录页面查看。",
                title, exp_id
            ))
        }
        Err(e) => Err(format!("创建实验记录失败: {}", e)),
    }
}

async fn dispatch_generate_survey(
    app: &tauri::AppHandle,
    db: &sqlx::SqlitePool,
    settings: &std::collections::HashMap<String, String>,
    tool_call: &ToolCall,
    request_id: &str,
) -> Result<String, String> {
    let query = parse_str_arg(&tool_call.arguments, "query");
    let max_papers: Option<i32> = serde_json::from_str::<serde_json::Value>(&tool_call.arguments)
        .ok()
        .and_then(|v| v.get("max_papers").and_then(|n| n.as_i64()))
        .map(|n| n as i32);
    let language: Option<String> = serde_json::from_str::<serde_json::Value>(&tool_call.arguments)
        .ok()
        .and_then(|v| {
            v.get("language")
                .and_then(|s| s.as_str().map(|s| s.to_string()))
        });

    if query.is_empty() {
        return Err("综述主题不能为空。".into());
    }

    let survey_request_id = uuid::Uuid::new_v4().to_string();
    let _ = app.emit(
        "chat:tool_result",
        json!({
            "request_id": request_id,
            "tool_name": tool_call.name,
            "tool_id": tool_call.id,
            "result": format!("已触发文献综述生成：{}", query),
            "result_id": survey_request_id
        }),
    );
    let _ = app.emit(
        "survey:generated",
        json!({ "request_id": survey_request_id, "query": query }),
    );

    let app_spawn = app.clone();
    let db_spawn = db.clone();
    let settings_spawn = settings.clone();
    let query_spawn = query.clone();
    tauri::async_runtime::spawn(async move {
        let _ = run_survey_generation(
            app_spawn,
            db_spawn,
            settings_spawn,
            query_spawn,
            max_papers,
            None,
            None,
            None,
            None,
            None,
            language,
            None,
            Some(survey_request_id),
        )
        .await;
    });

    Ok(format!(
        "已开始生成文献综述「{}」，完成后会出现在综述页面。由于综述生成需要检索和分析多篇论文，预计需要1-2分钟，请稍后在综述页面查看完整结果。",
        query
    ))
}

// ── generate_plan dispatcher ──────────────────────────────────

async fn dispatch_generate_plan(
    app: &tauri::AppHandle,
    settings: &std::collections::HashMap<String, String>,
    tool_call: &ToolCall,
    request_id: &str,
) -> Result<String, String> {
    let topic = parse_str_arg(&tool_call.arguments, "topic");
    let keywords: Vec<String> = serde_json::from_str::<serde_json::Value>(&tool_call.arguments)
        .ok()
        .and_then(|v| {
            v.get("keywords").and_then(|arr| {
                arr.as_array().map(|a| {
                    a.iter()
                        .filter_map(|s| s.as_str().map(|s| s.to_string()))
                        .collect()
                })
            })
        })
        .unwrap_or_default();

    if topic.is_empty() {
        return Err("研究方向主题不能为空。".into());
    }

    let plan_id = uuid::Uuid::new_v4().to_string();
    let _ = app.emit(
        "chat:tool_result",
        json!({
            "request_id": request_id,
            "tool_name": tool_call.name,
            "tool_id": tool_call.id,
            "result": format!("已触发学习路线规划：{}", topic),
            "result_id": plan_id
        }),
    );
    let _ = app.emit(
        "interest:plan_triggered",
        json!({ "request_id": plan_id, "topic": topic }),
    );

    let app_spawn = app.clone();
    let settings_spawn = settings.clone();
    let topic_spawn = topic.clone();
    let keywords_spawn = keywords;
    tauri::async_runtime::spawn(async move {
        let _ =
            run_planner_generation(app_spawn, settings_spawn, topic_spawn, keywords_spawn).await;
    });

    Ok(format!(
        "已开始生成研究方向「{}」的学习路线规划，预计需要30-60秒。规划包含前置知识、阶段划分、经典论文推荐和开放问题。完成后请查看规划页面获取完整计划。",
        topic
    ))
}

// ── search_arxiv dispatcher ───────────────────────────────────

async fn dispatch_search_arxiv(
    settings: &std::collections::HashMap<String, String>,
    tool_call: &ToolCall,
) -> Result<String, String> {
    let topic = parse_str_arg(&tool_call.arguments, "topic");
    let days: Option<i64> = serde_json::from_str::<serde_json::Value>(&tool_call.arguments)
        .ok()
        .and_then(|v| v.get("days").and_then(|n| n.as_i64()));
    let limit: Option<i32> = serde_json::from_str::<serde_json::Value>(&tool_call.arguments)
        .ok()
        .and_then(|v| v.get("limit").and_then(|n| n.as_i64()))
        .map(|n| n as i32);
    let ranking_mode: Option<String> =
        serde_json::from_str::<serde_json::Value>(&tool_call.arguments)
            .ok()
            .and_then(|v| {
                v.get("ranking_mode")
                    .and_then(|s| s.as_str().map(|s| s.to_string()))
            });

    if topic.is_empty() {
        return Err("检索主题不能为空。".into());
    }

    let request = crate::commands::arxiv::build_recent_hint_request(&topic, &[]);

    match run_arxiv_search(settings, request, days, limit, ranking_mode).await {
        Ok(response) => {
            let papers: Vec<String> = response
                .get("papers")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .enumerate()
                        .map(|(i, p)| {
                            let title = p
                                .get("title")
                                .and_then(|s| s.as_str())
                                .unwrap_or("未知标题");
                            let authors = p
                                .get("authors")
                                .and_then(|a| a.as_array())
                                .map(|a| {
                                    a.iter()
                                        .filter_map(|n| n.as_str())
                                        .collect::<Vec<_>>()
                                        .join(", ")
                                })
                                .unwrap_or_else(|| "未知作者".into());
                            format!("{}. {} - {}", i + 1, title, authors)
                        })
                        .collect()
                })
                .unwrap_or_default();

            if papers.is_empty() {
                let summary = response
                    .get("overall_summary")
                    .and_then(|s| s.as_str())
                    .unwrap_or("当前时间窗口内未找到匹配论文。");
                Ok(format!("arXiv检索完成：{}", summary))
            } else {
                let summary = response
                    .get("overall_summary")
                    .and_then(|s| s.as_str())
                    .unwrap_or("");
                Ok(format!(
                    "arXiv检索结果（{}，共{}条）：\n{}\n\n{}",
                    response
                        .get("ranking_note")
                        .and_then(|s| s.as_str())
                        .unwrap_or(""),
                    papers.len(),
                    papers.join("\n"),
                    summary
                ))
            }
        }
        Err(e) => Err(format!("arXiv检索失败: {}", e)),
    }
}

// ── query_journal dispatcher ──────────────────────────────────

async fn dispatch_query_journal(tool_call: &ToolCall) -> Result<String, String> {
    let query = parse_str_arg(&tool_call.arguments, "query");

    if query.is_empty() {
        return Err("期刊查询词不能为空。".into());
    }

    let matches = journal_partitions::lookup(query.trim(), 8);
    if matches.is_empty() {
        return Ok(format!("未找到「{}」相关的期刊或会议信息。", query));
    }

    let results: Vec<String> = matches
        .iter()
        .map(|m| {
            let cas = if m.cas_top {
                format!("{}（Top）", m.cas_quartile)
            } else {
                m.cas_quartile.clone()
            };
            format!(
                "{} — JCR: {}, 中科院: {}, IF: {}, 索引: {}",
                m.title,
                m.jcr_quartile,
                cas,
                m.jif,
                m.indexes.join(", ")
            )
        })
        .collect();

    Ok(format!(
        "期刊查询结果（「{}」）：\n{}",
        query,
        results.join("\n")
    ))
}

// ── lookup_ccf dispatcher ─────────────────────────────────────

async fn dispatch_lookup_ccf(tool_call: &ToolCall) -> Result<String, String> {
    let query = parse_str_arg(&tool_call.arguments, "query");

    if query.is_empty() {
        return Err("CCF查询词不能为空。".into());
    }

    let matches = ccf::lookup(query.trim(), 10);
    if matches.is_empty() {
        return Ok(format!("未找到「{}」相关的CCF推荐会议或期刊。", query));
    }

    let results: Vec<String> = matches
        .iter()
        .map(|m| {
            let rating = if m.rating.is_empty() {
                "其他"
            } else {
                &m.rating
            };
            format!(
                "{} [{}] {} — {} ({})",
                m.label, rating, m.full_name, m.area, m.kind
            )
        })
        .collect();

    Ok(format!(
        "CCF推荐目录查询结果（「{}」）：\n{}",
        query,
        results.join("\n")
    ))
}
