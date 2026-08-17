use crate::llm::{
    anthropic_auth_header, explain_vision_error, is_anthropic_compatible_base_url, LlmClient,
};
use crate::repositories::settings_repository::{
    delete_settings_history, get_settings_history, insert_settings_history, list_settings_history,
    load_all_settings, rename_settings_history, update_settings_history, upsert_settings,
};
use crate::state::{default_settings, AppState, SENSITIVE_KEYS};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::RngCore;
use sqlx::{Column, Row};
use std::collections::{BTreeMap, HashMap};
use std::path::{Component, Path, PathBuf};
use tauri::Manager;
use uuid::Uuid;

const MAGIC_SETTINGS: &[u8; 6] = b"RCCFG1";
pub const MAGIC_BACKUP: &[u8; 6] = b"RCBAK1";
/// 同步状态文件 / 资产 blob 的加密魔数。
pub const MAGIC_SYNC: &[u8; 6] = b"RCSYN1";
const PBKDF2_ROUNDS: u32 = 600_000;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;
pub const MASK: &str = "***";
const ERR_INVALID_REQUEST: &str = "请求参数格式不正确。";
const ERR_EMPTY_PASSWORD: &str = "密码不能为空。";
const ERR_INVALID_FILE_FORMAT: &str = "文件格式无效。";
const ERR_CORRUPTED_FILE: &str = "文件格式无效或已损坏。";
const ERR_INVALID_CONFIG_FILE: &str = "不是有效的配置文件。";
const ERR_INVALID_PASSWORD_OR_CORRUPTED: &str = "密码错误或文件已损坏。";
const ERR_INVALID_DECRYPTED_DATA: &str = "解密数据格式错误。";
const ERR_INVALID_CONFIG_CONTENT: &str = "配置文件内容格式错误。";
const ERR_NO_VALID_CONFIG_ITEMS: &str = "文件中未找到有效配置项。";
const ERR_SETTINGS_HISTORY_NOT_FOUND: &str = "未找到对应的配置历史。";
const ERR_SETTINGS_HISTORY_EMPTY: &str = "这份配置历史中没有可应用的设置项。";

const SETTINGS_HISTORY_SNAPSHOT_PREFIX: &str = "配置快照";
const LOCAL_ONLY_SETTINGS_KEYS: &[&str] = &[
    "app_lock_enabled",
    "app_lock_password_salt",
    "app_lock_password_hash",
    "app_lock_timeout_minutes",
    "app_lock_password_hint",
    "app_lock_email",
    "app_lock_security_question",
    "app_lock_security_answer_salt",
    "app_lock_security_answer_hash",
];

pub(crate) const BACKUP_TABLES: &[&str] = &[
    "settings",
    "settings_history",
    "research_interests",
    "research_hypothesis_versions",
    "chat_sessions",
    "skills",
    "venues",
    "papers",
    "knowledge_notes",
    "knowledge_graph_claims",
    "wiki_pages",
    "submissions",
    "experiment_records",
    "chat_messages",
    "agent_runs",
    "paper_chunks",
    "paper_parse_runs",
    "paper_analyses",
    "reproduction_guides",
    "surveys",
    "paper_figures",
    "paper_versions",
    "review_rounds",
    "review_comments",
    "submission_checklist",
    "submission_diagnosis_reports",
    "submission_review_feedback",
    "submission_revision_tasks",
    "experiment_attachments",
    "knowledge_graph_evidence_links",
    "knowledge_paper_citations",
    "wiki_page_revisions",
    "wiki_page_sources",
    "wiki_page_links",
    "wiki_page_chunks",
    "wiki_compile_sources",
    "wiki_compile_runs",
    "wiki_issues",
    "agent_artifacts",
    "memory_events",
    "memory_observations",
    "memory_session_summaries",
    "memory_links",
    "user_memories",
];

#[derive(Debug, Clone, serde::Serialize)]
pub struct SettingsHistoryEntry {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub llm_provider: String,
    pub chat_model: String,
    pub paper_search_engine: String,
    pub multi_agent_enabled: bool,
    pub enabled_agents_count: usize,
}

fn derive_key(password: &[u8], salt: &[u8]) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password, salt, PBKDF2_ROUNDS, &mut key);
    key
}

pub fn encrypt_blob(plaintext: &[u8], password: &str, magic: &[u8]) -> Result<String, String> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let key = derive_key(password.as_bytes(), &salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|e| format!("加密失败: {e}"))?;

    let mut blob = Vec::with_capacity(magic.len() + SALT_LEN + NONCE_LEN + ciphertext.len());
    blob.extend_from_slice(magic);
    blob.extend_from_slice(&salt);
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);
    Ok(B64.encode(&blob))
}

pub fn decrypt_blob(b64_data: &str, password: &str, magic: &[u8]) -> Result<Vec<u8>, String> {
    let blob = B64
        .decode(b64_data)
        .map_err(|_| ERR_INVALID_FILE_FORMAT.to_string())?;
    let min_len = magic.len() + SALT_LEN + NONCE_LEN + 16;
    if blob.len() < min_len {
        return Err(ERR_CORRUPTED_FILE.to_string());
    }
    if &blob[..magic.len()] != magic {
        return Err(ERR_INVALID_CONFIG_FILE.to_string());
    }

    let offset = magic.len();
    let salt = &blob[offset..offset + SALT_LEN];
    let nonce_bytes = &blob[offset + SALT_LEN..offset + SALT_LEN + NONCE_LEN];
    let ciphertext = &blob[offset + SALT_LEN + NONCE_LEN..];
    let key = derive_key(password.as_bytes(), salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|_| ERR_INVALID_PASSWORD_OR_CORRUPTED.to_string())
}

pub(crate) fn row_to_json(row: &sqlx::sqlite::SqliteRow) -> Result<serde_json::Value, String> {
    use sqlx::ValueRef;
    let mut map = serde_json::Map::new();
    for col in row.columns() {
        let name = col.name();
        // 先判 NULL：否则 try_get::<String> 会把 NULL 读成空串，
        // 导致可空外键列被写成 "" 触发外键约束失败。
        let is_null = row
            .try_get_raw(name)
            .map(|raw| raw.is_null())
            .unwrap_or(true);
        let value = if is_null {
            serde_json::Value::Null
        } else if let Ok(v) = row.try_get::<String, _>(name) {
            serde_json::Value::String(v)
        } else if let Ok(v) = row.try_get::<i64, _>(name) {
            serde_json::json!(v)
        } else if let Ok(v) = row.try_get::<f64, _>(name) {
            serde_json::json!(v)
        } else {
            serde_json::Value::Null
        };
        map.insert(name.to_string(), value);
    }
    Ok(serde_json::Value::Object(map))
}

fn is_exposed_key(defaults: &HashMap<String, String>, key: &str) -> bool {
    defaults.contains_key(key)
}

pub(crate) fn is_local_only_settings_key(key: &str) -> bool {
    LOCAL_ONLY_SETTINGS_KEYS.contains(&key)
}

fn mask_value(key: &str, value: &str) -> String {
    if SENSITIVE_KEYS.contains(&key) && !value.is_empty() {
        MASK.to_string()
    } else {
        value.to_string()
    }
}

fn merge_with_defaults(
    defaults: &HashMap<String, String>,
    values: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut merged = defaults.clone();
    for (key, value) in values {
        if defaults.contains_key(key) {
            merged.insert(key.clone(), value.clone());
        }
    }
    merged
}

fn apply_settings_overrides(
    target: &mut HashMap<String, String>,
    data: &serde_json::Value,
) -> Result<(), String> {
    let map = data.as_object().ok_or(ERR_INVALID_REQUEST.to_string())?;

    for (key, raw) in map {
        if !target.contains_key(key) || is_local_only_settings_key(key) {
            continue;
        }
        let value = raw.as_str().unwrap_or("").trim().to_string();
        if SENSITIVE_KEYS.contains(&key.as_str()) && value == MASK {
            continue;
        }
        target.insert(key.clone(), value);
    }

    Ok(())
}

fn sanitize_asset_segment(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            output.push(ch);
        } else {
            output.push('_');
        }
    }
    if output.is_empty() {
        "asset".to_string()
    } else {
        output
    }
}

fn relative_path_string(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn safe_relative_path(value: &str) -> Option<PathBuf> {
    let path = Path::new(value);
    if path.is_absolute() {
        return None;
    }

    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => result.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }

    if result.as_os_str().is_empty() {
        None
    } else {
        Some(result)
    }
}

fn collect_file_asset(
    assets: &mut serde_json::Map<String, serde_json::Value>,
    app_data_dir: &Path,
    file_path: &str,
    fallback_prefix: &str,
) {
    if file_path.trim().is_empty() || assets.contains_key(file_path) {
        return;
    }

    let source = PathBuf::from(file_path);
    let Ok(bytes) = std::fs::read(&source) else {
        return;
    };
    let relative_path = source
        .strip_prefix(app_data_dir)
        .ok()
        .map(relative_path_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            let file_name = source
                .file_name()
                .and_then(|value| value.to_str())
                .map(sanitize_asset_segment)
                .unwrap_or_else(|| "asset.bin".to_string());
            format!(
                "restored_assets/{}/{}",
                sanitize_asset_segment(fallback_prefix),
                file_name
            )
        });

    assets.insert(
        file_path.to_string(),
        serde_json::json!({
            "relative_path": relative_path,
            "data": B64.encode(bytes),
        }),
    );
}

fn collect_row_assets(
    table: &str,
    row: &serde_json::Value,
    app_data_dir: &Path,
    assets: &mut serde_json::Map<String, serde_json::Value>,
) {
    if !matches!(table, "papers" | "paper_figures" | "experiment_attachments") {
        return;
    }

    let Some(file_path) = row.get("file_path").and_then(|value| value.as_str()) else {
        return;
    };
    let id = row
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or("row");
    collect_file_asset(assets, app_data_dir, file_path, &format!("{table}/{id}"));
}

fn restore_file_asset(
    assets: Option<&serde_json::Map<String, serde_json::Value>>,
    app_data_dir: &Path,
    file_path: &str,
) -> Result<Option<String>, String> {
    let Some(asset) = assets.and_then(|items| items.get(file_path)) else {
        return Ok(None);
    };

    let relative_path = asset
        .get("relative_path")
        .and_then(|value| value.as_str())
        .and_then(safe_relative_path)
        .ok_or_else(|| format!("备份文件资产路径无效：{file_path}"))?;
    let data = asset
        .get("data")
        .and_then(|value| value.as_str())
        .ok_or_else(|| format!("备份文件资产缺少数据：{file_path}"))?;
    let bytes = B64
        .decode(data)
        .map_err(|_| format!("备份文件资产损坏：{file_path}"))?;
    let destination = app_data_dir.join(relative_path);
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建资产目录失败：{e}"))?;
    }
    std::fs::write(&destination, bytes).map_err(|e| format!("恢复文件资产失败：{e}"))?;
    Ok(Some(destination.to_string_lossy().to_string()))
}

fn restore_row_assets(
    table: &str,
    row: &mut serde_json::Map<String, serde_json::Value>,
    assets: Option<&serde_json::Map<String, serde_json::Value>>,
    app_data_dir: &Path,
) -> Result<(), String> {
    if !matches!(table, "papers" | "paper_figures" | "experiment_attachments") {
        return Ok(());
    }

    let Some(file_path) = row.get("file_path").and_then(|value| value.as_str()) else {
        return Ok(());
    };
    if let Some(restored) = restore_file_asset(assets, app_data_dir, file_path)? {
        row.insert("file_path".to_string(), serde_json::Value::String(restored));
    }
    Ok(())
}

async fn resolve_snapshot_settings(
    state: &AppState,
    data: &serde_json::Value,
) -> Result<HashMap<String, String>, String> {
    let defaults = default_settings();
    let cache = state.settings.read().await.clone();
    let mut merged = merge_with_defaults(&defaults, &cache);
    apply_settings_overrides(&mut merged, data)?;
    merged.retain(|key, _| !is_local_only_settings_key(key));
    Ok(merged)
}

fn default_snapshot_name() -> String {
    format!(
        "{SETTINGS_HISTORY_SNAPSHOT_PREFIX} {}",
        chrono::Local::now().format("%Y-%m-%d %H:%M")
    )
}

fn settings_history_entry(
    id: String,
    name: String,
    created_at: String,
    settings: &HashMap<String, String>,
) -> SettingsHistoryEntry {
    let llm_provider = settings
        .get("llm_provider")
        .cloned()
        .unwrap_or_else(|| "openai_compatible".to_string());
    let chat_model = match llm_provider.as_str() {
        "openai" => settings.get("openai_chat_model"),
        "anthropic" => settings.get("anthropic_chat_model"),
        _ => settings.get("openai_compatible_chat_model"),
    }
    .cloned()
    .unwrap_or_default();
    let paper_search_engine = settings
        .get("paper_search_engine")
        .cloned()
        .unwrap_or_else(|| "arxiv".to_string());
    let multi_agent_enabled = settings
        .get("multi_agent_enabled")
        .map(|value| value != "false")
        .unwrap_or(true);
    let enabled_agents_count = settings
        .get("multi_agent_enabled_agents")
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .count()
        })
        .unwrap_or(0);

    SettingsHistoryEntry {
        id,
        name,
        created_at,
        llm_provider,
        chat_model,
        paper_search_engine,
        multi_agent_enabled,
        enabled_agents_count,
    }
}

pub async fn get_exposed_settings(state: &AppState) -> Result<HashMap<String, String>, String> {
    let cache = state.settings.read().await;
    let defaults = default_settings();
    let mut result = HashMap::new();

    for (key, default) in &defaults {
        let value = cache
            .get(key)
            .map(|item| item.as_str())
            .unwrap_or(default.as_str());
        result.insert(key.clone(), mask_value(key, value));
    }

    Ok(result)
}

pub async fn update_settings(
    state: &AppState,
    data: &serde_json::Value,
) -> Result<Vec<String>, String> {
    let defaults = default_settings();
    let map = data.as_object().ok_or(ERR_INVALID_REQUEST)?;
    let mut to_save: HashMap<String, String> = HashMap::new();

    for (key, raw) in map {
        if !is_exposed_key(&defaults, key) || is_local_only_settings_key(key) {
            continue;
        }
        let value = raw.as_str().unwrap_or("").trim().to_string();
        if SENSITIVE_KEYS.contains(&key.as_str()) && value == MASK {
            continue;
        }
        to_save.insert(key.clone(), value);
    }

    upsert_settings(&state.db, &to_save).await?;

    let mut cache = state.settings.write().await;
    for (key, value) in &to_save {
        cache.insert(key.clone(), value.clone());
    }

    Ok(to_save.keys().cloned().collect())
}

pub async fn export_settings(state: &AppState, password: &str) -> Result<String, String> {
    if password.is_empty() {
        return Err(ERR_EMPTY_PASSWORD.to_string());
    }

    let defaults = default_settings();
    let raw_settings = load_all_settings(&state.db).await?;
    let mut map = BTreeMap::new();

    for key in defaults.keys() {
        if is_local_only_settings_key(key) {
            continue;
        }
        if let Some(value) = raw_settings.get(key) {
            map.insert(key.clone(), value.clone());
        }
    }

    let json = serde_json::to_string(&map).map_err(|e| e.to_string())?;
    encrypt_blob(json.as_bytes(), password, MAGIC_SETTINGS)
}

pub async fn import_settings(
    state: &AppState,
    data: &str,
    password: &str,
) -> Result<Vec<String>, String> {
    if password.is_empty() {
        return Err(ERR_EMPTY_PASSWORD.to_string());
    }

    let defaults = default_settings();
    let plaintext = decrypt_blob(data.trim(), password, MAGIC_SETTINGS)?;
    let json_str =
        std::str::from_utf8(&plaintext).map_err(|_| ERR_INVALID_DECRYPTED_DATA.to_string())?;
    let map: BTreeMap<String, String> =
        serde_json::from_str(json_str).map_err(|_| ERR_INVALID_CONFIG_CONTENT.to_string())?;

    let mut to_save = HashMap::new();
    for (key, value) in map {
        if is_exposed_key(&defaults, &key) && !is_local_only_settings_key(&key) {
            to_save.insert(key, value);
        }
    }

    if to_save.is_empty() {
        return Err(ERR_NO_VALID_CONFIG_ITEMS.to_string());
    }

    upsert_settings(&state.db, &to_save).await?;

    let mut cache = state.settings.write().await;
    for (key, value) in &to_save {
        cache.insert(key.clone(), value.clone());
    }

    Ok(to_save.keys().cloned().collect())
}

pub async fn export_all_data(
    state: &AppState,
    app: &tauri::AppHandle,
    password: &str,
) -> Result<String, String> {
    if password.is_empty() {
        return Err(ERR_EMPTY_PASSWORD.to_string());
    }

    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut tables = serde_json::Map::new();
    let mut assets = serde_json::Map::new();
    for table in BACKUP_TABLES {
        let rows = sqlx::query(&format!("SELECT * FROM {table}"))
            .fetch_all(&state.db)
            .await
            .map_err(|e| format!("导出表 {table} 失败: {e}"))?;

        let mut array = Vec::with_capacity(rows.len());
        for row in &rows {
            let value = row_to_json(row)?;
            collect_row_assets(table, &value, &app_data_dir, &mut assets);
            array.push(value);
        }

        tables.insert(table.to_string(), serde_json::Value::Array(array));
    }

    let payload = serde_json::json!({
        "version": 1,
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "tables": tables,
        "assets": assets,
    });

    let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    encrypt_blob(json.as_bytes(), password, MAGIC_BACKUP)
}

pub async fn import_all_data(
    state: &AppState,
    app: &tauri::AppHandle,
    data: &str,
    password: &str,
) -> Result<(), String> {
    if password.is_empty() {
        return Err(ERR_EMPTY_PASSWORD.to_string());
    }

    let plaintext = decrypt_blob(data.trim(), password, MAGIC_BACKUP)?;
    let json_str =
        std::str::from_utf8(&plaintext).map_err(|_| ERR_INVALID_DECRYPTED_DATA.to_string())?;
    let payload: serde_json::Value =
        serde_json::from_str(json_str).map_err(|_| ERR_INVALID_CONFIG_CONTENT.to_string())?;

    let tables = payload
        .get("tables")
        .and_then(|t| t.as_object())
        .ok_or("备份文件格式错误：缺少 tables 字段")?;
    let assets = payload.get("assets").and_then(|value| value.as_object());
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    // Clear all tables in reverse dependency order
    for table in BACKUP_TABLES.iter().rev() {
        sqlx::query(&format!("DELETE FROM {table}"))
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("清空表 {table} 失败: {e}"))?;
    }

    // Insert data in forward dependency order
    for table in BACKUP_TABLES {
        let Some(rows) = tables.get(*table).and_then(|r| r.as_array()) else {
            continue;
        };

        for row in rows {
            let Some(source_obj) = row.as_object() else {
                continue;
            };
            let mut obj = source_obj.clone();
            if obj.is_empty() {
                continue;
            }
            restore_row_assets(table, &mut obj, assets, &app_data_dir)?;

            let entries: Vec<(&String, &serde_json::Value)> = obj.iter().collect();
            let columns: Vec<String> = entries.iter().map(|(key, _)| (*key).clone()).collect();
            let columns_str = columns.join(", ");
            let placeholders: String = (0..entries.len())
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(", ");

            let sql = format!("INSERT INTO {table} ({columns_str}) VALUES ({placeholders})");
            let mut query = sqlx::query(&sql);
            for (_, value) in entries {
                query = match value {
                    serde_json::Value::Null => query.bind(Option::<String>::None),
                    serde_json::Value::String(value) => query.bind(value.clone()),
                    serde_json::Value::Bool(value) => {
                        query.bind(if *value { 1_i64 } else { 0_i64 })
                    }
                    serde_json::Value::Number(value) => {
                        if let Some(int_value) = value.as_i64() {
                            query.bind(int_value)
                        } else if let Some(uint_value) = value.as_u64() {
                            if uint_value <= i64::MAX as u64 {
                                query.bind(uint_value as i64)
                            } else {
                                query.bind(uint_value.to_string())
                            }
                        } else if let Some(float_value) = value.as_f64() {
                            query.bind(float_value)
                        } else {
                            query.bind(value.to_string())
                        }
                    }
                    _ => query.bind(value.to_string()),
                };
            }
            query
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("插入表 {table} 失败: {e}"))?;
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    // Refresh settings cache
    let raw_settings = load_all_settings(&state.db).await?;
    let defaults = default_settings();
    let mut cache = state.settings.write().await;
    cache.clear();
    for (key, value) in defaults {
        cache.insert(key, value);
    }
    for (key, value) in raw_settings {
        cache.insert(key, value);
    }

    Ok(())
}

pub async fn test_settings(state: &AppState, data: &serde_json::Value) -> Result<String, String> {
    let saved = state.settings.read().await.clone();
    let mut merged = saved;
    if let Some(map) = data.as_object() {
        for (key, value) in map {
            let next_value = value.as_str().unwrap_or("").trim().to_string();
            if next_value != MASK {
                merged.insert(key.clone(), next_value);
            }
        }
    }

    let client = LlmClient::from_settings(&merged).map_err(|e| e.to_string())?;
    // Minimal connectivity check: confirm the API is reachable and returns valid JSON.
    // We do not require non-empty text, because some Anthropic-compatible endpoints
    // (e.g. Kimi Coding) may return a 200 response with an empty content block.
    client.test().await.map_err(|e| e.to_string())?;
    Ok("连接正常".to_string())
}

/// 视觉模型连接测试：不同于普通文本测试，发送一张 1x1 测试图 + 文本，
/// 确认所配模型真正接受图片输入（即支持视觉），而不仅仅是 API 可达。
pub async fn test_vision_settings(
    state: &AppState,
    data: &serde_json::Value,
) -> Result<String, String> {
    let saved = state.settings.read().await.clone();
    let mut merged = saved;
    if let Some(map) = data.as_object() {
        for (key, value) in map {
            let next_value = value.as_str().unwrap_or("").trim().to_string();
            if next_value != MASK {
                merged.insert(key.clone(), next_value);
            }
        }
    }

    let (client, model) = LlmClient::vision_client_from_settings(&merged)
        .ok_or_else(|| "请先填写视觉模型名称。".to_string())?;
    // 64x64 蓝色 PNG（base64）。Kimi Coding 等端点会拒绝 1x1 极小图，
    // 因此用一个正常尺寸但足够小的测试图来确认端点接受 image 输入。
    const TEST_PNG_B64: &str =
        "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAY0lEQVR4nO3PQQ3AIADAQEArlpCJh4ngcVnSU9DOfe74s6UDXjWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgfdt0Aman/hOaAAAAAElFTkSuQmCC";
    let reply = client
        .chat_with_image(
            TEST_PNG_B64,
            "image/png",
            "请用一个词描述这张图片。",
            model.as_deref(),
            0.0,
        )
        .await
        .map_err(|e| explain_vision_error(&e.to_string(), model.as_deref()))?;
    Ok(reply.trim().to_string())
}

#[derive(serde::Serialize)]
pub struct TavilyKeyTest {
    /// 脱敏后的 Key 标识，仅用于在结果里区分是哪一个。
    pub label: String,
    pub ok: bool,
    pub message: String,
}

/// 逐个测试 Tavily Key 是否可用。复用 test_settings 的「已保存设置 + 草稿覆盖」口径，
/// 草稿里非掩码的 Key 优先，从而支持「填了还没保存就测试」。
pub async fn test_tavily(
    state: &AppState,
    data: &serde_json::Value,
) -> Result<Vec<TavilyKeyTest>, String> {
    let mut merged = state.settings.read().await.clone();
    if let Some(map) = data.as_object() {
        for (key, value) in map {
            let next_value = value.as_str().unwrap_or("").trim().to_string();
            if next_value != MASK {
                merged.insert(key.clone(), next_value);
            }
        }
    }

    let raw = merged.get("tavily_api_key").cloned().unwrap_or_default();
    let keys = crate::web_search::parse_tavily_keys(&raw);
    if keys.is_empty() {
        return Err("请先填写至少一个 Tavily API Key。".to_string());
    }

    let mut results = Vec::with_capacity(keys.len());
    for key in &keys {
        let (ok, message) = match crate::web_search::tavily_check_key(key).await {
            Ok(()) => (true, "可用".to_string()),
            Err(e) => (false, e.to_string()),
        };
        results.push(TavilyKeyTest {
            label: mask_tavily_key(key),
            ok,
            message,
        });
    }
    Ok(results)
}

/// 脱敏展示 Key：保留前 6、后 4 位，中间省略。
fn mask_tavily_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 12 {
        return "•".repeat(chars.len().max(1));
    }
    let head: String = chars[..6].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}…{tail}")
}

pub async fn list_ollama_models(base_url: Option<String>) -> Result<Vec<String>, String> {
    let url = base_url
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "http://localhost:11434".to_string());
    let api_url = format!(
        "{}/api/tags",
        url.trim_end_matches('/').trim_end_matches("/v1")
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama: {e}"))?;
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    Ok(json["models"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|model| model["name"].as_str().map(|name| name.to_string()))
        .collect())
}

/// 判断一个端点是否是 Ollama（原生 /api/tags，而不是 OpenAI 兼容的 /v1/models）。
fn is_ollama_endpoint(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("localhost:11434")
        || lower.contains("127.0.0.1:11434")
        || lower.contains("ollama.com/api")
        || lower.contains(":11434")
}

/// 构造模型列表 URL。
/// Anthropic 兼容端点若 base_url 没有 /v1 后缀，需要补成 /v1/models；
/// OpenAI 兼容端点默认 base_url 已含 /v1，直接拼 /models。
fn build_models_url(base_url: &str, is_anthropic: bool) -> String {
    let trimmed = base_url.trim_end_matches('/');
    let lower = trimmed.to_ascii_lowercase();
    if lower.ends_with("/v1") {
        format!("{}/models", trimmed)
    } else if is_anthropic {
        format!("{}/v1/models", trimmed)
    } else {
        format!("{}/models", trimmed)
    }
}

/// 查询 Ollama 原生 /api/tags 端点。
async fn list_models_ollama(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let api_url = format!(
        "{}/api/tags",
        base_url.trim_end_matches('/').trim_end_matches("/v1")
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.get(&api_url);
    if !api_key.is_empty() {
        request = request.header("Authorization", format!("Bearer {api_key}"));
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("请求模型列表失败: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let detail = body.chars().take(160).collect::<String>();
        return Err(format!("接口返回 {status}：{detail}"));
    }
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let mut models: Vec<String> = json["models"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|item| item["name"].as_str().map(|name| name.to_string()))
        .collect();
    models.sort();
    models.dedup();
    Ok(models)
}

/// 查询当前主服务商或指定端点的可用模型列表。
/// 如果 `data` 里包含 `list_models_base_url`，则优先用该独立地址 + `list_models_api_key`，
/// 并按 URL 特征自动判断是 Anthropic 兼容、Ollama 原生还是 OpenAI 兼容；否则回退到主服务商配置。
pub async fn list_models(
    state: &AppState,
    data: &serde_json::Value,
) -> Result<Vec<String>, String> {
    let mut merged = state.settings.read().await.clone();
    if let Some(map) = data.as_object() {
        for (key, value) in map {
            let next_value = value.as_str().unwrap_or("").trim().to_string();
            if next_value != MASK {
                merged.insert(key.clone(), next_value);
            }
        }
    }

    // 独立端点覆盖：供各角色/视觉/embedding 等有自己的 base_url/api_key 时使用。
    let override_base_url = merged
        .get("list_models_base_url")
        .cloned()
        .unwrap_or_default();
    let override_api_key = merged
        .get("list_models_api_key")
        .cloned()
        .unwrap_or_default();

    let provider = merged
        .get("llm_provider")
        .cloned()
        .unwrap_or_else(|| "openai".to_string());

    // 先拿到最终要查询的 base_url、api_key 和协议类型。
    let (base_url, api_key, is_anthropic) = if !override_base_url.is_empty() {
        let is_anthropic = is_anthropic_compatible_base_url(&override_base_url);
        // 如果独立端点没填 key，回退到主服务商 key，避免发送空 Authorization。
        let api_key = if override_api_key.is_empty() {
            match provider.as_str() {
                "anthropic" => merged.get("anthropic_api_key").cloned().unwrap_or_default(),
                "openai_compatible" => merged
                    .get("openai_compatible_api_key")
                    .cloned()
                    .unwrap_or_default(),
                _ => merged.get("openai_api_key").cloned().unwrap_or_default(),
            }
        } else {
            override_api_key
        };
        (override_base_url, api_key, is_anthropic)
    } else {
        match provider.as_str() {
            "anthropic" => (
                "https://api.anthropic.com/v1".to_string(),
                merged.get("anthropic_api_key").cloned().unwrap_or_default(),
                true,
            ),
            "openai_compatible" => {
                let base = merged
                    .get("openai_compatible_base_url")
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "请先填写接口地址".to_string())?;
                let is_anthropic = is_anthropic_compatible_base_url(&base);
                (
                    base,
                    merged
                        .get("openai_compatible_api_key")
                        .cloned()
                        .unwrap_or_default(),
                    is_anthropic,
                )
            }
            _ => {
                let base = merged
                    .get("openai_base_url")
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
                (
                    base,
                    merged.get("openai_api_key").cloned().unwrap_or_default(),
                    false,
                )
            }
        }
    };

    // Ollama 原生端点走 /api/tags，而不是 /v1/models。
    if is_ollama_endpoint(&base_url) {
        return list_models_ollama(&base_url, &api_key).await;
    }

    let models_url = build_models_url(&base_url, is_anthropic);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let request = if is_anthropic {
        // Kimi Code 的 /models 端点实际走 OpenAI 兼容认证（Authorization: Bearer），
        // 而不是 Anthropic 的 x-api-key；/messages 仍保持 x-api-key。
        let is_kimi_coding = models_url
            .to_ascii_lowercase()
            .contains("api.kimi.com/coding");
        if is_kimi_coding {
            client
                .get(&models_url)
                .header("Authorization", format!("Bearer {api_key}"))
        } else {
            let (auth_header, auth_value) = anthropic_auth_header(&models_url, &api_key);
            client
                .get(&models_url)
                .header(auth_header, auth_value)
                .header("anthropic-version", "2023-06-01")
        }
    } else {
        client
            .get(&models_url)
            .header("Authorization", format!("Bearer {api_key}"))
    };

    let response = request
        .send()
        .await
        .map_err(|e| format!("请求模型列表失败: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let detail = body.chars().take(160).collect::<String>();
        return Err(format!("接口返回 {status}：{detail}"));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let mut models: Vec<String> = json["data"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|item| item["id"].as_str().map(|id| id.to_string()))
        .collect();
    models.sort();
    models.dedup();
    Ok(models)
}

pub async fn list_settings_history_entries(
    state: &AppState,
) -> Result<Vec<SettingsHistoryEntry>, String> {
    let rows = list_settings_history(&state.db).await?;
    let defaults = default_settings();
    let mut items = Vec::with_capacity(rows.len());

    for row in rows {
        let snapshot: HashMap<String, String> = serde_json::from_str(&row.settings_json)
            .map_err(|e| format!("解析配置历史失败（{}）: {e}", row.name))?;
        let merged = merge_with_defaults(&defaults, &snapshot);
        items.push(settings_history_entry(
            row.id,
            row.name,
            row.created_at,
            &merged,
        ));
    }

    Ok(items)
}

pub async fn save_settings_history_entry(
    state: &AppState,
    data: &serde_json::Value,
    name: Option<&str>,
) -> Result<SettingsHistoryEntry, String> {
    let settings = resolve_snapshot_settings(state, data).await?;
    let id = Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    let normalized_name = name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(default_snapshot_name);
    let settings_json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;

    insert_settings_history(
        &state.db,
        &id,
        &normalized_name,
        &settings_json,
        &created_at,
    )
    .await?;

    Ok(settings_history_entry(
        id,
        normalized_name,
        created_at,
        &settings,
    ))
}

pub async fn update_settings_history_entry(
    state: &AppState,
    id: &str,
    data: &serde_json::Value,
    name: Option<&str>,
) -> Result<SettingsHistoryEntry, String> {
    let row = get_settings_history(&state.db, id)
        .await?
        .ok_or_else(|| ERR_SETTINGS_HISTORY_NOT_FOUND.to_string())?;
    let settings = resolve_snapshot_settings(state, data).await?;
    let normalized_name = name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or(row.name);
    let settings_json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;

    let updated = update_settings_history(&state.db, id, &normalized_name, &settings_json).await?;
    if !updated {
        return Err(ERR_SETTINGS_HISTORY_NOT_FOUND.to_string());
    }

    Ok(settings_history_entry(
        id.to_string(),
        normalized_name,
        row.created_at,
        &settings,
    ))
}

pub async fn rename_settings_history_entry(
    state: &AppState,
    id: &str,
    name: &str,
) -> Result<SettingsHistoryEntry, String> {
    let normalized_name = name.trim();
    if normalized_name.is_empty() {
        return Err("配置名称不能为空。".to_string());
    }

    let row = get_settings_history(&state.db, id)
        .await?
        .ok_or_else(|| ERR_SETTINGS_HISTORY_NOT_FOUND.to_string())?;
    let defaults = default_settings();
    let snapshot: HashMap<String, String> = serde_json::from_str(&row.settings_json)
        .map_err(|e| format!("解析配置历史失败（{}）: {e}", row.name))?;
    let merged = merge_with_defaults(&defaults, &snapshot);
    let updated = rename_settings_history(&state.db, id, normalized_name).await?;
    if !updated {
        return Err(ERR_SETTINGS_HISTORY_NOT_FOUND.to_string());
    }

    Ok(settings_history_entry(
        row.id,
        normalized_name.to_string(),
        row.created_at,
        &merged,
    ))
}

pub async fn apply_settings_history_entry(
    state: &AppState,
    id: &str,
) -> Result<HashMap<String, String>, String> {
    let row = get_settings_history(&state.db, id)
        .await?
        .ok_or_else(|| ERR_SETTINGS_HISTORY_NOT_FOUND.to_string())?;
    let defaults = default_settings();
    let snapshot: HashMap<String, String> =
        serde_json::from_str(&row.settings_json).map_err(|e| format!("解析配置历史失败: {e}"))?;

    let mut to_save = HashMap::new();
    for (key, value) in snapshot {
        if defaults.contains_key(&key) && !is_local_only_settings_key(&key) {
            to_save.insert(key, value);
        }
    }

    if to_save.is_empty() {
        return Err(ERR_SETTINGS_HISTORY_EMPTY.to_string());
    }

    upsert_settings(&state.db, &to_save).await?;

    let mut cache = state.settings.write().await;
    for (key, value) in &to_save {
        cache.insert(key.clone(), value.clone());
    }
    drop(cache);

    get_exposed_settings(state).await
}

pub async fn delete_settings_history_entry(state: &AppState, id: &str) -> Result<(), String> {
    let deleted = delete_settings_history(&state.db, id).await?;
    if !deleted {
        return Err(ERR_SETTINGS_HISTORY_NOT_FOUND.to_string());
    }
    Ok(())
}
