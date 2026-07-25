//! 代码功能 Tauri 命令层。
//!
//! 所有命令均围绕「小妍原生代码助手」工作区：文件系统、会话 CRUD、
//! 以及基于小妍 LLM 设置的流式代码对话。

use crate::code;
use crate::state::AppState;
use serde_json::json;
use std::path::Path;
use tauri::{Emitter, State};
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
pub async fn code_list_dir(path: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err("路径不存在".into());
    }
    if !path.is_dir() {
        return Err("路径不是目录".into());
    }

    let mut entries = Vec::new();
    let mut read_dir = tokio::fs::read_dir(path).await.map_err(|e| e.to_string())?;
    while let Some(entry) = read_dir.next_entry().await.map_err(|e| e.to_string())? {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let path_str = entry.path().to_string_lossy().to_string();
        let is_dir = entry.file_type().await.map_err(|e| e.to_string())?.is_dir();
        entries.push(DirEntry {
            name,
            path: path_str,
            is_dir,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(json!({ "entries": entries }))
}

#[tauri::command]
pub async fn code_read_file(path: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err("文件不存在".into());
    }
    if !path.is_file() {
        return Err("路径不是文件".into());
    }
    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!({ "content": content }))
}

#[tauri::command]
pub async fn code_write_file(path: String, content: String) -> Result<(), String> {
    let path = Path::new(&path);
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    tokio::fs::write(path, content)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn code_workspace_context(
    working_dir: String,
    current_file: Option<String>,
) -> Result<serde_json::Value, String> {
    let context =
        code::context::build_workspace_context(&working_dir, current_file.as_deref()).await?;
    serde_json::to_value(context).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn code_list_sessions(
    state: State<'_, AppState>,
    experiment_id: String,
) -> Result<serde_json::Value, String> {
    let sessions = code::store::list_sessions(&state.db, &experiment_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!({ "sessions": sessions }))
}

#[tauri::command]
pub async fn code_get_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let session = code::store::get_session(&state.db, &session_id)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(&session).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn code_create_session(
    state: State<'_, AppState>,
    experiment_id: String,
    title: Option<String>,
    working_dir: Option<String>,
) -> Result<serde_json::Value, String> {
    let title = title.unwrap_or_else(|| "新会话".to_string());
    let session =
        code::store::create_session(&state.db, &experiment_id, &title, working_dir.as_deref())
            .await
            .map_err(|e| e.to_string())?;
    serde_json::to_value(&session).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn code_delete_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    code::store::delete_session(&state.db, &session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn code_update_session(
    state: State<'_, AppState>,
    session_id: String,
    title: Option<String>,
    working_dir: Option<String>,
) -> Result<(), String> {
    code::store::update_session(
        &state.db,
        &session_id,
        title.as_deref(),
        working_dir.as_deref(),
        None,
        None,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn code_send_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    display_content: String,
    prompt_content: String,
    working_dir: Option<String>,
    current_file: Option<String>,
    mode: Option<String>,
    user_message_id: Option<String>,
) -> Result<(), String> {
    if display_content.trim().is_empty() || prompt_content.trim().is_empty() {
        return Err("消息不能为空".into());
    }

    let db = state.db.clone();
    let settings = state.settings.read().await.clone();

    // 会话一旦在新的工作目录里继续，就应随之归档到该项目，保证最近项目和会话分组准确。
    if let Some(dir) = working_dir.as_deref().filter(|dir| !dir.trim().is_empty()) {
        code::store::update_session(&db, &session_id, None, Some(dir), None, None)
            .await
            .map_err(|err| err.to_string())?;
    }

    code::store::maybe_autotitle(&db, &session_id, &display_content).await;
    let _ = app.emit(
        "code:title_changed",
        serde_json::json!({ "session_id": &session_id }),
    );

    let request_id = Uuid::new_v4().to_string();
    let rid = request_id.clone();
    let code_handles = state.code_handles.clone();
    let code_permissions = state.code_permissions.clone();

    // fire-and-forget，流式结果走事件回传。
    let handle = tokio::spawn(async move {
        code::send_message_stream(
            app,
            db,
            settings,
            session_id,
            display_content,
            prompt_content,
            working_dir,
            current_file,
            mode,
            code_permissions,
            &rid,
            user_message_id,
        )
        .await;
        let _ = code_handles.lock().await.remove(&rid);
    });

    state.code_handles.lock().await.insert(request_id, handle);

    Ok(())
}

#[tauri::command]
pub async fn code_edit_message(
    state: State<'_, AppState>,
    session_id: String,
    message_id: String,
) -> Result<(), String> {
    code::store::edit_message(&state.db, &session_id, &message_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn code_resolve_permission(
    state: State<'_, AppState>,
    permission_id: String,
    approved: bool,
    message: Option<String>,
) -> Result<(), String> {
    let sender = state.code_permissions.lock().await.remove(&permission_id);
    match sender {
        Some(sender) => sender
            .send(code::CodePermissionDecision { approved, message })
            .map_err(|_| "审批请求已失效".to_string()),
        None => Err("审批请求不存在或已处理".into()),
    }
}

#[tauri::command]
pub async fn code_git_snapshot(working_dir: String) -> Result<serde_json::Value, String> {
    let snapshot = code::git::snapshot(&working_dir).await?;
    serde_json::to_value(snapshot).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn code_git_stage_path(working_dir: String, path: String) -> Result<(), String> {
    code::git::stage_path(&working_dir, &path).await
}

#[tauri::command]
pub async fn code_git_unstage_path(working_dir: String, path: String) -> Result<(), String> {
    code::git::unstage_path(&working_dir, &path).await
}

#[tauri::command]
pub async fn code_git_commit(working_dir: String, message: String) -> Result<String, String> {
    code::git::commit(&working_dir, &message).await
}

#[tauri::command]
pub async fn code_git_list_branches(working_dir: String) -> Result<serde_json::Value, String> {
    let branches = code::git::list_branches(&working_dir).await?;
    serde_json::to_value(branches).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn code_git_checkout_branch(working_dir: String, branch: String) -> Result<(), String> {
    code::git::checkout_branch(&working_dir, &branch).await
}

#[tauri::command]
pub async fn code_generate_commit_message(
    state: State<'_, AppState>,
    working_dir: String,
) -> Result<serde_json::Value, String> {
    let settings = state.settings.read().await.clone();
    let message = code::git::generate_commit_message(&settings, &working_dir).await?;
    serde_json::to_value(message).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn code_review_changes(
    state: State<'_, AppState>,
    working_dir: String,
) -> Result<serde_json::Value, String> {
    let settings = state.settings.read().await.clone();
    let report = code::git::review_changes(&settings, &working_dir).await?;
    serde_json::to_value(report).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn code_cancel(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    if let Some(handle) = state.code_handles.lock().await.remove(&request_id) {
        handle.abort();
    }
    Ok(())
}
