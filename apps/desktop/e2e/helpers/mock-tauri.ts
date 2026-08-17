// ── Mock data ────────────────────────────────────────────────────
// Shapes mirror src/lib/client.ts (the canonical invoke contract).

export const MOCK_WORKBENCH_DATA = {
  heroTitle: "测试工作台概览",
  heroDescription: "这是一个用于端到端测试的工作台概览描述。",
  summaryItems: [],
};

export const MOCK_PAPERS = [
  {
    id: "paper-1",
    title: "深度学习在自然语言处理中的应用",
    authors: "张三, 李四",
    year: 2024,
    abstract: "本文综述了深度学习在自然语言处理领域的最新进展...",
    venue: "ACL 2024",
    ccfRating: "A",
    wosIndex: "SCI",
    createdAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "paper-2",
    title: "Transformer 架构的改进方法",
    authors: "王五",
    year: 2023,
    abstract: "本文提出了一种改进的 Transformer 架构...",
    venue: "NeurIPS 2023",
    ccfRating: "A",
    wosIndex: "SCI",
    createdAt: "2023-12-01T10:00:00Z",
  },
];

export const MOCK_CHAT_SESSIONS = [
  {
    id: "session-1",
    title: "关于深度学习的讨论",
    mode: "direct",
    interestId: null,
    pinned: false,
    createdAt: "2024-01-10T10:00:00Z",
    updatedAt: "2024-01-10T10:00:00Z",
  },
];

export const MOCK_INTERESTS = [
  {
    id: "interest-1",
    name: "自然语言处理",
    description: "研究自然语言处理技术",
    status: "active",
    createdAt: "2024-01-01T10:00:00Z",
    updatedAt: "2024-01-01T10:00:00Z",
  },
];

// settings_get returns AppSettings; the app merges it onto DEFAULT_SETTINGS,
// so an empty object is a safe, crash-free response for the tests.
export const MOCK_SETTINGS = {};

// ── Init script ──────────────────────────────────────────────────
// Returned values keyed by the *real* invoke command names (see client.ts).
// Commands that pages call on mount must return an empty-but-valid shape
// (array, or { key: [] }) so `.map`/destructuring never throws.

const MOCK_INVOKE_RESULTS = {
  // Settings
  settings_get: MOCK_SETTINGS,
  settings_history_list: [],
  token_usage_stats: {
    total: { input: 0, output: 0, total: 0, chars: 0, requests: 0 },
    today: { input: 0, output: 0, total: 0, chars: 0, requests: 0 },
    month: { input: 0, output: 0, total: 0, chars: 0, requests: 0 },
  },
  app_lock_status: { enabled: false, timeoutMinutes: 0, hasSecurity: false, hasHint: false, hasEmail: false },
  memory_privacy_status: { enabled: false },
  sync_get_config: { configured: false, url: "", username: "" },
  sync_status: { configured: false, running: false, last_sync_at: null, last_error: null, last_message: null },
  update_check: { available: false },

  // Knowledge
  knowledge_list_interests: [],
  knowledge_list_notes: [],
  knowledge_list_notes_by_source: [],
  knowledge_graph_snapshot: {
    interests: [],
    papers: [],
    notes: [],
    experiments: [],
    claims: [],
    evidenceLinks: [],
    citations: [],
    summary: {
      interestCount: 0,
      paperCount: 0,
      noteCount: 0,
      experimentCount: 0,
      claimCount: 0,
      evidenceCount: 0,
      citationCount: 0,
    },
  },

  // Papers
  papers_list: [],
  ccf_list: { items: [] },

  // Chat
  chat_list_sessions: [],

  // Survey / Planner
  survey_list: [],

  // Experiment / Submission
  experiment_list: { experiments: [] },
  submission_list: { submissions: [] },
  submission_list_venues: { venues: [] },
  submission_stats: { active: 0, pendingReviews: 0, upcomingDdls: [] },

  // Skills / Memory
  skills_list: [],
  memory_list: [],
  memory_list_manual_records: [],
  memory_list_auto_records: [],
  memory_list_observations: [],
  memory_list_checkpoints: { checkpoints: [] },

  // Workbench
  workbench_get_overview_text_cache: null,

  // Research context
  research_context_get_recent_themes: [],

  // Active researcher
  active_researcher_findings: { findings: [], unread_count: 0 },
};

export const TAURI_MOCK_SCRIPT = `
  // Suppress the first-run "快速开始" onboarding modal so it never intercepts clicks.
  try { window.localStorage.setItem("rc:onboarding:quick-start-seen", "true"); } catch (e) {}

  const __MOCK_INVOKE_RESULTS = ${JSON.stringify(MOCK_INVOKE_RESULTS)};

  function __mockInvoke(cmd) {
    if (Object.prototype.hasOwnProperty.call(__MOCK_INVOKE_RESULTS, cmd)) {
      return __MOCK_INVOKE_RESULTS[cmd];
    }
    // Tauri plugin internals (e.g. plugin:app|version) — return a benign value.
    if (typeof cmd === "string" && cmd.indexOf("plugin:app|version") !== -1) return "0.0.0-test";
    return null;
  }

  window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
  window.__TAURI_INTERNALS__.invoke = async (cmd) => __mockInvoke(cmd);
  window.__TAURI_INTERNALS__.transformCallback = (cb) => { return cb; };
  window.__TAURI_INTERNALS__.unregisterCallback = () => {};
  // getCurrentWindow() reads metadata.currentWindow.label synchronously.
  window.__TAURI_INTERNALS__.metadata = window.__TAURI_INTERNALS__.metadata || {
    currentWindow: { label: "main" },
    windows: [{ label: "main" }],
  };

  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => __mockInvoke(cmd),
    },
    event: {
      listen: async () => () => {},
      emit: async () => {},
      once: async () => {},
    },
    window: {
      getCurrentWindow: () => ({
        listen: async () => () => {},
        onCloseRequested: async () => () => {},
        onResized: async () => () => {},
        onDragDropEvent: async () => () => {},
        startDragging: async () => {},
      }),
    },
    app: {
      getVersion: async () => "0.0.0-test",
    },
  };

  window.__TAURI_PLUGIN_SHELL__ = {
    open: async () => {},
  };

  window.__TAURI_PLUGIN_DIALOG__ = {
    open: async () => null,
    save: async () => null,
    message: async () => {},
    ask: async () => false,
    confirm: async () => false,
  };

  window.__TAURI_PLUGIN_FS__ = {
    readFile: async () => new Uint8Array(),
    writeFile: async () => {},
    exists: async () => false,
  };

  window.__TAURI_PLUGIN_PROCESS__ = {
    exit: async () => {},
    relaunch: async () => {},
  };
`;

/**
 * Build an init script that installs the base Tauri mock and then overrides
 * specific invoke command results. Use this when a spec needs real data for
 * a command (e.g. experiment_list returning seeded experiments).
 */
export function tauriMockScriptWith(overrides: Record<string, unknown>): string {
  return `
    ${TAURI_MOCK_SCRIPT}
    (() => {
      const __OVERRIDES = ${JSON.stringify(overrides)};
      const __baseInvoke = window.__TAURI_INTERNALS__.invoke;
      const __resolve = (cmd) =>
        Object.prototype.hasOwnProperty.call(__OVERRIDES, cmd)
          ? __OVERRIDES[cmd]
          : undefined;
      window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
        const ov = __resolve(cmd);
        return ov !== undefined ? ov : __baseInvoke(cmd, args);
      };
      window.__TAURI__.core.invoke = window.__TAURI_INTERNALS__.invoke;
    })();
  `;
}
