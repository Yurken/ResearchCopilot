use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct ReviewerDiagnosisInput {
    pub reviewer: String,
    pub focus: String,
    pub raw: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DiagnosisRiskLevel {
    Low,
    Medium,
    High,
}

impl DiagnosisRiskLevel {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn compact_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
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

fn preview_text(value: &str, max_bytes: usize) -> String {
    let compact = compact_text(value);
    if compact.len() > max_bytes {
        format!("{}...", safe_truncate(&compact, max_bytes))
    } else {
        compact
    }
}

fn extract_json_object(raw: &str) -> Option<Value> {
    serde_json::from_str::<Value>(raw).ok().or_else(|| {
        let start = raw.find('{')?;
        let end = raw.rfind('}')?;
        serde_json::from_str::<Value>(&raw[start..=end]).ok()
    })
}

fn classify_risk(reviews: &[Value]) -> DiagnosisRiskLevel {
    let mut scores = Vec::new();
    let mut has_reject = false;

    for review in reviews {
        if let Some(score) = review.get("score").and_then(|value| value.as_i64()) {
            scores.push(score);
        }
        let verdict = review
            .get("verdict")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(verdict.as_str(), "reject" | "weak_reject") {
            has_reject = true;
        }
    }

    if has_reject {
        return DiagnosisRiskLevel::High;
    }
    if scores.is_empty() {
        return DiagnosisRiskLevel::Medium;
    }

    let average = scores.iter().sum::<i64>() as f32 / scores.len() as f32;
    if average <= 4.5 {
        DiagnosisRiskLevel::High
    } else if average <= 6.5 {
        DiagnosisRiskLevel::Medium
    } else {
        DiagnosisRiskLevel::Low
    }
}

fn collect_json_list(reviews: &[Value], field: &str, limit: usize) -> Vec<String> {
    reviews
        .iter()
        .filter_map(|review| review.get(field).and_then(|value| value.as_array()))
        .flat_map(|items| items.iter())
        .filter_map(|item| item.as_str())
        .map(|item| preview_text(item, 160))
        .take(limit)
        .collect()
}

fn build_summary(risk: &DiagnosisRiskLevel, reviews: &[Value]) -> String {
    let weaknesses = collect_json_list(reviews, "weaknesses", 3);
    let questions = collect_json_list(reviews, "questions", 2);
    let risk_label = match risk {
        DiagnosisRiskLevel::Low => "低风险",
        DiagnosisRiskLevel::Medium => "中等风险",
        DiagnosisRiskLevel::High => "高风险",
    };

    let mut parts = vec![format!("投稿前诊断：{risk_label}")];
    if !weaknesses.is_empty() {
        parts.push(format!("主要薄弱点：{}", weaknesses.join("；")));
    }
    if !questions.is_empty() {
        parts.push(format!("待回应问题：{}", questions.join("；")));
    }
    parts.join("\n")
}

fn collect_evidence_locations(reviews: &[Value]) -> Vec<String> {
    collect_json_list(reviews, "evidence_locations", 8)
}

pub(crate) fn collect_issue_labels(report_json: &Value) -> Vec<String> {
    let Some(reviews) = report_json
        .get("parsed_reviews")
        .and_then(|value| value.as_array())
    else {
        return Vec::new();
    };

    let mut seen = HashSet::new();
    let mut labels = Vec::new();

    for review in reviews {
        for weakness in collect_text_values(review, "weaknesses") {
            let label = format!("补强诊断问题：{}", preview_text(&weakness, 120));
            if seen.insert(label.clone()) {
                labels.push(label);
            }
        }
        for question in collect_text_values(review, "questions") {
            let label = format!("回应诊断问题：{}", preview_text(&question, 120));
            if seen.insert(label.clone()) {
                labels.push(label);
            }
        }
        for suggestion in collect_text_values(review, "suggestions") {
            let label = format!("采纳诊断建议：{}", preview_text(&suggestion, 120));
            if seen.insert(label.clone()) {
                labels.push(label);
            }
        }
        if labels.len() >= 12 {
            break;
        }
    }

    labels.truncate(12);
    labels
}

fn collect_text_values(value: &Value, field: &str) -> Vec<String> {
    value
        .get(field)
        .and_then(|items| items.as_array())
        .into_iter()
        .flatten()
        .filter_map(|item| item.as_str())
        .map(compact_text)
        .filter(|item| !item.is_empty())
        .collect()
}

pub async fn save_ai_review_diagnosis_report(
    db: &SqlitePool,
    submission_id: &str,
    content_preview: &str,
    reviewer_inputs: &[ReviewerDiagnosisInput],
) -> Result<String> {
    let parsed_reviews = reviewer_inputs
        .iter()
        .filter_map(|item| extract_json_object(&item.raw))
        .collect::<Vec<_>>();
    let risk = classify_risk(&parsed_reviews);
    let summary = build_summary(&risk, &parsed_reviews);
    let now = now_rfc3339();
    let report_id = Uuid::new_v4().to_string();
    let report_json = json!({
        "content_preview": preview_text(content_preview, 1200),
        "reviewers": reviewer_inputs.iter().map(|item| json!({
            "reviewer": item.reviewer,
            "focus": item.focus,
            "raw": item.raw,
        })).collect::<Vec<_>>(),
        "parsed_reviews": parsed_reviews,
        "evidence_locations": collect_evidence_locations(&parsed_reviews),
    });

    sqlx::query(
        "INSERT INTO submission_diagnosis_reports (
            id, submission_id, source, status, risk_level, summary, report_json, created_at, updated_at
        ) VALUES (?, ?, 'ai_review', 'done', ?, ?, ?, ?, ?)",
    )
    .bind(&report_id)
    .bind(submission_id)
    .bind(risk.as_str())
    .bind(&summary)
    .bind(serde_json::to_string(&report_json)?)
    .bind(&now)
    .bind(&now)
    .execute(db)
    .await?;

    Ok(report_id)
}

pub async fn list_submission_diagnosis_reports(
    db: &SqlitePool,
    submission_id: &str,
) -> Result<Value> {
    let rows = sqlx::query(
        "SELECT id, submission_id, source, status, risk_level, summary, report_json, created_at, updated_at
         FROM submission_diagnosis_reports
         WHERE submission_id = ?
         ORDER BY created_at DESC",
    )
    .bind(submission_id)
    .fetch_all(db)
    .await?;

    let reports = rows
        .iter()
        .map(|row| {
            let report_json_raw = row.get::<String, _>("report_json");
            let report_json =
                serde_json::from_str::<Value>(&report_json_raw).unwrap_or_else(|_| json!({}));

            json!({
                "id": row.get::<String, _>("id"),
                "submissionId": row.get::<String, _>("submission_id"),
                "source": row.get::<String, _>("source"),
                "status": row.get::<String, _>("status"),
                "riskLevel": row.get::<String, _>("risk_level"),
                "summary": row.get::<String, _>("summary"),
                "report": report_json,
                "createdAt": row.get::<String, _>("created_at"),
                "updatedAt": row.get::<String, _>("updated_at"),
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({ "reports": reports }))
}

pub async fn import_diagnosis_report_to_checklist(
    db: &SqlitePool,
    report_id: &str,
) -> Result<usize> {
    let row = sqlx::query(
        "SELECT submission_id, report_json
         FROM submission_diagnosis_reports
         WHERE id = ?",
    )
    .bind(report_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| anyhow!("Diagnosis report not found"))?;

    let submission_id = row.get::<String, _>("submission_id");
    let report_json_raw = row.get::<String, _>("report_json");
    let report_json = serde_json::from_str::<Value>(&report_json_raw).unwrap_or_else(|_| json!({}));
    let labels = collect_issue_labels(&report_json);
    if labels.is_empty() {
        return Ok(0);
    }

    let existing_rows =
        sqlx::query("SELECT label FROM submission_checklist WHERE submission_id = ?")
            .bind(&submission_id)
            .fetch_all(db)
            .await?;
    let mut existing_labels = existing_rows
        .iter()
        .map(|row| row.get::<String, _>("label"))
        .collect::<HashSet<_>>();

    let sort_row = sqlx::query(
        "SELECT COALESCE(MAX(sort_order), -1) AS max_sort
         FROM submission_checklist WHERE submission_id = ?",
    )
    .bind(&submission_id)
    .fetch_one(db)
    .await?;
    let mut next_sort = sort_row.get::<i64, _>("max_sort") + 1;
    let mut created = 0usize;

    for label in labels {
        if !existing_labels.insert(label.clone()) {
            continue;
        }

        sqlx::query(
            "INSERT INTO submission_checklist
             (id, submission_id, label, checked, category, sort_order)
             VALUES (?, ?, ?, 0, '诊断', ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&submission_id)
        .bind(&label)
        .bind(next_sort)
        .execute(db)
        .await?;

        created += 1;
        next_sort += 1;
    }

    Ok(created)
}

#[cfg(test)]
mod tests {
    use super::{
        classify_risk, collect_evidence_locations, collect_issue_labels, collect_json_list,
        import_diagnosis_report_to_checklist, list_submission_diagnosis_reports,
        save_ai_review_diagnosis_report, DiagnosisRiskLevel, ReviewerDiagnosisInput,
    };
    use anyhow::Result;
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    #[test]
    fn weak_reject_classifies_high_risk() {
        let reviews = vec![json!({ "verdict": "weak_reject", "score": 6 })];
        assert_eq!(classify_risk(&reviews), DiagnosisRiskLevel::High);
    }

    #[test]
    fn collects_weaknesses_from_reviews() {
        let reviews = vec![json!({ "weaknesses": ["实验不足", "相关工作偏少"] })];
        assert_eq!(
            collect_json_list(&reviews, "weaknesses", 1),
            vec!["实验不足"]
        );
    }

    #[test]
    fn issue_labels_dedupe_and_prefix_review_fields() {
        let report = json!({
            "parsed_reviews": [
                { "weaknesses": ["实验不足", "实验不足"], "questions": ["泛化性如何？"] },
                { "suggestions": ["补一个消融实验"] }
            ]
        });

        assert_eq!(
            collect_issue_labels(&report),
            vec![
                "补强诊断问题：实验不足",
                "回应诊断问题：泛化性如何？",
                "采纳诊断建议：补一个消融实验",
            ]
        );
    }

    #[test]
    fn keeps_review_evidence_locations_separate_from_issue_labels() {
        let reviews = vec![json!({
            "evidence_locations": ["Sec. 4.2 消融实验", "仅摘要，无法定位全文位置"],
            "weaknesses": ["缺少跨域验证"]
        })];

        assert_eq!(
            collect_evidence_locations(&reviews),
            vec!["Sec. 4.2 消融实验", "仅摘要，无法定位全文位置"]
        );
    }

    #[tokio::test]
    async fn diagnosis_round_trip_matches_database_schema() -> Result<()> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await?;
        sqlx::raw_sql(
            "CREATE TABLE submissions (id TEXT PRIMARY KEY);
             CREATE TABLE submission_checklist (
                id TEXT PRIMARY KEY,
                submission_id TEXT NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                checked INTEGER NOT NULL DEFAULT 0,
                category TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0
             );",
        )
        .execute(&pool)
        .await?;
        sqlx::raw_sql(crate::db::SUBMISSION_DIAGNOSIS_DDL)
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO submissions (id) VALUES ('submission-1')")
            .execute(&pool)
            .await?;

        let report_id = save_ai_review_diagnosis_report(
            &pool,
            "submission-1",
            "paper preview",
            &[ReviewerDiagnosisInput {
                reviewer: "reviewer-1".into(),
                focus: "方法与创新性".into(),
                raw: json!({
                    "verdict": "weak_reject",
                    "score": 4,
                    "weaknesses": ["实验不足"],
                    "suggestions": ["补充消融实验"]
                })
                .to_string(),
            }],
        )
        .await?;

        let response = list_submission_diagnosis_reports(&pool, "submission-1").await?;
        let reports = response["reports"].as_array().expect("reports array");
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0]["id"], report_id);
        assert_eq!(reports[0]["riskLevel"], "high");
        assert_eq!(reports[0]["source"], "ai_review");

        let created = import_diagnosis_report_to_checklist(&pool, &report_id).await?;
        assert_eq!(created, 2);

        Ok(())
    }
}
