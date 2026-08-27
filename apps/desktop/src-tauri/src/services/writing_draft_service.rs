//! 写作草稿库：草稿本体落库（后端为唯一数据源），删除草稿时级联清理历史版本。

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

use super::writing_version_service::WritingVersionTexFile;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingDraftImageAsset {
    pub id: String,
    pub file_name: String,
    pub project_path: String,
    pub stored_path: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingDraftInput {
    pub id: String,
    pub project_name: String,
    #[serde(default)]
    pub research_interest_id: Option<String>,
    pub template_id: String,
    #[serde(default)]
    pub main_tex: String,
    #[serde(default)]
    pub bibtex: String,
    #[serde(default)]
    pub tex_files: Vec<WritingVersionTexFile>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub image_assets: Vec<WritingDraftImageAsset>,
    /// 迁移旧草稿时保留原始时间戳；缺省由后端生成。
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingDraftRecord {
    pub id: String,
    pub project_name: String,
    pub research_interest_id: Option<String>,
    pub template_id: String,
    pub main_tex: String,
    pub bibtex: String,
    pub tex_files: Vec<WritingVersionTexFile>,
    pub notes: String,
    pub image_assets: Vec<WritingDraftImageAsset>,
    pub created_at: String,
    pub updated_at: String,
}

/// 与前端 `Date.toISOString()` 一致的时间格式，便于前端直接展示与比较。
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn row_to_record(row: &sqlx::sqlite::SqliteRow) -> WritingDraftRecord {
    let tex_files_raw: String = row.get("tex_files");
    let image_assets_raw: String = row.get("image_assets");
    WritingDraftRecord {
        id: row.get("id"),
        project_name: row.get("project_name"),
        research_interest_id: row.get("research_interest_id"),
        template_id: row.get("template_id"),
        main_tex: row.get("main_tex"),
        bibtex: row.get("bibtex"),
        tex_files: serde_json::from_str(&tex_files_raw).unwrap_or_default(),
        notes: row.get("notes"),
        image_assets: serde_json::from_str(&image_assets_raw).unwrap_or_default(),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

pub async fn create_draft(db: &SqlitePool, input: &WritingDraftInput) -> Result<WritingDraftRecord> {
    if get_draft(db, &input.id).await?.is_some() {
        bail!("草稿已存在：{}", input.id);
    }
    let now = now_iso();
    let created_at = input.created_at.clone().unwrap_or_else(|| now.clone());
    let updated_at = input.updated_at.clone().unwrap_or(now);
    sqlx::query(
        "INSERT INTO writing_drafts (
            id, project_name, research_interest_id, template_id,
            main_tex, bibtex, tex_files, notes, image_assets, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&input.id)
    .bind(&input.project_name)
    .bind(&input.research_interest_id)
    .bind(&input.template_id)
    .bind(&input.main_tex)
    .bind(&input.bibtex)
    .bind(serde_json::to_string(&input.tex_files)?)
    .bind(&input.notes)
    .bind(serde_json::to_string(&input.image_assets)?)
    .bind(&created_at)
    .bind(&updated_at)
    .execute(db)
    .await?;

    get_draft(db, &input.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("草稿写入后读取失败"))
}

pub async fn list_drafts(db: &SqlitePool) -> Result<Vec<WritingDraftRecord>> {
    let rows = sqlx::query(
        "SELECT id, project_name, research_interest_id, template_id,
                main_tex, bibtex, tex_files, notes, image_assets, created_at, updated_at
         FROM writing_drafts
         ORDER BY created_at DESC, rowid DESC",
    )
    .fetch_all(db)
    .await?;
    Ok(rows.iter().map(row_to_record).collect())
}

pub async fn get_draft(db: &SqlitePool, id: &str) -> Result<Option<WritingDraftRecord>> {
    let row = sqlx::query(
        "SELECT id, project_name, research_interest_id, template_id,
                main_tex, bibtex, tex_files, notes, image_assets, created_at, updated_at
         FROM writing_drafts WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(db)
    .await?;
    Ok(row.as_ref().map(row_to_record))
}

/// 全量替换内容字段并刷新 updated_at；created_at 保持不变。
pub async fn update_draft(db: &SqlitePool, input: &WritingDraftInput) -> Result<bool> {
    let result = sqlx::query(
        "UPDATE writing_drafts SET
            project_name = ?, research_interest_id = ?, template_id = ?,
            main_tex = ?, bibtex = ?, tex_files = ?, notes = ?, image_assets = ?,
            updated_at = ?
         WHERE id = ?",
    )
    .bind(&input.project_name)
    .bind(&input.research_interest_id)
    .bind(&input.template_id)
    .bind(&input.main_tex)
    .bind(&input.bibtex)
    .bind(serde_json::to_string(&input.tex_files)?)
    .bind(&input.notes)
    .bind(serde_json::to_string(&input.image_assets)?)
    .bind(now_iso())
    .bind(&input.id)
    .execute(db)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// 删除草稿并清理其历史版本。
/// 除了 writing_versions 上的 ON DELETE CASCADE，这里再显式删除一次，
/// 兼容早期未带外键的 writing_versions 表（SQLite 无法给既有表补外键）。
pub async fn delete_draft(db: &SqlitePool, id: &str) -> Result<bool> {
    sqlx::query("DELETE FROM writing_versions WHERE draft_id = ?")
        .bind(id)
        .execute(db)
        .await?;
    let result = sqlx::query("DELETE FROM writing_drafts WHERE id = ?")
        .bind(id)
        .execute(db)
        .await?;
    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::writing_version_service::{
        record_version, RecordWritingVersionInput,
    };
    use sqlx::sqlite::SqlitePoolOptions;

    async fn memory_pool() -> Result<SqlitePool> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await?;
        // 与生产 init_db 一致开启外键，验证级联删除真实生效。
        sqlx::raw_sql("PRAGMA foreign_keys = ON;")
            .execute(&pool)
            .await?;
        sqlx::raw_sql(crate::db::WRITING_DRAFTS_DDL)
            .execute(&pool)
            .await?;
        sqlx::raw_sql(crate::db::WRITING_VERSIONS_DDL)
            .execute(&pool)
            .await?;
        Ok(pool)
    }

    fn input(id: &str, project_name: &str) -> WritingDraftInput {
        WritingDraftInput {
            id: id.to_string(),
            project_name: project_name.to_string(),
            research_interest_id: None,
            template_id: "journal".to_string(),
            main_tex: "\\section{Intro}".to_string(),
            bibtex: String::new(),
            tex_files: vec![WritingVersionTexFile {
                path: "sections/intro.tex".to_string(),
                content: "intro".to_string(),
            }],
            notes: String::new(),
            image_assets: vec![WritingDraftImageAsset {
                id: "asset-1".to_string(),
                file_name: "fig.png".to_string(),
                project_path: "figures/fig.png".to_string(),
                stored_path: "/managed/figures/fig.png".to_string(),
                created_at: "2026-01-01T00:00:00.000Z".to_string(),
            }],
            created_at: Some("2026-01-01T00:00:00.000Z".to_string()),
            updated_at: Some("2026-01-01T00:00:00.000Z".to_string()),
        }
    }

    fn version_input(draft_id: &str, main_tex: &str) -> RecordWritingVersionInput {
        RecordWritingVersionInput {
            draft_id: draft_id.to_string(),
            main_tex: main_tex.to_string(),
            bibtex: String::new(),
            tex_files: Vec::new(),
            notes: String::new(),
            source: "manual".to_string(),
            force: false,
        }
    }

    #[tokio::test]
    async fn create_get_and_list_roundtrip() -> Result<()> {
        let pool = memory_pool().await?;
        let created = create_draft(&pool, &input("draft-1", "论文 A")).await?;
        assert_eq!(created.project_name, "论文 A");
        assert_eq!(created.research_interest_id, None);
        assert_eq!(created.created_at, "2026-01-01T00:00:00.000Z");
        assert_eq!(created.tex_files.len(), 1);
        assert_eq!(created.image_assets.len(), 1);

        create_draft(&pool, &input("draft-2", "论文 B")).await?;
        let list = list_drafts(&pool).await?;
        assert_eq!(list.len(), 2);
        // created_at 相同（测试数据）时按插入倒序，最新的在前。
        assert_eq!(list[0].id, "draft-2");

        assert!(get_draft(&pool, "missing").await?.is_none());
        Ok(())
    }

    #[tokio::test]
    async fn create_rejects_duplicate_id() -> Result<()> {
        let pool = memory_pool().await?;
        create_draft(&pool, &input("draft-1", "论文 A")).await?;
        assert!(create_draft(&pool, &input("draft-1", "论文 A2")).await.is_err());
        Ok(())
    }

    #[tokio::test]
    async fn update_replaces_content_and_bumps_updated_at() -> Result<()> {
        let pool = memory_pool().await?;
        create_draft(&pool, &input("draft-1", "论文 A")).await?;

        let mut next = input("draft-1", "论文 A 改");
        next.main_tex = "\\section{Conclusion}".to_string();
        next.notes = "新便签".to_string();
        assert!(update_draft(&pool, &next).await?);

        let record = get_draft(&pool, "draft-1").await?.expect("draft exists");
        assert_eq!(record.project_name, "论文 A 改");
        assert_eq!(record.main_tex, "\\section{Conclusion}");
        assert_eq!(record.notes, "新便签");
        // updated_at 由后端刷新，不再等于迁移保留的旧时间戳。
        assert_ne!(record.updated_at, "2026-01-01T00:00:00.000Z");
        assert_eq!(record.created_at, "2026-01-01T00:00:00.000Z");

        assert!(!update_draft(&pool, &input("missing", "无")).await?);
        Ok(())
    }

    #[tokio::test]
    async fn delete_draft_cascades_versions() -> Result<()> {
        let pool = memory_pool().await?;
        create_draft(&pool, &input("draft-1", "论文 A")).await?;
        create_draft(&pool, &input("draft-2", "论文 B")).await?;
        record_version(&pool, &version_input("draft-1", "v1")).await?;
        record_version(&pool, &version_input("draft-2", "v1")).await?;

        assert!(delete_draft(&pool, "draft-1").await?);
        assert!(!delete_draft(&pool, "draft-1").await?);

        assert!(get_draft(&pool, "draft-1").await?.is_none());
        assert!(crate::services::writing_version_service::list_versions(&pool, "draft-1")
            .await?
            .is_empty());
        // 其他草稿与其版本不受影响。
        assert!(get_draft(&pool, "draft-2").await?.is_some());
        assert_eq!(
            crate::services::writing_version_service::list_versions(&pool, "draft-2")
                .await?
                .len(),
            1
        );
        Ok(())
    }
}
