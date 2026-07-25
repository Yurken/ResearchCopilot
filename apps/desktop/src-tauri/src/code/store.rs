//! 代码会话的本地持久化。
//!
//! 所有记录写入 SQLite 表 `experiment_code_sessions`，归属于某个 experiment。

use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use super::{CodeMessage, CodeSession};

pub fn now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

fn parse_messages(raw: &str) -> Vec<CodeMessage> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn row_to_session(row: &sqlx::sqlite::SqliteRow) -> CodeSession {
    let messages_raw: String = row.get("messages_json");
    CodeSession {
        id: row.get("id"),
        experiment_id: row.get("experiment_id"),
        title: row.get("title"),
        working_dir: row.get("working_dir"),
        tool_id: row.get("tool_id"),
        model: row.get("model"),
        messages: parse_messages(&messages_raw),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

pub async fn create_session(
    db: &SqlitePool,
    experiment_id: &str,
    title: &str,
    working_dir: Option<&str>,
) -> anyhow::Result<CodeSession> {
    let id = Uuid::new_v4().to_string();
    let ts = now();
    sqlx::query(
        "INSERT INTO experiment_code_sessions (id, experiment_id, title, working_dir, messages_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, '[]', ?, ?)",
    )
    .bind(&id)
    .bind(experiment_id)
    .bind(title)
    .bind(working_dir)
    .bind(&ts)
    .bind(&ts)
    .execute(db)
    .await?;

    Ok(CodeSession {
        id,
        experiment_id: experiment_id.to_string(),
        title: title.to_string(),
        working_dir: working_dir.map(|s| s.to_string()),
        tool_id: None,
        model: None,
        messages: vec![],
        created_at: ts.clone(),
        updated_at: ts,
    })
}

pub async fn list_sessions(
    db: &SqlitePool,
    experiment_id: &str,
) -> anyhow::Result<Vec<CodeSession>> {
    let rows = sqlx::query(
        "SELECT id, experiment_id, title, working_dir, tool_id, model, messages_json, created_at, updated_at
         FROM experiment_code_sessions WHERE experiment_id = ? ORDER BY updated_at DESC",
    )
    .bind(experiment_id)
    .fetch_all(db)
    .await?;
    Ok(rows.iter().map(row_to_session).collect())
}

pub async fn get_session(db: &SqlitePool, session_id: &str) -> anyhow::Result<CodeSession> {
    let row = sqlx::query(
        "SELECT id, experiment_id, title, working_dir, tool_id, model, messages_json, created_at, updated_at
         FROM experiment_code_sessions WHERE id = ?",
    )
    .bind(session_id)
    .fetch_optional(db)
    .await?;

    match row {
        Some(row) => Ok(row_to_session(&row)),
        None => anyhow::bail!("会话不存在"),
    }
}

pub async fn delete_session(db: &SqlitePool, session_id: &str) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM experiment_code_sessions WHERE id = ?")
        .bind(session_id)
        .execute(db)
        .await?;
    Ok(())
}

/// 局部更新会话元数据（任一字段为 None 即跳过）。
pub async fn update_session(
    db: &SqlitePool,
    session_id: &str,
    title: Option<&str>,
    working_dir: Option<&str>,
    tool_id: Option<&str>,
    model: Option<&str>,
) -> anyhow::Result<()> {
    let mut sets: Vec<&str> = Vec::new();
    let mut binds: Vec<String> = Vec::new();

    if let Some(t) = title {
        sets.push("title = ?");
        binds.push(t.to_string());
    }
    if let Some(d) = working_dir {
        sets.push("working_dir = ?");
        binds.push(d.to_string());
    }
    if let Some(t) = tool_id {
        sets.push("tool_id = ?");
        binds.push(t.to_string());
    }
    if let Some(m) = model {
        sets.push("model = ?");
        binds.push(m.to_string());
    }
    if sets.is_empty() {
        return Ok(());
    }

    sets.push("updated_at = ?");
    binds.push(now());

    let sql = format!(
        "UPDATE experiment_code_sessions SET {} WHERE id = ?",
        sets.join(", ")
    );
    let mut query = sqlx::query(&sql);
    for b in &binds {
        query = query.bind(b);
    }
    query.bind(session_id).execute(db).await?;
    Ok(())
}

/// 追加一条消息，并刷新 updated_at；assistant 消息会顺带记录会话最近使用的工具/模型。
pub async fn persist_message(
    db: &SqlitePool,
    session_id: &str,
    msg: &CodeMessage,
) -> anyhow::Result<()> {
    let row = sqlx::query("SELECT messages_json FROM experiment_code_sessions WHERE id = ?")
        .bind(session_id)
        .fetch_optional(db)
        .await?;

    let mut messages: Vec<CodeMessage> = match row {
        Some(r) => parse_messages(&r.get::<String, _>("messages_json")),
        None => vec![],
    };
    messages.push(msg.clone());
    let json = serde_json::to_string(&messages)?;
    let ts = now();

    // assistant 消息记录最近模型；tool_id 仅为兼容旧数据，存在时一并更新。
    if msg.role == "assistant" && (msg.tool_id.is_some() || msg.model.is_some()) {
        sqlx::query(
            "UPDATE experiment_code_sessions
             SET messages_json = ?,
                 tool_id = COALESCE(?, tool_id),
                 model = COALESCE(?, model),
                 updated_at = ?
             WHERE id = ?",
        )
        .bind(&json)
        .bind(&msg.tool_id)
        .bind(&msg.model)
        .bind(&ts)
        .bind(session_id)
        .execute(db)
        .await?;
    } else {
        sqlx::query(
            "UPDATE experiment_code_sessions SET messages_json = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&json)
        .bind(&ts)
        .bind(session_id)
        .execute(db)
        .await?;
    }
    Ok(())
}

/// 若会话仍是默认标题，用首条用户消息生成标题。
pub async fn maybe_autotitle(db: &SqlitePool, session_id: &str, content: &str) {
    if let Ok(session) = get_session(db, session_id).await {
        // 兼容前端默认标题 "新会话" 与旧默认 "新对话"
        let is_default_title = session.title == "新会话"
            || session.title == "新对话"
            || session.title.trim().is_empty();
        if session.messages.len() <= 1 && is_default_title {
            let truncated: String = content.chars().take(50).collect();
            let _ = sqlx::query(
                "UPDATE experiment_code_sessions SET title = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&truncated)
            .bind(now())
            .bind(session_id)
            .execute(db)
            .await;
        }
    }
}

/// 删除指定用户消息及其之后的所有消息（用于编辑并重发）。
pub async fn edit_message(
    db: &SqlitePool,
    session_id: &str,
    message_id: &str,
) -> anyhow::Result<()> {
    let mut session = get_session(db, session_id).await?;
    let idx = session
        .messages
        .iter()
        .position(|m| m.id == message_id && m.role == "user")
        .ok_or_else(|| anyhow::anyhow!("消息不存在或不可编辑"))?;
    session.messages.truncate(idx);

    let json = serde_json::to_string(&session.messages)?;
    let ts = now();
    sqlx::query(
        "UPDATE experiment_code_sessions SET messages_json = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&json)
    .bind(&ts)
    .bind(session_id)
    .execute(db)
    .await?;
    Ok(())
}

/// 更新会话标题（用于 AI 自动标题生成）
pub async fn update_session_title(
    db: &SqlitePool,
    session_id: &str,
    title: &str,
) -> anyhow::Result<()> {
    sqlx::query("UPDATE experiment_code_sessions SET title = ?, updated_at = ? WHERE id = ?")
        .bind(title)
        .bind(now())
        .bind(session_id)
        .execute(db)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn persists_only_display_content_and_tracks_assistant_model(
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
             (id, title, config, result, notes, created_at, updated_at)
             VALUES ('experiment-1', 'test', '{}', '', '', '2026-07-22', '2026-07-22')",
        )
        .execute(&pool)
        .await?;
        let session = create_session(&pool, "experiment-1", "新会话", Some("/project")).await?;

        persist_message(
            &pool,
            &session.id,
            &CodeMessage {
                id: "user-1".into(),
                role: "user".into(),
                content: "用户可见内容".into(),
                tool_calls: None,
                tool_results: None,
                tool_call_id: None,
                tool_id: None,
                model: None,
                duration_ms: None,
                created_at: now(),
            },
        )
        .await?;
        persist_message(
            &pool,
            &session.id,
            &CodeMessage {
                id: "assistant-1".into(),
                role: "assistant".into(),
                content: "完成".into(),
                tool_calls: None,
                tool_results: None,
                tool_call_id: None,
                tool_id: None,
                model: Some("code-model".into()),
                duration_ms: Some(20),
                created_at: now(),
            },
        )
        .await?;

        let stored = get_session(&pool, &session.id).await?;
        assert_eq!(stored.messages[0].content, "用户可见内容");
        assert_eq!(stored.model.as_deref(), Some("code-model"));
        Ok(())
    }
}
