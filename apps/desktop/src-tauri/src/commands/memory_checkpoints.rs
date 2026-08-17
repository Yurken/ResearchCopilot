use crate::services::memory_checkpoint_service;
use crate::state::AppState;
use serde_json::Value;
use tauri::State;

fn validate_checkpoint_review(status: &str, note: Option<&str>) -> Result<(), String> {
    if !matches!(status, "confirmed" | "corrected" | "withdrawn") {
        return Err("checkpoint 状态无效".to_string());
    }
    if status == "corrected" && note.unwrap_or("").trim().is_empty() {
        return Err("修正 checkpoint 时需要填写修正说明".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn memory_list_checkpoints(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Value, String> {
    memory_checkpoint_service::list_recent_checkpoints(&state.db, limit.unwrap_or(8))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn memory_review_checkpoint(
    state: State<'_, AppState>,
    id: String,
    status: String,
    note: Option<String>,
) -> Result<(), String> {
    validate_checkpoint_review(&status, note.as_deref())?;
    let result = sqlx::query(
        "UPDATE memory_session_summaries
         SET review_status = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(&status)
    .bind(note.unwrap_or_default().trim().to_string())
    .bind(&id)
    .execute(&state.db)
    .await
    .map_err(|error| error.to_string())?;
    if result.rows_affected() == 0 {
        return Err("未找到 checkpoint".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_checkpoint_review;

    #[test]
    fn correction_requires_an_explanation() {
        assert!(validate_checkpoint_review("corrected", None).is_err());
        assert!(validate_checkpoint_review("corrected", Some("目标范围缩小")).is_ok());
        assert!(validate_checkpoint_review("confirmed", None).is_ok());
        assert!(validate_checkpoint_review("invalid", None).is_err());
    }
}
