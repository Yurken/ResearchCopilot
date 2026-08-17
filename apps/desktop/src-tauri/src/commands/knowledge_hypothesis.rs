use crate::services::memory_checkpoint_service::{
    record_research_asset_checkpoint, research_interest_asset_snapshot,
    ResearchAssetCheckpointInput,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearchHypothesisCardPayload {
    pub id: String,
    pub version: usize,
    pub parent_version: Option<usize>,
    pub decision: String,
    pub decision_note: Option<String>,
    pub title: String,
    pub hypothesis: String,
    pub rationale: String,
    pub evidence: Vec<String>,
    pub counter_evidence: Vec<String>,
    pub falsification: String,
    pub validation_steps: Vec<String>,
    pub uncertainties: Vec<String>,
    pub keywords: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub origin: Option<ResearchHypothesisOriginPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearchHypothesisOriginPayload {
    pub hypothesis: String,
    pub falsification: String,
    pub validation_steps: Vec<String>,
    pub captured_at: String,
}

pub fn validate_card(card: &ResearchHypothesisCardPayload) -> Result<(), String> {
    if card.hypothesis.trim().is_empty()
        || card.falsification.trim().is_empty()
        || card.validation_steps.is_empty()
    {
        return Err("候选假设缺少假设正文、证伪条件或验证步骤".to_string());
    }
    Ok(())
}

pub fn stored_card(card: &ResearchHypothesisCardPayload) -> ResearchHypothesisCardPayload {
    let mut stored = card.clone();
    if stored.decision != "draft" {
        stored.version = 2;
        stored.parent_version = Some(1);
    }
    stored
}

pub async fn persist_versions_and_checkpoint(
    db: &SqlitePool,
    interest_id: &str,
    topic: &str,
    keywords: &[String],
    profile: Option<&Value>,
    card: &ResearchHypothesisCardPayload,
    now: &str,
) -> Result<(), String> {
    let mut original = card.clone();
    original.version = 1;
    original.parent_version = None;
    original.decision = "draft".to_string();
    original.decision_note = None;
    if let Some(origin) = card.origin.as_ref() {
        original.hypothesis = origin.hypothesis.clone();
        original.falsification = origin.falsification.clone();
        original.validation_steps = origin.validation_steps.clone();
        original.created_at = origin.captured_at.clone();
        original.updated_at = origin.captured_at.clone();
    }
    insert_version(db, interest_id, &original, now).await?;
    let stored = stored_card(card);
    if stored.version > 1 {
        insert_version(db, interest_id, &stored, now).await?;
    }

    let card_value = serde_json::to_value(&stored).unwrap_or_else(|_| json!({}));
    let _ = record_research_asset_checkpoint(
        db,
        ResearchAssetCheckpointInput {
            context_type: "interest",
            context_id: interest_id,
            action: "hypothesis.plan_created",
            goal: &stored.hypothesis,
            summary: "候选假设已进入研究规划，证据边界、证伪条件和验证步骤已保留。",
            completed_items: vec![format!(
                "保存候选假设 v{}（{}）",
                stored.version, stored.decision
            )],
            open_questions: stored.uncertainties.clone(),
            next_steps: stored.validation_steps.clone(),
            asset_snapshot: research_interest_asset_snapshot(
                topic,
                keywords,
                profile,
                Some(&card_value),
                None,
            ),
        },
    )
    .await;
    Ok(())
}

async fn insert_version(
    db: &SqlitePool,
    interest_id: &str,
    card: &ResearchHypothesisCardPayload,
    now: &str,
) -> Result<(), String> {
    let card_json = serde_json::to_string(card).unwrap_or_else(|_| "{}".to_string());
    sqlx::query(
        "INSERT INTO research_hypothesis_versions
            (id, hypothesis_id, research_interest_id, version, decision, card_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&card.id)
    .bind(interest_id)
    .bind(card.version as i64)
    .bind(&card.decision)
    .bind(card_json)
    .bind(now)
    .execute(db)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn prompt_context(card: Option<&ResearchHypothesisCardPayload>) -> String {
    let Some(card) = card else {
        return String::new();
    };
    format!(
        "\n候选假设资产（版本 v{}，状态 {}）：\n- 假设：{}\n- 材料支持：{}\n- 反证与冲突：{}\n- 证伪条件：{}\n- 验证步骤：{}\n- 不确定项：{}\n- 规划必须把验证步骤拆成可执行任务，并明确对照方案、判定指标和停止条件；证据边界不得丢失。",
        card.version, card.decision, card.hypothesis, card.evidence.join("；"),
        card.counter_evidence.join("；"), card.falsification,
        card.validation_steps.join("；"), card.uncertainties.join("；"),
    )
}

pub fn ensure_validation(value: &mut Value, card: Option<&ResearchHypothesisCardPayload>) {
    let Some(card) = card else {
        return;
    };
    let current = value
        .get("hypothesis_validation")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let array_or = |key: &str, fallback: Vec<Value>| {
        current
            .get(key)
            .and_then(Value::as_array)
            .filter(|items| !items.is_empty())
            .cloned()
            .unwrap_or(fallback)
    };
    let evidence_boundary = if card.evidence.is_empty() && card.counter_evidence.is_empty() {
        vec![json!("当前材料未提供可定位证据，执行前需补充来源。")]
    } else {
        card.evidence
            .iter()
            .map(|item| json!(format!("支持：{item}")))
            .chain(
                card.counter_evidence
                    .iter()
                    .map(|item| json!(format!("反证：{item}"))),
            )
            .collect()
    };
    value["hypothesis_validation"] = json!({
        "hypothesis": card.hypothesis,
        "tasks": array_or("tasks", card.validation_steps.iter().map(|item| json!(item)).collect()),
        "control_plan": current.get("control_plan").and_then(Value::as_str).filter(|item| !item.trim().is_empty()).unwrap_or("在相同数据、预算和评价流程下比较不采用该假设改动的基线方案。"),
        "decision_metrics": array_or("decision_metrics", vec![json!("使用预先约定的主指标比较假设方案与基线，并记录差异和不确定性。")]),
        "stop_conditions": array_or("stop_conditions", vec![json!(format!("观察到证伪条件：{}", card.falsification))]),
        "evidence_boundary": array_or("evidence_boundary", evidence_boundary),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card() -> ResearchHypothesisCardPayload {
        ResearchHypothesisCardPayload {
            id: "hypothesis-1".into(),
            version: 2,
            parent_version: Some(1),
            decision: "adopted".into(),
            decision_note: None,
            title: "证据路径约束".into(),
            hypothesis: "加入路径约束后无来源断言下降".into(),
            rationale: "材料指出难以追溯".into(),
            evidence: vec!["手记：回答难追溯".into()],
            counter_evidence: vec!["材料中暂无反证".into()],
            falsification: "无来源断言未下降".into(),
            validation_steps: vec!["冻结问题集".into(), "比较基线".into()],
            uncertainties: vec!["样本量未知".into()],
            keywords: vec!["Graph RAG".into()],
            created_at: "2026-08-13T00:00:00Z".into(),
            updated_at: "2026-08-13T01:00:00Z".into(),
            origin: None,
        }
    }

    #[test]
    fn fills_validation_fields_when_model_omits_them() {
        let mut plan = json!({ "overview": "研究路线" });
        ensure_validation(&mut plan, Some(&card()));
        let validation = &plan["hypothesis_validation"];
        assert_eq!(validation["tasks"].as_array().map(Vec::len), Some(2));
        assert!(validation["control_plan"]
            .as_str()
            .is_some_and(|item| !item.is_empty()));
        assert!(validation["decision_metrics"]
            .as_array()
            .is_some_and(|items| !items.is_empty()));
        assert!(validation["stop_conditions"][0]
            .as_str()
            .is_some_and(|item| item.contains("无来源断言未下降")));
        assert!(validation["evidence_boundary"]
            .as_array()
            .is_some_and(|items| items.len() == 2));
    }
}
