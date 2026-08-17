use crate::assistant_prompts::specialist_system;
use crate::graph_rag::build_graph_rag_context;
use crate::llm::{
    resolve_model, resolve_temperature, resolve_temperature_chain, LlmClient, LlmMessage,
};
use crate::rag::combined_search;
use crate::services::chat_request_policy::ChatRequestPolicy;
use crate::services::paper_fact_service::{
    answer_supported_paper_fact_question, verified_worker_output,
};
use crate::text_utils::truncate_chars_with_ellipsis;
use anyhow::Result;
use sqlx::Row;
use std::collections::HashMap;

pub async fn execute_agent_node(
    client: &LlmClient,
    db: &sqlx::SqlitePool,
    settings: &HashMap<String, String>,
    agent_name: &str,
    message: &str,
    context_type: &str,
    context_id: &Option<String>,
    prior_context: &[String],
    _history: &[LlmMessage],
) -> Result<String> {
    let worker_temp = resolve_temperature(settings, "multi_agent_worker_temperature", 0.3);
    let worker_model = resolve_model(settings, &["multi_agent_worker_model"]);
    let (agent_model, agent_temperature) =
        resolve_agent_model_config(settings, agent_name, worker_model.as_deref(), worker_temp);

    match agent_name {
        "retrieval" => retrieval_context(client, db, settings, message).await,
        "paper_analyst" => {
            let text = paper_text(db, context_id).await;
            if let Some(answer) = answer_supported_paper_fact_question(message, &text) {
                return Ok(verified_worker_output(&answer));
            }
            let preview = truncate_chars_with_ellipsis(&text, 8000);
            let prompt = format!(
                "请基于以下论文内容回答用户问题，结论应客观、准确、可追溯。\n\n\
用户问题：{}\n\n\
论文内容（已截取关键部分）：\n{}\n\n\
要求：\n\
- 直接回答用户问题，先给结论再给依据\n\
- 引用论文中的具体内容，指明所在章节或段落\n\
- 如果问题超出论文覆盖范围，明确说明\n\
- 不要编造论文中未包含的信息",
                message, preview
            );
            let msgs = vec![
                LlmMessage::system(specialist_system(
                    "论文分析步骤",
                    "基于论文内容输出准确、结构化、可追溯的分析结果。",
                    Some("不得编造论文中未出现的信息。引用论文内容时指明章节或段落位置。"),
                )),
                LlmMessage::user(&prompt),
            ];
            client
                .chat(&msgs, agent_model.as_deref(), agent_temperature)
                .await
        }
        "planner" => {
            let prompt = if context_type == "interest" && !prior_context.is_empty() {
                format!(
                    "你正在为一个已规划的研究工作台继续推进研究路线。\n\n\
当前共享状态（来自其他 worker 的分析结果）：\n{}\n\n\
请围绕用户问题给出下一步行动方案。\n\
输出要求：\n\
- 明确当前研究阶段（探索/深入/收尾）\n\
- 给出 3-5 条下一周可执行的行动项，每条包含：目标、方法、预期产出\n\
- 标注每项行动的优先级（高/中/低）和预估时间\n\
- 如果当前状态暴露出路线缺陷，给出路线修订建议\n\n\
用户问题：{}",
                    prior_context.join("\n\n"),
                    message,
                )
            } else {
                format!(
                    "请为研究方向「{}」设计系统化学习路径。\n\
补充背景：{}\n\n\
输出要求：\n\
1. 先给出该方向的一句话核心定义\n\
2. 分 3-5 个阶段设计学习路径，每个阶段包含：目标、核心主题、推荐资源\n\
3. 列出 5-8 篇必读经典论文（给出准确标题、作者、年份、发表地）\n\
4. 指出 2-3 个当前仍开放的研究问题",
                    message,
                    prior_context.join("; ")
                )
            };
            let msgs = vec![
                LlmMessage::system(specialist_system(
                    "研究规划步骤",
                    "围绕用户问题输出分阶段、可执行的学习与研究推进建议。",
                    Some("输出要具体可执行，不要只给笼统方向。经典论文引用必须准确。"),
                )),
                LlmMessage::user(&prompt),
            ];
            client
                .chat(&msgs, agent_model.as_deref(), agent_temperature)
                .await
        }
        "literature_scout" => {
            let prompt = if context_type == "interest" && !prior_context.is_empty() {
                format!(
                    "这里是当前研究工作台的共享状态：\n{}\n\n\
请围绕用户问题推荐最值得优先阅读的核心论文。\n\n\
输出要求：\n\
- 每篇论文给出：标题、第一作者、年份、发表地（会议/期刊名）\n\
- 用一句话概括每篇论文的核心贡献\n\
- 用一句话说明为什么这篇论文适合当前研究路线\n\
- 按推荐优先级排序，最多 10 篇\n\
- 在末尾给出文献检索建议（关键词、值得关注的作者组、相关会议/期刊）\n\n\
用户问题：{}",
                    prior_context.join("\n\n"),
                    message,
                )
            } else {
                format!(
                    "请列出与「{}」最相关的核心论文。\n\n\
输出要求：\n\
- 每篇给出：标题、第一作者、年份、发表地\n\
- 一句话概括核心贡献\n\
- 按重要性排序，最多 8 篇\n\
- 给出后续检索建议",
                    message
                )
            };
            let msgs = vec![
                LlmMessage::system(specialist_system(
                    "文献调研步骤",
                    "推荐与当前问题最相关、最值得优先阅读的论文。",
                    Some("输出应给出标题、作者、年份、发表地、核心贡献与推荐理由。不要编造不存在的论文。"),
                )),
                LlmMessage::user(&prompt),
            ];
            client
                .chat(&msgs, agent_model.as_deref(), agent_temperature)
                .await
        }
        "survey" => {
            let prompt = if context_type == "interest" && !prior_context.is_empty() {
                format!(
                    "请基于当前研究工作台共享状态，为用户问题整理结构化综述或相关工作分析。\n\n\
共享状态：\n{}\n\n\
输出要求：\n\
1. 先给出该领域的一句话定义\n\
2. 按方法/技术/理论维度组织分类，每类说明代表工作和核心思想\n\
3. 用表格或列表对比各类方法的优劣（不要用 Markdown 表格语法，用缩进列表）\n\
4. 指出当前主要挑战和研究趋势\n\
5. 给出与用户当前路线最相关的研究方向\n\n\
用户问题：{}",
                    prior_context.join("\n\n"),
                    message,
                )
            } else {
                format!(
                    "请为「{}」领域撰写结构化文献综述。\n\n\
参考材料：{}\n\n\
输出要求：\n\
1. 领域定义\n\
2. 按方法/技术维度分类，说明代表工作\n\
3. 对比分析各类方法的优劣\n\
4. 当前挑战和未来趋势",
                    message,
                    prior_context.join("\n\n")
                )
            };
            let msgs = vec![
                LlmMessage::system(specialist_system(
                    "综述写作步骤",
                    "输出结构化、客观、可用于研究推进的相关工作总结。",
                    Some("不得把未经证实的判断写成事实。对比分析要有实质差异，不要泛泛而谈。"),
                )),
                LlmMessage::user(&prompt),
            ];
            client
                .chat(&msgs, agent_model.as_deref(), agent_temperature)
                .await
        }
        "reproduction" => {
            let text = paper_text(db, context_id).await;
            let preview = truncate_chars_with_ellipsis(&text, 8000);
            let prompt = format!(
                "请给出论文复现/验证指南，并重点回答以下问题：{}\n\n\
论文内容（已截取关键部分）：\n{}\n\n\
输出要求：\n\
1. 先判断这篇论文是否适合工程复现（是/否/部分可复现）并说明理由\n\
2. 如果适合：给出环境配置、数据准备、核心实现步骤、评估方式\n\
3. 如果不适合：给出替代验证方式（理论复核/材料核查/阅读核实）\n\
4. 列出复现的主要风险和难点\n\
5. 不要给大段代码，只给关键命令和最小骨架",
                message, preview
            );
            let msgs = vec![
                LlmMessage::system(specialist_system(
                    "论文复现步骤",
                    "输出可执行、风险明确的复现或验证建议。",
                    Some("不得编造论文中未提供的实验细节。先判断复现可行性再给方案。"),
                )),
                LlmMessage::user(&prompt),
            ];
            client
                .chat(&msgs, agent_model.as_deref(), agent_temperature)
                .await
        }
        _ => Ok(String::new()),
    }
}

async fn retrieval_context(
    client: &LlmClient,
    db: &sqlx::SqlitePool,
    settings: &HashMap<String, String>,
    message: &str,
) -> Result<String> {
    let request_policy = ChatRequestPolicy::from_message(message);
    let embedding = if request_policy.allows_embedding() {
        if let Ok(embed_client) = LlmClient::embed_client_from_settings(settings) {
            match embed_client.embed(&[message.to_string()]).await {
                Ok(embeddings) => embeddings.into_iter().next(),
                Err(error) => {
                    crate::append_diagnostic_log(&format!(
                    "[agent:retrieval] embedding unavailable, fallback to keyword-only retrieval: {error}"
                ));
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    let Some(embedding) = embedding else {
        return retrieval_keyword_guidance(client, message).await;
    };

    let top_k: usize = settings
        .get("multi_agent_search_limit")
        .or_else(|| settings.get("rag_top_k"))
        .and_then(|v| v.parse().ok())
        .unwrap_or(5);

    let graph_context = build_graph_rag_context(db, &embedding, top_k)
        .await
        .unwrap_or_default();
    let retrievals = combined_search(db, &embedding, top_k)
        .await
        .unwrap_or_default();
    let semantic_context = if retrievals.is_empty() {
        String::new()
    } else {
        format!(
            "[语义检索原文]\n{}",
            retrievals
                .iter()
                .map(|item| format!("来源：{}\n内容：{}", item.source, item.content))
                .collect::<Vec<_>>()
                .join("\n\n")
        )
    };

    let merged = [graph_context, semantic_context]
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");

    if merged.trim().is_empty() {
        return retrieval_keyword_guidance(client, message).await;
    }

    Ok(merged)
}

async fn retrieval_keyword_guidance(client: &LlmClient, message: &str) -> Result<String> {
    let prompt = format!(
        "请围绕问题「{}」提炼出最需要检索的证据类型与关键检索词（中英文各一组），不要生成检索结果。",
        message
    );
    let messages = vec![
        LlmMessage::system(specialist_system(
            "检索步骤",
            "补充当前问题最需要的检索方向与关键词。",
            Some("只输出证据类型和关键词，不要输出检索结果。"),
        )),
        LlmMessage::user(prompt),
    ];
    client.chat(&messages, None, 0.2).await
}

async fn paper_text(db: &sqlx::SqlitePool, context_id: &Option<String>) -> String {
    if let Some(pid) = context_id.as_deref() {
        sqlx::query("SELECT full_text FROM papers WHERE id = ?")
            .bind(pid)
            .fetch_optional(db)
            .await
            .ok()
            .flatten()
            .and_then(|r| r.get::<Option<String>, _>("full_text"))
            .unwrap_or_default()
    } else {
        String::new()
    }
}

fn resolve_agent_model_config(
    settings: &HashMap<String, String>,
    agent_name: &str,
    default_model: Option<&str>,
    default_temperature: f32,
) -> (Option<String>, f32) {
    let model = match agent_name {
        "planner" => resolve_model(
            settings,
            &[
                "multi_agent_planner_model",
                "planner_generation_model",
                "planner_analysis_model",
            ],
        ),
        "literature_scout" => resolve_model(
            settings,
            &["multi_agent_literature_scout_model", "survey_planner_model"],
        ),
        "survey" => resolve_model(
            settings,
            &[
                "multi_agent_survey_model",
                "survey_writer_model",
                "survey_planner_model",
            ],
        ),
        "paper_analyst" => resolve_model(
            settings,
            &["multi_agent_paper_analyst_model", "paper_analysis_model"],
        ),
        "reproduction" => resolve_model(
            settings,
            &["multi_agent_reproduction_model", "paper_reproduction_model"],
        ),
        _ => None,
    }
    .or_else(|| default_model.map(|value| value.to_string()));

    let temperature = match agent_name {
        "planner" => resolve_temperature_chain(
            settings,
            &[
                "multi_agent_planner_temperature",
                "planner_generation_temperature",
                "planner_analysis_temperature",
            ],
            default_temperature,
        ),
        "literature_scout" => resolve_temperature_chain(
            settings,
            &[
                "multi_agent_literature_scout_temperature",
                "survey_planner_temperature",
            ],
            default_temperature,
        ),
        "survey" => resolve_temperature_chain(
            settings,
            &[
                "multi_agent_survey_temperature",
                "survey_writer_temperature",
                "survey_planner_temperature",
            ],
            default_temperature,
        ),
        "paper_analyst" => resolve_temperature_chain(
            settings,
            &[
                "multi_agent_paper_analyst_temperature",
                "paper_analysis_temperature",
            ],
            default_temperature,
        ),
        "reproduction" => resolve_temperature_chain(
            settings,
            &[
                "multi_agent_reproduction_temperature",
                "paper_reproduction_temperature",
            ],
            default_temperature,
        ),
        _ => default_temperature,
    };

    (model, temperature)
}

pub fn agent_title(name: &str) -> &str {
    match name {
        "retrieval" => "图谱与语义检索",
        "planner" => "生成研究路径",
        "literature_scout" => "筛选候选论文",
        "survey" => "组织文献综述",
        "paper_analyst" => "解析当前论文",
        "reproduction" => "输出复现建议",
        "synthesis" => "整合最终回答",
        _ => name,
    }
}

pub fn agent_goal(name: &str) -> &str {
    match name {
        "retrieval" => "从知识图谱与语义检索中收集与当前问题直接相关的证据和溯源链",
        "planner" => "围绕用户主题给出系统化学习和研究推进路径",
        "literature_scout" => "快速检索和整理该问题对应的核心论文与线索",
        "survey" => "把检索到的论文整理成结构化领域概览",
        "paper_analyst" => "提炼研究问题、方法、实验与局限",
        "reproduction" => "围绕当前论文给出复现链路和风险提示",
        "synthesis" => "汇总各节点状态并组织为用户可直接使用的答复",
        _ => "处理任务",
    }
}
