use crate::assistant_prompts::specialist_system;
use crate::ccf::match_venue;
use crate::commands::paper_search::search_survey_candidates;
use crate::commands::survey_support::{
    apply_survey_preferences, build_formatted_citations, build_papers_by_year_text,
    build_papers_text, build_survey_markdown, build_timeline_text, insert_survey,
    is_usable_survey_report, survey_planner_system, survey_timeline_system, survey_writer_system,
    try_acquire_survey_run_lock, SURVEY_PLANNER_TPL, SURVEY_TIMELINE_TPL, SURVEY_WRITER_TPL,
};
use crate::links::paper_reference_url;
use crate::llm::{resolve_model, resolve_temperature, LlmClient, LlmMessage};
use crate::state::AppState;
use serde_json::json;
use sqlx::Row;
use std::collections::HashSet;
use tauri::{Emitter, State};
use uuid::Uuid;

#[tauri::command]
pub async fn run_survey_generation(
    app: tauri::AppHandle,
    db: sqlx::SqlitePool,
    settings: std::collections::HashMap<String, String>,
    query: String,
    max_papers: Option<i32>,
    time_from: Option<i32>,
    time_to: Option<i32>,
    lit_types: Option<Vec<String>>,
    databases: Option<Vec<String>>,
    citation_format: Option<String>,
    language: Option<String>,
    paper_ids: Option<Vec<String>>,
    request_id: Option<String>,
) -> Result<(), String> {
    let request_id = request_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // 同一时刻只允许一个综述生成任务，避免并发任务重复落库。
    let Some(run_guard) = try_acquire_survey_run_lock() else {
        return Err("已有综述生成任务正在进行，请等待其完成后再试。".to_string());
    };

    tokio::spawn(async move {
        let _run_guard = run_guard;
        let client = match LlmClient::from_settings(&settings) {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit(
                    "survey:error",
                    json!({ "request_id": request_id, "error": e.to_string() }),
                );
                return;
            }
        };

        let time_range_str = match (time_from, time_to) {
            (Some(from), Some(to)) => format!("{} - {}", from, to),
            (Some(from), None) => format!("{} 至今", from),
            (None, Some(to)) => format!("{} 年以前", to),
            (None, None) => "不限".to_string(),
        };
        let lit_types_str = lit_types
            .as_ref()
            .map(|v| v.join("、"))
            .unwrap_or_else(|| "不限".to_string());
        let databases_str = databases
            .as_ref()
            .map(|v| v.join("、"))
            .unwrap_or_else(|| "不限".to_string());
        let language_str = match language.as_deref().unwrap_or("both") {
            "zh" => "仅使用简体中文输出".to_string(),
            "en" => "Use English only".to_string(),
            _ => "优先使用简体中文，保留英文术语与论文标题".to_string(),
        };

        // ── Agent 1: Intent Planner ──────────────────────────────────────

        let plan_agent_id = uuid::Uuid::new_v4().to_string();
        let _ = app.emit(
            "survey:agent_start",
            json!({
                "request_id": request_id,
                "agent": {
                    "id": plan_agent_id,
                    "name": "检索规划 Agent",
                    "role": "规划研究范围与检索策略",
                    "status": "running"
                }
            }),
        );

        let plan_prompt = SURVEY_PLANNER_TPL
            .replace("{query}", &query)
            .replace("{time_range}", &time_range_str)
            .replace("{lit_types}", &lit_types_str)
            .replace("{databases}", &databases_str)
            .replace("{language}", &language_str);
        let plan_msgs = vec![
            LlmMessage::system(survey_planner_system()),
            LlmMessage::user(plan_prompt),
        ];
        let survey_planner_model = resolve_model(&settings, &["survey_planner_model"]);
        let survey_planner_temperature =
            resolve_temperature(&settings, "survey_planner_temperature", 0.2);
        let plan_json = match client
            .chat(
                &plan_msgs,
                survey_planner_model.as_deref(),
                survey_planner_temperature,
            )
            .await
        {
            Ok(resp) => {
                let parsed = serde_json::from_str::<serde_json::Value>(&extract_json(&resp))
                    .unwrap_or(json!({}));
                let _ = app.emit("survey:agent_complete", json!({
                    "request_id": request_id,
                    "agent": {
                        "id": plan_agent_id,
                        "name": "检索规划 Agent",
                        "role": "规划研究范围与检索策略",
                        "status": "done",
                        "summary": parsed.get("scope").and_then(|v| v.as_str()).unwrap_or("已生成检索规划")
                    }
                }));
                parsed
            }
            Err(e) => {
                let _ = app.emit(
                    "survey:agent_error",
                    json!({
                        "request_id": request_id,
                        "agent": {
                            "id": plan_agent_id,
                            "name": "检索规划 Agent",
                            "role": "规划研究范围与检索策略",
                            "status": "failed",
                            "error": e.to_string()
                        }
                    }),
                );
                json!({
                    "scope": format!("围绕{}进行文献综述", query),
                    "search_queries": [query.clone()],
                    "must_cover": ["研究背景", "主要方法", "研究趋势"],
                    "expected_methods": []
                })
            }
        };

        let search_queries = plan_json
            .get("search_queries")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect::<Vec<String>>()
            })
            .unwrap_or_else(|| vec![query.clone()]);

        // ── Agent 2: Literature Retriever ──────────────────────────────────

        let retrieval_agent_id = uuid::Uuid::new_v4().to_string();
        let _ = app.emit(
            "survey:agent_start",
            json!({
                "request_id": request_id,
                "agent": {
                    "id": retrieval_agent_id,
                    "name": "文献检索 Agent",
                    "role": "检索候选文献",
                    "status": "running"
                }
            }),
        );

        let paper_limit = i64::from(max_papers.unwrap_or(20).max(1));
        // 文献类型/数据库偏好：现有数据只能加权排序，因此偏好生效时先扩大候选池再截断。
        let lit_type_prefs = lit_types.clone().unwrap_or_default();
        let database_prefs = databases.clone().unwrap_or_default();
        let prefs_active = !lit_type_prefs.is_empty() || !database_prefs.is_empty();
        let selection_limit = if prefs_active {
            (paper_limit as usize).saturating_mul(3)
        } else {
            paper_limit as usize
        };
        let pinned_ids = paper_ids
            .as_ref()
            .map(|v| {
                v.iter()
                    .filter(|s| !s.is_empty())
                    .take(paper_limit as usize)
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let (mut papers, mut retrieval_summary) = if !pinned_ids.is_empty() {
            // 用户已从论文库中手动选择论文，直接按 ID 加载，跳过文本检索
            match fetch_papers_by_ids(&db, &pinned_ids).await {
                Ok(list) => {
                    let count = list.len();
                    (list, format!("已加载论文库中选定的 {} 篇论文", count))
                }
                Err(e) => {
                    let _ = app.emit(
                        "survey:agent_error",
                        json!({
                            "request_id": request_id,
                            "agent": {
                                "id": retrieval_agent_id,
                                "name": "文献检索 Agent",
                                "role": "检索候选文献",
                                "status": "failed",
                                "error": e.clone()
                            }
                        }),
                    );
                    let _ = app.emit(
                        "survey:error",
                        json!({ "request_id": request_id, "error": e }),
                    );
                    return;
                }
            }
        } else {
            match retrieve_papers(
                &db,
                &query,
                &search_queries,
                selection_limit as i64,
                time_from,
                time_to,
            )
            .await
            {
                Ok(list) => {
                    let count = list.len();
                    let filter_desc = if time_from.is_some() || time_to.is_some() {
                        format!("（时间范围：{}）", time_range_str)
                    } else {
                        String::new()
                    };
                    (
                        list,
                        format!("已从论文库检索到 {} 篇候选文献{}", count, filter_desc),
                    )
                }
                Err(e) => (
                    Vec::new(),
                    format!("论文库检索失败，已切换外部学术源补充：{}", e),
                ),
            }
        };

        if pinned_ids.is_empty() && papers.len() < paper_limit as usize {
            let external_limit = (paper_limit as usize).saturating_sub(papers.len()).max(6);
            match search_survey_candidates(
                &settings,
                &query,
                &search_queries,
                external_limit,
                time_from,
                time_to,
            )
            .await
            {
                Ok(external_papers) => {
                    let external_added =
                        merge_survey_papers(&mut papers, external_papers, selection_limit);
                    if external_added > 0 {
                        retrieval_summary = if papers.len() == external_added {
                            format!("已从外部学术源检索到 {} 篇候选文献", external_added)
                        } else {
                            format!(
                                "{}，并从外部学术源补充 {} 篇候选文献",
                                retrieval_summary, external_added
                            )
                        };
                    }
                }
                Err(error) => {
                    if papers.is_empty() {
                        retrieval_summary = format!("论文库与外部学术源均未完成检索：{}", error);
                    }
                }
            }
        }

        if prefs_active {
            apply_survey_preferences(&mut papers, &lit_type_prefs, &database_prefs);
            papers.truncate(paper_limit as usize);
        }

        if papers.is_empty() {
            let message = "未检索到候选文献，请调整研究问题、放宽时间范围，或先在论文库中导入几篇相关论文后重试。";
            let _ = app.emit(
                "survey:agent_error",
                json!({
                    "request_id": request_id,
                    "agent": {
                        "id": retrieval_agent_id,
                        "name": "文献检索 Agent",
                        "role": "检索候选文献",
                        "status": "failed",
                        "error": message
                    }
                }),
            );
            let _ = app.emit(
                "survey:error",
                json!({ "request_id": request_id, "error": message }),
            );
            return;
        }

        let _ = app.emit(
            "survey:agent_complete",
            json!({
                "request_id": request_id,
                "agent": {
                    "id": retrieval_agent_id,
                    "name": "文献检索 Agent",
                    "role": "检索候选文献",
                    "status": "done",
                    "summary": retrieval_summary
                }
            }),
        );

        // RAG evidence
        let rag_context = if let Ok(embed_client) = LlmClient::embed_client_from_settings(&settings)
        {
            if let Ok(embeddings) = embed_client.embed(&[query.clone()]).await {
                if let Some(emb) = embeddings.into_iter().next() {
                    let top_k = max_papers.unwrap_or(10) as usize;
                    crate::rag::combined_search(&db, &emb, top_k)
                        .await
                        .ok()
                        .map(|results| {
                            results
                                .iter()
                                .map(|r| {
                                    format!(
                                        "【{}】\n{}",
                                        r.source,
                                        truncate_for_prompt(&r.content, 1200)
                                    )
                                })
                                .collect::<Vec<_>>()
                                .join("\n\n")
                        })
                        .unwrap_or_default()
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        // ── Agent 3: Timeline Analyst ──────────────────────────────────────

        let timeline_agent_id = uuid::Uuid::new_v4().to_string();
        let _ = app.emit(
            "survey:agent_start",
            json!({
                "request_id": request_id,
                "agent": {
                    "id": timeline_agent_id,
                    "name": "时序分析 Agent",
                    "role": "梳理领域发展脉络与演进阶段",
                    "status": "running"
                }
            }),
        );

        let papers_by_year_text = build_papers_by_year_text(&papers);
        let timeline_prompt = SURVEY_TIMELINE_TPL
            .replace("{query}", &query)
            .replace("{papers_by_year}", &papers_by_year_text);
        let timeline_msgs = vec![
            LlmMessage::system(survey_timeline_system()),
            LlmMessage::user(timeline_prompt),
        ];
        let timeline_model = resolve_model(&settings, &["survey_planner_model"]);
        let timeline_temperature =
            resolve_temperature(&settings, "survey_planner_temperature", 0.2);
        let (timeline_json, timeline_text) = match client
            .chat(
                &timeline_msgs,
                timeline_model.as_deref(),
                timeline_temperature,
            )
            .await
        {
            Ok(resp) => {
                let parsed = serde_json::from_str::<serde_json::Value>(&extract_json(&resp))
                    .unwrap_or(json!({}));
                let stages = parsed
                    .get("timeline")
                    .and_then(|v| v.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                let _ = app.emit(
                    "survey:agent_complete",
                    json!({
                        "request_id": request_id,
                        "agent": {
                            "id": timeline_agent_id,
                            "name": "时序分析 Agent",
                            "role": "梳理领域发展脉络与演进阶段",
                            "status": "done",
                            "summary": format!("已识别 {} 个发展阶段", stages)
                        }
                    }),
                );
                let text = build_timeline_text(&parsed);
                (parsed, text)
            }
            Err(e) => {
                let _ = app.emit(
                    "survey:agent_error",
                    json!({
                        "request_id": request_id,
                        "agent": {
                            "id": timeline_agent_id,
                            "name": "时序分析 Agent",
                            "role": "梳理领域发展脉络与演进阶段",
                            "status": "failed",
                            "error": e.to_string()
                        }
                    }),
                );
                (json!({}), String::new())
            }
        };

        // ── Agent 4: Survey Writer ──────────────────────────────────────

        let writer_agent_id = uuid::Uuid::new_v4().to_string();
        let _ = app.emit(
            "survey:agent_start",
            json!({
                "request_id": request_id,
                "agent": {
                    "id": writer_agent_id,
                    "name": "综述写作 Agent",
                    "role": "生成全面结构化文献综述",
                    "status": "running"
                }
            }),
        );

        let papers_text = build_papers_text(&papers);
        let writer_prompt = SURVEY_WRITER_TPL
            .replace("{query}", &query)
            .replace(
                "{scope}",
                plan_json
                    .get("scope")
                    .and_then(|v| v.as_str())
                    .unwrap_or("围绕用户研究问题给出入门综述"),
            )
            .replace("{time_range}", &time_range_str)
            .replace("{lit_types}", &lit_types_str)
            .replace("{language}", &language_str)
            .replace("{paper_count}", &papers.len().to_string())
            .replace(
                "{must_cover}",
                &plan_json
                    .get("must_cover")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str())
                            .collect::<Vec<_>>()
                            .join("、")
                    })
                    .unwrap_or_else(|| "研究背景、主要方法、研究趋势".to_string()),
            )
            .replace(
                "{expected_methods}",
                &plan_json
                    .get("expected_methods")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str())
                            .collect::<Vec<_>>()
                            .join("、")
                    })
                    .unwrap_or_default(),
            )
            .replace("{timeline}", &timeline_text)
            .replace("{papers}", &papers_text)
            .replace("{evidence}", &rag_context);

        let writer_msgs = vec![
            LlmMessage::system(survey_writer_system()),
            LlmMessage::user(writer_prompt),
        ];
        let survey_writer_model = resolve_model(&settings, &["survey_writer_model"]);
        let survey_writer_temperature =
            resolve_temperature(&settings, "survey_writer_temperature", 0.3);
        match client
            .chat(
                &writer_msgs,
                survey_writer_model.as_deref(),
                survey_writer_temperature,
            )
            .await
        {
            Ok(resp) => {
                let mut report = serde_json::from_str::<serde_json::Value>(&extract_json(&resp))
                    .unwrap_or(json!({}));
                if !is_usable_survey_report(&report) {
                    let message = "综述写作 Agent 未返回有效结果（输出为空或不是合法 JSON），本次不落库，请重试。";
                    let _ = app.emit(
                        "survey:agent_error",
                        json!({
                            "request_id": request_id,
                            "agent": {
                                "id": writer_agent_id,
                                "name": "综述写作 Agent",
                                "role": "生成全面结构化文献综述",
                                "status": "failed",
                                "error": message
                            }
                        }),
                    );
                    let _ = app.emit(
                        "survey:error",
                        json!({ "request_id": request_id, "error": message }),
                    );
                    return;
                }

                // Inject timeline from Timeline Analyst
                if timeline_json.get("timeline").is_some() {
                    report["development_timeline"] = timeline_json["timeline"].clone();
                }
                if let Some(v) = timeline_json.get("current_frontier") {
                    report["current_frontier"] = v.clone();
                }
                if let Some(v) = timeline_json.get("earliest_period") {
                    report["earliest_period"] = v.clone();
                }

                // ── Agent 5: Citation Formatter ──────────────────────────────────
                let cite_format = citation_format.as_deref().unwrap_or("gbt7714");
                let formatted_citations = build_formatted_citations(&papers, cite_format);

                let markdown = build_survey_markdown(
                    &query,
                    &report,
                    &papers,
                    &formatted_citations,
                    cite_format,
                );
                let _ = app.emit(
                    "survey:delta",
                    json!({ "request_id": request_id, "delta": markdown }),
                );

                // 落盘：综述结果持久化入库，并通过同步白名单跨端分发（移动端只读消费）。
                let survey_meta = json!({
                    "time_range": time_range_str,
                    "lit_types": lit_types_str,
                    "databases": databases_str,
                    "language": language.as_deref().unwrap_or("both")
                });
                let survey_id = Uuid::new_v4().to_string();
                let save_error = match insert_survey(
                    &db,
                    &survey_id,
                    &query,
                    &report,
                    &papers,
                    &formatted_citations,
                    cite_format,
                    language.as_deref().unwrap_or("both"),
                    &survey_meta,
                    &markdown,
                )
                .await
                {
                    Ok(()) => None,
                    Err(e) => {
                        eprintln!("[survey] 综述落盘失败: {e}");
                        Some(e)
                    }
                };
                let saved = save_error.is_none();
                if saved {
                    // 通知前端刷新历史列表（聊天触发的综述也走这里落库）。
                    let _ = app.emit(
                        "survey:generated",
                        json!({ "request_id": request_id, "id": survey_id, "query": query }),
                    );
                }

                let _ = app.emit(
                    "survey:structured",
                    json!({
                        "request_id": request_id,
                        "id": survey_id,
                        "query": query,
                        "report": report,
                        "papers": papers,
                        "formatted_citations": formatted_citations,
                        "citation_format": cite_format,
                        "meta": survey_meta
                    }),
                );
                let _ = app.emit("survey:agent_complete", json!({
                    "request_id": request_id,
                    "agent": {
                        "id": writer_agent_id,
                        "name": "综述写作 Agent",
                        "role": "生成全面结构化文献综述",
                        "status": "done",
                        "summary": "已完成综述（背景、发展脉络、方法、趋势、挑战、研究缺口与建议方向）"
                    }
                }));
                let _ = app.emit(
                    "survey:done",
                    json!({
                        "request_id": request_id,
                        "content": markdown,
                        "saved": saved,
                        "save_error": save_error
                    }),
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "survey:agent_error",
                    json!({
                        "request_id": request_id,
                        "agent": {
                            "id": writer_agent_id,
                            "name": "综述写作 Agent",
                            "role": "生成全面结构化文献综述",
                            "status": "failed",
                            "error": e.to_string()
                        }
                    }),
                );
                let _ = app.emit(
                    "survey:error",
                    json!({ "request_id": request_id, "error": e.to_string() }),
                );
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn survey_generate(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    query: String,
    max_papers: Option<i32>,
    time_from: Option<i32>,
    time_to: Option<i32>,
    lit_types: Option<Vec<String>>,
    databases: Option<Vec<String>>,
    citation_format: Option<String>,
    language: Option<String>,
    paper_ids: Option<Vec<String>>,
    request_id: Option<String>,
) -> Result<(), String> {
    let settings = state.settings.read().await.clone();
    let db = state.db.clone();
    run_survey_generation(
        app,
        db,
        settings,
        query,
        max_papers,
        time_from,
        time_to,
        lit_types,
        databases,
        citation_format,
        language,
        paper_ids,
        request_id,
    )
    .await
}

/// 已保存综述列表（仅摘要字段），按生成时间倒序。
#[tauri::command]
pub async fn survey_list(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let rows = sqlx::query("SELECT id, query, created_at FROM surveys ORDER BY created_at DESC")
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!(rows
        .into_iter()
        .map(|r| json!({
            "id": r.get::<String, _>("id"),
            "query": r.get::<String, _>("query"),
            "created_at": r.get::<String, _>("created_at"),
        }))
        .collect::<Vec<_>>()))
}

/// 读取单条已保存综述的完整结构。
#[tauri::command]
pub async fn survey_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let row = sqlx::query("SELECT * FROM surveys WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "综述不存在".to_string())?;

    let parse = |col: &str, fallback: serde_json::Value| {
        serde_json::from_str::<serde_json::Value>(&row.get::<String, _>(col)).unwrap_or(fallback)
    };
    Ok(json!({
        "id": row.get::<String, _>("id"),
        "query": row.get::<String, _>("query"),
        "report": parse("report_json", json!({})),
        "papers": parse("papers_json", json!([])),
        "formatted_citations": parse("citations_json", json!([])),
        "citation_format": row.get::<Option<String>, _>("citation_format"),
        "language": row.get::<Option<String>, _>("language"),
        "meta": parse("meta_json", json!({})),
        "markdown": row.get::<Option<String>, _>("markdown"),
        "created_at": row.get::<String, _>("created_at"),
    }))
}

/// 删除一条已保存综述（删除会经墓碑机制同步到其他设备）。
#[tauri::command]
pub async fn survey_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM surveys WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn survey_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
) -> Result<serde_json::Value, String> {
    let limit = limit.unwrap_or(20) as usize;
    let settings = state.settings.read().await.clone();

    if let Ok(embed_client) = LlmClient::embed_client_from_settings(&settings) {
        if let Ok(embeddings) = embed_client.embed(&[query.clone()]).await {
            if let Some(emb) = embeddings.into_iter().next() {
                let results = crate::rag::search_paper_chunks(&state.db, &emb, None, limit)
                    .await
                    .map_err(|e| e.to_string())?;
                let mut seen = std::collections::HashSet::new();
                let mut papers = Vec::new();
                for r in results {
                    if seen.insert(r.id.clone()) {
                        papers.push(json!({ "id": r.id, "content": r.content, "source": r.source, "score": r.score }));
                    }
                }
                return Ok(json!(papers));
            }
        }
    }

    let like = format!("%{}%", query);
    let rows = sqlx::query(
        "SELECT id, title, abstract, status FROM papers WHERE title LIKE ? OR abstract LIKE ? LIMIT ?",
    )
    .bind(&like).bind(&like).bind(limit as i64)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(json!(rows.into_iter().map(|r| {
        let paper_abstract: Option<String> = r.get("abstract");
        let mut obj = json!({ "id": r.get::<String, _>("id"), "title": r.get::<String, _>("title"), "status": r.get::<String, _>("status") });
        obj["abstract"] = json!(paper_abstract);
        obj
    }).collect::<Vec<_>>()))
}

// ── Helpers ───────────────────────────────────────────────────────

fn extract_json(s: &str) -> String {
    let s = s.trim();
    let s = if s.starts_with("```") {
        let lines: Vec<&str> = s.lines().collect();
        // 仅在末行是闭合围栏时才丢弃；未闭合的 ``` 输出保留末行内容。
        let last_is_fence = lines
            .last()
            .map(|line| line.trim().starts_with("```"))
            .unwrap_or(false);
        let end = if last_is_fence {
            lines.len().saturating_sub(1).max(1)
        } else {
            lines.len()
        };
        lines[1..end].join("\n")
    } else {
        s.to_string()
    };
    match (s.find('{'), s.rfind('}')) {
        (Some(start), Some(end)) if start <= end => s[start..=end].to_string(),
        (Some(start), None) => s[start..].to_string(),
        _ => s,
    }
}

#[cfg(test)]
mod tests {
    use super::extract_json;

    #[test]
    fn extract_json_strips_closed_fence() {
        let input = "```json\n{\"a\": 1}\n```";
        assert_eq!(extract_json(input), "{\"a\": 1}");
    }

    #[test]
    fn extract_json_keeps_last_line_when_fence_unclosed() {
        let input = "```json\n{\"a\": 1}";
        assert_eq!(extract_json(input), "{\"a\": 1}");
    }

    #[test]
    fn extract_json_trims_surrounding_prose() {
        let input = "这是结果：\n{\"a\": 1}\n以上。";
        assert_eq!(extract_json(input), "{\"a\": 1}");
    }
}

fn truncate_for_prompt(text: &str, max_chars: usize) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }
    let mut truncated = normalized.chars().take(max_chars).collect::<String>();
    truncated.push_str("...");
    truncated
}

async fn fetch_papers_by_ids(
    db: &sqlx::SqlitePool,
    ids: &[String],
) -> Result<Vec<serde_json::Value>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT id, title, authors, abstract, year, venue, doi, file_path, status FROM papers WHERE id IN ({})",
        placeholders
    );
    let mut query = sqlx::query(&sql);
    for id in ids {
        query = query.bind(id);
    }
    let rows = query.fetch_all(db).await.map_err(|e| e.to_string())?;

    let mut papers = Vec::new();
    for row in rows {
        let mut paper = json!({
            "id": row.get::<String, _>("id"),
            "title": row.get::<String, _>("title"),
            "authors": row.get::<Option<String>, _>("authors").unwrap_or_default(),
            "abstract": row.get::<Option<String>, _>("abstract").unwrap_or_default(),
            "year": row.get::<Option<i64>, _>("year"),
            "venue": row.get::<Option<String>, _>("venue").unwrap_or_default(),
            "doi": row.get::<Option<String>, _>("doi").unwrap_or_default(),
            "paper_url": paper_reference_url(
                row.get::<Option<String>, _>("title").as_deref(),
                row.get::<Option<String>, _>("doi").as_deref(),
                row.get::<Option<String>, _>("file_path").as_deref(),
            ),
            "status": row.get::<String, _>("status"),
        });
        if let Some(venue) = paper.get("venue").and_then(|v| v.as_str()) {
            if let Some(tag) = match_venue(venue) {
                paper["ccf_rating"] = json!(tag.rating);
                paper["ccf_area"] = json!(tag.area);
                paper["ccf_type"] = json!(tag.kind);
                paper["ccf_label"] = json!(tag.label);
                paper["ccf_publisher"] = json!(tag.publisher);
                paper["venue_url"] = json!(tag.url);
            }
        }
        papers.push(paper);
    }
    papers.sort_by_key(|paper| {
        paper
            .get("id")
            .and_then(|value| value.as_str())
            .and_then(|id| ids.iter().position(|item| item == id))
            .unwrap_or(usize::MAX)
    });
    Ok(papers)
}

fn merge_survey_papers(
    target: &mut Vec<serde_json::Value>,
    incoming: Vec<serde_json::Value>,
    limit: usize,
) -> usize {
    if target.len() >= limit {
        return 0;
    }

    let mut seen = target
        .iter()
        .filter_map(survey_paper_identity)
        .collect::<HashSet<_>>();
    let before_len = target.len();

    for paper in incoming {
        if target.len() >= limit {
            break;
        }
        let Some(key) = survey_paper_identity(&paper) else {
            continue;
        };
        if !seen.insert(key) {
            continue;
        }
        target.push(paper);
    }

    target.len().saturating_sub(before_len)
}

fn survey_paper_identity(paper: &serde_json::Value) -> Option<String> {
    if let Some(doi) = paper
        .get("doi")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(format!("doi:{}", doi.to_lowercase()));
    }

    paper
        .get("title")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase())
}

// ── Markdown Format ───────────────────────────────────────────────

#[tauri::command]
pub async fn markdown_format_chunk(
    state: State<'_, AppState>,
    text: String,
    style_summary: String,
) -> Result<serde_json::Value, String> {
    let settings = state.settings.read().await.clone();
    let client = LlmClient::from_settings(&settings).map_err(|e| e.to_string())?;

    let model = resolve_model(&settings, &["copilot_simple_model"]);
    let temperature = resolve_temperature(&settings, "copilot_simple_temperature", 0.3);

    let style_context = if style_summary.trim().is_empty() {
        "这是第一块，请自行确定合适的 Markdown 排版风格，并在末尾的风格摘要里简要记录约定（标题层级、列表风格、强调与代码块用法等），供后续块继承。".to_string()
    } else {
        format!("请严格延续以下排版约定，保证全文风格一致：\n{style_summary}")
    };

    let system = specialist_system(
        "Markdown 排版整理专家",
        "把任意文本整理为规范、一致、结构清晰的 Markdown，完整保留原始内容与语义。",
        Some("不要翻译、不要增删或解释内容；不要用代码块包裹整篇输出。"),
    );

    // 用分隔行而非 JSON 承载结果：Markdown 常含引号/反斜杠/代码块/LaTeX，JSON 转义极易破坏内容。
    let user = format!(
        "{style_context}\n\n请整理下面的文本，严格按以下格式输出：\n\
         1) 先输出整理后的完整 Markdown 正文（逐字保留原始信息，仅做排版与结构化）。\n\
         2) 另起一行，单独输出一行分隔标记：{STYLE_SENTINEL}\n\
         3) 在分隔标记之后输出本次排版约定摘要（≤150 字，供后续块继承）。\n\
         除上述内容外不要输出任何额外说明。\n\n待整理文本：\n{text}",
        STYLE_SENTINEL = MARKDOWN_STYLE_SENTINEL,
    );

    let msgs = vec![LlmMessage::system(system), LlmMessage::user(&user)];
    let raw = client
        .chat(&msgs, model.as_deref(), temperature)
        .await
        .map_err(|e| e.to_string())?;

    let body = strip_outer_markdown_fence(raw.trim());
    let (formatted, next_style) = match body.rfind(MARKDOWN_STYLE_SENTINEL) {
        Some(idx) => (
            body[..idx].trim_end().to_string(),
            body[idx + MARKDOWN_STYLE_SENTINEL.len()..]
                .trim()
                .to_string(),
        ),
        // 模型未给分隔标记：整段视为正文，沿用上一块的风格摘要。
        None => (body.clone(), style_summary.trim().to_string()),
    };

    Ok(serde_json::json!({
        "formatted": formatted,
        "styleSummary": next_style,
    }))
}

const MARKDOWN_STYLE_SENTINEL: &str = "<<<STYLE-SUMMARY>>>";

/// 仅当整段输出被一个显式的 ```markdown / ```md 代码块整体包裹时才剥离外层围栏，
/// 避免破坏正文里合法的代码块（普通 ``` 包裹无法与「正文就是一个代码块」区分，故不剥离）。
fn strip_outer_markdown_fence(text: &str) -> String {
    let trimmed = text.trim();
    let lines: Vec<&str> = trimmed.lines().collect();
    if lines.len() >= 2 {
        let first = lines[0].trim();
        let last = lines[lines.len() - 1].trim();
        if (first == "```markdown" || first == "```md") && last == "```" {
            return lines[1..lines.len() - 1].join("\n").trim().to_string();
        }
    }
    trimmed.to_string()
}

async fn retrieve_papers(
    db: &sqlx::SqlitePool,
    query: &str,
    search_queries: &[String],
    limit: i64,
    year_from: Option<i32>,
    year_to: Option<i32>,
) -> Result<Vec<serde_json::Value>, String> {
    let mut terms = vec![query.to_string()];
    terms.extend(search_queries.iter().cloned());

    let year_clause = match (year_from, year_to) {
        (Some(from), Some(to)) => format!(
            " AND (year IS NULL OR (year >= {} AND year <= {}))",
            from, to
        ),
        (Some(from), None) => format!(" AND (year IS NULL OR year >= {})", from),
        (None, Some(to)) => format!(" AND (year IS NULL OR year <= {})", to),
        (None, None) => String::new(),
    };

    let mut seen = HashSet::new();
    let mut papers = Vec::new();
    for term in terms.into_iter().take(8) {
        if papers.len() >= limit as usize {
            break;
        }
        let like = format!("%{}%", term);
        let sql = format!(
            "SELECT id, title, authors, abstract, year, venue, doi, file_path, status
             FROM papers
             WHERE (title LIKE ? OR abstract LIKE ?){}
             ORDER BY updated_at DESC LIMIT ?",
            year_clause
        );
        let rows = sqlx::query(&sql)
            .bind(&like)
            .bind(&like)
            .bind(limit)
            .fetch_all(db)
            .await
            .map_err(|e| e.to_string())?;

        for row in rows {
            let id: String = row.get("id");
            if !seen.insert(id.clone()) {
                continue;
            }
            papers.push(json!({
                "id": id,
                "title": row.get::<String, _>("title"),
                "authors": row.get::<Option<String>, _>("authors").unwrap_or_default(),
                "abstract": row.get::<Option<String>, _>("abstract").unwrap_or_default(),
                "year": row.get::<Option<i64>, _>("year"),
                "venue": row.get::<Option<String>, _>("venue").unwrap_or_default(),
                "doi": row.get::<Option<String>, _>("doi").unwrap_or_default(),
                "paper_url": paper_reference_url(
                    row.get::<Option<String>, _>("title").as_deref(),
                    row.get::<Option<String>, _>("doi").as_deref(),
                    row.get::<Option<String>, _>("file_path").as_deref(),
                ),
                "status": row.get::<String, _>("status"),
            }));
            if let Some(last) = papers.last_mut() {
                if let Some(venue) = last.get("venue").and_then(|v| v.as_str()) {
                    if let Some(tag) = match_venue(venue) {
                        last["ccf_rating"] = json!(tag.rating);
                        last["ccf_area"] = json!(tag.area);
                        last["ccf_type"] = json!(tag.kind);
                        last["ccf_label"] = json!(tag.label);
                        last["ccf_publisher"] = json!(tag.publisher);
                        last["venue_url"] = json!(tag.url);
                    }
                }
            }
            if papers.len() >= limit as usize {
                break;
            }
        }
    }
    Ok(papers)
}

