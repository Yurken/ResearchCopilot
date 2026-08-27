use crate::services::writing_draft_service::{
    self, WritingDraftInput, WritingDraftRecord,
};
use crate::state::AppState;
use tauri::State;

const WRITING_TEMPLATE_IDS: &[&str] = &["journal", "conference", "thesis-note"];

fn validate_draft_input(input: &WritingDraftInput) -> Result<(), String> {
    if input.id.trim().is_empty() {
        return Err("草稿 ID 不能为空".to_string());
    }
    if !WRITING_TEMPLATE_IDS.contains(&input.template_id.as_str()) {
        return Err("模板类型无效".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn writing_draft_create(
    state: State<'_, AppState>,
    request: WritingDraftInput,
) -> Result<WritingDraftRecord, String> {
    validate_draft_input(&request)?;
    writing_draft_service::create_draft(&state.db, &request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn writing_draft_list(
    state: State<'_, AppState>,
) -> Result<Vec<WritingDraftRecord>, String> {
    writing_draft_service::list_drafts(&state.db)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn writing_draft_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<WritingDraftRecord, String> {
    writing_draft_service::get_draft(&state.db, &id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "未找到对应文稿".to_string())
}

#[tauri::command]
pub async fn writing_draft_update(
    state: State<'_, AppState>,
    request: WritingDraftInput,
) -> Result<(), String> {
    validate_draft_input(&request)?;
    let updated = writing_draft_service::update_draft(&state.db, &request)
        .await
        .map_err(|error| error.to_string())?;
    if !updated {
        return Err("未找到对应文稿".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn writing_draft_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if id.trim().is_empty() {
        return Err("草稿 ID 不能为空".to_string());
    }
    let deleted = writing_draft_service::delete_draft(&state.db, &id)
        .await
        .map_err(|error| error.to_string())?;
    if !deleted {
        return Err("未找到对应文稿".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_draft_input, WritingDraftInput};

    fn input(id: &str, template_id: &str) -> WritingDraftInput {
        WritingDraftInput {
            id: id.to_string(),
            project_name: "论文".to_string(),
            research_interest_id: None,
            template_id: template_id.to_string(),
            main_tex: String::new(),
            bibtex: String::new(),
            tex_files: Vec::new(),
            notes: String::new(),
            image_assets: Vec::new(),
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn draft_input_requires_id_and_known_template() {
        assert!(validate_draft_input(&input("", "journal")).is_err());
        assert!(validate_draft_input(&input("draft-1", "unknown")).is_err());
        assert!(validate_draft_input(&input("draft-1", "journal")).is_ok());
        assert!(validate_draft_input(&input("draft-1", "thesis-note")).is_ok());
    }
}
