use crate::services::field_dynamics_service;
use crate::state::AppState;
use serde_json::json;
use std::{fs, path::PathBuf};
use tauri::{Emitter, State};
use tauri_plugin_fs::FilePath;
use uuid::Uuid;

use super::papers::papers_upload;

const FIELD_DYNAMICS_IMPORT_USER_AGENT: &str = "XiaoYanDesktop/0.5.2 (+https://github.com/openai)";

fn resolve_pdf_url(raw_pdf_url: &str, external_id: &str, source: &str) -> String {
    let pdf_url = raw_pdf_url.trim();
    if !pdf_url.is_empty() {
        return pdf_url.to_string();
    }

    if source == "arxiv" {
        let normalized_id = external_id.trim();
        if normalized_id.is_empty() {
            return String::new();
        }
        return format!("https://arxiv.org/pdf/{normalized_id}.pdf");
    }

    String::new()
}

async fn download_briefing_pdf(pdf_url: &str) -> Result<PathBuf, String> {
    let response = reqwest::Client::new()
        .get(pdf_url)
        .header("User-Agent", FIELD_DYNAMICS_IMPORT_USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("下载 PDF 失败：{error}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("下载 PDF 失败（{status}）：{body}"));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取 PDF 失败：{error}"))?;
    if !bytes.starts_with(b"%PDF-") {
        return Err("下载结果不是有效的 PDF 文件。".to_string());
    }

    let temp_path = std::env::temp_dir().join(format!(
        "xiaoyan-field-dynamics-import-{}.pdf",
        Uuid::new_v4()
    ));
    fs::write(&temp_path, bytes).map_err(|error| format!("保存临时 PDF 失败：{error}"))?;
    Ok(temp_path)
}

#[tauri::command]
pub async fn field_dynamics_scan(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    days: Option<i64>,
    max_per_interest: Option<usize>,
) -> Result<serde_json::Value, String> {
    let days = days.unwrap_or(7);
    let max_per = max_per_interest.unwrap_or(10);
    let settings = state.settings.read().await.clone();

    field_dynamics_service::ensure_table(&state.db).await?;
    let generated_briefings =
        field_dynamics_service::scan_interests(&state.db, &settings, days, max_per).await?;
    // Return the complete latest view. A failed or empty individual scan must
    // never make an existing briefing disappear from the workspace.
    let briefings = field_dynamics_service::get_briefings(&state.db, None).await?;
    let unread = field_dynamics_service::count_unread(&state.db)
        .await
        .unwrap_or(0);

    let result = json!({
        "briefings": briefings,
        "unread_count": unread,
        "scanned_interests": generated_briefings.len(),
    });

    let _ = app.emit("field-dynamics:scan-complete", result.clone());
    Ok(result)
}

#[tauri::command]
pub async fn field_dynamics_history(
    state: State<'_, AppState>,
    interest_id: Option<String>,
    limit: Option<i64>,
) -> Result<serde_json::Value, String> {
    field_dynamics_service::ensure_table(&state.db).await?;
    let briefings =
        field_dynamics_service::get_briefing_history(&state.db, interest_id, limit.unwrap_or(24))
            .await?;
    Ok(json!({ "briefings": briefings }))
}

#[tauri::command]
pub async fn field_dynamics_list(
    state: State<'_, AppState>,
    interest_id: Option<String>,
) -> Result<serde_json::Value, String> {
    field_dynamics_service::ensure_table(&state.db).await?;
    let briefings = field_dynamics_service::get_briefings(&state.db, interest_id).await?;
    let unread = field_dynamics_service::count_unread(&state.db)
        .await
        .unwrap_or(0);

    Ok(json!({
        "briefings": briefings,
        "unread_count": unread,
    }))
}

#[tauri::command]
pub async fn field_dynamics_mark_read(
    state: State<'_, AppState>,
    id: Option<String>,
) -> Result<(), String> {
    field_dynamics_service::mark_briefing_read(&state.db, id).await
}

#[tauri::command]
pub async fn field_dynamics_import_paper(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    briefing_id: String,
    paper_external_id: String,
    paper_source: String,
) -> Result<serde_json::Value, String> {
    field_dynamics_service::ensure_table(&state.db).await?;

    let briefing = field_dynamics_service::get_briefing_by_id(&state.db, &briefing_id)
        .await?
        .ok_or_else(|| "未找到对应的简报。".to_string())?;

    let paper = briefing
        .key_papers
        .iter()
        .find(|p| p.external_id == paper_external_id && p.source == paper_source)
        .ok_or_else(|| "未找到对应的论文。".to_string())?;

    if paper.source != "arxiv" && paper.source != "semantic_scholar" {
        return Err("该来源论文不支持导入。".to_string());
    }

    let pdf_url = resolve_pdf_url(&paper.pdf_url, &paper.external_id, &paper.source);
    if pdf_url.is_empty() {
        return Err("该论文缺少可下载的 PDF 地址。".to_string());
    }

    let temp_path = download_briefing_pdf(&pdf_url).await?;
    let upload_result = papers_upload(
        app,
        state,
        FilePath::Path(temp_path.clone()),
        Some(briefing.interest_id.clone()),
        Some(paper.title.clone()),
    )
    .await;
    let _ = fs::remove_file(&temp_path);

    let mut payload = upload_result?;
    if let Some(object) = payload.as_object_mut() {
        object.insert("briefing_id".into(), json!(briefing_id));
        object.insert("paper_external_id".into(), json!(paper_external_id));
    }

    Ok(payload)
}

pub async fn auto_field_dynamics_scan_on_startup(
    state: &crate::state::AppState,
    app: &tauri::AppHandle,
) {
    use crate::services::field_dynamics_service;

    if field_dynamics_service::ensure_table(&state.db)
        .await
        .is_err()
    {
        return;
    }

    let settings = state.settings.read().await.clone();
    let days = 7i64;
    let max_per = 8usize;

    match field_dynamics_service::scan_interests(&state.db, &settings, days, max_per).await {
        Ok(briefings) => {
            if briefings.is_empty() {
                return;
            }
            let unread = field_dynamics_service::count_unread(&state.db)
                .await
                .unwrap_or(0);
            let _ = app.emit(
                "field-dynamics:scan-complete",
                json!({
                    "count": briefings.len(),
                    "unread": unread,
                }),
            );
        }
        Err(e) => {
            crate::append_diagnostic_log(&format!("field-dynamics startup scan failed: {e}"));
        }
    }
}
