//! 代码功能后端 —— 小妍原生代码助手。
//!
//! 不再调用用户本机安装的各类 code CLI，而是直接复用小妍设置里配置好的 LLM，
//! 在工作目录上下文中与用户进行代码对话，并通过受限本地工具读取、修改文件与执行命令。

pub mod context;
pub mod git;
mod prompt;
pub mod store;
pub mod tools;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::{collections::HashMap, sync::Arc, time::Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

use crate::llm::{
    resolve_model, resolve_temperature_chain, LlmClient, LlmMessage, StreamOutcome, ToolCall,
};
use prompt::{build_code_system_prompt, build_title_prompt};

use store::now;

// ── 领域类型 ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSession {
    pub id: String,
    pub experiment_id: String,
    pub title: String,
    pub working_dir: Option<String>,
    /// 历史字段，保留以兼容旧数据，不再写入新值。
    pub tool_id: Option<String>,
    /// 历史字段，保留以兼容旧数据，不再写入新值。
    pub model: Option<String>,
    pub messages: Vec<CodeMessage>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeToolResult {
    pub tool_call_id: String,
    pub name: String,
    pub output: String,
    #[serde(default)]
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<CodeToolCall>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_results: Option<Vec<CodeToolResult>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// 历史字段，保留以兼容旧数据。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodePermissionDecision {
    pub approved: bool,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CodePermissionRequestEvent {
    pub id: String,
    pub session_id: String,
    pub request_id: String,
    pub tool_call: CodeToolCall,
    pub title: String,
    pub summary: String,
    pub risk_level: String,
    pub preview: String,
}

// ── 事件载荷 ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
struct StreamEvent {
    session_id: String,
    request_id: String,
    chunk: String,
}

#[derive(Debug, Clone, Serialize)]
struct DoneEvent {
    session_id: String,
    request_id: String,
    message_id: String,
    full_content: String,
    duration_ms: u64,
    model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ErrorEvent {
    session_id: String,
    request_id: String,
    error: String,
}

#[derive(Debug, Clone, Serialize)]
struct ToolCallEvent {
    session_id: String,
    request_id: String,
    message_id: String,
    tool_call: CodeToolCall,
}

#[derive(Debug, Clone, Serialize)]
struct ToolResultEvent {
    session_id: String,
    request_id: String,
    message_id: String,
    result: CodeToolResult,
}

// ── 核心：发送一轮消息并流式返回 ──────────────────────────────

/// 使用小妍设置中的 LLM 在 `working_dir` 上下文中执行一轮代码对话。
/// fire-and-forget，结果通过 `code:stream` / `code:done` / `code:error` 事件回传。
pub async fn send_message_stream(
    app: AppHandle,
    db: SqlitePool,
    settings: HashMap<String, String>,
    session_id: String,
    display_content: String,
    prompt_content: String,
    working_dir: Option<String>,
    current_file: Option<String>,
    mode: Option<String>,
    permissions: Arc<Mutex<HashMap<String, oneshot::Sender<CodePermissionDecision>>>>,
    request_id: &str,
    user_message_id: Option<String>,
) {
    let task_started_at = Instant::now();
    let request_id = request_id.to_string();
    let working_dir = working_dir.and_then(|dir| {
        let trimmed = dir.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    // 1. 落盘用户消息
    let user_msg = CodeMessage {
        id: user_message_id.unwrap_or_else(|| Uuid::new_v4().to_string()),
        role: "user".to_string(),
        content: display_content.clone(),
        tool_calls: None,
        tool_results: None,
        tool_call_id: None,
        tool_id: None,
        model: None,
        duration_ms: None,
        created_at: now(),
    };
    if let Err(e) = store::persist_message(&db, &session_id, &user_msg).await {
        crate::append_diagnostic_log(&format!("code: persist user msg error: {e}"));
    }

    // 2. 构建 LLM 客户端
    let client = match LlmClient::from_settings(&settings) {
        Ok(c) => c,
        Err(e) => {
            emit_error(&app, &session_id, &request_id, format!("LLM 配置错误：{e}"));
            return;
        }
    };
    let model = resolve_model(
        &settings,
        &[
            "code_assistant_model",
            "copilot_simple_model",
            "paper_analysis_model",
        ],
    );
    let temperature = resolve_temperature_chain(
        &settings,
        &["code_assistant_temperature", "copilot_simple_temperature"],
        0.3,
    );

    // 3. 组装消息上下文
    let session = match store::get_session(&db, &session_id).await {
        Ok(s) => s,
        Err(e) => {
            emit_error(&app, &session_id, &request_id, format!("读取会话失败：{e}"));
            return;
        }
    };

    let mode_str = mode.as_deref().unwrap_or("build");
    let workspace_context = match working_dir.as_deref() {
        Some(dir) => context::build_system_context(dir).await,
        None => String::new(),
    };
    let system_prompt = build_code_system_prompt(
        working_dir.as_deref(),
        current_file.as_deref(),
        mode_str,
        &workspace_context,
    );
    let mut messages = vec![LlmMessage::system(system_prompt)];

    // 只保留最近若干轮对话作为上下文，避免 token 爆炸。
    const MAX_CONTEXT_MESSAGES: usize = 20;
    let history_start = session.messages.len().saturating_sub(MAX_CONTEXT_MESSAGES);
    for msg in &session.messages[history_start..] {
        if msg.id == user_msg.id {
            messages.push(LlmMessage::user(prompt_content.clone()));
        } else {
            push_code_message_as_llm(&mut messages, msg);
        }
    }

    // 4. Agent 工具循环：模型请求工具 -> 后端执行 -> 工具结果回填 -> 继续生成。
    let tool_definitions = if working_dir.is_some() {
        tools::code_tool_definitions_for_mode(mode_str)
    } else if mode_str == "scout" {
        tools::web_tool_definitions()
    } else {
        Vec::new()
    };
    let max_tool_rounds: usize = settings
        .get("code_tool_max_rounds")
        .and_then(|v| v.parse().ok())
        .unwrap_or(8);
    let mut tool_rounds = 0usize;

    loop {
        let app_for_delta = app.clone();
        let sid_for_delta = session_id.clone();
        let rid_for_delta = request_id.clone();

        let outcome = if tool_definitions.is_empty() || tool_rounds >= max_tool_rounds {
            client
                .stream_chat(&messages, model.as_deref(), temperature, move |delta| {
                    emit_stream_delta(&app_for_delta, &sid_for_delta, &rid_for_delta, delta);
                })
                .await
                .map(StreamOutcome::TextCompleted)
        } else {
            client
                .stream_chat_with_tools(
                    &messages,
                    &tool_definitions,
                    model.as_deref(),
                    temperature,
                    move |delta| {
                        emit_stream_delta(&app_for_delta, &sid_for_delta, &rid_for_delta, delta);
                    },
                )
                .await
        };

        match outcome {
            Ok(StreamOutcome::TextCompleted(full)) => {
                if full.trim().is_empty() {
                    emit_error(
                        &app,
                        &session_id,
                        &request_id,
                        "模型未返回任何内容。请检查当前代码模型是否支持流式输出或工具调用。".into(),
                    );
                    return;
                }

                let assistant_msg = CodeMessage {
                    id: Uuid::new_v4().to_string(),
                    role: "assistant".to_string(),
                    content: full.clone(),
                    tool_calls: None,
                    tool_results: None,
                    tool_call_id: None,
                    tool_id: None,
                    model: model.clone(),
                    duration_ms: Some(elapsed_millis(task_started_at)),
                    created_at: now(),
                };
                let _ = store::persist_message(&db, &session_id, &assistant_msg).await;
                let _ = app.emit(
                    "code:done",
                    DoneEvent {
                        session_id: session_id.clone(),
                        request_id,
                        message_id: assistant_msg.id.clone(),
                        full_content: full,
                        duration_ms: assistant_msg.duration_ms.unwrap_or_default(),
                        model: assistant_msg.model.clone(),
                    },
                );

                // 首次用户消息+AI回复 → 异步生成标题
                if is_first_exchange(&session) {
                    let db2 = db.clone();
                    let settings2 = settings.clone();
                    let sid2 = session_id.clone();
                    let app2 = app.clone();
                    let title_content =
                        build_title_prompt(&user_msg.content, &assistant_msg.content);
                    tokio::spawn(async move {
                        auto_generate_title(db2, settings2, sid2.clone(), title_content).await;
                        let _ = app2.emit(
                            "code:title_changed",
                            serde_json::json!({ "session_id": sid2 }),
                        );
                    });
                }

                return;
            }
            Ok(StreamOutcome::ToolCalls(tool_calls)) => {
                tool_rounds += 1;
                let tool_message_id = Uuid::new_v4().to_string();
                let code_tool_calls: Vec<CodeToolCall> =
                    tool_calls.iter().map(tools::to_code_tool_call).collect();
                let tool_call_msg = CodeMessage {
                    id: tool_message_id.clone(),
                    role: "assistant".to_string(),
                    content: String::new(),
                    tool_calls: Some(code_tool_calls.clone()),
                    tool_results: None,
                    tool_call_id: None,
                    tool_id: None,
                    model: model.clone(),
                    duration_ms: None,
                    created_at: now(),
                };
                let _ = store::persist_message(&db, &session_id, &tool_call_msg).await;
                messages.push(LlmMessage::assistant_with_tool_calls(tool_calls.clone()));

                for tool_call in code_tool_calls {
                    let _ = app.emit(
                        "code:tool_call",
                        ToolCallEvent {
                            session_id: session_id.clone(),
                            request_id: request_id.clone(),
                            message_id: tool_message_id.clone(),
                            tool_call,
                        },
                    );
                }

                for tc in &tool_calls {
                    let result = execute_code_tool(
                        &app,
                        &session_id,
                        &request_id,
                        tc,
                        working_dir.as_deref(),
                        permissions.clone(),
                    )
                    .await;
                    let tool_msg = CodeMessage {
                        id: Uuid::new_v4().to_string(),
                        role: "tool".to_string(),
                        content: result.output.clone(),
                        tool_calls: None,
                        tool_results: Some(vec![result.clone()]),
                        tool_call_id: Some(result.tool_call_id.clone()),
                        tool_id: None,
                        model: None,
                        duration_ms: None,
                        created_at: now(),
                    };
                    let _ = store::persist_message(&db, &session_id, &tool_msg).await;
                    let _ = app.emit(
                        "code:tool_result",
                        ToolResultEvent {
                            session_id: session_id.clone(),
                            request_id: request_id.clone(),
                            message_id: tool_msg.id.clone(),
                            result: result.clone(),
                        },
                    );
                    messages.push(LlmMessage::tool(&tc.id, result.output));
                }

                if tool_rounds >= max_tool_rounds {
                    messages.push(LlmMessage::user(
                        "已达到工具调用次数上限，请基于已有信息给出当前最佳回答，不要再调用工具。",
                    ));
                }
            }
            Err(e) => {
                emit_error(&app, &session_id, &request_id, format!("LLM 调用失败：{e}"));
                return;
            }
        }
    }
}

fn elapsed_millis(started_at: Instant) -> u64 {
    started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

fn emit_stream_delta(app: &AppHandle, session_id: &str, request_id: &str, chunk: String) {
    let _ = app.emit(
        "code:stream",
        StreamEvent {
            session_id: session_id.to_string(),
            request_id: request_id.to_string(),
            chunk,
        },
    );
}

fn emit_error(app: &AppHandle, session_id: &str, request_id: &str, error: String) {
    let _ = app.emit(
        "code:error",
        ErrorEvent {
            session_id: session_id.to_string(),
            request_id: request_id.to_string(),
            error,
        },
    );
}

fn push_code_message_as_llm(messages: &mut Vec<LlmMessage>, msg: &CodeMessage) {
    match msg.role.as_str() {
        "user" => messages.push(LlmMessage::user(msg.content.clone())),
        "assistant" => {
            if let Some(tool_calls) = &msg.tool_calls {
                messages.push(LlmMessage {
                    role: "assistant".into(),
                    content: msg.content.clone(),
                    tool_call_id: None,
                    tool_calls: Some(
                        tool_calls
                            .iter()
                            .map(|tc| ToolCall {
                                id: tc.id.clone(),
                                name: tc.name.clone(),
                                arguments: tc.arguments.clone(),
                            })
                            .collect(),
                    ),
                    images: Vec::new(),
                });
            } else {
                messages.push(LlmMessage::assistant(msg.content.clone()));
            }
        }
        "tool" => {
            if let Some(tool_call_id) = &msg.tool_call_id {
                messages.push(LlmMessage::tool(tool_call_id, msg.content.clone()));
            }
        }
        _ => {}
    }
}

async fn execute_code_tool(
    app: &AppHandle,
    session_id: &str,
    request_id: &str,
    tc: &ToolCall,
    working_dir: Option<&str>,
    permissions: Arc<Mutex<HashMap<String, oneshot::Sender<CodePermissionDecision>>>>,
) -> CodeToolResult {
    if tools::requires_permission(&tc.name) {
        match ask_tool_permission(app, session_id, request_id, tc, working_dir, permissions).await {
            Ok(decision) if decision.approved => {}
            Ok(decision) => {
                let message = decision
                    .message
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "用户拒绝了该工具调用。".to_string());
                return CodeToolResult {
                    tool_call_id: tc.id.clone(),
                    name: tc.name.clone(),
                    output: message,
                    is_error: true,
                };
            }
            Err(err) => {
                return CodeToolResult {
                    tool_call_id: tc.id.clone(),
                    name: tc.name.clone(),
                    output: format!("工具审批失败：{err}"),
                    is_error: true,
                };
            }
        }
    }

    match tools::dispatch_tool(&tc.name, &tc.arguments, working_dir).await {
        Ok(output) => CodeToolResult {
            tool_call_id: tc.id.clone(),
            name: tc.name.clone(),
            output,
            is_error: false,
        },
        Err(e) => CodeToolResult {
            tool_call_id: tc.id.clone(),
            name: tc.name.clone(),
            output: format!("工具执行失败：{e}"),
            is_error: true,
        },
    }
}

async fn ask_tool_permission(
    app: &AppHandle,
    session_id: &str,
    request_id: &str,
    tc: &ToolCall,
    working_dir: Option<&str>,
    permissions: Arc<Mutex<HashMap<String, oneshot::Sender<CodePermissionDecision>>>>,
) -> Result<CodePermissionDecision, String> {
    let permission_id = Uuid::new_v4().to_string();
    let preview = tools::permission_preview(&tc.name, &tc.arguments, working_dir).await;
    let (tx, rx) = oneshot::channel();

    permissions.lock().await.insert(permission_id.clone(), tx);
    let event = CodePermissionRequestEvent {
        id: permission_id.clone(),
        session_id: session_id.to_string(),
        request_id: request_id.to_string(),
        tool_call: tools::to_code_tool_call(tc),
        title: preview.title,
        summary: preview.summary,
        risk_level: preview.risk_level,
        preview: preview.preview,
    };

    if let Err(err) = app.emit("code:permission_request", event) {
        let _ = permissions.lock().await.remove(&permission_id);
        return Err(format!("发送审批请求失败：{err}"));
    }

    match tokio::time::timeout(std::time::Duration::from_secs(600), rx).await {
        Ok(Ok(decision)) => Ok(decision),
        Ok(Err(_)) => Err("审批通道已关闭。".into()),
        Err(_) => {
            let _ = permissions.lock().await.remove(&permission_id);
            Err("等待用户审批超时。".into())
        }
    }
}

/// 判断是否是第一个用户-助手交换（会话刚创建，需要自动生成标题）
fn is_first_exchange(session: &CodeSession) -> bool {
    // messages: [user_msg, ..., assistant_msg]
    // 如果只有 2 条消息且第一条是 user、第二条未持久化（即当前这条），则为首次交换
    // 但这里 session 是发送前读取的，消息还没有我们刚持久化的那两条
    // 所以判断：刚发送的消息是 user + 当前正在生成 assistant → session 原有消息=0 即为新建
    session.messages.is_empty()
}

async fn auto_generate_title(
    db: SqlitePool,
    settings: HashMap<String, String>,
    session_id: String,
    prompt: String,
) {
    let client = match LlmClient::from_settings(&settings) {
        Ok(c) => c,
        Err(_) => return,
    };
    let model = resolve_model(&settings, &["copilot_simple_model"]);
    let messages = vec![LlmMessage::user(prompt)];
    match client.chat(&messages, model.as_deref(), 0.4).await {
        Ok(title) => {
            let title = title.trim().replace(['"', '\''], "").trim().to_string();
            let title = if title.is_empty() || title.len() > 40 {
                title.chars().take(40).collect::<String>()
            } else {
                title
            };
            let _ = store::update_session_title(&db, &session_id, &title).await;
        }
        Err(_) => {}
    }
}
