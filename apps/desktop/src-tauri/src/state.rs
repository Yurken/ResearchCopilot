use sqlx::SqlitePool;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex as StdMutex;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{Mutex, RwLock};

/// Sensitive settings keys — masked as "***" in GET responses.
pub const SENSITIVE_KEYS: &[&str] = &[
    "openai_api_key",
    "anthropic_api_key",
    "openai_compatible_api_key",
    "embedding_api_key",
    "github_api_key",
    "semantic_scholar_api_key",
    "tavily_api_key",
    "planner_hint_api_key",
    "planner_analysis_api_key",
    "planner_generation_api_key",
    "survey_planner_api_key",
    "survey_writer_api_key",
    "paper_analysis_api_key",
    "paper_reproduction_api_key",
    "copilot_simple_api_key",
    "multi_agent_supervisor_api_key",
    "multi_agent_worker_api_key",
    "multi_agent_planner_api_key",
    "multi_agent_literature_scout_api_key",
    "multi_agent_survey_api_key",
    "multi_agent_paper_analyst_api_key",
    "multi_agent_reproduction_api_key",
    "multi_agent_synthesis_api_key",
    "vision_api_key",
    "translation_api_key",
    "opencode_api_key",
    "app_lock_password_salt",
    "app_lock_password_hash",
];

/// All settings keys exposed through the API, with their default values.
pub fn default_settings() -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert("llm_provider".into(), "openai_compatible".into());
    m.insert("openai_api_key".into(), "".into());
    m.insert("openai_base_url".into(), "https://api.openai.com/v1".into());
    m.insert("openai_chat_model".into(), "gpt-4o-mini".into());
    m.insert(
        "openai_embedding_model".into(),
        "text-embedding-3-small".into(),
    );
    m.insert("anthropic_api_key".into(), "".into());
    m.insert(
        "anthropic_chat_model".into(),
        "claude-3-5-haiku-20241022".into(),
    );
    m.insert("openai_compatible_base_url".into(), "".into());
    m.insert("openai_compatible_api_key".into(), "".into());
    m.insert(
        "openai_compatible_chat_model".into(),
        "deepseek-chat".into(),
    );
    m.insert(
        "openai_compatible_embedding_model".into(),
        "BAAI/bge-m3".into(),
    );
    m.insert("chunk_size".into(), "800".into());
    m.insert("chunk_overlap".into(), "150".into());
    m.insert("rag_top_k".into(), "5".into());
    m.insert("embedding_base_url".into(), "".into());
    m.insert("embedding_api_key".into(), "".into());
    m.insert("embedding_model".into(), "".into());
    m.insert("paper_search_engine".into(), "arxiv".into());
    m.insert("github_api_key".into(), "".into());
    m.insert("semantic_scholar_api_key".into(), "".into());
    m.insert("planner_hint_model".into(), "".into());
    m.insert("planner_hint_base_url".into(), "".into());
    m.insert("planner_hint_api_key".into(), "".into());
    m.insert("planner_hint_temperature".into(), "0.2".into());
    m.insert("planner_hint_top_p".into(), "".into());
    m.insert("planner_hint_max_tokens".into(), "16384".into());
    m.insert("planner_hint_presence_penalty".into(), "".into());
    m.insert("planner_hint_frequency_penalty".into(), "".into());
    m.insert("planner_analysis_model".into(), "".into());
    m.insert("planner_analysis_base_url".into(), "".into());
    m.insert("planner_analysis_api_key".into(), "".into());
    m.insert("planner_analysis_temperature".into(), "0.2".into());
    m.insert("planner_analysis_top_p".into(), "".into());
    m.insert("planner_analysis_max_tokens".into(), "16384".into());
    m.insert("planner_analysis_presence_penalty".into(), "".into());
    m.insert("planner_analysis_frequency_penalty".into(), "".into());
    m.insert("planner_generation_model".into(), "".into());
    m.insert("planner_generation_base_url".into(), "".into());
    m.insert("planner_generation_api_key".into(), "".into());
    m.insert("planner_generation_temperature".into(), "0.3".into());
    m.insert("planner_generation_top_p".into(), "".into());
    m.insert("planner_generation_max_tokens".into(), "16384".into());
    m.insert("planner_generation_presence_penalty".into(), "".into());
    m.insert("planner_generation_frequency_penalty".into(), "".into());
    m.insert("survey_planner_model".into(), "".into());
    m.insert("survey_planner_base_url".into(), "".into());
    m.insert("survey_planner_api_key".into(), "".into());
    m.insert("survey_planner_temperature".into(), "0.2".into());
    m.insert("survey_planner_top_p".into(), "".into());
    m.insert("survey_planner_max_tokens".into(), "16384".into());
    m.insert("survey_planner_presence_penalty".into(), "".into());
    m.insert("survey_planner_frequency_penalty".into(), "".into());
    m.insert("survey_writer_model".into(), "".into());
    m.insert("survey_writer_base_url".into(), "".into());
    m.insert("survey_writer_api_key".into(), "".into());
    m.insert("survey_writer_temperature".into(), "0.3".into());
    m.insert("survey_writer_top_p".into(), "".into());
    m.insert("survey_writer_max_tokens".into(), "16384".into());
    m.insert("survey_writer_presence_penalty".into(), "".into());
    m.insert("survey_writer_frequency_penalty".into(), "".into());
    m.insert("paper_analysis_model".into(), "".into());
    m.insert("paper_analysis_base_url".into(), "".into());
    m.insert("paper_analysis_api_key".into(), "".into());
    m.insert("paper_analysis_temperature".into(), "0.3".into());
    m.insert("paper_analysis_top_p".into(), "".into());
    m.insert("paper_analysis_max_tokens".into(), "16384".into());
    m.insert("paper_analysis_presence_penalty".into(), "".into());
    m.insert("paper_analysis_frequency_penalty".into(), "".into());
    m.insert("paper_reproduction_model".into(), "".into());
    m.insert("paper_reproduction_base_url".into(), "".into());
    m.insert("paper_reproduction_api_key".into(), "".into());
    m.insert("paper_reproduction_temperature".into(), "0.25".into());
    m.insert("paper_reproduction_top_p".into(), "".into());
    m.insert("paper_reproduction_max_tokens".into(), "16384".into());
    m.insert("paper_reproduction_presence_penalty".into(), "".into());
    m.insert("paper_reproduction_frequency_penalty".into(), "".into());
    m.insert("copilot_simple_model".into(), "".into());
    m.insert("copilot_simple_base_url".into(), "".into());
    m.insert("copilot_simple_api_key".into(), "".into());
    m.insert("copilot_simple_temperature".into(), "0.4".into());
    m.insert("copilot_simple_top_p".into(), "".into());
    m.insert("copilot_simple_max_tokens".into(), "16384".into());
    m.insert("copilot_simple_presence_penalty".into(), "".into());
    m.insert("copilot_simple_frequency_penalty".into(), "".into());
    m.insert("xiaoyan_long_term_memory_enabled".into(), "true".into());
    m.insert("xiaoyan_companion_id".into(), "xiaoyan".into());
    m.insert("xiaoyan_active_researcher_enabled".into(), "true".into());
    m.insert("multi_agent_enabled".into(), "true".into());
    m.insert("multi_agent_routing_mode".into(), "hybrid".into());
    m.insert(
        "multi_agent_enabled_agents".into(),
        "retrieval,planner,literature_scout,survey,paper_analyst,reproduction,synthesis".into(),
    );
    m.insert("multi_agent_max_steps".into(), "6".into());
    m.insert("multi_agent_search_limit".into(), "8".into());
    m.insert("multi_agent_supervisor_model".into(), "".into());
    m.insert("web_search_enabled".into(), "true".into());
    m.insert("web_search_max_rounds".into(), "3".into());
    // 联网搜索来源：duckduckgo（免费、默认）| tavily（需用户填 tavily_api_key）
    m.insert("web_search_provider".into(), "duckduckgo".into());
    m.insert("tavily_api_key".into(), "".into());
    m.insert("multi_agent_supervisor_base_url".into(), "".into());
    m.insert("multi_agent_supervisor_api_key".into(), "".into());
    m.insert("multi_agent_supervisor_temperature".into(), "0.1".into());
    m.insert("multi_agent_supervisor_top_p".into(), "".into());
    m.insert("multi_agent_supervisor_max_tokens".into(), "16384".into());
    m.insert("multi_agent_supervisor_presence_penalty".into(), "".into());
    m.insert("multi_agent_supervisor_frequency_penalty".into(), "".into());
    m.insert("multi_agent_worker_model".into(), "".into());
    m.insert("multi_agent_worker_base_url".into(), "".into());
    m.insert("multi_agent_worker_api_key".into(), "".into());
    m.insert("multi_agent_worker_temperature".into(), "0.3".into());
    m.insert("multi_agent_worker_top_p".into(), "".into());
    m.insert("multi_agent_worker_max_tokens".into(), "16384".into());
    m.insert("multi_agent_worker_presence_penalty".into(), "".into());
    m.insert("multi_agent_worker_frequency_penalty".into(), "".into());
    m.insert("multi_agent_planner_model".into(), "".into());
    m.insert("multi_agent_planner_base_url".into(), "".into());
    m.insert("multi_agent_planner_api_key".into(), "".into());
    m.insert("multi_agent_planner_temperature".into(), "".into());
    m.insert("multi_agent_planner_top_p".into(), "".into());
    m.insert("multi_agent_planner_max_tokens".into(), "16384".into());
    m.insert("multi_agent_planner_presence_penalty".into(), "".into());
    m.insert("multi_agent_planner_frequency_penalty".into(), "".into());
    m.insert("multi_agent_literature_scout_model".into(), "".into());
    m.insert("multi_agent_literature_scout_base_url".into(), "".into());
    m.insert("multi_agent_literature_scout_api_key".into(), "".into());
    m.insert("multi_agent_literature_scout_temperature".into(), "".into());
    m.insert("multi_agent_literature_scout_top_p".into(), "".into());
    m.insert(
        "multi_agent_literature_scout_max_tokens".into(),
        "16384".into(),
    );
    m.insert(
        "multi_agent_literature_scout_presence_penalty".into(),
        "".into(),
    );
    m.insert(
        "multi_agent_literature_scout_frequency_penalty".into(),
        "".into(),
    );
    m.insert("multi_agent_survey_model".into(), "".into());
    m.insert("multi_agent_survey_base_url".into(), "".into());
    m.insert("multi_agent_survey_api_key".into(), "".into());
    m.insert("multi_agent_survey_temperature".into(), "".into());
    m.insert("multi_agent_survey_top_p".into(), "".into());
    m.insert("multi_agent_survey_max_tokens".into(), "16384".into());
    m.insert("multi_agent_survey_presence_penalty".into(), "".into());
    m.insert("multi_agent_survey_frequency_penalty".into(), "".into());
    m.insert("multi_agent_paper_analyst_model".into(), "".into());
    m.insert("multi_agent_paper_analyst_base_url".into(), "".into());
    m.insert("multi_agent_paper_analyst_api_key".into(), "".into());
    m.insert("multi_agent_paper_analyst_temperature".into(), "".into());
    m.insert("multi_agent_paper_analyst_top_p".into(), "".into());
    m.insert(
        "multi_agent_paper_analyst_max_tokens".into(),
        "16384".into(),
    );
    m.insert(
        "multi_agent_paper_analyst_presence_penalty".into(),
        "".into(),
    );
    m.insert(
        "multi_agent_paper_analyst_frequency_penalty".into(),
        "".into(),
    );
    m.insert("multi_agent_reproduction_model".into(), "".into());
    m.insert("multi_agent_reproduction_base_url".into(), "".into());
    m.insert("multi_agent_reproduction_api_key".into(), "".into());
    m.insert("multi_agent_reproduction_temperature".into(), "".into());
    m.insert("multi_agent_reproduction_top_p".into(), "".into());
    m.insert("multi_agent_reproduction_max_tokens".into(), "16384".into());
    m.insert(
        "multi_agent_reproduction_presence_penalty".into(),
        "".into(),
    );
    m.insert(
        "multi_agent_reproduction_frequency_penalty".into(),
        "".into(),
    );
    m.insert("multi_agent_synthesis_model".into(), "".into());
    m.insert("multi_agent_synthesis_base_url".into(), "".into());
    m.insert("multi_agent_synthesis_api_key".into(), "".into());
    m.insert("multi_agent_synthesis_temperature".into(), "0.4".into());
    m.insert("multi_agent_synthesis_top_p".into(), "".into());
    m.insert("multi_agent_synthesis_max_tokens".into(), "16384".into());
    m.insert("multi_agent_synthesis_presence_penalty".into(), "".into());
    m.insert("multi_agent_synthesis_frequency_penalty".into(), "".into());
    m.insert(
        "paper_visible_venue_tags".into(),
        "ccf_rating,ccf_type,wos_indexes,jcr_quartile,cas_quartile,cas_top".into(),
    );
    m.insert("paper_import_recognize_title".into(), "true".into());
    m.insert("paper_import_recognize_authors".into(), "true".into());
    m.insert("paper_import_recognize_year".into(), "true".into());
    m.insert("paper_import_recognize_venue".into(), "true".into());
    m.insert("paper_import_recognize_keywords".into(), "true".into());
    m.insert("paper_auto_rename_on_import".into(), "false".into());
    m.insert(
        "paper_auto_rename_rule".into(),
        "{first_author} - {title} ({year})".into(),
    );
    m.insert("vision_model".into(), "".into());
    m.insert("vision_base_url".into(), "".into());
    m.insert("vision_api_key".into(), "".into());
    m.insert("vision_temperature".into(), "0.2".into());
    m.insert("vision_top_p".into(), "".into());
    m.insert("vision_max_tokens".into(), "16384".into());
    m.insert("vision_presence_penalty".into(), "".into());
    m.insert("vision_frequency_penalty".into(), "".into());
    m.insert("translation_model".into(), "".into());
    m.insert("translation_base_url".into(), "".into());
    m.insert("translation_api_key".into(), "".into());
    m.insert("translation_temperature".into(), "0.1".into());
    m.insert("translation_top_p".into(), "".into());
    m.insert("translation_max_tokens".into(), "16384".into());
    m.insert("translation_presence_penalty".into(), "".into());
    m.insert("translation_frequency_penalty".into(), "".into());
    m.insert("app_lock_enabled".into(), "false".into());
    m.insert("app_lock_password_salt".into(), "".into());
    m.insert("app_lock_password_hash".into(), "".into());
    m.insert("app_lock_timeout_minutes".into(), "0".into());
    // OpenCode settings
    m.insert("opencode_enabled".into(), "true".into());
    m.insert("opencode_binary_path".into(), "".into());
    m.insert("opencode_model".into(), "".into());
    m.insert("opencode_base_url".into(), "".into());
    m.insert("opencode_api_key".into(), "".into());
    m.insert("opencode_temperature".into(), "0.3".into());
    m.insert("opencode_max_tokens".into(), "16384".into());
    m
}

/// 一次流式对话的运行时元数据：
/// - `partial`：已累计的助手回答增量（delta 原文拼接），取消/失败时用于补写部分消息。
/// - `persisted`：助手消息是否已落库（正常完成或失败路径写入后置位），
///   防止 chat_cancel 与任务自身收尾重复插入。
pub struct ChatStreamMeta {
    pub session_id: String,
    pub partial: StdMutex<String>,
    pub persisted: AtomicBool,
}

impl ChatStreamMeta {
    pub fn new(session_id: String) -> Self {
        Self {
            session_id,
            partial: StdMutex::new(String::new()),
            persisted: AtomicBool::new(false),
        }
    }

    pub fn push_delta(&self, delta: &str) {
        if let Ok(mut partial) = self.partial.lock() {
            partial.push_str(delta);
        }
    }

    pub fn take_partial(&self) -> String {
        self.partial
            .lock()
            .map(|partial| partial.clone())
            .unwrap_or_default()
    }

    /// 标记已落库；返回此前是否已落库（false = 本次调用负责写入）。
    pub fn mark_persisted(&self) -> bool {
        self.persisted.swap(true, Ordering::SeqCst)
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    /// In-memory settings cache; loaded from DB at startup.
    pub settings: Arc<RwLock<HashMap<String, String>>>,
    /// Active chat stream handles keyed by request_id.
    pub chat_handles: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    /// 活跃 chat 流的元数据（部分内容缓冲 + 落库标记），供取消/错误路径补写部分回答。
    /// 在流启动前注册，保证最早的 delta 也能被记录；用 std Mutex 以便
    /// emit_agent_event 等同步上下文访问（锁内不做 await）。
    pub chat_stream_meta: Arc<StdMutex<HashMap<String, Arc<ChatStreamMeta>>>>,
    /// Active translation stream handles keyed by request_id.
    pub translation_handles: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    /// Active code assistant stream handles keyed by request_id.
    pub code_handles: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    /// Pending code tool permission senders keyed by permission_id.
    pub code_permissions: Arc<
        Mutex<HashMap<String, tokio::sync::oneshot::Sender<crate::code::CodePermissionDecision>>>,
    >,
    /// 串行化 WebDAV 同步：保证同一时刻只有一次同步在运行。
    pub sync_lock: Arc<Mutex<()>>,
    /// 同步状态，供前端订阅展示。
    pub sync_status: Arc<RwLock<crate::services::sync_service::SyncStatus>>,
}

impl AppState {
    /// 记录流式增量到对应请求的部分内容缓冲（请求已结束/不存在时忽略）。
    pub fn record_chat_delta(&self, request_id: &str, delta: &str) {
        let meta = self
            .chat_stream_meta
            .lock()
            .ok()
            .and_then(|registry| registry.get(request_id).cloned());
        if let Some(meta) = meta {
            meta.push_delta(delta);
        }
    }

    pub fn new(db: SqlitePool, settings: HashMap<String, String>) -> Self {
        Self {
            db,
            settings: Arc::new(RwLock::new(settings)),
            chat_handles: Arc::new(Mutex::new(HashMap::new())),
            chat_stream_meta: Arc::new(StdMutex::new(HashMap::new())),
            translation_handles: Arc::new(Mutex::new(HashMap::new())),
            code_handles: Arc::new(Mutex::new(HashMap::new())),
            code_permissions: Arc::new(Mutex::new(HashMap::new())),
            sync_lock: Arc::new(Mutex::new(())),
            sync_status: Arc::new(RwLock::new(
                crate::services::sync_service::SyncStatus::default(),
            )),
        }
    }
}
