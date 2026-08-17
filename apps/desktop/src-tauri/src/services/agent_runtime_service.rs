use crate::agent_graph::run_agentic_graph;
use crate::agent_workspace::compute_execution_waves;
use crate::llm::{LlmClient, LlmMessage};
use crate::services::agent_context_service::{build_agent_context, AgentContextRequest};
use crate::services::agent_event_service::{emit_agent_event, AgentEvent, AgentPlanStep};
use crate::services::agent_routing_service::{select_agents, RoutingPolicy};
use crate::services::paper_fact_service::is_supported_paper_fact_question;
use anyhow::Result;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentRuntimeKind {
    XiaoyanNative,
}

impl AgentRuntimeKind {
    pub fn from_settings(_settings: &HashMap<String, String>) -> Self {
        Self::XiaoyanNative
    }
}

pub struct AgentRuntimeRequest<'a> {
    pub app: &'a tauri::AppHandle,
    pub db: &'a sqlx::SqlitePool,
    pub settings: &'a HashMap<String, String>,
    pub client: &'a LlmClient,
    pub request_id: &'a str,
    pub session_id: &'a str,
    pub message: &'a str,
    pub context_type: &'a str,
    pub context_id: &'a Option<String>,
    pub context_summary: &'a str,
    pub history: &'a [LlmMessage],
}

pub struct AgentRuntimeResult {
    pub answer: String,
    pub runtime: AgentRuntimeKind,
}

pub async fn run_agent_runtime(
    kind: AgentRuntimeKind,
    request: AgentRuntimeRequest<'_>,
) -> Result<AgentRuntimeResult> {
    match kind {
        AgentRuntimeKind::XiaoyanNative => run_xiaoyan_native_runtime(request).await,
    }
}

async fn run_xiaoyan_native_runtime(
    request: AgentRuntimeRequest<'_>,
) -> Result<AgentRuntimeResult> {
    let enabled = enabled_agents(request.settings);
    let max_steps = max_agent_steps(request.settings);
    let routing_policy = RoutingPolicy::from_settings(request.settings);
    let routing_result = select_agents(
        request.client,
        request.settings,
        request.message,
        request.context_type,
        &enabled,
        max_steps,
        routing_policy,
    )
    .await;
    let selected = routing_result.agents;
    let execution_max_steps = if request.context_type == "paper"
        && is_supported_paper_fact_question(request.message)
        && selected.iter().any(|agent| agent == "paper_analyst")
    {
        max_steps.max(2)
    } else {
        max_steps
    };
    let agent_context = build_agent_context(AgentContextRequest {
        context_type: request.context_type,
        context_id: request.context_id,
        context_summary: request.context_summary,
        selected_agents: &selected,
    });
    let _registered_tool_count = agent_context.tools.len();

    let plan = selected
        .iter()
        .map(|agent| AgentPlanStep::from_agent_name(agent))
        .collect();
    let _ = emit_agent_event(
        request.app,
        AgentEvent::Plan {
            request_id: request.request_id.to_string(),
            plan,
        },
    );

    // 计算执行波次并发送路由决策事件
    let execution_waves = compute_execution_waves(&selected);
    let _ = emit_agent_event(
        request.app,
        AgentEvent::RoutingDecision {
            request_id: request.request_id.to_string(),
            policy: format!("{routing_policy:?}").to_lowercase(),
            selected: selected.clone(),
            reasoning: routing_result.reasoning,
            execution_waves,
        },
    );

    let answer = run_agentic_graph(
        request.app,
        request.db,
        request.settings,
        request.client,
        request.request_id,
        request.session_id,
        request.message,
        request.context_type,
        request.context_id,
        agent_context.parts,
        request.history,
        selected,
        execution_max_steps,
    )
    .await?;

    Ok(AgentRuntimeResult {
        answer,
        runtime: AgentRuntimeKind::XiaoyanNative,
    })
}

fn enabled_agents(settings: &HashMap<String, String>) -> Vec<String> {
    settings
        .get("multi_agent_enabled_agents")
        .map(|value| value.as_str())
        .unwrap_or("retrieval,synthesis")
        .split(',')
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn max_agent_steps(settings: &HashMap<String, String>) -> usize {
    settings
        .get("multi_agent_max_steps")
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .unwrap_or(6)
}
