use sqlx::SqlitePool;

pub const INTEREST_PLAN_BUSY_ERROR: &str = "该研究主题的规划正在生成中，请等待完成后再试。";
pub const INTEREST_PLANNING_DELETE_ERROR: &str = "该研究主题的规划正在生成中，请等待完成后再删除。";

/// 原子地把主题置为 planning：已是 planning 时拒绝（并发防护），主题不存在时报错。
pub async fn mark_interest_plan_running(db: &SqlitePool, id: &str) -> Result<(), String> {
    let result = sqlx::query(
        "UPDATE research_interests SET status = 'planning' WHERE id = ? AND status != 'planning'",
    )
    .bind(id)
    .execute(db)
    .await
    .map_err(|e| e.to_string())?;

    if result.rows_affected() == 0 {
        let exists: Option<String> =
            sqlx::query_scalar("SELECT id FROM research_interests WHERE id = ?")
                .bind(id)
                .fetch_optional(db)
                .await
                .map_err(|e| e.to_string())?;
        return Err(if exists.is_some() {
            INTEREST_PLAN_BUSY_ERROR.to_string()
        } else {
            "未找到对应研究方向。".to_string()
        });
    }

    Ok(())
}

pub async fn mark_interest_plan_planned(
    db: &SqlitePool,
    id: &str,
    learning_path: &str,
) -> Result<(), String> {
    let result =
        sqlx::query("UPDATE research_interests SET learning_path = ?, status = 'planned' WHERE id = ?")
            .bind(learning_path)
            .bind(id)
            .execute(db)
            .await
            .map_err(|e| e.to_string())?;

    if result.rows_affected() == 0 {
        return Err("未找到对应研究方向。".to_string());
    }

    Ok(())
}

pub async fn restore_interest_plan_status(db: &SqlitePool, id: &str) -> Result<String, String> {
    let learning_path: Option<String> = sqlx::query_scalar::<_, Option<String>>(
        "SELECT learning_path FROM research_interests WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(db)
    .await
    .map_err(|e| e.to_string())?
    .flatten();
    let next_status = if learning_path
        .as_deref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        "planned"
    } else {
        "active"
    };

    sqlx::query("UPDATE research_interests SET status = ? WHERE id = ?")
        .bind(next_status)
        .bind(id)
        .execute(db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(next_status.to_string())
}

/// 删除守卫：规划生成中的主题不允许删除，避免产生孤儿检查点与幽灵快照。
pub async fn ensure_interest_not_planning(db: &SqlitePool, id: &str) -> Result<(), String> {
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM research_interests WHERE id = ?")
            .bind(id)
            .fetch_optional(db)
            .await
            .map_err(|e| e.to_string())?;

    match status.as_deref() {
        Some("planning") => Err(INTEREST_PLANNING_DELETE_ERROR.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create in-memory sqlite");
        sqlx::query(
            "CREATE TABLE research_interests (
                id TEXT PRIMARY KEY,
                topic TEXT NOT NULL,
                learning_path TEXT,
                status TEXT NOT NULL DEFAULT 'active'
            )",
        )
        .execute(&pool)
        .await
        .expect("create research_interests table");
        pool
    }

    async fn insert_interest(pool: &SqlitePool, id: &str, status: &str, learning_path: Option<&str>) {
        sqlx::query(
            "INSERT INTO research_interests (id, topic, learning_path, status) VALUES (?, '主题', ?, ?)",
        )
        .bind(id)
        .bind(learning_path)
        .bind(status)
        .execute(pool)
        .await
        .expect("insert interest");
    }

    async fn status_of(pool: &SqlitePool, id: &str) -> String {
        sqlx::query_scalar("SELECT status FROM research_interests WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .expect("fetch status")
    }

    #[tokio::test]
    async fn mark_running_flips_status_and_rejects_concurrent_run() {
        let pool = setup_pool().await;
        insert_interest(&pool, "a", "active", None).await;

        mark_interest_plan_running(&pool, "a")
            .await
            .expect("first run should start");
        assert_eq!(status_of(&pool, "a").await, "planning");

        let err = mark_interest_plan_running(&pool, "a")
            .await
            .expect_err("second run must be rejected");
        assert_eq!(err, INTEREST_PLAN_BUSY_ERROR);
        assert_eq!(status_of(&pool, "a").await, "planning");
    }

    #[tokio::test]
    async fn mark_running_reports_missing_interest() {
        let pool = setup_pool().await;
        let err = mark_interest_plan_running(&pool, "missing")
            .await
            .expect_err("missing interest must error");
        assert!(err.contains("未找到"));
    }

    #[tokio::test]
    async fn mark_planned_persists_learning_path_and_checks_rows_affected() {
        let pool = setup_pool().await;
        insert_interest(&pool, "a", "planning", None).await;

        mark_interest_plan_planned(&pool, "a", "{\"learning_stages\":[{}]}")
            .await
            .expect("mark planned");
        assert_eq!(status_of(&pool, "a").await, "planned");
        let stored: Option<String> =
            sqlx::query_scalar("SELECT learning_path FROM research_interests WHERE id = 'a'")
                .fetch_one(&pool)
                .await
                .expect("fetch learning_path");
        assert_eq!(stored.as_deref(), Some("{\"learning_stages\":[{}]}"));

        let err = mark_interest_plan_planned(&pool, "missing", "{}")
            .await
            .expect_err("missing interest must error");
        assert!(err.contains("未找到"));
    }

    #[tokio::test]
    async fn restore_status_picks_planned_or_active_by_learning_path() {
        let pool = setup_pool().await;
        insert_interest(&pool, "with-path", "planning", Some("{}")).await;
        insert_interest(&pool, "without-path", "planning", None).await;
        insert_interest(&pool, "blank-path", "planning", Some("  ")).await;

        assert_eq!(
            restore_interest_plan_status(&pool, "with-path").await.unwrap(),
            "planned"
        );
        assert_eq!(
            restore_interest_plan_status(&pool, "without-path").await.unwrap(),
            "active"
        );
        assert_eq!(
            restore_interest_plan_status(&pool, "blank-path").await.unwrap(),
            "active"
        );
    }

    #[tokio::test]
    async fn delete_guard_rejects_planning_interest_only() {
        let pool = setup_pool().await;
        insert_interest(&pool, "busy", "planning", None).await;
        insert_interest(&pool, "idle", "planned", Some("{}")).await;

        let err = ensure_interest_not_planning(&pool, "busy")
            .await
            .expect_err("planning interest must be rejected");
        assert_eq!(err, INTEREST_PLANNING_DELETE_ERROR);

        ensure_interest_not_planning(&pool, "idle")
            .await
            .expect("planned interest can be deleted");
        ensure_interest_not_planning(&pool, "missing")
            .await
            .expect("missing interest is handled by caller");
    }
}
