use anyhow::{bail, Result};
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

pub struct ReviewFeedbackInput<'a> {
    pub submission_id: &'a str,
    pub review_run_id: &'a str,
    pub reviewer: &'a str,
    pub item_key: &'a str,
    pub suggestion: &'a str,
    pub status: &'a str,
    pub reason: Option<&'a str>,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn validate_review_feedback(status: &str, reason: Option<&str>) -> Result<()> {
    if !matches!(status, "pending" | "adopted" | "ignored" | "done") {
        bail!("预审反馈状态无效");
    }
    if status == "ignored" && reason.unwrap_or("").trim().is_empty() {
        bail!("忽略建议时需要填写原因");
    }
    Ok(())
}

pub async fn upsert_review_feedback(db: &SqlitePool, input: ReviewFeedbackInput<'_>) -> Result<()> {
    validate_review_feedback(input.status, input.reason)?;
    let timestamp = now();
    sqlx::query(
        "INSERT INTO submission_review_feedback
            (id, submission_id, review_run_id, reviewer, item_key, suggestion, status, reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(submission_id, review_run_id, item_key) DO UPDATE SET
            reviewer = excluded.reviewer,
            suggestion = excluded.suggestion,
            status = excluded.status,
            reason = excluded.reason,
            updated_at = excluded.updated_at",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(input.submission_id)
    .bind(input.review_run_id)
    .bind(input.reviewer)
    .bind(input.item_key)
    .bind(input.suggestion)
    .bind(input.status)
    .bind(input.reason.unwrap_or("").trim())
    .bind(&timestamp)
    .bind(&timestamp)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn review_feedback_summary(db: &SqlitePool, submission_id: &str) -> Result<Value> {
    let rows = sqlx::query(
        "SELECT status, COUNT(*) AS count FROM submission_review_feedback
         WHERE submission_id = ? GROUP BY status",
    )
    .bind(submission_id)
    .fetch_all(db)
    .await?;
    let mut counts = json!({ "pending": 0, "adopted": 0, "ignored": 0, "done": 0 });
    for row in rows {
        let status: String = row.get("status");
        let count: i64 = row.get("count");
        counts[status] = json!(count);
    }
    Ok(json!({ "counts": counts }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool() -> Result<SqlitePool> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await?;
        sqlx::raw_sql(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE submissions (id TEXT PRIMARY KEY);
             INSERT INTO submissions (id) VALUES ('submission-1');",
        )
        .execute(&pool)
        .await?;
        sqlx::raw_sql(crate::db::SUBMISSION_DIAGNOSIS_DDL)
            .execute(&pool)
            .await?;
        Ok(pool)
    }

    #[test]
    fn requires_reason_when_ignored() {
        assert!(validate_review_feedback("ignored", None).is_err());
        assert!(validate_review_feedback("ignored", Some("无法定位证据")).is_ok());
        assert!(validate_review_feedback("adopted", None).is_ok());
        assert!(validate_review_feedback("unknown", None).is_err());
    }

    #[tokio::test]
    async fn persists_feedback_and_updates_summary_without_double_counting() -> Result<()> {
        let pool = pool().await?;
        let input = |status, reason| ReviewFeedbackInput {
            submission_id: "submission-1",
            review_run_id: "run-1",
            reviewer: "方法审稿人",
            item_key: "reviewer-0:0",
            suggestion: "补充消融实验",
            status,
            reason,
        };
        upsert_review_feedback(&pool, input("adopted", None)).await?;
        upsert_review_feedback(&pool, input("done", None)).await?;
        let summary = review_feedback_summary(&pool, "submission-1").await?;
        assert_eq!(summary["counts"]["adopted"], 0);
        assert_eq!(summary["counts"]["done"], 1);
        Ok(())
    }
}
