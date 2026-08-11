use crate::assistant_prompts::specialist_system;
use crate::ccf::{infer_from_text, match_venue};
use crate::commands::knowledge_notes::create_note_core;
use crate::commands::paper_analysis_prompts::{
    agent1_system, agent2_system, agent3_system, agent4_system, build_agent1_prompt,
    build_agent2_prompt, build_agent3_prompt, build_agent4_prompt, build_all_figure_context,
    build_paper_note_prompt, build_reproduce_prompt, build_type_directive, paper_note_system,
    reproduce_system,
};
use crate::commands::paper_analysis_text::{
    build_analysis_slices, build_intro_slice, build_reproduction_context, PaperAnalysisLayout,
};
use crate::commands::paper_figures::ensure_figures_extracted as ensure_paper_figures_extracted;
use crate::commands::paper_text::extract_pdf_text_with_filtered_stderr;
use crate::journal_partitions::match_journal;
use crate::links::paper_reference_url;
use crate::llm::{resolve_max_tokens, resolve_model, resolve_temperature, LlmClient, LlmMessage};
use crate::rag::{chunk_text, serialize_embedding};
use crate::services::paper_parser_service::{list_paper_parse_runs, parse_pdf_document};
use crate::state::AppState;
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::{Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

fn has_meaningful_text(value: Option<&str>) -> bool {
    value.is_some_and(|text| !text.trim().is_empty())
}

fn generated_paper_note_title(paper_title: &str, llm_title: Option<&str>) -> String {
    let clean_paper_title = paper_title.trim();
    if !clean_paper_title.is_empty() {
        return clean_paper_title.to_string();
    }

    llm_title
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(|title| {
            title
                .trim_start_matches("论文笔记：")
                .trim_start_matches("论文笔记:")
                .trim()
                .to_string()
        })
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| "未命名论文".to_string())
}

fn canonical_pdf_file(path: PathBuf) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("PDF 文件不可访问：{e}"))?;
    if !canonical.is_file() {
        return Err("请选择有效的 PDF 文件。".to_string());
    }

    let is_pdf = canonical
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !is_pdf {
        return Err("仅支持 PDF 文件。".to_string());
    }

    Ok(canonical)
}

fn canonical_path_within(base: &Path, path: &Path, label: &str) -> Result<PathBuf, String> {
    let canonical_base = base
        .canonicalize()
        .map_err(|e| format!("无法校验{label}目录：{e}"))?;
    let canonical_path = path
        .canonicalize()
        .map_err(|e| format!("{label}不可访问：{e}"))?;

    if canonical_path.starts_with(&canonical_base) {
        Ok(canonical_path)
    } else {
        Err(format!("{label}不在应用管理目录内。"))
    }
}

fn canonical_managed_pdf_path(app: &tauri::AppHandle, path: &Path) -> Result<PathBuf, String> {
    let papers_dir = managed_papers_dir(app)?;
    canonical_path_within(&papers_dir, path, "PDF 文件")
}

fn analysis_json_from_row(row: &sqlx::sqlite::SqliteRow) -> Option<serde_json::Value> {
    let research_question = row.get::<Option<String>, _>("research_question");
    let core_method = row.get::<Option<String>, _>("core_method");
    let experiment_design = row.get::<Option<String>, _>("experiment_design");
    let experiment_results = row.get::<Option<String>, _>("experiment_results");
    let innovations = row.get::<Option<String>, _>("innovations");
    let limitations = row.get::<Option<String>, _>("limitations");
    let key_conclusions = row.get::<Option<String>, _>("key_conclusions");

    if ![
        research_question.as_deref(),
        core_method.as_deref(),
        experiment_design.as_deref(),
        experiment_results.as_deref(),
        innovations.as_deref(),
        limitations.as_deref(),
        key_conclusions.as_deref(),
    ]
    .into_iter()
    .any(has_meaningful_text)
    {
        return None;
    }

    Some(json!({
        "research_question": research_question,
        "core_method": core_method,
        "experiment_design": experiment_design,
        "experiment_results": experiment_results,
        "innovations": innovations,
        "limitations": limitations,
        "key_conclusions": key_conclusions,
    }))
}

// ── List ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn papers_list(
    state: State<'_, AppState>,
    offset: Option<i64>,
    limit: Option<i64>,
    research_interest_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(20);
    let rows = if let Some(interest_id) =
        research_interest_id.filter(|value| !value.trim().is_empty())
    {
        sqlx::query(
            "SELECT p.id, p.title, p.authors, p.abstract, p.year, p.venue, p.doi, p.file_path, p.tags, p.importance_color, p.notes, p.research_interest_id, p.status, p.sort_order, p.created_at, p.updated_at,
                    a.research_question, a.core_method, a.experiment_design, a.experiment_results, a.innovations, a.limitations, a.key_conclusions,
                    rg.code_repository, rg.environment_setup, rg.dependencies, rg.dataset_preparation, rg.training_process,
                    rg.inference_process, rg.evaluation_metrics, rg.risks_and_notes
             FROM papers p
             LEFT JOIN paper_analyses a ON a.paper_id = p.id
             LEFT JOIN reproduction_guides rg ON rg.paper_id = p.id
             WHERE p.research_interest_id = ?
             ORDER BY p.sort_order ASC, p.created_at DESC LIMIT ? OFFSET ?",
        )
        .bind(&interest_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?
    } else {
        sqlx::query(
            "SELECT p.id, p.title, p.authors, p.abstract, p.year, p.venue, p.doi, p.file_path, p.tags, p.importance_color, p.notes, p.research_interest_id, p.status, p.sort_order, p.created_at, p.updated_at,
                    a.research_question, a.core_method, a.experiment_design, a.experiment_results, a.innovations, a.limitations, a.key_conclusions,
                    rg.code_repository, rg.environment_setup, rg.dependencies, rg.dataset_preparation, rg.training_process,
                    rg.inference_process, rg.evaluation_metrics, rg.risks_and_notes
             FROM papers p
             LEFT JOIN paper_analyses a ON a.paper_id = p.id
             LEFT JOIN reproduction_guides rg ON rg.paper_id = p.id
             ORDER BY p.sort_order ASC, p.created_at DESC LIMIT ? OFFSET ?",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await
        .map_err(|e| e.to_string())?
    };

    let papers: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            let mut v = paper_row_to_json(r, false);
            if let Some(analysis) = analysis_json_from_row(r) {
                v["analysis"] = analysis;
            }
            let env: Option<String> = r.try_get("environment_setup").ok().flatten();
            if env.as_deref().is_some_and(|value| !value.trim().is_empty()) {
                v["reproduction_guide"] = json!({
                    "code_repository": r.try_get::<Option<String>, _>("code_repository").ok().flatten(),
                    "environment_setup": r.try_get::<Option<String>, _>("environment_setup").ok().flatten(),
                    "dependencies": r.try_get::<Option<String>, _>("dependencies").ok().flatten(),
                    "dataset_preparation": r.try_get::<Option<String>, _>("dataset_preparation").ok().flatten(),
                    "training_process": r.try_get::<Option<String>, _>("training_process").ok().flatten(),
                    "inference_process": r.try_get::<Option<String>, _>("inference_process").ok().flatten(),
                    "evaluation_metrics": r.try_get::<Option<String>, _>("evaluation_metrics").ok().flatten(),
                    "risks_and_notes": r.try_get::<Option<String>, _>("risks_and_notes").ok().flatten(),
                });
            }
            v
        })
        .collect();
    Ok(json!(papers))
}

// ── Get ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn papers_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let row = sqlx::query(
        "SELECT id, title, authors, abstract, year, venue, doi, file_path, tags, importance_color, notes, research_interest_id, status, sort_order, created_at, updated_at
         FROM papers WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "未找到对应论文。".to_string())?;

    let analysis = sqlx::query(
        "SELECT id, research_question, core_method, experiment_design, experiment_results, innovations, limitations, key_conclusions, created_at
         FROM paper_analyses WHERE paper_id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .and_then(|a: sqlx::sqlite::SqliteRow| {
        analysis_json_from_row(&a).map(|value| {
            let mut object = value.as_object().cloned().unwrap_or_default();
            object.insert("id".into(), json!(a.get::<String, _>("id")));
            object.insert("created_at".into(), json!(a.get::<String, _>("created_at")));
            serde_json::Value::Object(object)
        })
    });

    let guide = sqlx::query(
        "SELECT id, code_repository, environment_setup, dependencies, dataset_preparation, training_process, inference_process, evaluation_metrics, risks_and_notes, created_at
         FROM reproduction_guides WHERE paper_id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .and_then(|g: sqlx::sqlite::SqliteRow| {
        let environment_setup = g.get::<Option<String>, _>("environment_setup");
        if environment_setup
            .as_deref()
            .is_none_or(|value| value.trim().is_empty())
        {
            return None;
        }
        Some(json!({
            "id": g.get::<String, _>("id"),
            "code_repository": g.get::<Option<String>, _>("code_repository"),
            "environment_setup": environment_setup,
            "dependencies": g.get::<Option<String>, _>("dependencies"),
            "dataset_preparation": g.get::<Option<String>, _>("dataset_preparation"),
            "training_process": g.get::<Option<String>, _>("training_process"),
            "inference_process": g.get::<Option<String>, _>("inference_process"),
            "evaluation_metrics": g.get::<Option<String>, _>("evaluation_metrics"),
            "risks_and_notes": g.get::<Option<String>, _>("risks_and_notes"),
            "created_at": g.get::<String, _>("created_at"),
        }))
    });

    let mut paper = paper_row_to_json(&row, true);
    if let Some(obj) = paper.as_object_mut() {
        obj.insert(
            "analysis".into(),
            analysis.unwrap_or(serde_json::Value::Null),
        );
        obj.insert(
            "reproduction_guide".into(),
            guide.unwrap_or(serde_json::Value::Null),
        );
    }
    Ok(paper)
}

#[tauri::command]
pub async fn papers_list_parse_runs(
    state: State<'_, AppState>,
    paper_id: String,
) -> Result<serde_json::Value, String> {
    list_paper_parse_runs(&state.db, &paper_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn papers_reparse(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let row = sqlx::query("SELECT file_path, tags FROM papers WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "未找到对应论文。".to_string())?;

    let file_path = row
        .get::<Option<String>, _>("file_path")
        .ok_or_else(|| "这篇论文没有可重解析的 PDF 文件。".to_string())?;
    // 重解析会刷新正文与分块，但用户可能已设置自定义标签，这里保留非空标签，避免被关键词覆盖。
    let existing_tags_json = row.get::<Option<String>, _>("tags");
    let has_existing_tags = existing_tags_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Vec<String>>(raw).ok())
        .map(|tags| tags.iter().any(|tag| !tag.trim().is_empty()))
        .unwrap_or(false);
    let managed_path = canonical_managed_pdf_path(&app, Path::new(&file_path))?;
    let db = state.db.clone();
    let settings = state.settings.read().await.clone();
    let paper_id = id.clone();

    tokio::spawn(async move {
        let started_at = Instant::now();
        let now = chrono::Utc::now().to_rfc3339();
        let _ = sqlx::query("UPDATE papers SET status = 'parsing', updated_at = ? WHERE id = ?")
            .bind(&now)
            .bind(&paper_id)
            .execute(&db)
            .await;
        let _ = app.emit(
            "paper:status",
            json!({ "paper_id": paper_id, "status": "parsing" }),
        );

        let parse_result = match parse_pdf_document(&db, &paper_id, managed_path).await {
            Ok(value) => value,
            Err(error) => {
                let now = chrono::Utc::now().to_rfc3339();
                let _ =
                    sqlx::query("UPDATE papers SET status = 'failed', updated_at = ? WHERE id = ?")
                        .bind(&now)
                        .bind(&paper_id)
                        .execute(&db)
                        .await;
                let _ = app.emit(
                    "paper:status",
                    json!({ "paper_id": paper_id, "status": "failed", "error": error }),
                );
                return;
            }
        };

        let text = parse_result.text;
        let refreshed_tags = if has_existing_tags {
            existing_tags_json
                .clone()
                .unwrap_or_else(|| "[]".to_string())
        } else {
            let refreshed_keywords =
                crate::commands::paper_analysis_text::extract_keywords_from_text(&text);
            serde_json::to_string(&refreshed_keywords).unwrap_or_else(|_| "[]".to_string())
        };
        let parsed_now = chrono::Utc::now().to_rfc3339();
        let _ = sqlx::query(
            "UPDATE papers SET full_text = ?, tags = ?, status = 'parsed', updated_at = ? WHERE id = ?",
        )
        .bind(&text)
        .bind(&refreshed_tags)
        .bind(&parsed_now)
        .bind(&paper_id)
        .execute(&db)
        .await;

        if let Err(error) = replace_paper_chunks(&db, &settings, &paper_id, &text).await {
            eprintln!(
                "[paper-reparse][{}] chunk refresh failed: {}",
                paper_id, error
            );
        }

        let _ = app.emit(
            "paper:status",
            json!({ "paper_id": paper_id, "status": "parsed" }),
        );
        eprintln!(
            "[paper-reparse][{}] complete elapsed_ms={}",
            paper_id,
            started_at.elapsed().as_millis()
        );
    });

    Ok(())
}

#[tauri::command]
pub async fn papers_update(
    state: State<'_, AppState>,
    id: String,
    title: Option<String>,
    authors: Option<String>,
    venue: Option<String>,
    year: Option<i64>,
    doi: Option<String>,
    research_interest_id: Option<String>,
    importance_color: Option<String>,
    notes: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let now = chrono::Utc::now().to_rfc3339();

    if let Some(value) = title {
        let next = value.trim();
        if next.is_empty() {
            return Err("论文标题不能为空".to_string());
        }
        sqlx::query("UPDATE papers SET title = ?, updated_at = ? WHERE id = ?")
            .bind(next)
            .bind(&now)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(value) = authors {
        let next = value.trim();
        sqlx::query("UPDATE papers SET authors = ?, updated_at = ? WHERE id = ?")
            .bind(if next.is_empty() {
                None::<String>
            } else {
                Some(next.to_string())
            })
            .bind(&now)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(value) = venue {
        let next = value.trim();
        sqlx::query("UPDATE papers SET venue = ?, updated_at = ? WHERE id = ?")
            .bind(if next.is_empty() {
                None::<String>
            } else {
                Some(next.to_string())
            })
            .bind(&now)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(value) = year {
        sqlx::query("UPDATE papers SET year = ?, updated_at = ? WHERE id = ?")
            .bind(if value <= 0 { None } else { Some(value) })
            .bind(&now)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(value) = doi {
        let next = value.trim();
        sqlx::query("UPDATE papers SET doi = ?, updated_at = ? WHERE id = ?")
            .bind(if next.is_empty() {
                None::<String>
            } else {
                Some(next.to_string())
            })
            .bind(&now)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(value) = research_interest_id {
        let next = value.trim();
        sqlx::query("UPDATE papers SET research_interest_id = ?, updated_at = ? WHERE id = ?")
            .bind(if next.is_empty() {
                None::<String>
            } else {
                Some(next.to_string())
            })
            .bind(&now)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(value) = importance_color {
        sqlx::query("UPDATE papers SET importance_color = ?, updated_at = ? WHERE id = ?")
            .bind(value.trim())
            .bind(&now)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(value) = notes {
        sqlx::query("UPDATE papers SET notes = ?, updated_at = ? WHERE id = ?")
            .bind(if value.trim().is_empty() {
                None::<String>
            } else {
                Some(value.trim().to_string())
            })
            .bind(&now)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(value) = tags {
        // 规范化自定义标签：去空白、丢空值、忽略大小写去重，最多保留 16 个。
        let mut cleaned: Vec<String> = Vec::new();
        for raw in value {
            let tag = raw.trim().to_string();
            if tag.is_empty() {
                continue;
            }
            if !cleaned
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(&tag))
            {
                cleaned.push(tag);
            }
            if cleaned.len() >= 16 {
                break;
            }
        }
        let tags_json = serde_json::to_string(&cleaned).unwrap_or_else(|_| "[]".to_string());
        sqlx::query("UPDATE papers SET tags = ?, updated_at = ? WHERE id = ?")
            .bind(&tags_json)
            .bind(&now)
            .bind(&id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    }

    papers_get(state, id).await
}

// ── Reorder ──────────────────────────────────────────────────────

/// 按给定顺序重排同一文件夹内论文的 `sort_order`（从 0 递增）。
/// `ordered_ids` 为该文件夹内全部论文的目标顺序。
#[tauri::command]
pub async fn papers_reorder(
    state: State<'_, AppState>,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    if ordered_ids.is_empty() {
        return Ok(());
    }
    let now = chrono::Utc::now().to_rfc3339();
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;
    for (index, id) in ordered_ids.iter().enumerate() {
        sqlx::query("UPDATE papers SET sort_order = ?, updated_at = ? WHERE id = ?")
            .bind(index as i64)
            .bind(&now)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

// ── Delete ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn papers_delete(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    // Fetch file path before deletion so we can clean up the managed file
    let file_path_str: Option<String> = sqlx::query("SELECT file_path FROM papers WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<Option<String>, _>("file_path").ok().flatten());

    sqlx::query("DELETE FROM papers WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Delete the managed copy if it lives inside the app's papers directory
    if let Some(fp) = file_path_str {
        let file_path = PathBuf::from(&fp);
        if let Ok(papers_dir) = managed_papers_dir(&app) {
            if let Ok(managed_path) = canonical_path_within(&papers_dir, &file_path, "PDF 文件") {
                let _ = std::fs::remove_file(managed_path);
            }
        }
    }
    // Delete per-paper figures directory
    if let Ok(data_dir) = app.path().app_data_dir() {
        let figures_dir = data_dir.join("papers").join(&id);
        let _ = std::fs::remove_dir_all(&figures_dir);
    }

    Ok(())
}

// ── Merge duplicates ─────────────────────────────────────────────

/// 合并重复论文：保留 `keep_id`，把 `delete_ids` 的关联数据并入后删除这些副本。
/// 迁移策略（与前端约定一致）：
///   - 语料库片段：paper_id 改指主论文；
///   - 解读补位：主论文无解读、某副本有 → 把该解读迁到主论文（UNIQUE(paper_id) 安全）；
///   - 知识图谱证据链/引用：两端重指主论文（source_id 是纯文本无外键，不重指会悬空）；
///   - 副本的批注、分块、图表、解析记录、残留解读/引用：随 DELETE papers 级联清除。
/// 整个数据库操作在单事务内完成；托管 PDF 与产物目录在提交后清理（与 papers_delete 一致）。
#[tauri::command]
pub async fn papers_merge(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    keep_id: String,
    delete_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    // 过滤掉主论文自身、空值并去重
    let mut targets: Vec<String> = Vec::new();
    for id in delete_ids {
        let trimmed = id.trim().to_string();
        if trimmed.is_empty() || trimmed == keep_id || targets.contains(&trimmed) {
            continue;
        }
        targets.push(trimmed);
    }
    if targets.is_empty() {
        return Err("没有要合并的论文".to_string());
    }

    let keep_exists: Option<String> = sqlx::query_scalar("SELECT id FROM papers WHERE id = ?")
        .bind(&keep_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    if keep_exists.is_none() {
        return Err("保留的主论文不存在".to_string());
    }

    // 删除前取出各副本的 file_path，事务提交后清理托管文件
    let mut file_paths: Vec<String> = Vec::new();
    for did in &targets {
        if let Ok(Some(row)) = sqlx::query("SELECT file_path FROM papers WHERE id = ?")
            .bind(did)
            .fetch_optional(&state.db)
            .await
        {
            if let Ok(Some(fp)) = row.try_get::<Option<String>, _>("file_path") {
                if !fp.trim().is_empty() {
                    file_paths.push(fp);
                }
            }
        }
    }

    let keep_has_analysis: Option<String> =
        sqlx::query_scalar("SELECT id FROM paper_analyses WHERE paper_id = ?")
            .bind(&keep_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    // 解读补位：主论文没有解读、某副本有 → 把其中一条迁到主论文
    if keep_has_analysis.is_none() {
        let mut donor: Option<String> = None;
        for did in &targets {
            let found: Option<String> =
                sqlx::query_scalar("SELECT paper_id FROM paper_analyses WHERE paper_id = ?")
                    .bind(did)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
            if found.is_some() {
                donor = found;
                break;
            }
        }
        if let Some(donor_id) = donor {
            sqlx::query("UPDATE paper_analyses SET paper_id = ? WHERE paper_id = ?")
                .bind(&keep_id)
                .bind(&donor_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    for did in &targets {
        // 语料库片段迁移
        sqlx::query("UPDATE paper_corpus SET paper_id = ? WHERE paper_id = ?")
            .bind(&keep_id)
            .bind(did)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        // 知识图谱证据链：source_id 是纯文本无外键，必须重指否则删库后悬空。
        // UNIQUE(claim_id, source_kind, source_id, relation_kind) 冲突时 OR IGNORE 跳过，残留随后删除。
        sqlx::query(
            "UPDATE OR IGNORE knowledge_graph_evidence_links SET source_id = ? \
             WHERE source_kind = 'paper' AND source_id = ?",
        )
        .bind(&keep_id)
        .bind(did)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        sqlx::query(
            "DELETE FROM knowledge_graph_evidence_links WHERE source_kind = 'paper' AND source_id = ?",
        )
        .bind(did)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        // 引用关系：两端重指主论文（UNIQUE 冲突 OR IGNORE，残留交由 FK 级联删除）
        sqlx::query(
            "UPDATE OR IGNORE knowledge_paper_citations SET citing_paper_id = ? WHERE citing_paper_id = ?",
        )
        .bind(&keep_id)
        .bind(did)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        sqlx::query(
            "UPDATE OR IGNORE knowledge_paper_citations SET cited_paper_id = ? WHERE cited_paper_id = ?",
        )
        .bind(&keep_id)
        .bind(did)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    // 重指后可能出现主论文自引用，清掉
    sqlx::query("DELETE FROM knowledge_paper_citations WHERE citing_paper_id = cited_paper_id")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // 删除各副本（FK 级联清除其批注/分块/图表/解析记录/残留解读与引用）
    for did in &targets {
        sqlx::query("DELETE FROM papers WHERE id = ?")
            .bind(did)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    // 刷新主论文 updated_at，让同步感知本次合并
    sqlx::query("UPDATE papers SET updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&keep_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    // 提交后清理副本的托管 PDF 与产物目录（与 papers_delete 一致）
    for fp in file_paths {
        let file_path = PathBuf::from(&fp);
        if let Ok(papers_dir) = managed_papers_dir(&app) {
            if let Ok(managed_path) = canonical_path_within(&papers_dir, &file_path, "PDF 文件") {
                let _ = std::fs::remove_file(managed_path);
            }
        }
    }
    if let Ok(data_dir) = app.path().app_data_dir() {
        for did in &targets {
            let figures_dir = data_dir.join("papers").join(did);
            let _ = std::fs::remove_dir_all(&figures_dir);
        }
    }

    papers_get(state, keep_id).await
}

// ── Open PDF ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn papers_open_pdf(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let file_path_str: Option<String> = sqlx::query("SELECT file_path FROM papers WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<Option<String>, _>("file_path").ok().flatten());

    let path = file_path_str
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "该论文没有关联的本地文件".to_string())?;
    let path = canonical_managed_pdf_path(&app, Path::new(&path))?;
    let path = path.to_string_lossy().to_string();

    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn papers_reveal_in_folder(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let file_path_str: Option<String> = sqlx::query("SELECT file_path FROM papers WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<Option<String>, _>("file_path").ok().flatten());

    let path = file_path_str
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "该论文没有关联的本地文件".to_string())?;
    let canonical = canonical_managed_pdf_path(&app, Path::new(&path))?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &canonical.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &canonical.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = canonical.parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn papers_extract_pdf_text(
    file_path: tauri_plugin_fs::FilePath,
    max_chars: Option<usize>,
) -> Result<String, String> {
    let path = canonical_pdf_file(file_path.into_path().map_err(|e| e.to_string())?)?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("该文件")
        .to_string();
    let max_chars = max_chars.unwrap_or(32_000).clamp(1_000, 100_000);

    let extract_started_at = Instant::now();
    eprintln!("[pdf-extract] start: path={}", path.display());
    let path_for_extract = path.clone();
    let text = tokio::task::spawn_blocking(move || {
        extract_pdf_text_with_filtered_stderr(&path_for_extract)
    })
    .await
    .map_err(|error| format!("PDF 解析任务失败：{error}"))?
    .map_err(|error| format!("PDF 解析失败：{error}"))?;
    eprintln!(
        "[pdf-extract] done: path={} chars={} elapsed_ms={}",
        path.display(),
        text.chars().count(),
        extract_started_at.elapsed().as_millis()
    );

    let preview = safe_text_preview(&text, max_chars).trim().to_string();
    if preview.is_empty() {
        return Err(format!(
            "{file_name} 未解析到可用正文，请确认文件内容可复制。"
        ));
    }
    Ok(preview)
}

// ── Upload ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Default)]
struct ImportRenameMetadata {
    title: Option<String>,
    authors: Option<String>,
    year: Option<i64>,
    venue: Option<String>,
    doi: Option<String>,
    _keywords: Option<String>,
}

const IMPORT_RECOGNIZE_PROMPT: &str = r#"请根据用户提供的 PDF 文件名和正文前段识别论文元数据，仅返回合法 JSON：
{"title":"...","authors":"作者1, 作者2","year":2024,"venue":"期刊或会议名称","doi":"10.1234/abcd","keywords":"关键词1, 关键词2, 关键词3"}

要求：
1. title 尽量使用论文首页中的正式标题，不要保留文件名噪声。
2. authors 返回单行作者列表，使用英文逗号分隔。
3. year 无法确认时返回 0。
4. venue 无法确认时返回空字符串。
5. doi 仅返回 DOI 本身；没有就返回空字符串。
6. keywords 提取 3-8 个核心学术关键词，英文逗号分隔；无法确认时返回空字符串。
7. 不要输出 markdown、解释或额外文本。

文件名：{file_name}
当前标题猜测：{title_guess}
正文前段：
{text}
"#;

fn import_rename_system() -> String {
    specialist_system(
        "论文元数据识别助手",
        "从文件名和正文片段中提取稳定、可信的论文元数据。",
        Some("输出必须严格、克制、可直接用于归档。"),
    )
}

#[tauri::command]
pub async fn papers_upload(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    file_path: tauri_plugin_fs::FilePath,
    research_interest_id: Option<String>,
    suggested_title: Option<String>,
) -> Result<serde_json::Value, String> {
    let path = canonical_pdf_file(file_path.into_path().map_err(|e| e.to_string())?)?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown.pdf");
    let original_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("unknown")
        .to_string();
    let title_guess = file_name
        .strip_suffix(".pdf")
        .unwrap_or(file_name)
        .replace(['_', '-'], " ");

    // 调用方若提供了已知标题（如 arXiv 推荐导入），优先使用，
    // 避免文件名推断把标题中的 `-`/`_` 误转成空格，同时让最终文件名以标题命名。
    let (detected_title, desired_stem) = match suggested_title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(title) => (title.to_string(), sanitize_file_stem(title)),
        None => (title_guess.clone(), original_stem.clone()),
    };

    let settings = state.settings.read().await.clone();
    let recognize_title = settings
        .get("paper_import_recognize_title")
        .map(|v| v.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(true);
    let recognize_authors = settings
        .get("paper_import_recognize_authors")
        .map(|v| v.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(true);
    let recognize_year = settings
        .get("paper_import_recognize_year")
        .map(|v| v.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(true);
    let recognize_venue = settings
        .get("paper_import_recognize_venue")
        .map(|v| v.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(true);
    let recognize_keywords = settings
        .get("paper_import_recognize_keywords")
        .map(|v| v.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(true);

    // 前台不再解析 PDF，只用暂定标题，后台识别后更新
    // detected_title / desired_stem 已在上方根据 suggested_title 或文件名确定
    let detected_authors: Option<String> = None;
    let detected_year: Option<i64> = None;
    let detected_venue: Option<String> = None;
    let detected_doi: Option<String> = None;
    let tags_json = "[]".to_string();
    let any_recognition = recognize_title
        || recognize_authors
        || recognize_year
        || recognize_venue
        || recognize_keywords;
    let file_name_owned = file_name.to_string();

    // Always copy into the app-managed papers directory so the file survives
    // even if the user deletes or moves the original in Finder.
    let copy_started_at = Instant::now();
    let final_path = copy_to_managed_papers_dir(&app, &path, &desired_stem)?;
    eprintln!(
        "[paper-import] copy_pdf done: source={} target={} elapsed_ms={}",
        path.display(),
        final_path.display(),
        copy_started_at.elapsed().as_millis()
    );
    let file_path_str = final_path.to_string_lossy().to_string();

    let paper_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    eprintln!(
        "[paper-import][{}] upload start: file={} any_recognition={} chunk_size={} chunk_overlap={}",
        paper_id,
        file_name_owned,
        any_recognition,
        settings.get("chunk_size").cloned().unwrap_or_else(|| "800".to_string()),
        settings.get("chunk_overlap").cloned().unwrap_or_else(|| "150".to_string())
    );

    sqlx::query(
        "INSERT INTO papers (id, title, authors, year, venue, doi, file_path, full_text, research_interest_id, tags, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)",
    )
    .bind(&paper_id)
    .bind(&detected_title)
    .bind(&detected_authors)
    .bind(detected_year)
    .bind(&detected_venue)
    .bind(&detected_doi)
    .bind(&file_path_str)
    .bind(Option::<String>::None)
    .bind(&research_interest_id)
    .bind(&tags_json)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    // Background: chunk + embed
    let db = state.db.clone();
    let pid = paper_id.clone();
    let path_for_parse = final_path.clone();
    let chunk_size: usize = settings
        .get("chunk_size")
        .and_then(|v| v.parse().ok())
        .unwrap_or(800);
    let chunk_overlap: usize = settings
        .get("chunk_overlap")
        .and_then(|v| v.parse().ok())
        .unwrap_or(150);

    tokio::spawn(async move {
        let pipeline_started_at = Instant::now();
        eprintln!("[paper-import][{}] background pipeline start", pid);
        let parsing_now = chrono::Utc::now().to_rfc3339();
        let _ = sqlx::query("UPDATE papers SET status = 'parsing', updated_at = ? WHERE id = ?")
            .bind(&parsing_now)
            .bind(&pid)
            .execute(&db)
            .await;
        let _ = app.emit(
            "paper:status",
            json!({ "paper_id": pid, "status": "parsing" }),
        );
        eprintln!("[paper-import][{}] status=parsing emitted", pid);

        let parse_result = match parse_pdf_document(&db, &pid, path_for_parse.clone()).await {
            Ok(value) => value,
            Err(error) => {
                let now = chrono::Utc::now().to_rfc3339();
                let _ =
                    sqlx::query("UPDATE papers SET status = 'failed', updated_at = ? WHERE id = ?")
                        .bind(&now)
                        .bind(&pid)
                        .execute(&db)
                        .await;
                let _ = app.emit(
                    "paper:status",
                    json!({ "paper_id": pid, "status": "failed", "error": error }),
                );
                eprintln!("[paper-import][{}] parse adapter failed", pid);
                return;
            }
        };
        let parser_name = parse_result.parser_name;
        let text_length = parse_result.text_length;
        let preview_length = parse_result.preview_length;
        let duration_ms = parse_result.duration_ms;
        let text = parse_result.text;
        let preview_text = parse_result.preview_text;
        eprintln!(
            "[paper-import][{}] parse adapter done: parser={} chars={} preview_chars={} elapsed_ms={}",
            pid, parser_name, text_length, preview_length, duration_ms
        );

        // ④ 基于有效预览文本做本地快速识别并更新初始字段
        let venue_and_kw_started_at = Instant::now();
        let inferred_venue = infer_from_text(&preview_text).map(|tag| tag.full_name);
        let preview_keywords =
            crate::commands::paper_analysis_text::extract_keywords_from_text(&preview_text);
        let preview_tags =
            serde_json::to_string(&preview_keywords).unwrap_or_else(|_| "[]".to_string());
        if inferred_venue.is_some() || !preview_keywords.is_empty() {
            let now = chrono::Utc::now().to_rfc3339();
            let _ = sqlx::query(
                "UPDATE papers SET venue = COALESCE(?, venue), tags = ?, updated_at = ? WHERE id = ?"
            )
            .bind(&inferred_venue)
            .bind(&preview_tags)
            .bind(&now)
            .bind(&pid)
            .execute(&db)
            .await;
        }
        eprintln!(
            "[paper-import][{}] preview infer done: venue={} keywords={} elapsed_ms={}",
            pid,
            inferred_venue.is_some(),
            preview_keywords.len(),
            venue_and_kw_started_at.elapsed().as_millis()
        );

        // ⑤ LLM 元数据识别
        let metadata_started_at = Instant::now();
        let metadata_opt = if any_recognition && !preview_text.is_empty() {
            extract_import_metadata(&settings, &file_name_owned, &title_guess, &preview_text).await
        } else {
            None
        };
        eprintln!(
            "[paper-import][{}] metadata step done: recognized={} elapsed_ms={}",
            pid,
            metadata_opt.is_some(),
            metadata_started_at.elapsed().as_millis()
        );

        if let Some(ref metadata) = metadata_opt {
            let meta_title = if recognize_title {
                clean_optional_text(metadata.title.clone())
            } else {
                None
            };
            let meta_authors = if recognize_authors {
                clean_optional_text(metadata.authors.clone())
            } else {
                None
            };
            let meta_year: Option<i64> = if recognize_year {
                metadata.year.filter(|v| *v > 0)
            } else {
                None
            };
            let meta_venue = if recognize_venue {
                clean_optional_text(metadata.venue.clone()).or(inferred_venue.clone())
            } else {
                None
            };
            let meta_doi = clean_optional_text(metadata.doi.clone());
            let meta_now = chrono::Utc::now().to_rfc3339();
            let _ = sqlx::query(
                "UPDATE papers SET title = COALESCE(?, title), authors = COALESCE(?, authors), year = COALESCE(?, year), venue = COALESCE(?, venue), doi = COALESCE(?, doi), updated_at = ? WHERE id = ?"
            )
            .bind(meta_title)
            .bind(meta_authors)
            .bind(meta_year)
            .bind(meta_venue)
            .bind(meta_doi)
            .bind(&meta_now)
            .bind(&pid)
            .execute(&db)
            .await;
            let _ = app.emit(
                "paper:status",
                json!({ "paper_id": pid, "status": "metadata" }),
            );
            eprintln!("[paper-import][{}] status=metadata emitted", pid);
        }

        if text.trim().is_empty() {
            let now = chrono::Utc::now().to_rfc3339();
            let _ = sqlx::query("UPDATE papers SET status = 'failed', updated_at = ? WHERE id = ?")
                .bind(&now)
                .bind(&pid)
                .execute(&db)
                .await;
            let _ = app.emit(
                "paper:status",
                json!({
                    "paper_id": pid,
                    "status": "failed",
                    "error": "PDF 未解析到可用正文，请重新导入或更换可复制文本的 PDF。"
                }),
            );
            eprintln!("[paper-import][{}] full_text empty after extraction", pid);
            return;
        }

        let refreshed_keywords =
            crate::commands::paper_analysis_text::extract_keywords_from_text(&text);
        let refreshed_tags =
            serde_json::to_string(&refreshed_keywords).unwrap_or_else(|_| "[]".to_string());
        let parsed_now = chrono::Utc::now().to_rfc3339();
        let _ = sqlx::query("UPDATE papers SET full_text = ?, tags = ?, status = 'parsed', updated_at = ? WHERE id = ?")
            .bind(&text)
            .bind(&refreshed_tags)
            .bind(&parsed_now)
            .bind(&pid)
            .execute(&db)
            .await;
        // 全文已写入，立即通知前端 parsed，后续 embedding 在后台静默完成
        let _ = app.emit(
            "paper:status",
            json!({ "paper_id": pid, "status": "parsed" }),
        );
        eprintln!(
            "[paper-import][{}] status=parsed emitted (full_text ready) elapsed_ms={}",
            pid,
            pipeline_started_at.elapsed().as_millis()
        );

        let chunk_started_at = Instant::now();
        let chunks = chunk_text(&text, chunk_size, chunk_overlap);
        eprintln!(
            "[paper-import][{}] chunking done: chunks={} elapsed_ms={}",
            pid,
            chunks.len(),
            chunk_started_at.elapsed().as_millis()
        );
        let contents: Vec<String> = chunks.iter().map(|c| c.content.clone()).collect();
        let embedding_batch_size = settings
            .get("embedding_batch_size")
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(48)
            .clamp(8, 128);
        let embedding_batches = if contents.is_empty() {
            0
        } else {
            (contents.len() + embedding_batch_size - 1) / embedding_batch_size
        };
        let embedding_started_at = Instant::now();
        eprintln!(
            "[paper-import][{}] embedding start: chunks={} batch_size={} batches={}",
            pid,
            contents.len(),
            embedding_batch_size,
            embedding_batches
        );
        let embeddings: Option<Vec<Vec<f32>>> =
            if let Ok(client) = LlmClient::embed_client_from_settings(&settings) {
                embed_in_batches(&client, &contents, embedding_batch_size).await
            } else {
                None
            };
        match embeddings.as_ref() {
            Some(values) => {
                eprintln!(
                    "[paper-import][{}] embedding done: vectors={} elapsed_ms={}",
                    pid,
                    values.len(),
                    embedding_started_at.elapsed().as_millis()
                );
            }
            None => {
                eprintln!(
                    "[paper-import][{}] embedding unavailable_or_failed elapsed_ms={}",
                    pid,
                    embedding_started_at.elapsed().as_millis()
                );
            }
        }

        let chunk_now = chrono::Utc::now().to_rfc3339();
        let insert_started_at = Instant::now();
        let mut inserted_with_tx = false;
        if let Ok(mut tx) = db.begin().await {
            let mut tx_failed = false;
            for (i, chunk) in chunks.iter().enumerate() {
                let chunk_id = Uuid::new_v4().to_string();
                let emb_str: Option<String> = embeddings
                    .as_ref()
                    .and_then(|v| v.get(i))
                    .map(|e| serialize_embedding(e));
                let idx = chunk.chunk_index as i64;
                if sqlx::query(
                    "INSERT INTO paper_chunks (id, paper_id, chunk_index, content, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                )
                .bind(&chunk_id)
                .bind(&pid)
                .bind(idx)
                .bind(&chunk.content)
                .bind(&emb_str)
                .bind(&chunk_now)
                .execute(&mut *tx)
                .await
                .is_err()
                {
                    tx_failed = true;
                    break;
                }
            }

            if tx_failed {
                let _ = tx.rollback().await;
            } else if tx.commit().await.is_ok() {
                inserted_with_tx = true;
            }
        }

        if !inserted_with_tx {
            for (i, chunk) in chunks.iter().enumerate() {
                let chunk_id = Uuid::new_v4().to_string();
                let emb_str: Option<String> = embeddings
                    .as_ref()
                    .and_then(|v| v.get(i))
                    .map(|e| serialize_embedding(e));
                let idx = chunk.chunk_index as i64;
                let _ = sqlx::query(
                    "INSERT INTO paper_chunks (id, paper_id, chunk_index, content, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                )
                .bind(&chunk_id)
                .bind(&pid)
                .bind(idx)
                .bind(&chunk.content)
                .bind(&emb_str)
                .bind(&chunk_now)
                .execute(&db)
                .await;
            }
        }

        eprintln!(
            "[paper-import][{}] chunk insert done: used_tx={} elapsed_ms={}",
            pid,
            inserted_with_tx,
            insert_started_at.elapsed().as_millis()
        );
        eprintln!(
            "[paper-import][{}] pipeline complete total_elapsed_ms={}",
            pid,
            pipeline_started_at.elapsed().as_millis()
        );
    });

    Ok(json!({ "paper_id": paper_id, "title": detected_title }))
}

// ── Analyze (Multi-Agent Deep Analysis) ─────────────────────────

fn missing_full_text_message(status: &str) -> &'static str {
    match status {
        "uploaded" | "parsing" => "论文仍在解析中，请稍后再试。",
        "failed" | "error" => "论文解析失败，请重新导入 PDF 后再试。",
        _ => "论文正文为空，请重新导入或更换可复制文本的 PDF。",
    }
}

#[tauri::command]
pub async fn papers_analyze(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let row = sqlx::query("SELECT file_path, full_text, status FROM papers WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("未找到对应论文。")?;
    let full_text: String = row
        .get::<Option<String>, _>("full_text")
        .unwrap_or_default();
    let file_path_for_spawn: Option<String> = row.get("file_path");
    let status = row.get::<Option<String>, _>("status").unwrap_or_default();
    if full_text.trim().is_empty() {
        return Err(missing_full_text_message(&status).to_string());
    }
    let settings = state.settings.read().await.clone();
    let refreshed_keywords =
        crate::commands::paper_analysis_text::extract_keywords_from_text(&full_text);
    if !refreshed_keywords.is_empty() {
        let tags_json =
            serde_json::to_string(&refreshed_keywords).unwrap_or_else(|_| "[]".to_string());
        let now = chrono::Utc::now().to_rfc3339();
        let _ = sqlx::query("UPDATE papers SET tags = ?, updated_at = ? WHERE id = ?")
            .bind(&tags_json)
            .bind(&now)
            .bind(&id)
            .execute(&state.db)
            .await;
    }
    let db = state.db.clone();
    let pid = id.clone();
    let app_for_spawn = app.clone();
    let previous_status = status.clone();

    let analysis_chunk_bytes = settings
        .get("paper_analysis_chunk_bytes")
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(30_000)
        .clamp(12_000, 80_000);

    let now_pre = chrono::Utc::now().to_rfc3339();
    let _ = sqlx::query("UPDATE papers SET status = 'analyzing', updated_at = ? WHERE id = ?")
        .bind(&now_pre)
        .bind(&id)
        .execute(&state.db)
        .await;

    tokio::spawn(async move {
        let app = app_for_spawn;
        let (client, is_scoped) = match LlmClient::scoped_client_from_settings(
            &settings,
            &[
                "paper_analysis_base_url",
                "multi_agent_paper_analyst_base_url",
            ],
            &[
                "paper_analysis_api_key",
                "multi_agent_paper_analyst_api_key",
            ],
            &["paper_analysis_model", "multi_agent_paper_analyst_model"],
        ) {
            Ok((c, s)) => (c, s),
            Err(e) => {
                restore_paper_status(&db, &pid, &previous_status).await;
                let _ = app.emit(
                    "paper:status",
                    json!({ "paper_id": pid, "status": "error", "error": e.to_string() }),
                );
                return;
            }
        };
        let model = if is_scoped {
            None
        } else {
            resolve_model(
                &settings,
                &[
                    "paper_analysis_model",
                    "multi_agent_paper_analyst_model",
                    "multi_agent_worker_model",
                ],
            )
        };
        let temperature = resolve_temperature(&settings, "paper_analysis_temperature", 0.3);
        let max_tokens = resolve_max_tokens(
            &settings,
            &[
                "paper_analysis_max_tokens",
                "multi_agent_paper_analyst_max_tokens",
                "multi_agent_worker_max_tokens",
            ],
            16_384,
        );
        let mut agent_errors: Vec<String> = Vec::new();

        // ── Phase 0: Figure extraction ────────────────────────────
        let _ = app.emit(
            "paper:status",
            json!({ "paper_id": pid, "status": "analyzing", "step": "图表提取中…" }),
        );
        // Prefer the dedicated "视界" vision model; fall back to the main analysis model
        let (vision_ref, vision_model_owned);
        let (vision_client_opt, vision_model_opt): (Option<&LlmClient>, Option<&str>) =
            if let Some((vc, vm)) = LlmClient::vision_client_from_settings(&settings) {
                vision_ref = vc;
                vision_model_owned = vm;
                (Some(&vision_ref), vision_model_owned.as_deref())
            } else {
                (Some(&client), model.as_deref())
            };

        let figure_timeout_secs = settings
            .get("paper_figure_extract_timeout_secs")
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(45)
            .clamp(15, 180);

        let extracted_figures = match tokio::time::timeout(
            std::time::Duration::from_secs(figure_timeout_secs),
            ensure_paper_figures_extracted(
                &app,
                &db,
                &pid,
                file_path_for_spawn.as_deref(),
                &full_text,
                vision_client_opt,
                vision_model_opt,
            ),
        )
        .await
        {
            Ok(figures) => figures,
            Err(_) => {
                eprintln!(
                    "[paper-analyze][{}] figure extraction timed out after {}s; continue without figure context",
                    pid, figure_timeout_secs
                );
                let _ = app.emit(
                    "paper:status",
                    json!({
                        "paper_id": pid,
                        "status": "analyzing",
                        "step": "图表提取超时，已跳过并继续分析…"
                    }),
                );
                Vec::new()
            }
        };

        let all_figure_context = build_all_figure_context(&extracted_figures);

        // ── Agent 1: Problem & Background + 论文类型判定 ──────────
        let _ = app.emit(
            "paper:status",
            json!({ "paper_id": pid, "status": "analyzing", "step": "问题背景分析中（1/4）…" }),
        );
        let intro_text = build_intro_slice(&full_text, analysis_chunk_bytes);
        let prompt1_text = format!("{all_figure_context}{intro_text}");
        let prompt1 = build_agent1_prompt(&prompt1_text);
        let msgs1 = vec![
            LlmMessage::system(agent1_system()),
            LlmMessage::user(&prompt1),
        ];
        log_llm_request(
            "paper-analyze",
            &pid,
            "agent1",
            model.as_deref(),
            temperature,
            max_tokens,
            &msgs1,
        );
        let (research_question, paper_type, paper_type_label) = match client
            .chat_with_max_tokens(&msgs1, model.as_deref(), temperature, max_tokens)
            .await
        {
            Ok(resp) => {
                log_llm_response("paper-analyze", &pid, "agent1", &resp);
                match parse_llm_json_value(&resp) {
                    Ok(value) => (
                        value["research_question"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                        value["paper_type"].as_str().unwrap_or("").to_string(),
                        value["type_label"].as_str().unwrap_or("").to_string(),
                    ),
                    Err(error) => {
                        eprintln!("[paper-analyze][{}] agent1 parse failed: {}", pid, error);
                        agent_errors.push(format!("问题背景分析返回格式错误：{error}"));
                        (String::new(), String::new(), String::new())
                    }
                }
            }
            Err(error) => {
                eprintln!("[paper-analyze][{}] agent1 failed: {}", pid, error);
                agent_errors.push(format!("问题背景分析失败：{error}"));
                (String::new(), String::new(), String::new())
            }
        };

        // 按论文类型选择切片策略：综述/理论/人文社科等用全文等分覆盖，
        // 其余（含未识别）沿用 method/experiment 锚定，保持既有行为。
        let layout = match paper_type.trim().to_ascii_lowercase().as_str() {
            "review" | "survey" | "theory" | "humanities" | "case_study" => {
                PaperAnalysisLayout::Holistic
            }
            _ => PaperAnalysisLayout::MethodExperiment,
        };
        let analysis_slices = build_analysis_slices(&full_text, analysis_chunk_bytes, layout);
        let method_text = analysis_slices.method_text;
        let experiment_text = analysis_slices.experiment_text;
        let type_directive = build_type_directive(&paper_type_label);

        // ── Agent 2: Method Deep-Dive ─────────────────────────────
        let _ = app.emit(
            "paper:status",
            json!({ "paper_id": pid, "status": "analyzing", "step": "方法深度解析中（2/4）…" }),
        );
        let method_prompt_text = format!("{type_directive}{all_figure_context}{method_text}");
        let prompt2 = build_agent2_prompt(&research_question, &method_prompt_text);
        let msgs2 = vec![
            LlmMessage::system(agent2_system()),
            LlmMessage::user(&prompt2),
        ];
        log_llm_request(
            "paper-analyze",
            &pid,
            "agent2",
            model.as_deref(),
            temperature,
            max_tokens,
            &msgs2,
        );
        let core_method = match client
            .chat_with_max_tokens(&msgs2, model.as_deref(), temperature, max_tokens)
            .await
        {
            Ok(resp) => {
                log_llm_response("paper-analyze", &pid, "agent2", &resp);
                match parse_llm_json_value(&resp) {
                    Ok(value) => value["core_method"].as_str().unwrap_or("").to_string(),
                    Err(error) => {
                        eprintln!("[paper-analyze][{}] agent2 parse failed: {}", pid, error);
                        agent_errors.push(format!("方法解析返回格式错误：{error}"));
                        String::new()
                    }
                }
            }
            Err(error) => {
                eprintln!("[paper-analyze][{}] agent2 failed: {}", pid, error);
                agent_errors.push(format!("方法解析失败：{error}"));
                String::new()
            }
        };

        // ── Agent 3: Experiment Analysis ──────────────────────────
        let _ = app.emit(
            "paper:status",
            json!({ "paper_id": pid, "status": "analyzing", "step": "证据与结果分析中（3/4）…" }),
        );
        let experiment_prompt_text =
            format!("{type_directive}{all_figure_context}{experiment_text}");
        let prompt3 = build_agent3_prompt(&core_method, &experiment_prompt_text);
        let msgs3 = vec![
            LlmMessage::system(agent3_system()),
            LlmMessage::user(&prompt3),
        ];
        log_llm_request(
            "paper-analyze",
            &pid,
            "agent3",
            model.as_deref(),
            temperature,
            max_tokens,
            &msgs3,
        );
        let (experiment_design, experiment_results) = match client
            .chat_with_max_tokens(&msgs3, model.as_deref(), temperature, max_tokens)
            .await
        {
            Ok(resp) => {
                log_llm_response("paper-analyze", &pid, "agent3", &resp);
                match parse_llm_json_value(&resp) {
                    Ok(value) => (
                        value["experiment_design"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                        value["experiment_results"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                    ),
                    Err(error) => {
                        eprintln!("[paper-analyze][{}] agent3 parse failed: {}", pid, error);
                        agent_errors.push(format!("证据与结果分析返回格式错误：{error}"));
                        (String::new(), String::new())
                    }
                }
            }
            Err(error) => {
                eprintln!("[paper-analyze][{}] agent3 failed: {}", pid, error);
                agent_errors.push(format!("证据与结果分析失败：{error}"));
                (String::new(), String::new())
            }
        };

        // ── Agent 4: Synthesis & Critique ─────────────────────────
        let _ = app.emit(
            "paper:status",
            json!({ "paper_id": pid, "status": "analyzing", "step": "综合评审中（4/4）…" }),
        );
        let experiment_summary = format!("{}\n\n{}", experiment_design, experiment_results);
        let problem_summary_for_review =
            format!("{type_directive}{all_figure_context}{research_question}");
        let prompt4 = build_agent4_prompt(
            &problem_summary_for_review,
            &core_method,
            &experiment_summary,
        );
        let msgs4 = vec![
            LlmMessage::system(agent4_system()),
            LlmMessage::user(&prompt4),
        ];
        log_llm_request(
            "paper-analyze",
            &pid,
            "agent4",
            model.as_deref(),
            temperature,
            max_tokens,
            &msgs4,
        );
        let (innovations, limitations, key_conclusions) = match client
            .chat_with_max_tokens(&msgs4, model.as_deref(), temperature, max_tokens)
            .await
        {
            Ok(resp) => {
                log_llm_response("paper-analyze", &pid, "agent4", &resp);
                match parse_llm_json_value(&resp) {
                    Ok(value) => (
                        value["innovations"].as_str().unwrap_or("").to_string(),
                        value["limitations"].as_str().unwrap_or("").to_string(),
                        value["key_conclusions"].as_str().unwrap_or("").to_string(),
                    ),
                    Err(error) => {
                        eprintln!("[paper-analyze][{}] agent4 parse failed: {}", pid, error);
                        agent_errors.push(format!("综合评审返回格式错误：{error}"));
                        (String::new(), String::new(), String::new())
                    }
                }
            }
            Err(error) => {
                eprintln!("[paper-analyze][{}] agent4 failed: {}", pid, error);
                agent_errors.push(format!("综合评审失败：{error}"));
                (String::new(), String::new(), String::new())
            }
        };

        if [
            research_question.trim(),
            core_method.trim(),
            experiment_design.trim(),
            experiment_results.trim(),
            innovations.trim(),
            limitations.trim(),
            key_conclusions.trim(),
        ]
        .iter()
        .all(|value| value.is_empty())
        {
            restore_paper_status(&db, &pid, &previous_status).await;
            let error_message = agent_errors
                .into_iter()
                .find(|value| !value.trim().is_empty())
                .unwrap_or_else(|| {
                    "论文解读未生成有效内容，请检查模型配置或稍后重试。".to_string()
                });
            let _ = app.emit(
                "paper:status",
                json!({
                    "paper_id": pid,
                    "status": "error",
                    "error": error_message
                }),
            );
            eprintln!(
                "[paper-analyze][{}] all agent outputs empty; skip persist",
                pid
            );
            return;
        }

        // ── Persist ───────────────────────────────────────────────
        let analysis_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let raw = serde_json::to_string(&json!({
            "research_question": research_question,
            "core_method": core_method,
            "experiment_design": experiment_design,
            "experiment_results": experiment_results,
            "innovations": innovations,
            "limitations": limitations,
            "key_conclusions": key_conclusions,
        }))
        .unwrap_or_default();

        let _ = sqlx::query(
            "INSERT INTO paper_analyses (id, paper_id, research_question, core_method, experiment_design, experiment_results, innovations, limitations, key_conclusions, raw_analysis, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(paper_id) DO UPDATE SET
               research_question = excluded.research_question, core_method = excluded.core_method,
               experiment_design = excluded.experiment_design, experiment_results = excluded.experiment_results,
               innovations = excluded.innovations, limitations = excluded.limitations,
               key_conclusions = excluded.key_conclusions, raw_analysis = excluded.raw_analysis",
        )
        .bind(&analysis_id).bind(&pid)
        .bind(&research_question).bind(&core_method)
        .bind(&experiment_design).bind(&experiment_results)
        .bind(&innovations).bind(&limitations)
        .bind(&key_conclusions).bind(&raw).bind(&now)
        .execute(&db).await;

        let _ = sqlx::query("UPDATE papers SET status = 'analyzed', updated_at = ? WHERE id = ?")
            .bind(&now)
            .bind(&pid)
            .execute(&db)
            .await;
        let _ = app.emit(
            "paper:status",
            json!({ "paper_id": pid, "status": "analyzed" }),
        );
    });
    Ok(())
}

// ── Reproduce ────────────────────────────────────────────────────

#[tauri::command]
pub async fn papers_reproduce(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let row = sqlx::query("SELECT full_text, status FROM papers WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("未找到对应论文。")?;
    let full_text: String = row
        .get::<Option<String>, _>("full_text")
        .unwrap_or_default();
    let status = row.get::<Option<String>, _>("status").unwrap_or_default();
    if full_text.trim().is_empty() {
        return Err(missing_full_text_message(&status).to_string());
    }
    let reproduction_context = build_reproduction_context(&full_text, 24_000);
    let settings = state.settings.read().await.clone();
    let db = state.db.clone();
    let pid = id.clone();
    let prompt = build_reproduce_prompt(&reproduction_context);
    let previous_status = status.clone();

    let now_pre = chrono::Utc::now().to_rfc3339();
    let _ = sqlx::query("UPDATE papers SET status = 'analyzing', updated_at = ? WHERE id = ?")
        .bind(&now_pre)
        .bind(&id)
        .execute(&state.db)
        .await;

    tokio::spawn(async move {
        let (client, is_scoped) = match LlmClient::scoped_client_from_settings(
            &settings,
            &[
                "paper_reproduction_base_url",
                "multi_agent_reproduction_base_url",
            ],
            &[
                "paper_reproduction_api_key",
                "multi_agent_reproduction_api_key",
            ],
            &["paper_reproduction_model", "multi_agent_reproduction_model"],
        ) {
            Ok((c, s)) => (c, s),
            Err(e) => {
                restore_paper_status(&db, &pid, &previous_status).await;
                let _ = app.emit(
                    "paper:status",
                    json!({ "paper_id": pid, "status": "error", "error": e.to_string() }),
                );
                return;
            }
        };
        let model = if is_scoped {
            None
        } else {
            resolve_model(
                &settings,
                &[
                    "paper_reproduction_model",
                    "multi_agent_reproduction_model",
                    "multi_agent_worker_model",
                ],
            )
        };
        let temperature = resolve_temperature(&settings, "paper_reproduction_temperature", 0.25);
        let max_tokens = resolve_max_tokens(
            &settings,
            &[
                "paper_reproduction_max_tokens",
                "multi_agent_reproduction_max_tokens",
                "multi_agent_worker_max_tokens",
            ],
            16_384,
        );
        let msgs = vec![
            LlmMessage::system(reproduce_system()),
            LlmMessage::user(&prompt),
        ];
        log_llm_request(
            "paper-reproduce",
            &pid,
            "guide",
            model.as_deref(),
            temperature,
            max_tokens,
            &msgs,
        );
        let _ = app.emit(
            "paper:status",
            json!({ "paper_id": pid, "status": "analyzing", "step": "复现/验证指南生成中…" }),
        );

        match client
            .chat_with_max_tokens(&msgs, model.as_deref(), temperature, max_tokens)
            .await
        {
            Ok(response) => {
                log_llm_response("paper-reproduce", &pid, "guide", &response);
                let _ = app.emit(
                    "paper:status",
                    json!({ "paper_id": pid, "status": "analyzing", "step": "复现/验证指南整理中…" }),
                );
                let v = match parse_llm_json_value(&response) {
                    Ok(value) => value,
                    Err(error) => {
                        restore_paper_status(&db, &pid, &previous_status).await;
                        let _ = app.emit(
                            "paper:status",
                            json!({ "paper_id": pid, "status": "error", "error": error }),
                        );
                        return;
                    }
                };
                let fields = reproduction_guide_fields_from_value(&v);
                if !fields.has_meaningful_content() {
                    restore_paper_status(&db, &pid, &previous_status).await;
                    let _ = app.emit(
                        "paper:status",
                        json!({
                            "paper_id": pid,
                            "status": "error",
                            "error": "复现/验证指南生成结果为空，请检查模型配置或稍后重试。"
                        }),
                    );
                    eprintln!(
                        "[paper-reproduce][{}] empty guide after parsing: {}",
                        pid,
                        extract_json(&response)
                    );
                    return;
                }
                let guide_id = Uuid::new_v4().to_string();
                let now = chrono::Utc::now().to_rfc3339();
                let raw = response.clone();
                let _ = sqlx::query(
                    "INSERT INTO reproduction_guides (id, paper_id, code_repository, environment_setup, dependencies, dataset_preparation, training_process, inference_process, evaluation_metrics, risks_and_notes, raw_guide, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(paper_id) DO UPDATE SET
                       code_repository = excluded.code_repository,
                       environment_setup = excluded.environment_setup, dependencies = excluded.dependencies,
                       dataset_preparation = excluded.dataset_preparation, training_process = excluded.training_process,
                       inference_process = excluded.inference_process, evaluation_metrics = excluded.evaluation_metrics,
                       risks_and_notes = excluded.risks_and_notes, raw_guide = excluded.raw_guide",
                )
                .bind(&guide_id).bind(&pid)
                .bind(fields.code_repository.as_deref()).bind(fields.environment_setup.as_deref())
                .bind(fields.dependencies.as_deref()).bind(fields.dataset_preparation.as_deref())
                .bind(fields.training_process.as_deref()).bind(fields.inference_process.as_deref())
                .bind(fields.evaluation_metrics.as_deref()).bind(fields.risks_and_notes.as_deref())
                .bind(&raw).bind(&now)
                .execute(&db).await;
                let _ = sqlx::query(
                    "UPDATE papers SET status = 'reproduced', updated_at = ? WHERE id = ?",
                )
                .bind(&now)
                .bind(&pid)
                .execute(&db)
                .await;
                let _ = app.emit(
                    "paper:status",
                    json!({ "paper_id": pid, "status": "reproduced" }),
                );
            }
            Err(e) => {
                restore_paper_status(&db, &pid, &previous_status).await;
                let _ = app.emit(
                    "paper:status",
                    json!({ "paper_id": pid, "status": "error", "error": e.to_string() }),
                );
            }
        }
    });
    Ok(())
}

// ── Generate Knowledge Note ──────────────────────────────────────

#[tauri::command]
pub async fn papers_generate_note(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let paper_row = sqlx::query(
        "SELECT title, authors, year, venue, doi, abstract, full_text, notes, research_interest_id, status FROM papers WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or("未找到对应论文。")?;

    let full_text: String = paper_row
        .get::<Option<String>, _>("full_text")
        .unwrap_or_default();
    let status = paper_row
        .get::<Option<String>, _>("status")
        .unwrap_or_default();
    if full_text.trim().is_empty() {
        return Err(missing_full_text_message(&status).to_string());
    }

    let title = paper_row
        .get::<Option<String>, _>("title")
        .unwrap_or_default();
    let authors = paper_row
        .get::<Option<String>, _>("authors")
        .unwrap_or_default();
    let year = paper_row
        .get::<Option<i64>, _>("year")
        .map(|y| y.to_string())
        .unwrap_or_default();
    let venue = paper_row
        .get::<Option<String>, _>("venue")
        .unwrap_or_default();
    let doi = paper_row
        .get::<Option<String>, _>("doi")
        .unwrap_or_default();
    let abstract_text = paper_row
        .get::<Option<String>, _>("abstract")
        .unwrap_or_default();
    let notes = paper_row
        .get::<Option<String>, _>("notes")
        .unwrap_or_default();
    let research_interest_id: Option<String> = paper_row.get("research_interest_id");

    let analysis_row = sqlx::query(
        "SELECT research_question, core_method, experiment_design, experiment_results, innovations, limitations, key_conclusions FROM paper_analyses WHERE paper_id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let analysis_text = analysis_row
        .map(|row| {
            let parts = [
                (
                    "研究问题",
                    row.get::<Option<String>, _>("research_question"),
                ),
                ("核心方法", row.get::<Option<String>, _>("core_method")),
                (
                    "实验设计",
                    row.get::<Option<String>, _>("experiment_design"),
                ),
                (
                    "实验结果",
                    row.get::<Option<String>, _>("experiment_results"),
                ),
                ("创新点", row.get::<Option<String>, _>("innovations")),
                ("局限", row.get::<Option<String>, _>("limitations")),
                ("关键结论", row.get::<Option<String>, _>("key_conclusions")),
            ];
            parts
                .iter()
                .filter_map(|(label, value)| {
                    value
                        .as_ref()
                        .filter(|v| !v.trim().is_empty())
                        .map(|v| format!("## {}\n\n{}", label, v))
                })
                .collect::<Vec<_>>()
                .join("\n\n")
        })
        .unwrap_or_default();

    let guide_row = sqlx::query(
        "SELECT code_repository, environment_setup, dependencies, dataset_preparation, training_process, inference_process, evaluation_metrics, risks_and_notes FROM reproduction_guides WHERE paper_id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let guide_text = guide_row
        .map(|row| {
            let parts = [
                ("代码仓库", row.get::<Option<String>, _>("code_repository")),
                (
                    "环境配置",
                    row.get::<Option<String>, _>("environment_setup"),
                ),
                ("依赖", row.get::<Option<String>, _>("dependencies")),
                (
                    "数据准备",
                    row.get::<Option<String>, _>("dataset_preparation"),
                ),
                ("训练流程", row.get::<Option<String>, _>("training_process")),
                (
                    "推理流程",
                    row.get::<Option<String>, _>("inference_process"),
                ),
                (
                    "评估指标",
                    row.get::<Option<String>, _>("evaluation_metrics"),
                ),
                ("注意事项", row.get::<Option<String>, _>("risks_and_notes")),
            ];
            parts
                .iter()
                .filter_map(|(label, value)| {
                    value
                        .as_ref()
                        .filter(|v| !v.trim().is_empty())
                        .map(|v| format!("## {}\n\n{}", label, v))
                })
                .collect::<Vec<_>>()
                .join("\n\n")
        })
        .unwrap_or_default();

    let settings = state.settings.read().await.clone();
    let client = LlmClient::from_settings(&settings).map_err(|e| e.to_string())?;
    let model = resolve_model(
        &settings,
        &[
            "paper_note_model",
            "paper_analysis_model",
            "multi_agent_paper_analyst_model",
            "multi_agent_worker_model",
        ],
    );
    let temperature = resolve_temperature(&settings, "paper_note_temperature", 0.3);
    let max_tokens = resolve_max_tokens(
        &settings,
        &[
            "paper_note_max_tokens",
            "paper_analysis_max_tokens",
            "multi_agent_paper_analyst_max_tokens",
            "multi_agent_worker_max_tokens",
        ],
        16_384,
    );

    let prompt = build_paper_note_prompt(
        &title,
        &authors,
        &year,
        &venue,
        &doi,
        &abstract_text,
        &analysis_text,
        &guide_text,
        &notes,
    );
    let msgs = vec![
        LlmMessage::system(paper_note_system()),
        LlmMessage::user(&prompt),
    ];
    log_llm_request(
        "paper-note",
        &id,
        "generate",
        model.as_deref(),
        temperature,
        max_tokens,
        &msgs,
    );

    let response = client
        .chat_with_max_tokens(&msgs, model.as_deref(), temperature, max_tokens)
        .await
        .map_err(|e| format!("生成笔记失败：{}", e))?;
    log_llm_response("paper-note", &id, "generate", &response);

    let value = parse_llm_json_value(&response).map_err(|e| format!("解析笔记结果失败：{}", e))?;
    let note_title = generated_paper_note_title(&title, value["title"].as_str());
    let note_content = value["content"].as_str().unwrap_or("").to_string();
    if note_content.trim().is_empty() {
        return Err("小妍未能生成有效笔记内容，请检查模型配置或稍后重试。".to_string());
    }
    let note_tags: Vec<String> = value["tags"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let note = create_note_core(
        &state.db,
        &settings,
        note_title,
        note_content,
        if note_tags.is_empty() {
            None
        } else {
            Some(note_tags)
        },
        research_interest_id,
        "paper_note",
        Some(id.clone()),
    )
    .await?;

    Ok(note)
}

// ── Helpers ──────────────────────────────────────────────────────

fn safe_text_preview(text: &str, max_bytes: usize) -> &str {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

pub fn extract_json_pub(s: &str) -> String {
    extract_json(s)
}

pub(crate) fn extract_json(s: &str) -> String {
    let s = s.trim();
    let s = if s.starts_with("```") {
        let mut lines = s.lines();
        let _opening_fence = lines.next();
        let body_lines: Vec<&str> = lines.collect();
        let has_closing_fence = body_lines
            .last()
            .is_some_and(|line| line.trim_start().starts_with("```"));
        if has_closing_fence {
            body_lines[..body_lines.len().saturating_sub(1)].join("\n")
        } else {
            body_lines.join("\n")
        }
    } else {
        s.to_string()
    };
    let start = s.find('{').unwrap_or(0);
    let end = s.rfind('}').map(|i| i + 1).unwrap_or(s.len());
    s[start..end].to_string()
}

async fn restore_paper_status(db: &sqlx::SqlitePool, paper_id: &str, fallback_status: &str) {
    // 优先根据已有产物决定状态：有复现指南 -> reproduced，有解读 -> analyzed。
    // 这样即使 fallback_status 因为某种原因是 parsed/empty，只要内容没丢，按钮就不会退化成「小妍解读」。
    let has_reproduction_guide = sqlx::query(
        "SELECT 1 FROM reproduction_guides WHERE paper_id = ? AND environment_setup IS NOT NULL AND trim(environment_setup) <> '' LIMIT 1",
    )
    .bind(paper_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .is_some();

    let has_analysis = if has_reproduction_guide {
        true
    } else {
        sqlx::query("SELECT 1 FROM paper_analyses WHERE paper_id = ? LIMIT 1")
            .bind(paper_id)
            .fetch_optional(db)
            .await
            .ok()
            .flatten()
            .is_some()
    };

    let next_status = if has_reproduction_guide {
        "reproduced"
    } else if has_analysis {
        "analyzed"
    } else if fallback_status.trim().is_empty() {
        "parsed"
    } else {
        fallback_status
    };
    let now = chrono::Utc::now().to_rfc3339();
    let _ = sqlx::query("UPDATE papers SET status = ?, updated_at = ? WHERE id = ?")
        .bind(next_status)
        .bind(&now)
        .bind(paper_id)
        .execute(db)
        .await;
}

fn parse_llm_json_value(response: &str) -> Result<serde_json::Value, String> {
    let clean = extract_json(response);
    serde_json::from_str::<serde_json::Value>(&clean).map_err(|error| {
        if error.is_eof() {
            "模型输出在 JSON 中途被截断，通常是 max_tokens 不足或回复过长。请提高当前功能对应的 max_tokens，或缩短模型输出。".to_string()
        } else {
            format!("模型返回的 JSON 解析失败：{error}")
        }
    })
}

fn log_llm_request(
    scope: &str,
    paper_id: &str,
    stage: &str,
    model: Option<&str>,
    temperature: f32,
    max_tokens: u32,
    messages: &[LlmMessage],
) {
    let rendered = messages
        .iter()
        .enumerate()
        .map(|(index, message)| {
            format!(
                "----- message {} ({}) -----\n{}",
                index + 1,
                message.role,
                message.content
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    eprintln!(
        "[{}][{}] {} request model={} temperature={} max_tokens={}\n===== BEGIN REQUEST =====\n{}\n===== END REQUEST =====",
        scope,
        paper_id,
        stage,
        model.unwrap_or("<default>"),
        temperature,
        max_tokens,
        rendered
    );
}

fn log_llm_response(scope: &str, paper_id: &str, stage: &str, response: &str) {
    eprintln!(
        "[{}][{}] {} response chars={}\n===== BEGIN RESPONSE =====\n{}\n===== END RESPONSE =====",
        scope,
        paper_id,
        stage,
        response.chars().count(),
        response
    );
}

#[derive(Default)]
struct ReproductionGuideFields {
    code_repository: Option<String>,
    environment_setup: Option<String>,
    dependencies: Option<String>,
    dataset_preparation: Option<String>,
    training_process: Option<String>,
    inference_process: Option<String>,
    evaluation_metrics: Option<String>,
    risks_and_notes: Option<String>,
}

impl ReproductionGuideFields {
    fn has_meaningful_content(&self) -> bool {
        [
            self.code_repository.as_deref(),
            self.environment_setup.as_deref(),
            self.dependencies.as_deref(),
            self.dataset_preparation.as_deref(),
            self.training_process.as_deref(),
            self.inference_process.as_deref(),
            self.evaluation_metrics.as_deref(),
            self.risks_and_notes.as_deref(),
        ]
        .into_iter()
        .flatten()
        .any(|value| !value.trim().is_empty())
    }
}

fn reproduction_guide_fields_from_value(value: &serde_json::Value) -> ReproductionGuideFields {
    ReproductionGuideFields {
        code_repository: json_text_field(value, "code_repository"),
        environment_setup: json_text_field(value, "environment_setup"),
        dependencies: json_text_field(value, "dependencies"),
        dataset_preparation: json_text_field(value, "dataset_preparation"),
        training_process: json_text_field(value, "training_process"),
        inference_process: json_text_field(value, "inference_process"),
        evaluation_metrics: json_text_field(value, "evaluation_metrics"),
        risks_and_notes: json_text_field(value, "risks_and_notes"),
    }
}

fn json_text_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty() && item != "暂无")
}

async fn extract_import_metadata(
    settings: &std::collections::HashMap<String, String>,
    file_name: &str,
    title_guess: &str,
    full_text: &str,
) -> Option<ImportRenameMetadata> {
    let client = LlmClient::from_settings(settings).ok()?;
    let text_preview = safe_text_preview(full_text, 12000);
    let prompt = IMPORT_RECOGNIZE_PROMPT
        .replace("{file_name}", file_name)
        .replace("{title_guess}", title_guess)
        .replace("{text}", text_preview);
    let messages = vec![
        LlmMessage::system(import_rename_system()),
        LlmMessage::user(prompt),
    ];
    let model = resolve_model(settings, &["planner_hint_model"]);
    let temperature = resolve_temperature(settings, "planner_hint_temperature", 0.2);
    let response = client
        .chat(&messages, model.as_deref(), temperature)
        .await
        .ok()?;
    let clean = extract_json(&response);
    serde_json::from_str::<ImportRenameMetadata>(&clean).ok()
}

#[allow(dead_code)]
fn render_import_file_stem(
    rule: &str,
    metadata: &ImportRenameMetadata,
    fallback_title: &str,
    original_stem: &str,
) -> String {
    if rule.trim().is_empty() {
        return sanitize_file_stem(original_stem);
    }

    let title = clean_optional_text(metadata.title.clone())
        .unwrap_or_else(|| fallback_title.trim().to_string());
    let authors = clean_optional_text(metadata.authors.clone()).unwrap_or_default();
    let first_author = extract_first_author(&authors);
    let year = metadata
        .year
        .filter(|value| *value > 0)
        .map(|value| value.to_string())
        .unwrap_or_default();
    let venue = clean_optional_text(metadata.venue.clone()).unwrap_or_default();
    let doi = clean_optional_text(metadata.doi.clone()).unwrap_or_default();

    let mut rendered = rule.to_string();
    for (token, value) in [
        ("{title}", title.as_str()),
        ("{authors}", authors.as_str()),
        ("{first_author}", first_author.as_str()),
        ("{year}", year.as_str()),
        ("{venue}", venue.as_str()),
        ("{doi}", doi.as_str()),
        ("{original_name}", original_stem),
    ] {
        rendered = rendered.replace(token, value);
    }

    sanitize_file_stem(&strip_placeholder_braces(&rendered))
}

fn clean_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.replace('\n', " ").trim().to_string())
        .filter(|item| !item.is_empty())
}

#[allow(dead_code)]
fn extract_first_author(authors: &str) -> String {
    authors
        .split(',')
        .next()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .unwrap_or_default()
        .to_string()
}

#[allow(dead_code)]
fn strip_placeholder_braces(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut brace_depth = 0usize;

    for ch in input.chars() {
        match ch {
            '{' => brace_depth += 1,
            '}' if brace_depth > 0 => brace_depth -= 1,
            _ if brace_depth == 0 => out.push(ch),
            _ => {}
        }
    }

    out
}

fn sanitize_file_stem(input: &str) -> String {
    let mut cleaned = String::with_capacity(input.len());

    for ch in input.chars() {
        if ch.is_control() {
            continue;
        }
        match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => cleaned.push(' '),
            _ => cleaned.push(ch),
        }
    }

    let mut normalized = cleaned
        .replace("()", " ")
        .replace("[]", " ")
        .replace("{}", " ")
        .replace("（）", " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    normalized = normalized
        .trim_matches(|ch: char| matches!(ch, ' ' | '-' | '_' | '.'))
        .to_string();

    if normalized.is_empty() {
        "untitled-paper".to_string()
    } else {
        normalized
    }
}

// ── Keyword extraction ────────────────────────────────────────────

/// Scan the first ~4000 chars of extracted PDF text for a "Keywords:" section.
/// Returns up to 10 cleaned keyword strings, or an empty vec if not found.
#[allow(dead_code)]
pub(crate) fn extract_keywords_from_text(full_text: &str) -> Vec<String> {
    let search_area = safe_text_preview(full_text, 4000);
    let lower = search_area.to_ascii_lowercase();

    let markers = [
        "keywords—",
        "keywords:",
        "key words:",
        "key words—",
        "index terms—",
        "index terms:",
        "index terms\n",
        "keywords\n",
    ];

    let kw_start = markers
        .iter()
        .find_map(|m| lower.find(m).map(|p| p + m.len()));
    let start = match kw_start {
        Some(s) => s,
        None => return Vec::new(),
    };

    let rest = &search_area[start..];
    // Stop at blank line or 500 chars (UTF-8 safe), whichever comes first
    let limited_rest = safe_text_preview(rest, 500);
    let end = limited_rest.find("\n\n").unwrap_or(limited_rest.len());
    let kw_text = &limited_rest[..end];

    kw_text
        .split([',', ';'])
        .map(|k| {
            k.lines()
                .next()
                .unwrap_or("")
                .trim()
                .trim_matches('.')
                .trim()
                .to_string()
        })
        .filter(|k| !k.is_empty() && k.len() > 1 && k.len() < 80)
        .take(10)
        .collect()
}

fn managed_papers_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let papers_dir = data_dir.join("papers");
    std::fs::create_dir_all(&papers_dir).map_err(|e| format!("无法创建 PDF 存储目录：{e}"))?;
    Ok(papers_dir)
}

fn copy_to_managed_papers_dir(
    app: &tauri::AppHandle,
    src: &Path,
    desired_stem: &str,
) -> Result<PathBuf, String> {
    let src = canonical_pdf_file(src.to_path_buf())?;
    let papers_dir = managed_papers_dir(app)?;
    let stem = sanitize_file_stem(desired_stem);
    let mut candidate = papers_dir.join(format!("{stem}.pdf"));
    if candidate.exists() {
        let mut found = false;
        for index in 2..1000 {
            let maybe = papers_dir.join(format!("{stem} ({index}).pdf"));
            if !maybe.exists() {
                candidate = maybe;
                found = true;
                break;
            }
        }
        if !found {
            return Err("目标目录中存在过多同名文件，无法完成复制。".to_string());
        }
    }
    std::fs::copy(&src, &candidate).map_err(|e| format!("复制 PDF 到工作目录失败：{e}"))?;
    canonical_path_within(&papers_dir, &candidate, "PDF 文件")
}

async fn embed_in_batches(
    client: &LlmClient,
    texts: &[String],
    batch_size: usize,
) -> Option<Vec<Vec<f32>>> {
    if texts.is_empty() {
        return Some(Vec::new());
    }

    let mut all_embeddings = Vec::with_capacity(texts.len());
    for batch in texts.chunks(batch_size.max(1)) {
        match client.embed(batch).await {
            Ok(mut embeddings) => all_embeddings.append(&mut embeddings),
            Err(_) => return None,
        }
    }
    Some(all_embeddings)
}

fn chunking_settings(settings: &HashMap<String, String>) -> (usize, usize, usize) {
    let chunk_size = settings
        .get("chunk_size")
        .and_then(|value| value.parse().ok())
        .unwrap_or(800);
    let chunk_overlap = settings
        .get("chunk_overlap")
        .and_then(|value| value.parse().ok())
        .unwrap_or(150);
    let embedding_batch_size = settings
        .get("embedding_batch_size")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(48)
        .clamp(8, 128);
    (chunk_size, chunk_overlap, embedding_batch_size)
}

async fn replace_paper_chunks(
    db: &sqlx::SqlitePool,
    settings: &HashMap<String, String>,
    paper_id: &str,
    text: &str,
) -> Result<(), String> {
    let (chunk_size, chunk_overlap, embedding_batch_size) = chunking_settings(settings);
    let chunks = chunk_text(text, chunk_size, chunk_overlap);
    let contents: Vec<String> = chunks.iter().map(|chunk| chunk.content.clone()).collect();
    let embeddings = if let Ok(client) = LlmClient::embed_client_from_settings(settings) {
        embed_in_batches(&client, &contents, embedding_batch_size).await
    } else {
        None
    };
    let chunk_now = chrono::Utc::now().to_rfc3339();

    let mut tx = db.begin().await.map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM paper_chunks WHERE paper_id = ?")
        .bind(paper_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;

    for (index, chunk) in chunks.iter().enumerate() {
        let chunk_id = Uuid::new_v4().to_string();
        let embedding = embeddings
            .as_ref()
            .and_then(|values| values.get(index))
            .map(|value| serialize_embedding(value));
        sqlx::query(
            "INSERT INTO paper_chunks (id, paper_id, chunk_index, content, embedding, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&chunk_id)
        .bind(paper_id)
        .bind(chunk.chunk_index as i64)
        .bind(&chunk.content)
        .bind(&embedding)
        .bind(&chunk_now)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    }

    tx.commit().await.map_err(|error| error.to_string())
}

fn paper_row_to_json(r: &sqlx::sqlite::SqliteRow, _include_file_path: bool) -> serde_json::Value {
    let tags_str: String = r
        .get::<Option<String>, _>("tags")
        .unwrap_or_else(|| "[]".into());
    // "abstract" is a Rust reserved keyword; fetch into a variable first
    let paper_abstract: Option<String> = r.get("abstract");
    let paper_venue: Option<String> = r.get("venue");
    let paper_doi: Option<String> = r.get("doi");
    let paper_file_path: Option<String> = r.get("file_path");
    let paper_title: String = r.get("title");
    let mut obj = json!({
        "id": r.get::<String, _>("id"),
        "title": paper_title,
        "authors": r.get::<Option<String>, _>("authors"),
        "year": r.get::<Option<i64>, _>("year"),
        "venue": paper_venue,
        "doi": paper_doi,
        "tags": serde_json::from_str::<serde_json::Value>(&tags_str).unwrap_or(json!([])),
        "research_interest_id": r.get::<Option<String>, _>("research_interest_id"),
        "importance_color": r.get::<Option<String>, _>("importance_color").unwrap_or_default(),
        "notes": r.get::<Option<String>, _>("notes"),
        "file_path": paper_file_path,
        "status": r.get::<String, _>("status"),
        "sort_order": r.try_get::<i64, _>("sort_order").unwrap_or(0),
        "created_at": r.get::<String, _>("created_at"),
        "updated_at": r.get::<String, _>("updated_at"),
    });
    obj["abstract"] = json!(paper_abstract);
    if let Some(url) = paper_reference_url(
        obj.get("title").and_then(|value| value.as_str()),
        paper_doi.as_deref(),
        paper_file_path.as_deref(),
    ) {
        obj["paper_url"] = json!(url);
    }
    let venue_name = obj
        .get("venue")
        .and_then(|value| value.as_str())
        .map(str::to_string);

    if let Some(venue) = venue_name.as_deref() {
        let is_conference = if let Some(tag) = match_venue(venue) {
            let conference = tag.kind == "conference";
            obj["ccf_rating"] = json!(tag.rating);
            obj["ccf_area"] = json!(tag.area);
            obj["ccf_type"] = json!(tag.kind);
            obj["ccf_label"] = json!(tag.label);
            obj["ccf_publisher"] = json!(tag.publisher);
            obj["venue_url"] = json!(tag.url);
            conference
        } else {
            false
        };

        if !is_conference {
            if let Some(tag) = match_journal(venue) {
                obj["wos_indexes"] = json!(tag.indexes);
                obj["wos_categories"] = json!(tag.wos_categories);
                obj["jcr_quartile"] = json!(tag.jcr_quartile);
                obj["jcr_category"] = json!(tag.jcr_category);
                obj["jif"] = json!(tag.jif);
                obj["jif_rank"] = json!(tag.jif_rank);
                obj["cas_quartile"] = json!(tag.cas_quartile);
                obj["cas_top"] = json!(tag.cas_top);
                obj["open_access"] = json!(tag.open_access);
                obj["journal_issn"] = json!(tag.issn);
                obj["journal_eissn"] = json!(tag.eissn);
                obj["journal_publisher"] = json!(tag.publisher);
            }
        }
    }
    obj
}

#[cfg(test)]
mod tests {
    use super::{extract_first_author, render_import_file_stem, ImportRenameMetadata};

    #[test]
    fn render_import_file_stem_uses_rule_tokens() {
        let metadata = ImportRenameMetadata {
            title: Some("Attention Is All You Need".into()),
            authors: Some("Ashish Vaswani, Noam Shazeer".into()),
            year: Some(2017),
            venue: Some("NeurIPS".into()),
            doi: Some("10.5555/demo".into()),
            _keywords: None,
        };
        let rendered = render_import_file_stem(
            "{first_author} - {title} ({year})",
            &metadata,
            "fallback",
            "old-name",
        );
        assert_eq!(
            rendered,
            "Ashish Vaswani - Attention Is All You Need (2017)"
        );
    }

    #[test]
    fn render_import_file_stem_cleans_missing_tokens() {
        let metadata = ImportRenameMetadata {
            title: Some("Paper Title".into()),
            authors: None,
            year: Some(0),
            venue: None,
            doi: None,
            _keywords: None,
        };
        let rendered = render_import_file_stem(
            "{first_author} - {title} ({year})",
            &metadata,
            "fallback",
            "old-name",
        );
        assert_eq!(rendered, "Paper Title");
    }

    #[test]
    fn extract_first_author_prefers_first_comma_separated_name() {
        assert_eq!(extract_first_author("Jane Doe, John Smith"), "Jane Doe");
    }
}
