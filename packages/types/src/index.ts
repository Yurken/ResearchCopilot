export const PRODUCT_NAME = "小妍";
export const MAIN_ASSISTANT_NAME = "小妍";
export const MAIN_ASSISTANT_ROLE = "小妍 · 主 AI 助手";
export const MAIN_ASSISTANT_WORKSPACE_NAME = "小妍协同台";
export const MAIN_ASSISTANT_PANEL_TITLE = "小妍调度面板";
export const MAIN_ASSISTANT_BADGE = "主 AI：小妍";
export const MAIN_ASSISTANT_WELCOME_TITLE = "你好，我是小妍";
export const MAIN_ASSISTANT_WELCOME_DESCRIPTION =
  "我会先理解你的研究目标，再按需调度检索、规划、综述、论文解读与复现能力，给你可信、结构化、可执行的答复。";
/** 直接对话模式下的欢迎语：不强调多智能体调度，回到轻量问答语气。 */
export const MAIN_ASSISTANT_WELCOME_DESCRIPTION_DIRECT = "有什么我能帮你的吗？";
export const MAIN_ASSISTANT_STATUS_DESCRIPTION =
  "小妍负责理解你的研究问题、调度合适的分析模型，并整合成完整的答复。";
export const MAIN_ASSISTANT_INPUT_PLACEHOLDER =
  "告诉我你当前的研究问题，我先帮你理清思路，再一步步陪你推进";

const CAPABILITY_MODEL_NAME_MAP: Record<string, string> = {
  retrieval: "溯源模型",
  planner: "谋策模型",
  literaturescout: "探知模型",
  survey: "翰章模型",
  paperanalyst: "洞见模型",
  reproduction: "构域模型",
  synthesis: "整合模型",
  supervisor: "谋策调度模型",
  worker: "小妍默认执行模型",
  analyst: "洞见模型",
  scout: "探知模型",
  designer: "谋策模型",
  retriever: "溯源模型",
  writer: "翰章模型",
  learningpathplanning: "谋策模型",
  学习路径规划: "谋策模型",
  检索规划: "探知模型",
  研究任务规划: "探知模型",
  文献检索: "溯源模型",
  参考文献筛选: "探知模型",
  时序分析: "探知模型",
  文献时序分析: "探知模型",
  综述写作: "翰章模型",
  文献综述写作: "翰章模型",
};

function normalizeCapabilityModelLookupKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "")
    .replace(/小妍能力步骤/g, "")
    .replace(/agent/g, "")
    .replace(/模型/g, "")
    .trim();
}

export function replaceAgentWording(text: string): string {
  if (!text) return text;
  return text
    .replace(/\bAgent\s*(\d+)\b/gi, "小妍能力步骤 $1")
    .replace(/\bAgent\b/g, "小妍能力步骤")
    .replace(/\bagent\b/g, "小妍能力步骤");
}

export function toCapabilityModelName(name: string): string {
  const raw = name.trim();
  if (!raw) return raw;

  const mapped = CAPABILITY_MODEL_NAME_MAP[normalizeCapabilityModelLookupKey(raw)];
  if (mapped) return mapped;

  return replaceAgentWording(raw)
    .replace(/\s*小妍能力步骤$/, "模型")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Paper {
  id: string;
  title: string;
  authors?: string;
  abstract?: string;
  year?: number;
  venue?: string;
  doi?: string;
  tags?: string[];
  research_interest_id?: string;
  ccf_rating?: string;
  ccf_area?: string;
  ccf_type?: string;
  ccf_label?: string;
  ccf_publisher?: string;
  wos_indexes?: string[];
  wos_categories?: string[];
  jcr_quartile?: string;
  jcr_category?: string;
  jif?: string;
  jif_rank?: string;
  cas_quartile?: string;
  cas_top?: boolean;
  open_access?: boolean;
  journal_issn?: string;
  journal_eissn?: string;
  journal_publisher?: string;
  paper_url?: string;
  venue_url?: string;
  importance_color?: string;
  notes?: string;
  file_path?: string;
  status: string;
  sort_order?: number;
  created_at: string;
  updated_at: string;
  analysis?: PaperAnalysis;
  reproduction_guide?: ReproductionGuide;
}

export interface PaperAnalysis {
  id: string;
  research_question?: string;
  core_method?: string;
  experiment_design?: string;
  experiment_results?: string;
  innovations?: string;
  limitations?: string;
  key_conclusions?: string;
  raw_analysis?: Record<string, unknown>;
  created_at: string;
}

export interface ReproductionGuide {
  id: string;
  code_repository?: string;
  environment_setup?: string;
  dependencies?: string;
  dataset_preparation?: string;
  training_process?: string;
  inference_process?: string;
  evaluation_metrics?: string;
  risks_and_notes?: string;
  raw_guide?: Record<string, unknown>;
  created_at: string;
}

export interface ResearchInterest {
  id: string;
  topic: string;
  folder_name?: string;
  parent_id?: string;
  keywords?: string[];
  profile?: ResearchInterestProfile;
  learning_path?: LearningPath;
  status: string;
  created_at: string;
}

export interface ResearchInterestProfile {
  goal?: string;
  background?: string;
  time_budget?: string;
  constraints?: string[];
  known_context?: string;
  preferred_output?: string;
}

export type PlannerNextField =
  | "topic"
  | "keywords"
  | "goal"
  | "background"
  | "time_budget"
  | "constraints"
  | "known_context"
  | "preferred_output";

export interface ResearchInterestHintRequest {
  topic: string;
  keywords?: string[];
  goal?: string;
  background?: string;
  time_budget?: string;
  constraints?: string[];
  known_context?: string;
  preferred_output?: string;
}

export interface ResearchInterestHintResponse {
  summary: string;
  next_field: PlannerNextField;
  matched_domains: string[];
  keyword_suggestions: string[];
  goal_suggestions: string[];
  background_prompts: string[];
  time_budget_suggestions: string[];
  constraint_suggestions: string[];
  known_context_suggestions: string[];
  output_suggestions: string[];
}

export interface LearningPath {
  overview?: string;
  prerequisites?: Array<{ name: string; description: string; resources: string[] }>;
  learning_stages?: Array<{
    stage: number;
    title: string;
    duration: string;
    goals: string[];
    topics: string[];
    resources: string[];
  }>;
  classic_papers?: Array<{
    title: string;
    authors: string;
    year: number;
    venue?: string;
    ccf_rating?: string;
    ccf_area?: string;
    ccf_type?: string;
    ccf_label?: string;
    ccf_publisher?: string;
    paper_url?: string;
    venue_url?: string;
    reason: string;
  }>;
  research_directions?: Array<{ direction: string; description: string; open_problems: string[] }>;
  tools_and_frameworks?: string[];
  communities?: string[];
}

export interface CcfEntry {
  kind: string;
  rating: string;
  area: string;
  label: string;
  full_name: string;
  publisher: string;
  url: string;
}

export interface CcfLookupResponse {
  query: string;
  matches: CcfEntry[];
}

export interface CcfListResponse {
  venues: CcfEntry[];
}

export interface JournalPartitionEntry {
  title: string;
  issn?: string;
  eissn?: string;
  publisher?: string;
  indexes: string[];
  wos_categories: string[];
  jcr_quartile?: string;
  jcr_category?: string;
  jif?: string;
  jif_rank?: string;
  cas_quartile?: string;
  cas_top?: boolean;
  open_access?: boolean;
}

export interface JournalLookupResponse {
  query: string;
  matches: JournalPartitionEntry[];
}

export interface SourceLookupItem {
  source: string;
  entity_type?: string;
  name: string;
  url?: string;
  publisher?: string;
  rating?: string;
  area?: string;
  label?: string;
  issn?: string;
  eissn?: string;
  indexes: string[];
  wos_categories: string[];
  jcr_quartile?: string;
  jcr_category?: string;
  jif?: string;
  jif_rank?: string;
  cas_quartile?: string;
  cas_top?: boolean;
  open_access?: boolean;
}

export interface SourceLookupSection {
  key: string;
  title: string;
  items: SourceLookupItem[];
}

export interface SourceLookupResponse {
  query: string;
  sections: SourceLookupSection[];
}

export interface AppUpdateInfo {
  configured: boolean;
  available: boolean;
  currentVersion?: string;
  current_version?: string;
  version?: string;
  body?: string;
  pubDate?: string;
  pub_date?: string;
}

export type ArxivRankingMode = "relevance" | "quality";

export interface ArxivSearchRequest {
  topic?: string;
  all_terms?: string[];
  title_terms?: string[];
  abstract_terms?: string[];
  authors?: string[];
  categories?: string[];
  comments_terms?: string[];
  journal_ref_terms?: string[];
  exclude_terms?: string[];
}

export interface ArxivRecommendation {
  arxiv_id: string;
  title: string;
  title_zh?: string;
  authors: string;
  category: string;
  published_at: string;
  updated_at: string;
  abstract_text: string;
  abs_url: string;
  pdf_url: string;
  score: number;
  reason: string;
  tldr_zh?: string;
  tags: string[];
}

export interface ArxivSearchResponse {
  query: string;
  keywords: string[];
  applied_filters: ArxivSearchRequest;
  search_expression: string;
  days: number;
  limit: number;
  ranking_mode: ArxivRankingMode;
  candidate_count: number;
  llm_used: boolean;
  ranking_note: string;
  overall_summary: string;
  disclaimer: string;
  papers: ArxivRecommendation[];
}

export interface WebSearchItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutcome {
  provider: string;
  answer?: string | null;
  note?: string | null;
  items: WebSearchItem[];
}

export interface BriefingPaper {
  external_id: string;
  source: "arxiv" | "semantic_scholar";
  title: string;
  authors: string;
  published_at: string;
  url: string;
  pdf_url: string;
  relevance_score: number;
  relevance_reason: string;
}

export interface BriefingDeadline {
  external_id: string;
  name: string;
  deadline: string;
  url: string;
  days_remaining: number;
}

export interface ResearchFieldBriefing {
  id: string;
  interest_id: string;
  interest_topic: string;
  period_start: string;
  period_end: string;
  summary: string;
  trends: string[];
  key_papers: BriefingPaper[];
  upcoming_deadlines: BriefingDeadline[];
  generated_at: string;
  is_read: boolean;
  stats: FieldDynamicsStats;
}

/** A stable activity snapshot captured each time a field briefing is generated. */
export interface FieldDynamicsStats {
  candidate_paper_count: number;
  selected_paper_count: number;
  upcoming_deadline_count: number;
  trend_count: number;
}

export interface FieldDynamicsListResult {
  briefings: ResearchFieldBriefing[];
  unread_count: number;
}

export interface FieldDynamicsScanResult extends FieldDynamicsListResult {
  scanned_interests: number;
}

export interface FieldDynamicsHistoryResult {
  briefings: ResearchFieldBriefing[];
}

export interface KnowledgeNote {
  id: string;
  title: string;
  content: string;
  source_type: string;
  source_id?: string;
  tags?: string[];
  research_interest_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ChatSession {
  id: string;
  title: string;
  context_type: string;
  context_id?: string;
  tag?: string;
  created_at: string;
  updated_at: string | null;
  messages?: ChatMessage[];
}

export interface ChatToolResult {
  tool_name: string;
  tool_id: string;
  result: string;
  result_id?: string;
}

/** 多模态图片引用：data 为 base64（不含 data: 前缀），mediaType 为 MIME（如 image/png）。 */
export interface ChatImageRef {
  data: string;
  mediaType: string;
  /** 可选原始文件名，仅用于 UI 展示。 */
  name?: string;
}

export type ArtifactKind =
  | "pptx"
  | "docx"
  | "xlsx"
  | "pdf"
  | "image"
  | "archive"
  | "other";

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  name: string;
  mimeType: string;
  localPath: string;
  size: number;
  createdAt: string;
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ content: string; source: string; url?: string }>;
  tool_results?: ChatToolResult[];
  /** 用户消息附带的图片（多模态）；当前仅桌面端在本轮发送/展示，未持久化。 */
  images?: ChatImageRef[];
  /** 工具技能执行后返回的文件产物，会随消息持久化。 */
  artifacts?: Artifact[];
  created_at: string;
}

export type ChatMode = "direct" | "task";

export type LlmProvider = "openai" | "anthropic" | "openai_compatible";
export type MultiAgentRoutingMode = "rule" | "llm" | "hybrid";
export type PaperSearchEngine = "arxiv" | "semantic_scholar";

export interface AgentArtifact {
  id: string;
  run_id: string;
  artifact_type: string;
  title: string;
  content: string;
  created_at: string;
}

export interface AgentRun {
  id: string;
  session_id: string;
  request_id: string;
  parent_run_id?: string | null;
  agent_name: string;
  step_name: string;
  status: "pending" | "running" | "done" | "failed";
  order_index: number;
  input_payload?: Record<string, unknown> | null;
  output_payload?: Record<string, unknown> | null;
  summary?: string | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
  artifacts?: AgentArtifact[];
  /** 该 Worker 读取的上游 Agent 输出摘要 */
  input_summary?: string | null;
  /** 该 Worker 产出的结构化摘要 */
  output_summary?: string | null;
  /** 执行耗时（毫秒） */
  duration_ms?: number | null;
  /** 该 Worker 依赖的上游 Agent 名称列表 */
  upstream_agents?: string[];
  /** 结构化输出（JSON） */
  structured_output?: Record<string, unknown> | null;
}

export interface AgentPlanStep {
  agent_name: string;
  title: string;
  goal: string;
}

export interface ChatSendResponse {
  success: boolean;
  session_id: string;
  request_id: string;
  message: string;
  sources?: ChatMessage["sources"];
  plan: AgentPlanStep[];
  agent_runs: AgentRun[];
}

export interface RoutingDecision {
  policy: string;
  selected: string[];
  reasoning?: string | null;
  execution_waves: string[][];
}

export type ChatStreamChunk =
  | { type: "session_id"; value: string }
  | { type: "request_id"; value: string }
  | { type: "plan"; value: AgentPlanStep[] }
  | { type: "agent_start"; value: AgentRun }
  | { type: "agent_complete"; value: AgentRun }
  | { type: "agent_error"; value: AgentRun }
  | { type: "delta"; value: string }
  | { type: "sources"; value: NonNullable<ChatMessage["sources"]> }
  | { type: "searching"; query: string }
  | { type: "tool_result"; tool_name: string; tool_id: string; result: string; result_id?: string }
  | { type: "routing_decision"; value: RoutingDecision }
  | { type: "error"; value: string }
  | { type: "done" };

export interface AppSettings {
  // Provider
  llm_provider: LlmProvider;
  // OpenAI
  openai_api_key: string;
  openai_base_url: string;
  openai_chat_model: string;
  openai_embedding_model: string;
  // Anthropic
  anthropic_api_key: string;
  anthropic_chat_model: string;
  // OpenAI-Compatible
  openai_compatible_base_url: string;
  openai_compatible_api_key: string;
  openai_compatible_chat_model: string;
  openai_compatible_embedding_model: string;
  // Embedding (optional, overrides provider embedding settings)
  embedding_base_url: string;
  embedding_api_key: string;
  embedding_model: string;
  // RAG
  chunk_size: string;
  chunk_overlap: string;
  rag_top_k: string;
  // External
  paper_search_engine: PaperSearchEngine;
  github_api_key: string;
  semantic_scholar_api_key: string;
  // 小妍联网搜索
  web_search_enabled: string;
  web_search_provider: string;
  tavily_api_key: string;
  // Role-based model routing
  planner_hint_model: string;
  planner_hint_base_url: string;
  planner_hint_api_key: string;
  planner_hint_temperature: string;
  planner_hint_top_p: string;
  planner_hint_max_tokens: string;
  planner_hint_presence_penalty: string;
  planner_hint_frequency_penalty: string;
  planner_analysis_model: string;
  planner_analysis_base_url: string;
  planner_analysis_api_key: string;
  planner_analysis_temperature: string;
  planner_analysis_top_p: string;
  planner_analysis_max_tokens: string;
  planner_analysis_presence_penalty: string;
  planner_analysis_frequency_penalty: string;
  planner_generation_model: string;
  planner_generation_base_url: string;
  planner_generation_api_key: string;
  planner_generation_temperature: string;
  planner_generation_top_p: string;
  planner_generation_max_tokens: string;
  planner_generation_presence_penalty: string;
  planner_generation_frequency_penalty: string;
  survey_planner_model: string;
  survey_planner_base_url: string;
  survey_planner_api_key: string;
  survey_planner_temperature: string;
  survey_planner_top_p: string;
  survey_planner_max_tokens: string;
  survey_planner_presence_penalty: string;
  survey_planner_frequency_penalty: string;
  survey_writer_model: string;
  survey_writer_base_url: string;
  survey_writer_api_key: string;
  survey_writer_temperature: string;
  survey_writer_top_p: string;
  survey_writer_max_tokens: string;
  survey_writer_presence_penalty: string;
  survey_writer_frequency_penalty: string;
  paper_analysis_model: string;
  paper_analysis_base_url: string;
  paper_analysis_api_key: string;
  paper_analysis_temperature: string;
  paper_analysis_top_p: string;
  paper_analysis_max_tokens: string;
  paper_analysis_presence_penalty: string;
  paper_analysis_frequency_penalty: string;
  paper_reproduction_model: string;
  paper_reproduction_base_url: string;
  paper_reproduction_api_key: string;
  paper_reproduction_temperature: string;
  paper_reproduction_top_p: string;
  paper_reproduction_max_tokens: string;
  paper_reproduction_presence_penalty: string;
  paper_reproduction_frequency_penalty: string;
  copilot_simple_model: string;
  copilot_simple_base_url: string;
  copilot_simple_api_key: string;
  copilot_simple_temperature: string;
  copilot_simple_top_p: string;
  copilot_simple_max_tokens: string;
  copilot_simple_presence_penalty: string;
  copilot_simple_frequency_penalty: string;
  xiaoyan_long_term_memory_enabled: string;
  xiaoyan_companion_id: string;
  xiaoyan_active_researcher_enabled: string;
  // Multi-agent
  multi_agent_enabled: string;
  multi_agent_routing_mode: MultiAgentRoutingMode;
  multi_agent_enabled_agents: string;
  multi_agent_max_steps: string;
  multi_agent_search_limit: string;
  multi_agent_supervisor_model: string;
  multi_agent_supervisor_base_url: string;
  multi_agent_supervisor_api_key: string;
  multi_agent_supervisor_temperature: string;
  multi_agent_supervisor_top_p: string;
  multi_agent_supervisor_max_tokens: string;
  multi_agent_supervisor_presence_penalty: string;
  multi_agent_supervisor_frequency_penalty: string;
  multi_agent_worker_model: string;
  multi_agent_worker_base_url: string;
  multi_agent_worker_api_key: string;
  multi_agent_worker_temperature: string;
  multi_agent_worker_top_p: string;
  multi_agent_worker_max_tokens: string;
  multi_agent_worker_presence_penalty: string;
  multi_agent_worker_frequency_penalty: string;
  multi_agent_planner_model: string;
  multi_agent_planner_base_url: string;
  multi_agent_planner_api_key: string;
  multi_agent_planner_temperature: string;
  multi_agent_planner_top_p: string;
  multi_agent_planner_max_tokens: string;
  multi_agent_planner_presence_penalty: string;
  multi_agent_planner_frequency_penalty: string;
  multi_agent_literature_scout_model: string;
  multi_agent_literature_scout_base_url: string;
  multi_agent_literature_scout_api_key: string;
  multi_agent_literature_scout_temperature: string;
  multi_agent_literature_scout_top_p: string;
  multi_agent_literature_scout_max_tokens: string;
  multi_agent_literature_scout_presence_penalty: string;
  multi_agent_literature_scout_frequency_penalty: string;
  multi_agent_survey_model: string;
  multi_agent_survey_base_url: string;
  multi_agent_survey_api_key: string;
  multi_agent_survey_temperature: string;
  multi_agent_survey_top_p: string;
  multi_agent_survey_max_tokens: string;
  multi_agent_survey_presence_penalty: string;
  multi_agent_survey_frequency_penalty: string;
  multi_agent_paper_analyst_model: string;
  multi_agent_paper_analyst_base_url: string;
  multi_agent_paper_analyst_api_key: string;
  multi_agent_paper_analyst_temperature: string;
  multi_agent_paper_analyst_top_p: string;
  multi_agent_paper_analyst_max_tokens: string;
  multi_agent_paper_analyst_presence_penalty: string;
  multi_agent_paper_analyst_frequency_penalty: string;
  multi_agent_reproduction_model: string;
  multi_agent_reproduction_base_url: string;
  multi_agent_reproduction_api_key: string;
  multi_agent_reproduction_temperature: string;
  multi_agent_reproduction_top_p: string;
  multi_agent_reproduction_max_tokens: string;
  multi_agent_reproduction_presence_penalty: string;
  multi_agent_reproduction_frequency_penalty: string;
  multi_agent_synthesis_model: string;
  multi_agent_synthesis_base_url: string;
  multi_agent_synthesis_api_key: string;
  multi_agent_synthesis_temperature: string;
  multi_agent_synthesis_top_p: string;
  multi_agent_synthesis_max_tokens: string;
  multi_agent_synthesis_presence_penalty: string;
  multi_agent_synthesis_frequency_penalty: string;
  paper_visible_venue_tags: string;
  paper_import_recognize_title: string;
  paper_import_recognize_authors: string;
  paper_import_recognize_year: string;
  paper_import_recognize_venue: string;
  paper_import_recognize_keywords: string;
  paper_auto_rename_on_import: string;
  paper_auto_rename_rule: string;
  vision_model: string;
  vision_base_url: string;
  vision_api_key: string;
  vision_temperature: string;
  vision_top_p: string;
  vision_max_tokens: string;
  vision_presence_penalty: string;
  vision_frequency_penalty: string;
  translation_model: string;
  translation_base_url: string;
  translation_api_key: string;
  translation_temperature: string;
  translation_top_p: string;
  translation_max_tokens: string;
  translation_presence_penalty: string;
  translation_frequency_penalty: string;
  app_lock_enabled: string;
  app_lock_password_salt: string;
  app_lock_password_hash: string;
  app_lock_timeout_minutes: string;
}

export interface GithubRepo {
  full_name: string;
  owner: string;
  name: string;
  html_url: string;
  description?: string;
  language?: string;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  license?: string;
  topics?: string[];
}

export interface GithubProjectSearchResponse {
  query: string;
  provider: "github_api" | "web_search";
  candidate_count: number;
  llm_used: boolean;
  overall_summary: string;
  ranking_note: string;
  repos: GithubRepo[];
}

export interface GithubProjectSearchHistoryEntry {
  id: string;
  query: string;
  result_json: string;
  created_at: string;
}

export interface SettingsHistoryEntry {
  id: string;
  name: string;
  created_at: string;
  llm_provider: LlmProvider;
  chat_model: string;
  paper_search_engine: PaperSearchEngine;
  multi_agent_enabled: boolean;
  enabled_agents_count: number;
}

export interface TavilyKeyTest {
  /** 脱敏后的 Key 标识 */
  label: string;
  ok: boolean;
  message: string;
}

export type SkillKind = "prompt" | "tool";

export interface Skill {
  id: string;
  name: string;
  title: string;
  description: string;
  prompt: string;
  tags: string[];
  /** prompt=提示词技能（对话注入）；tool=工具技能（如 PPT 生成，走专用流程，不在对话技能选择器出现）。 */
  kind: SkillKind;
  is_builtin: boolean;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  type: string;
  status: "pending" | "running" | "done" | "failed";
  progress: number;
  error?: string;
  created_at: string;
  finished_at?: string;
}

// ── OpenCode ──────────────────────────────────────────────────

export interface OpenCodeMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OpenCodeToolCall[];
  tool_results?: OpenCodeToolResult[];
  tool_call_id?: string | null;
  tool_id?: string | null;
  model?: string | null;
  created_at: string;
}

export interface OpenCodeToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface OpenCodeToolResult {
  tool_call_id: string;
  name: string;
  output: string;
  is_error: boolean;
}

export interface OpenCodeSession {
  id: string;
  title: string;
  working_dir: string | null;
  messages: OpenCodeMessage[];
  created_at: string;
  updated_at: string;
}

export interface ExperimentRecord {
  id: string;
  title: string;
  config: Record<string, unknown>;
  result: string;
  notes: string;
  linkedSubmissionId: string | null;
  defaultWorkingDir: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExperimentCodeSession {
  id: string;
  experiment_id: string;
  title: string;
  working_dir: string | null;
  tool_id: string | null;
  model: string | null;
  messages: OpenCodeMessage[];
  created_at: string;
  updated_at: string;
}

export interface ExperimentSnapshot {
  id: string;
  experimentId: string;
  title: string;
  configSnapshot: Record<string, unknown>;
  resultSnapshot: string;
  notesSnapshot: string;
  codeSessionId: string | null;
  toolId: string | null;
  model: string | null;
  workingDir: string | null;
  envSnapshot: Record<string, unknown>;
  createdAt: string;
}

export interface OpenCodeDetectResult {
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
}

// ── Survey（综述，持久化后跨端同步：桌面端生成落盘，移动端只读消费）──
export interface SurveySummary {
  id: string;
  query: string;
  created_at: string;
}

export interface SavedSurvey extends SurveySummary {
  report: Record<string, unknown>;
  papers: unknown[];
  formatted_citations: string[];
  citation_format?: string | null;
  language?: string | null;
  meta: Record<string, unknown>;
  markdown?: string | null;
}
