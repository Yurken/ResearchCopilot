use crate::{
    commands::memory, graph_rag::collect_graph_rag_sources, llm::LlmClient,
    services::research_context_service::build_research_context_summary,
};
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;

/// 把一句话向量化（best-effort）。未配置 embedding 客户端或调用失败时返回 None，
/// 调用方据此优雅退回纯关键词逻辑。
pub async fn embed_query(settings: &HashMap<String, String>, message: &str) -> Option<Vec<f32>> {
    let client = LlmClient::embed_client_from_settings(settings).ok()?;
    let embeddings = client.embed(&[message.to_string()]).await.ok()?;
    embeddings.into_iter().next()
}

pub async fn build_chat_context_summary(
    db: &SqlitePool,
    context_type: &str,
    context_id: &Option<String>,
    user_message: &str,
    include_long_term_memory: bool,
    query_embedding: Option<&[f32]>,
) -> String {
    let base_context = match context_type {
        "interest" => match context_id.as_deref() {
            Some(interest_id) => build_research_context_summary(db, interest_id).await,
            None => String::new(),
        },
        "paper" => paper_context_summary(db, context_id).await,
        _ => String::new(),
    };

    let memory_context = if include_long_term_memory {
        memory::build_memory_context_for_query(db, user_message, query_embedding).await
    } else {
        String::new()
    };

    if memory_context.is_empty() {
        base_context
    } else if base_context.is_empty() {
        format!("【用户记忆与近期操作】\n{memory_context}")
    } else {
        format!("{base_context}\n\n【用户记忆与近期操作】\n{memory_context}")
    }
}

pub async fn collect_chat_sources(
    db: &SqlitePool,
    settings: &HashMap<String, String>,
    message: &str,
    query_embedding: Option<&[f32]>,
    allow_embedding: bool,
) -> Vec<Value> {
    // 复用上游已算好的 query 向量；缺省时再自行 embed，避免一轮对话重复向量化。
    let embedding = match query_embedding {
        Some(value) => Some(value.to_vec()),
        None if allow_embedding => embed_query(settings, message).await,
        None => None,
    };

    let top_k = settings
        .get("rag_top_k")
        .and_then(|value| value.parse().ok())
        .unwrap_or(5);
    let results = match crate::services::wiki::retrieval::hybrid_search(
        db,
        message,
        embedding.as_deref(),
        top_k,
    )
    .await
    {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    let mut merged = results
        .into_iter()
        .map(|item| json!({ "content": item.content, "source": item.source, "url": item.url }))
        .collect::<Vec<_>>();

    if let Some(embedding) = embedding.as_deref() {
        if let Ok(graph_sources) = collect_graph_rag_sources(db, embedding, top_k).await {
            merged.extend(graph_sources);
        }
    }

    merged
}

async fn paper_context_summary(db: &SqlitePool, context_id: &Option<String>) -> String {
    let Some(paper_id) = context_id.as_deref() else {
        return String::new();
    };

    let row = match sqlx::query("SELECT title, abstract, status FROM papers WHERE id = ?")
        .bind(paper_id)
        .fetch_optional(db)
        .await
    {
        Ok(Some(row)) => row,
        _ => return String::new(),
    };

    let mut lines = vec![format!("当前论文：{}", row.get::<String, _>("title"))];

    if let Some(status) = row.get::<Option<String>, _>("status") {
        lines.push(format!("论文状态：{}", status));
    }
    if let Some(abstract_text) = row.get::<Option<String>, _>("abstract") {
        let preview = if abstract_text.chars().count() > 240 {
            abstract_text.chars().take(240).collect::<String>() + "…"
        } else {
            abstract_text
        };
        lines.push(format!("摘要：{}", preview));
    }

    lines.join("\n")
}
