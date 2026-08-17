export interface ResearchThemeProgress {
  paperCount: number;
  analyzedPaperCount: number;
  noteCount: number;
  sessionCount: number;
  experimentCount: number;
  submissionCount: number;
  claimCount: number;
}

export interface ResearchTheme {
  id: string;
  name: string;
  lastActiveAt: string;
  /** 路线是否已规划成形，用于研究进展阶梯的第一步状态。 */
  planned: boolean;
  /** 主题在各模块下沉淀的真实工作量。 */
  progress: ResearchThemeProgress;
  completedTasks: string[];
  openQuestions: string[];
  nextSteps: Array<{ title: string; description?: string }>;
}

export const EMPTY_THEME_PROGRESS: ResearchThemeProgress = {
  paperCount: 0,
  analyzedPaperCount: 0,
  noteCount: 0,
  sessionCount: 0,
  experimentCount: 0,
  submissionCount: 0,
  claimCount: 0,
};

export type ThemeStageState = "done" | "active" | "todo";

/** 研究生命周期里的一个阶段，state 由主题各模块的真实计数推导。 */
export interface ThemeStage {
  key: string;
  label: string;
  hint: string;
  state: ThemeStageState;
  count: number | null;
  /** 继续推进该阶段时跳转的模块路由。 */
  to: string;
}

interface ThemeStageRule {
  key: string;
  label: string;
  hint: string;
  to: string;
  done: (theme: ResearchTheme) => boolean;
  count: (progress: ResearchThemeProgress) => number | null;
}

const THEME_STAGE_RULES: ThemeStageRule[] = [
  {
    key: "plan",
    label: "规划路线",
    hint: "明确目标、阶段与代表论文",
    to: "/planner",
    done: (theme) => theme.planned,
    count: () => null,
  },
  {
    key: "papers",
    label: "关联论文",
    hint: "导入核心论文，建立证据起点",
    to: "/papers",
    done: (theme) => theme.progress.paperCount > 0,
    count: (progress) => progress.paperCount,
  },
  {
    key: "analyze",
    label: "论文解读",
    hint: "拆解方法、结论与适用边界",
    to: "/papers",
    done: (theme) => theme.progress.analyzedPaperCount > 0,
    count: (progress) => progress.analyzedPaperCount,
  },
  {
    key: "notes",
    label: "知识沉淀",
    hint: "把关键结论固定成笔记",
    to: "/knowledge",
    done: (theme) => theme.progress.noteCount > 0,
    count: (progress) => progress.noteCount,
  },
  {
    key: "submission",
    label: "投稿推进",
    hint: "把成果整理成投稿与版本",
    to: "/submission",
    done: (theme) => theme.progress.submissionCount > 0,
    count: (progress) => progress.submissionCount,
  },
];

/**
 * 推导研究进展阶梯：已满足条件的阶段标记为 done，
 * 第一个未完成阶段标记为 active（推荐聚焦），其余未完成阶段为 todo。
 */
export function buildThemeStages(theme: ResearchTheme): ThemeStage[] {
  let activeAssigned = false;
  return THEME_STAGE_RULES.map((rule) => {
    const done = rule.done(theme);
    let state: ThemeStageState;
    if (done) {
      state = "done";
    } else if (!activeAssigned) {
      state = "active";
      activeAssigned = true;
    } else {
      state = "todo";
    }
    return {
      key: rule.key,
      label: rule.label,
      hint: rule.hint,
      state,
      count: rule.count(theme.progress),
      to: rule.to,
    };
  });
}

/** 已完成阶段占比，作为「研究进展 N%」的直观度量。 */
export function themeProgressPercent(stages: ThemeStage[]): number {
  if (stages.length === 0) return 0;
  const done = stages.filter((stage) => stage.state === "done").length;
  return Math.round((done / stages.length) * 100);
}

export type EvidenceLinkType = "paper" | "note" | "experiment" | "submission" | "checkpoint";

export interface EvidenceLink {
  id: string;
  type: EvidenceLinkType;
  title: string;
  sourceId: string;
  summary: string;
}

export interface ResearchActivityEvent {
  id: string;
  themeId: string;
  eventType: string; // "paper_read" | "note_added" | "experiment_logged" | "submission_updated"
  title: string;
  timestamp: string;
  details?: Record<string, any>;
}

export interface ResearchContextState {
  theme: ResearchTheme | null;
  events: ResearchActivityEvent[];
  recentThemes: ResearchTheme[];
}
