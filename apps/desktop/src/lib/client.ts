/**
 * Desktop Tauri client — replaces HTTP SDK with invoke() calls.
 * Implements the same interface as @research-copilot/api-sdk so pages
 * require minimal changes.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  ArxivRankingMode,
  PaperSearchDepth,
  ArxivSearchRequest,
  ArxivSearchResponse,
  Artifact,
  ArtifactKind,
  CcfListResponse,
  CcfLookupResponse,
  GithubProjectSearchResponse,
  GithubProjectSearchHistoryEntry,
  JournalLookupResponse,
  SourceLookupResponse,
  Paper,
  ChatMessage,
  ChatSession,
  ResearchInterest,
  ResearchInterestProfile,
  ResearchHypothesisCard,
  ResearchInterestHintRequest,
  ResearchInterestHintResponse,
  KnowledgeNote,
  Skill,
  AppSettings,
  AppUpdateInfo,
  AgentRun,
  ExperimentCodeSession,
  ExperimentRecord,
  ExperimentSnapshot,
  FieldDynamicsListResult,
  FieldDynamicsScanResult,
  FieldDynamicsHistoryResult,
  SettingsHistoryEntry,
  SurveySummary,
  SavedSurvey,
  TavilyKeyTest,
  WebSearchOutcome,
} from "@research-copilot/types";
import { invalidatePaperListCache, loadPaperListOnce } from "./paperListCache";
import { streamChat } from "./chatStream";
import { streamTranslation } from "./translationStream";
export { streamChat } from "./chatStream";
import type {
  WritingDraft,
  WritingVersionRecordResult,
  WritingVersionSnapshot,
  WritingVersionSummary,
} from "../features/writing/shared";
import type {
  CitationCentralityEntry,
  CitationPathResult,
  CitationSubgraph,
  KnowledgeClaimStatus,
  KnowledgeEvidenceRelationKind,
  KnowledgeGraphSnapshot,
} from "../features/knowledge/shared";
import type {
  ResearchTheme,
  ResearchActivityEvent,
  EvidenceLink,
} from "../features/research-context/shared";

// ── Helpers ──────────────────────────────────────────────────────

export function formatErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const normalized = raw.trim();

  if (!normalized) return "操作未完成，请稍后重试。";
  if (/^\?+$/.test(normalized)) {
    return "论文解读未生成有效内容，请检查模型配置或稍后重试。";
  }

  if (/<!doctype html|<html/i.test(normalized)) {
    return "接口返回了网页 HTML，而不是模型 API JSON。请检查自定义 base_url 是否填写为 OpenAI 兼容 API 根地址（通常以 /v1 结尾）。";
  }

  const directMap: Record<string, string> = {
    "Session not found": "未找到对应会话。",
    "Research interest not found": "未找到对应研究主题。",
    "Interest not found": "未找到对应研究主题。",
    "Note not found": "未找到对应笔记。",
    "Paper not found": "未找到对应论文。",
    "Expected object": "请求参数格式不正确。",
  };

  if (directMap[normalized]) return directMap[normalized];

  return normalized
    .replace(/^PDF extraction failed:/i, "PDF 解析失败：")
    .replace(/^error:\s*/i, "");
}

// ── Settings ─────────────────────────────────────────────────────

export interface SyncSummary {
  pushed: boolean;
  pulled_devices: number;
  rows_applied: number;
  rows_deleted: number;
  assets_uploaded: number;
  assets_downloaded: number;
}

export interface SyncStatus {
  configured: boolean;
  running: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  last_message: string | null;
}

export interface SyncConfigView {
  configured: boolean;
  has_saved_credentials: boolean;
  url: string;
  username: string;
}

export interface TokenUsageBucket {
  input: number;
  output: number;
  total: number;
  chars: number;
  requests: number;
}

export interface TokenUsageStats {
  total: TokenUsageBucket;
  today: TokenUsageBucket;
  month: TokenUsageBucket;
}

export const settingsApi = {
  get: (): Promise<AppSettings> => invoke("settings_get"),
  update: (data: Partial<AppSettings>): Promise<{ ok: boolean; updated: string[] }> =>
    invoke("settings_update", { data }),
  test: (data: Partial<AppSettings>): Promise<string> =>
    invoke("settings_test", { data }),
  testVision: (data: Partial<AppSettings>): Promise<string> =>
    invoke("settings_test_vision", { data }),
  export: (password: string): Promise<string> =>
    invoke("settings_export", { password }),
  import: (data: string, password: string): Promise<string[]> =>
    invoke("settings_import", { data, password }),
  readDiagnosticLog: (): Promise<{ name: string; content: string }> =>
    invoke("read_diagnostic_log"),
  feedback: {
    submit: (payload: {
      text?: string;
      contact?: string;
      category?: string;
      images?: string[];
      log?: { name: string; content: string } | null;
    }): Promise<{ ok: boolean; id?: number; createdAt?: string }> =>
      invoke("feedback_submit", { payload }),
  },
  dataBackup: {
    export: (password: string): Promise<string> =>
      invoke("data_backup_export", { password }),
    import: (data: string, password: string): Promise<void> =>
      invoke("data_backup_import", { data, password }),
  },
  webdav: {
    testConnection: (url: string, username: string, password: string): Promise<void> =>
      invoke("webdav_test_connection", { url, username, password }),
    listBackups: (url: string, username: string, password: string): Promise<Array<{name: string; path: string; size: number; lastModified: string}>> =>
      invoke("webdav_list_backups", { url, username, password }),
    uploadBackup: (url: string, username: string, password: string): Promise<string> =>
      invoke("webdav_upload_backup", { url, username, password }),
    downloadBackup: (url: string, username: string, password: string, filename: string): Promise<void> =>
      invoke("webdav_download_backup", { url, username, password, filename }),
    deleteBackup: (url: string, username: string, password: string, filename: string): Promise<void> =>
      invoke("webdav_delete_backup", { url, username, password, filename }),
  },
  // 无冲突自动同步（凭据存入系统钥匙串，全平台记录级合并）
  sync: {
    configure: (url: string, username: string, password: string): Promise<SyncSummary> =>
      invoke("sync_configure", { url, username, password }),
    getConfig: (): Promise<SyncConfigView> => invoke("sync_get_config"),
    status: (): Promise<SyncStatus> => invoke("sync_status"),
    now: (): Promise<SyncSummary | null> => invoke("sync_now"),
    disable: (): Promise<void> => invoke("sync_disable"),
  },
  tokenUsage: (): Promise<TokenUsageStats> => invoke("token_usage_stats"),
  listOllamaModels: (baseUrl?: string): Promise<string[]> =>
    invoke("settings_list_ollama_models", { baseUrl: baseUrl ?? null }),
  listModels: (data: Partial<AppSettings> & { list_models_base_url?: string; list_models_api_key?: string }): Promise<string[]> =>
    invoke("settings_list_models", { data }),
  testTavily: (data: Partial<AppSettings>): Promise<TavilyKeyTest[]> =>
    invoke("settings_test_tavily", { data }),
  appLock: {
    status: (): Promise<{ enabled: boolean; timeoutMinutes: number; hasSecurity: boolean; hasHint: boolean; hasEmail: boolean }> =>
      invoke("app_lock_status"),
    setPassword: (password: string, hint?: string, email?: string): Promise<{ enabled: boolean }> =>
      invoke("app_lock_set_password", { password, hint: hint ?? null, email: email ?? "" }),
    verifyPassword: (password: string): Promise<boolean> =>
      invoke("app_lock_verify_password", { password }),
    clearPassword: (): Promise<{ enabled: boolean }> =>
      invoke("app_lock_clear_password"),
    setTimeout: (minutes: string): Promise<void> =>
      invoke("app_lock_set_timeout", { minutes }),
    getHint: (): Promise<string> =>
      invoke("app_lock_get_hint"),
    getRecoveryInfo: (): Promise<{ hint: string; question: string; hasEmail: boolean; hasSecurity: boolean }> =>
      invoke("app_lock_get_recovery_info"),
    setSecurity: (question: string, answer: string): Promise<void> =>
      invoke("app_lock_set_security", { question, answer }),
    verifyRecovery: (email: string, answer: string): Promise<boolean> =>
      invoke("app_lock_verify_recovery", { email, answer }),
    resetPassword: (email: string, answer: string, newPassword: string): Promise<{ enabled: boolean }> =>
      invoke("app_lock_reset_password", { email, answer, newPassword }),
  },
  history: {
    list: (): Promise<SettingsHistoryEntry[]> =>
      invoke("settings_history_list"),
    save: (data: Partial<AppSettings>, name?: string): Promise<SettingsHistoryEntry> =>
      invoke("settings_history_save", { data, name: name ?? null }),
    update: (id: string, data: Partial<AppSettings>, name?: string): Promise<SettingsHistoryEntry> =>
      invoke("settings_history_update", { id, data, name: name ?? null }),
    rename: (id: string, name: string): Promise<SettingsHistoryEntry> =>
      invoke("settings_history_rename", { id, name }),
    apply: (id: string): Promise<AppSettings> =>
      invoke("settings_history_apply", { id }),
    delete: (id: string): Promise<void> =>
      invoke("settings_history_delete", { id }),
  },
};

export const updatesApi = {
  check: (): Promise<AppUpdateInfo> => invoke("update_check"),
  install: (): Promise<void> => invoke("update_install"),
};

// ── Papers ───────────────────────────────────────────────────────

export const papersApi = {
  list: (offset = 0, limit = 20, research_interest_id?: string): Promise<Paper[]> => {
    const load = () => invoke<Paper[]>("papers_list", {
      offset,
      limit,
      researchInterestId: research_interest_id ?? null,
    });
    return offset === 0 && limit === 500 && !research_interest_id
      ? loadPaperListOnce(load)
      : load();
  },
  get: (id: string): Promise<Paper> =>
    invoke("papers_get", { id }),
  listParseRuns: (paper_id: string): Promise<{ runs: unknown[] }> =>
    invoke("papers_list_parse_runs", { paperId: paper_id }),
  upload: async (filePath: string, research_interest_id?: string, suggested_title?: string): Promise<{ paper_id: string; title: string }> => {
    const result = await invoke<{ paper_id: string; title: string }>("papers_upload", { filePath, researchInterestId: research_interest_id ?? null, suggestedTitle: suggested_title ?? null });
    invalidatePaperListCache();
    return result;
  },
  update: async (id: string, data: { title?: string; authors?: string; venue?: string; year?: number; doi?: string; research_interest_id?: string; importance_color?: string; notes?: string; tags?: string[] }): Promise<Paper> => {
    const result = await invoke<Paper>("papers_update", {
      id,
      title: data.title ?? null,
      authors: data.authors ?? null,
      venue: data.venue ?? null,
      year: data.year ?? null,
      doi: data.doi ?? null,
      researchInterestId: data.research_interest_id ?? null,
      importanceColor: data.importance_color ?? null,
      notes: data.notes ?? null,
      tags: data.tags ?? null,
    });
    invalidatePaperListCache();
    return result;
  },
  reorder: async (orderedIds: string[]): Promise<void> => {
    await invoke("papers_reorder", { orderedIds });
    invalidatePaperListCache();
  },
  delete: async (id: string): Promise<void> => {
    await invoke("papers_delete", { id });
    invalidatePaperListCache();
  },
  merge: async (keepId: string, deleteIds: string[]): Promise<Paper> => {
    const result = await invoke<Paper>("papers_merge", { keepId, deleteIds });
    invalidatePaperListCache();
    return result;
  },
  openFile: (id: string): Promise<void> =>
    invoke("papers_open_pdf", { id }),
  revealInFolder: (id: string): Promise<void> =>
    invoke("papers_reveal_in_folder", { id }),
  analyze: async (id: string): Promise<void> => {
    await invoke("papers_analyze", { id });
    invalidatePaperListCache();
  },
  reparse: async (id: string): Promise<void> => {
    await invoke("papers_reparse", { id });
    invalidatePaperListCache();
  },
  reproduce: async (id: string): Promise<void> => {
    await invoke("papers_reproduce", { id });
    invalidatePaperListCache();
  },
  generateNote: (id: string): Promise<KnowledgeNote> =>
    invoke("papers_generate_note", { id }),
  listFigures: (paper_id: string): Promise<Array<{ id: string; paper_id: string; fig_index: number; kind?: string; caption: string | null; data_url: string }>> =>
    invoke("papers_list_figures", { paperId: paper_id }),
  extractPdfText: (filePath: string, max_chars = 32000): Promise<string> =>
    invoke("papers_extract_pdf_text", { filePath, maxChars: max_chars }),
};

export const paperNotesApi = {
  list: (paperId: string): Promise<unknown[]> =>
    invoke("paper_notes_list", { paperId }),
  create: (data: {
    paper_id: string;
    page: number;
    content: string;
    highlight_text?: string;
    highlight_color?: string;
    highlight_positions?: unknown[];
    style?: string;
    fill_color?: string;
  }): Promise<unknown> =>
    invoke("paper_notes_create", {
      paperId: data.paper_id,
      page: data.page,
      content: data.content,
      highlightText: data.highlight_text ?? null,
      highlightColor: data.highlight_color ?? null,
      highlightPositions: data.highlight_positions ?? null,
      style: data.style ?? null,
      fillColor: data.fill_color ?? null,
    }),
  update: (id: string, data: { content?: string; highlight_color?: string; highlight_positions?: unknown[]; fill_color?: string }): Promise<unknown> =>
    invoke("paper_notes_update", {
      id,
      content: data.content ?? null,
      highlightColor: data.highlight_color ?? null,
      highlightPositions: data.highlight_positions ?? null,
      fillColor: data.fill_color ?? null,
    }),
  delete: (id: string): Promise<void> =>
    invoke("paper_notes_delete", { id }),
};

export const paperCorpusApi = {
  list: (paperId?: string): Promise<unknown[]> =>
    invoke("paper_corpus_list", { paperId: paperId ?? null }),
  create: (data: {
    paper_id?: string;
    text: string;
    note?: string;
    page?: number;
    tags?: string[];
  }): Promise<unknown> =>
    invoke("paper_corpus_create", {
      paperId: data.paper_id ?? null,
      text: data.text,
      note: data.note ?? null,
      page: data.page ?? null,
      tags: data.tags ?? null,
    }),
  update: (id: string, data: { note?: string }): Promise<unknown> =>
    invoke("paper_corpus_update", { id, note: data.note ?? null }),
  delete: (id: string): Promise<void> =>
    invoke("paper_corpus_delete", { id }),
};

export const ccfApi = {
  list: (): Promise<CcfListResponse> =>
    invoke("ccf_list"),
  lookup: (query: string, limit = 8): Promise<CcfLookupResponse> =>
    invoke("ccf_lookup", { query, limit }),
};

export const journalApi = {
  lookup: (query: string, limit = 8): Promise<JournalLookupResponse> =>
    invoke("journal_lookup", { query, limit }),
  rankFilter: (wosCatKeywords: string[], ranks: string[]): Promise<string[]> =>
    invoke("journal_rank_filter", { wosCatKeywords, ranks }),
};

export const sourceApi = {
  lookup: (query: string, limit = 8): Promise<SourceLookupResponse> =>
    invoke("source_lookup", { query, limit }),
};

export const arxivApi = {
  search: (
    request: ArxivSearchRequest,
    days = 14,
    limit = 5,
    ranking_mode: ArxivRankingMode = "relevance"
  ): Promise<ArxivSearchResponse> =>
    invoke("arxiv_search", { request, days, limit, rankingMode: ranking_mode }),
};

export interface PaperSearchHistoryEntry {
  id: string;
  draft_json: string;
  result_json: string;
  created_at: string;
}

export const paperSearchApi = {
  search: (
    request: ArxivSearchRequest,
    cutoffDate: string,
    limit = 5,
    ranking_mode: ArxivRankingMode = "relevance",
    search_depth: PaperSearchDepth = "balanced",
  ): Promise<ArxivSearchResponse> =>
    invoke("paper_search", { request, cutoffDate, limit, rankingMode: ranking_mode, searchDepth: search_depth }),
  saveHistory: (draft_json: string, result_json: string): Promise<PaperSearchHistoryEntry> =>
    invoke("paper_search_save_history", { request: { draft_json, result_json } }),
  getHistory: (limit = 20): Promise<PaperSearchHistoryEntry[]> =>
    invoke("paper_search_get_history", { limit }),
  deleteHistory: (id: string): Promise<boolean> =>
    invoke("paper_search_delete_history", { id }),
};

export const webSearchApi = {
  query: (query: string, cutoffDate?: string): Promise<WebSearchOutcome> =>
    invoke("web_search_query", { query, cutoffDate: cutoffDate ?? null }),
};

export const githubProjectApi = {
  search: (query: string, limit = 8): Promise<GithubProjectSearchResponse> =>
    invoke("github_project_search", { request: { query, limit } }),
  saveSearchHistory: (query: string, result: GithubProjectSearchResponse): Promise<GithubProjectSearchHistoryEntry> =>
    invoke("github_project_save_search_history", {
      request: { query, result_json: JSON.stringify(result) },
    }),
  getSearchHistory: (limit = 20): Promise<GithubProjectSearchHistoryEntry[]> =>
    invoke("github_project_get_search_history", { limit }),
  deleteSearchHistory: (id: string): Promise<boolean> =>
    invoke("github_project_delete_search_history", { id }),
};

// ── Knowledge ─────────────────────────────────────────────────────

export interface ResearchIdeaSuggestion {
  title: string;
  hypothesis: string;
  rationale: string;
  evidence: string[];
  counter_evidence: string[];
  falsification: string;
  validation_steps: string[];
  uncertainties: string[];
  keywords: string[];
}

export interface KnowledgeImportZipResult {
  imported: number;
  errors: string[];
  notes: Array<{
    note: KnowledgeNote;
    assets: Array<[string, string]>;
  }>;
}

export const knowledgeApi = {
  listInterests: (): Promise<ResearchInterest[]> =>
    invoke("knowledge_list_interests"),
  createInterest: (
    topic: string,
    keywords: string[],
    profile?: ResearchInterestProfile,
    hypothesisCard?: ResearchHypothesisCard,
  ): Promise<ResearchInterest> =>
    invoke("knowledge_create_interest", { topic, keywords, profile: profile ?? null, hypothesisCard: hypothesisCard ?? null }),
  createFolder: (name: string, parentId?: string | null): Promise<ResearchInterest> =>
    invoke("knowledge_create_folder", { name, parentId: parentId ?? null }),
  moveInterest: (id: string, parentId: string | null): Promise<ResearchInterest> =>
    invoke("knowledge_move_interest", { id, parentId: parentId ?? null }),
  updateInterestFolder: (id: string, folder_name: string): Promise<ResearchInterest> =>
    invoke("knowledge_update_interest_folder", { id, folderName: folder_name }),
  deleteInterestBundle: (id: string): Promise<{ deleted_interest_id: string; deleted_sessions: number; deleted_notes: number; deleted_papers: number }> =>
    invoke("knowledge_delete_interest_bundle", { id }),
  deleteInterestOnly: (id: string): Promise<{ deleted_interest_id: string }> =>
    invoke("knowledge_delete_interest_only", { id }),
  generateInterestHints: (data: ResearchInterestHintRequest): Promise<ResearchInterestHintResponse> =>
    invoke("knowledge_generate_interest_hints", {
      topic: data.topic,
      keywords: data.keywords ?? null,
      goal: data.goal ?? null,
      background: data.background ?? null,
      timeBudget: data.time_budget ?? null,
      constraints: data.constraints ?? null,
      knownContext: data.known_context ?? null,
      preferredOutput: data.preferred_output ?? null,
    }),
  suggestTopics: (field: string, goalType: string, background: string): Promise<string[]> =>
    invoke("knowledge_suggest_topics", { field, goalType: goalType, background }),
  ideasFromMaterials: (
    materials: string,
    images: { data: string; mediaType: string }[],
    feedback?: string,
  ): Promise<ResearchIdeaSuggestion[]> =>
    invoke("knowledge_ideas_from_materials", { materials, images, feedback: feedback ?? null }),
  generatePlan: (id: string, startStep?: number): Promise<void> =>
    invoke("knowledge_generate_plan", { id, startStep: startStep ?? null }),
  listNotes: (search?: string): Promise<KnowledgeNote[]> =>
    invoke("knowledge_list_notes", { search: search ?? null }),
  listNotesBySource: (source_type: string, source_id: string): Promise<KnowledgeNote[]> =>
    invoke("knowledge_list_notes_by_source", { sourceType: source_type, sourceId: source_id }),
  createNote: (data: {
    title: string;
    content: string;
    tags?: string[];
    research_interest_id?: string;
    source_type?: string;
    source_id?: string;
  }): Promise<KnowledgeNote> =>
    invoke("knowledge_create_note", {
      title: data.title,
      content: data.content,
      tags: data.tags ?? null,
      researchInterestId: data.research_interest_id ?? null,
      sourceType: data.source_type ?? null,
      sourceId: data.source_id ?? null,
    }),
  updateNote: (id: string, data: { title?: string; content?: string; tags?: string[] }): Promise<KnowledgeNote> =>
    invoke("knowledge_update_note", {
      id,
      title: data.title ?? null,
      content: data.content ?? null,
      tags: data.tags ?? null,
    }),
  moveNote: (id: string, research_interest_id?: string): Promise<KnowledgeNote> =>
    invoke("knowledge_move_note", {
      id,
      researchInterestId: research_interest_id ?? null,
    }),
  deleteNote: (id: string): Promise<void> =>
    invoke("knowledge_delete_note", { id }),
  webClip: (url: string, researchInterestId?: string): Promise<KnowledgeNote> =>
    invoke("knowledge_web_clip", { url, researchInterestId: researchInterestId ?? null }),
  importZip: (filePath: string, researchInterestId?: string): Promise<KnowledgeImportZipResult> =>
    invoke("knowledge_import_zip", { filePath, researchInterestId: researchInterestId ?? null }),
  graph: {
    snapshot: (): Promise<KnowledgeGraphSnapshot> =>
      invoke("knowledge_graph_snapshot"),
    createClaim: (data: {
      title: string;
      statement: string;
      researchInterestId?: string;
      status?: KnowledgeClaimStatus;
    }) =>
      invoke("knowledge_graph_create_claim", {
        title: data.title,
        statement: data.statement,
        researchInterestId: data.researchInterestId ?? null,
        status: data.status ?? null,
      }),
    deleteClaim: (id: string) =>
      invoke<void>("knowledge_graph_delete_claim", { id }),
    createEvidence: (data: {
      claimId: string;
      sourceKind: "paper" | "experiment" | "note";
      sourceId: string;
      relationKind?: KnowledgeEvidenceRelationKind;
      evidenceSummary?: string;
    }) =>
      invoke("knowledge_graph_create_evidence", {
        claimId: data.claimId,
        sourceKind: data.sourceKind,
        sourceId: data.sourceId,
        relationKind: data.relationKind ?? null,
        evidenceSummary: data.evidenceSummary ?? null,
      }),
    deleteEvidence: (id: string) =>
      invoke<void>("knowledge_graph_delete_evidence", { id }),
    createCitation: (data: {
      citingPaperId: string;
      citedPaperId: string;
      context?: string;
    }) =>
      invoke("knowledge_graph_create_citation", {
        citingPaperId: data.citingPaperId,
        citedPaperId: data.citedPaperId,
        context: data.context ?? null,
      }),
    deleteCitation: (id: string) =>
      invoke<void>("knowledge_graph_delete_citation", { id }),
    citationCentrality: (limit?: number): Promise<CitationCentralityEntry[]> =>
      invoke("knowledge_graph_citation_centrality", { limit: limit ?? null }),
    citationShortestPath: (fromPaperId: string, toPaperId: string): Promise<CitationPathResult | null> =>
      invoke("knowledge_graph_citation_shortest_path", {
        fromPaperId,
        toPaperId,
      }),
    citationSubgraph: (seedPaperIds: string[], radius?: number, maxNodes?: number): Promise<CitationSubgraph> =>
      invoke("knowledge_graph_citation_subgraph", {
        seedPaperIds,
        radius: radius ?? null,
        maxNodes: maxNodes ?? null,
      }),
  },
};

// ── Chat / Streaming ──────────────────────────────────────────────

export const chatApi = {
  listSessions: (): Promise<ChatSession[]> => invoke("chat_list_sessions"),
  getSession: (id: string): Promise<ChatSession> => invoke("chat_get_session", { id }),
  deleteSession: (id: string): Promise<void> => invoke("chat_delete_session", { id }),
  updateSessionContext: (id: string, interestId?: string): Promise<ChatSession> =>
    invoke("chat_update_session_context", {
      id,
      contextType: interestId ? "interest" : "general",
      contextId: interestId ?? null,
    }),
  ensureSession: (options: {
    sessionId?: string;
    title?: string;
    contextType?: string;
    contextId?: string;
  }): Promise<ChatSession> =>
    invoke("chat_ensure_session", {
      sessionId: options.sessionId ?? null,
      title: options.title ?? null,
      contextType: options.contextType ?? null,
      contextId: options.contextId ?? null,
    }),
  saveMessage: (input: {
    session_id: string;
    role: "user" | "assistant";
    content: string;
    images?: unknown;
    artifacts?: unknown;
  }): Promise<ChatMessage> =>
    invoke("chat_save_message", {
      sessionId: input.session_id,
      role: input.role,
      content: input.content,
      images: input.images ?? null,
      artifacts: input.artifacts ?? null,
    }),
  listAgentRuns: (sessionId: string, requestId?: string): Promise<AgentRun[]> =>
    invoke("chat_list_agent_runs", { sessionId, requestId: requestId ?? null }),
  /** 从某条消息起截断会话（删除该消息及其后所有消息），供重试/编辑重发前调用。 */
  truncateSession: (sessionId: string, messageId: string): Promise<{ removed: number }> =>
    invoke("chat_truncate_session", { sessionId, messageId }),
  renameSession: (id: string, title: string): Promise<ChatSession> =>
    invoke("chat_rename_session", { id, title }),
  setSessionPinned: (id: string, pinned: boolean): Promise<ChatSession> =>
    invoke("chat_set_session_pinned", { id, pinned }),
  stream: streamChat,
};

// ── Survey ────────────────────────────────────────────────────────

export const surveyApi = {
  generate: (
    query: string,
    maxPapers = 20,
    timeFrom?: number,
    timeTo?: number,
    litTypes?: string[],
    databases?: string[],
    citationFormat?: string,
    language?: string,
    paperIds?: string[],
    requestId?: string,
  ): Promise<void> =>
    invoke("survey_generate", {
      query,
      maxPapers,
      timeFrom: timeFrom ?? null,
      timeTo: timeTo ?? null,
      litTypes: litTypes ?? null,
      databases: databases ?? null,
      citationFormat: citationFormat ?? null,
      language: language ?? null,
      paperIds: paperIds ?? null,
      requestId: requestId ?? null,
    }),
  search: (query: string, limit = 20): Promise<unknown[]> =>
    invoke("survey_search", { query, limit }),
  list: (): Promise<SurveySummary[]> => invoke("survey_list"),
  get: (id: string): Promise<SavedSurvey> => invoke("survey_get", { id }),
  delete: (id: string): Promise<void> => invoke("survey_delete", { id }),
};

// ── Translate ─────────────────────────────────────────────────────

export const translateApi = {
  translate: (text: string, targetLang: string, sourceLang?: string, model?: string): Promise<string> =>
    invoke("translate_text", { text, targetLang, sourceLang: sourceLang ?? null, model: model ?? null }),
  stream: (text: string, targetLang: string, sourceLang?: string, model?: string, signal?: AbortSignal) =>
    streamTranslation({ text, targetLang, sourceLang, model }, signal),
};

// ── Markdown Format ───────────────────────────────────────────────

export const markdownApi = {
  formatChunk: (
    text: string,
    styleSummary: string,
  ): Promise<{ formatted: string; styleSummary: string }> =>
    invoke("markdown_format_chunk", { text, styleSummary }),
};

// ── Memory ────────────────────────────────────────────────────────

export type MemoryType = "auto" | "manual";

export interface UserMemory {
  id: string;
  type: MemoryType;
  action: string | null;
  summary: string;
  detail: string | null;
  created_at: string;
}

export interface MemoryObservation {
  id: string;
  event_id: string;
  session_id: string | null;
  run_id: string | null;
  source: string;
  event_type: string;
  title: string;
  summary: string;
  narrative: string;
  importance: number;
  created_at: string;
  score?: number;
}

export interface MemoryCheckpoint {
  id: string;
  session_id: string;
  request_id: string | null;
  context_type: string;
  context_id: string | null;
  goal: string;
  summary: string;
  completed_items: string[];
  open_questions: string[];
  next_steps: string[];
  status: string;
  source: string;
  asset_snapshot: Record<string, unknown>;
  review_status: "pending" | "confirmed" | "corrected" | "withdrawn";
  review_note: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryCheckpointListResponse {
  checkpoints: MemoryCheckpoint[];
}

export interface MemoryPrivacyStatus {
  enabled: boolean;
}

export const memoryApi = {
  add: (data: { type: MemoryType; action?: string; summary: string; detail?: string }): Promise<{ id: string }> =>
    invoke("memory_add", {
      type: data.type,
      action: data.action ?? null,
      summary: data.summary,
      detail: data.detail ?? null,
    }),
  list: (params?: { mem_type?: MemoryType; limit?: number; offset?: number }): Promise<UserMemory[]> =>
    invoke("memory_list", {
      memType: params?.mem_type ?? null,
      limit: params?.limit ?? 50,
      offset: params?.offset ?? 0,
    }),
  listManualRecords: (params?: { limit?: number; offset?: number }): Promise<UserMemory[]> =>
    invoke("memory_list_manual_records", {
      limit: params?.limit ?? 100,
      offset: params?.offset ?? 0,
    }),
  listAutoRecords: (params?: { password?: string; limit?: number; offset?: number }): Promise<UserMemory[]> =>
    invoke("memory_list_auto_records", {
      password: params?.password ?? null,
      limit: params?.limit ?? 100,
      offset: params?.offset ?? 0,
    }),
  listObservations: (params?: { limit?: number; offset?: number }): Promise<MemoryObservation[]> =>
    invoke("memory_list_observations", {
      limit: params?.limit ?? 30,
      offset: params?.offset ?? 0,
    }),
  listPrivateObservations: (params?: { password?: string; limit?: number; offset?: number }): Promise<MemoryObservation[]> =>
    invoke("memory_list_private_observations", {
      password: params?.password ?? null,
      limit: params?.limit ?? 50,
      offset: params?.offset ?? 0,
    }),
  searchObservations: (query: string, limit = 6): Promise<MemoryObservation[]> =>
    invoke("memory_search_observations", {
      query,
      limit,
    }),
  listCheckpoints: (limit = 8): Promise<MemoryCheckpointListResponse> =>
    invoke("memory_list_checkpoints", { limit }),
  reviewCheckpoint: (id: string, status: "confirmed" | "corrected" | "withdrawn", note?: string): Promise<void> =>
    invoke("memory_review_checkpoint", { id, status, note: note ?? null }),
  privacyStatus: (): Promise<MemoryPrivacyStatus> =>
    invoke("memory_privacy_status"),
  setPrivacyPassword: (password: string): Promise<MemoryPrivacyStatus> =>
    invoke("memory_privacy_set_password", { password }),
  verifyPrivacyPassword: (password: string): Promise<boolean> =>
    invoke("memory_privacy_verify_password", { password }),
  clearPrivacyPassword: (): Promise<MemoryPrivacyStatus> =>
    invoke("memory_privacy_clear_password"),
  delete: (id: string): Promise<void> =>
    invoke("memory_delete", { id }),
  clearAuto: (): Promise<void> =>
    invoke("memory_clear_auto"),
  buildContext: (): Promise<string> =>
    invoke("memory_build_context"),
};

// ── Skills ────────────────────────────────────────────────────────

export const skillsApi = {
  list: (): Promise<Skill[]> =>
    invoke("skills_list"),
  create: (data: {
    name: string;
    title: string;
    description: string;
    prompt: string;
    tags?: string[];
  }): Promise<Skill> =>
    invoke("skills_create", {
      name: data.name,
      title: data.title,
      description: data.description,
      prompt: data.prompt,
      tags: data.tags ?? null,
    }),
  update: (
    id: string,
    data: {
      title?: string;
      description?: string;
      prompt?: string;
      tags?: string[];
      is_enabled?: boolean;
    }
  ): Promise<Skill> =>
    invoke("skills_update", {
      id,
      title: data.title ?? null,
      description: data.description ?? null,
      prompt: data.prompt ?? null,
      tags: data.tags ?? null,
      isEnabled: data.is_enabled ?? null,
    }),
  delete: (id: string): Promise<void> =>
    invoke("skills_delete", { id }),
  resetBuiltins: (): Promise<Skill[]> =>
    invoke("skills_reset_builtins"),
};

// ── Submission API ────────────────────────────────────────────────

export const submissionApi = {
  listVenues: (params?: { search?: string; starredOnly?: boolean }) =>
    invoke<{ venues: unknown[] }>("submission_list_venues", {
      search: params?.search ?? null,
      starredOnly: params?.starredOnly ?? null,
    }),
  createVenue: (params: {
    name: string; fullName?: string; venueType?: string; website?: string;
    ccf?: string; area?: string; ei?: boolean; sci?: boolean; sciQuartile?: string;
    deadline?: string; notificationDate?: string; specialIssueDeadline?: string; specialIssueTitle?: string;
  }) => invoke<{ id: string }>("submission_create_venue", {
    name: params.name, fullName: params.fullName ?? null, venueType: params.venueType ?? null,
    website: params.website ?? null, ccf: params.ccf ?? null, area: params.area ?? null,
    ei: params.ei ?? null, sci: params.sci ?? null, sciQuartile: params.sciQuartile ?? null,
    deadline: params.deadline ?? null, notificationDate: params.notificationDate ?? null,
    specialIssueDeadline: params.specialIssueDeadline ?? null, specialIssueTitle: params.specialIssueTitle ?? null,
  }),
  updateVenue: (id: string, params: Partial<{ name: string; fullName: string; venueType: string; website: string; ccf: string; area: string; ei: boolean; sci: boolean; sciQuartile: string; deadline: string; notificationDate: string; specialIssueDeadline: string; specialIssueTitle: string }>) =>
    invoke<void>("submission_update_venue", { id, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v ?? null])) }),
  deleteVenue: (id: string) => invoke<void>("submission_delete_venue", { id }),
  toggleVenueStar: (id: string) => invoke<void>("submission_toggle_venue_star", { id }),

  list: () => invoke<{ submissions: unknown[] }>("submission_list"),
  create: (params: { title: string; venueName?: string; venueType?: string; status?: string; deadline?: string }) =>
    invoke<{ id: string }>("submission_create", {
      title: params.title, venueName: params.venueName ?? null,
      venueType: params.venueType ?? null, status: params.status ?? null, deadline: params.deadline ?? null,
    }),
  update: (id: string, params: Partial<{ title: string; venueName: string; venueType: string; status: string; deadline: string; submittedAt: string }>) =>
    invoke<void>("submission_update", { id, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v ?? null])) }),
  delete: (id: string) => invoke<void>("submission_delete", { id }),

  listVersions: (submissionId: string) => invoke<{ versions: unknown[] }>("submission_list_versions", { submissionId }),
  createVersion: (params: { submissionId: string; tag?: string; label?: string; stage?: string; content?: string; notes?: string; filePath?: string; fileName?: string }) =>
    invoke<{ id: string }>("submission_create_version", {
      submissionId: params.submissionId, tag: params.tag ?? null, label: params.label ?? null,
      stage: params.stage ?? null, content: params.content ?? null, notes: params.notes ?? null,
      filePath: params.filePath ?? null, fileName: params.fileName ?? null,
    }),
  updateVersion: (id: string, params: Partial<{ tag: string; label: string; stage: string; content: string; notes: string; filePath: string; fileName: string }>) =>
    invoke<void>("submission_update_version", {
      id,
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v ?? null])),
    }),
  deleteVersion: (id: string) => invoke<void>("submission_delete_version", { id }),

  listRounds: (submissionId: string) => invoke<{ rounds: unknown[] }>("submission_list_rounds", { submissionId }),
  upsertRound: (params: { submissionId: string; round: number; verdict?: string; receivedAt?: string }) =>
    invoke<{ id: string }>("submission_upsert_round", {
      submissionId: params.submissionId, round: params.round,
      verdict: params.verdict ?? null, receivedAt: params.receivedAt ?? null,
    }),

  listComments: (submissionId: string, round?: number) =>
    invoke<{ comments: unknown[] }>("submission_list_comments", { submissionId, round: round ?? null }),
  createComment: (params: { submissionId: string; round: number; reviewer?: string; content: string; response?: string; tags?: string[] }) =>
    invoke<{ id: string }>("submission_create_comment", {
      submissionId: params.submissionId, round: params.round, reviewer: params.reviewer ?? null,
      content: params.content, response: params.response ?? null, tags: params.tags ?? null,
    }),
  updateComment: (id: string, params: Partial<{ content: string; response: string; resolved: boolean; tags: string[] }>) =>
    invoke<void>("submission_update_comment", { id, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v ?? null])) }),
  deleteComment: (id: string) => invoke<void>("submission_delete_comment", { id }),
  upsertReviewFeedback: (params: { submissionId: string; reviewRunId: string; reviewer: string; itemKey: string; suggestion: string; status: "pending" | "adopted" | "ignored" | "done"; reason?: string }) =>
    invoke<{ ok: boolean }>("submission_upsert_review_feedback", {
      submissionId: params.submissionId,
      reviewRunId: params.reviewRunId,
      reviewer: params.reviewer,
      itemKey: params.itemKey,
      suggestion: params.suggestion,
      status: params.status,
      reason: params.reason ?? null,
    }),
  reviewFeedbackSummary: (submissionId: string) =>
    invoke<{ counts: Record<"pending" | "adopted" | "ignored" | "done", number> }>("submission_review_feedback_summary", { submissionId }),

  getChecklist: (submissionId: string) => invoke<{ checklist: unknown[] }>("submission_get_checklist", { submissionId }),
  toggleChecklist: (itemId: string) => invoke<void>("submission_toggle_checklist", { itemId }),
  listDiagnosisReports: (submissionId: string) =>
    invoke<{ reports: unknown[] }>("submission_list_diagnosis_reports", { submissionId }),
  importDiagnosisReportToChecklist: (reportId: string) =>
    invoke<{ created: number }>("submission_import_diagnosis_report_to_checklist", { reportId }),
  listRevisionTasks: (submissionId: string) =>
    invoke<{ tasks: unknown[] }>("submission_list_revision_tasks", { submissionId }),
  importDiagnosisReportToTasks: (reportId: string) =>
    invoke<{ created: number }>("submission_import_diagnosis_report_to_tasks", { reportId }),
  updateRevisionTask: (id: string, params: Partial<{ status: string; paperVersionId: string; experimentId: string }>) =>
    invoke<void>("submission_update_revision_task", {
      id,
      status: params.status ?? null,
      paperVersionId: params.paperVersionId ?? null,
      experimentId: params.experimentId ?? null,
    }),

  stats: () => invoke<{ active: number; pendingReviews: number; upcomingDdls: { name: string; deadline: string }[] }>("submission_stats"),

  aiReview: (params: { submissionId: string; content: string; reviewerCount: number; strictness: string; runId?: string }) =>
    invoke<void>("submission_ai_review", {
      submissionId: params.submissionId, content: params.content,
      reviewerCount: params.reviewerCount, strictness: params.strictness,
      runId: params.runId ?? null,
    }),
  polishAbstract: (submissionId: string, text: string, requestId?: string) =>
    invoke<void>("submission_polish_abstract", { submissionId, text, requestId: requestId ?? null }),
  generateCoverLetter: (submissionId: string, requestId?: string) =>
    invoke<void>("submission_generate_cover_letter", { submissionId, requestId: requestId ?? null }),
  syncCcfDdl: () =>
    invoke<{ fetched: number; updated: number }>("submission_sync_ccfddl"),
  syncCcfDdlLocal: () =>
    invoke<{ fetched: number; updated: number }>("submission_sync_ccfddl_local"),
};

// ── Experiment API ────────────────────────────────────────────────

export interface ExperimentAttachment {
  id: string;
  experimentId: string;
  snapshotId: string | null;
  filePath: string;
  label: string;
  dataUrl: string;
  createdAt: string;
}

export const experimentApi = {
  list: () => invoke<{ experiments: unknown[] }>("experiment_list"),
  get: (id: string) => invoke<ExperimentRecord>("experiment_get", { id }),
  create: (params: { title: string; config?: Record<string, unknown>; result?: string; notes?: string; linkedSubmissionId?: string }) =>
    invoke<{ id: string }>("experiment_create", {
      title: params.title, config: params.config ?? null,
      result: params.result ?? null, notes: params.notes ?? null,
      linkedSubmissionId: params.linkedSubmissionId ?? null,
    }),
  update: (id: string, params: Partial<{ title: string; config: Record<string, unknown>; result: string; notes: string; linkedSubmissionId: string; defaultWorkingDir: string }>) =>
    invoke<void>("experiment_update", { id, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v ?? null])) }),
  delete: (id: string) => invoke<void>("experiment_delete", { id }),
  snapshots: {
    list: (experimentId: string) =>
      invoke<{ snapshots: ExperimentSnapshot[] }>("experiment_list_snapshots", { experimentId }),
    get: (snapshotId: string) => invoke<ExperimentSnapshot>("experiment_get_snapshot", { snapshotId }),
    create: (experimentId: string, params: { title?: string; codeSessionId?: string; toolId?: string; model?: string; workingDir?: string; envSnapshot?: Record<string, unknown> }) =>
      invoke<ExperimentSnapshot>("experiment_create_snapshot", {
        experimentId, title: params.title ?? null, codeSessionId: params.codeSessionId ?? null,
        toolId: params.toolId ?? null, model: params.model ?? null, workingDir: params.workingDir ?? null,
        envSnapshot: params.envSnapshot ?? null,
      }),
    rename: (snapshotId: string, title: string) =>
      invoke<void>("experiment_rename_snapshot", { snapshotId, title }),
    delete: (snapshotId: string) => invoke<void>("experiment_delete_snapshot", { snapshotId }),
    restore: (snapshotId: string) =>
      invoke<{ experimentId: string; restoredAt: string; backupSnapshotId: string }>("experiment_restore_snapshot", { snapshotId }),
  },
  attachments: {
    list: (experimentId: string) =>
      invoke<{ attachments: ExperimentAttachment[] }>("experiment_list_attachments", { experimentId }),
    add: (experimentId: string, filePath: string, label?: string) =>
      invoke<ExperimentAttachment>("experiment_add_attachment", { experimentId, filePath, label: label ?? null }),
    updateLabel: (id: string, label: string) =>
      invoke<void>("experiment_update_attachment_label", { id, label }),
    delete: (id: string) =>
      invoke<void>("experiment_delete_attachment", { id }),
  },
};

// ── Workbench API ──────────────────────────────────────────────────

export const workbenchApi = {
  getOverviewTextCache: () =>
    invoke<{
      heroTitle: string;
      heroDescription: string;
      summaryItems: Array<{ title: string; description: string }>;
    } | null>("workbench_get_overview_text_cache"),
  generateOverviewText: (sourceJson: string) =>
    invoke<{
      heroTitle: string;
      heroDescription: string;
      summaryItems: Array<{ title: string; description: string }>;
    }>("workbench_generate_overview_text", { sourceJson }),
};

export const fieldDynamicsApi = {
  scan: (days?: number, maxPerInterest?: number): Promise<FieldDynamicsScanResult> =>
    invoke("field_dynamics_scan", { days: days ?? null, maxPerInterest: maxPerInterest ?? null }),
  list: (interestId?: string): Promise<FieldDynamicsListResult> =>
    invoke("field_dynamics_list", { interestId: interestId ?? null }),
  history: (interestId?: string, limit?: number): Promise<FieldDynamicsHistoryResult> =>
    invoke("field_dynamics_history", {
      interestId: interestId ?? null,
      limit: limit ?? null,
    }),
  importPaper: (briefingId: string, paperExternalId: string, paperSource: string) =>
    invoke<{ paper_id: string; title: string; briefing_id: string; paper_external_id: string }>("field_dynamics_import_paper", { briefingId, paperExternalId, paperSource }),
  markRead: (id?: string): Promise<void> =>
    invoke("field_dynamics_mark_read", { id: id ?? null }),
};

export interface CodeToolCall { id: string; name: string; arguments: string; }
export interface CodeToolResult { tool_call_id: string; name: string; output: string; is_error: boolean; }
export interface CodePermissionRequest {
  id: string; session_id: string; request_id: string; tool_call: CodeToolCall;
  title: string; summary: string; risk_level: "low" | "medium" | "high" | string; preview: string;
}
export interface CodeMessage {
  id: string; role: "user" | "assistant" | "tool"; content: string;
  tool_calls?: CodeToolCall[]; tool_results?: CodeToolResult[]; tool_call_id?: string | null;
  tool_id?: string | null; model?: string | null; duration_ms?: number | null; created_at: string;
}
export interface CodeSession extends ExperimentCodeSession {}
export interface DirEntry { name: string; path: string; is_dir: boolean; }
export interface CodeGitFile { path: string; index_status: string; worktree_status: string; staged: boolean; unstaged: boolean; untracked: boolean; }
export interface CodeGitSnapshot {
  is_repo: boolean; branch: string | null; head: string | null; upstream: string | null;
  ahead: number; behind: number; files: CodeGitFile[]; staged_diff: string; unstaged_diff: string; recent_commits: string[];
}
export interface CodeReviewReport { content: string; diff_chars: number; }
export interface CodeWorkspaceContext {
  working_dir: string; current_file: string | null; is_git_repo: boolean; git_status: string;
  package_scripts: string[]; instruction_files: string[]; key_files: string[]; content: string;
}

export const codeApi = {
  listDir: (path: string): Promise<{ entries: DirEntry[] }> => invoke("code_list_dir", { path }),
  readFile: (path: string): Promise<{ content: string }> => invoke("code_read_file", { path }),
  writeFile: (path: string, content: string): Promise<void> => invoke("code_write_file", { path, content }),
  workspaceContext: (workingDir: string, currentFile?: string): Promise<CodeWorkspaceContext> => invoke("code_workspace_context", { workingDir, currentFile: currentFile ?? null }),
  listSessions: (experimentId: string): Promise<{ sessions: CodeSession[] }> => invoke("code_list_sessions", { experimentId }),
  getSession: (sessionId: string): Promise<CodeSession> => invoke("code_get_session", { sessionId }),
  createSession: (experimentId: string, title?: string, workingDir?: string): Promise<CodeSession> => invoke("code_create_session", { experimentId, title: title ?? null, workingDir: workingDir ?? null }),
  deleteSession: (sessionId: string): Promise<void> => invoke("code_delete_session", { sessionId }),
  sendMessage: (sessionId: string, displayContent: string, promptContent: string, workingDir?: string, currentFile?: string, mode?: string, userMessageId?: string): Promise<void> => invoke("code_send_message", { sessionId, displayContent, promptContent, workingDir: workingDir ?? null, currentFile: currentFile ?? null, mode: mode ?? null, userMessageId: userMessageId ?? null }),
  editMessage: (sessionId: string, messageId: string): Promise<void> => invoke("code_edit_message", { sessionId, messageId }),
  cancelMessage: (requestId: string): Promise<void> => invoke("code_cancel", { requestId }),
  resolvePermission: (permissionId: string, approved: boolean, message?: string): Promise<void> => invoke("code_resolve_permission", { permissionId, approved, message: message ?? null }),
  updateSession: (sessionId: string, input: { title?: string; workingDir?: string }): Promise<void> => invoke("code_update_session", { sessionId, title: input.title ?? null, workingDir: input.workingDir ?? null }),
  gitSnapshot: (workingDir: string): Promise<CodeGitSnapshot> => invoke("code_git_snapshot", { workingDir }),
  gitStagePath: (workingDir: string, path: string): Promise<void> => invoke("code_git_stage_path", { workingDir, path }),
  gitUnstagePath: (workingDir: string, path: string): Promise<void> => invoke("code_git_unstage_path", { workingDir, path }),
  gitCommit: (workingDir: string, message: string): Promise<string> => invoke("code_git_commit", { workingDir, message }),
  gitListBranches: (workingDir: string): Promise<string[]> => invoke("code_git_list_branches", { workingDir }),
  gitCheckoutBranch: (workingDir: string, branch: string): Promise<void> => invoke("code_git_checkout_branch", { workingDir, branch }),
  generateCommitMessage: (workingDir: string): Promise<string> => invoke("code_generate_commit_message", { workingDir }),
  reviewChanges: (workingDir: string): Promise<CodeReviewReport> => invoke("code_review_changes", { workingDir }),
};

// ── Writing API ───────────────────────────────────────────────────

export interface WritingCompileResult {
  success: boolean;
  pdfPath: string | null;
  workDir: string;
  engine: string;
  log: string;
}

export interface WritingImageAssetPayload {
  id: string;
  fileName: string;
  projectPath: string;
  storedPath: string;
  createdAt: string;
}

export interface WritingTexFilePayload {
  path: string;
  content: string;
}

export const writingApi = {
  polish: (request: { text: string; section?: string; direction?: string }) =>
    invoke<{ polished: string; revision_notes: string[]; warnings: string[] }>("writing_polish_text", { request }),
  importImage: (draftId: string, filePath: string) =>
    invoke<WritingImageAssetPayload>("writing_import_image", { draftId, filePath }),
  compilePdf: (project: {
    projectName: string;
    mainTex: string;
    bibtex: string;
    texFiles: WritingTexFilePayload[];
    notes: string;
    imageAssets: WritingImageAssetPayload[];
  }) =>
    invoke<WritingCompileResult>("writing_compile_pdf", { request: project }),
  copyPdf: (pdfPath: string, destinationPath: string) =>
    invoke<void>("writing_copy_pdf", { pdfPath, destinationPath }),
  openCompiledPdf: (pdfPath: string) =>
    invoke<void>("writing_open_compiled_pdf", { pdfPath }),
  openMactexInstaller: () =>
    invoke<void>("writing_open_mactex_installer"),
  openMactexDownloadPage: () =>
    invoke<void>("writing_open_mactex_download_page"),
  // 草稿库：后端 SQLite 为唯一数据源，字段与前端 WritingDraft 一致（camelCase）。
  listDrafts: () =>
    invoke<WritingDraft[]>("writing_draft_list"),
  createDraft: (draft: WritingDraft) =>
    invoke<WritingDraft>("writing_draft_create", { request: draft }),
  getDraft: (id: string) =>
    invoke<WritingDraft>("writing_draft_get", { id }),
  updateDraft: (draft: WritingDraft) =>
    invoke<void>("writing_draft_update", { request: draft }),
  /** 删除草稿，历史版本由后端级联清理。 */
  deleteDraft: (id: string) =>
    invoke<void>("writing_draft_delete", { id }),
  // 历史版本：后端只做快照存取，恢复由前端应用。
  recordVersion: (request: {
    draftId: string;
    mainTex: string;
    bibtex: string;
    texFiles: WritingTexFilePayload[];
    notes: string;
    source: "auto" | "manual";
    force?: boolean;
  }) =>
    invoke<WritingVersionRecordResult>("writing_record_version", { request }),
  listVersions: (draftId: string) =>
    invoke<WritingVersionSummary[]>("writing_list_versions", { draftId }),
  getVersion: (id: string) =>
    invoke<WritingVersionSnapshot>("writing_get_version", { id }),
  deleteVersion: (id: string) =>
    invoke<void>("writing_delete_version", { id }),
  clearDraftVersions: (draftId: string) =>
    invoke<void>("writing_clear_draft_versions", { draftId }),
};

// ── Research Context API ───────────────────────────────────────────

export const researchContextApi = {
  getRecentThemes: (limit = 3): Promise<ResearchTheme[]> =>
    invoke("research_context_get_recent_themes", { limit }),
  getThemeContext: (themeId: string): Promise<{ theme: ResearchTheme; events: ResearchActivityEvent[] }> =>
    invoke("research_context_get_theme_context", { themeId }),
};

// ── Evidence API ──────────────────────────────────────────────────

export const evidenceApi = {
  getEvidenceLinks: (targetId: string, targetType: string): Promise<EvidenceLink[]> =>
    invoke("evidence_get_links", { targetId, targetType }),
};

// ── Export API ────────────────────────────────────────────────────

export const exportApi = {
  toObsidian: (vaultPath: string) =>
    invoke<{ notes: number; papers: number; exportPath: string }>("export_to_obsidian", { vaultPath }),
};

// ── Unified client (mirrors api-sdk shape) ────────────────────────


// ── Cross-paper Analysis ──────────────────────────────────────

export const crossAnalysisApi = {
  analyze: (paper_ids: string[]): Promise<{ papers: unknown[]; analysis: string }> =>
    invoke("papers_cross_analysis", { paperIds: paper_ids }),
};

// ── Active Researcher ──────────────────────────────────────────

export interface ActiveResearcherFinding {
  id: string;
  interest_id: string;
  interest_topic: string;
  arxiv_id: string;
  title: string;
  authors: string;
  published_at: string;
  abs_url: string;
  pdf_url: string;
  relevance_score: number;
  relevance_reason: string;
  abstract_snippet: string;
  scanned_at: string;
  is_read: boolean;
}

export const activeResearcherApi = {
  scan: (days?: number, maxPerInterest?: number): Promise<{ findings: ActiveResearcherFinding[]; unread_count: number; scanned_interests: number }> =>
    invoke("active_researcher_scan", { days: days ?? null, maxPerInterest: maxPerInterest ?? null }),
  findings: (limit?: number): Promise<{ findings: ActiveResearcherFinding[]; unread_count: number }> =>
    invoke("active_researcher_findings", { limit: limit ?? null }),
  importFinding: (id: string): Promise<{ paper_id: string; title: string; finding_id: string }> =>
    invoke("active_researcher_import_finding", { id }),
  markRead: (id?: string): Promise<void> =>
    invoke("active_researcher_mark_read", { id: id ?? null }),
};

export const artifactApi = {
  save: (input: {
    id: string;
    kind: ArtifactKind;
    name: string;
    title?: string;
    description?: string;
    bytes: number[];
    metadata?: Record<string, unknown>;
  }): Promise<Artifact> => invoke("artifact_save", input),
  open: (id: string, localPath: string): Promise<void> =>
    invoke("artifact_open", { id, localPath }),
  reveal: (id: string, localPath: string): Promise<void> =>
    invoke("artifact_reveal", { id, localPath }),
  saveAs: (id: string, localPath: string): Promise<boolean> =>
    invoke("artifact_save_as", { id, localPath }),
  delete: (id: string, localPath: string): Promise<void> =>
    invoke("artifact_delete", { id, localPath }),
};

export const apiClient = {
  fieldDynamics: fieldDynamicsApi,
  memory: memoryApi,
  arxiv: arxivApi,
  paperSearch: paperSearchApi,
  webSearch: webSearchApi,
  githubProject: githubProjectApi,
  ccf: ccfApi,
  journals: journalApi,
  sources: sourceApi,
  settings: settingsApi,
  translate: translateApi,
  markdown: markdownApi,
  updates: updatesApi,
  papers: papersApi,
  knowledge: knowledgeApi,
  chat: chatApi,
  survey: surveyApi,
  skills: skillsApi,
  submission: submissionApi,
  experiment: experimentApi,
  export: exportApi,
  workbench: workbenchApi,
  writing: writingApi,
  researchContext: researchContextApi,
  evidence: evidenceApi,
  crossAnalysis: crossAnalysisApi,
  activeResearcher: activeResearcherApi,
  artifact: artifactApi,
};
