use crate::assistant_prompts::main_chat_system;
use crate::commands::chat_tools::{build_chat_tools, dispatch_tool};
use crate::commands::memory::is_long_term_memory_enabled;
use crate::llm::{
    explain_vision_error, resolve_model, resolve_temperature, LlmClient, LlmImage, LlmMessage,
    StreamOutcome,
};
use crate::services::agent_runtime_service::{
    run_agent_runtime, AgentRuntimeKind, AgentRuntimeRequest,
};
use crate::services::chat_context_service::{
    build_chat_context_summary, collect_chat_sources, embed_query,
};
use crate::services::memory_checkpoint_service::{
    record_chat_checkpoint, record_chat_failure_checkpoint, ChatCheckpointInput,
    ChatFailureCheckpointInput,
};
use crate::state::AppState;
use crate::web_search::web_search;
use serde_json::json;
use sqlx::Row;
use std::collections::HashMap;
use tauri::{Emitter, State};
use uuid::Uuid;

fn scoped_context_type(context_type: Option<&str>, has_context_id: bool) -> String {
    match (context_type, has_context_id) {
        (Some("interest"), true) => "interest".to_string(),
        (Some("paper"), true) => "paper".to_string(),
        _ => "general".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::scoped_context_type;

    #[test]
    fn preserves_supported_scoped_contexts() {
        assert_eq!(scoped_context_type(Some("interest"), true), "interest");
        assert_eq!(scoped_context_type(Some("paper"), true), "paper");
    }

    #[test]
    fn falls_back_to_general_without_a_scope_id() {
        assert_eq!(scoped_context_type(Some("paper"), false), "general");
        assert_eq!(scoped_context_type(Some("unknown"), true), "general");
    }
}

/// 前端 chat_stream 传入的图片块：data 为 base64（不含 data: 前缀），mediaType 为 MIME 类型。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInput {
    pub data: String,
    pub media_type: String,
}

/// 单次对话图片总 base64 体积上限（约 12MB 原图），超出直接拒绝，避免撑爆请求体。
const MAX_CHAT_IMAGE_BYTES: usize = 16 * 1024 * 1024;

// ── Session management ──────────────────────────────────────────

#[tauri::command]
pub async fn chat_list_sessions(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let rows = sqlx::query(
        "SELECT id, title, context_type, context_id, tag, created_at, updated_at FROM chat_sessions WHERE tag = '0' ORDER BY updated_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let list: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.get::<String, _>("id"),
                "title": r.get::<String, _>("title"),
                "context_type": r.get::<String, _>("context_type"),
                "context_id": r.get::<Option<String>, _>("context_id"),
                "tag": r.get::<String, _>("tag"),
                "created_at": r.get::<String, _>("created_at"),
                "updated_at": r.get::<Option<String>, _>("updated_at"),
            })
        })
        .collect();
    Ok(json!(list))
}

#[tauri::command]
pub async fn chat_get_session(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let r = sqlx::query(
        "SELECT id, title, context_type, context_id, created_at, updated_at FROM chat_sessions WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or("未找到对应会话。")?;

    let msgs = sqlx::query(
        "SELECT id, role, content, sources, images, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let messages: Vec<serde_json::Value> = msgs
        .iter()
        .map(|m| {
            let src: Option<String> = m.get("sources");
            let imgs: Option<String> = m.get("images");
            let artifacts: Option<String> = m.get("artifacts");
            json!({
                "id": m.get::<String, _>("id"),
                "role": m.get::<String, _>("role"),
                "content": m.get::<String, _>("content"),
                "sources": src.as_deref().and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()),
                "images": imgs.as_deref().and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()),
                "artifacts": artifacts.as_deref().and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()),
                "created_at": m.get::<String, _>("created_at"),
            })
        })
        .collect();

    Ok(json!({
        "id": r.get::<String, _>("id"),
        "title": r.get::<String, _>("title"),
        "context_type": r.get::<String, _>("context_type"),
        "context_id": r.get::<Option<String>, _>("context_id"),
        "created_at": r.get::<String, _>("created_at"),
        "updated_at": r.get::<Option<String>, _>("updated_at"),
        "messages": messages,
    }))
}

#[tauri::command]
pub async fn chat_delete_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM chat_sessions WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn chat_update_session_context(
    state: State<'_, AppState>,
    id: String,
    context_type: String,
    context_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let normalized_context_id = context_id.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    let normalized_context_type =
        scoped_context_type(Some(&context_type), normalized_context_id.is_some());

    sqlx::query(
        "UPDATE chat_sessions SET context_type = ?, context_id = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&normalized_context_type)
    .bind(&normalized_context_id)
    .bind(&now)
    .bind(&id)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let row = sqlx::query(
        "SELECT id, title, context_type, context_id, created_at, updated_at FROM chat_sessions WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or("未找到对应会话。")?;

    Ok(json!({
        "id": row.get::<String, _>("id"),
        "title": row.get::<String, _>("title"),
        "context_type": row.get::<String, _>("context_type"),
        "context_id": row.get::<Option<String>, _>("context_id"),
        "created_at": row.get::<String, _>("created_at"),
        "updated_at": row.get::<Option<String>, _>("updated_at"),
    }))
}

#[tauri::command]
pub async fn chat_ensure_session(
    state: State<'_, AppState>,
    session_id: Option<String>,
    title: Option<String>,
    context_type: Option<String>,
    context_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let normalized_context_id = context_id.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    let ctx_type = scoped_context_type(context_type.as_deref(), normalized_context_id.is_some());

    if let Some(ref id) = session_id {
        let existing = sqlx::query("SELECT id FROM chat_sessions WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?;
        if existing.is_some() {
            sqlx::query(
                "UPDATE chat_sessions SET context_type = ?, context_id = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&ctx_type)
            .bind(&normalized_context_id)
            .bind(&now)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| e.to_string())?;

            let row = sqlx::query(
                "SELECT id, title, context_type, context_id, created_at, updated_at FROM chat_sessions WHERE id = ?",
            )
            .bind(id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| e.to_string())?;
            return Ok(json!({
                "id": row.get::<String, _>("id"),
                "title": row.get::<String, _>("title"),
                "context_type": row.get::<String, _>("context_type"),
                "context_id": row.get::<Option<String>, _>("context_id"),
                "created_at": row.get::<String, _>("created_at"),
                "updated_at": row.get::<Option<String>, _>("updated_at"),
            }));
        }
    }

    let id = session_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let session_title = title.unwrap_or_else(|| "新对话".to_string());
    sqlx::query(
        "INSERT INTO chat_sessions (id, title, context_type, context_id, tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&session_title)
    .bind(&ctx_type)
    .bind(&normalized_context_id)
    .bind("0")
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(json!({
        "id": id,
        "title": session_title,
        "context_type": ctx_type,
        "context_id": normalized_context_id,
        "created_at": now,
        "updated_at": now,
    }))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSaveMessageInput {
    pub session_id: String,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub images: Option<serde_json::Value>,
    #[serde(default)]
    pub artifacts: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn chat_save_message(
    state: State<'_, AppState>,
    input: ChatSaveMessageInput,
) -> Result<serde_json::Value, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    let images_json = input.images.as_ref().map(|v| v.to_string());
    let artifacts_json = input.artifacts.as_ref().map(|v| v.to_string());

    sqlx::query(
        "INSERT INTO chat_messages (id, session_id, role, content, images, artifacts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.session_id)
    .bind(&input.role)
    .bind(&input.content)
    .bind(&images_json)
    .bind(&artifacts_json)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query("UPDATE chat_sessions SET updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&input.session_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "id": id,
        "role": input.role,
        "content": input.content,
        "images": input.images,
        "artifacts": input.artifacts,
        "created_at": now,
    }))
}

#[tauri::command]
pub async fn chat_list_agent_runs(
    state: State<'_, AppState>,
    session_id: String,
    request_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let run_rows = if let Some(ref rid) = request_id {
        sqlx::query(
            "SELECT id, session_id, request_id, parent_run_id, agent_name, step_name, status, order_index, summary, error, created_at, updated_at
             FROM agent_runs WHERE session_id = ? AND request_id = ? ORDER BY order_index ASC",
        )
        .bind(&session_id).bind(rid)
        .fetch_all(&state.db).await.map_err(|e| e.to_string())?
    } else {
        sqlx::query(
            "SELECT id, session_id, request_id, parent_run_id, agent_name, step_name, status, order_index, summary, error, created_at, updated_at
             FROM agent_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 50",
        )
        .bind(&session_id)
        .fetch_all(&state.db).await.map_err(|e| e.to_string())?
    };

    let mut result = Vec::new();
    for run in &run_rows {
        let run_id: String = run.get("id");
        let artifacts = sqlx::query(
            "SELECT id, run_id, artifact_type, title, content, created_at FROM agent_artifacts WHERE run_id = ? ORDER BY created_at ASC",
        )
        .bind(&run_id)
        .fetch_all(&state.db).await.unwrap_or_else(|e| {
            eprintln!("[warn] Failed to fetch agent artifacts for run {run_id}: {e}");
            Vec::new()
        });

        result.push(json!({
            "id": run_id,
            "session_id": run.get::<String, _>("session_id"),
            "request_id": run.get::<String, _>("request_id"),
            "parent_run_id": run.get::<Option<String>, _>("parent_run_id"),
            "agent_name": run.get::<String, _>("agent_name"),
            "step_name": run.get::<String, _>("step_name"),
            "status": run.get::<String, _>("status"),
            "order_index": run.get::<i64, _>("order_index"),
            "summary": run.get::<Option<String>, _>("summary"),
            "error": run.get::<Option<String>, _>("error"),
            "created_at": run.get::<String, _>("created_at"),
            "updated_at": run.get::<String, _>("updated_at"),
            "artifacts": artifacts.iter().map(|a| json!({
                "id": a.get::<String, _>("id"),
                "run_id": a.get::<String, _>("run_id"),
                "artifact_type": a.get::<String, _>("artifact_type"),
                "title": a.get::<String, _>("title"),
                "content": a.get::<String, _>("content"),
                "created_at": a.get::<String, _>("created_at"),
            })).collect::<Vec<_>>(),
        }));
    }
    Ok(json!(result))
}

// ── Chat stream ─────────────────────────────────────────────────

#[tauri::command]
pub async fn chat_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    message: String,
    session_id: Option<String>,
    context_type: Option<String>,
    context_id: Option<String>,
    chat_mode: Option<String>,
    tag: Option<String>,
    request_id: Option<String>,
    images: Option<Vec<ImageInput>>,
) -> Result<serde_json::Value, String> {
    let request_id = request_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    const MAX_CHAT_MESSAGE_LEN: usize = 100_000;
    if message.len() > MAX_CHAT_MESSAGE_LEN {
        return Err(format!(
            "消息过长（{}字符），请缩短后重试（上限{}字符）。",
            message.len(),
            MAX_CHAT_MESSAGE_LEN
        ));
    }

    // 图片单独按字节上限校验，不与文本上限混算。
    let images: Vec<LlmImage> = images
        .unwrap_or_default()
        .into_iter()
        .map(|img| LlmImage {
            media_type: img.media_type,
            data: img.data,
        })
        .collect();
    let images_bytes: usize = images.iter().map(|img| img.data.len()).sum();
    if images_bytes > MAX_CHAT_IMAGE_BYTES {
        return Err(format!(
            "图片过大（编码后约{}MB），请压缩或减少图片后重试（上限约{}MB）。",
            images_bytes / (1024 * 1024),
            MAX_CHAT_IMAGE_BYTES / (1024 * 1024)
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let normalized_context_id = context_id.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    let ctx_type = scoped_context_type(context_type.as_deref(), normalized_context_id.is_some());

    let sid = if let Some(id) = session_id {
        let _ = sqlx::query(
            "UPDATE chat_sessions SET context_type = ?, context_id = ?, updated_at = ? WHERE id = ?",
        )
            .bind(&ctx_type)
            .bind(&normalized_context_id)
            .bind(&now)
            .bind(&id)
            .execute(&state.db)
            .await;
        id
    } else {
        let id = Uuid::new_v4().to_string();
        let title: String = {
            let trimmed = message.trim();
            if trimmed.is_empty() {
                "新对话".to_string()
            } else {
                let base: String = trimmed.chars().take(40).collect();
                if trimmed.chars().count() > 40 {
                    format!("{}…", base)
                } else {
                    base
                }
            }
        };
        sqlx::query(
            "INSERT INTO chat_sessions (id, title, context_type, context_id, tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id).bind(&title).bind(&ctx_type).bind(&normalized_context_id).bind(&tag.unwrap_or_else(|| "0".into())).bind(&now).bind(&now)
        .execute(&state.db).await.map_err(|e| e.to_string())?;
        id
    };

    // 先取历史（仅含之前轮次），再保存当前消息——否则历史会包含当前这条，
    // run_simple/多智能体再 append 当前 message 时就会重复（模型会抱怨“用户问了两遍同样的问题”）。
    let history = fetch_history(&state.db, &sid, 10)
        .await
        .map_err(|e| e.to_string())?;

    // Save user message（含图片，供同会话多轮上下文回放）
    let msg_id = Uuid::new_v4().to_string();
    let images_json: Option<String> = if images.is_empty() {
        None
    } else {
        serde_json::to_string(
            &images
                .iter()
                .map(|i| json!({ "mediaType": i.media_type, "data": i.data }))
                .collect::<Vec<_>>(),
        )
        .ok()
    };
    sqlx::query("INSERT INTO chat_messages (id, session_id, role, content, images, created_at) VALUES (?, ?, 'user', ?, ?, ?)")
        .bind(&msg_id).bind(&sid).bind(&message).bind(&images_json).bind(&now)
        .execute(&state.db).await.map_err(|e| e.to_string())?;
    let settings = state.settings.read().await.clone();
    let long_term_memory_enabled = is_long_term_memory_enabled(&settings);
    if long_term_memory_enabled {
        let _ = crate::commands::memory::record_chat_prompt_event(
            &state.db,
            &sid,
            &ctx_type,
            normalized_context_id.as_deref(),
            &message,
        )
        .await;
    }
    let db = state.db.clone();
    let rid = request_id.clone();
    let sid_clone = sid.clone();
    let message_clone = message.clone();
    let ctx_type_clone = ctx_type.clone();
    let context_id_clone = normalized_context_id.clone();
    let chat_handles = state.chat_handles.clone();
    let uses_vision = !images.is_empty() || history.iter().any(|item| !item.images.is_empty());
    let vision_model = settings
        .get("vision_model")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let handle = tokio::spawn(async move {
        let result = run_chat(
            &app,
            &db,
            &settings,
            &rid,
            &sid_clone,
            &message,
            &ctx_type,
            &normalized_context_id,
            chat_mode.as_deref().unwrap_or("task"),
            history,
            images,
        )
        .await;

        if let Err(e) = result {
            let error_message = e.to_string();
            let visible_error = if uses_vision {
                explain_vision_error(&error_message, vision_model.as_deref())
            } else {
                error_message.clone()
            };
            if long_term_memory_enabled {
                let _ = crate::commands::memory::record_chat_failure_event(
                    &db,
                    &sid_clone,
                    &ctx_type_clone,
                    context_id_clone.as_deref(),
                    &message_clone,
                    &error_message,
                )
                .await;
                let _ = record_chat_failure_checkpoint(
                    &db,
                    ChatFailureCheckpointInput {
                        session_id: &sid_clone,
                        request_id: &rid,
                        context_type: &ctx_type_clone,
                        context_id: context_id_clone.as_deref(),
                        user_message: &message_clone,
                        error_message: &error_message,
                    },
                )
                .await;
            }
            let _ = app.emit(
                "chat:error",
                json!({ "request_id": rid, "error": visible_error }),
            );
        }
        let _ = app.emit("chat:done", json!({ "request_id": rid }));
        let _ = chat_handles.lock().await.remove(&rid);
    });

    let mut handles = state.chat_handles.lock().await;
    handles.insert(request_id.clone(), handle);
    if handles
        .get(&request_id)
        .is_some_and(|handle| handle.is_finished())
    {
        handles.remove(&request_id);
    }

    Ok(json!({ "request_id": request_id, "session_id": sid }))
}

#[tauri::command]
pub async fn chat_cancel(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    if let Some(handle) = state.chat_handles.lock().await.remove(&request_id) {
        handle.abort();
    }
    Ok(())
}

// ── Core orchestration ──────────────────────────────────────────

async fn run_chat(
    app: &tauri::AppHandle,
    db: &sqlx::SqlitePool,
    settings: &HashMap<String, String>,
    request_id: &str,
    session_id: &str,
    message: &str,
    context_type: &str,
    context_id: &Option<String>,
    chat_mode: &str,
    history: Vec<LlmMessage>,
    images: Vec<LlmImage>,
) -> anyhow::Result<()> {
    let client = LlmClient::from_settings(settings)?;
    let multi_agent = settings
        .get("multi_agent_enabled")
        .map(|v| v == "true")
        .unwrap_or(true);
    let long_term_memory_enabled = is_long_term_memory_enabled(settings);
    // 整轮对话只向量化一次 query：记忆检索与来源召回共用，避免重复 embed 调用。
    let query_embedding = embed_query(settings, message).await;
    let context_summary = build_chat_context_summary(
        db,
        context_type,
        context_id,
        message,
        long_term_memory_enabled,
        query_embedding.as_deref(),
    )
    .await;

    // 后台回填观察的 embedding，使新写入的过程记忆很快可被语义检索；不阻塞回答。
    {
        let db = db.clone();
        let settings = settings.clone();
        tauri::async_runtime::spawn(async move {
            crate::commands::memory::backfill_observation_embeddings(&db, &settings).await;
        });
    }

    // 多模态图片仅在 run_simple（直答）路径支持；当前轮或历史含图都强制走直答，
    // 既避免多智能体路径静默丢图，也保证带图历史的多轮追问仍走视觉模型。
    let history_has_image = history.iter().any(|m| !m.images.is_empty());
    let use_direct_chat = chat_mode == "direct" || !images.is_empty() || history_has_image;

    let full = if !use_direct_chat && multi_agent {
        let runtime_result = run_agent_runtime(
            AgentRuntimeKind::from_settings(settings),
            AgentRuntimeRequest {
                app,
                db,
                settings,
                client: &client,
                request_id,
                session_id,
                message,
                context_type,
                context_id,
                context_summary: &context_summary,
                history: &history,
            },
        )
        .await?;
        let _runtime = runtime_result.runtime;
        runtime_result.answer
    } else {
        run_simple(
            app,
            &client,
            settings,
            db,
            request_id,
            message,
            &context_summary,
            &history,
            &images,
        )
        .await?
    };

    let sources = collect_chat_sources(db, settings, message, query_embedding.as_deref()).await;
    let sources_json = if sources.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&sources)?)
    };

    let msg_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO chat_messages (id, session_id, role, content, sources, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)")
        .bind(&msg_id).bind(session_id).bind(&full).bind(&sources_json).bind(&now)
        .execute(db).await?;

    if long_term_memory_enabled {
        let _ = crate::commands::memory::record_chat_completion_event(
            db,
            session_id,
            context_type,
            context_id.as_deref(),
            message,
            &full,
            sources.len(),
        )
        .await;
        let _ = record_chat_checkpoint(
            db,
            ChatCheckpointInput {
                session_id,
                request_id,
                context_type,
                context_id: context_id.as_deref(),
                user_message: message,
                assistant_message: &full,
                source_count: sources.len(),
            },
        )
        .await;
    }

    if !sources.is_empty() {
        let _ = app.emit(
            "chat:sources",
            json!({ "request_id": request_id, "value": sources }),
        );
    }
    Ok(())
}

/// 去掉所有 <think>…</think> 推理片段后，判断是否还剩可读回答。
/// 未闭合的 <think>（流式中断）也整体视为推理，不计入正文。
fn answer_text_is_empty(text: &str) -> bool {
    let mut answer = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find("<think>") {
        answer.push_str(&rest[..open]);
        match rest[open..].find("</think>") {
            Some(close) => rest = &rest[open + close + "</think>".len()..],
            None => {
                rest = "";
                break;
            }
        }
    }
    answer.push_str(rest);
    answer.trim().is_empty()
}

async fn run_simple(
    app: &tauri::AppHandle,
    client: &LlmClient,
    settings: &HashMap<String, String>,
    db: &sqlx::SqlitePool,
    request_id: &str,
    message: &str,
    context_summary: &str,
    history: &[LlmMessage],
    images: &[LlmImage],
) -> anyhow::Result<String> {
    let system_prompt = main_chat_system(context_summary);
    let mut msgs = vec![LlmMessage::system(&system_prompt)];
    // 控制成本：历史只保留最近 MAX_HISTORY_IMAGE_MSGS 条带图消息的图片，更早的剥成纯文本，
    // 避免多轮追问把全部历史图片反复重发给视觉模型。
    const MAX_HISTORY_IMAGE_MSGS: usize = 2;
    let mut history_msgs = history.to_vec();
    let mut kept = 0usize;
    for m in history_msgs.iter_mut().rev() {
        if m.images.is_empty() {
            continue;
        }
        if kept < MAX_HISTORY_IMAGE_MSGS {
            kept += 1;
        } else {
            m.images.clear();
        }
    }
    msgs.extend(history_msgs);
    if images.is_empty() {
        msgs.push(LlmMessage::user(message));
    } else {
        msgs.push(LlmMessage::user_with_images(message, images.to_vec()));
    }
    let temperature = resolve_temperature(settings, "copilot_simple_temperature", 0.4);
    // 当前轮或历史含图都改用专用视觉模型（保证多轮追问能看到先前图片）；未配置则提示去设置。
    let needs_vision = !images.is_empty() || history.iter().any(|m| !m.images.is_empty());
    let vision = if needs_vision {
        Some(
            LlmClient::vision_client_from_settings(settings).ok_or_else(|| {
                anyhow::anyhow!(
                    "该对话包含图片，请先在「设置 → 模型角色 → 视界·视觉」中配置视觉模型。"
                )
            })?,
        )
    } else {
        None
    };
    let (client, model): (&LlmClient, Option<String>) = match &vision {
        Some((vision_client, vision_model)) => (vision_client, vision_model.clone()),
        None => (client, resolve_model(settings, &["copilot_simple_model"])),
    };
    let rid = request_id.to_string();
    let app_ref = app.clone();

    let max_tool_rounds: usize = settings
        .get("chat_tool_max_rounds")
        .and_then(|v| v.parse().ok())
        .unwrap_or(5);

    let tools = build_chat_tools(settings);

    let mut tool_rounds = 0usize;

    loop {
        let outcome = if tools.is_empty() || tool_rounds >= max_tool_rounds {
            let text = client
                .stream_chat(&msgs, model.as_deref(), temperature, {
                    let app = app_ref.clone();
                    let rid = rid.clone();
                    move |delta| {
                        let _ =
                            app.emit("chat:delta", json!({ "request_id": rid, "delta": delta }));
                    }
                })
                .await?;
            StreamOutcome::TextCompleted(text)
        } else {
            client
                .stream_chat_with_tools(&msgs, &tools, model.as_deref(), temperature, {
                    let app = app_ref.clone();
                    let rid = rid.clone();
                    move |delta| {
                        let _ =
                            app.emit("chat:delta", json!({ "request_id": rid, "delta": delta }));
                    }
                })
                .await?
        };

        match outcome {
            StreamOutcome::TextCompleted(text) => {
                // 模型流式正常结束但没有任何可读回答（去掉 <think> 推理后为空）。
                // 常见于服务商对 tools / 流式支持不完整：HTTP 200 却吐空内容流。
                // 若静默返回空字符串，会保存一条看不见的空气泡、且前端无任何错误提示（“不回复”）。
                // 这里改为显式报错，让 chat:error 兑现到前端，给用户可见、可操作的反馈。
                if answer_text_is_empty(&text) {
                    return Err(anyhow::anyhow!(
                        "模型未返回任何内容。可能当前对话模型/服务商不支持工具调用（function calling）或流式输出，请在「设置 → 模型角色」更换对话模型，或确认该服务商兼容 OpenAI 接口。"
                    ));
                }
                return Ok(text);
            }
            StreamOutcome::ToolCalls(tool_calls) => {
                tool_rounds += 1;
                msgs.push(LlmMessage::assistant_with_tool_calls(tool_calls.clone()));

                for tc in &tool_calls {
                    if tc.name == "web_search" {
                        let query: String =
                            serde_json::from_str::<serde_json::Value>(&tc.arguments)
                                .ok()
                                .and_then(|v| v["query"].as_str().map(|s| s.to_string()))
                                .unwrap_or_default();

                        let _ = app_ref.emit(
                            "chat:searching",
                            json!({ "request_id": rid, "query": query }),
                        );

                        if query.is_empty() {
                            msgs.push(LlmMessage::tool(
                                &tc.id,
                                "搜索查询为空，请提供有效的搜索词。",
                            ));
                            continue;
                        }

                        match web_search(&query, settings).await {
                            Ok(results) => {
                                msgs.push(LlmMessage::tool(&tc.id, &results));
                            }
                            Err(e) => {
                                msgs.push(LlmMessage::tool(&tc.id, format!("搜索失败：{}", e)));
                            }
                        }
                    } else {
                        match dispatch_tool(&app_ref, &db, settings, tc, &rid).await {
                            Ok(result) => {
                                msgs.push(LlmMessage::tool(&tc.id, &result));
                            }
                            Err(e) => {
                                let _ = app_ref.emit(
                                    "chat:tool_result",
                                    json!({
                                        "request_id": rid,
                                        "tool_name": tc.name,
                                        "tool_id": tc.id,
                                        "result": format!("执行失败: {}", e),
                                        "result_id": ""
                                    }),
                                );
                                msgs.push(LlmMessage::tool(&tc.id, format!("工具执行失败：{}", e)));
                            }
                        }
                    }
                }

                if tool_rounds >= max_tool_rounds {
                    msgs.push(LlmMessage::user(
                        "已达到工具调用次数上限，请基于已有信息给出当前最佳回答，无需再调用工具。",
                    ));
                }
            }
        }
    }
}

// ── History helper ──────────────────────────────────────────────

async fn fetch_history(
    db: &sqlx::SqlitePool,
    session_id: &str,
    limit: i64,
) -> anyhow::Result<Vec<LlmMessage>> {
    let rows = sqlx::query(
        "SELECT role, content, images FROM (SELECT role, content, images, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC",
    )
    .bind(session_id).bind(limit)
    .fetch_all(db).await?;
    Ok(rows
        .iter()
        .map(|r| {
            let images = r
                .get::<Option<String>, _>("images")
                .and_then(|raw| serde_json::from_str::<Vec<serde_json::Value>>(&raw).ok())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| {
                            Some(LlmImage {
                                media_type: v.get("mediaType")?.as_str()?.to_string(),
                                data: v.get("data")?.as_str()?.to_string(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            LlmMessage {
                role: r.get("role"),
                content: r.get("content"),
                tool_call_id: None,
                tool_calls: None,
                images,
            }
        })
        .collect())
}
