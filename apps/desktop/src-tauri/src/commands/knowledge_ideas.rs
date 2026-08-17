use crate::llm::{resolve_model, resolve_temperature, LlmClient, LlmImage, LlmMessage};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, State};
use uuid::Uuid;

const IDEA_FROM_MATERIALS_PROMPT: &str = r#"你是一位资深研究导师。学生提供了一些零散材料（导师讨论记录、会议笔记、灵感碎片、论文摘录或截图等）。请把材料中的线索转成具体、可检查、可证伪的候选研究假设，而不是只给宽泛选题。

要求：
- 给出 4~6 个候选假设，每个都要紧扣材料；不得把模型常识伪装成材料证据
- title：一句话研究方向（10~30 字，中文）
- hypothesis：明确、可被证伪的假设；说明变量、对象或预期关系
- rationale：为什么值得验证，以及它回应了材料中的什么问题
- evidence：1~3 条材料内的支持线索；使用“材料名称/手记 + 简短线索”，找不到就返回空数组
- counter_evidence：1~3 条反例、冲突线索或可能推翻假设的情况；材料没有时明确写“材料中未提供反证，需主动检索”
- falsification：什么观察结果会否定或显著削弱该假设
- validation_steps：3~5 个可执行验证步骤，至少包含数据/材料、对照或比较、判定指标
- uncertainties：当前无法从材料确认的事实，不得自行补成确定结论
- keywords：3~5 个可用于文献检索的关键词
- 若提供了用户修正，明确遵守修正，但不能因此删除证据边界或可证伪条件

仅返回合法 JSON 对象：
{"ideas": [{"title": "...", "hypothesis": "...", "rationale": "...", "evidence": ["..."], "counter_evidence": ["..."], "falsification": "...", "validation_steps": ["..."], "uncertainties": ["..."], "keywords": ["..."]}]}

学生提供的材料：
{materials}

用户对上一版的修正要求：
{feedback}"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResearchIdeaSuggestion {
    pub title: String,
    pub hypothesis: String,
    pub rationale: String,
    pub evidence: Vec<String>,
    pub counter_evidence: Vec<String>,
    pub falsification: String,
    pub validation_steps: Vec<String>,
    pub uncertainties: Vec<String>,
    pub keywords: Vec<String>,
}

fn compact_text(value: &str, max_chars: usize) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

fn string_field(item: &Value, key: &str, max_chars: usize) -> String {
    item.get(key)
        .and_then(Value::as_str)
        .map(|value| compact_text(value, max_chars))
        .unwrap_or_default()
}

fn string_list(item: &Value, key: &str, limit: usize) -> Vec<String> {
    item.get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|value| compact_text(value, 360))
        .filter(|value| !value.is_empty())
        .take(limit)
        .collect()
}

pub(crate) fn parse_research_ideas(raw: &str) -> Vec<ResearchIdeaSuggestion> {
    let clean = crate::commands::papers::extract_json_pub(raw);
    serde_json::from_str::<Value>(&clean)
        .ok()
        .and_then(|value| value.get("ideas").and_then(Value::as_array).cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|item| {
            let title = string_field(item, "title", 120);
            let hypothesis = string_field(item, "hypothesis", 600);
            let falsification = string_field(item, "falsification", 600);
            let validation_steps = string_list(item, "validation_steps", 6);
            if title.is_empty()
                || hypothesis.is_empty()
                || falsification.is_empty()
                || validation_steps.is_empty()
            {
                return None;
            }
            Some(ResearchIdeaSuggestion {
                title,
                hypothesis,
                rationale: string_field(item, "rationale", 600),
                evidence: string_list(item, "evidence", 4),
                counter_evidence: string_list(item, "counter_evidence", 4),
                falsification,
                validation_steps,
                uncertainties: string_list(item, "uncertainties", 5),
                keywords: string_list(item, "keywords", 6),
            })
        })
        .collect()
}

/// 从零散材料生成带证据边界、反证条件和验证步骤的候选研究假设卡。
#[tauri::command]
pub async fn knowledge_ideas_from_materials(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    materials: String,
    images: Option<Vec<crate::commands::chat::ImageInput>>,
    feedback: Option<String>,
) -> Result<Vec<ResearchIdeaSuggestion>, String> {
    let images: Vec<LlmImage> = images
        .unwrap_or_default()
        .into_iter()
        .map(|image| LlmImage {
            media_type: image.media_type,
            data: image.data,
        })
        .collect();

    if materials.trim().is_empty() && images.is_empty() {
        return Err("请先添加一些材料（文字、文档或图片）。".to_string());
    }

    let suggest_id = Uuid::new_v4().to_string();
    let _ = app.emit(
        "interest:agent_start",
        json!({
            "id": "suggest",
            "agent": {
                "id": suggest_id,
                "name": "假设提炼",
                "role": "从材料中提炼可验证研究假设",
                "status": "running"
            }
        }),
    );

    let outcome = async {
        let settings = state.settings.read().await.clone();
        let temperature = resolve_temperature(&settings, "planner_hint_temperature", 0.5);
        let (client, model) = if images.is_empty() {
            (
                LlmClient::from_settings(&settings).map_err(|error| error.to_string())?,
                resolve_model(&settings, &["planner_hint_model"]),
            )
        } else {
            LlmClient::vision_client_from_settings(&settings).ok_or_else(|| {
                "材料中包含图片，请先在「设置 → 模型角色 → 视界·视觉」中配置视觉模型。"
                    .to_string()
            })?
        };

        let material_text = if materials.trim().is_empty() {
            "（无文字材料，仅提供了图片；图片是唯一材料来源）".to_string()
        } else {
            materials.trim().to_string()
        };
        let feedback_text = feedback
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("（首次生成，无修正要求）");
        let prompt = IDEA_FROM_MATERIALS_PROMPT
            .replace("{materials}", &material_text)
            .replace("{feedback}", feedback_text);

        let user_message = if images.is_empty() {
            LlmMessage::user(&prompt)
        } else {
            LlmMessage::user_with_images(&prompt, images.clone())
        };
        let messages = vec![
            LlmMessage::system(
                "你是一位严谨的学术导师。只依据用户材料提出候选假设，明确区分材料证据、推断和未知。",
            ),
            user_message,
        ];
        let response = client
            .chat(&messages, model.as_deref(), temperature)
            .await
            .map_err(|error| error.to_string())?;
        let ideas = parse_research_ideas(&response);
        if ideas.is_empty() {
            return Err(
                "没能生成包含假设、证伪条件和验证步骤的完整 idea，请补充材料后重试。"
                    .to_string(),
            );
        }
        Ok::<_, String>(ideas)
    }
    .await;

    match outcome {
        Ok(ideas) => {
            let _ = app.emit(
                "interest:agent_complete",
                json!({ "id": "suggest", "agent": { "id": suggest_id } }),
            );
            Ok(ideas)
        }
        Err(error) => {
            let _ = app.emit(
                "interest:error",
                json!({ "id": "suggest", "error": &error }),
            );
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_research_ideas;

    #[test]
    fn rejects_topic_only_output_without_falsification_or_validation() {
        let raw = r#"{"ideas":[{"title":"做图检索","rationale":"有价值","keywords":["graph"]}]}"#;
        assert!(parse_research_ideas(raw).is_empty());
    }

    #[test]
    fn keeps_evidence_counter_evidence_and_validation_boundary() {
        let raw = r#"{"ideas":[{
            "title":"图路径约束可减少无来源回答",
            "hypothesis":"加入证据路径约束后，无来源断言比例下降",
            "rationale":"手记提到回答难以追溯",
            "evidence":["手记：回答难以追溯"],
            "counter_evidence":["材料中未提供反证，需主动检索"],
            "falsification":"加入约束后无来源断言比例未下降",
            "validation_steps":["固定问题集", "比较约束前后", "统计无来源断言比例"],
            "uncertainties":["现有样本规模未知"],
            "keywords":["Graph RAG", "evidence grounding"]
        }]}"#;
        let ideas = parse_research_ideas(raw);
        assert_eq!(ideas.len(), 1);
        assert_eq!(ideas[0].evidence, vec!["手记：回答难以追溯"]);
        assert_eq!(ideas[0].counter_evidence.len(), 1);
        assert_eq!(ideas[0].validation_steps.len(), 3);
        assert_eq!(ideas[0].uncertainties, vec!["现有样本规模未知"]);
    }
}
