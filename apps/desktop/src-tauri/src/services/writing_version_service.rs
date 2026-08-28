//! 写作草稿历史版本：内容快照落库、hash 去重、auto 节流与保留上限。
//!
//! 草稿的「当前内容」由前端 localStorage 管理，本服务只保存不可变版本快照，
//! 恢复动作由前端拿到快照后自行应用。

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

/// auto 版本的最小记录间隔（秒）：间隔内即使内容变化也不重复入库。
pub const AUTO_VERSION_MIN_INTERVAL_SECS: i64 = 60;
/// 每个草稿最多保留的 auto 版本数；manual 版本不参与修剪。
pub const AUTO_VERSION_MAX_KEEP: i64 = 50;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingVersionTexFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordWritingVersionInput {
    pub draft_id: String,
    pub main_tex: String,
    pub bibtex: String,
    #[serde(default)]
    pub tex_files: Vec<WritingVersionTexFile>,
    pub notes: String,
    pub source: String,
    /// 跳过 auto 节流（恢复前的防丢快照用）；hash 去重仍然生效。
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingVersionRecordResult {
    pub recorded: bool,
    pub version_id: Option<String>,
    /// 跳过原因："unchanged"（与上一版本一致）或 "throttled"（auto 间隔内）。
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingVersionSummary {
    pub id: String,
    pub draft_id: String,
    pub source: String,
    pub created_at: String,
    pub main_tex_chars: i64,
    pub bibtex_chars: i64,
    pub tex_files_chars: i64,
    pub notes_chars: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingVersionSnapshot {
    pub id: String,
    pub draft_id: String,
    pub source: String,
    pub created_at: String,
    pub main_tex: String,
    pub bibtex: String,
    pub tex_files: Vec<WritingVersionTexFile>,
    pub notes: String,
}

pub fn normalize_source(source: &str) -> Result<&'static str> {
    match source {
        "auto" => Ok("auto"),
        "manual" => Ok("manual"),
        _ => bail!("版本来源无效，仅支持 auto / manual"),
    }
}

pub fn content_hash(
    main_tex: &str,
    bibtex: &str,
    tex_files: &[WritingVersionTexFile],
    notes: &str,
) -> String {
    let tex_files_json = serde_json::to_string(tex_files).unwrap_or_default();
    let mut hasher = Sha256::new();
    for part in [main_tex, bibtex, tex_files_json.as_str(), notes] {
        hasher.update(part.as_bytes());
        hasher.update([0x1f]);
    }
    format!("{:x}", hasher.finalize())
}

pub async fn record_version(
    db: &SqlitePool,
    input: &RecordWritingVersionInput,
) -> Result<WritingVersionRecordResult> {
    let source = normalize_source(&input.source)?;
    let hash = content_hash(&input.main_tex, &input.bibtex, &input.tex_files, &input.notes);

    // hash 去重：与该草稿最新版本（不分来源）一致则跳过。
    let latest = sqlx::query(
        "SELECT content_hash FROM writing_versions
         WHERE draft_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .bind(&input.draft_id)
    .fetch_optional(db)
    .await?;
    if let Some(row) = latest {
        let latest_hash: String = row.get("content_hash");
        if latest_hash == hash {
            return Ok(skipped("unchanged"));
        }
    }

    // auto 节流：距上一条 auto 版本不足最小间隔时跳过（force 跳过此限制）。
    if source == "auto" && !input.force {
        let latest_auto = sqlx::query(
            "SELECT strftime('%s', created_at) AS created_epoch FROM writing_versions
             WHERE draft_id = ? AND source = 'auto' ORDER BY created_at DESC, rowid DESC LIMIT 1",
        )
        .bind(&input.draft_id)
        .fetch_optional(db)
        .await?;
        if let Some(row) = latest_auto {
            let created_epoch: i64 = row
                .get::<String, _>("created_epoch")
                .parse()
                .unwrap_or_default();
            if chrono::Utc::now().timestamp() - created_epoch < AUTO_VERSION_MIN_INTERVAL_SECS {
                return Ok(skipped("throttled"));
            }
        }
    }

    let version_id = Uuid::new_v4().to_string();
    let tex_files_json = serde_json::to_string(&input.tex_files)?;
    sqlx::query(
        "INSERT INTO writing_versions (
            id, draft_id, main_tex, bibtex, tex_files, notes, content_hash, source, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    )
    .bind(&version_id)
    .bind(&input.draft_id)
    .bind(&input.main_tex)
    .bind(&input.bibtex)
    .bind(tex_files_json)
    .bind(&input.notes)
    .bind(&hash)
    .bind(source)
    .execute(db)
    .await?;

    prune_auto_versions(db, &input.draft_id).await?;

    Ok(WritingVersionRecordResult {
        recorded: true,
        version_id: Some(version_id),
        reason: None,
    })
}

/// 修剪 auto 版本，仅保留最新的 AUTO_VERSION_MAX_KEEP 条；manual 版本不动。
async fn prune_auto_versions(db: &SqlitePool, draft_id: &str) -> Result<()> {
    sqlx::query(
        "DELETE FROM writing_versions
         WHERE draft_id = ? AND source = 'auto' AND id NOT IN (
            SELECT id FROM writing_versions
            WHERE draft_id = ? AND source = 'auto'
            ORDER BY created_at DESC, rowid DESC LIMIT ?
         )",
    )
    .bind(draft_id)
    .bind(draft_id)
    .bind(AUTO_VERSION_MAX_KEEP)
    .execute(db)
    .await?;
    Ok(())
}

/// 版本列表（不含正文，只给元信息与各字段字符数）。
pub async fn list_versions(db: &SqlitePool, draft_id: &str) -> Result<Vec<WritingVersionSummary>> {
    let rows = sqlx::query(
        "SELECT id, draft_id, source, created_at,
                length(main_tex) AS main_tex_chars,
                length(bibtex) AS bibtex_chars,
                length(tex_files) AS tex_files_chars,
                length(notes) AS notes_chars
         FROM writing_versions
         WHERE draft_id = ?
         ORDER BY created_at DESC, rowid DESC",
    )
    .bind(draft_id)
    .fetch_all(db)
    .await?;

    Ok(rows
        .iter()
        .map(|row| WritingVersionSummary {
            id: row.get("id"),
            draft_id: row.get("draft_id"),
            source: row.get("source"),
            created_at: row.get("created_at"),
            main_tex_chars: row.get("main_tex_chars"),
            bibtex_chars: row.get("bibtex_chars"),
            tex_files_chars: row.get("tex_files_chars"),
            notes_chars: row.get("notes_chars"),
        })
        .collect())
}

pub async fn get_version(
    db: &SqlitePool,
    version_id: &str,
) -> Result<Option<WritingVersionSnapshot>> {
    let row = sqlx::query(
        "SELECT id, draft_id, main_tex, bibtex, tex_files, notes, source, created_at
         FROM writing_versions WHERE id = ?",
    )
    .bind(version_id)
    .fetch_optional(db)
    .await?;

    Ok(row.map(|row| {
        let tex_files_raw: String = row.get("tex_files");
        WritingVersionSnapshot {
            id: row.get("id"),
            draft_id: row.get("draft_id"),
            source: row.get("source"),
            created_at: row.get("created_at"),
            main_tex: row.get("main_tex"),
            bibtex: row.get("bibtex"),
            tex_files: serde_json::from_str(&tex_files_raw).unwrap_or_default(),
            notes: row.get("notes"),
        }
    }))
}

pub async fn delete_version(db: &SqlitePool, version_id: &str) -> Result<bool> {
    let result = sqlx::query("DELETE FROM writing_versions WHERE id = ?")
        .bind(version_id)
        .execute(db)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// 删除草稿时联动清空其全部版本，返回删除条数。
pub async fn clear_versions(db: &SqlitePool, draft_id: &str) -> Result<u64> {
    let result = sqlx::query("DELETE FROM writing_versions WHERE draft_id = ?")
        .bind(draft_id)
        .execute(db)
        .await?;
    Ok(result.rows_affected())
}

fn skipped(reason: &str) -> WritingVersionRecordResult {
    WritingVersionRecordResult {
        recorded: false,
        version_id: None,
        reason: Some(reason.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn memory_pool() -> Result<SqlitePool> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await?;
        sqlx::raw_sql(crate::db::WRITING_DRAFTS_DDL)
            .execute(&pool)
            .await?;
        sqlx::raw_sql(crate::db::WRITING_VERSIONS_DDL)
            .execute(&pool)
            .await?;
        // 版本表对 writing_drafts 有外键，测试前先插入父行。
        sqlx::query("INSERT INTO writing_drafts (id, project_name, template_id) VALUES ('draft-1', 'A', 'journal'), ('draft-2', 'B', 'journal')")
            .execute(&pool)
            .await?;
        Ok(pool)
    }

    fn input(draft_id: &str, main_tex: &str, source: &str) -> RecordWritingVersionInput {
        RecordWritingVersionInput {
            draft_id: draft_id.to_string(),
            main_tex: main_tex.to_string(),
            bibtex: String::new(),
            tex_files: vec![WritingVersionTexFile {
                path: "sections/intro.tex".to_string(),
                content: "\\section{Intro}".to_string(),
            }],
            notes: String::new(),
            source: source.to_string(),
            force: false,
        }
    }

    async fn insert_raw_version(
        pool: &SqlitePool,
        id: &str,
        draft_id: &str,
        hash: &str,
        source: &str,
        created_at_sql: &str,
    ) -> Result<()> {
        // created_at 由调用方给出 SQL 表达式，便于构造「很久以前」的版本测试节流与修剪。
        let sql = format!(
            "INSERT INTO writing_versions (
                id, draft_id, main_tex, bibtex, tex_files, notes, content_hash, source, created_at
             ) VALUES (?, ?, 'tex', '', '[]', '', ?, ?, {created_at_sql})"
        );
        sqlx::query(&sql)
            .bind(id)
            .bind(draft_id)
            .bind(hash)
            .bind(source)
            .execute(pool)
            .await?;
        Ok(())
    }

    async fn count_versions(pool: &SqlitePool, draft_id: &str, source: &str) -> Result<i64> {
        let row = sqlx::query("SELECT COUNT(*) AS n FROM writing_versions WHERE draft_id = ? AND source = ?")
            .bind(draft_id)
            .bind(source)
            .fetch_one(pool)
            .await?;
        Ok(row.get("n"))
    }

    #[tokio::test]
    async fn record_skips_identical_content_by_hash() -> Result<()> {
        let pool = memory_pool().await?;
        let first = record_version(&pool, &input("draft-1", "v1", "manual")).await?;
        assert!(first.recorded);

        let second = record_version(&pool, &input("draft-1", "v1", "manual")).await?;
        assert!(!second.recorded);
        assert_eq!(second.reason.as_deref(), Some("unchanged"));
        assert_eq!(count_versions(&pool, "draft-1", "manual").await?, 1);
        Ok(())
    }

    #[tokio::test]
    async fn auto_record_is_throttled_within_min_interval() -> Result<()> {
        let pool = memory_pool().await?;
        let first = record_version(&pool, &input("draft-1", "v1", "auto")).await?;
        assert!(first.recorded);

        // 60 秒内的内容变化被节流。
        let throttled = record_version(&pool, &input("draft-1", "v2", "auto")).await?;
        assert!(!throttled.recorded);
        assert_eq!(throttled.reason.as_deref(), Some("throttled"));

        // force（恢复前快照）不受节流限制。
        let mut forced = input("draft-1", "v2", "auto");
        forced.force = true;
        let forced_result = record_version(&pool, &forced).await?;
        assert!(forced_result.recorded);

        // 上一条 auto 已超过最小间隔时正常记录。
        sqlx::query("UPDATE writing_versions SET created_at = datetime('now', '-120 seconds') WHERE draft_id = 'draft-1'")
            .execute(&pool)
            .await?;
        let after_interval = record_version(&pool, &input("draft-1", "v3", "auto")).await?;
        assert!(after_interval.recorded);
        Ok(())
    }

    #[tokio::test]
    async fn auto_versions_are_pruned_to_max_keep_and_manual_kept() -> Result<()> {
        let pool = memory_pool().await?;
        // 预置 52 条 auto + 3 条 manual（created_at 递增，最旧的最先修剪）。
        for index in 0..52 {
            insert_raw_version(
                &pool,
                &format!("auto-{index:03}"),
                "draft-1",
                &format!("hash-{index}"),
                "auto",
                &format!("datetime('now', '-{minutes} minutes')", minutes = 4000 - index),
            )
            .await?;
        }
        for index in 0..3 {
            insert_raw_version(
                &pool,
                &format!("manual-{index}"),
                "draft-1",
                &format!("manual-hash-{index}"),
                "manual",
                "datetime('now')",
            )
            .await?;
        }

        let mut next = input("draft-1", "brand-new-content", "auto");
        next.force = true;
        let result = record_version(&pool, &next).await?;
        assert!(result.recorded);

        assert_eq!(count_versions(&pool, "draft-1", "auto").await?, AUTO_VERSION_MAX_KEEP);
        assert_eq!(count_versions(&pool, "draft-1", "manual").await?, 3);
        // 53 条 auto 修剪到 50 条，最旧的 3 条被删除。
        assert!(get_version(&pool, "auto-000").await?.is_none());
        assert!(get_version(&pool, "auto-002").await?.is_none());
        assert!(get_version(&pool, "auto-003").await?.is_some());
        Ok(())
    }

    #[tokio::test]
    async fn list_returns_metadata_without_content() -> Result<()> {
        let pool = memory_pool().await?;
        record_version(&pool, &input("draft-1", "abcdef", "manual")).await?;
        record_version(&pool, &input("draft-2", "xyz", "manual")).await?;

        let versions = list_versions(&pool, "draft-1").await?;
        assert_eq!(versions.len(), 1);
        let summary = &versions[0];
        assert_eq!(summary.source, "manual");
        assert_eq!(summary.main_tex_chars, 6);
        assert!(summary.notes_chars == 0);
        Ok(())
    }

    #[tokio::test]
    async fn get_version_returns_full_snapshot_for_restore() -> Result<()> {
        let pool = memory_pool().await?;
        let result = record_version(&pool, &input("draft-1", "full tex body", "manual")).await?;
        let version_id = result.version_id.expect("recorded");

        let snapshot = get_version(&pool, &version_id)
            .await?
            .expect("snapshot exists");
        assert_eq!(snapshot.main_tex, "full tex body");
        assert_eq!(snapshot.tex_files.len(), 1);
        assert_eq!(snapshot.tex_files[0].path, "sections/intro.tex");
        assert!(get_version(&pool, "missing").await?.is_none());
        Ok(())
    }

    #[tokio::test]
    async fn delete_and_clear_versions() -> Result<()> {
        let pool = memory_pool().await?;
        let first = record_version(&pool, &input("draft-1", "v1", "manual")).await?;
        record_version(&pool, &input("draft-1", "v2", "manual")).await?;
        record_version(&pool, &input("draft-2", "v1", "manual")).await?;

        assert!(delete_version(&pool, &first.version_id.expect("id")).await?);
        assert!(!delete_version(&pool, "missing").await?);
        assert_eq!(list_versions(&pool, "draft-1").await?.len(), 1);

        // 删除草稿时联动清空，只影响目标草稿。
        let cleared = clear_versions(&pool, "draft-1").await?;
        assert_eq!(cleared, 1);
        assert!(list_versions(&pool, "draft-1").await?.is_empty());
        assert_eq!(list_versions(&pool, "draft-2").await?.len(), 1);
        Ok(())
    }
}
