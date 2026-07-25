use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use serde_json::json;
use std::collections::HashMap;
use std::sync::OnceLock;

mod shared;
mod transport;

pub(crate) use self::shared::explain_vision_error;
use self::shared::{
    build_anthropic_tools, build_anthropic_user_messages,
    build_message_array as build_message_array_impl,
    extract_anthropic_response_text as extract_anthropic_response_text_impl,
};
use self::transport::{
    append_sse_chunk, drain_sse_payloads, ensure_http_success, format_http_error,
    format_openai_http_error as format_openai_http_error_impl, parse_json_response,
};

/// 多模态图片块：base64 编码（不含 data: 前缀）+ 媒体类型，复用 chat_with_image 的线格式。
#[derive(Clone, Debug)]
pub struct LlmImage {
    pub media_type: String,
    pub data: String,
}

#[derive(Clone, Debug)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
    pub tool_call_id: Option<String>,
    pub tool_calls: Option<Vec<ToolCall>>,
    /// 该消息附带的图片（仅 user 消息有意义）；为空时按纯文本 content 发送，保持向后兼容。
    pub images: Vec<LlmImage>,
}

#[derive(Clone, Debug)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Clone, Debug)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Clone, Debug)]
pub enum StreamOutcome {
    TextCompleted(String),
    ToolCalls(Vec<ToolCall>),
}

fn http_client() -> &'static reqwest::Client {
    static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(600))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

impl LlmMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".into(),
            content: content.into(),
            tool_call_id: None,
            tool_calls: None,
            images: Vec::new(),
        }
    }
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".into(),
            content: content.into(),
            tool_call_id: None,
            tool_calls: None,
            images: Vec::new(),
        }
    }
    /// 带图片的用户消息（多模态）；images 为空时等价于 user()。
    pub fn user_with_images(content: impl Into<String>, images: Vec<LlmImage>) -> Self {
        Self {
            role: "user".into(),
            content: content.into(),
            tool_call_id: None,
            tool_calls: None,
            images,
        }
    }
    #[allow(dead_code)]
    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".into(),
            content: content.into(),
            tool_call_id: None,
            tool_calls: None,
            images: Vec::new(),
        }
    }
    pub fn assistant_with_tool_calls(tool_calls: Vec<ToolCall>) -> Self {
        Self {
            role: "assistant".into(),
            content: String::new(),
            tool_call_id: None,
            tool_calls: Some(tool_calls),
            images: Vec::new(),
        }
    }
    pub fn tool(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: "tool".into(),
            content: content.into(),
            tool_call_id: Some(tool_call_id.into()),
            tool_calls: None,
            images: Vec::new(),
        }
    }
}

pub fn web_search_tool_definition() -> ToolDefinition {
    ToolDefinition {
        name: "web_search".into(),
        description: "搜索互联网获取实时信息。当需要查找最新资料、事实核查、或用户询问近期事件、新闻、当前信息时使用此工具。搜索结果包含来自网络的相关摘要和链接。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索查询词，应简洁明确，建议使用关键词而非自然语言问题。涉及时效性话题（最新/今天/近期）时，请在查询词中体现时间（如年份、月份或“最新”），以便检索到最新结果。"
                }
            },
            "required": ["query"]
        }),
    }
}

#[derive(Clone)]
pub enum LlmClient {
    OpenAI {
        base_url: String,
        api_key: String,
        chat_model: String,
        embed_model: String,
    },
    Anthropic {
        base_url: String,
        api_key: String,
        chat_model: String,
    },
}

const DEFAULT_ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com/v1";

fn normalize_base_url(url: &str) -> String {
    let mut trimmed = url.trim().trim_end_matches('/');
    // 容错：用户可能整段粘贴了完整 endpoint。剥掉我们会自行拼接的已知后缀，只保留 API 根地址，
    // 避免出现 .../chat/completions/chat/completions 这类重复路径（自定义/兼容地址常见误填）。
    let lower = trimmed.to_ascii_lowercase();
    for suffix in ["/chat/completions", "/embeddings", "/messages"] {
        if lower.ends_with(suffix) {
            trimmed = trimmed[..trimmed.len() - suffix.len()].trim_end_matches('/');
            break;
        }
    }
    trimmed.to_string()
}

/// Query whether a base URL should be treated as Anthropic-compatible.
/// Exported so the settings service can pick the right auth header when listing models.
///
/// Special case for Kimi Code:
/// - Anthropic-compatible form: `https://api.kimi.com/coding/` (no `/v1` suffix)
/// - OpenAI-compatible form:    `https://api.kimi.com/coding/v1`
pub(crate) fn is_anthropic_compatible_base_url(base_url: &str) -> bool {
    let lower = base_url.to_ascii_lowercase();
    if lower.contains("/anthropic/") || lower.contains("api.anthropic.com") {
        return true;
    }
    if lower.contains("api.kimi.com/coding") {
        // The OpenAI-compatible endpoint ends with `/v1` and must stay on the OpenAI wire.
        return !lower.trim_end_matches('/').ends_with("/v1");
    }
    false
}

fn build_anthropic_messages_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    let lower = trimmed.to_ascii_lowercase();
    if lower.ends_with("/v1") || lower.contains("/v1/") {
        format!("{}/messages", trimmed)
    } else {
        format!("{}/v1/messages", trimmed)
    }
}

/// Returns the appropriate (header_name, header_value) for Anthropic-compatible endpoints.
/// Native Anthropic and Kimi Code's Anthropic-compatible endpoint use `x-api-key`.
/// Other Anthropic-compatible gateways (Azure Foundry, MiniMax, etc.) commonly require
/// `Authorization: Bearer`, so we fall back to Bearer for unrecognized Anthropic-like URLs.
pub(crate) fn anthropic_auth_header(base_url: &str, api_key: &str) -> (&'static str, String) {
    let lower = base_url.to_ascii_lowercase();
    let use_x_api_key = lower.contains("api.anthropic.com")
        || (lower.contains("api.kimi.com/coding")
            && !lower.trim_end_matches('/').ends_with("/v1"));
    if use_x_api_key {
        ("x-api-key", api_key.to_string())
    } else {
        ("Authorization", format!("Bearer {}", api_key))
    }
}

impl LlmClient {
    pub fn from_settings(s: &HashMap<String, String>) -> Result<Self> {
        let provider = s
            .get("llm_provider")
            .map(|v| v.as_str())
            .unwrap_or("openai");
        match provider {
            "anthropic" => {
                let api_key = s.get("anthropic_api_key").cloned().unwrap_or_default();
                if api_key.is_empty() {
                    return Err(anyhow!("Anthropic API key not configured"));
                }
                Ok(LlmClient::Anthropic {
                    base_url: DEFAULT_ANTHROPIC_BASE_URL.to_string(),
                    api_key,
                    chat_model: s
                        .get("anthropic_chat_model")
                        .cloned()
                        .unwrap_or_else(|| "claude-3-5-haiku-20241022".into()),
                })
            }
            "openai_compatible" => {
                let base_url = s
                    .get("openai_compatible_base_url")
                    .cloned()
                    .unwrap_or_default();
                if base_url.is_empty() {
                    return Err(anyhow!("OpenAI-compatible base URL not configured"));
                }
                let normalized_base_url = normalize_base_url(&base_url);
                let api_key = s
                    .get("openai_compatible_api_key")
                    .cloned()
                    .unwrap_or_default();
                if is_anthropic_compatible_base_url(&normalized_base_url) {
                    return Ok(LlmClient::Anthropic {
                        base_url: normalized_base_url,
                        api_key,
                        chat_model: s
                            .get("openai_compatible_chat_model")
                            .cloned()
                            .unwrap_or_else(|| "claude-3-5-haiku-20241022".into()),
                    });
                }
                Ok(LlmClient::OpenAI {
                    base_url: normalized_base_url,
                    api_key,
                    chat_model: s
                        .get("openai_compatible_chat_model")
                        .cloned()
                        .unwrap_or_else(|| "deepseek-chat".into()),
                    embed_model: s
                        .get("openai_compatible_embedding_model")
                        .cloned()
                        .unwrap_or_else(|| "BAAI/bge-m3".into()),
                })
            }
            _ => {
                // Default: openai
                let api_key = s.get("openai_api_key").cloned().unwrap_or_default();
                if api_key.is_empty() {
                    return Err(anyhow!("OpenAI API key not configured"));
                }
                Ok(LlmClient::OpenAI {
                    base_url: s
                        .get("openai_base_url")
                        .cloned()
                        .unwrap_or_else(|| "https://api.openai.com/v1".into()),
                    api_key,
                    chat_model: s
                        .get("openai_chat_model")
                        .cloned()
                        .unwrap_or_else(|| "gpt-4o-mini".into()),
                    embed_model: s
                        .get("openai_embedding_model")
                        .cloned()
                        .unwrap_or_else(|| "text-embedding-3-small".into()),
                })
            }
        }
    }

    /// Build a client specifically for vision tasks using the "视界" (vision) model settings.
    /// Falls back to the main LLM provider if vision-specific settings are not configured.
    pub fn vision_client_from_settings(
        s: &HashMap<String, String>,
    ) -> Option<(Self, Option<String>)> {
        let model = s
            .get("vision_model")
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let Some(model) = model else {
            return Self::from_settings(s).ok().map(|client| (client, None));
        };
        let base_url = s
            .get("vision_base_url")
            .map(|v| v.trim().to_string())
            .unwrap_or_default();
        let api_key = s
            .get("vision_api_key")
            .map(|v| v.trim().to_string())
            .unwrap_or_default();

        let client = if !base_url.is_empty() && !api_key.is_empty() {
            let normalized_base_url = normalize_base_url(&base_url);
            if is_anthropic_compatible_base_url(&normalized_base_url) {
                // Anthropic-compatible endpoint (e.g. Kimi Coding)
                LlmClient::Anthropic {
                    base_url: normalized_base_url,
                    api_key,
                    chat_model: model.clone(),
                }
            } else {
                // Dedicated vision endpoint (OpenAI-compatible)
                LlmClient::OpenAI {
                    base_url: normalized_base_url,
                    api_key,
                    chat_model: model.clone(),
                    embed_model: String::new(),
                }
            }
        } else if !api_key.is_empty() {
            // Likely Anthropic (api_key only, no base_url)
            LlmClient::Anthropic {
                base_url: DEFAULT_ANTHROPIC_BASE_URL.to_string(),
                api_key,
                chat_model: model.clone(),
            }
        } else {
            // No dedicated key — reuse main provider with vision model override
            match Self::from_settings(s) {
                Ok(c) => c,
                Err(_) => return None,
            }
        };
        Some((client, Some(model)))
    }

    /// Build a client for embedding only.
    /// If `embedding_base_url` + `embedding_api_key` are set, use those.
    /// Otherwise fall back to the main LLM provider.
    pub fn embed_client_from_settings(s: &HashMap<String, String>) -> Result<Self> {
        let base_url = s
            .get("embedding_base_url")
            .map(|v| v.trim().to_string())
            .unwrap_or_default();
        let api_key = s
            .get("embedding_api_key")
            .map(|v| v.trim().to_string())
            .unwrap_or_default();
        let model = s
            .get("embedding_model")
            .map(|v| v.trim().to_string())
            .unwrap_or_default();

        if !base_url.is_empty() && !api_key.is_empty() {
            let embed_model = if model.is_empty() {
                "text-embedding-3-small".to_string()
            } else {
                model
            };
            Ok(LlmClient::OpenAI {
                base_url,
                api_key,
                chat_model: embed_model.clone(),
                embed_model,
            })
        } else {
            Self::from_settings(s)
        }
    }

    /// Build a client for a scoped model configuration.
    ///
    /// Iterates over the provided keys by index and picks the first scope where both
    /// `base_url` and `api_key` are configured. The model from the matching index is used
    /// so that base_url/api_key/model are never mixed across scopes. If no scope is fully
    /// configured, falls back to the main LLM provider.
    ///
    /// Returns the client and a flag indicating whether a dedicated scope was selected.
    pub fn scoped_client_from_settings(
        s: &HashMap<String, String>,
        base_url_keys: &[&str],
        api_key_keys: &[&str],
        model_keys: &[&str],
    ) -> Result<(Self, bool)> {
        let scopes = base_url_keys
            .iter()
            .zip(api_key_keys.iter())
            .zip(model_keys.iter());
        for ((&base_url_key, &api_key_key), &model_key) in scopes {
            let base_url = s
                .get(base_url_key)
                .map(|value| value.trim())
                .unwrap_or_default();
            let api_key = s
                .get(api_key_key)
                .map(|value| value.trim())
                .unwrap_or_default();
            if !base_url.is_empty() && !api_key.is_empty() {
                let model = s
                    .get(model_key)
                    .map(|value| value.trim())
                    .unwrap_or_default();
                return Ok((
                    Self::build_scoped_client(base_url, api_key, model)?,
                    true,
                ));
            }
        }
        Ok((Self::from_settings(s)?, false))
    }

    fn build_scoped_client(base_url: &str, api_key: &str, model: &str) -> Result<Self> {
        let normalized_base_url = normalize_base_url(base_url);
        let chat_model = if model.is_empty() {
            None
        } else {
            Some(model.to_string())
        };
        if is_anthropic_compatible_base_url(&normalized_base_url) {
            Ok(LlmClient::Anthropic {
                base_url: normalized_base_url,
                api_key: api_key.to_string(),
                chat_model: chat_model.unwrap_or_else(|| "claude-3-5-haiku-20241022".into()),
            })
        } else {
            Ok(LlmClient::OpenAI {
                base_url: normalized_base_url,
                api_key: api_key.to_string(),
                chat_model: chat_model.unwrap_or_else(|| "deepseek-chat".into()),
                embed_model: String::new(),
            })
        }
    }

    /// Build a client specifically for literature scout tasks.
    /// Reads `multi_agent_literature_scout_base_url/api_key/model`.
    /// Falls back to the main LLM provider if scout-specific settings are not configured.
    pub fn scout_client_from_settings(s: &HashMap<String, String>) -> Result<Self> {
        let base_url = s
            .get("multi_agent_literature_scout_base_url")
            .map(|v| v.trim().to_string())
            .unwrap_or_default();
        let api_key = s
            .get("multi_agent_literature_scout_api_key")
            .map(|v| v.trim().to_string())
            .unwrap_or_default();
        let model = s
            .get("multi_agent_literature_scout_model")
            .map(|v| v.trim().to_string())
            .unwrap_or_default();

        if base_url.is_empty() || api_key.is_empty() {
            return Self::from_settings(s);
        }

        let normalized_base_url = normalize_base_url(&base_url);
        if is_anthropic_compatible_base_url(&normalized_base_url) {
            Ok(LlmClient::Anthropic {
                base_url: normalized_base_url,
                api_key,
                chat_model: if model.is_empty() {
                    "claude-3-5-haiku-20241022".into()
                } else {
                    model
                },
            })
        } else {
            Ok(LlmClient::OpenAI {
                base_url: normalized_base_url,
                api_key,
                chat_model: if model.is_empty() {
                    "deepseek-chat".into()
                } else {
                    model
                },
                embed_model: String::new(),
            })
        }
    }

    /// Resolve the literature-search model without losing the Xiaoyan main-model scope.
    /// Priority: dedicated literature scout -> Xiaoyan main role -> global provider.
    pub fn literature_client_with_main_fallback(
        s: &HashMap<String, String>,
    ) -> Result<(Self, Option<String>)> {
        let (client, scoped) = Self::scoped_client_from_settings(
            s,
            &[
                "multi_agent_literature_scout_base_url",
                "copilot_simple_base_url",
            ],
            &[
                "multi_agent_literature_scout_api_key",
                "copilot_simple_api_key",
            ],
            &["multi_agent_literature_scout_model", "copilot_simple_model"],
        )?;
        let model = if scoped {
            None
        } else {
            resolve_model(s, &["copilot_simple_model"])
        };
        Ok((client, model))
    }

    /// Vision chat — send one image + text prompt to a multimodal model.
    /// `image_b64` is the base64-encoded image bytes; `media_type` is e.g. "image/png".
    /// Fails silently (callers should handle errors) if the model doesn't support vision.
    pub async fn chat_with_image(
        &self,
        image_b64: &str,
        media_type: &str,
        text: &str,
        model: Option<&str>,
        temperature: f32,
    ) -> Result<String> {
        match self {
            LlmClient::OpenAI {
                base_url,
                api_key,
                chat_model,
                ..
            } => {
                let client = http_client();
                let body = json!({
                    "model": model.unwrap_or(chat_model),
                    "temperature": temperature,
                    "max_tokens": 1024,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": format!("data:{media_type};base64,{image_b64}"), "detail": "low"}},
                            {"type": "text", "text": text}
                        ]
                    }]
                });
                let resp = client
                    .post(format!(
                        "{}/chat/completions",
                        base_url.trim_end_matches('/')
                    ))
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("User-Agent", USER_AGENT)
                    .json(&body)
                    .send()
                    .await?;
                let resp = ensure_http_success(resp, |status, body| {
                    format_openai_http_error_impl(status, body, base_url, "Vision API error")
                })
                .await?;
                let json = parse_json_response(resp, "Vision API error").await?;
                let content = json["choices"][0]["message"]["content"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                let (i, o) = parse_openai_usage(&json).unwrap_or_else(|| {
                    (
                        crate::token_usage::estimate_tokens(text) + 256,
                        crate::token_usage::estimate_tokens(&content),
                    )
                });
                crate::token_usage::record(
                    i,
                    o,
                    text.chars().count() as u64,
                    content.chars().count() as u64,
                );
                Ok(content)
            }
            LlmClient::Anthropic {
                base_url,
                api_key,
                chat_model,
            } => {
                let client = http_client();
                let body = json!({
                    "model": model.unwrap_or(chat_model),
                    "max_tokens": 1024,
                    "temperature": temperature,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                            {"type": "text", "text": text}
                        ]
                    }]
                });
                let (auth_header, auth_value) = anthropic_auth_header(base_url, api_key);
                let resp = client
                    .post(build_anthropic_messages_url(base_url))
                    .header(auth_header, auth_value)
                    .header("anthropic-version", "2023-06-01")
                    .json(&body)
                    .send()
                    .await?;
                let resp = ensure_http_success(resp, |status, body| {
                    format_http_error(status, body, "Anthropic vision error")
                })
                .await?;
                let json = parse_json_response(resp, "Anthropic vision error").await?;
                let text_out =
                    extract_anthropic_response_text_impl(&json, "Anthropic vision error")?;
                let (mut i, mut o) = parse_anthropic_usage(&json["usage"]);
                if i == 0 && o == 0 {
                    i = crate::token_usage::estimate_tokens(text) + 256;
                    o = crate::token_usage::estimate_tokens(&text_out);
                }
                crate::token_usage::record(
                    i,
                    o,
                    text.chars().count() as u64,
                    text_out.chars().count() as u64,
                );
                Ok(text_out)
            }
        }
    }

    /// Non-streaming chat — returns full response string.
    pub async fn chat(
        &self,
        messages: &[LlmMessage],
        model: Option<&str>,
        temperature: f32,
    ) -> Result<String> {
        self.chat_with_max_tokens(messages, model, temperature, 16_384)
            .await
    }

    pub async fn chat_with_max_tokens(
        &self,
        messages: &[LlmMessage],
        model: Option<&str>,
        temperature: f32,
        max_tokens: u32,
    ) -> Result<String> {
        match self {
            LlmClient::OpenAI {
                base_url,
                api_key,
                chat_model,
                ..
            } => {
                openai_chat(
                    base_url,
                    api_key,
                    model.unwrap_or(chat_model),
                    messages,
                    temperature,
                    max_tokens,
                )
                .await
            }
            LlmClient::Anthropic {
                base_url,
                api_key,
                chat_model,
            } => {
                anthropic_chat(
                    base_url,
                    api_key,
                    model.unwrap_or(chat_model),
                    messages,
                    temperature,
                    max_tokens,
                )
                .await
            }
        }
    }

    /// Connectivity test: send a minimal request and accept any successful,
    /// parseable response (including empty text). This avoids treating a valid
    /// 200 response with an empty content block as an error.
    pub async fn test(&self) -> Result<()> {
        match self {
            LlmClient::OpenAI {
                base_url,
                api_key,
                chat_model,
                ..
            } => {
                let client = http_client();
                let messages = vec![LlmMessage::user("hi")];
                let body = json!({
                    "model": chat_model,
                    "messages": build_message_array_impl(&messages),
                    "temperature": 0.0,
                    "max_tokens": 1,
                });
                crate::append_diagnostic_log(&format!(
                    "[llm][test] url={}/chat/completions model={}",
                    base_url.trim_end_matches('/'),
                    chat_model,
                ));
                let resp = client
                    .post(format!(
                        "{}/chat/completions",
                        base_url.trim_end_matches('/')
                    ))
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("User-Agent", USER_AGENT)
                    .json(&body)
                    .send()
                    .await?;
                let resp = ensure_http_success(resp, |status, body| {
                    format_openai_http_error_impl(status, body, base_url, "LLM API test error")
                })
                .await?;
                parse_json_response(resp, "LLM API test error").await?;
                Ok(())
            }
            LlmClient::Anthropic {
                base_url,
                api_key,
                chat_model,
            } => {
                let client = http_client();
                let messages = vec![LlmMessage::user("hi")];
                let body = json!({
                    "model": chat_model,
                    "max_tokens": 1,
                    "messages": build_anthropic_user_messages(&messages),
                    "temperature": 0.0,
                });
                crate::append_diagnostic_log(&format!(
                    "[llm][test] url={} model={} auth_header={}",
                    build_anthropic_messages_url(base_url),
                    chat_model,
                    anthropic_auth_header(base_url, "").0,
                ));
                let (auth_header, auth_value) = anthropic_auth_header(base_url, api_key);
                let resp = client
                    .post(build_anthropic_messages_url(base_url))
                    .header(auth_header, auth_value)
                    .header("anthropic-version", "2023-06-01")
                    .json(&body)
                    .send()
                    .await?;
                let resp = ensure_http_success(resp, |status, body| {
                    format_http_error(status, body, "Anthropic API test error")
                })
                .await?;
                parse_json_response(resp, "Anthropic API test error").await?;
                Ok(())
            }
        }
    }

    /// Streaming chat — calls `on_delta` for each token chunk, returns full text.
    pub async fn stream_chat(
        &self,
        messages: &[LlmMessage],
        model: Option<&str>,
        temperature: f32,
        on_delta: impl Fn(String) + Send + Sync,
    ) -> Result<String> {
        match self {
            LlmClient::OpenAI {
                base_url,
                api_key,
                chat_model,
                ..
            } => {
                stream_openai(
                    base_url,
                    api_key,
                    model.unwrap_or(chat_model),
                    messages,
                    temperature,
                    16_384,
                    &on_delta,
                )
                .await
            }
            LlmClient::Anthropic {
                base_url,
                api_key,
                chat_model,
            } => {
                stream_anthropic(
                    base_url,
                    api_key,
                    model.unwrap_or(chat_model),
                    messages,
                    temperature,
                    16_384,
                    &on_delta,
                )
                .await
            }
        }
    }

    /// Streaming chat with tool support — returns either text or tool calls.
    pub async fn stream_chat_with_tools(
        &self,
        messages: &[LlmMessage],
        tools: &[ToolDefinition],
        model: Option<&str>,
        temperature: f32,
        on_delta: impl Fn(String) + Send + Sync,
    ) -> Result<StreamOutcome> {
        match self {
            LlmClient::OpenAI {
                base_url,
                api_key,
                chat_model,
                ..
            } => {
                stream_openai_with_tools(
                    base_url,
                    api_key,
                    model.unwrap_or(chat_model),
                    messages,
                    tools,
                    temperature,
                    16_384,
                    &on_delta,
                )
                .await
            }
            LlmClient::Anthropic {
                base_url,
                api_key,
                chat_model,
            } => {
                stream_anthropic_with_tools(
                    base_url,
                    api_key,
                    model.unwrap_or(chat_model),
                    messages,
                    tools,
                    temperature,
                    16_384,
                    &on_delta,
                )
                .await
            }
        }
    }

    /// Generate embeddings for a batch of texts.
    pub async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        match self {
            LlmClient::OpenAI {
                base_url,
                api_key,
                embed_model,
                ..
            } => embed_openai(base_url, api_key, embed_model, texts).await,
            LlmClient::Anthropic { .. } => Err(anyhow!(
                "Anthropic does not support embeddings; use OpenAI-compatible endpoint"
            )),
        }
    }
}

pub fn resolve_model(settings: &HashMap<String, String>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| settings.get(*key))
        .map(|value| value.trim())
        .find(|value| !value.is_empty())
        .map(|value| value.to_string())
}

pub fn resolve_temperature(settings: &HashMap<String, String>, key: &str, default: f32) -> f32 {
    settings
        .get(key)
        .and_then(|value| value.trim().parse::<f32>().ok())
        .unwrap_or(default)
}

pub fn resolve_temperature_chain(
    settings: &HashMap<String, String>,
    keys: &[&str],
    default: f32,
) -> f32 {
    keys.iter()
        .filter_map(|key| settings.get(*key))
        .map(|value| value.trim())
        .find_map(|value| value.parse::<f32>().ok())
        .unwrap_or(default)
}

pub fn resolve_max_tokens(settings: &HashMap<String, String>, keys: &[&str], default: u32) -> u32 {
    keys.iter()
        .filter_map(|key| settings.get(*key))
        .map(|value| value.trim())
        .find_map(|value| value.parse::<u32>().ok())
        .unwrap_or(default)
        .clamp(256, 32_768)
}

// ── OpenAI helpers ──────────────────────────────────────────────

const USER_AGENT: &str = "xiaoyan-desktop/0.4.3";

/// 从 OpenAI 响应（流式末帧或非流式整体）中提取 `usage`，缺失返回 None。
fn parse_openai_usage(v: &serde_json::Value) -> Option<(u64, u64)> {
    let u = &v["usage"];
    if !u.is_object() {
        return None;
    }
    let input = u["prompt_tokens"].as_u64();
    let output = u["completion_tokens"].as_u64();
    match (input, output) {
        (Some(i), Some(o)) => Some((i, o)),
        _ => None,
    }
}

/// 从 Anthropic `usage` 对象中提取 (input, output)，任一缺失按 0 计。
fn parse_anthropic_usage(u: &serde_json::Value) -> (u64, u64) {
    (
        u["input_tokens"].as_u64().unwrap_or(0),
        u["output_tokens"].as_u64().unwrap_or(0),
    )
}

async fn openai_chat(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[LlmMessage],
    temperature: f32,
    max_tokens: u32,
) -> Result<String> {
    let client = http_client();
    let body = json!({
        "model": model,
        "messages": build_message_array_impl(messages),
        "temperature": temperature,
        "max_tokens": max_tokens,
    });
    crate::append_diagnostic_log(&format!(
        "[llm][request] url={}/chat/completions model={} temperature={} max_tokens={} messages_count={}",
        base_url.trim_end_matches('/'),
        model,
        temperature,
        max_tokens,
        messages.len(),
    ));
    let resp = client
        .post(format!(
            "{}/chat/completions",
            base_url.trim_end_matches('/')
        ))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("User-Agent", USER_AGENT)
        .json(&body)
        .send()
        .await?;

    let resp = ensure_http_success(resp, |status, body| {
        format_openai_http_error_impl(status, body, base_url, "LLM API error")
    })
    .await?;
    let json = parse_json_response(resp, "LLM API error").await?;
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    crate::token_usage::record_chat(messages, &content, parse_openai_usage(&json));
    Ok(content)
}

async fn stream_openai(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[LlmMessage],
    temperature: f32,
    max_tokens: u32,
    on_delta: &(impl Fn(String) + Send + Sync),
) -> Result<String> {
    let client = http_client();
    let body = json!({
        "model": model,
        "messages": build_message_array_impl(messages),
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": true,
        "stream_options": { "include_usage": true },
    });
    let resp = client
        .post(format!(
            "{}/chat/completions",
            base_url.trim_end_matches('/')
        ))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("User-Agent", USER_AGENT)
        .json(&body)
        .send()
        .await?;

    let resp = ensure_http_success(resp, |status, body| {
        format_openai_http_error_impl(status, body, base_url, "LLM streaming API error")
    })
    .await?;

    let mut full = String::new();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    let mut in_think = false;
    let mut api_usage: Option<(u64, u64)> = None;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk?;
        append_sse_chunk(&mut buf, &bytes);
        for data in drain_sse_payloads(&mut buf) {
            if data == "[DONE]" {
                if in_think {
                    full.push_str("</think>");
                    on_delta("</think>".to_string());
                }
                crate::token_usage::record_chat(messages, &full, api_usage);
                return Ok(full);
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(u) = parse_openai_usage(&v) {
                    api_usage = Some(u);
                }
                let delta = &v["choices"][0]["delta"];
                if let Some(r) = delta["reasoning_content"]
                    .as_str()
                    .or_else(|| delta["reasoning"].as_str())
                {
                    if !r.is_empty() {
                        if !in_think {
                            in_think = true;
                            full.push_str("<think>");
                            on_delta("<think>".to_string());
                        }
                        full.push_str(r);
                        on_delta(r.to_string());
                    }
                }
                if let Some(c) = delta["content"].as_str() {
                    if !c.is_empty() {
                        if in_think {
                            in_think = false;
                            full.push_str("</think>");
                            on_delta("</think>".to_string());
                        }
                        full.push_str(c);
                        on_delta(c.to_string());
                    }
                }
            }
        }
    }
    if in_think {
        full.push_str("</think>");
        on_delta("</think>".to_string());
    }
    crate::token_usage::record_chat(messages, &full, api_usage);
    Ok(full)
}

async fn embed_openai(
    base_url: &str,
    api_key: &str,
    model: &str,
    texts: &[String],
) -> Result<Vec<Vec<f32>>> {
    let client = http_client();
    let body = json!({ "model": model, "input": texts });
    let resp = client
        .post(format!("{}/embeddings", base_url.trim_end_matches('/')))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("User-Agent", USER_AGENT)
        .json(&body)
        .send()
        .await?;

    let resp = ensure_http_success(resp, |status, body| {
        format_openai_http_error_impl(status, body, base_url, "Embedding error")
    })
    .await?;
    let json = parse_json_response(resp, "Embedding error").await?;
    let data = json["data"]
        .as_array()
        .ok_or_else(|| anyhow!("no data in embed response"))?;
    let mut result = Vec::with_capacity(data.len());
    for item in data {
        let vec = item["embedding"]
            .as_array()
            .ok_or_else(|| anyhow!("no embedding array"))?
            .iter()
            .map(|v| v.as_f64().unwrap_or(0.0) as f32)
            .collect();
        result.push(vec);
    }
    Ok(result)
}

// ── Anthropic helpers ───────────────────────────────────────────

async fn anthropic_chat(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[LlmMessage],
    temperature: f32,
    max_tokens: u32,
) -> Result<String> {
    let client = http_client();
    let system = messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| m.content.clone());
    // 复用 build_anthropic_user_messages：统一处理 tool/tool_calls 与多模态图片块，
    // 避免在非工具流式/非流式路径 inline 构造时丢弃 m.images。
    let user_msgs = build_anthropic_user_messages(messages);
    let mut body = json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": user_msgs,
        "temperature": temperature,
    });
    if let Some(s) = system {
        body["system"] = json!(s);
    }
    crate::append_diagnostic_log(&format!(
        "[llm][request] url={} model={} temperature={} max_tokens={} messages_count={}",
        build_anthropic_messages_url(base_url),
        model,
        temperature,
        max_tokens,
        messages.len(),
    ));
    let (auth_header, auth_value) = anthropic_auth_header(base_url, api_key);
    let resp = client
        .post(build_anthropic_messages_url(base_url))
        .header(auth_header, auth_value)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await?;

    let resp = ensure_http_success(resp, |status, body| {
        format_http_error(status, body, "Anthropic error")
    })
    .await?;
    let json = parse_json_response(resp, "Anthropic error").await?;
    let text = extract_anthropic_response_text_impl(&json, "Anthropic error")?;
    let (input, output) = parse_anthropic_usage(&json["usage"]);
    let api_usage = (input != 0 || output != 0).then_some((input, output));
    crate::token_usage::record_chat(messages, &text, api_usage);
    Ok(text)
}

async fn stream_anthropic(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[LlmMessage],
    temperature: f32,
    max_tokens: u32,
    on_delta: &(impl Fn(String) + Send + Sync),
) -> Result<String> {
    let client = http_client();
    let system = messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| m.content.clone());
    // 复用 build_anthropic_user_messages：统一处理 tool/tool_calls 与多模态图片块，
    // 避免在非工具流式/非流式路径 inline 构造时丢弃 m.images。
    let user_msgs = build_anthropic_user_messages(messages);
    let mut body = json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": user_msgs,
        "temperature": temperature,
        "stream": true,
    });
    if let Some(s) = system {
        body["system"] = json!(s);
    }
    let (auth_header, auth_value) = anthropic_auth_header(base_url, api_key);
    let resp = client
        .post(build_anthropic_messages_url(base_url))
        .header(auth_header, auth_value)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await?;

    let resp = ensure_http_success(resp, |status, body| {
        format_http_error(status, body, "Anthropic streaming error")
    })
    .await?;

    let mut full = String::new();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    let mut in_think = false;
    let mut usage_input: u64 = 0;
    let mut usage_output: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk?;
        append_sse_chunk(&mut buf, &bytes);
        for data in drain_sse_payloads(&mut buf) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
                match v["type"].as_str() {
                    // message_start 携带 input_tokens；message_delta 的 output_tokens 为累计值，覆盖即可。
                    Some("message_start") => {
                        let (i, _) = parse_anthropic_usage(&v["message"]["usage"]);
                        usage_input = i;
                    }
                    Some("message_delta") => {
                        let (_, o) = parse_anthropic_usage(&v["usage"]);
                        if o > 0 {
                            usage_output = o;
                        }
                    }
                    _ => {}
                }
                if v["type"] == "content_block_delta" {
                    let delta = &v["delta"];
                    if let Some(t) = delta["thinking"].as_str() {
                        if !t.is_empty() {
                            if !in_think {
                                in_think = true;
                                full.push_str("<think>");
                                on_delta("<think>".to_string());
                            }
                            full.push_str(t);
                            on_delta(t.to_string());
                        }
                    }
                    if let Some(t) = delta["text"].as_str() {
                        if !t.is_empty() {
                            if in_think {
                                in_think = false;
                                full.push_str("</think>");
                                on_delta("</think>".to_string());
                            }
                            full.push_str(t);
                            on_delta(t.to_string());
                        }
                    }
                }
            }
        }
    }
    if in_think {
        full.push_str("</think>");
        on_delta("</think>".to_string());
    }
    let api_usage = (usage_input > 0 || usage_output > 0).then_some((usage_input, usage_output));
    crate::token_usage::record_chat(messages, &full, api_usage);
    Ok(full)
}

// ── OpenAI streaming with tools ────────────────────────────────────

async fn stream_openai_with_tools(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[LlmMessage],
    tools: &[ToolDefinition],
    temperature: f32,
    max_tokens: u32,
    on_delta: &(impl Fn(String) + Send + Sync),
) -> Result<StreamOutcome> {
    let client = http_client();
    let mut body = json!({
        "model": model,
        "messages": build_message_array_impl(messages),
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": true,
        "stream_options": { "include_usage": true },
    });
    if !tools.is_empty() {
        body["tools"] = json!(tools
            .iter()
            .map(|t| json!({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                }
            }))
            .collect::<Vec<_>>());
        body["tool_choice"] = json!("auto");
    }
    let resp = client
        .post(format!(
            "{}/chat/completions",
            base_url.trim_end_matches('/')
        ))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("User-Agent", USER_AGENT)
        .json(&body)
        .send()
        .await?;

    let resp = ensure_http_success(resp, |status, body| {
        format_openai_http_error_impl(status, body, base_url, "LLM streaming API error")
    })
    .await?;

    let mut full = String::new();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    let mut tool_calls_acc: Vec<serde_json::Value> = Vec::new();
    let mut in_think = false;
    let mut api_usage: Option<(u64, u64)> = None;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk?;
        append_sse_chunk(&mut buf, &bytes);
        for data in drain_sse_payloads(&mut buf) {
            if data == "[DONE]" {
                break;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(u) = parse_openai_usage(&v) {
                    api_usage = Some(u);
                }
                let delta = &v["choices"][0]["delta"];
                if let Some(r) = delta["reasoning_content"]
                    .as_str()
                    .or_else(|| delta["reasoning"].as_str())
                {
                    if !r.is_empty() {
                        if !in_think {
                            in_think = true;
                            full.push_str("<think>");
                            on_delta("<think>".to_string());
                        }
                        full.push_str(r);
                        on_delta(r.to_string());
                    }
                }
                if let Some(c) = delta["content"].as_str() {
                    if !c.is_empty() {
                        if in_think {
                            in_think = false;
                            full.push_str("</think>");
                            on_delta("</think>".to_string());
                        }
                        full.push_str(c);
                        on_delta(c.to_string());
                    }
                }
                if let Some(tc_array) = v["choices"][0]["delta"]["tool_calls"].as_array() {
                    for tc_delta in tc_array {
                        let index = tc_delta["index"].as_u64().unwrap_or(0) as usize;
                        while tool_calls_acc.len() <= index {
                            tool_calls_acc
                                .push(json!({"id":"","function":{"name":"","arguments":""}}));
                        }
                        if let Some(id) = tc_delta["id"].as_str() {
                            tool_calls_acc[index]["id"] = json!(id);
                        }
                        if let Some(name) = tc_delta["function"]["name"].as_str() {
                            tool_calls_acc[index]["function"]["name"] = json!(name);
                        }
                        if let Some(args) = tc_delta["function"]["arguments"].as_str() {
                            let prev = tool_calls_acc[index]["function"]["arguments"]
                                .as_str()
                                .unwrap_or("");
                            tool_calls_acc[index]["function"]["arguments"] =
                                json!(format!("{prev}{args}"));
                        }
                    }
                }
            }
        }
    }

    if in_think {
        full.push_str("</think>");
        on_delta("</think>".to_string());
    }

    let output_for_estimate = if full.is_empty() {
        serde_json::to_string(&tool_calls_acc).unwrap_or_default()
    } else {
        full.clone()
    };
    crate::token_usage::record_chat(messages, &output_for_estimate, api_usage);

    if !tool_calls_acc.is_empty() {
        let calls: Vec<ToolCall> = tool_calls_acc
            .iter()
            .filter_map(|tc| {
                Some(ToolCall {
                    id: tc["id"].as_str()?.to_string(),
                    name: tc["function"]["name"].as_str()?.to_string(),
                    arguments: tc["function"]["arguments"].as_str()?.to_string(),
                })
            })
            .collect();
        if calls.is_empty() {
            Ok(StreamOutcome::TextCompleted(full))
        } else {
            Ok(StreamOutcome::ToolCalls(calls))
        }
    } else {
        Ok(StreamOutcome::TextCompleted(full))
    }
}

// ── Anthropic streaming with tools ─────────────────────────────────

async fn stream_anthropic_with_tools(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[LlmMessage],
    tools: &[ToolDefinition],
    temperature: f32,
    max_tokens: u32,
    on_delta: &(impl Fn(String) + Send + Sync),
) -> Result<StreamOutcome> {
    let client = http_client();
    let system = messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| m.content.clone());
    let user_msgs = build_anthropic_user_messages(messages);
    let mut body = json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": user_msgs,
        "temperature": temperature,
        "stream": true,
    });
    if let Some(s) = system {
        body["system"] = json!(s);
    }
    if !tools.is_empty() {
        body["tools"] = build_anthropic_tools(tools);
    }
    let (auth_header, auth_value) = anthropic_auth_header(base_url, api_key);
    let resp = client
        .post(build_anthropic_messages_url(base_url))
        .header(auth_header, auth_value)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await?;

    let resp = ensure_http_success(resp, |status, body| {
        format_http_error(status, body, "Anthropic streaming error")
    })
    .await?;

    let mut full = String::new();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    let mut tool_calls_acc: Vec<ToolCall> = Vec::new();
    let mut stop_reason = String::new();
    let mut in_think = false;
    let mut usage_input: u64 = 0;
    let mut usage_output: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk?;
        append_sse_chunk(&mut buf, &bytes);
        for data in drain_sse_payloads(&mut buf) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
                match v["type"].as_str() {
                    Some("message_start") => {
                        let (i, _) = parse_anthropic_usage(&v["message"]["usage"]);
                        usage_input = i;
                    }
                    Some("content_block_start") => {
                        if v["content_block"]["type"].as_str() == Some("tool_use") {
                            let id = v["content_block"]["id"].as_str().unwrap_or("").to_string();
                            let name = v["content_block"]["name"]
                                .as_str()
                                .unwrap_or("")
                                .to_string();
                            tool_calls_acc.push(ToolCall {
                                id,
                                name,
                                arguments: String::new(),
                            });
                        }
                    }
                    Some("content_block_delta") => {
                        let delta = &v["delta"];
                        if delta["type"].as_str() == Some("input_json_delta") {
                            if let Some(partial) = delta["partial_json"].as_str() {
                                if let Some(last) = tool_calls_acc.last_mut() {
                                    last.arguments.push_str(partial);
                                }
                            }
                        }
                        if let Some(t) = delta["thinking"].as_str() {
                            if !t.is_empty() {
                                if !in_think {
                                    in_think = true;
                                    full.push_str("<think>");
                                    on_delta("<think>".to_string());
                                }
                                full.push_str(t);
                                on_delta(t.to_string());
                            }
                        }
                        if delta["type"].as_str() == Some("text_delta") {
                            if let Some(t) = delta["text"].as_str() {
                                if !t.is_empty() {
                                    if in_think {
                                        in_think = false;
                                        full.push_str("</think>");
                                        on_delta("</think>".to_string());
                                    }
                                    full.push_str(t);
                                    on_delta(t.to_string());
                                }
                            }
                        }
                    }
                    Some("message_delta") => {
                        if let Some(sr) = v["delta"]["stop_reason"].as_str() {
                            stop_reason = sr.to_string();
                        }
                        let (_, o) = parse_anthropic_usage(&v["usage"]);
                        if o > 0 {
                            usage_output = o;
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    if in_think {
        full.push_str("</think>");
        on_delta("</think>".to_string());
    }

    let output_for_estimate = if full.is_empty() {
        tool_calls_acc
            .iter()
            .map(|c| format!("{}{}", c.name, c.arguments))
            .collect::<String>()
    } else {
        full.clone()
    };
    let api_usage = (usage_input > 0 || usage_output > 0).then_some((usage_input, usage_output));
    crate::token_usage::record_chat(messages, &output_for_estimate, api_usage);

    if stop_reason == "tool_use" && !tool_calls_acc.is_empty() {
        Ok(StreamOutcome::ToolCalls(tool_calls_acc))
    } else {
        Ok(StreamOutcome::TextCompleted(full))
    }
}
