use crate::agent_nodes::{agent_goal, agent_title};
use crate::state::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
pub struct AgentPlanStep {
    pub agent_name: String,
    pub title: String,
    pub goal: String,
}

impl AgentPlanStep {
    pub fn from_agent_name(agent_name: &str) -> Self {
        Self {
            agent_name: agent_name.to_string(),
            title: agent_title(agent_name).to_string(),
            goal: agent_goal(agent_name).to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunStatus {
    Running,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentRunEvent {
    pub id: String,
    pub session_id: String,
    pub request_id: String,
    pub parent_run_id: Option<String>,
    pub agent_name: String,
    pub step_name: String,
    pub status: AgentRunStatus,
    pub order_index: i64,
    pub input_payload: Option<Value>,
    pub output_payload: Option<Value>,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub artifacts: Vec<Value>,
    /// 该 Worker 读取的上游 Agent 输出摘要
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_summary: Option<String>,
    /// 该 Worker 产出的结构化摘要
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_summary: Option<String>,
    /// 执行耗时（毫秒）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// 该 Worker 依赖的上游 Agent 名称列表
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub upstream_agents: Vec<String>,
    /// 结构化输出（JSON）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured_output: Option<Value>,
}

pub struct AgentRunEventInput<'a> {
    pub id: &'a str,
    pub session_id: &'a str,
    pub request_id: &'a str,
    pub agent_name: &'a str,
    pub status: AgentRunStatus,
    pub order_index: i64,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub created_at: &'a str,
    pub updated_at: &'a str,
    /// 新增：执行耗时
    pub duration_ms: Option<u64>,
    /// 新增：上游依赖 Agent 列表
    pub upstream_agents: Vec<String>,
}

impl AgentRunEvent {
    pub fn from_input(input: AgentRunEventInput<'_>) -> Self {
        Self {
            id: input.id.to_string(),
            session_id: input.session_id.to_string(),
            request_id: input.request_id.to_string(),
            parent_run_id: None,
            agent_name: input.agent_name.to_string(),
            step_name: agent_title(input.agent_name).to_string(),
            status: input.status,
            order_index: input.order_index,
            input_payload: None,
            output_payload: None,
            summary: input.summary,
            error: input.error,
            created_at: input.created_at.to_string(),
            updated_at: input.updated_at.to_string(),
            artifacts: Vec::new(),
            input_summary: None,
            output_summary: None,
            duration_ms: input.duration_ms,
            upstream_agents: input.upstream_agents,
            structured_output: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub enum AgentEvent {
    Plan {
        request_id: String,
        plan: Vec<AgentPlanStep>,
    },
    RunStarted {
        request_id: String,
        run: AgentRunEvent,
    },
    RunFinished {
        request_id: String,
        run: AgentRunEvent,
    },
    TextDelta {
        request_id: String,
        delta: String,
    },
    /// 路由决策完成 — 告知前端选择了哪些 Agent、为什么、按什么波次执行
    RoutingDecision {
        request_id: String,
        policy: String,
        selected: Vec<String>,
        reasoning: Option<String>,
        execution_waves: Vec<Vec<String>>,
    },
}

pub fn emit_agent_event(app: &tauri::AppHandle, event: AgentEvent) -> tauri::Result<()> {
    emit_unified_agent_event(app, &event)?;

    match event {
        AgentEvent::Plan { request_id, plan } => app.emit(
            "chat:plan",
            json!({ "request_id": request_id, "plan": plan }),
        ),
        AgentEvent::RunStarted { request_id, run } => app.emit(
            "chat:agent_start",
            json!({ "request_id": request_id, "value": run }),
        ),
        AgentEvent::RunFinished { request_id, run } => app.emit(
            "chat:agent_complete",
            json!({ "request_id": request_id, "value": run }),
        ),
        AgentEvent::TextDelta { request_id, delta } => {
            // 同步累计部分内容到流元数据，用户取消或任务失败时据此补写部分回答。
            if let Some(state) = app.try_state::<AppState>() {
                state.record_chat_delta(&request_id, &delta);
            }
            app.emit(
                "chat:delta",
                json!({ "request_id": request_id, "delta": delta }),
            )
        }
        AgentEvent::RoutingDecision {
            request_id,
            policy,
            selected,
            reasoning,
            execution_waves,
        } => app.emit(
            "chat:routing_decision",
            json!({
                "request_id": request_id,
                "policy": policy,
                "selected": selected,
                "reasoning": reasoning,
                "execution_waves": execution_waves,
            }),
        ),
    }
}

fn emit_unified_agent_event(app: &tauri::AppHandle, event: &AgentEvent) -> tauri::Result<()> {
    match event {
        AgentEvent::Plan { request_id, plan } => app.emit(
            "chat:agent_event",
            json!({ "request_id": request_id, "kind": "plan", "payload": { "plan": plan } }),
        ),
        AgentEvent::RunStarted { request_id, run } => app.emit(
            "chat:agent_event",
            json!({ "request_id": request_id, "kind": "run_started", "payload": { "run": run } }),
        ),
        AgentEvent::RunFinished { request_id, run } => app.emit(
            "chat:agent_event",
            json!({ "request_id": request_id, "kind": "run_finished", "payload": { "run": run } }),
        ),
        AgentEvent::TextDelta { request_id, delta } => app.emit(
            "chat:agent_event",
            json!({ "request_id": request_id, "kind": "text_delta", "payload": { "delta": delta } }),
        ),
        AgentEvent::RoutingDecision {
            request_id,
            policy,
            selected,
            reasoning,
            execution_waves,
        } => app.emit(
            "chat:agent_event",
            json!({
                "request_id": request_id,
                "kind": "routing_decision",
                "payload": {
                    "policy": policy,
                    "selected": selected,
                    "reasoning": reasoning,
                    "execution_waves": execution_waves,
                }
            }),
        ),
    }
}
