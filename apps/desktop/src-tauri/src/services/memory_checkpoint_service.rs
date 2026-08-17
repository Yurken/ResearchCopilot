use anyhow::Result;
use serde_json::{json, Value};
use sqlx::Row;
use sqlx::SqlitePool;
use uuid::Uuid;

pub struct ChatCheckpointInput<'a> {
    pub session_id: &'a str,
    pub request_id: &'a str,
    pub context_type: &'a str,
    pub context_id: Option<&'a str>,
    pub user_message: &'a str,
    pub assistant_message: &'a str,
    pub source_count: usize,
}

pub struct ChatFailureCheckpointInput<'a> {
    pub session_id: &'a str,
    pub request_id: &'a str,
    pub context_type: &'a str,
    pub context_id: Option<&'a str>,
    pub user_message: &'a str,
    pub error_message: &'a str,
}

struct CheckpointDraft {
    goal: String,
    summary: String,
    completed_items: Vec<String>,
    open_questions: Vec<String>,
    next_steps: Vec<String>,
    status: &'static str,
}

pub struct ResearchAssetCheckpointInput<'a> {
    pub context_type: &'a str,
    pub context_id: &'a str,
    pub action: &'a str,
    pub goal: &'a str,
    pub summary: &'a str,
    pub completed_items: Vec<String>,
    pub open_questions: Vec<String>,
    pub next_steps: Vec<String>,
    pub asset_snapshot: Value,
}

fn sqlite_now() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn safe_truncate(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }

    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

fn compact_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn preview_text(value: &str, max_bytes: usize) -> String {
    let compact = compact_text(value);
    if compact.len() > max_bytes {
        format!("{}…", safe_truncate(&compact, max_bytes))
    } else {
        compact
    }
}

fn context_next_step(context_type: &str) -> &'static str {
    match context_type {
        "interest" => "将本轮结论同步到研究主题的下一步计划或待读论文中。",
        "paper" => "将本轮结论沉淀到论文笔记、精读问题或复现计划中。",
        _ => "按需继续追问，或把有价值的结论沉淀为知识笔记。",
    }
}

fn entity_type_for_context(context_type: &str) -> Option<&'static str> {
    match context_type {
        "interest" => Some("research_interest"),
        "paper" => Some("paper"),
        "experiment" => Some("experiment"),
        _ => None,
    }
}

pub fn research_interest_asset_snapshot(
    topic: &str,
    keywords: &[String],
    profile: Option<&Value>,
    hypothesis_card: Option<&Value>,
    learning_path: Option<&Value>,
) -> Value {
    json!({
        "topic": topic,
        "keywords": keywords,
        "profile": profile,
        "hypothesis_card": hypothesis_card,
        "learning_path": learning_path,
    })
}

pub fn experiment_asset_snapshot(title: &str, config: &Value, result: &str, notes: &str) -> Value {
    json!({
        "title": title,
        "config": config,
        "result": result,
        "notes": notes,
    })
}

fn build_completion_draft(input: &ChatCheckpointInput<'_>) -> CheckpointDraft {
    let goal = preview_text(input.user_message, 160);
    let answer_preview = preview_text(input.assistant_message, 360);
    let mut completed_items = vec!["小妍已完成本轮答复。".to_string()];
    if input.source_count > 0 {
        completed_items.push(format!("本轮答复关联了 {} 条来源。", input.source_count));
    }

    let mut open_questions = Vec::new();
    if input.assistant_message.contains("信息不足")
        || input.assistant_message.contains("无法判断")
        || input.assistant_message.contains("需要补充")
    {
        open_questions.push("本轮答复仍存在信息不足，需要用户补充材料或确认范围。".to_string());
    }

    CheckpointDraft {
        goal: goal.clone(),
        summary: format!("用户目标：{goal}\n小妍答复摘要：{answer_preview}"),
        completed_items,
        open_questions,
        next_steps: vec![context_next_step(input.context_type).to_string()],
        status: "completed",
    }
}

fn build_failure_draft(input: &ChatFailureCheckpointInput<'_>) -> CheckpointDraft {
    let goal = preview_text(input.user_message, 160);
    let error_preview = preview_text(input.error_message, 240);

    CheckpointDraft {
        goal: goal.clone(),
        summary: format!("用户目标：{goal}\n本轮未完成，失败原因：{error_preview}"),
        completed_items: Vec::new(),
        open_questions: vec!["本轮答复失败，后续需要重新尝试或调整模型/上下文配置。".to_string()],
        next_steps: vec!["重新发起本轮问题，或先检查模型连接、上下文材料和权限设置。".to_string()],
        status: "failed",
    }
}

async fn insert_checkpoint(
    db: &SqlitePool,
    session_id: &str,
    request_id: &str,
    context_type: &str,
    context_id: Option<&str>,
    draft: CheckpointDraft,
) -> Result<String> {
    let checkpoint_id = Uuid::new_v4().to_string();
    let now = sqlite_now();
    let completed_items = serde_json::to_string(&draft.completed_items)?;
    let open_questions = serde_json::to_string(&draft.open_questions)?;
    let next_steps = serde_json::to_string(&draft.next_steps)?;

    sqlx::query(
        "INSERT INTO memory_session_summaries (
            id, session_id, request_id, context_type, context_id, goal, summary,
            completed_items, open_questions, next_steps, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&checkpoint_id)
    .bind(session_id)
    .bind(request_id)
    .bind(context_type)
    .bind(context_id)
    .bind(&draft.goal)
    .bind(&draft.summary)
    .bind(completed_items)
    .bind(open_questions)
    .bind(next_steps)
    .bind(draft.status)
    .bind(&now)
    .bind(&now)
    .execute(db)
    .await?;

    insert_memory_link(db, &checkpoint_id, "chat_session", session_id, "session").await?;
    if let (Some(entity_type), Some(entity_id)) =
        (entity_type_for_context(context_type), context_id)
    {
        insert_memory_link(db, &checkpoint_id, entity_type, entity_id, "context").await?;
    }

    Ok(checkpoint_id)
}

pub async fn record_research_asset_checkpoint(
    db: &SqlitePool,
    input: ResearchAssetCheckpointInput<'_>,
) -> Result<String> {
    let session_id = format!("asset:{}:{}", input.context_type, input.context_id);
    let now = sqlite_now();
    sqlx::query(
        "INSERT OR IGNORE INTO chat_sessions (id, title, context_type, context_id, created_at, updated_at)
         VALUES (?, ?, 'asset_checkpoint', ?, ?, ?)",
    )
    .bind(&session_id)
    .bind(format!("研究资产自动记录：{}", preview_text(input.goal, 80)))
    .bind(input.context_id)
    .bind(&now)
    .bind(&now)
    .execute(db)
    .await?;

    let checkpoint_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO memory_session_summaries (
            id, session_id, request_id, context_type, context_id, goal, summary,
            completed_items, open_questions, next_steps, status, source, asset_snapshot,
            review_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, 'pending', ?, ?)",
    )
    .bind(&checkpoint_id)
    .bind(&session_id)
    .bind(input.action)
    .bind(input.context_type)
    .bind(input.context_id)
    .bind(preview_text(input.goal, 160))
    .bind(preview_text(input.summary, 600))
    .bind(serde_json::to_string(&input.completed_items)?)
    .bind(serde_json::to_string(&input.open_questions)?)
    .bind(serde_json::to_string(&input.next_steps)?)
    .bind("asset_auto")
    .bind(serde_json::to_string(&input.asset_snapshot)?)
    .bind(&now)
    .bind(&now)
    .execute(db)
    .await?;
    insert_memory_link(
        db,
        &checkpoint_id,
        entity_type_for_context(input.context_type).unwrap_or("research_asset"),
        input.context_id,
        "asset_change",
    )
    .await?;
    Ok(checkpoint_id)
}

async fn insert_memory_link(
    db: &SqlitePool,
    checkpoint_id: &str,
    entity_type: &str,
    entity_id: &str,
    relation: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO memory_links (
            id, checkpoint_id, observation_id, entity_type, entity_id, relation, created_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(checkpoint_id)
    .bind(entity_type)
    .bind(entity_id)
    .bind(relation)
    .bind(sqlite_now())
    .execute(db)
    .await?;

    Ok(())
}

pub async fn record_chat_checkpoint(
    db: &SqlitePool,
    input: ChatCheckpointInput<'_>,
) -> Result<String> {
    let draft = build_completion_draft(&input);
    insert_checkpoint(
        db,
        input.session_id,
        input.request_id,
        input.context_type,
        input.context_id,
        draft,
    )
    .await
}

pub async fn record_chat_failure_checkpoint(
    db: &SqlitePool,
    input: ChatFailureCheckpointInput<'_>,
) -> Result<String> {
    let draft = build_failure_draft(&input);
    insert_checkpoint(
        db,
        input.session_id,
        input.request_id,
        input.context_type,
        input.context_id,
        draft,
    )
    .await
}

pub fn parse_checkpoint_list(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

pub async fn list_recent_checkpoints(db: &SqlitePool, limit: i64) -> Result<Value> {
    let rows = sqlx::query(
        "SELECT id, session_id, request_id, context_type, context_id, goal, summary,
                completed_items, open_questions, next_steps, status, source, asset_snapshot,
                review_status, review_note, created_at, updated_at
         FROM memory_session_summaries
         ORDER BY updated_at DESC
         LIMIT ?",
    )
    .bind(limit.clamp(1, 30))
    .fetch_all(db)
    .await?;

    let checkpoints: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "session_id": row.get::<String, _>("session_id"),
                "request_id": row.get::<Option<String>, _>("request_id"),
                "context_type": row.get::<String, _>("context_type"),
                "context_id": row.get::<Option<String>, _>("context_id"),
                "goal": row.get::<String, _>("goal"),
                "summary": row.get::<String, _>("summary"),
                "completed_items": parse_checkpoint_list(&row.get::<String, _>("completed_items")),
                "open_questions": parse_checkpoint_list(&row.get::<String, _>("open_questions")),
                "next_steps": parse_checkpoint_list(&row.get::<String, _>("next_steps")),
                "status": row.get::<String, _>("status"),
                "source": row.get::<String, _>("source"),
                "asset_snapshot": serde_json::from_str::<Value>(&row.get::<String, _>("asset_snapshot")).unwrap_or_else(|_| json!({})),
                "review_status": row.get::<String, _>("review_status"),
                "review_note": row.get::<String, _>("review_note"),
                "created_at": row.get::<String, _>("created_at"),
                "updated_at": row.get::<String, _>("updated_at"),
            })
        })
        .collect();

    Ok(json!({ "checkpoints": checkpoints }))
}

pub fn checkpoint_to_memory_line(
    updated_at: &str,
    goal: &str,
    summary: &str,
    next_steps_json: &str,
) -> String {
    let next_steps = parse_checkpoint_list(next_steps_json);
    let next_step = next_steps
        .first()
        .map(|value| format!(" 下一步：{value}"))
        .unwrap_or_default();
    let time = if updated_at.len() >= 16 {
        updated_at[5..16].to_string()
    } else {
        updated_at.to_string()
    };
    let compact_summary = preview_text(summary, 180);

    format!(
        "  {time} 目标：{}；摘要：{}{}",
        preview_text(goal, 80),
        compact_summary,
        next_step
    )
}

#[cfg(test)]
mod tests {
    use super::{
        build_completion_draft, checkpoint_to_memory_line, list_recent_checkpoints,
        record_research_asset_checkpoint, ChatCheckpointInput, ResearchAssetCheckpointInput,
    };
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    #[test]
    fn completion_checkpoint_records_source_count_and_next_step() {
        let draft = build_completion_draft(&ChatCheckpointInput {
            session_id: "session-1",
            request_id: "request-1",
            context_type: "interest",
            context_id: Some("interest-1"),
            user_message: "帮我规划 Graph RAG 下一步",
            assistant_message: "可以先整理代表论文，再设计一个小实验。",
            source_count: 2,
        });

        assert!(draft
            .completed_items
            .iter()
            .any(|item| item.contains("2 条来源")));
        assert!(draft.next_steps[0].contains("研究主题"));
    }

    #[test]
    fn checkpoint_memory_line_contains_first_next_step() {
        let line = checkpoint_to_memory_line(
            "2026-05-15 10:30:00",
            "规划下一步",
            "已经完成路线梳理",
            "[\"继续阅读核心论文\"]",
        );

        assert!(line.contains("继续阅读核心论文"));
    }

    #[tokio::test]
    async fn asset_checkpoint_persists_snapshot_and_pending_review() -> anyhow::Result<()> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await?;
        sqlx::raw_sql("PRAGMA foreign_keys = ON; CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, title TEXT, context_type TEXT, context_id TEXT, created_at TEXT, updated_at TEXT);")
            .execute(&pool).await?;
        sqlx::raw_sql("CREATE TABLE memory_observations (id TEXT PRIMARY KEY);")
            .execute(&pool)
            .await?;
        sqlx::raw_sql(crate::db::MEMORY_CHECKPOINT_DDL)
            .execute(&pool)
            .await?;
        let id = record_research_asset_checkpoint(
            &pool,
            ResearchAssetCheckpointInput {
                context_type: "interest",
                context_id: "interest-1",
                action: "interest.plan_completed",
                goal: "验证假设",
                summary: "规划完成",
                completed_items: vec!["生成计划".into()],
                open_questions: vec!["数据量".into()],
                next_steps: vec!["执行对照".into()],
                asset_snapshot: json!({"topic":"Graph RAG","version":2}),
            },
        )
        .await?;
        let listed = list_recent_checkpoints(&pool, 8).await?;
        let checkpoint = &listed["checkpoints"][0];
        assert_eq!(checkpoint["id"], id);
        assert_eq!(checkpoint["source"], "asset_auto");
        assert_eq!(checkpoint["review_status"], "pending");
        assert_eq!(checkpoint["asset_snapshot"]["version"], 2);
        Ok(())
    }
}
