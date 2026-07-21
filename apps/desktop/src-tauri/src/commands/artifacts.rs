use crate::state::AppState;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

const ARTIFACTS_DIR: &str = "artifacts";

fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "-")
        .replace('\0', "")
        .chars()
        .take(80)
        .collect::<String>()
        .trim_end_matches(&['.', ' '][..])
        .to_string();

    let reserved = ["CON", "PRN", "AUX", "NUL"];
    let upper = cleaned.to_uppercase();
    if reserved.contains(&upper.as_str()) || upper.starts_with("COM") || upper.starts_with("LPT") {
        return format!("{}-artifact", cleaned);
    }
    if cleaned.is_empty() {
        return "artifact".to_string();
    }
    cleaned
}

fn ensure_safe_artifact_path(base: &Path, id: &str, file_name: &str) -> Result<PathBuf, String> {
    let sanitized_id = Uuid::parse_str(id)
        .map(|_| id.to_string())
        .unwrap_or_else(|_| Uuid::new_v4().to_string());
    let sanitized_name = sanitize_file_name(file_name);

    let dir = base.join(ARTIFACTS_DIR).join(&sanitized_id);
    let path = dir.join(&sanitized_name);

    // 路径遍历防护：确保解析后的路径仍在 base/artifacts/<id>/ 下。
    let canonical_base = base
        .join(ARTIFACTS_DIR)
        .join(&sanitized_id)
        .canonicalize()
        .unwrap_or_else(|_| base.join(ARTIFACTS_DIR).join(&sanitized_id));
    let canonical_path = path.canonicalize().unwrap_or_else(|_| path.clone());

    if !canonical_path.starts_with(&canonical_base) {
        return Err("非法文件路径".to_string());
    }

    for component in path.components() {
        if let Component::ParentDir = component {
            return Err("非法文件路径".to_string());
        }
    }

    Ok(path)
}

fn extension_for_kind(kind: &str) -> &'static str {
    match kind {
        "pptx" => "pptx",
        "docx" => "docx",
        "xlsx" => "xlsx",
        "pdf" => "pdf",
        "image" => "png",
        "archive" => "zip",
        _ => "bin",
    }
}

fn mime_type_for_kind(kind: &str) -> &'static str {
    match kind {
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pdf" => "application/pdf",
        "image" => "image/png",
        "archive" => "application/zip",
        _ => "application/octet-stream",
    }
}

#[derive(serde::Deserialize)]
pub struct ArtifactSaveInput {
    pub id: String,
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub bytes: Vec<u8>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(serde::Serialize)]
pub struct ArtifactOutput {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub mime_type: String,
    pub local_path: String,
    pub size: i64,
    pub created_at: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn artifact_save(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ArtifactSaveInput,
) -> Result<ArtifactOutput, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let mut name = input.name;
    let ext = extension_for_kind(&input.kind);
    if !name.to_lowercase().ends_with(&format!(".{ext}")) {
        name = format!("{}.{ext}", sanitize_file_name(&name));
    } else {
        name = sanitize_file_name(&name);
    }

    let path = ensure_safe_artifact_path(&app_data_dir, &input.id, &name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建产物目录失败：{e}"))?;
    }

    fs::write(&path, &input.bytes).map_err(|e| format!("写入产物文件失败：{e}"))?;

    let size = input.bytes.len() as i64;
    let created_at = chrono::Utc::now().to_rfc3339();
    let local_path = path.to_string_lossy().to_string();

    // 可选：在数据库中记录产物元数据，便于后续清理与同步。
    let _ = sqlx::query(
        "INSERT OR REPLACE INTO artifacts (id, kind, name, mime_type, local_path, size, title, description, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&input.id)
    .bind(&input.kind)
    .bind(&name)
    .bind(mime_type_for_kind(&input.kind))
    .bind(&local_path)
    .bind(size)
    .bind(&input.title)
    .bind(&input.description)
    .bind(input.metadata.as_ref().map(|m| m.to_string()))
    .bind(&created_at)
    .execute(&state.db)
    .await;

    let mime_type = mime_type_for_kind(&input.kind).to_string();
    Ok(ArtifactOutput {
        id: input.id,
        kind: input.kind,
        name,
        mime_type,
        local_path,
        size,
        created_at,
        title: input.title,
        description: input.description,
        metadata: input.metadata,
    })
}

#[tauri::command]
pub async fn artifact_open(
    app: tauri::AppHandle,
    id: String,
    local_path: String,
) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = ensure_safe_artifact_path(
        &app_data_dir,
        &id,
        Path::new(&local_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("artifact"),
    )?;

    if !path.exists() {
        return Err("产物文件已丢失".to_string());
    }

    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("打开文件失败：{e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn artifact_reveal(
    app: tauri::AppHandle,
    id: String,
    local_path: String,
) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = ensure_safe_artifact_path(
        &app_data_dir,
        &id,
        Path::new(&local_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("artifact"),
    )?;

    if !path.exists() {
        return Err("产物文件已丢失".to_string());
    }

    app.opener()
        .reveal_item_in_dir(path.to_string_lossy().to_string())
        .map_err(|e| format!("定位文件失败：{e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn artifact_save_as(
    app: tauri::AppHandle,
    id: String,
    local_path: String,
) -> Result<bool, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let source = ensure_safe_artifact_path(
        &app_data_dir,
        &id,
        Path::new(&local_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("artifact"),
    )?;

    if !source.exists() {
        return Err("产物文件已丢失".to_string());
    }

    let file_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("artifact")
        .to_string();
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin")
        .to_string();

    let (tx, rx) = std::sync::mpsc::channel::<Option<PathBuf>>();
    app.dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("产物文件", &[&ext])
        .save_file(move |path| {
            let _ = tx.send(path.map(|p| p.into_path().unwrap_or_default()));
        });

    let destination = rx.recv().map_err(|e| format!("等待保存对话框失败：{e}"))?;

    if let Some(destination) = destination {
        fs::copy(&source, &destination).map_err(|e| format!("复制文件失败：{e}"))?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn artifact_delete(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    local_path: String,
) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = ensure_safe_artifact_path(
        &app_data_dir,
        &id,
        Path::new(&local_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("artifact"),
    )?;

    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("删除产物文件失败：{e}"))?;
    }

    let _ = sqlx::query("DELETE FROM artifacts WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await;

    Ok(())
}
