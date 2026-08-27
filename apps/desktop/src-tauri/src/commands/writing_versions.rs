use crate::services::writing_version_service::{
    self, RecordWritingVersionInput, WritingVersionRecordResult, WritingVersionSnapshot,
    WritingVersionSummary,
};
use crate::state::AppState;
use tauri::State;

fn validate_record_request(request: &RecordWritingVersionInput) -> Result<(), String> {
    if request.draft_id.trim().is_empty() {
        return Err("草稿 ID 不能为空".to_string());
    }
    writing_version_service::normalize_source(&request.source).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn writing_record_version(
    state: State<'_, AppState>,
    request: RecordWritingVersionInput,
) -> Result<WritingVersionRecordResult, String> {
    validate_record_request(&request)?;
    writing_version_service::record_version(&state.db, &request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn writing_list_versions(
    state: State<'_, AppState>,
    draft_id: String,
) -> Result<Vec<WritingVersionSummary>, String> {
    if draft_id.trim().is_empty() {
        return Err("草稿 ID 不能为空".to_string());
    }
    writing_version_service::list_versions(&state.db, &draft_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn writing_get_version(
    state: State<'_, AppState>,
    id: String,
) -> Result<WritingVersionSnapshot, String> {
    writing_version_service::get_version(&state.db, &id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "未找到对应历史版本".to_string())
}

#[tauri::command]
pub async fn writing_delete_version(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let deleted = writing_version_service::delete_version(&state.db, &id)
        .await
        .map_err(|error| error.to_string())?;
    if !deleted {
        return Err("未找到对应历史版本".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn writing_clear_draft_versions(
    state: State<'_, AppState>,
    draft_id: String,
) -> Result<(), String> {
    if draft_id.trim().is_empty() {
        return Err("草稿 ID 不能为空".to_string());
    }
    writing_version_service::clear_versions(&state.db, &draft_id)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_record_request, RecordWritingVersionInput};

    fn request(draft_id: &str, source: &str) -> RecordWritingVersionInput {
        RecordWritingVersionInput {
            draft_id: draft_id.to_string(),
            main_tex: String::new(),
            bibtex: String::new(),
            tex_files: Vec::new(),
            notes: String::new(),
            source: source.to_string(),
            force: false,
        }
    }

    #[test]
    fn record_request_requires_draft_id_and_valid_source() {
        assert!(validate_record_request(&request("", "auto")).is_err());
        assert!(validate_record_request(&request("draft-1", "unknown")).is_err());
        assert!(validate_record_request(&request("draft-1", "auto")).is_ok());
        assert!(validate_record_request(&request("draft-1", "manual")).is_ok());
    }
}
