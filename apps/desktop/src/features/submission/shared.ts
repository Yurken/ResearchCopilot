import type { ResearchInterest } from "@research-copilot/types";
import type { VenueTemplate } from "../../data/venues";

export type CcfRating = "A" | "B" | "C" | "none";
export type SubmissionStatus = "writing" | "submitted" | "reviewing" | "accepted" | "rejected";
export type VenueType = "conference" | "journal";

export interface Conference {
  id: string;
  type: "conference";
  name: string;
  fullName: string;
  website?: string;
  deadline?: Date;
  notificationDate?: Date;
  ccf: CcfRating;
  area: string;
  starred: boolean;
  ei?: boolean;
}

export interface Journal {
  id: string;
  type: "journal";
  name: string;
  fullName: string;
  website?: string;
  ccf: CcfRating;
  area: string;
  starred: boolean;
  sci?: boolean;
  sciQuartile?: "Q1" | "Q2" | "Q3" | "Q4";
  ei?: boolean;
  specialIssueDeadline?: Date;
  specialIssueTitle?: string;
}

export type Venue = Conference | Journal;

export interface Submission {
  id: string;
  title: string;
  venue: string;
  venueType: VenueType;
  status: SubmissionStatus;
  deadline?: Date;
  submittedAt?: Date;
}

export interface ChecklistItem {
  id: string;
  submissionId?: string;
  label: string;
  checked: boolean;
  category: string;
  sortOrder?: number;
}

export interface AddSubmissionFormState {
  title: string;
  venue: string;
  venueType: VenueType;
  deadline: string;
}

export type RecommendationTargetType = "all" | VenueType;
export type RecommendationTargetRank = "any" | "ccf-a" | "ccf-b" | "ccf-c" | "sci-q1" | "sci-q2" | "sci" | "custom";
export type RecommendationRiskPreference = "safe" | "balanced" | "stretch";
export type RecommendationTimePreference = "fast" | "normal" | "any";
export type RecommendationTier = "stretch" | "primary" | "backup";
export type RecommendationRiskLevel = "low" | "medium" | "high";
export type SubmissionTimelineStepState = "done" | "active" | "pending";

export interface VenueRecommendationInput {
  title: string;
  abstract: string;
  keywords: string;
  direction: string;
  targetType: RecommendationTargetType;
  targetRank: RecommendationTargetRank;
  customRank: string;
  riskPreference: RecommendationRiskPreference;
  timePreference: RecommendationTimePreference;
  extra: string;
}

// 用研究主题填充推荐输入：主题写入研究方向、关键词，空白的标题/摘要按需补全，已填字段不覆盖。
export function buildRecommendationInputFromInterest(
  base: VenueRecommendationInput,
  interest: ResearchInterest,
): VenueRecommendationInput {
  const keywords = (interest.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean);
  const background = interest.profile?.background?.trim();
  const goal = interest.profile?.goal?.trim();
  return {
    ...base,
    title: base.title.trim() || interest.topic,
    direction: interest.topic,
    keywords: keywords.length > 0 ? keywords.join(", ") : base.keywords,
    abstract: base.abstract.trim() || background || goal || base.abstract,
    extra: base.extra.trim() || goal || base.extra,
  };
}

export interface VenueRecommendation extends VenueTemplate {
  reason: string;
  matchScore: number;
  matchTags: string[];
  tier: RecommendationTier;
  riskLevel: RecommendationRiskLevel;
  riskTips: string[];
  rejectionReasons: string[];
}

export interface SubmissionTimelineStep {
  key: string;
  label: string;
  state: SubmissionTimelineStepState;
  detail: string;
}

export interface RejectionRecoveryTarget {
  id: string;
  name: string;
  fullName: string;
  type: VenueType;
  area: string;
  ccf: CcfRating;
  sci?: boolean;
  sciQuartile?: "Q1" | "Q2" | "Q3" | "Q4";
  reason: string;
}

export interface RejectionRecoveryPlan {
  submission: Submission;
  summary: string;
  actions: string[];
  targets: RejectionRecoveryTarget[];
}

export type ReviewVerdict = "accept" | "minor_revision" | "major_revision" | "reject";

export interface ReviewComment {
  id: string;
  submissionId: string;
  round: number;
  reviewer: string;
  content: string;
  response: string;
  resolved: boolean;
  tags: string[];
  createdAt: Date;
}

export interface ReviewRound {
  submissionId: string;
  round: number;
  verdict: ReviewVerdict;
  receivedAt: Date;
}

export interface PaperVersion {
  id: string;
  submissionId: string;
  tag: string;
  label: string;
  stage: SubmissionStatus;
  content: string;
  notes: string;
  createdAt: Date;
  filePath?: string;
  fileName?: string;
}

export interface SaveVersionFormState {
  tag: string;
  label: string;
  notes: string;
  content: string;
}

export type MockStrictness = "lenient" | "balanced" | "strict";
export type DiagnosisRiskLevel = "low" | "medium" | "high";
export type RevisionTaskStatus = "todo" | "in_progress" | "done";
export type RevisionTaskPriority = "low" | "medium" | "high";

export interface MockReviewInput {
  abstract: string;
  reviewerCount: number;
  strictness: MockStrictness;
}

export interface MockReviewerResult {
  id: string;
  reviewer: string;
  content: string;
  suggestions: string[];
  tags: string[];
  verdict: ReviewVerdict;
}

export type ReviewFeedbackStatus = "pending" | "adopted" | "ignored" | "done";

export interface ReviewSuggestionFeedback {
  itemKey: string;
  status: ReviewFeedbackStatus;
  reason: string;
}

export interface SubmissionDiagnosisReport {
  id: string;
  submissionId: string;
  source: string;
  status: string;
  riskLevel: DiagnosisRiskLevel;
  summary: string;
  report: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubmissionRevisionTask {
  id: string;
  submissionId: string;
  diagnosisReportId?: string;
  checklistItemId?: string;
  paperVersionId?: string;
  experimentId?: string;
  title: string;
  detail: string;
  status: RevisionTaskStatus;
  priority: RevisionTaskPriority;
  paperVersionTag?: string;
  paperVersionLabel?: string;
  experimentTitle?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewFormState {
  reviewer: string;
  content: string;
  tags: string[];
  verdict: ReviewVerdict;
}

export type DiffLine = { type: "same" | "add" | "remove"; text: string };

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const beforeLines = oldText.split("\n").filter((line) => line.trim() !== "");
  const afterLines = newText.split("\n").filter((line) => line.trim() !== "");
  const beforeCount = beforeLines.length;
  const afterCount = afterLines.length;
  const dp: number[][] = Array.from({ length: beforeCount + 1 }, () => new Array(afterCount + 1).fill(0));

  for (let beforeIndex = 1; beforeIndex <= beforeCount; beforeIndex += 1) {
    for (let afterIndex = 1; afterIndex <= afterCount; afterIndex += 1) {
      dp[beforeIndex][afterIndex] =
        beforeLines[beforeIndex - 1] === afterLines[afterIndex - 1]
          ? dp[beforeIndex - 1][afterIndex - 1] + 1
          : Math.max(dp[beforeIndex - 1][afterIndex], dp[beforeIndex][afterIndex - 1]);
    }
  }

  const result: DiffLine[] = [];
  let beforeIndex = beforeCount;
  let afterIndex = afterCount;

  while (beforeIndex > 0 || afterIndex > 0) {
    if (
      beforeIndex > 0 &&
      afterIndex > 0 &&
      beforeLines[beforeIndex - 1] === afterLines[afterIndex - 1]
    ) {
      result.unshift({ type: "same", text: beforeLines[beforeIndex - 1] });
      beforeIndex -= 1;
      afterIndex -= 1;
      continue;
    }

    if (
      afterIndex > 0 &&
      (beforeIndex === 0 || dp[beforeIndex][afterIndex - 1] >= dp[beforeIndex - 1][afterIndex])
    ) {
      result.unshift({ type: "add", text: afterLines[afterIndex - 1] });
      afterIndex -= 1;
      continue;
    }

    result.unshift({ type: "remove", text: beforeLines[beforeIndex - 1] });
    beforeIndex -= 1;
  }

  return result;
}

export function normalizeVerdict(value: unknown): ReviewVerdict {
  if (value === "accept" || value === "minor_revision" || value === "major_revision" || value === "reject") {
    return value;
  }
  return "major_revision";
}

export function countVerdicts(items: Array<{ verdict: ReviewVerdict }>): Record<ReviewVerdict, number> {
  return items.reduce<Record<ReviewVerdict, number>>(
    (accumulator, item) => {
      accumulator[item.verdict] = (accumulator[item.verdict] ?? 0) + 1;
      return accumulator;
    },
    { accept: 0, minor_revision: 0, major_revision: 0, reject: 0 }
  );
}

export function getDominantVerdict(counts: Record<ReviewVerdict, number>): ReviewVerdict {
  return (Object.entries(counts) as [ReviewVerdict, number][])
    .sort((left, right) => right[1] - left[1])[0][0];
}

export const VERDICT_CFG: Record<ReviewVerdict, { label: string; color: string; bg: string }> = {
  accept: { label: "接收", color: "#34C759", bg: "rgba(52,199,89,0.12)" },
  minor_revision: { label: "小修", color: "#007AFF", bg: "rgba(0,122,255,0.12)" },
  major_revision: { label: "大修", color: "#FF9500", bg: "rgba(255,149,0,0.12)" },
  reject: { label: "拒稿", color: "#FF3B30", bg: "rgba(255,59,48,0.12)" },
};

export const DIAGNOSIS_RISK_CFG: Record<DiagnosisRiskLevel, { label: string; color: string; bg: string }> = {
  low: { label: "低风险", color: "#34C759", bg: "rgba(52,199,89,0.12)" },
  medium: { label: "中等风险", color: "#FF9500", bg: "rgba(255,149,0,0.12)" },
  high: { label: "高风险", color: "#FF3B30", bg: "rgba(255,59,48,0.12)" },
};

export const REVISION_TASK_STATUS_CFG: Record<RevisionTaskStatus, { label: string; color: string; bg: string }> = {
  todo: { label: "待处理", color: "#FF9500", bg: "rgba(255,149,0,0.12)" },
  in_progress: { label: "处理中", color: "#007AFF", bg: "rgba(0,122,255,0.12)" },
  done: { label: "已完成", color: "#34C759", bg: "rgba(52,199,89,0.12)" },
};

export const REVISION_TASK_PRIORITY_CFG: Record<RevisionTaskPriority, { label: string; color: string; bg: string }> = {
  low: { label: "低", color: "#34C759", bg: "rgba(52,199,89,0.10)" },
  medium: { label: "中", color: "#FF9500", bg: "rgba(255,149,0,0.10)" },
  high: { label: "高", color: "#FF3B30", bg: "rgba(255,59,48,0.10)" },
};

export const REVIEW_TAGS = ["实验", "写作", "方法", "贡献", "相关工作", "理论", "复杂度", "消融实验"];

export const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: "c1", label: "标题符合会议主题方向", checked: false, category: "内容" },
  { id: "c2", label: "摘要不超过字数限制", checked: false, category: "内容" },
  { id: "c3", label: "关键词已选择（3–5 个）", checked: false, category: "内容" },
  { id: "c4", label: "页面数量符合要求", checked: false, category: "格式" },
  { id: "c5", label: "字体与字号符合模板", checked: false, category: "格式" },
  { id: "c6", label: "页边距符合规定", checked: false, category: "格式" },
  { id: "c7", label: "图表清晰可读（≥ 300 DPI）", checked: false, category: "格式" },
  { id: "c8", label: "参考文献格式统一", checked: false, category: "格式" },
  { id: "c9", label: "作者顺序已确认", checked: false, category: "提交" },
  { id: "c10", label: "作者单位信息正确", checked: false, category: "提交" },
  { id: "c11", label: "利益冲突声明已填写（如需）", checked: false, category: "提交" },
  { id: "c12", label: "补充材料准备完毕（如需）", checked: false, category: "提交" },
  { id: "c13", label: "匿名化处理完成（双盲投稿）", checked: false, category: "合规" },
  { id: "c14", label: "自查重复率 < 15%", checked: false, category: "合规" },
  { id: "c15", label: "AI 使用声明（如需）", checked: false, category: "合规" },
];

export function getDaysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// 本地日期格式化：写库用本地日期，避免 toISOString() 按 UTC 换算导致日期偏移一天
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 解析 YYYY-MM-DD 为本地零点：避免 new Date("YYYY-MM-DD") 按 UTC 解析导致负时区偏移一天
export function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function getDdlStyle(days: number): { label: string; color: string; bg: string } {
  if (days < 0) return { label: "已截止", color: "#8E8E93", bg: "rgba(142,142,147,0.12)" };
  if (days <= 7) return { label: `${days} 天`, color: "#FF3B30", bg: "rgba(255,59,48,0.12)" };
  if (days <= 30) return { label: `${days} 天`, color: "#FF9500", bg: "rgba(255,149,0,0.12)" };
  return { label: `${days} 天`, color: "#34C759", bg: "rgba(52,199,89,0.12)" };
}

export const CCF_STYLE: Record<CcfRating, { color: string; bg: string }> = {
  A: { color: "#FF3B30", bg: "rgba(255,59,48,0.10)" },
  B: { color: "#FF9500", bg: "rgba(255,149,0,0.10)" },
  C: { color: "#007AFF", bg: "rgba(0,122,255,0.10)" },
  none: { color: "#8E8E93", bg: "rgba(142,142,147,0.10)" },
};

export const STATUS_CFG: Record<SubmissionStatus, { label: string; color: string; bg: string }> = {
  writing: { label: "撰写中", color: "#AF52DE", bg: "rgba(175,82,222,0.10)" },
  submitted: { label: "已投稿", color: "#007AFF", bg: "rgba(0,122,255,0.10)" },
  reviewing: { label: "审稿中", color: "#FF9500", bg: "rgba(255,149,0,0.10)" },
  accepted: { label: "已接收", color: "#34C759", bg: "rgba(52,199,89,0.10)" },
  rejected: { label: "已拒绝", color: "#8E8E93", bg: "rgba(142,142,147,0.10)" },
};

export const KANBAN_COLS: { key: SubmissionStatus; label: string }[] = [
  { key: "writing", label: "撰写中" },
  { key: "submitted", label: "已投稿" },
  { key: "reviewing", label: "审稿中" },
  { key: "accepted", label: "已接收" },
  { key: "rejected", label: "已拒绝" },
];

const TIMELINE_STEP_KEYS: SubmissionStatus[] = ["writing", "submitted", "reviewing", "accepted"];

function formatDate(date?: Date): string {
  return date ? date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) : "";
}

function daysSince(date?: Date): number | null {
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

export function buildSubmissionTimeline(submission: Submission): SubmissionTimelineStep[] {
  const statusIndex =
    submission.status === "rejected"
      ? TIMELINE_STEP_KEYS.indexOf("reviewing")
      : TIMELINE_STEP_KEYS.indexOf(submission.status);
  const waitingDays = daysSince(submission.submittedAt);

  return TIMELINE_STEP_KEYS.map((key, index) => {
    const state: SubmissionTimelineStepState =
      index < statusIndex ? "done" : index === statusIndex ? "active" : "pending";

    if (key === "writing") {
      const deadlineDetail =
        submission.deadline && submission.venueType === "conference"
          ? `DDL ${formatDate(submission.deadline)}`
          : "材料准备";
      return { key, label: "准备", state, detail: deadlineDetail };
    }

    if (key === "submitted") {
      return {
        key,
        label: "提交",
        state,
        detail: submission.submittedAt ? `已投 ${formatDate(submission.submittedAt)}` : "待提交",
      };
    }

    if (key === "reviewing") {
      const detail =
        submission.status === "rejected"
          ? "转投评估"
          : waitingDays !== null && submission.status === "reviewing"
            ? `等待 ${waitingDays} 天`
            : "等待外审";
      return { key, label: "外审", state, detail };
    }

    return {
      key,
      label: "结果",
      state: submission.status === "accepted" ? "done" : state,
      detail: submission.status === "accepted" ? "已录用" : submission.status === "rejected" ? "已拒稿" : "待决定",
    };
  });
}

type UnknownRow = Record<string, unknown>;

function asRow(value: unknown): UnknownRow {
  return value !== null && typeof value === "object" ? value as UnknownRow : {};
}

function stringField(row: UnknownRow, key: string, fallback = ""): string {
  const value = row[key];
  return typeof value === "string" ? value : fallback;
}

function optionalStringField(row: UnknownRow, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function booleanField(row: UnknownRow, key: string): boolean {
  const value = row[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return false;
}

function numberField(row: UnknownRow, key: string, fallback = 0): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function dateField(row: UnknownRow, key: string): Date | undefined {
  const value = row[key];
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) {
    return undefined;
  }

  // 日期型字符串（YYYY-MM-DD）按本地零点解析，避免 UTC 解析在负时区偏移一天
  if (typeof value === "string") {
    const localDate = parseLocalDate(value);
    if (localDate) return localDate;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function ccfRatingField(row: UnknownRow): CcfRating {
  const value = row.ccf;
  return value === "A" || value === "B" || value === "C" || value === "none" ? value : "none";
}

function venueTypeField(row: UnknownRow): VenueType {
  return row.venueType === "journal" ? "journal" : "conference";
}

function submissionStatusField(value: unknown): SubmissionStatus {
  return value === "submitted" || value === "reviewing" || value === "accepted" || value === "rejected"
    ? value
    : "writing";
}

function diagnosisRiskLevelField(value: unknown): DiagnosisRiskLevel {
  return value === "low" || value === "high" ? value : "medium";
}

function revisionTaskStatusField(value: unknown): RevisionTaskStatus {
  return value === "in_progress" || value === "done" ? value : "todo";
}

function revisionTaskPriorityField(value: unknown): RevisionTaskPriority {
  return value === "low" || value === "high" ? value : "medium";
}

function stringArrayField(row: UnknownRow, key: string): string[] {
  const value = row[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function rowToVenue(value: unknown): Venue {
  const row = asRow(value);
  if (row.type === "journal") {
    return {
      id: stringField(row, "id"),
      type: "journal",
      name: stringField(row, "name"),
      fullName: stringField(row, "fullName"),
      website: optionalStringField(row, "website"),
      ccf: ccfRatingField(row),
      area: stringField(row, "area"),
      starred: booleanField(row, "starred"),
      sci: booleanField(row, "sci"),
      sciQuartile: row.sciQuartile === "Q1" || row.sciQuartile === "Q2" || row.sciQuartile === "Q3" || row.sciQuartile === "Q4" ? row.sciQuartile : undefined,
      ei: booleanField(row, "ei"),
      specialIssueDeadline: dateField(row, "specialIssueDeadline"),
      specialIssueTitle: optionalStringField(row, "specialIssueTitle"),
    } satisfies Journal;
  }

  return {
    id: stringField(row, "id"),
    type: "conference",
    name: stringField(row, "name"),
    fullName: stringField(row, "fullName"),
    website: optionalStringField(row, "website"),
    deadline: dateField(row, "deadline"),
    notificationDate: dateField(row, "notificationDate"),
    ccf: ccfRatingField(row),
    area: stringField(row, "area"),
    starred: booleanField(row, "starred"),
    ei: booleanField(row, "ei"),
  } satisfies Conference;
}

export function rowToSubmission(value: unknown): Submission {
  const row = asRow(value);
  return {
    id: stringField(row, "id"),
    title: stringField(row, "title"),
    venue: stringField(row, "venueName"),
    venueType: venueTypeField(row),
    status: submissionStatusField(row.status),
    deadline: dateField(row, "deadline"),
    submittedAt: dateField(row, "submittedAt"),
  };
}

export function rowToVersion(value: unknown): PaperVersion {
  const row = asRow(value);
  return {
    id: stringField(row, "id"),
    submissionId: stringField(row, "submissionId"),
    tag: stringField(row, "tag"),
    label: stringField(row, "label"),
    stage: submissionStatusField(row.stage),
    content: stringField(row, "content"),
    notes: stringField(row, "notes"),
    createdAt: dateField(row, "createdAt") ?? new Date(),
    filePath: optionalStringField(row, "filePath"),
    fileName: optionalStringField(row, "fileName"),
  };
}

export function rowToChecklistItem(value: unknown): ChecklistItem {
  const row = asRow(value);
  return {
    id: stringField(row, "id"),
    submissionId: optionalStringField(row, "submissionId"),
    label: stringField(row, "label"),
    checked: booleanField(row, "checked"),
    category: stringField(row, "category"),
    sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : undefined,
  };
}

export function rowToRound(value: unknown): ReviewRound {
  const row = asRow(value);
  return {
    submissionId: stringField(row, "submissionId"),
    round: numberField(row, "round", 1),
    verdict: normalizeVerdict(row.verdict),
    receivedAt: dateField(row, "receivedAt") ?? new Date(),
  };
}

export function rowToComment(value: unknown): ReviewComment {
  const row = asRow(value);
  return {
    id: stringField(row, "id"),
    submissionId: stringField(row, "submissionId"),
    round: numberField(row, "round", 1),
    reviewer: stringField(row, "reviewer"),
    content: stringField(row, "content"),
    response: stringField(row, "response"),
    resolved: booleanField(row, "resolved"),
    tags: stringArrayField(row, "tags"),
    createdAt: dateField(row, "createdAt") ?? new Date(),
  };
}

export function rowToDiagnosisReport(value: unknown): SubmissionDiagnosisReport {
  const row = asRow(value);
  return {
    id: stringField(row, "id"),
    submissionId: stringField(row, "submissionId"),
    source: stringField(row, "source"),
    status: stringField(row, "status"),
    riskLevel: diagnosisRiskLevelField(row.riskLevel),
    summary: stringField(row, "summary"),
    report: asRow(row.report),
    createdAt: dateField(row, "createdAt") ?? new Date(),
    updatedAt: dateField(row, "updatedAt") ?? new Date(),
  };
}

export function getDiagnosisReportIssues(report: SubmissionDiagnosisReport, limit = 5): string[] {
  const parsedReviews = report.report.parsed_reviews;
  if (!Array.isArray(parsedReviews)) {
    return [];
  }

  const seen = new Set<string>();
  const issues: string[] = [];
  for (const review of parsedReviews) {
    const row = asRow(review);
    const values = [
      ...stringArrayField(row, "weaknesses"),
      ...stringArrayField(row, "questions"),
      ...stringArrayField(row, "suggestions"),
    ];

    for (const value of values) {
      const compact = value.trim().replace(/\s+/g, " ");
      if (!compact || seen.has(compact)) {
        continue;
      }
      seen.add(compact);
      issues.push(compact);
      if (issues.length >= limit) {
        return issues;
      }
    }
  }

  return issues;
}

export function rowToRevisionTask(value: unknown): SubmissionRevisionTask {
  const row = asRow(value);
  return {
    id: stringField(row, "id"),
    submissionId: stringField(row, "submissionId"),
    diagnosisReportId: optionalStringField(row, "diagnosisReportId"),
    checklistItemId: optionalStringField(row, "checklistItemId"),
    paperVersionId: optionalStringField(row, "paperVersionId"),
    experimentId: optionalStringField(row, "experimentId"),
    title: stringField(row, "title"),
    detail: stringField(row, "detail"),
    status: revisionTaskStatusField(row.status),
    priority: revisionTaskPriorityField(row.priority),
    paperVersionTag: optionalStringField(row, "paperVersionTag"),
    paperVersionLabel: optionalStringField(row, "paperVersionLabel"),
    experimentTitle: optionalStringField(row, "experimentTitle"),
    createdAt: dateField(row, "createdAt") ?? new Date(),
    updatedAt: dateField(row, "updatedAt") ?? new Date(),
  };
}
