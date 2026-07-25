use crate::state::AppState;
use base64::{engine::general_purpose, Engine as _};
use serde_json::json;
use sqlx::Row;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};
use uuid::Uuid;

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[tauri::command]
pub async fn experiment_list(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let rows = sqlx::query(
        "SELECT id, title, config, result, notes, linked_submission_id, default_working_dir, created_at, updated_at
         FROM experiment_records ORDER BY updated_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let config_raw: String = row.get("config");
            let config: serde_json::Value =
                serde_json::from_str(&config_raw).unwrap_or_else(|_| json!({}));
            json!({
                "id": row.get::<String, _>("id"),
                "title": row.get::<String, _>("title"),
                "config": config,
                "result": row.get::<String, _>("result"),
                "notes": row.get::<String, _>("notes"),
                "linkedSubmissionId": row.get::<Option<String>, _>("linked_submission_id"),
                "defaultWorkingDir": row.get::<Option<String>, _>("default_working_dir"),
                "createdAt": row.get::<String, _>("created_at"),
                "updatedAt": row.get::<String, _>("updated_at"),
            })
        })
        .collect();

    Ok(json!({ "experiments": items }))
}

#[tauri::command]
pub async fn experiment_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let row = sqlx::query(
        "SELECT id, title, config, result, notes, linked_submission_id, default_working_dir, created_at, updated_at
         FROM experiment_records WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    match row {
        Some(row) => {
            let config_raw: String = row.get("config");
            let config: serde_json::Value =
                serde_json::from_str(&config_raw).unwrap_or_else(|_| json!({}));
            Ok(json!({
                "id": row.get::<String, _>("id"),
                "title": row.get::<String, _>("title"),
                "config": config,
                "result": row.get::<String, _>("result"),
                "notes": row.get::<String, _>("notes"),
                "linkedSubmissionId": row.get::<Option<String>, _>("linked_submission_id"),
                "defaultWorkingDir": row.get::<Option<String>, _>("default_working_dir"),
                "createdAt": row.get::<String, _>("created_at"),
                "updatedAt": row.get::<String, _>("updated_at"),
            }))
        }
        None => Err("Experiment not found".into()),
    }
}

#[tauri::command]
pub async fn create_experiment_core(
    db: &sqlx::SqlitePool,
    title: String,
    config: Option<serde_json::Value>,
    result: Option<String>,
    notes: Option<String>,
    linked_submission_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let id = Uuid::new_v4().to_string();
    let ts = now();
    let config_json =
        serde_json::to_string(&config.unwrap_or_else(|| json!({}))).unwrap_or_else(|_| "{}".into());
    sqlx::query(
        "INSERT INTO experiment_records (id, title, config, result, notes, linked_submission_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&title)
    .bind(&config_json)
    .bind(result.as_deref().unwrap_or(""))
    .bind(notes.as_deref().unwrap_or(""))
    .bind(linked_submission_id.as_deref())
    .bind(&ts)
    .bind(&ts)
    .execute(db)
    .await
    .map_err(|e| e.to_string())?;

    Ok(json!({ "id": id, "title": title }))
}

#[tauri::command]
pub async fn experiment_create(
    state: State<'_, AppState>,
    title: String,
    config: Option<serde_json::Value>,
    result: Option<String>,
    notes: Option<String>,
    linked_submission_id: Option<String>,
) -> Result<serde_json::Value, String> {
    create_experiment_core(
        &state.db,
        title,
        config,
        result,
        notes,
        linked_submission_id,
    )
    .await
}

async fn update_experiment_core(
    db: &sqlx::SqlitePool,
    id: &str,
    title: Option<String>,
    config: Option<serde_json::Value>,
    result: Option<String>,
    notes: Option<String>,
    linked_submission_id: Option<String>,
    default_working_dir: Option<String>,
) -> Result<(), String> {
    let config_json = config
        .map(|value| serde_json::to_string(&value).map_err(|error| error.to_string()))
        .transpose()?;
    let ts = now();
    let update = sqlx::query(
        "UPDATE experiment_records
         SET title = COALESCE(?, title),
             config = COALESCE(?, config),
             result = COALESCE(?, result),
             notes = COALESCE(?, notes),
             linked_submission_id = CASE
                 WHEN ? IS NULL THEN linked_submission_id
                 WHEN TRIM(?) = '' THEN NULL
                 ELSE ?
             END,
             default_working_dir = CASE
                 WHEN ? IS NULL THEN default_working_dir
                 WHEN TRIM(?) = '' THEN NULL
                 ELSE ?
             END,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(title.as_deref())
    .bind(config_json.as_deref())
    .bind(result.as_deref())
    .bind(notes.as_deref())
    .bind(linked_submission_id.as_deref())
    .bind(linked_submission_id.as_deref())
    .bind(linked_submission_id.as_deref())
    .bind(default_working_dir.as_deref())
    .bind(default_working_dir.as_deref())
    .bind(default_working_dir.as_deref())
    .bind(&ts)
    .bind(id)
    .execute(db)
    .await
    .map_err(|error| error.to_string())?;

    if update.rows_affected() == 0 {
        return Err("实验记录不存在".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn experiment_update(
    state: State<'_, AppState>,
    id: String,
    title: Option<String>,
    config: Option<serde_json::Value>,
    result: Option<String>,
    notes: Option<String>,
    linked_submission_id: Option<String>,
    default_working_dir: Option<String>,
) -> Result<(), String> {
    update_experiment_core(
        &state.db,
        &id,
        title,
        config,
        result,
        notes,
        linked_submission_id,
        default_working_dir,
    )
    .await
}

#[tauri::command]
pub async fn experiment_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM experiment_records WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Attachment helpers ───────────────────────────────────────────

fn managed_attachments_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = data_dir.join("experiment_attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建附件目录：{e}"))?;
    Ok(dir)
}

fn file_to_data_url(file_path: &str) -> Option<String> {
    let data = std::fs::read(file_path).ok()?;
    let b64 = general_purpose::STANDARD.encode(&data);
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    };
    Some(format!("data:{mime};base64,{b64}"))
}

#[tauri::command]
pub async fn experiment_add_attachment(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    experiment_id: String,
    file_path: String,
    label: Option<String>,
) -> Result<serde_json::Value, String> {
    let src = PathBuf::from(&file_path);
    if !src.exists() {
        return Err(format!("文件不存在：{file_path}"));
    }

    // Copy into managed directory with a unique name
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("png");
    let id = Uuid::new_v4().to_string();
    let dest_dir = managed_attachments_dir(&app)?;
    let dest = dest_dir.join(format!("{id}.{ext}"));
    std::fs::copy(&src, &dest).map_err(|e| format!("复制文件失败：{e}"))?;
    let dest_str = dest.to_string_lossy().to_string();

    let ts = now();
    let label_val = label.as_deref().unwrap_or("");
    sqlx::query(
        "INSERT INTO experiment_attachments (id, experiment_id, file_path, label, created_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&experiment_id)
    .bind(&dest_str)
    .bind(label_val)
    .bind(&ts)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let data_url = file_to_data_url(&dest_str).unwrap_or_default();
    Ok(json!({
        "id": id,
        "experimentId": experiment_id,
        "filePath": dest_str,
        "label": label_val,
        "dataUrl": data_url,
        "createdAt": ts,
    }))
}

#[tauri::command]
pub async fn experiment_list_attachments(
    state: State<'_, AppState>,
    experiment_id: String,
) -> Result<serde_json::Value, String> {
    let rows = sqlx::query(
        "SELECT id, experiment_id, file_path, label, created_at
         FROM experiment_attachments WHERE experiment_id = ? ORDER BY created_at ASC",
    )
    .bind(&experiment_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let file_path: String = row.get("file_path");
            let data_url = file_to_data_url(&file_path).unwrap_or_default();
            json!({
                "id": row.get::<String, _>("id"),
                "experimentId": row.get::<String, _>("experiment_id"),
                "filePath": file_path,
                "label": row.get::<String, _>("label"),
                "dataUrl": data_url,
                "createdAt": row.get::<String, _>("created_at"),
            })
        })
        .collect();

    Ok(json!({ "attachments": items }))
}

#[tauri::command]
pub async fn experiment_delete_attachment(
    _app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    // Read file path before deletion
    let row = sqlx::query("SELECT file_path FROM experiment_attachments WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM experiment_attachments WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    // Best-effort delete the managed file
    if let Some(row) = row {
        let fp: String = row.get("file_path");
        let _ = std::fs::remove_file(&fp);
    }

    Ok(())
}

#[tauri::command]
pub async fn experiment_update_attachment_label(
    state: State<'_, AppState>,
    id: String,
    label: String,
) -> Result<(), String> {
    sqlx::query("UPDATE experiment_attachments SET label = ? WHERE id = ?")
        .bind(label.trim())
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Snapshot helpers ───────────────────────────────────────────

fn parse_json_snapshot(raw: String) -> serde_json::Value {
    serde_json::from_str(&raw).unwrap_or_else(|_| json!({}))
}

#[tauri::command]
pub async fn experiment_create_snapshot(
    state: State<'_, AppState>,
    experiment_id: String,
    title: Option<String>,
    code_session_id: Option<String>,
    tool_id: Option<String>,
    model: Option<String>,
    working_dir: Option<String>,
    env_snapshot: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let row = sqlx::query("SELECT config, result, notes FROM experiment_records WHERE id = ?")
        .bind(&experiment_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let (config_raw, result, notes) = match row {
        Some(row) => {
            let config: String = row.get("config");
            let result: String = row.get("result");
            let notes: String = row.get("notes");
            (config, result, notes)
        }
        None => return Err("实验记录不存在".into()),
    };

    let id = Uuid::new_v4().to_string();
    let ts = now();
    let title_val = title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("快照")
        .to_string();
    let env_json = serde_json::to_string(&env_snapshot.clone().unwrap_or_else(|| json!({})))
        .map_err(|e| format!("序列化代码状态失败：{e}"))?;

    sqlx::query(
        "INSERT INTO experiment_snapshots
         (id, experiment_id, title, config_snapshot, result_snapshot, notes_snapshot,
          code_session_id, tool_id, model, working_dir, env_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&experiment_id)
    .bind(&title_val)
    .bind(&config_raw)
    .bind(&result)
    .bind(&notes)
    .bind(code_session_id.as_deref())
    .bind(tool_id.as_deref())
    .bind(model.as_deref())
    .bind(working_dir.as_deref())
    .bind(&env_json)
    .bind(&ts)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let config_json = parse_json_snapshot(config_raw);

    Ok(json!({
        "id": id,
        "experimentId": experiment_id,
        "title": title_val,
        "configSnapshot": config_json,
        "resultSnapshot": result,
        "notesSnapshot": notes,
        "codeSessionId": code_session_id,
        "toolId": tool_id,
        "model": model,
        "workingDir": working_dir,
        "envSnapshot": env_snapshot.unwrap_or_else(|| json!({})),
        "createdAt": ts,
    }))
}

#[tauri::command]
pub async fn experiment_list_snapshots(
    state: State<'_, AppState>,
    experiment_id: String,
) -> Result<serde_json::Value, String> {
    let rows = sqlx::query(
        "SELECT id, experiment_id, title, config_snapshot, result_snapshot, notes_snapshot,
                code_session_id, tool_id, model, working_dir, env_snapshot, created_at
         FROM experiment_snapshots WHERE experiment_id = ? ORDER BY created_at DESC, rowid DESC",
    )
    .bind(&experiment_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let config_raw: String = row.get("config_snapshot");
            let env_raw: String = row.get("env_snapshot");
            json!({
                "id": row.get::<String, _>("id"),
                "experimentId": row.get::<String, _>("experiment_id"),
                "title": row.get::<String, _>("title"),
                "configSnapshot": parse_json_snapshot(config_raw),
                "resultSnapshot": row.get::<String, _>("result_snapshot"),
                "notesSnapshot": row.get::<String, _>("notes_snapshot"),
                "codeSessionId": row.get::<Option<String>, _>("code_session_id"),
                "toolId": row.get::<Option<String>, _>("tool_id"),
                "model": row.get::<Option<String>, _>("model"),
                "workingDir": row.get::<Option<String>, _>("working_dir"),
                "envSnapshot": parse_json_snapshot(env_raw),
                "createdAt": row.get::<String, _>("created_at"),
            })
        })
        .collect();

    Ok(json!({ "snapshots": items }))
}

#[tauri::command]
pub async fn experiment_get_snapshot(
    state: State<'_, AppState>,
    snapshot_id: String,
) -> Result<serde_json::Value, String> {
    let row = sqlx::query(
        "SELECT id, experiment_id, title, config_snapshot, result_snapshot, notes_snapshot,
                code_session_id, tool_id, model, working_dir, env_snapshot, created_at
         FROM experiment_snapshots WHERE id = ?",
    )
    .bind(&snapshot_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    match row {
        Some(row) => {
            let config_raw: String = row.get("config_snapshot");
            let env_raw: String = row.get("env_snapshot");
            Ok(json!({
                "id": row.get::<String, _>("id"),
                "experimentId": row.get::<String, _>("experiment_id"),
                "title": row.get::<String, _>("title"),
                "configSnapshot": parse_json_snapshot(config_raw),
                "resultSnapshot": row.get::<String, _>("result_snapshot"),
                "notesSnapshot": row.get::<String, _>("notes_snapshot"),
                "codeSessionId": row.get::<Option<String>, _>("code_session_id"),
                "toolId": row.get::<Option<String>, _>("tool_id"),
                "model": row.get::<Option<String>, _>("model"),
                "workingDir": row.get::<Option<String>, _>("working_dir"),
                "envSnapshot": parse_json_snapshot(env_raw),
                "createdAt": row.get::<String, _>("created_at"),
            }))
        }
        None => Err("快照不存在".into()),
    }
}

#[tauri::command]
pub async fn experiment_rename_snapshot(
    state: State<'_, AppState>,
    snapshot_id: String,
    title: String,
) -> Result<(), String> {
    rename_snapshot_core(&state.db, &snapshot_id, &title).await
}

async fn rename_snapshot_core(
    db: &sqlx::SqlitePool,
    snapshot_id: &str,
    title: &str,
) -> Result<(), String> {
    let normalized_title = title.trim();
    if normalized_title.is_empty() {
        return Err("快照名称不能为空".into());
    }

    let result = sqlx::query("UPDATE experiment_snapshots SET title = ? WHERE id = ?")
        .bind(normalized_title)
        .bind(snapshot_id)
        .execute(db)
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err("快照不存在".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn experiment_delete_snapshot(
    state: State<'_, AppState>,
    snapshot_id: String,
) -> Result<(), String> {
    let result = sqlx::query("DELETE FROM experiment_snapshots WHERE id = ?")
        .bind(&snapshot_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err("快照不存在".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn experiment_restore_snapshot(
    state: State<'_, AppState>,
    snapshot_id: String,
) -> Result<serde_json::Value, String> {
    restore_snapshot_core(&state.db, &snapshot_id).await
}

async fn restore_snapshot_core(
    db: &sqlx::SqlitePool,
    snapshot_id: &str,
) -> Result<serde_json::Value, String> {
    let mut tx = db.begin().await.map_err(|e| e.to_string())?;
    let row = sqlx::query(
        "SELECT experiment_id, title, config_snapshot, result_snapshot, notes_snapshot
         FROM experiment_snapshots WHERE id = ?",
    )
    .bind(&snapshot_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let (experiment_id, snapshot_title, config_snapshot, result_snapshot, notes_snapshot) =
        match row {
            Some(row) => {
                let experiment_id: String = row.get("experiment_id");
                let snapshot_title: String = row.get("title");
                let config_raw: String = row.get("config_snapshot");
                let result: String = row.get("result_snapshot");
                let notes: String = row.get("notes_snapshot");
                (experiment_id, snapshot_title, config_raw, result, notes)
            }
            None => return Err("快照不存在".into()),
        };

    let current = sqlx::query("SELECT config, result, notes FROM experiment_records WHERE id = ?")
        .bind(&experiment_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "实验记录不存在".to_string())?;

    // 恢复会覆盖当前记录，先在同一事务中保存一份自动备份，使误操作可逆。
    let backup_id = Uuid::new_v4().to_string();
    let ts = now();
    let backup_title = format!("恢复「{}」前自动备份", snapshot_title);
    sqlx::query(
        "INSERT INTO experiment_snapshots
         (id, experiment_id, title, config_snapshot, result_snapshot, notes_snapshot,
          code_session_id, tool_id, model, working_dir, env_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, '{}', ?)",
    )
    .bind(&backup_id)
    .bind(&experiment_id)
    .bind(&backup_title)
    .bind(current.get::<String, _>("config"))
    .bind(current.get::<String, _>("result"))
    .bind(current.get::<String, _>("notes"))
    .bind(&ts)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let result = sqlx::query(
        "UPDATE experiment_records
         SET config = ?, result = ?, notes = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(&config_snapshot)
    .bind(&result_snapshot)
    .bind(&notes_snapshot)
    .bind(&ts)
    .bind(&experiment_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err("实验记录不存在".into());
    }
    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(json!({
        "experimentId": experiment_id,
        "restoredAt": ts,
        "backupSnapshotId": backup_id,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn restore_snapshot_creates_reversible_backup() -> Result<(), Box<dyn std::error::Error>>
    {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await?;
        sqlx::query("CREATE TABLE submissions (id TEXT PRIMARY KEY)")
            .execute(&pool)
            .await?;
        crate::db::ensure_experiment_tables(&pool).await?;

        sqlx::query(
            "INSERT INTO experiment_records
             (id, title, config, result, notes, created_at, updated_at)
             VALUES ('experiment-1', 'test', '{\"lr\":2}', 'current result', 'current notes', '2026-07-14', '2026-07-14')",
        )
        .execute(&pool)
        .await?;
        sqlx::query(
            "INSERT INTO experiment_snapshots
             (id, experiment_id, title, config_snapshot, result_snapshot, notes_snapshot, created_at)
             VALUES ('snapshot-1', 'experiment-1', 'baseline', '{\"lr\":1}', 'old result', 'old notes', '2026-07-13')",
        )
        .execute(&pool)
        .await?;

        let restored = restore_snapshot_core(&pool, "snapshot-1").await?;
        let backup_id = restored["backupSnapshotId"].as_str().expect("backup id");

        let record = sqlx::query(
            "SELECT config, result, notes FROM experiment_records WHERE id = 'experiment-1'",
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!(record.get::<String, _>("config"), "{\"lr\":1}");
        assert_eq!(record.get::<String, _>("result"), "old result");
        assert_eq!(record.get::<String, _>("notes"), "old notes");

        let backup = sqlx::query(
            "SELECT config_snapshot, result_snapshot, notes_snapshot
             FROM experiment_snapshots WHERE id = ?",
        )
        .bind(backup_id)
        .fetch_one(&pool)
        .await?;
        assert_eq!(backup.get::<String, _>("config_snapshot"), "{\"lr\":2}");
        assert_eq!(backup.get::<String, _>("result_snapshot"), "current result");
        assert_eq!(backup.get::<String, _>("notes_snapshot"), "current notes");

        rename_snapshot_core(&pool, "snapshot-1", "  新基线  ").await?;
        let renamed = sqlx::query(
            "SELECT title, config_snapshot, result_snapshot, notes_snapshot
             FROM experiment_snapshots WHERE id = 'snapshot-1'",
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!(renamed.get::<String, _>("title"), "新基线");
        assert_eq!(renamed.get::<String, _>("config_snapshot"), "{\"lr\":1}");
        assert_eq!(renamed.get::<String, _>("result_snapshot"), "old result");
        assert_eq!(renamed.get::<String, _>("notes_snapshot"), "old notes");
        Ok(())
    }

    #[tokio::test]
    async fn update_experiment_is_atomic_and_persists_working_directory(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await?;
        sqlx::query("CREATE TABLE submissions (id TEXT PRIMARY KEY)")
            .execute(&pool)
            .await?;
        crate::db::ensure_experiment_tables(&pool).await?;
        sqlx::query(
            "INSERT INTO experiment_records
             (id, title, config, result, notes, default_working_dir, created_at, updated_at)
             VALUES ('experiment-1', 'before', '{}', '', '', '/old', '2026-07-22', '2026-07-22')",
        )
        .execute(&pool)
        .await?;

        update_experiment_core(
            &pool,
            "experiment-1",
            Some("after".into()),
            Some(serde_json::json!({ "seed": 42 })),
            None,
            None,
            None,
            Some("/project/reproduction".into()),
        )
        .await?;
        let row = sqlx::query(
            "SELECT title, config, default_working_dir FROM experiment_records WHERE id = 'experiment-1'",
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!(row.get::<String, _>("title"), "after");
        assert_eq!(row.get::<String, _>("config"), "{\"seed\":42}");
        assert_eq!(
            row.get::<String, _>("default_working_dir"),
            "/project/reproduction"
        );

        update_experiment_core(
            &pool,
            "experiment-1",
            None,
            None,
            None,
            None,
            None,
            Some(String::new()),
        )
        .await?;
        let cleared: Option<String> = sqlx::query_scalar(
            "SELECT default_working_dir FROM experiment_records WHERE id = 'experiment-1'",
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!(cleared, None);

        let missing = update_experiment_core(
            &pool,
            "missing",
            Some("no-op".into()),
            None,
            None,
            None,
            None,
            None,
        )
        .await;
        assert_eq!(missing.expect_err("missing experiment"), "实验记录不存在");
        Ok(())
    }
}
