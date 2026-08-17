use std::{
    fs::{self, OpenOptions},
    io::Write,
    panic,
    path::PathBuf,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

mod agent_graph;
mod agent_nodes;
mod agent_workspace;
mod assistant_prompts;
mod ccf;
mod citation_graph;
mod code;
mod commands;
mod db;
mod dsh;
mod dsh_api_config;
mod graph_rag;
mod journal_partitions;
mod links;
mod llm;
mod rag;
mod repositories;
mod semantic_scholar;
mod services;
mod state;
mod text_utils;
mod token_usage;
mod web_search;

// 本地手动 AI 联通测试（全部 #[ignore]，CI 的 cargo test 自动跳过）。
#[cfg(test)]
mod ai_live_test;

use tauri::Manager;

use web_search::web_search_query;

use commands::{
    academic_writing::writing_polish_text,
    active_researcher::{
        active_researcher_findings, active_researcher_import_finding, active_researcher_mark_read,
        active_researcher_scan,
    },
    app_lock::{
        app_lock_clear_password, app_lock_get_hint, app_lock_get_recovery_info,
        app_lock_reset_password, app_lock_set_password, app_lock_set_security,
        app_lock_set_timeout, app_lock_status, app_lock_verify_password, app_lock_verify_recovery,
    },
    artifacts::{artifact_delete, artifact_open, artifact_reveal, artifact_save, artifact_save_as},
    arxiv::arxiv_search,
    ccf::{ccf_list, ccf_lookup},
    chat::{
        chat_cancel, chat_delete_session, chat_ensure_session, chat_get_session,
        chat_list_agent_runs, chat_list_sessions, chat_save_message, chat_stream,
        chat_update_session_context,
    },
    citation_graph::{
        knowledge_graph_citation_centrality, knowledge_graph_citation_shortest_path,
        knowledge_graph_citation_subgraph,
    },
    code::{
        code_cancel, code_create_session, code_delete_session, code_edit_message,
        code_generate_commit_message, code_get_session, code_git_checkout_branch, code_git_commit,
        code_git_list_branches, code_git_snapshot, code_git_stage_path, code_git_unstage_path,
        code_list_dir, code_list_sessions, code_read_file, code_resolve_permission,
        code_review_changes, code_send_message, code_update_session, code_workspace_context,
        code_write_file,
    },
    data_backup::{data_backup_export, data_backup_import},
    evidence::evidence_get_links,
    experiment::{
        experiment_add_attachment, experiment_create, experiment_create_snapshot,
        experiment_delete, experiment_delete_attachment, experiment_delete_snapshot,
        experiment_get, experiment_get_snapshot, experiment_list, experiment_list_attachments,
        experiment_list_snapshots, experiment_rename_snapshot, experiment_restore_snapshot,
        experiment_update, experiment_update_attachment_label,
    },
    export::export_to_obsidian,
    field_dynamics::{
        field_dynamics_history, field_dynamics_import_paper, field_dynamics_list,
        field_dynamics_mark_read, field_dynamics_scan,
    },
    github_project::{
        github_project_delete_search_history, github_project_get_search_history,
        github_project_save_search_history, github_project_search,
    },
    journal::{journal_lookup, journal_rank_filter},
    knowledge::{
        knowledge_create_folder, knowledge_create_interest, knowledge_delete_interest_bundle,
        knowledge_delete_interest_only, knowledge_generate_interest_hints, knowledge_generate_plan,
        knowledge_list_interests, knowledge_move_interest, knowledge_suggest_topics,
        knowledge_update_interest_folder, knowledge_web_clip,
    },
    knowledge_graph::{
        knowledge_graph_create_citation, knowledge_graph_create_claim,
        knowledge_graph_create_evidence, knowledge_graph_delete_citation,
        knowledge_graph_delete_claim, knowledge_graph_delete_evidence, knowledge_graph_snapshot,
    },
    knowledge_ideas::knowledge_ideas_from_materials,
    knowledge_notes::{
        knowledge_create_note, knowledge_delete_note, knowledge_import_zip, knowledge_list_notes,
        knowledge_list_notes_by_source, knowledge_move_note, knowledge_update_note,
    },
    memory::{
        memory_add, memory_build_context, memory_clear_auto, memory_delete, memory_list,
        memory_list_observations, memory_search_observations,
    },
    memory_checkpoints::{memory_list_checkpoints, memory_review_checkpoint},
    memory_privacy::{
        memory_list_auto_records, memory_list_manual_records, memory_list_private_observations,
        memory_privacy_clear_password, memory_privacy_set_password, memory_privacy_status,
        memory_privacy_verify_password,
    },
    misc::{
        markdown_format_chunk, planner_generate, survey_delete, survey_generate, survey_get,
        survey_list, survey_search,
    },
    paper_corpus::{
        paper_corpus_create, paper_corpus_delete, paper_corpus_list, paper_corpus_update,
    },
    paper_cross_analysis::papers_cross_analysis,
    paper_figures::papers_list_figures,
    paper_notes::{paper_notes_create, paper_notes_delete, paper_notes_list, paper_notes_update},
    paper_search::{
        paper_search, paper_search_delete_history, paper_search_get_history,
        paper_search_save_history,
    },
    papers::{
        papers_analyze, papers_delete, papers_extract_pdf_text, papers_generate_note, papers_get,
        papers_list, papers_list_parse_runs, papers_merge, papers_open_pdf, papers_reorder,
        papers_reparse, papers_reproduce, papers_reveal_in_folder, papers_update, papers_upload,
    },
    research_context::{research_context_get_recent_themes, research_context_get_theme_context},
    settings::{
        settings_export, settings_get, settings_history_apply, settings_history_delete,
        settings_history_list, settings_history_rename, settings_history_save,
        settings_history_update, settings_import, settings_list_models,
        settings_list_ollama_models, settings_test, settings_test_tavily, settings_test_vision,
        settings_update,
    },
    skills::{skills_create, skills_delete, skills_list, skills_reset_builtins, skills_update},
    source::source_lookup,
    submission::{
        submission_ai_review, submission_create, submission_create_comment,
        submission_create_venue, submission_create_version, submission_delete,
        submission_delete_comment, submission_delete_venue, submission_delete_version,
        submission_generate_cover_letter, submission_get_checklist,
        submission_import_diagnosis_report_to_checklist,
        submission_import_diagnosis_report_to_tasks, submission_list, submission_list_comments,
        submission_list_diagnosis_reports, submission_list_revision_tasks, submission_list_rounds,
        submission_list_venues, submission_list_versions, submission_polish_abstract,
        submission_review_feedback_summary, submission_stats, submission_sync_ccfddl,
        submission_sync_ccfddl_local, submission_toggle_checklist, submission_toggle_venue_star,
        submission_update, submission_update_comment, submission_update_revision_task,
        submission_update_venue, submission_update_version, submission_upsert_review_feedback,
        submission_upsert_round,
    },
    sync::{sync_configure, sync_disable, sync_get_config, sync_now, sync_status},
    token_usage::token_usage_stats,
    translation::{translate_cancel, translate_stream, translate_text},
    update::{update_check, update_install, PendingUpdate},
    webdav_sync::{
        webdav_delete_backup, webdav_download_backup, webdav_list_backups, webdav_test_connection,
        webdav_upload_backup,
    },
    workbench::{workbench_generate_overview_text, workbench_get_overview_text_cache},
    writing::{
        writing_compile_pdf, writing_copy_pdf, writing_import_image, writing_open_compiled_pdf,
        writing_open_mactex_download_page, writing_open_mactex_installer,
    },
};
use state::{default_settings, AppState};

static DIAGNOSTIC_LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

fn diagnostic_log_path() -> PathBuf {
    DIAGNOSTIC_LOG_PATH
        .get()
        .cloned()
        .unwrap_or_else(|| std::env::temp_dir().join("xiaoyan-desktop.log"))
}

fn configure_diagnostic_log_path(app_data_dir: &std::path::Path) {
    let log_dir = app_data_dir.join("logs");
    if fs::create_dir_all(&log_dir).is_ok() {
        let _ = DIAGNOSTIC_LOG_PATH.set(log_dir.join("xiaoyan-desktop.log"));
    }
}

/// Maximum diagnostic log size in bytes before rotation (5 MB).
const MAX_DIAGNOSTIC_LOG_SIZE: u64 = 5 * 1024 * 1024;

pub fn append_diagnostic_log(message: &str) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();

    let log_path = diagnostic_log_path();

    // Rotate if the log exceeds size limit
    if let Ok(meta) = fs::metadata(&log_path) {
        if meta.len() > MAX_DIAGNOSTIC_LOG_SIZE {
            let rotated = log_path.with_extension("log.old");
            let _ = fs::rename(&log_path, &rotated);
        }
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}

/// 读取应用当前诊断日志，供「附带本地日志」一键附带。
/// 仅返回尾部（最多 ~200KB）——最近的日志最有用，也避免反馈载荷过大。
#[tauri::command]
fn read_diagnostic_log() -> Result<serde_json::Value, String> {
    const MAX_BYTES: usize = 200_000;
    let path = diagnostic_log_path();
    let content = fs::read_to_string(&path).map_err(|e| format!("读取日志失败：{e}"))?;
    let tail = if content.len() > MAX_BYTES {
        // 从字符边界安全截断，保留最新的一段。
        let mut start = content.len() - MAX_BYTES;
        while start < content.len() && !content.is_char_boundary(start) {
            start += 1;
        }
        format!("……（已省略较早日志）\n{}", &content[start..])
    } else {
        content
    };
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("xiaoyan-desktop.log")
        .to_string();
    Ok(serde_json::json!({ "name": name, "content": tail }))
}

#[derive(serde::Deserialize)]
pub struct FeedbackLog {
    name: String,
    content: String,
}

#[derive(serde::Deserialize)]
pub struct FeedbackPayload {
    #[serde(default)]
    text: String,
    #[serde(default)]
    contact: String,
    category: Option<String>,
    #[serde(default)]
    images: Vec<String>,
    log: Option<FeedbackLog>,
}

/// 提交用户反馈到官网反馈服务。
/// 从后端 reqwest 直发（不带 Origin 头，绕过服务端 CORS 白名单）。
#[tauri::command]
async fn feedback_submit(payload: FeedbackPayload) -> Result<serde_json::Value, String> {
    let endpoint = std::env::var("XIAOYAN_FEEDBACK_ENDPOINT")
        .unwrap_or_else(|_| "https://xiaoyan.net.cn/api/settings/feedback".to_string());

    // 操作系统类型 + 版本（+ 架构），写进服务端会落库的 client.platform 字段。
    // 例：「Mac OS 15.5.0 (aarch64)」「Windows 11 Pro 10.0.22631 (x86_64)」。
    let os = os_info::get();
    let arch = std::env::consts::ARCH;
    let platform = match os.edition() {
        Some(edition) => format!("{edition} {} ({arch})", os.version()),
        None => format!("{} {} ({arch})", os.os_type(), os.version()),
    };

    let body = serde_json::json!({
        "source": "xiaoyan-desktop",
        "category": payload.category.unwrap_or_else(|| "other".to_string()),
        "text": payload.text,
        "contact": payload.contact,
        "images": payload.images,
        "log": payload.log.map(|l| serde_json::json!({ "name": l.name, "content": l.content })),
        "client": {
            "platform": platform,
            "userAgent": format!("xiaoyan-desktop/{}", env!("CARGO_PKG_VERSION")),
        },
    });

    let resp = reqwest::Client::new()
        .post(&endpoint)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("网络请求失败：{e}"))?;

    let status = resp.status();
    let value: serde_json::Value = resp.json().await.unwrap_or_else(|_| serde_json::json!({}));
    if !status.is_success() {
        let msg = value
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("提交失败，请稍后再试");
        return Err(msg.to_string());
    }
    Ok(value)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    panic::set_hook(Box::new(|panic_info| {
        append_diagnostic_log(&format!("panic: {panic_info}"));
    }));

    append_diagnostic_log("startup: begin");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            app.manage(PendingUpdate::default());

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");

            app.manage(dsh::DshRuntimeState::new(app_data_dir.clone()));

            configure_diagnostic_log_path(&app_data_dir);
            append_diagnostic_log(&format!(
                "startup: setup ok version={} data_dir={}",
                app.package_info().version,
                app_data_dir.display()
            ));

            // Initialise DB + settings on the async runtime
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                // Init SQLite
                let pool = db::init_db(&app_data_dir).await.expect("failed to init DB");

                // 注入全局 token 用量落库连接池（供所有 LLM 调用累加用量）
                token_usage::init(pool.clone());

                // Load persisted settings, merge with defaults
                let mut settings = default_settings();
                let rows = sqlx::query("SELECT key, value FROM settings")
                    .fetch_all(&pool)
                    .await;
                match rows {
                    Ok(rows) => {
                        use sqlx::Row;
                        let count = rows.len();
                        for row in rows {
                            let key: String = row.get("key");
                            let value: String = row.get("value");
                            settings.insert(key, value);
                        }
                        append_diagnostic_log(&format!("startup: loaded {count} settings from db"));
                    }
                    Err(e) => {
                        append_diagnostic_log(&format!("startup: failed to load settings: {e}"));
                    }
                }

                let app_state = AppState::new(pool.clone(), settings);
                handle.manage(app_state);

                // 小妍内部 Wiki：论文/笔记变更由持久化队列去抖后自动增量编译。
                {
                    let state = handle.state::<AppState>().inner().clone();
                    services::wiki::auto_compile::start_auto_compile_worker(state);
                }

                // Auto-sync CCF DDL from bundled data on first launch
                {
                    let state = handle.state::<AppState>().inner().clone();
                    let app_handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        commands::submission::auto_sync_ccfddl_on_startup(&state, &app_handle).await;
                    });
                }

                // Auto-scan for new papers — fires after a short delay
                {
                    let state = handle.state::<AppState>().inner().clone();
                    let app_handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        // Delay to avoid blocking startup
                        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                        commands::active_researcher::auto_researcher_scan_on_startup(&state, &app_handle).await;
                    });
                }

                // 领域动态在活跃研究者扫描后执行，避免启动阶段并发检索过多。
                {
                    let state = handle.state::<AppState>().inner().clone();
                    let app_handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(20)).await;
                        commands::field_dynamics::auto_field_dynamics_scan_on_startup(&state, &app_handle).await;
                    });
                }

                // WebDAV 无冲突同步：启动后跑一次，之后每 15 分钟检查一次。
                // 切回前台也会检查，但服务层以同一冷却时间限制重复请求。
                {
                    let state = handle.state::<AppState>().inner().clone();
                    let app_handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                        let _ = services::sync_service::run_sync(&state, &app_handle).await;
                        let mut ticker =
                            tokio::time::interval(std::time::Duration::from_secs(900));
                        ticker.tick().await; // 立即返回的第一次 tick
                        loop {
                            ticker.tick().await;
                            let _ = services::sync_service::run_sync(&state, &app_handle).await;
                        }
                    });
                }

                // 后台回填过程记忆的 embedding（语义检索用）：启动后稍延迟，分批直到清空。
                // 未配置 embedding 模型时单批即返回 0、立即结束，开销可忽略。
                {
                    let state = handle.state::<AppState>().inner().clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
                        let settings = state.settings.read().await.clone();
                        loop {
                            let written = commands::memory::backfill_observation_embeddings(
                                &state.db, &settings,
                            )
                            .await;
                            if written == 0 {
                                break;
                            }
                            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                        }
                    });
                }

                // Backfill keywords for existing papers that have full_text but empty tags
                tauri::async_runtime::spawn(async move {
                    use sqlx::Row;
                    use commands::paper_analysis_text::extract_keywords_from_text;
                    let rows = sqlx::query(
                        "SELECT id, full_text FROM papers WHERE (tags IS NULL OR tags = '[]') AND full_text IS NOT NULL AND full_text != ''",
                    )
                    .fetch_all(&pool)
                    .await
                    .unwrap_or_default();
                    for row in rows {
                        let id: String = row.get("id");
                        let full_text: String = row.get("full_text");
                        let keywords = extract_keywords_from_text(&full_text);
                        if keywords.is_empty() { continue; }
                        let tags_json = serde_json::to_string(&keywords).unwrap_or_else(|_| "[]".to_string());
                        let _ = sqlx::query("UPDATE papers SET tags = ? WHERE id = ?")
                            .bind(&tags_json)
                            .bind(&id)
                            .execute(&pool)
                            .await;
                    }
                });
            });

            // 确保 macOS Dock 图标与窗口图标一致
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon() {
                    let _ = window.set_icon(icon.clone());
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // 窗口重新获得焦点时检查同步；服务层会限制为每 15 分钟至多一次。
            if let tauri::WindowEvent::Focused(true) = event {
                let app = window.app_handle().clone();
                if let Some(state) = app.try_state::<AppState>() {
                    let state = state.inner().clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = services::sync_service::run_sync(&state, &app).await;
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Settings
            settings_get,
            settings_update,
            settings_test,
            settings_test_vision,
            settings_export,
            settings_import,
            settings_history_list,
            settings_history_save,
            settings_history_update,
            settings_history_rename,
            settings_history_apply,
            settings_history_delete,
            token_usage_stats,
            update_check,
            update_install,
            read_diagnostic_log,
            feedback_submit,
            // DeepSeek Harness runtime
            dsh::dsh_runtime_status,
            dsh::dsh_runtime_configure,
            dsh::dsh_runtime_start,
            dsh::dsh_runtime_stop,
            dsh::dsh_runtime_validate_external,
            dsh::dsh_runtime_import_xiaoyan_api,
            // Papers
            papers_list,
            papers_get,
            papers_list_parse_runs,
            papers_upload,
            papers_update,
            papers_reorder,
            papers_delete,
            papers_merge,
            papers_open_pdf,
            papers_reveal_in_folder,
            papers_extract_pdf_text,
            papers_reparse,
            papers_analyze,
            papers_reproduce,
            papers_generate_note,
            papers_list_figures,
            // Paper notes (PDF reader annotations)
            paper_notes_list,
            paper_notes_create,
            paper_notes_update,
            paper_notes_delete,
            paper_corpus_list,
            paper_corpus_create,
            paper_corpus_update,
            paper_corpus_delete,
            // CCF
            ccf_list,
            ccf_lookup,
            // Journal partitions
            journal_lookup,
            journal_rank_filter,
            // Unified source lookup
            source_lookup,
            // arXiv
            arxiv_search,
            // Artifacts
            artifact_save,
            artifact_open,
            artifact_reveal,
            artifact_save_as,
            artifact_delete,
            // Paper search
            paper_search,
            paper_search_save_history,
            paper_search_get_history,
            paper_search_delete_history,
            // Web search
            web_search_query,
            // Knowledge
            knowledge_list_interests,
            knowledge_create_interest,
            knowledge_update_interest_folder,
            knowledge_delete_interest_bundle,
            knowledge_delete_interest_only,
            knowledge_create_folder,
            knowledge_move_interest,
            knowledge_generate_interest_hints,
            knowledge_suggest_topics,
            knowledge_ideas_from_materials,
            knowledge_generate_plan,
            knowledge_list_notes,
            knowledge_list_notes_by_source,
            knowledge_create_note,
            knowledge_update_note,
            knowledge_move_note,
            knowledge_delete_note,
            knowledge_import_zip,
            knowledge_graph_snapshot,
            knowledge_graph_create_claim,
            knowledge_graph_delete_claim,
            knowledge_graph_create_evidence,
            knowledge_graph_delete_evidence,
            knowledge_graph_create_citation,
            knowledge_graph_delete_citation,
            knowledge_graph_citation_centrality,
            knowledge_graph_citation_shortest_path,
            knowledge_graph_citation_subgraph,
            // Chat
            chat_list_sessions,
            chat_get_session,
            chat_delete_session,
            chat_update_session_context,
            chat_ensure_session,
            chat_save_message,
            chat_list_agent_runs,
            chat_stream,
            chat_cancel,
            // Skills
            skills_list,
            skills_create,
            skills_update,
            skills_delete,
            skills_reset_builtins,
            // Memory
            memory_add,
            memory_list,
            memory_list_observations,
            memory_list_checkpoints,
            memory_review_checkpoint,
            memory_search_observations,
            memory_list_manual_records,
            memory_list_auto_records,
            memory_list_private_observations,
            memory_privacy_status,
            memory_privacy_set_password,
            memory_privacy_verify_password,
            memory_privacy_clear_password,
            memory_delete,
            memory_clear_auto,
            memory_build_context,
            // Submission
            submission_list_venues,
            submission_create_venue,
            submission_update_venue,
            submission_delete_venue,
            submission_toggle_venue_star,
            submission_list,
            submission_create,
            submission_update,
            submission_delete,
            submission_list_versions,
            submission_create_version,
            submission_update_version,
            submission_delete_version,
            submission_list_rounds,
            submission_upsert_round,
            submission_list_comments,
            submission_create_comment,
            submission_update_comment,
            submission_delete_comment,
            submission_upsert_review_feedback,
            submission_review_feedback_summary,
            submission_get_checklist,
            submission_toggle_checklist,
            submission_list_diagnosis_reports,
            submission_import_diagnosis_report_to_checklist,
            submission_list_revision_tasks,
            submission_import_diagnosis_report_to_tasks,
            submission_update_revision_task,
            submission_stats,
            submission_ai_review,
            submission_polish_abstract,
            submission_generate_cover_letter,
            submission_sync_ccfddl,
            submission_sync_ccfddl_local,
            // Experiment
            experiment_list,
            experiment_get,
            experiment_create,
            experiment_update,
            experiment_delete,
            experiment_add_attachment,
            experiment_list_attachments,
            experiment_delete_attachment,
            experiment_update_attachment_label,
            experiment_create_snapshot,
            experiment_list_snapshots,
            experiment_get_snapshot,
            experiment_rename_snapshot,
            experiment_delete_snapshot,
            experiment_restore_snapshot,
            // Export
            export_to_obsidian,
            // Knowledge extras
            knowledge_web_clip,
            // Settings extras
            settings_list_ollama_models,
            settings_list_models,
            settings_test_tavily,
            // Misc
            planner_generate,
            survey_generate,
            survey_list,
            survey_get,
            survey_delete,
            survey_search,
            translate_text,
            translate_stream,
            translate_cancel,
            markdown_format_chunk,
            code_create_session,
            code_delete_session,
            code_edit_message,
            code_get_session,
            code_generate_commit_message,
            code_git_checkout_branch,
            code_git_commit,
            code_git_list_branches,
            code_git_snapshot,
            code_git_stage_path,
            code_git_unstage_path,
            code_list_dir,
            code_list_sessions,
            code_read_file,
            code_review_changes,
            code_resolve_permission,
            code_send_message,
            code_cancel,
            code_update_session,
            code_write_file,
            code_workspace_context,
            github_project_search,
            github_project_save_search_history,
            github_project_get_search_history,
            github_project_delete_search_history,
            // App lock
            app_lock_status,
            app_lock_set_password,
            app_lock_verify_password,
            app_lock_clear_password,
            app_lock_set_timeout,
            app_lock_get_hint,
            app_lock_get_recovery_info,
            app_lock_set_security,
            app_lock_verify_recovery,
            app_lock_reset_password,
            // Data backup
            data_backup_export,
            data_backup_import,
            webdav_test_connection,
            webdav_list_backups,
            webdav_upload_backup,
            webdav_download_backup,
            webdav_delete_backup,
            // WebDAV 无冲突同步
            sync_configure,
            sync_get_config,
            sync_status,
            sync_now,
            sync_disable,
            // Workbench
            workbench_get_overview_text_cache,
            workbench_generate_overview_text,
            // Writing
            writing_polish_text,
            writing_import_image,
            writing_compile_pdf,
            writing_copy_pdf,
            writing_open_compiled_pdf,
            writing_open_mactex_installer,
            writing_open_mactex_download_page,
            // Active Researcher
            active_researcher_scan,
            active_researcher_findings,
            active_researcher_import_finding,
            active_researcher_mark_read,
            field_dynamics_scan,
            field_dynamics_list,
            field_dynamics_history,
            field_dynamics_import_paper,
            field_dynamics_mark_read,
            // Cross-paper Analysis
            papers_cross_analysis,
            // Research Context
            research_context_get_recent_themes,
            research_context_get_theme_context,
            evidence_get_links,
        ])
        .run(tauri::generate_context!());

    match builder {
        Ok(()) => append_diagnostic_log("startup: shutdown clean"),
        Err(error) => append_diagnostic_log(&format!("startup: run error: {error}")),
    }
}
