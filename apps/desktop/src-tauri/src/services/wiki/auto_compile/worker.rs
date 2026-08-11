use crate::{services::wiki::compiler::compile_interest, state::AppState};
use anyhow::Result;
use sqlx::{Row, SqlitePool};
use std::time::Duration;

const STARTUP_RECONCILE_DELAY_SECS: i64 = 30;
const IDLE_POLL_INTERVAL: Duration = Duration::from_secs(2);
const BUSY_POLL_INTERVAL: Duration = Duration::from_millis(150);

#[derive(Debug)]
struct PendingCompile {
    interest_id: String,
    attempt_count: i64,
}

/// 启动小妍内部知识编译器。编译串行执行，避免后台同时发起多组 LLM 请求。
pub fn start_auto_compile_worker(state: AppState) {
    tokio::spawn(async move {
        if let Err(error) = enqueue_existing_interests(&state.db).await {
            eprintln!("[wiki-auto] startup reconcile enqueue failed: {error}");
        }

        loop {
            let processed = match take_due_compile(&state.db).await {
                Ok(Some(pending)) => {
                    process_pending_compile(&state, pending).await;
                    true
                }
                Ok(None) => false,
                Err(error) => {
                    eprintln!("[wiki-auto] queue poll failed: {error}");
                    false
                }
            };
            tokio::time::sleep(if processed {
                BUSY_POLL_INTERVAL
            } else {
                IDLE_POLL_INTERVAL
            })
            .await;
        }
    });
}

pub(super) async fn enqueue_existing_interests(db: &SqlitePool) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        "INSERT INTO wiki_compile_queue
         (research_interest_id, requested_at, not_before, reason, attempt_count, last_error)
         SELECT ri.id, ?, ?, 'startup_reconcile', 0, NULL
         FROM research_interests ri
         WHERE EXISTS (
            SELECT 1 FROM papers p
            WHERE p.research_interest_id = ri.id
              AND trim(COALESCE(NULLIF(p.full_text, ''), NULLIF(p.abstract, ''), '')) != ''
         ) OR EXISTS (
            SELECT 1 FROM knowledge_notes n
            WHERE n.research_interest_id = ri.id AND trim(n.content) != ''
         ) OR EXISTS (
            SELECT 1 FROM wiki_compile_sources compiled
            WHERE compiled.research_interest_id = ri.id
         ) OR EXISTS (
            SELECT 1 FROM wiki_pages page
            WHERE page.research_interest_id = ri.id AND page.status != 'archived'
         )
         ON CONFLICT(research_interest_id) DO NOTHING",
    )
    .bind(now)
    .bind(now + STARTUP_RECONCILE_DELAY_SECS)
    .execute(db)
    .await?;
    Ok(())
}

async fn take_due_compile(db: &SqlitePool) -> Result<Option<PendingCompile>> {
    let mut tx = db.begin().await?;
    let row = sqlx::query(
        "SELECT research_interest_id, attempt_count
         FROM wiki_compile_queue
         WHERE not_before <= ?
         ORDER BY not_before, requested_at
         LIMIT 1",
    )
    .bind(chrono::Utc::now().timestamp())
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        tx.commit().await?;
        return Ok(None);
    };
    let pending = PendingCompile {
        interest_id: row.get("research_interest_id"),
        attempt_count: row.get("attempt_count"),
    };
    sqlx::query("DELETE FROM wiki_compile_queue WHERE research_interest_id = ?")
        .bind(&pending.interest_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Some(pending))
}

async fn process_pending_compile(state: &AppState, pending: PendingCompile) {
    let settings = state.settings.read().await.clone();
    match compile_interest(&state.db, &settings, &pending.interest_id, false).await {
        Ok(summary) => {
            eprintln!(
                "[wiki-auto] interest={} status={} changed={} removed={} created={} updated={}",
                pending.interest_id,
                summary.status,
                summary.changed_source_count,
                summary.removed_source_count,
                summary.pages_created,
                summary.pages_updated
            );
            if summary.remaining_source_count > 0 {
                if let Err(error) = enqueue_continuation(&state.db, &pending.interest_id).await {
                    eprintln!("[wiki-auto] continuation enqueue failed: {error}");
                }
            }
        }
        Err(error) => {
            let next_attempt = pending.attempt_count.saturating_add(1);
            eprintln!(
                "[wiki-auto] interest={} attempt={} failed: {}",
                pending.interest_id, next_attempt, error
            );
            let queue_result = if is_database_locked(&error) {
                // 数据库锁冲突通常是瞬时的，用短延迟快速重试，避免 attempt 指数退避。
                enqueue_short_retry(
                    &state.db,
                    &pending.interest_id,
                    pending.attempt_count,
                    &error.to_string(),
                )
                .await
            } else {
                enqueue_retry(
                    &state.db,
                    &pending.interest_id,
                    next_attempt,
                    &error.to_string(),
                )
                .await
            };
            if let Err(queue_error) = queue_result {
                eprintln!("[wiki-auto] retry enqueue failed: {queue_error}");
            }
        }
    }
}

async fn enqueue_continuation(db: &SqlitePool, interest_id: &str) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        "INSERT INTO wiki_compile_queue
         (research_interest_id, requested_at, not_before, reason, attempt_count, last_error)
         VALUES (?, ?, ?, 'continue_partial', 0, NULL)
         ON CONFLICT(research_interest_id) DO UPDATE SET
            not_before = MIN(wiki_compile_queue.not_before, excluded.not_before)",
    )
    .bind(interest_id)
    .bind(now)
    .bind(now + 1)
    .execute(db)
    .await?;
    Ok(())
}

async fn enqueue_retry(
    db: &SqlitePool,
    interest_id: &str,
    attempt_count: i64,
    error: &str,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        "INSERT INTO wiki_compile_queue
         (research_interest_id, requested_at, not_before, reason, attempt_count, last_error)
         VALUES (?, ?, ?, 'retry_after_error', ?, ?)
         ON CONFLICT(research_interest_id) DO NOTHING",
    )
    .bind(interest_id)
    .bind(now)
    .bind(now + retry_delay_secs(attempt_count))
    .bind(attempt_count)
    .bind(error)
    .execute(db)
    .await?;
    Ok(())
}

async fn enqueue_short_retry(
    db: &SqlitePool,
    interest_id: &str,
    attempt_count: i64,
    error: &str,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        "INSERT INTO wiki_compile_queue
         (research_interest_id, requested_at, not_before, reason, attempt_count, last_error)
         VALUES (?, ?, ?, 'locked_short_retry', ?, ?)
         ON CONFLICT(research_interest_id) DO NOTHING",
    )
    .bind(interest_id)
    .bind(now)
    .bind(now + 2)
    .bind(attempt_count)
    .bind(error)
    .execute(db)
    .await?;
    Ok(())
}

fn is_database_locked(error: &anyhow::Error) -> bool {
    let text = error.to_string().to_lowercase();
    text.contains("database is locked") || text.contains("busy") || text.contains("database locked")
}

pub(super) fn retry_delay_secs(attempt_count: i64) -> i64 {
    let exponent = attempt_count.saturating_sub(1).clamp(0, 10) as u32;
    (30_i64.saturating_mul(2_i64.pow(exponent))).min(6 * 60 * 60)
}
