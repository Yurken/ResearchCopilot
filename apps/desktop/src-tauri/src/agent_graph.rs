use crate::agent_nodes::{agent_title, execute_agent_node};
use crate::agent_workspace::{
    compute_execution_waves, extract_summary, parse_agent_metadata, worker_dependencies,
    AgentOutput, SharedWorkspace,
};
use crate::assistant_prompts::synthesis_system;
use crate::commands::memory::{
    is_long_term_memory_enabled, record_agent_run_completion_event, record_agent_run_failure_event,
};
use crate::llm::{resolve_model, resolve_temperature, LlmClient, LlmMessage};
use crate::services::agent_event_service::{
    emit_agent_event, AgentEvent, AgentRunEvent, AgentRunEventInput, AgentRunStatus,
};
use crate::services::paper_fact_service::verified_answer_from_worker_output;
use crate::text_utils::truncate_chars_with_ellipsis;
use anyhow::Result;
use futures_util::future::join_all;
use std::collections::{HashMap, HashSet};
use std::time::Instant;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum AgentNode {
    Start,
    Retrieval,
    Planner,
    LiteratureScout,
    Survey,
    PaperAnalyst,
    Reproduction,
    Synthesis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NodeStatus {
    Pending,
    Running,
    Done,
    Failed,
}

#[derive(Debug)]
struct AgentGraphState {
    statuses: HashMap<AgentNode, NodeStatus>,
    selected_agents: Vec<String>,
    context_parts: Vec<String>,
    outputs: HashMap<String, String>,
    failures: Vec<String>,
}

impl AgentGraphState {
    fn new(selected_agents: Vec<String>, context_parts: Vec<String>) -> Self {
        let mut statuses = HashMap::new();
        statuses.insert(AgentNode::Start, NodeStatus::Pending);
        statuses.insert(AgentNode::Synthesis, NodeStatus::Pending);
        for node in [
            AgentNode::Retrieval,
            AgentNode::Planner,
            AgentNode::LiteratureScout,
            AgentNode::Survey,
            AgentNode::PaperAnalyst,
            AgentNode::Reproduction,
        ] {
            statuses.insert(node, NodeStatus::Pending);
        }

        Self {
            statuses,
            selected_agents,
            context_parts,
            outputs: HashMap::new(),
            failures: Vec::new(),
        }
    }

    fn mark(&mut self, node: AgentNode, status: NodeStatus) {
        self.statuses.insert(node, status);
    }

    fn status(&self, node: AgentNode) -> NodeStatus {
        self.statuses
            .get(&node)
            .copied()
            .unwrap_or(NodeStatus::Pending)
    }
}

fn node_from_agent(name: &str) -> Option<AgentNode> {
    match name {
        "retrieval" => Some(AgentNode::Retrieval),
        "planner" => Some(AgentNode::Planner),
        "literature_scout" => Some(AgentNode::LiteratureScout),
        "survey" => Some(AgentNode::Survey),
        "paper_analyst" => Some(AgentNode::PaperAnalyst),
        "reproduction" => Some(AgentNode::Reproduction),
        "synthesis" => Some(AgentNode::Synthesis),
        _ => None,
    }
}

fn agent_from_node(node: AgentNode) -> Option<&'static str> {
    match node {
        AgentNode::Retrieval => Some("retrieval"),
        AgentNode::Planner => Some("planner"),
        AgentNode::LiteratureScout => Some("literature_scout"),
        AgentNode::Survey => Some("survey"),
        AgentNode::PaperAnalyst => Some("paper_analyst"),
        AgentNode::Reproduction => Some("reproduction"),
        AgentNode::Synthesis | AgentNode::Start => None,
    }
}

fn ordered_nodes() -> &'static [AgentNode] {
    &[
        AgentNode::Start,
        AgentNode::Retrieval,
        AgentNode::Planner,
        AgentNode::LiteratureScout,
        AgentNode::Survey,
        AgentNode::PaperAnalyst,
        AgentNode::Reproduction,
        AgentNode::Synthesis,
    ]
}

fn active_nodes(selected_agents: &[String]) -> HashSet<AgentNode> {
    let mut result = HashSet::from([AgentNode::Start, AgentNode::Synthesis]);
    for agent in selected_agents {
        if let Some(node) = node_from_agent(agent) {
            result.insert(node);
        }
    }
    result
}

fn predecessors(node: AgentNode, active: &HashSet<AgentNode>) -> Vec<AgentNode> {
    match node {
        AgentNode::Start => Vec::new(),
        AgentNode::Retrieval => vec![AgentNode::Start],
        AgentNode::Planner
        | AgentNode::LiteratureScout
        | AgentNode::Survey
        | AgentNode::PaperAnalyst
        | AgentNode::Reproduction => {
            if active.contains(&AgentNode::Retrieval) {
                vec![AgentNode::Retrieval]
            } else {
                vec![AgentNode::Start]
            }
        }
        AgentNode::Synthesis => {
            let mut deps = ordered_nodes()
                .iter()
                .copied()
                .filter(|candidate| {
                    *candidate != AgentNode::Start
                        && *candidate != AgentNode::Synthesis
                        && active.contains(candidate)
                })
                .collect::<Vec<_>>();
            if deps.is_empty() {
                deps.push(AgentNode::Start);
            }
            deps
        }
    }
}

fn is_node_ready(node: AgentNode, active: &HashSet<AgentNode>, state: &AgentGraphState) -> bool {
    if !active.contains(&node) || state.status(node) != NodeStatus::Pending {
        return false;
    }
    predecessors(node, active).into_iter().all(|dependency| {
        matches!(
            state.status(dependency),
            NodeStatus::Done | NodeStatus::Failed
        )
    })
}

/// 并行 worker 的返回结果（不共享可变状态，合并阶段串行写入 state/workspace）。
struct WorkerOutput {
    node: AgentNode,
    agent_name: String,
    run_id: String,
    order_index: i64,
    started_at: String,
    result: std::result::Result<String, String>,
    /// 写入 workspace 的结构化输出（合并阶段使用）
    workspace_output: Option<AgentOutput>,
    /// 该 Worker 读取的上游依赖摘要（写入事件）
    input_summary: Option<String>,
    /// 执行耗时
    duration_ms: u64,
}

pub async fn run_agentic_graph(
    app: &tauri::AppHandle,
    db: &sqlx::SqlitePool,
    settings: &HashMap<String, String>,
    client: &LlmClient,
    request_id: &str,
    session_id: &str,
    message: &str,
    context_type: &str,
    context_id: &Option<String>,
    initial_context_parts: Vec<String>,
    history: &[LlmMessage],
    selected_agents: Vec<String>,
    max_steps: usize,
) -> Result<String> {
    let active = active_nodes(&selected_agents);
    let long_term_memory_enabled = is_long_term_memory_enabled(settings);
    let mut state = AgentGraphState::new(selected_agents.clone(), initial_context_parts);
    state.mark(AgentNode::Start, NodeStatus::Done);
    let mut step_count: usize = 0;

    // ── Phase 1: Retrieval（串行） ──────────────────────────────
    if is_node_ready(AgentNode::Retrieval, &active, &state) {
        if step_count >= max_steps {
            return Ok(state
                .context_parts
                .last()
                .cloned()
                .unwrap_or_else(|| "未生成可用回答（已达最大步数限制）。".to_string()));
        }
        step_count += 1;
        execute_serial_worker(
            app,
            db,
            settings,
            client,
            request_id,
            session_id,
            message,
            context_type,
            context_id,
            history,
            &mut state,
            long_term_memory_enabled,
            AgentNode::Retrieval,
        )
        .await?;
    }

    // ── Phase 2: 波次执行独立 worker 节点 ────────────────────────
    let deps_map = worker_dependencies();
    let waves = compute_execution_waves(&selected_agents);
    let mut workspace = SharedWorkspace {
        outputs: HashMap::new(),
        context_parts: state.context_parts.clone(),
    };

    for wave in &waves {
        // 检查步数预算
        let remaining = max_steps.saturating_sub(step_count);
        if remaining == 0 {
            // 标记剩余未执行的节点
            for agent_name in wave {
                if let Some(node) = node_from_agent(agent_name) {
                    state.mark(node, NodeStatus::Failed);
                    state.failures.push(format!(
                        "{agent_name}: skipped (max_steps {max_steps} reached)"
                    ));
                }
            }
            continue;
        }

        // 本波次要执行的节点（截断超出预算的部分）
        let (to_run, to_skip) = if wave.len() <= remaining {
            (wave.as_slice(), &[][..])
        } else {
            wave.split_at(remaining)
        };

        for agent_name in to_skip {
            if let Some(node) = node_from_agent(agent_name) {
                state.mark(node, NodeStatus::Failed);
                state.failures.push(format!(
                    "{agent_name}: skipped (max_steps {max_steps} reached)"
                ));
            }
        }

        if to_run.is_empty() {
            continue;
        }
        step_count += to_run.len();

        // 构建本波次的并行任务
        let futures: Vec<_> = to_run
            .iter()
            .filter_map(|agent_name| {
                let node = node_from_agent(agent_name)?;
                let order_index = selected_agents
                    .iter()
                    .position(|a| a == agent_name)
                    .unwrap_or_default() as i64;

                // 该 Worker 的上游依赖
                let upstream_deps: Vec<String> = deps_map
                    .get(agent_name.as_str())
                    .map(|deps| deps.iter().map(|d| d.to_string()).collect())
                    .unwrap_or_default();

                Some(spawn_worker(
                    app.clone(),
                    db.clone(),
                    settings.clone(),
                    client.clone(),
                    request_id.to_string(),
                    session_id.to_string(),
                    message.to_string(),
                    context_type.to_string(),
                    context_id.clone(),
                    workspace.clone(),
                    upstream_deps,
                    history.to_vec(),
                    long_term_memory_enabled,
                    node,
                    agent_name.clone(),
                    order_index,
                ))
            })
            .collect();

        let outputs: Vec<WorkerOutput> = join_all(futures).await;

        // 串行合并结果（无锁竞争）+ 更新 workspace
        for output in outputs {
            let finished_at = chrono::Utc::now().to_rfc3339();

            // 如果有结构化输出，写入 workspace
            if let Some(agent_output) = &output.workspace_output {
                workspace
                    .outputs
                    .insert(output.agent_name.clone(), agent_output.clone());
                workspace.context_parts.push(format!(
                    "[{}]\n{}",
                    agent_title(&output.agent_name),
                    agent_output.full_content
                ));
                // 同步到 state
                state.context_parts = workspace.context_parts.clone();
                state
                    .outputs
                    .insert(output.agent_name.clone(), agent_output.full_content.clone());
            }

            match &output.result {
                Ok(result) => {
                    if !result.trim().is_empty() && output.workspace_output.is_none() {
                        state
                            .outputs
                            .insert(output.agent_name.clone(), result.clone());
                    }
                    state.mark(output.node, NodeStatus::Done);
                    let _ = sqlx::query(
                        "UPDATE agent_runs SET status = 'done', summary = ?, updated_at = ? WHERE id = ?",
                    )
                    .bind(result)
                    .bind(&finished_at)
                    .bind(&output.run_id)
                    .execute(db)
                    .await;

                    let mut run_event = agent_run_event(AgentRunEventInput {
                        id: &output.run_id,
                        session_id,
                        request_id,
                        agent_name: &output.agent_name,
                        status: AgentRunStatus::Done,
                        order_index: output.order_index,
                        summary: Some(result.clone()),
                        error: None,
                        created_at: &output.started_at,
                        updated_at: &finished_at,
                        duration_ms: Some(output.duration_ms),
                        upstream_agents: output.input_summary.as_ref().map_or_else(
                            Vec::new,
                            |_| {
                                deps_map
                                    .get(output.agent_name.as_str())
                                    .map(|d| d.iter().map(|s| s.to_string()).collect())
                                    .unwrap_or_default()
                            },
                        ),
                    });
                    run_event.output_summary =
                        output.workspace_output.as_ref().map(|o| o.summary.clone());
                    run_event.structured_output = output
                        .workspace_output
                        .as_ref()
                        .map(|o| serde_json::to_value(&o.metadata).unwrap_or_default());

                    let _ = emit_agent_event(
                        app,
                        AgentEvent::RunFinished {
                            request_id: request_id.to_string(),
                            run: run_event,
                        },
                    );
                }
                Err(err_str) => {
                    state
                        .failures
                        .push(format!("{}: {}", output.agent_name, err_str));
                    state.mark(output.node, NodeStatus::Failed);
                    let _ = sqlx::query(
                        "UPDATE agent_runs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
                    )
                    .bind(err_str)
                    .bind(&finished_at)
                    .bind(&output.run_id)
                    .execute(db)
                    .await;
                    let _ = emit_agent_event(
                        app,
                        AgentEvent::RunFinished {
                            request_id: request_id.to_string(),
                            run: agent_run_event(AgentRunEventInput {
                                id: &output.run_id,
                                session_id,
                                request_id,
                                agent_name: &output.agent_name,
                                status: AgentRunStatus::Failed,
                                order_index: output.order_index,
                                summary: None,
                                error: Some(err_str.clone()),
                                created_at: &output.started_at,
                                updated_at: &finished_at,
                                duration_ms: Some(output.duration_ms),
                                upstream_agents: deps_map
                                    .get(output.agent_name.as_str())
                                    .map(|d| d.iter().map(|s| s.to_string()).collect())
                                    .unwrap_or_default(),
                            }),
                        },
                    );
                }
            }
        }
    }

    // ── Phase 3: Synthesis（串行） ──────────────────────────────
    if !is_node_ready(AgentNode::Synthesis, &active, &state) {
        return Ok(state
            .context_parts
            .last()
            .cloned()
            .unwrap_or_else(|| "未生成可用回答。".to_string()));
    }

    if step_count >= max_steps {
        return Ok(state
            .context_parts
            .last()
            .cloned()
            .unwrap_or_else(|| "未生成可用回答（已达最大步数限制）。".to_string()));
    }

    // Synthesis 节点 — 与原逻辑完全一致
    execute_synthesis_node(
        app, db, settings, client, request_id, session_id, message, history, &mut state,
    )
    .await
}

/// 在 `tokio::spawn` 中执行单个 worker（完全独立，不共享可变状态）。
/// Worker 从 SharedWorkspace 读取上游输出，执行后将结构化结果写回。
#[allow(clippy::too_many_arguments)]
fn spawn_worker(
    app: tauri::AppHandle,
    db: sqlx::SqlitePool,
    settings: HashMap<String, String>,
    client: LlmClient,
    request_id: String,
    session_id: String,
    message: String,
    context_type: String,
    context_id: Option<String>,
    workspace: SharedWorkspace,
    upstream_deps: Vec<String>,
    history: Vec<LlmMessage>,
    long_term_memory_enabled: bool,
    node: AgentNode,
    agent_name: String,
    order_index: i64,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = WorkerOutput> + Send>> {
    Box::pin(async move {
        let timer = Instant::now();
        let run_id = Uuid::new_v4().to_string();
        let started_at = chrono::Utc::now().to_rfc3339();

        // 构建 Worker 上下文（基础 context + 上游 Worker 摘要）
        let worker_context = workspace.build_worker_context(&upstream_deps, agent_title);
        let input_summary = if upstream_deps.is_empty() {
            None
        } else {
            Some(
                upstream_deps
                    .iter()
                    .filter_map(|dep| {
                        workspace.outputs.get(dep).map(|o| {
                            format!("{}: {}", dep, truncate_chars_with_ellipsis(&o.summary, 200))
                        })
                    })
                    .collect::<Vec<_>>()
                    .join("; "),
            )
        };

        if let Err(e) = sqlx::query(
            "INSERT INTO agent_runs (id, session_id, request_id, agent_name, step_name, status, order_index, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)",
        )
        .bind(&run_id)
        .bind(&session_id)
        .bind(&request_id)
        .bind(&agent_name)
        .bind(agent_title(&agent_name))
        .bind(order_index)
        .bind(&started_at)
        .bind(&started_at)
        .execute(&db)
        .await
        {
            return WorkerOutput {
                node, agent_name, run_id, order_index, started_at,
                result: Err(e.to_string()),
                workspace_output: None, input_summary, duration_ms: timer.elapsed().as_millis() as u64,
            };
        }

        let _ = emit_agent_event(
            &app,
            AgentEvent::RunStarted {
                request_id: request_id.clone(),
                run: agent_run_event(AgentRunEventInput {
                    id: &run_id,
                    session_id: &session_id,
                    request_id: &request_id,
                    agent_name: &agent_name,
                    status: AgentRunStatus::Running,
                    order_index,
                    summary: None,
                    error: None,
                    created_at: &started_at,
                    updated_at: &started_at,
                    duration_ms: None,
                    upstream_agents: upstream_deps.clone(),
                }),
            },
        );

        let result = execute_agent_node(
            &client,
            &db,
            &settings,
            &agent_name,
            &message,
            &context_type,
            &context_id,
            &worker_context,
            &history,
        )
        .await;

        let duration_ms = timer.elapsed().as_millis() as u64;

        if long_term_memory_enabled {
            match &result {
                Ok(output) => {
                    let _ = record_agent_run_completion_event(
                        &db,
                        &session_id,
                        &run_id,
                        &agent_name,
                        agent_title(&agent_name),
                        output,
                    )
                    .await;
                }
                Err(e) => {
                    let _ = record_agent_run_failure_event(
                        &db,
                        &session_id,
                        &run_id,
                        &agent_name,
                        agent_title(&agent_name),
                        &e.to_string(),
                    )
                    .await;
                }
            }
        }

        // 解析结构化输出，构建 AgentOutput 写入 workspace
        let workspace_output = result.as_ref().ok().map(|content| AgentOutput {
            agent_name: agent_name.clone(),
            summary: extract_summary(content),
            full_content: content.clone(),
            metadata: parse_agent_metadata(&agent_name, content),
            created_at: started_at.clone(),
            duration_ms,
        });

        WorkerOutput {
            node,
            agent_name,
            run_id,
            order_index,
            started_at,
            result: result.map_err(|e| e.to_string()),
            workspace_output,
            input_summary,
            duration_ms,
        }
    })
}

/// 串行执行单个 worker（用于 Retrieval 等必须串行的节点）。
#[allow(clippy::too_many_arguments)]
async fn execute_serial_worker(
    app: &tauri::AppHandle,
    db: &sqlx::SqlitePool,
    settings: &HashMap<String, String>,
    client: &LlmClient,
    request_id: &str,
    session_id: &str,
    message: &str,
    context_type: &str,
    context_id: &Option<String>,
    history: &[LlmMessage],
    state: &mut AgentGraphState,
    long_term_memory_enabled: bool,
    node: AgentNode,
) -> Result<()> {
    let Some(agent_name) = agent_from_node(node) else {
        return Ok(());
    };
    let timer = Instant::now();

    state.mark(node, NodeStatus::Running);
    let order_index = state
        .selected_agents
        .iter()
        .position(|a| a == agent_name)
        .unwrap_or_default() as i64;
    let run_id = Uuid::new_v4().to_string();
    let started_at = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO agent_runs (id, session_id, request_id, agent_name, step_name, status, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)",
    )
    .bind(&run_id).bind(session_id).bind(request_id)
    .bind(agent_name).bind(agent_title(agent_name))
    .bind(order_index).bind(&started_at).bind(&started_at)
    .execute(db).await?;

    let _ = emit_agent_event(
        app,
        AgentEvent::RunStarted {
            request_id: request_id.to_string(),
            run: agent_run_event(AgentRunEventInput {
                id: &run_id,
                session_id,
                request_id,
                agent_name,
                status: AgentRunStatus::Running,
                order_index,
                summary: None,
                error: None,
                created_at: &started_at,
                updated_at: &started_at,
                duration_ms: None,
                upstream_agents: Vec::new(),
            }),
        },
    );

    let output = execute_agent_node(
        client,
        db,
        settings,
        agent_name,
        message,
        context_type,
        context_id,
        &state.context_parts,
        history,
    )
    .await;

    let duration_ms = timer.elapsed().as_millis() as u64;
    let finished_at = chrono::Utc::now().to_rfc3339();
    match output {
        Ok(result) => {
            if !result.trim().is_empty() {
                state.outputs.insert(agent_name.to_string(), result.clone());
                state
                    .context_parts
                    .push(format!("[{}]\n{}", agent_title(agent_name), result));
            }
            state.mark(node, NodeStatus::Done);
            sqlx::query(
                "UPDATE agent_runs SET status = 'done', summary = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&result)
            .bind(&finished_at)
            .bind(&run_id)
            .execute(db)
            .await?;
            if long_term_memory_enabled {
                let _ = record_agent_run_completion_event(
                    db,
                    session_id,
                    &run_id,
                    agent_name,
                    agent_title(agent_name),
                    &result,
                )
                .await;
            }
            let _ = emit_agent_event(
                app,
                AgentEvent::RunFinished {
                    request_id: request_id.to_string(),
                    run: agent_run_event(AgentRunEventInput {
                        id: &run_id,
                        session_id,
                        request_id,
                        agent_name,
                        status: AgentRunStatus::Done,
                        order_index,
                        summary: Some(result),
                        error: None,
                        created_at: &started_at,
                        updated_at: &finished_at,
                        duration_ms: Some(duration_ms),
                        upstream_agents: Vec::new(),
                    }),
                },
            );
        }
        Err(error) => {
            let err_str = error.to_string();
            state.failures.push(format!("{}: {}", agent_name, err_str));
            state.mark(node, NodeStatus::Failed);
            sqlx::query(
                "UPDATE agent_runs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&err_str)
            .bind(&finished_at)
            .bind(&run_id)
            .execute(db)
            .await?;
            if long_term_memory_enabled {
                let _ = record_agent_run_failure_event(
                    db,
                    session_id,
                    &run_id,
                    agent_name,
                    agent_title(agent_name),
                    &err_str,
                )
                .await;
            }
            let _ = emit_agent_event(
                app,
                AgentEvent::RunFinished {
                    request_id: request_id.to_string(),
                    run: agent_run_event(AgentRunEventInput {
                        id: &run_id,
                        session_id,
                        request_id,
                        agent_name,
                        status: AgentRunStatus::Failed,
                        order_index,
                        summary: None,
                        error: Some(err_str),
                        created_at: &started_at,
                        updated_at: &finished_at,
                        duration_ms: Some(duration_ms),
                        upstream_agents: Vec::new(),
                    }),
                },
            );
        }
    }
    Ok(())
}

/// 执行 Synthesis 节点（流式输出，原逻辑不变）。
async fn execute_synthesis_node(
    app: &tauri::AppHandle,
    db: &sqlx::SqlitePool,
    settings: &HashMap<String, String>,
    client: &LlmClient,
    request_id: &str,
    session_id: &str,
    message: &str,
    history: &[LlmMessage],
    state: &mut AgentGraphState,
) -> Result<String> {
    state.mark(AgentNode::Synthesis, NodeStatus::Running);
    let run_id = Uuid::new_v4().to_string();
    let started_at = chrono::Utc::now().to_rfc3339();
    let order_index = state
        .selected_agents
        .iter()
        .position(|item| item == "synthesis")
        .unwrap_or(state.selected_agents.len()) as i64;

    sqlx::query(
        "INSERT INTO agent_runs (id, session_id, request_id, agent_name, step_name, status, order_index, created_at, updated_at)
         VALUES (?, ?, ?, 'synthesis', ?, 'running', ?, ?, ?)",
    )
    .bind(&run_id).bind(session_id).bind(request_id)
    .bind(agent_title("synthesis")).bind(order_index)
    .bind(&started_at).bind(&started_at)
    .execute(db).await?;

    let _ = emit_agent_event(
        app,
        AgentEvent::RunStarted {
            request_id: request_id.to_string(),
            run: agent_run_event(AgentRunEventInput {
                id: &run_id,
                session_id,
                request_id,
                agent_name: "synthesis",
                status: AgentRunStatus::Running,
                order_index,
                summary: None,
                error: None,
                created_at: &started_at,
                updated_at: &started_at,
                duration_ms: None,
                upstream_agents: Vec::new(),
            }),
        },
    );

    let synthesis_temp = resolve_temperature(settings, "multi_agent_synthesis_temperature", 0.4);
    let synthesis_model = resolve_model(settings, &["multi_agent_synthesis_model"]);
    let ctx = state.context_parts.join("\n\n---\n\n");
    let synthesis_prompt = if ctx.is_empty() {
        message.to_string()
    } else {
        format!(
            "以下是状态图中各节点累积出的上下文状态：\n\n{}\n\n---\n\n请综合上述内容，给出针对问题「{}」的完整、结构化回答。",
            ctx, message
        )
    };

    let mut synthesis_msgs = vec![LlmMessage::system(synthesis_system())];
    synthesis_msgs.extend_from_slice(history);
    synthesis_msgs.push(LlmMessage::user(&synthesis_prompt));

    let verified_answer = state
        .outputs
        .get("paper_analyst")
        .and_then(|output| verified_answer_from_worker_output(output));
    let result = if let Some(answer) = verified_answer {
        let _ = emit_agent_event(
            app,
            AgentEvent::TextDelta {
                request_id: request_id.to_string(),
                delta: answer.clone(),
            },
        );
        Ok(answer)
    } else {
        let rid = request_id.to_string();
        let app_clone = app.clone();
        client
            .stream_chat(
                &synthesis_msgs,
                synthesis_model.as_deref(),
                synthesis_temp,
                move |delta| {
                    let _ = emit_agent_event(
                        &app_clone,
                        AgentEvent::TextDelta {
                            request_id: rid.clone(),
                            delta,
                        },
                    );
                },
            )
            .await
    };

    let finished_at = chrono::Utc::now().to_rfc3339();
    match result {
        Ok(output) => {
            state.mark(AgentNode::Synthesis, NodeStatus::Done);
            sqlx::query(
                "UPDATE agent_runs SET status = 'done', summary = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&output)
            .bind(&finished_at)
            .bind(&run_id)
            .execute(db)
            .await?;
            let _ = emit_agent_event(
                app,
                AgentEvent::RunFinished {
                    request_id: request_id.to_string(),
                    run: agent_run_event(AgentRunEventInput {
                        id: &run_id,
                        session_id,
                        request_id,
                        agent_name: "synthesis",
                        status: AgentRunStatus::Done,
                        order_index,
                        summary: Some(output.clone()),
                        error: None,
                        created_at: &started_at,
                        updated_at: &finished_at,
                        duration_ms: None,
                        upstream_agents: Vec::new(),
                    }),
                },
            );
            Ok(output)
        }
        Err(error) => {
            state.mark(AgentNode::Synthesis, NodeStatus::Failed);
            let err_str = error.to_string();
            sqlx::query(
                "UPDATE agent_runs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&err_str)
            .bind(&finished_at)
            .bind(&run_id)
            .execute(db)
            .await?;
            let _ = emit_agent_event(
                app,
                AgentEvent::RunFinished {
                    request_id: request_id.to_string(),
                    run: agent_run_event(AgentRunEventInput {
                        id: &run_id,
                        session_id,
                        request_id,
                        agent_name: "synthesis",
                        status: AgentRunStatus::Failed,
                        order_index,
                        summary: None,
                        error: Some(err_str),
                        created_at: &started_at,
                        updated_at: &finished_at,
                        duration_ms: None,
                        upstream_agents: Vec::new(),
                    }),
                },
            );
            Err(error)
        }
    }
}

fn agent_run_event(input: AgentRunEventInput<'_>) -> AgentRunEvent {
    AgentRunEvent::from_input(input)
}

#[cfg(test)]
mod tests {
    use super::{
        active_nodes, is_node_ready, predecessors, AgentGraphState, AgentNode, NodeStatus,
    };

    #[test]
    fn synthesis_waits_for_all_active_workers() {
        let active = active_nodes(&[
            "retrieval".to_string(),
            "planner".to_string(),
            "survey".to_string(),
            "synthesis".to_string(),
        ]);
        let mut state = AgentGraphState::new(
            vec![
                "retrieval".to_string(),
                "planner".to_string(),
                "survey".to_string(),
                "synthesis".to_string(),
            ],
            Vec::new(),
        );
        state.mark(AgentNode::Start, NodeStatus::Done);
        state.mark(AgentNode::Retrieval, NodeStatus::Done);
        state.mark(AgentNode::Planner, NodeStatus::Done);
        assert!(!is_node_ready(AgentNode::Synthesis, &active, &state));
        state.mark(AgentNode::Survey, NodeStatus::Done);
        assert!(is_node_ready(AgentNode::Synthesis, &active, &state));
    }

    #[test]
    fn workers_depend_on_retrieval_when_present() {
        let active = active_nodes(&["retrieval".to_string(), "planner".to_string()]);
        assert_eq!(
            predecessors(AgentNode::Planner, &active),
            vec![AgentNode::Retrieval]
        );
    }
}
