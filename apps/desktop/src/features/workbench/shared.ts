import type { ChatSession, KnowledgeNote, Paper, ResearchInterest } from "@research-copilot/types";

export interface SubmissionOverviewStats {
  active: number;
  pendingReviews: number;
  upcomingDdls: { name: string; deadline: string }[];
}

export interface WorkbenchCheckpointItem {
  id: string;
  sessionId: string;
  requestId: string | null;
  contextType: string;
  contextId: string | null;
  goal: string;
  summary: string;
  completedItems: string[];
  openQuestions: string[];
  nextSteps: string[];
  status: string;
  source?: string;
  assetSnapshot?: Record<string, unknown>;
  reviewStatus?: "pending" | "confirmed" | "corrected" | "withdrawn";
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchCheckpointRow {
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
  source?: string;
  asset_snapshot?: Record<string, unknown>;
  review_status?: "pending" | "confirmed" | "corrected" | "withdrawn";
  review_note?: string;
  created_at: string;
  updated_at: string;
}

export interface WorkbenchOverviewSource {
  papers: Paper[];
  interests: ResearchInterest[];
  notes: KnowledgeNote[];
  sessions: ChatSession[];
  checkpoints: WorkbenchCheckpointItem[];
  submission: SubmissionOverviewStats;
}

export type WorkbenchTone = "blue" | "green" | "amber" | "rust";

export interface WorkbenchMetric {
  label: string;
  value: string;
  note: string;
}

export interface WorkbenchLinkAction {
  label: string;
  to: string;
  state?: Record<string, unknown>;
}

const PAPER_TITLE_PREVIEW_LENGTH = 18;

export function paperDetailPath(paper: Paper): string {
  return `/papers?paper=${encodeURIComponent(paper.id)}`;
}

export function paperTitlePreview(paper: Paper): string {
  const title = paper.title.trim() || "这篇论文";
  if (title.length <= PAPER_TITLE_PREVIEW_LENGTH) return title;
  return `${title.slice(0, PAPER_TITLE_PREVIEW_LENGTH)}…`;
}

export function paperAction(label: string, paper: Paper): WorkbenchLinkAction {
  return { label, to: paperDetailPath(paper) };
}

export function paperActionLabel(verb: string, paper: Paper): string {
  return `${verb}《${paperTitlePreview(paper)}》`;
}

function listFromUnknown(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function rowToWorkbenchCheckpoint(row: WorkbenchCheckpointRow): WorkbenchCheckpointItem {
  return {
    id: row.id,
    sessionId: row.session_id,
    requestId: row.request_id ?? null,
    contextType: row.context_type || "general",
    contextId: row.context_id ?? null,
    goal: row.goal ?? "",
    summary: row.summary ?? "",
    completedItems: listFromUnknown(row.completed_items),
    openQuestions: listFromUnknown(row.open_questions),
    nextSteps: listFromUnknown(row.next_steps),
    status: row.status || "completed",
    source: row.source || "chat",
    assetSnapshot: row.asset_snapshot ?? {},
    reviewStatus: row.review_status ?? "pending",
    reviewNote: row.review_note ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface WorkbenchAgendaItem {
  id: string;
  label: string;
  title: string;
  description: string;
  tone: WorkbenchTone;
  action: WorkbenchLinkAction;
}

export interface WorkbenchInterestItem {
  id: string;
  title: string;
  stage: string;
  stageTone: WorkbenchTone;
  summary: string;
  nextStep: string;
  stats: string[];
  action: WorkbenchLinkAction;
}

export interface WorkbenchHandoffItem {
  id: string;
  label: string;
  title: string;
  description: string;
  tone: WorkbenchTone;
  action: WorkbenchLinkAction;
}

export interface WorkbenchRiskItem {
  id: string;
  label: string;
  title: string;
  description: string;
  tone: WorkbenchTone;
  action: WorkbenchLinkAction;
}

export interface WorkbenchAssetItem {
  id: string;
  label: string;
  title: string;
  description: string;
  action: WorkbenchLinkAction;
}

export interface WorkbenchSectionLayout {
  type: "agenda" | "interests" | "handoffs" | "risks" | "assets";
  priority: number;
  prominence: "normal" | "promoted";
}

export interface WorkbenchOverviewModel {
  heroTitle: string;
  heroDescription: string;
  primaryAction: WorkbenchLinkAction;
  secondaryAction: WorkbenchLinkAction;
  metrics: WorkbenchMetric[];
  summaryItems: Array<{ title: string; description: string }>;
  agenda: WorkbenchAgendaItem[];
  interests: WorkbenchInterestItem[];
  handoffs: WorkbenchHandoffItem[];
  risks: WorkbenchRiskItem[];
  assets: WorkbenchAssetItem[];
  layout: WorkbenchSectionLayout[];
  aiGenerated: boolean;
}

export interface WorkbenchOverviewText {
  heroTitle: string;
  heroDescription: string;
  summaryItems: Array<{ title: string; description: string }>;
}

export function toneToBadgeVariant(tone: WorkbenchTone): "info" | "success" | "warning" | "danger" {
  if (tone === "green") return "success";
  if (tone === "amber") return "warning";
  if (tone === "rust") return "danger";
  return "info";
}

export function toneStyle(tone: WorkbenchTone): { background: string; color: string } {
  if (tone === "green") {
    return { background: "rgba(52,199,89,0.14)", color: "#1A9E3F" };
  }
  if (tone === "amber") {
    return { background: "rgba(255,149,0,0.14)", color: "#C07000" };
  }
  if (tone === "rust") {
    return { background: "rgba(255,59,48,0.14)", color: "#D92B21" };
  }
  return { background: "rgba(0,122,255,0.12)", color: "#007AFF" };
}
