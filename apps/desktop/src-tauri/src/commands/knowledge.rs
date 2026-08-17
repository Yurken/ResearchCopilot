use crate::assistant_prompts::specialist_system;
use crate::ccf::match_venue;
use crate::commands::arxiv::{search_recent_paper_hints, search_semantic_scholar_hints};
use crate::commands::knowledge_hypothesis::{
    ensure_validation as ensure_hypothesis_validation,
    persist_versions_and_checkpoint as persist_hypothesis_versions,
    prompt_context as hypothesis_to_prompt_context, stored_card, validate_card,
    ResearchHypothesisCardPayload,
};
use crate::commands::knowledge_notes::note_row_to_json;
use crate::commands::knowledge_plan_status::{
    mark_interest_plan_planned, mark_interest_plan_running, restore_interest_plan_status,
};
use crate::commands::memory::{is_long_term_memory_enabled, record_knowledge_note_created_event};
use crate::links::paper_search_url;
use crate::llm::{resolve_model, resolve_temperature, LlmClient, LlmMessage};
use crate::services::memory_checkpoint_service::{
    record_research_asset_checkpoint, research_interest_asset_snapshot,
    ResearchAssetCheckpointInput,
};
use crate::state::AppState;
use chrono;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use std::collections::HashSet;
use tauri::{Emitter, State};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ResearchInterestProfilePayload {
    pub goal: Option<String>,
    pub background: Option<String>,
    pub time_budget: Option<String>,
    pub constraints: Option<Vec<String>>,
    pub known_context: Option<String>,
    pub preferred_output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearchInterestHintResponse {
    pub summary: String,
    pub next_field: String,
    pub matched_domains: Vec<String>,
    pub keyword_suggestions: Vec<String>,
    pub goal_suggestions: Vec<String>,
    pub background_prompts: Vec<String>,
    pub time_budget_suggestions: Vec<String>,
    pub constraint_suggestions: Vec<String>,
    pub known_context_suggestions: Vec<String>,
    pub output_suggestions: Vec<String>,
}

// ── Research Interests ──────────────────────────────────────────

#[tauri::command]
pub async fn knowledge_list_interests(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let rows = sqlx::query(
        "SELECT id, topic, folder_name, parent_id, keywords, profile, hypothesis_card, learning_path, status, created_at FROM research_interests ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    let list: Vec<serde_json::Value> = rows.iter().map(research_interest_row_to_json).collect();
    Ok(json!(list))
}

#[tauri::command]
pub async fn knowledge_create_interest(
    state: State<'_, AppState>,
    topic: String,
    keywords: Vec<String>,
    profile: Option<ResearchInterestProfilePayload>,
    hypothesis_card: Option<ResearchHypothesisCardPayload>,
) -> Result<serde_json::Value, String> {
    let trimmed_topic = topic.trim();
    if trimmed_topic.is_empty() {
        return Err("研究方向不能为空".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let kw_json = serde_json::to_string(&keywords).unwrap_or_else(|_| "[]".into());
    let profile_json = profile
        .as_ref()
        .and_then(|value| serde_json::to_string(value).ok());
    if let Some(card) = hypothesis_card.as_ref() {
        validate_card(card)?;
    }
    let stored_hypothesis_card = hypothesis_card.as_ref().map(stored_card);
    let hypothesis_card_json = stored_hypothesis_card
        .as_ref()
        .and_then(|value| serde_json::to_string(value).ok());
    let folder_name = default_interest_folder_name(trimmed_topic);
    sqlx::query(
        "INSERT INTO research_interests (id, topic, folder_name, keywords, profile, hypothesis_card, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(trimmed_topic)
    .bind(&folder_name)
    .bind(&kw_json)
    .bind(&profile_json)
    .bind(&hypothesis_card_json)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    if let Some(card) = hypothesis_card.as_ref() {
        let profile_value = profile
            .as_ref()
            .and_then(|value| serde_json::to_value(value).ok());
        persist_hypothesis_versions(
            &state.db,
            &id,
            trimmed_topic,
            &keywords,
            profile_value.as_ref(),
            card,
            &now,
        )
        .await?;
    }
    Ok(json!({
        "id": id,
        "topic": trimmed_topic,
        "folder_name": folder_name,
        "parent_id": null,
        "keywords": keywords,
        "profile": profile,
        "hypothesis_card": stored_hypothesis_card,
        "status": "active",
        "created_at": now
    }))
}

#[tauri::command]
pub async fn knowledge_update_interest_folder(
    state: State<'_, AppState>,
    id: String,
    folder_name: String,
) -> Result<serde_json::Value, String> {
    let trimmed_folder_name = folder_name.trim();
    if trimmed_folder_name.is_empty() {
        return Err("文件夹名称不能为空".to_string());
    }

    sqlx::query("UPDATE research_interests SET folder_name = ? WHERE id = ?")
        .bind(trimmed_folder_name)
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    let row = sqlx::query(
        "SELECT id, topic, folder_name, parent_id, keywords, profile, hypothesis_card, learning_path, status, created_at FROM research_interests WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or("未找到对应研究方向。")?;

    Ok(research_interest_row_to_json(&row))
}

#[tauri::command]
pub async fn knowledge_delete_interest_bundle(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let exists = sqlx::query("SELECT id FROM research_interests WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    if exists.is_none() {
        return Err("未找到对应研究方向。".to_string());
    }

    // 连同所有子孙文件夹一起删除。
    let interest_ids = collect_interest_subtree_ids(&state.db, &id).await?;

    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;
    let mut deleted_sessions = 0u64;
    let mut deleted_notes = 0u64;
    let mut deleted_papers = 0u64;

    for interest_id in &interest_ids {
        deleted_sessions += sqlx::query(
            "DELETE FROM chat_sessions WHERE context_type = 'interest' AND context_id = ?",
        )
        .bind(interest_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .rows_affected();

        deleted_notes += sqlx::query("DELETE FROM knowledge_notes WHERE research_interest_id = ?")
            .bind(interest_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
            .rows_affected();

        deleted_papers += sqlx::query("DELETE FROM papers WHERE research_interest_id = ?")
            .bind(interest_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
            .rows_affected();

        sqlx::query("DELETE FROM research_interests WHERE id = ?")
            .bind(interest_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(json!({
        "deleted_interest_id": id,
        "deleted_interest_ids": interest_ids,
        "deleted_sessions": deleted_sessions,
        "deleted_notes": deleted_notes,
        "deleted_papers": deleted_papers,
    }))
}

/// 仅删除该文件夹本身，内容上提一层：
/// - 直接论文、笔记移动到被删文件夹的父级（顶层文件夹则变为未归档）；
/// - 直接子文件夹挂到被删文件夹的父级；
/// - 关联会话回到通用上下文。
#[tauri::command]
pub async fn knowledge_delete_interest_only(
    state: State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;

    let row = sqlx::query("SELECT parent_id FROM research_interests WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("未找到对应研究方向。")?;
    let parent_id: Option<String> = row
        .get::<Option<String>, _>("parent_id")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let now = chrono::Utc::now().to_rfc3339();

    // 直接论文上提到父级（无父级则置为未归档）。
    sqlx::query(
        "UPDATE papers SET research_interest_id = ?, updated_at = ? WHERE research_interest_id = ?",
    )
    .bind(&parent_id)
    .bind(&now)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // 直接笔记上提到父级。
    sqlx::query(
        "UPDATE knowledge_notes SET research_interest_id = ?, updated_at = ? WHERE research_interest_id = ?",
    )
    .bind(&parent_id)
    .bind(&now)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // 直接子文件夹上提到父级。
    sqlx::query("UPDATE research_interests SET parent_id = ? WHERE parent_id = ?")
        .bind(&parent_id)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // 关联会话回到通用上下文。
    sqlx::query(
        "UPDATE chat_sessions SET context_type = 'general', context_id = NULL \
         WHERE context_type = 'interest' AND context_id = ?",
    )
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM research_interests WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(json!({ "deleted_interest_id": id, "reparented_to": parent_id }))
}

/// 在论文库中创建整理文件夹（含子文件夹）。
/// 区别于 `knowledge_create_interest`：这是轻量整理容器，`topic` 与 `folder_name`
/// 同为传入名称，不附带关键词与学习路线。`parent_id` 为空表示顶层文件夹。
#[tauri::command]
pub async fn knowledge_create_folder(
    state: State<'_, AppState>,
    name: String,
    parent_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("文件夹名称不能为空".to_string());
    }

    let parent = parent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(parent) = parent {
        let exists = sqlx::query("SELECT id FROM research_interests WHERE id = ?")
            .bind(parent)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            return Err("未找到上级文件夹。".to_string());
        }
    }

    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO research_interests (id, topic, folder_name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(trimmed)
    .bind(trimmed)
    .bind(parent)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let row = sqlx::query(
        "SELECT id, topic, folder_name, parent_id, keywords, profile, hypothesis_card, learning_path, status, created_at FROM research_interests WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or("文件夹创建失败。")?;

    Ok(research_interest_row_to_json(&row))
}

/// 调整文件夹的父级。`parent_id` 为空表示移动到顶层。
/// 校验：不能把文件夹移动到它自身或它的子孙之下（避免成环）。
#[tauri::command]
pub async fn knowledge_move_interest(
    state: State<'_, AppState>,
    id: String,
    parent_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let target_parent = parent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    if let Some(parent) = target_parent.as_deref() {
        if parent == id.as_str() {
            return Err("不能把文件夹移动到它自己下面。".to_string());
        }
        let exists = sqlx::query("SELECT id FROM research_interests WHERE id = ?")
            .bind(parent)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            return Err("未找到上级文件夹。".to_string());
        }
        let subtree = collect_interest_subtree_ids(&state.db, &id).await?;
        if subtree.iter().any(|item| item.as_str() == parent) {
            return Err("不能把文件夹移动到它自己的子文件夹下面。".to_string());
        }
    }

    let result = sqlx::query("UPDATE research_interests SET parent_id = ? WHERE id = ?")
        .bind(&target_parent)
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err("未找到对应文件夹。".to_string());
    }

    let row = sqlx::query(
        "SELECT id, topic, folder_name, parent_id, keywords, profile, hypothesis_card, learning_path, status, created_at FROM research_interests WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or("未找到对应文件夹。")?;

    Ok(research_interest_row_to_json(&row))
}

const PLANNER_PROMPT: &str = r#"请为研究方向「{topic}」（关键词：{keywords}）设计系统化研究学习路线。

要求：
1. overview 写一段话概述该方向的背景、价值和当前发展阶段（1-2 段，不要只复述 topic）
2. prerequisites 列出 3-5 项前置知识，每项给出名称、简要说明和 1-2 个学习资源
3. learning_stages 分 3-5 个阶段，每个阶段给出：标题、预计耗时、学习目标、核心主题、推荐资源
4. classic_papers 列出至少 8 篇经典/必读论文，每篇给出：准确标题、第一作者、年份、发表地、一句话推荐理由。不要编造不存在的论文
5. research_directions 给出 3-5 个可行研究方向，每个方向说明研究价值和 2-3 个开放问题
6. tools_and_frameworks 列出该领域常用工具和框架
7. communities 列出值得关注的学术社区、会议、期刊或研究者

仅返回严格合法 JSON，按以下格式（不要包含 markdown 代码块或解释）：
{{"overview":"...","prerequisites":[{{"name":"...","description":"...","resources":["..."]}}],"learning_stages":[{{"stage":1,"title":"...","duration":"...","goals":["..."],"topics":["..."],"resources":["..."]}}],"classic_papers":[{{"title":"...","authors":"...","year":2020,"venue":"会议/期刊名","reason":"...引用论文的具体贡献，不要写'经典论文'等笼统理由"}}],"research_directions":[{{"direction":"...","description":"...","open_problems":["..."]}}],"tools_and_frameworks":["..."],"communities":["..."]}}"#;
const MIN_CLASSIC_PAPER_COUNT: usize = 8;
const PLANNER_ANALYST_PROMPT: &str = r#"请分析研究方向「{topic}」（关键词：{keywords}），仅返回合法 JSON：
{"scope":"一句话定义该方向的核心研究范围","focus_topics":["3-5 个核心主题"],"skill_targets":["进入该方向需要掌握的 3-5 项关键能力"],"risk_points":["新手容易踩的 3-5 个坑"],"recent_trends":["近两年值得关注的发展方向"]}"#;
const INTEREST_HINT_PROMPT: &str = r#"请根据下面这个"正在填写中的研究规划表单"，给出实时补全建议。

目标：
1. 用 1-2 句中文总结你当前理解的研究方向，避免空泛。
2. 判断"现在最值得继续填写的字段" next_field。只能从 topic, keywords, goal, background, time_budget, constraints, known_context, preferred_output 中选择一个。
3. 给出各字段的候选建议，供界面做点击补全。建议应补充用户输入，而不是重复原文。
4. 每个数组最多 6 项，尽量短、可直接点击、避免长句。
5. 若研究主题与大模型/LLM 相关，关键词建议通常要优先覆盖 LLM、Deep Learning、Transformer、Alignment、RLHF、RAG、Reasoning、Evaluation 中合适的项，但仍然要结合用户已经填写的内容过滤不合适项。
6. 在信息不足时，优先顺序通常是：topic -> keywords -> goal -> background -> time_budget -> constraints -> known_context -> preferred_output；但如果你认为某个后续字段更关键，可以调整。
7. background_prompts 只能写"当前基础可补充的信息"或"可直接填写的短语模板"，例如"学过深度学习与 PyTorch""做过时序预测 benchmark 复现"。不要写成问句，不要写数据集选择、baseline 比较、实验设计、评价指标等内容。
8. constraint_suggestions 才适合出现算力、公开数据、中文资料优先等限制；known_context_suggestions 才适合出现论文、模型、baseline 名称。

只返回合法 JSON，不要包含 markdown、解释或代码块：
{
  "summary": "一句到两句中文总结",
  "next_field": "keywords",
  "matched_domains": ["领域标签"],
  "keyword_suggestions": ["关键词"],
  "goal_suggestions": ["研究目标建议"],
  "background_prompts": ["当前基础补充问题"],
  "time_budget_suggestions": ["时间预算建议"],
  "constraint_suggestions": ["约束条件建议"],
  "known_context_suggestions": ["已知论文或方法"],
  "output_suggestions": ["期望输出建议"]
}

当前表单：
{form}
"#;

fn planner_system() -> String {
    specialist_system(
        "科研规划助手",
        "为研究者设计结构化、可执行、可落地的研究学习路线。",
        Some("输出必须专业、克制、可操作。"),
    )
}

fn planner_analyst_system() -> String {
    specialist_system(
        "研究方向分析 Agent",
        "把研究主题拆解为清晰的学习重点、能力目标和风险点。",
        Some("输出必须准确、简洁、可执行。"),
    )
}

fn interest_hint_system() -> String {
    specialist_system(
        "研究规划表单实时助手",
        "基于用户已填写的信息，判断下一步最值得补充的字段，并给出可直接点击的候选短语。",
        Some("你的职责不是直接生成完整路线，输出必须稳定、克制、可执行。"),
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PlannerPaperHint {
    title: String,
    authors: Option<String>,
    year: Option<i64>,
    venue: Option<String>,
    reason: String,
    url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PartialPlanContext {
    analysis: Option<serde_json::Value>,
    paper_hints: Option<Vec<PlannerPaperHint>>,
}

#[tauri::command]
pub async fn knowledge_generate_plan(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    start_step: Option<usize>,
) -> Result<(), String> {
    let row = sqlx::query(
        "SELECT topic, keywords, profile, hypothesis_card, partial_plan FROM research_interests WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or("未找到对应研究方向。")?;

    let topic: String = row.get("topic");
    let kw_str: String = row
        .get::<Option<String>, _>("keywords")
        .unwrap_or_else(|| "[]".into());
    let profile_str: Option<String> = row.get::<Option<String>, _>("profile");
    let hypothesis_card_str: Option<String> = row.get::<Option<String>, _>("hypothesis_card");
    let partial_plan_str: Option<String> = row.get::<Option<String>, _>("partial_plan");

    let keywords: Vec<String> = serde_json::from_str(&kw_str).unwrap_or_default();
    let profile = profile_str
        .and_then(|value| serde_json::from_str::<ResearchInterestProfilePayload>(&value).ok())
        .unwrap_or_default();
    let hypothesis_card = hypothesis_card_str
        .and_then(|value| serde_json::from_str::<ResearchHypothesisCardPayload>(&value).ok());
    let mut partial_context: PartialPlanContext = partial_plan_str
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default();

    let resume_step = start_step.unwrap_or(0);

    mark_interest_plan_running(&state.db, &id).await?;
    let _ = app.emit(
        "interest:status",
        json!({ "id": &id, "status": "planning" }),
    );
    let settings = state.settings.read().await.clone();
    let db = state.db.clone();
    let rid = id.clone();

    tokio::spawn(async move {
        let client = match LlmClient::from_settings(&settings) {
            Ok(c) => c,
            Err(e) => {
                let status = restore_interest_plan_status(&db, &rid)
                    .await
                    .unwrap_or_else(|_| "active".to_string());
                let _ = app.emit("interest:status", json!({ "id": &rid, "status": status }));
                let _ = app.emit(
                    "interest:error",
                    json!({ "id": &rid, "error": e.to_string() }),
                );
                return;
            }
        };

        // --- Step 1: Analysis ---
        let analyst_id = format!("{}-analyst", rid);
        let analysis_json = if resume_step == 0 || partial_context.analysis.is_none() {
            let _ = app.emit(
                "interest:agent_start",
                json!({
                    "id": rid,
                    "agent": {
                        "id": &analyst_id,
                        "name": "洞见模型",
                        "role": "拆解研究方向与掌握目标",
                        "status": "running"
                    }
                }),
            );

            let analyst_prompt = PLANNER_ANALYST_PROMPT
                .replace("{topic}", &topic)
                .replace("{keywords}", &keywords.join("、"))
                + &profile_to_analysis_context(&profile)
                + &hypothesis_to_prompt_context(hypothesis_card.as_ref());
            let analyst_msgs = vec![
                LlmMessage::system(planner_analyst_system()),
                LlmMessage::user(&analyst_prompt),
            ];
            let analyst_model = resolve_model(
                &settings,
                &["multi_agent_paper_analyst_model", "paper_analysis_model"],
            );
            let analyst_temperature =
                resolve_temperature(&settings, "multi_agent_paper_analyst_temperature", 0.3);
            let result = match client
                .chat(&analyst_msgs, analyst_model.as_deref(), analyst_temperature)
                .await
            {
                Ok(resp) => {
                    let clean = crate::commands::papers::extract_json_pub(&resp);
                    let parsed =
                        serde_json::from_str::<serde_json::Value>(&clean).unwrap_or(json!({}));
                    let _ = app.emit("interest:agent_complete", json!({
                        "id": rid,
                        "agent": {
                            "id": &analyst_id,
                            "name": "洞见模型",
                            "role": "拆解研究方向与掌握目标",
                            "status": "done",
                            "summary": parsed.get("scope").and_then(|v| v.as_str()).unwrap_or("已完成主题拆解")
                        }
                    }));
                    parsed
                }
                Err(e) => {
                    let _ = app.emit(
                        "interest:agent_error",
                        json!({
                            "id": rid,
                            "agent": {
                                "id": &analyst_id,
                                "name": "洞见模型",
                                "role": "拆解研究方向与掌握目标",
                                "status": "failed",
                                "error": e.to_string()
                            }
                        }),
                    );

                    json!({})
                }
            };
            partial_context.analysis = Some(result.clone());
            let _ = sqlx::query("UPDATE research_interests SET partial_plan = ? WHERE id = ?")
                .bind(serde_json::to_string(&partial_context).unwrap_or_default())
                .bind(&rid)
                .execute(&db)
                .await;
            result
        } else {
            let _ = app.emit("interest:agent_complete", json!({
                "id": rid,
                "agent": {
                    "id": &analyst_id,
                    "name": "洞见模型",
                    "role": "拆解研究方向与掌握目标",
                    "status": "done",
                    "summary": partial_context.analysis.as_ref().and_then(|v| v.get("scope")).and_then(|v| v.as_str()).unwrap_or("已复用前次分析结果")
                }
            }));
            partial_context.analysis.clone().unwrap_or(json!({}))
        };

        let scout_id = format!("{}-scout", rid);
        // --- Step 2: Scout ---
        let paper_hints = if resume_step <= 1 || partial_context.paper_hints.is_none() {
            let _ = app.emit(
                "interest:agent_start",
                json!({
                    "id": rid,
                    "agent": {
                        "id": &scout_id,
                        "name": "探知模型",
                        "role": "筛选本地与联网参考论文",
                        "status": "running"
                    }
                }),
            );

            let mut hints: Vec<PlannerPaperHint> = Vec::new();
            let mut seen_titles = HashSet::new();
            let associated_rows = sqlx::query(
                "SELECT title, authors, year, venue, doi, file_path FROM papers WHERE research_interest_id = ? ORDER BY updated_at DESC LIMIT 10",
            )
            .bind(&rid)
            .fetch_all(&db)
            .await
            .unwrap_or_default();

            for row in associated_rows {
                let title: String = row.get("title");
                let normalized_title = title.trim().to_lowercase();
                if normalized_title.is_empty() || !seen_titles.insert(normalized_title) {
                    continue;
                }
                let authors: Option<String> = row.get("authors");
                let year: Option<i64> = row.get("year");
                let venue: Option<String> = row.get("venue");
                let doi: Option<String> = row.get("doi");
                let file_path: Option<String> = row.get("file_path");
                let hint_title = title.clone();
                hints.push(PlannerPaperHint {
                    title,
                    authors,
                    year,
                    venue,
                    reason: "来自本地论文库（已关联当前研究方向）".to_string(),
                    url: file_path
                        .or_else(|| doi.and_then(|_| paper_search_url(Some(&hint_title)))),
                });
            }

            let direct_paper_count = hints.len();
            if hints.len() < MIN_CLASSIC_PAPER_COUNT {
                let mut terms = vec![topic.clone()];
                terms.extend(keywords.clone());
                for term in terms.into_iter().take(6) {
                    let like = format!("%{}%", term);
                    let rows = sqlx::query(
                        "SELECT title, authors, year, venue, doi, file_path FROM papers WHERE (title LIKE ? OR abstract LIKE ?) AND (research_interest_id IS NULL OR research_interest_id != ?) LIMIT 4",
                    )
                    .bind(&like)
                    .bind(&like)
                    .bind(&rid)
                    .fetch_all(&db)
                    .await
                    .unwrap_or_default();
                    for row in rows {
                        let title: String = row.get("title");
                        let normalized_title = title.trim().to_lowercase();
                        if normalized_title.is_empty() || !seen_titles.insert(normalized_title) {
                            continue;
                        }
                        let authors: Option<String> = row.get("authors");
                        let year: Option<i64> = row.get("year");
                        let venue: Option<String> = row.get("venue");
                        let doi: Option<String> = row.get("doi");
                        let file_path: Option<String> = row.get("file_path");
                        let hint_title = title.clone();
                        hints.push(PlannerPaperHint {
                            title,
                            authors,
                            year,
                            venue,
                            reason: "来自本地论文库（关键词相关）".to_string(),
                            url: file_path
                                .or_else(|| doi.and_then(|_| paper_search_url(Some(&hint_title)))),
                        });
                        if hints.len() >= MIN_CLASSIC_PAPER_COUNT {
                            break;
                        }
                    }
                    if hints.len() >= MIN_CLASSIC_PAPER_COUNT {
                        break;
                    }
                }
            }

            let mut online_paper_count = 0usize;
            if hints.len() < MIN_CLASSIC_PAPER_COUNT {
                let needed = MIN_CLASSIC_PAPER_COUNT.saturating_sub(hints.len());
                let engine = settings
                    .get("paper_search_engine")
                    .map(|value| value.as_str())
                    .unwrap_or("arxiv");
                let recent_papers_result = if engine == "semantic_scholar" {
                    search_semantic_scholar_hints(
                        &settings,
                        &topic,
                        &keywords,
                        365,
                        needed.saturating_add(4),
                    )
                    .await
                } else {
                    search_recent_paper_hints(
                        &settings,
                        &topic,
                        &keywords,
                        365,
                        needed.saturating_add(4),
                    )
                    .await
                };
                if let Ok(recent_papers) = recent_papers_result {
                    for paper in recent_papers {
                        let normalized_title = paper.title.trim().to_lowercase();
                        if normalized_title.is_empty() || !seen_titles.insert(normalized_title) {
                            continue;
                        }
                        online_paper_count += 1;
                        let source_label = if engine == "semantic_scholar" {
                            "Semantic Scholar"
                        } else {
                            "arXiv"
                        };
                        hints.push(PlannerPaperHint {
                            title: paper.title,
                            authors: Some(paper.authors),
                            year: paper.year,
                            venue: Some(paper.venue),
                            reason: format!("来自 {source_label} 检索：{}", paper.reason),
                            url: Some(paper.url),
                        });
                        if hints.len() >= MIN_CLASSIC_PAPER_COUNT {
                            break;
                        }
                    }
                }
            }
            let _ = app.emit("interest:agent_complete", json!({
                "id": rid,
                "agent": {
                    "id": &scout_id,
                    "name": "探知模型",
                    "role": "筛选本地与联网参考论文",
                    "status": "done",
                    "summary": if direct_paper_count > 0 {
                        format!(
                            "已找到 {} 篇候选参考论文，其中 {} 篇来自当前主题文件夹，{} 篇来自联网检索",
                            hints.len(),
                            direct_paper_count,
                            online_paper_count
                        )
                    } else {
                        format!("已找到 {} 篇候选参考论文（联网检索补充 {} 篇）", hints.len(), online_paper_count)
                    }
                }
            }));
            partial_context.paper_hints = Some(hints.clone());
            let _ = sqlx::query("UPDATE research_interests SET partial_plan = ? WHERE id = ?")
                .bind(serde_json::to_string(&partial_context).unwrap_or_default())
                .bind(&rid)
                .execute(&db)
                .await;
            hints
        } else {
            let hints = partial_context.paper_hints.clone().unwrap_or_default();
            let _ = app.emit(
                "interest:agent_complete",
                json!({
                    "id": rid,
                    "agent": {
                        "id": &scout_id,
                        "name": "探知模型",
                        "role": "筛选本地与联网参考论文",
                        "status": "done",
                        "summary": format!("已复用前次筛选的 {} 篇参考论文", hints.len())
                    }
                }),
            );
            hints
        };

        let designer_id = format!("{}-designer", rid);
        let _ = app.emit(
            "interest:agent_start",
            json!({
                "id": rid,
                "agent": {
                    "id": &designer_id,
                    "name": "谋策模型",
                    "role": "生成结构化学习路线",
                    "status": "running"
                }
            }),
        );

        let analysis_scope = analysis_json
            .get("scope")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let analysis_focus = analysis_json
            .get("focus_topics")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str())
                    .collect::<Vec<&str>>()
                    .join("、")
            })
            .unwrap_or_default();
        let profile_context = format!(
            "{}{}",
            profile_to_prompt_context(&profile),
            hypothesis_to_prompt_context(hypothesis_card.as_ref())
        );
        let prompt = format!(
            "{}\n{}\n\n补充约束：\n- 方向范围：{}\n- 优先覆盖主题：{}\n- classic_papers 至少输出 {} 篇，优先近三年论文，不足时再补经典论文。\n- 候选论文池：{}{}",
            PLANNER_PROMPT
                .replace("{topic}", &topic)
                .replace("{keywords}", &keywords.join(", ")),
            profile_context,
            analysis_scope,
            analysis_focus,
            MIN_CLASSIC_PAPER_COUNT,
            if paper_hints.is_empty() {
                "无".to_string()
            } else {
                paper_hints
                    .iter()
                    .map(format_paper_hint_for_prompt)
                    .collect::<Vec<_>>()
                    .join("；")
            },
            if hypothesis_card.is_some() {
                "\n- 额外输出 hypothesis_validation：包含 hypothesis、tasks、control_plan、decision_metrics、stop_conditions、evidence_boundary。tasks 必须覆盖候选卡验证步骤；指标和停止条件必须可检查。"
            } else {
                ""
            }
        );
        let designer_model = resolve_model(&settings, &["planner_generation_model"]);
        let designer_temperature =
            resolve_temperature(&settings, "planner_generation_temperature", 0.3);
        let msgs = vec![
            LlmMessage::system(planner_system()),
            LlmMessage::user(&prompt),
        ];
        match client
            .chat(&msgs, designer_model.as_deref(), designer_temperature)
            .await
        {
            Ok(resp) => {
                let clean = crate::commands::papers::extract_json_pub(&resp);
                let mut v: serde_json::Value = enrich_learning_path_json(
                    serde_json::from_str(&clean).unwrap_or_default(),
                    &paper_hints,
                );
                ensure_hypothesis_validation(&mut v, hypothesis_card.as_ref());
                let path_str = serde_json::to_string(&v).unwrap_or_default();
                if let Err(e) = mark_interest_plan_planned(&db, &rid, &path_str).await {
                    let error = e.to_string();
                    let status = restore_interest_plan_status(&db, &rid)
                        .await
                        .unwrap_or_else(|_| "active".to_string());
                    let _ = app.emit("interest:status", json!({ "id": &rid, "status": status }));
                    let _ = app.emit(
                        "interest:agent_error",
                        json!({
                            "id": rid,
                            "agent": {
                                "id": &designer_id,
                                "name": "谋策模型",
                                "role": "生成结构化学习路线",
                                "status": "failed",
                                "error": e.to_string()
                            }
                        }),
                    );

                    let _ = app.emit("interest:error", json!({ "id": &rid, "error": &error }));
                    return;
                }
                let stage_count = v
                    .get("learning_stages")
                    .and_then(|x| x.as_array())
                    .map(|arr| arr.len())
                    .unwrap_or(0);
                let profile_value = serde_json::to_value(&profile).unwrap_or_else(|_| json!({}));
                let hypothesis_value = hypothesis_card
                    .as_ref()
                    .and_then(|card| serde_json::to_value(card).ok());
                let next_steps = hypothesis_card
                    .as_ref()
                    .map(|card| card.validation_steps.clone())
                    .unwrap_or_else(|| vec!["从学习路线第一阶段开始执行并记录结果。".to_string()]);
                let open_questions = hypothesis_card
                    .as_ref()
                    .map(|card| card.uncertainties.clone())
                    .unwrap_or_default();
                let _ = record_research_asset_checkpoint(
                    &db,
                    ResearchAssetCheckpointInput {
                        context_type: "interest",
                        context_id: &rid,
                        action: "interest.plan_completed",
                        goal: hypothesis_card
                            .as_ref()
                            .map(|card| card.hypothesis.as_str())
                            .unwrap_or(&topic),
                        summary: &format!("研究规划已生成，共 {stage_count} 个阶段。"),
                        completed_items: vec![format!("生成包含 {stage_count} 个阶段的研究规划。")],
                        open_questions,
                        next_steps,
                        asset_snapshot: research_interest_asset_snapshot(
                            &topic,
                            &keywords,
                            Some(&profile_value),
                            hypothesis_value.as_ref(),
                            Some(&v),
                        ),
                    },
                )
                .await;
                // Clear partial plan on success
                let _ =
                    sqlx::query("UPDATE research_interests SET partial_plan = NULL WHERE id = ?")
                        .bind(&rid)
                        .execute(&db)
                        .await;
                let _ = app.emit(
                    "interest:agent_complete",
                    json!({
                        "id": rid,
                        "agent": {
                            "id": &designer_id,
                            "name": "谋策模型",
                            "role": "生成结构化学习路线",
                            "status": "done",
                            "summary": format!("学习路线生成完成，共 {} 个阶段", stage_count)
                        }
                    }),
                );
                let _ = app.emit("interest:plan", json!({ "id": rid, "learning_path": v }));
            }
            Err(e) => {
                let error = e.to_string();
                crate::append_diagnostic_log(&format!(
                    "[planner][{}] 谋策模型调用失败: {}",
                    rid, error
                ));
                let status = restore_interest_plan_status(&db, &rid)
                    .await
                    .unwrap_or_else(|_| "active".to_string());
                let _ = app.emit("interest:status", json!({ "id": &rid, "status": status }));
                let _ = app.emit(
                    "interest:agent_error",
                    json!({
                        "id": rid,
                        "agent": {
                            "id": &designer_id,
                            "name": "谋策模型",
                            "role": "生成结构化学习路线",
                            "status": "failed",
                            "error": e.to_string()
                        }
                    }),
                );

                let _ = app.emit("interest:error", json!({ "id": rid, "error": &error }));
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn knowledge_generate_interest_hints(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    topic: String,
    keywords: Option<Vec<String>>,
    goal: Option<String>,
    background: Option<String>,
    time_budget: Option<String>,
    constraints: Option<Vec<String>>,
    known_context: Option<String>,
    preferred_output: Option<String>,
) -> Result<serde_json::Value, String> {
    let hint_id = Uuid::new_v4().to_string();
    let _ = app.emit(
        "interest:agent_start",
        json!({
            "id": "hints",
            "agent": {
                "id": hint_id,
                "name": "智能提示",
                "role": "生成研究方向实时建议",
                "status": "running"
            }
        }),
    );

    let outcome = async {
        let settings = state.settings.read().await.clone();
        let client = LlmClient::from_settings(&settings).map_err(|e| e.to_string())?;

        let profile = ResearchInterestProfilePayload {
            goal,
            background,
            time_budget,
            constraints,
            known_context,
            preferred_output,
        };
        let keywords = keywords.unwrap_or_default();
        let prompt = INTEREST_HINT_PROMPT.replace(
            "{form}",
            &format_interest_hint_form(&topic, &keywords, &profile),
        );
        let messages = vec![
            LlmMessage::system(interest_hint_system()),
            LlmMessage::user(prompt),
        ];
        let hint_model = resolve_model(&settings, &["planner_hint_model"]);
        let hint_temperature = resolve_temperature(&settings, "planner_hint_temperature", 0.2);
        let response = client
            .chat(&messages, hint_model.as_deref(), hint_temperature)
            .await
            .map_err(|e| e.to_string())?;
        let clean = crate::commands::papers::extract_json_pub(&response);
        let parsed: serde_json::Value = serde_json::from_str(&clean)
            .map_err(|e| format!("Failed to parse interest hints JSON: {e}"))?;

        let result = ResearchInterestHintResponse {
            summary: parsed
                .get("summary")
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "已结合当前输入生成实时建议。".to_string()),
            next_field: normalize_next_field(
                parsed.get("next_field").and_then(|value| value.as_str()),
            ),
            matched_domains: extract_string_list(parsed.get("matched_domains"), 4),
            keyword_suggestions: extract_string_list(parsed.get("keyword_suggestions"), 6),
            goal_suggestions: extract_string_list(parsed.get("goal_suggestions"), 6),
            background_prompts: extract_string_list(parsed.get("background_prompts"), 6),
            time_budget_suggestions: extract_string_list(parsed.get("time_budget_suggestions"), 6),
            constraint_suggestions: extract_string_list(parsed.get("constraint_suggestions"), 6),
            known_context_suggestions: extract_string_list(
                parsed.get("known_context_suggestions"),
                6,
            ),
            output_suggestions: extract_string_list(parsed.get("output_suggestions"), 6),
        };

        Ok::<_, String>(json!(result))
    }
    .await;

    match outcome {
        Ok(v) => {
            let _ = app.emit(
                "interest:agent_complete",
                json!({ "id": "hints", "agent": { "id": hint_id } }),
            );
            Ok(v)
        }
        Err(e) => {
            let _ = app.emit("interest:error", json!({ "id": "hints", "error": &e }));
            Err(e)
        }
    }
}

// ── Topic Discovery ──────────────────────────────────────────────

const TOPIC_SUGGEST_PROMPT: &str = r#"你是一位资深研究导师，请根据学生情况给出 4~5 个具体、可执行的研究课题方向。

学生情况：
- 感兴趣的研究领域：{field}
- 希望做的研究类型：{goal_type}
- 个人背景：{background}

要求：
- 每个课题必须具体可执行。例如不能说"机器学习"，要说"基于对比学习的低资源医学图像分割"
- 课题名称 10~30 字，使用中文
- 体现近两年学术前沿或有实际落地价值，尽量给出能发顶会/顶刊的方向
- 如果背景信息充分，结合学生的现有技术栈推荐
- 返回 JSON 对象，每个课题包含 name 和 reason，不要只返回字符串数组

仅返回合法 JSON 对象：
{"topics": [{"name": "课题方向", "reason": "一句话推荐理由"}]}"#;

#[tauri::command]
pub async fn knowledge_suggest_topics(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    field: String,
    goal_type: String,
    background: String,
) -> Result<Vec<String>, String> {
    let suggest_id = Uuid::new_v4().to_string();
    let _ = app.emit(
        "interest:agent_start",
        json!({
            "id": "suggest",
            "agent": {
                "id": suggest_id,
                "name": "课题建议",
                "role": "根据背景推荐研究课题",
                "status": "running"
            }
        }),
    );

    let outcome = async {
        let settings = state.settings.read().await.clone();
        let client = LlmClient::from_settings(&settings).map_err(|e| e.to_string())?;

        let bg = if background.trim().is_empty() {
            "未提供".to_string()
        } else {
            background.trim().to_string()
        };
        let prompt = TOPIC_SUGGEST_PROMPT
            .replace("{field}", field.trim())
            .replace("{goal_type}", goal_type.trim())
            .replace("{background}", &bg);

        let messages = vec![
            LlmMessage::system("你是一位资深学术导师，擅长帮助研究生找到有价值的研究切入点。"),
            LlmMessage::user(prompt),
        ];
        let model = resolve_model(&settings, &["planner_hint_model"]);
        let temperature = resolve_temperature(&settings, "planner_hint_temperature", 0.7);
        let response = client
            .chat(&messages, model.as_deref(), temperature)
            .await
            .map_err(|e| e.to_string())?;
        let clean = crate::commands::papers::extract_json_pub(&response);
        let topics: Vec<String> = serde_json::from_str::<serde_json::Value>(&clean)
            .ok()
            .and_then(|v| {
                v.get("topics").and_then(|arr| arr.as_array()).map(|arr| {
                    arr.iter()
                        .filter_map(|item| {
                            item.get("name")
                                .and_then(|n| n.as_str())
                                .map(|s| s.to_string())
                        })
                        .collect()
                })
            })
            .unwrap_or_default();
        Ok::<_, String>(topics)
    }
    .await;

    match outcome {
        Ok(v) => {
            let _ = app.emit(
                "interest:agent_complete",
                json!({ "id": "suggest", "agent": { "id": suggest_id } }),
            );
            Ok(v)
        }
        Err(e) => {
            let _ = app.emit("interest:error", json!({ "id": "suggest", "error": &e }));
            Err(e)
        }
    }
}

fn profile_to_analysis_context(profile: &ResearchInterestProfilePayload) -> String {
    let mut lines = Vec::new();

    if let Some(goal) = profile
        .goal
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        lines.push(format!("- 用户目标：{}", goal));
    }
    if let Some(background) = profile
        .background
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        lines.push(format!("- 用户基础：{}", background));
    }
    if let Some(time_budget) = profile
        .time_budget
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        lines.push(format!("- 时间预算：{}", time_budget));
    }
    if let Some(known_context) = profile
        .known_context
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        lines.push(format!("- 已知论文/方法：{}", known_context));
    }
    if let Some(preferred_output) = profile
        .preferred_output
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        lines.push(format!("- 期望输出：{}", preferred_output));
    }
    if let Some(constraints) = profile
        .constraints
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("- 约束条件：{}", constraints.join("、")));
    }

    if lines.is_empty() {
        String::new()
    } else {
        format!("\n补充用户画像：\n{}", lines.join("\n"))
    }
}

fn profile_to_prompt_context(profile: &ResearchInterestProfilePayload) -> String {
    let context = profile_to_analysis_context(profile);
    if context.is_empty() {
        String::new()
    } else {
        format!("{}\n- 请据此调整学习路线的深度、节奏和资源选择。", context)
    }
}

fn format_interest_hint_form(
    topic: &str,
    keywords: &[String],
    profile: &ResearchInterestProfilePayload,
) -> String {
    let to_line = |label: &str, value: Option<&str>| -> String {
        format!(
            "- {}：{}",
            label,
            value
                .filter(|item| !item.trim().is_empty())
                .unwrap_or("未填写")
        )
    };

    [
        to_line("研究主题", Some(topic)),
        if keywords.is_empty() {
            "- 关键词：未填写".to_string()
        } else {
            format!("- 关键词：{}", keywords.join("、"))
        },
        to_line("研究目标", profile.goal.as_deref()),
        to_line("当前基础", profile.background.as_deref()),
        to_line("时间预算", profile.time_budget.as_deref()),
        if let Some(items) = profile
            .constraints
            .as_ref()
            .filter(|value| !value.is_empty())
        {
            format!("- 约束条件：{}", items.join("、"))
        } else {
            "- 约束条件：未填写".to_string()
        },
        to_line("已知论文/方法", profile.known_context.as_deref()),
        to_line("期望输出", profile.preferred_output.as_deref()),
    ]
    .join("\n")
}

fn normalize_next_field(value: Option<&str>) -> String {
    match value.unwrap_or_default().trim() {
        "topic" => "topic",
        "keywords" => "keywords",
        "goal" => "goal",
        "background" => "background",
        "time_budget" => "time_budget",
        "constraints" => "constraints",
        "known_context" => "known_context",
        "preferred_output" => "preferred_output",
        _ => "keywords",
    }
    .to_string()
}

fn extract_string_list(value: Option<&serde_json::Value>, limit: usize) -> Vec<String> {
    let mut seen = HashSet::new();

    value
        .and_then(|items| items.as_array())
        .into_iter()
        .flatten()
        .filter_map(|item| item.as_str())
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .filter(|item| seen.insert(item.to_lowercase()))
        .take(limit)
        .map(|item| item.to_string())
        .collect()
}

fn format_paper_hint_for_prompt(hint: &PlannerPaperHint) -> String {
    let mut segments = vec![hint.title.clone()];

    if let Some(year) = hint.year {
        segments.push(format!("{}", year));
    }
    if let Some(venue) = hint.venue.as_ref().filter(|item| !item.trim().is_empty()) {
        segments.push(venue.clone());
    }
    if let Some(authors) = hint.authors.as_ref().filter(|item| !item.trim().is_empty()) {
        segments.push(format!("作者：{}", authors));
    }
    segments.push(hint.reason.clone());

    segments.join(" | ")
}

fn ensure_minimum_classic_papers(
    value: &mut serde_json::Value,
    hints: &[PlannerPaperHint],
    min_count: usize,
) {
    let Some(papers) = value
        .get_mut("classic_papers")
        .and_then(|item| item.as_array_mut())
    else {
        value["classic_papers"] = json!([]);
        return ensure_minimum_classic_papers(value, hints, min_count);
    };

    let mut seen_titles: HashSet<String> = papers
        .iter()
        .filter_map(|paper| paper.get("title").and_then(|item| item.as_str()))
        .map(|title| title.trim().to_lowercase())
        .filter(|title| !title.is_empty())
        .collect();

    for hint in hints {
        if papers.len() >= min_count {
            break;
        }
        let key = hint.title.trim().to_lowercase();
        if key.is_empty() || !seen_titles.insert(key) {
            continue;
        }
        papers.push(json!({
            "title": hint.title,
            "authors": hint.authors.clone().unwrap_or_else(|| "".to_string()),
            "year": hint.year,
            "venue": hint.venue.clone().unwrap_or_else(|| "arXiv / Local".to_string()),
            "reason": hint.reason,
            "paper_url": hint.url.clone().unwrap_or_default(),
        }));
    }
}

fn enrich_learning_path_json(
    mut value: serde_json::Value,
    hints: &[PlannerPaperHint],
) -> serde_json::Value {
    ensure_minimum_classic_papers(&mut value, hints, MIN_CLASSIC_PAPER_COUNT);

    if let Some(papers) = value
        .get_mut("classic_papers")
        .and_then(|item| item.as_array_mut())
    {
        for paper in papers {
            if let Some(venue) = paper.get("venue").and_then(|item| item.as_str()) {
                if let Some(tag) = match_venue(venue) {
                    paper["ccf_rating"] = json!(tag.rating);
                    paper["ccf_area"] = json!(tag.area);
                    paper["ccf_type"] = json!(tag.kind);
                    paper["ccf_label"] = json!(tag.label);
                    paper["ccf_publisher"] = json!(tag.publisher);
                    paper["venue_url"] = json!(tag.url);
                }
            }
            if let Some(title) = paper.get("title").and_then(|item| item.as_str()) {
                let existing_url = paper
                    .get("paper_url")
                    .and_then(|item| item.as_str())
                    .map(|value| value.trim().to_string())
                    .unwrap_or_default();
                if existing_url.is_empty() {
                    if let Some(url) = paper_search_url(Some(title)) {
                        paper["paper_url"] = json!(url);
                    }
                }
            }
        }
    }
    value
}

// ── Helper ───────────────────────────────────────────────────────

fn research_interest_row_to_json(r: &sqlx::sqlite::SqliteRow) -> serde_json::Value {
    let keywords: String = r
        .get::<Option<String>, _>("keywords")
        .unwrap_or_else(|| "[]".into());
    let profile_str: Option<String> = r.get::<Option<String>, _>("profile");
    let hypothesis_card_str: Option<String> = r.get::<Option<String>, _>("hypothesis_card");
    let learning_path = r
        .get::<Option<String>, _>("learning_path")
        .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
        .map(|value| enrich_learning_path_json(value, &[]));

    json!({
        "id": r.get::<String, _>("id"),
        "topic": r.get::<String, _>("topic"),
        "folder_name": r.get::<Option<String>, _>("folder_name"),
        "parent_id": r.get::<Option<String>, _>("parent_id"),
        "keywords": serde_json::from_str::<serde_json::Value>(&keywords).unwrap_or(json!([])),
        "profile": profile_str.and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok()),
        "hypothesis_card": hypothesis_card_str.and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok()),
        "learning_path": learning_path,
        "status": r.get::<String, _>("status"),
        "created_at": r.get::<String, _>("created_at"),
    })
}

fn default_interest_folder_name(topic: &str) -> String {
    let trimmed = topic.trim();
    if trimmed.is_empty() {
        "未命名主题".to_string()
    } else {
        trimmed.to_string()
    }
}

/// 收集某文件夹及其全部子孙文件夹的 id（含自身），用于级联删除与移动防环校验。
async fn collect_interest_subtree_ids(
    pool: &sqlx::SqlitePool,
    root_id: &str,
) -> Result<Vec<String>, String> {
    let mut ids = vec![root_id.to_string()];
    let mut frontier = vec![root_id.to_string()];
    while let Some(current) = frontier.pop() {
        let children = sqlx::query("SELECT id FROM research_interests WHERE parent_id = ?")
            .bind(&current)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
        for row in children {
            let child_id: String = row.get("id");
            if !ids.contains(&child_id) {
                ids.push(child_id.clone());
                frontier.push(child_id);
            }
        }
    }
    Ok(ids)
}

// ── Web Clip ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn knowledge_web_clip(
    state: State<'_, AppState>,
    url: String,
    research_interest_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (compatible; XiaoYan/1.0)")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let html = resp.text().await.map_err(|e| e.to_string())?;

    // Extract title
    let title = {
        use std::sync::LazyLock;
        static RE_TITLE: LazyLock<regex::Regex> =
            LazyLock::new(|| regex::Regex::new(r"(?i)<title[^>]*>([^<]+)</title>").unwrap());
        RE_TITLE
            .captures(&html)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string())
            .unwrap_or_else(|| url.clone())
    };

    // Strip scripts, styles, tags; collapse whitespace
    let text = {
        use std::sync::LazyLock;
        static RE_SCRIPT: LazyLock<regex::Regex> =
            LazyLock::new(|| regex::Regex::new(r"(?is)<script[^>]*>.*?</script>").unwrap());
        static RE_STYLE: LazyLock<regex::Regex> =
            LazyLock::new(|| regex::Regex::new(r"(?is)<style[^>]*>.*?</style>").unwrap());
        static RE_TAGS: LazyLock<regex::Regex> =
            LazyLock::new(|| regex::Regex::new(r"<[^>]+>").unwrap());
        static RE_WS: LazyLock<regex::Regex> =
            LazyLock::new(|| regex::Regex::new(r"\s{2,}").unwrap());

        let t = RE_SCRIPT.replace_all(&html, " ");
        let t = RE_STYLE.replace_all(&t, " ");
        let t = RE_TAGS.replace_all(&t, " ");
        let t = RE_WS.replace_all(&t, "\n");
        t.trim().chars().take(8000).collect::<String>()
    };
    let content = format!("来源：{}\n\n{}", url, text);

    // Save as knowledge note
    let id = Uuid::new_v4().to_string();
    let ts = chrono::Utc::now().to_rfc3339();
    let tags_json = "[]";
    sqlx::query(
        "INSERT INTO knowledge_notes (id, title, content, source_type, source_id, tags, research_interest_id, created_at, updated_at)
         VALUES (?, ?, ?, 'web_clip', ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&title)
    .bind(&content)
    .bind(&url)
    .bind(tags_json)
    .bind(research_interest_id.as_deref())
    .bind(&ts)
    .bind(&ts)
    .execute(&state.db)
    .await
    .map_err(|e| e.to_string())?;

    let settings = state.settings.read().await.clone();
    if is_long_term_memory_enabled(&settings) {
        let _ = record_knowledge_note_created_event(
            &state.db,
            &id,
            &title,
            &content,
            research_interest_id.as_deref(),
            "web_clip",
        )
        .await;
    }

    let row = sqlx::query(
        "SELECT id, title, content, source_type, source_id, tags, research_interest_id, created_at, updated_at FROM knowledge_notes WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or("未找到对应笔记。")?;

    Ok(note_row_to_json(&row))
}
